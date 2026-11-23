import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { Win32BridgeService } from '../../services/win32-bridge.ts';
import { extractDocumentBaseName, type WordSessionTracker } from './session-tracker.ts';

const VALID_INDEX_KEY_RE = /^(?:0|[1-9]\d*)$/;

/**
 * Polls Zotero.Integration.sessions with idle backoff and hooks getSession/execCommand:
 * - Numeric-sorted citationsByIndex appearance order & per-item true document ordinal (1, 2, 3...).
 * - Torn-snapshot retry and two-read empty snapshot confirmation before pruning citations.
 */
export class WordIntegrationPoller {
	private timer: number | null = null;
	private viewRefreshTimer: number | null = null;
	private unpatchExec: (() => void) | null = null;
	private unpatchGetSession: (() => void) | null = null;
	private running = false;
	private polling = false;
	private execDepth = 0;
	private idleRounds = 0;
	private readonly emptyStreakBySession = new Map<string, number>();
	private readonly docPathBySession = new Map<string, string>();
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
		void this.pollOnce();
		this.scheduleNext();
	}

	stop(): void {
		this.running = false;
		if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
		if (this.viewRefreshTimer !== null) { clearTimeout(this.viewRefreshTimer); this.viewRefreshTimer = null; }
		this.unpatchExec?.();
		this.unpatchExec = null;
		this.unpatchGetSession?.();
		this.unpatchGetSession = null;
		this.emptyStreakBySession.clear();
		this.docPathBySession.clear();
	}

	async notifyCommittedSession(session?: any): Promise<boolean> {
		return this.pollOnce(true, session);
	}

	async pollOnce(allowDuringExec = false, committedSession?: any): Promise<boolean> {
		if (this.polling || (!allowDuringExec && this.execDepth > 0)) return false;
		const integration = (globalThis as any).Zotero?.Integration;
		const sessionsMap = integration?.sessions;
		if (!sessionsMap && !committedSession) return false;

		this.polling = true;
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
				if (!merged.has(sid)) merged.set(sid, committedSession);
			}
			const entries = [...merged.entries()];
			const activeIDs = new Set<string>();
			const rawSessions: Array<{
				sessionID: string;
				documentPath: string;
				citations: Array<{ itemID: number; ordinal: number; shortText: string; occurrences?: number }>;
			}> = [];

			for (const [rawID, session] of entries) {
				if (!session) continue;
				const agent = String(session.agent || 'WinWord');
				if (!/(WinWord|MacWord|Word)/i.test(agent)) continue;
				const sessionID = String(rawID);
				activeIDs.add(sessionID);

				await this.ensureConsistentSnapshot(session);

				const parsed = this.extractSessionCitations(session);
				const prevTracked = this.tracker.getSession(sessionID);

				if (!parsed.length && prevTracked && prevTracked.itemCitations.size > 0) {
					const streak = (this.emptyStreakBySession.get(sessionID) ?? 0) + 1;
					this.emptyStreakBySession.set(sessionID, streak);
					if (streak < 2) {
						rawSessions.push({
							sessionID,
							documentPath: prevTracked.documentPath,
							citations: [...prevTracked.itemCitations.entries()].map(([itemID, info]) => ({
								itemID,
								ordinal: info.ordinal,
								shortText: info.shortText,
								occurrences: info.occurrences,
							})),
						});
						continue;
					}
				} else if (parsed.length > 0) {
					this.emptyStreakBySession.delete(sessionID);
				}

				const docPath = this.resolveSessionDocumentPath(sessionID, session, entries.length);
				rawSessions.push({ sessionID, documentPath: docPath, citations: parsed });
			}

			for (const key of this.emptyStreakBySession.keys()) if (!activeIDs.has(key)) this.emptyStreakBySession.delete(key);
			for (const key of this.docPathBySession.keys()) if (!activeIDs.has(key)) this.docPathBySession.delete(key);

			const changed = this.tracker.syncSessions(rawSessions);
			if (changed) { this.idleRounds = 0; this.scheduleItemsViewRefresh(); }
			else { this.idleRounds = Math.min(10, this.idleRounds + 1); }
			return changed;
		} finally {
			this.polling = false;
		}
	}

	private async ensureConsistentSnapshot(session: any): Promise<void> {
		if (typeof session.updateFromDocument !== 'function') return;
		const byIdx = session.citationsByIndex;
		const byItem = session.citationsByItemID;
		const missingObj = !byIdx || typeof byIdx !== 'object' || !byItem || typeof byItem !== 'object';
		if (missingObj) {
			try { await session.updateFromDocument(0); } catch { /* ignore busy doc */ }
			return;
		}
		const idxEmpty = Object.keys(byIdx).length === 0;
		const itemEmpty = Object.keys(byItem).length === 0;
		if (idxEmpty !== itemEmpty) {
			try { await session.updateFromDocument(0); } catch { /* ignore busy doc */ }
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
			if (typeof c === 'string' && c.trim() && c.trim() !== '__doc__') {
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

		if (this.win32) {
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

	// Extracts unique valid cited items in exact order of appearance across citationsByIndex (1, 2, 3, 4...).
	private extractSessionCitations(session: any): Array<{ itemID: number; ordinal: number; shortText: string; occurrences: number }> {
		const hostItems = (globalThis as any).Zotero?.Items;
		const ordinalMap = new Map<number, { ordinal: number; occurrences: number; labels: string[] }>();
		const trashStatus = new Map<number, boolean>();
		let nextOrdinal = 1;

		const cleanText = (raw: unknown): string =>
			String(raw || '').replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim();

		const isDeletedOrTrashed = (itemID: number): boolean => {
			const cached = trashStatus.get(itemID);
			if (cached !== undefined) return cached;
			const zotItem = hostItems?.get?.(itemID);
			if (!zotItem) { trashStatus.set(itemID, false); return false; }
			const inTrash = typeof zotItem.inTrash === 'function' ? zotItem.inTrash() === true : zotItem.inTrash === true;
			const deleted = zotItem.deleted === true || inTrash;
			trashStatus.set(itemID, deleted);
			return deleted;
		};

		const recordHit = (itemID: number, shortText: unknown, explicitItemOrdinal?: number, countOcc = false) => {
			if (!Number.isSafeInteger(itemID) || itemID <= 0) return;
			if (isDeletedOrTrashed(itemID)) return;

			const label = cleanText(shortText);
			let existing = ordinalMap.get(itemID);
			if (!existing) {
				const assigned = explicitItemOrdinal && explicitItemOrdinal > 0 ? explicitItemOrdinal : nextOrdinal;
				nextOrdinal = Math.max(nextOrdinal + 1, assigned + 1);
				existing = { ordinal: assigned, occurrences: 0, labels: [] };
				ordinalMap.set(itemID, existing);
			}
			if (countOcc) existing.occurrences += 1;
			else if (existing.occurrences === 0) existing.occurrences = 1;
			if (label && !existing.labels.includes(label)) {
				existing.labels.push(label);
			}
		};

		const byIndex = session.citationsByIndex;
		if (byIndex && typeof byIndex === 'object') {
			const sortedKeys = Object.keys(byIndex)
				.filter((k) => VALID_INDEX_KEY_RE.test(k))
				.sort((a, b) => Number(a) - Number(b));

			for (const key of sortedKeys) {
				const cit = byIndex[key];
				const cItems: any[] = Array.isArray(cit?.citationItems) ? cit.citationItems : [];
				const shortText = cit?.properties?.plainCitation ?? cit?.properties?.formattedCitation ?? cit?.text ?? '';
				for (const ci of cItems) {
					const itemID = Number(ci?.id ?? ci?.itemID ?? 0);
					const explicitOrdinal = Number(ci?.ordinal ?? ci?.citationNumber ?? 0);
					recordHit(itemID, shortText, explicitOrdinal > 0 ? explicitOrdinal : undefined, true);
				}
			}
		}

		const byItem = session.citationsByItemID;
		if (byItem && typeof byItem === 'object') {
			for (const [rawID, list] of Object.entries(byItem)) {
				const itemID = Number(rawID);
				const entries = Array.isArray(list) ? list : [list];
				for (const entry of entries) {
					if (!entry) continue;
					const shortText = entry.properties?.plainCitation ?? entry.properties?.formattedCitation ?? entry.text ?? '';
					recordHit(itemID, shortText);
				}
			}
		}

		return [...ordinalMap.entries()].map(([itemID, info]) => ({
			itemID,
			ordinal: info.ordinal,
			shortText: info.labels.join(', '),
			occurrences: info.occurrences,
		}));
	}

	private scheduleItemsViewRefresh(): void {
		if (this.viewRefreshTimer !== null) return;
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
					if (typeof docId === 'string' && docId.trim() && docId.trim() !== '__doc__') {
						this.pendingCmdDocHint = docId.trim();
					}
					this.execDepth++;
					try {
						return await Promise.resolve(orig.apply(integration, args));
					} finally {
						this.execDepth = Math.max(0, this.execDepth - 1);
						this.pendingCmdDocHint = '';
						this.idleRounds = 0;
						setTimeout(() => { if (this.running) void this.pollOnce(); }, 150);
					}
				},
			);
		}
	}

	private scheduleNext(): void {
		if (!this.running) return;
		const delay = this.idleRounds >= 10 ? 5000 : this.idleRounds >= 4 ? 3000 : 1200;
		this.timer = setTimeout(() => {
			this.timer = null;
			if (!this.running) return;
			void this.pollOnce()
				.catch((err) => this.kernel.logger.error('word-cite:poll', err))
				.finally(() => { if (this.running) this.scheduleNext(); });
		}, delay);
	}
}
