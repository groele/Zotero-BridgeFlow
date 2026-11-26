import type { PluginKernel } from '../../../kernel/plugin-kernel.ts';
import type { OrphanCitationInfo } from '../../../kernel/types.ts';
import type { Win32BridgeService } from '../../../services/win32-bridge.ts';
import { extractSessionCitationsWithOrphans } from '../orphan/orphan-extraction.ts';
import { extractDocumentBaseName, type WordSessionTracker } from './session-tracker.ts';

/**
 * Polls Zotero.Integration.sessions with idle backoff and hooks getSession/execCommand:
 * - Numeric-sorted citationsByIndex appearance order & per-item true document ordinal (1, 2, 3...).
 * - Torn-snapshot retry and two-read empty snapshot confirmation before pruning citations.
 */
export class WordIntegrationPoller {
	private timer: number | null = null;
	private viewRefreshTimer: number | null = null;
	private postExecTimer: number | null = null;
	private unpatchExec: (() => void) | null = null;
	private unpatchGetSession: (() => void) | null = null;
	private running = false;
	private stopEpoch = 0;
	private polling = false;
	private execDepth = 0;
	private idleRounds = 0;
	private readonly emptyStreakBySession = new Map<string, number>();
	private readonly docPathBySession = new Map<string, string>();
	private readonly lastWinProbeAt = new Map<string, number>();
	private readonly updating = new WeakSet<object>();
	private pendingCmdDocHint = '';

	private readonly kernel: PluginKernel;
	private readonly tracker: WordSessionTracker;
	private readonly win32?: Win32BridgeService;

	constructor(kernel: PluginKernel, tracker: WordSessionTracker, win32?: Win32BridgeService) {
		this.kernel = kernel;
		this.tracker = tracker;
		this.win32 = win32;
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.idleRounds = 0;
		this.emptyStreakBySession.clear();
		this.installHooks();
		void this.pollOnce().catch((err) => this.kernel.logger.error('word-cite:poll', err));
		this.scheduleNext();
	}

	stop(): void {
		this.running = false;
		this.stopEpoch++;
		if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
		if (this.viewRefreshTimer !== null) { clearTimeout(this.viewRefreshTimer); this.viewRefreshTimer = null; }
		if (this.postExecTimer !== null) { clearTimeout(this.postExecTimer); this.postExecTimer = null; }
		this.unpatchExec?.();
		this.unpatchExec = null;
		this.unpatchGetSession?.();
		this.unpatchGetSession = null;
		this.execDepth = 0;
		this.pendingCmdDocHint = '';
		this.emptyStreakBySession.clear();
		this.docPathBySession.clear();
		this.lastWinProbeAt.clear();
	}

	async notifyCommittedSession(session?: any): Promise<boolean> {
		return this.pollOnce(true, session);
	}

	async pollOnce(allowDuringExec = false, committedSession?: any): Promise<boolean> {
		if (this.polling || (!allowDuringExec && this.execDepth > 0)) return false;
		const integration = (globalThis as any).Zotero?.Integration;
		if (!allowDuringExec && integration?.currentDoc) return false;
		const sessionsMap = integration?.sessions;
		if (!sessionsMap && !committedSession) {
			this.idleRounds = Math.min(20, this.idleRounds + 1);
			return false;
		}

		this.polling = true;
		const epoch = this.stopEpoch;
		try {
			const merged = new Map<string, any>();
			if (sessionsMap) {
				const rawEntries: Array<[string, any]> = sessionsMap instanceof Map
					? [...sessionsMap.entries()]
					: Object.entries(sessionsMap);
				for (const [sid, s] of rawEntries) merged.set(String(sid), s);
			}
			if (committedSession && typeof committedSession === 'object') {
				const sid = String(committedSession.sessionID || 'word-active');
				merged.set(sid, committedSession);
			}
			const entries = [...merged.entries()];
			const activeIDs = new Set<string>();
			const rawSessions: Array<{
				sessionID: string;
				documentPath: string;
				citations: Array<{ itemID: number; ordinal: number; shortText: string; occurrences?: number }>;
				orphans?: readonly OrphanCitationInfo[];
			}> = [];

			for (const [rawID, session] of entries) {
				if (!session) continue;
				const agent = String(session.agent || 'WinWord');
				if (!/(WinWord|MacWord|Word)/i.test(agent)) continue;
				const sessionID = String(rawID);
				activeIDs.add(sessionID);

				const ready = await this.ensureConsistentSnapshot(session);
				if (this.stopEpoch !== epoch || (!allowDuringExec && (this.execDepth > 0 || integration?.currentDoc))) return false;
				const prevTracked = this.tracker.getSession(sessionID);
				const { citations: parsed, orphans } = ready
					? extractSessionCitationsWithOrphans(session) : { citations: [], orphans: [] };
				const empty = parsed.length === 0 && orphans.length === 0;
				const streak = (this.emptyStreakBySession.get(sessionID) ?? 0) + 1;
				if (ready && empty) this.emptyStreakBySession.set(sessionID, streak);
				else this.emptyStreakBySession.delete(sessionID);
				if (!ready || (empty && streak < 2 && prevTracked)) {
					if (prevTracked) rawSessions.push({
						sessionID, documentPath: prevTracked.documentPath,
						citations: [...prevTracked.itemCitations].map(([itemID, info]) => ({ itemID, ...info })),
						orphans: prevTracked.orphans,
					});
					continue;
				}
				const docPath = this.resolveSessionDocumentPath(sessionID, session, entries.length);
				rawSessions.push({ sessionID, documentPath: docPath, citations: parsed, orphans });
			}

			for (const key of this.emptyStreakBySession.keys()) if (!activeIDs.has(key)) this.emptyStreakBySession.delete(key);
			for (const key of this.docPathBySession.keys()) if (!activeIDs.has(key)) this.docPathBySession.delete(key);
			for (const key of this.lastWinProbeAt.keys()) if (!activeIDs.has(key)) this.lastWinProbeAt.delete(key);

			if (this.stopEpoch !== epoch || (!allowDuringExec && (this.execDepth > 0 || integration?.currentDoc))) return false;
			const changed = this.tracker.syncSessions(rawSessions);
			if (changed) { this.idleRounds = 0; if (this.running) this.scheduleItemsViewRefresh(); }
			else { this.idleRounds = Math.min(20, this.idleRounds + 1); }
			return changed;
		} finally {
			this.polling = false;
		}
	}

	private async ensureConsistentSnapshot(session: any): Promise<boolean> {
		if (this.updating.has(session)) return false;
		if (typeof session.updateFromDocument !== 'function') return true;
		const byIdx = session.citationsByIndex;
		const byItem = session.citationsByItemID;
		const missingObj = !byIdx || typeof byIdx !== 'object' || !byItem || typeof byItem !== 'object';
		const mismatch = !missingObj && ((Object.keys(byIdx).length === 0) !== (Object.keys(byItem).length === 0));
		if (!missingObj && !mismatch) return true;
		let guard: ReturnType<typeof setTimeout> | undefined;
		try {
			this.updating.add(session);
			const updatePromise = Promise.resolve().then(() => session.updateFromDocument(0))
				.then(() => true, () => false).finally(() => this.updating.delete(session));
			return await Promise.race([
				updatePromise,
				new Promise<boolean>((resolve) => { guard = setTimeout(() => resolve(false), 4000); }),
			]);
		} finally {
			if (guard !== undefined) clearTimeout(guard);
		}
	}

	private extractDirectDocCandidate(session: any, docObj?: any): string {
		const doc = docObj ?? session?._doc ?? session?.doc;
		const desc = typeof doc === 'object' && doc !== null ? doc : undefined;
		const candidates = [
			typeof doc === 'string' ? doc : null,
			desc?.docId, desc?.documentPath, desc?.documentName, desc?.fullName,
			desc?.filePath, desc?.path, desc?.url, desc?.uri, desc?.filename, desc?.title, desc?.name,
			session?.docId, session?.documentPath, session?.documentName,
			session?.filePath, session?.path, session?.title, session?.name,
		];
		for (const c of candidates) {
			if (typeof c === 'string' && c.trim() && c.trim() !== '__doc__' && !/\.app\/?$/i.test(c.trim())) {
				return c.trim();
			}
		}
		return '';
	}

	private resolveSessionDocumentPath(sessionID: string, session: any, totalSessions: number): string {
		const direct = this.extractDirectDocCandidate(session);
		if (direct) {
			this.docPathBySession.set(sessionID, direct);
			return direct;
		}
		const cached = this.docPathBySession.get(sessionID);
		if (cached && !cached.startsWith('window-title:')) return cached;
		const now = Date.now();
		if (cached && cached.startsWith('window-title:') && this.idleRounds > 0 && now - (this.lastWinProbeAt.get(sessionID) ?? 0) < 15_000) {
			return cached;
		}

		if (this.win32 && totalSessions === 1) {
			this.lastWinProbeAt.set(sessionID, now);
			const probed = this.win32.probeWordWindowTitles();
			const fg = probed.foregroundTitle ? extractDocumentBaseName(`window-title:${probed.foregroundTitle}`) : '';
			if (fg && fg !== 'Untitled Word Document' && (totalSessions === 1 || !cached)) {
				const winId = `window-title:${fg}`;
				this.docPathBySession.set(sessionID, winId);
				return winId;
			}
			if (totalSessions === 1 && probed.visibleTitles.length === 1) {
				const vis = extractDocumentBaseName(`window-title:${probed.visibleTitles[0]}`);
				if (vis && vis !== 'Untitled Word Document') {
					const winId = `window-title:${vis}`;
					this.docPathBySession.set(sessionID, winId);
					return winId;
				}
			}
		}
		return cached || sessionID;
	}

	private extractSessionCitations(session: any) {
		return extractSessionCitationsWithOrphans(session).citations;
	}

	private scheduleItemsViewRefresh(): void {
		if (this.viewRefreshTimer !== null || !this.kernel.prefs.get('wordCite.column.enable')) return;
		const delay = this.kernel.prefs.get('wordCite.itemsViewRefreshDebounceMs');
		this.viewRefreshTimer = setTimeout(() => {
			this.viewRefreshTimer = null;
			const wins: Window[] = (globalThis as any).Zotero?.getMainWindows?.() || [];
			for (const win of wins) {
				try {
					const iv = (win as any).ZoteroPane?.itemsView;
					if (!iv) continue;
					if (typeof iv.invalidateRowCache === 'function' && typeof iv.tree?.invalidate === 'function') {
						iv.invalidateRowCache(true);
						iv.tree.invalidate();
					} else if (typeof iv.refreshAndMaintainSelection === 'function') {
						void Promise.resolve(iv.refreshAndMaintainSelection()).catch(() => {});
					} else {
						iv.refresh?.();
					}
				} catch { /* ignore */ }
			}
		}, Math.max(20, delay));
	}

	private installHooks(): void {
		const integration = (globalThis as any).Zotero?.Integration;
		if (!integration) return;

		if (typeof integration.getSession === 'function' && !this.unpatchGetSession) {
			this.unpatchGetSession = this.kernel.runtime.patch(
				integration,
				'getSession',
				'Zotero.Integration',
				(orig) => async (...args: unknown[]) => {
					const [, doc] = args;
					const res = await Promise.resolve(orig.apply(integration, args));
					const sessionObj = Array.isArray(res) ? res[0] : res;
					const sid = typeof sessionObj?.sessionID === 'string' ? sessionObj.sessionID : '';
					if (sid) {
						const candidate = this.extractDirectDocCandidate(sessionObj, doc) || this.pendingCmdDocHint;
						if (candidate) this.docPathBySession.set(sid, candidate);
					}
					return res;
				},
			);
		}

		if (typeof integration.execCommand === 'function' && !this.unpatchExec) {
			this.unpatchExec = this.kernel.runtime.patch(
				integration,
				'execCommand',
				'Zotero.Integration',
				(orig) => async (...args: unknown[]) => {
					const [, , docId] = args;
					if (typeof docId === 'string' && docId.trim() && docId.trim() !== '__doc__' && !/\.app\/?$/i.test(docId.trim())) {
						this.pendingCmdDocHint = docId.trim();
					}
					this.execDepth++;
					try {
						return await Promise.resolve(orig.apply(integration, args));
					} finally {
						this.execDepth = Math.max(0, this.execDepth - 1);
						this.pendingCmdDocHint = '';
						this.idleRounds = 0;
						if (this.postExecTimer !== null) clearTimeout(this.postExecTimer);
						this.postExecTimer = setTimeout(() => { this.postExecTimer = null; if (this.running) void this.pollOnce().catch((err) => this.kernel.logger.error('word-cite:poll', err)); }, 150) as unknown as number;
					}
				},
			);
		}
	}

	private scheduleNext(): void {
		if (!this.running) return;
		const hasSessions = this.tracker.getAllSessions().length > 0;
		const delay = !hasSessions && this.idleRounds >= 6
			? 12_000
			: this.idleRounds >= 10 ? 5000 : this.idleRounds >= 4 ? 3000 : 1200;
		this.timer = setTimeout(() => {
			this.timer = null;
			if (!this.running) return;
			void this.pollOnce().catch((err) => this.kernel.logger.error('word-cite:poll', err)).finally(() => { if (this.running) this.scheduleNext(); });
		}, delay);
	}
}
