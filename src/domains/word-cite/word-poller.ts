import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { WordSessionTracker } from './session-tracker.ts';

const VALID_INDEX_KEY_RE = /^(?:0|[1-9]\d*)$/;

/**
 * Polls Zotero.Integration.sessions with idle backoff and hooks execCommand:
 * - Numeric-sorted citationsByIndex appearance order (0-based keys sorted cleanly).
 * - Multi-occurrence ordinal & CSL plainCitation display, excluding trashed/deleted items.
 * - Two-read empty snapshot confirmation before pruning active session citations.
 */
export class WordIntegrationPoller {
	private timer: number | null = null;
	private viewRefreshTimer: number | null = null;
	private unpatchExec: (() => void) | null = null;
	private running = false;
	private polling = false;
	private execDepth = 0;
	private idleRounds = 0;
	private readonly emptyStreakBySession = new Map<string, number>();

	private readonly kernel: PluginKernel;
	private readonly tracker: WordSessionTracker;

	constructor(kernel: PluginKernel, tracker: WordSessionTracker) {
		this.kernel = kernel;
		this.tracker = tracker;
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
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		if (this.viewRefreshTimer !== null) {
			clearTimeout(this.viewRefreshTimer);
			this.viewRefreshTimer = null;
		}
		this.unpatchExec?.();
		this.unpatchExec = null;
		this.emptyStreakBySession.clear();
	}

	async pollOnce(): Promise<boolean> {
		if (this.polling || this.execDepth > 0) return false;
		const integration = (globalThis as any).Zotero?.Integration;
		const sessionsMap = integration?.sessions;
		if (!sessionsMap) return false;

		this.polling = true;
		try {
			const entries: Array<[string, any]> = sessionsMap instanceof Map
				? [...sessionsMap.entries()]
				: Object.entries(sessionsMap);
			const activeIDs = new Set<string>();
			const rawSessions: Array<{
				sessionID: string;
				documentPath: string;
				citations: Array<{ itemID: number; ordinal: number; shortText: string }>;
			}> = [];

			for (const [sessionID, session] of entries) {
				if (!session) continue;
				const agent = String(session.agent || 'WinWord');
				if (!/(WinWord|MacWord|Word)/i.test(agent)) continue;
				activeIDs.add(String(sessionID));

				if ((!session.citationsByIndex || !session.citationsByItemID) && typeof session.updateFromDocument === 'function') {
					try { await session.updateFromDocument(0); } catch { /* ignore transiently busy doc */ }
				}

				const parsed = this.extractSessionCitations(session);
				const prevTracked = this.tracker.getAllSessions().find((s) => s.sessionID === String(sessionID));

				if (!parsed.length && prevTracked && prevTracked.itemCitations.size > 0) {
					const streak = (this.emptyStreakBySession.get(sessionID) ?? 0) + 1;
					this.emptyStreakBySession.set(sessionID, streak);
					if (streak < 2) {
						// Preserve prior snapshot across single transient empty read
						rawSessions.push({
							sessionID: String(sessionID),
							documentPath: prevTracked.documentPath,
							citations: [...prevTracked.itemCitations.entries()].map(([itemID, info]) => ({
								itemID,
								ordinal: info.ordinal,
								shortText: info.shortText,
							})),
						});
						continue;
					}
				} else if (parsed.length > 0) {
					this.emptyStreakBySession.delete(sessionID);
				}

				const docPath = String(
					session.doc?.filePath
					|| session.filePath
					|| session.documentPath
					|| session.doc?._docId
					|| session.name
					|| sessionID,
				);
				rawSessions.push({ sessionID: String(sessionID), documentPath: docPath, citations: parsed });
			}

			for (const key of this.emptyStreakBySession.keys()) {
				if (!activeIDs.has(key)) this.emptyStreakBySession.delete(key);
			}

			const changed = this.tracker.syncSessions(rawSessions);
			if (changed) {
				this.idleRounds = 0;
				this.scheduleItemsViewRefresh();
			} else {
				this.idleRounds = Math.min(10, this.idleRounds + 1);
			}
			return changed;
		} finally {
			this.polling = false;
		}
	}

	private extractSessionCitations(session: any): Array<{ itemID: number; ordinal: number; shortText: string }> {
		const hostItems = (globalThis as any).Zotero?.Items;
		const ordinalMap = new Map<number, { ordinal: number; ordinals: number[]; shortText: string }>();

		const recordHit = (itemID: number, ordinal: number, shortText: string) => {
			if (!Number.isSafeInteger(itemID) || itemID <= 0) return;
			const zotItem = hostItems?.get?.(itemID);
			if (zotItem && (zotItem.deleted === true || zotItem.inTrash?.() === true)) return;

			const existing = ordinalMap.get(itemID);
			if (!existing) {
				ordinalMap.set(itemID, { ordinal, ordinals: [ordinal], shortText });
			} else {
				if (!existing.ordinals.includes(ordinal)) existing.ordinals.push(ordinal);
				if (!existing.shortText && shortText) existing.shortText = shortText;
			}
		};

		const byIndex = session.citationsByIndex;
		if (byIndex && typeof byIndex === 'object') {
			const sortedKeys = Object.keys(byIndex)
				.filter((k) => VALID_INDEX_KEY_RE.test(k))
				.sort((a, b) => Number(a) - Number(b));

			for (let idx = 0; idx < sortedKeys.length; idx++) {
				const cit = byIndex[sortedKeys[idx]];
				const cItems: any[] = Array.isArray(cit?.citationItems) ? cit.citationItems : [];
				const rawOrdinal = Number(cit?.citationIndex ?? cit?.index ?? (Number(sortedKeys[idx]) + 1));
				const ordinal = rawOrdinal > 0 ? rawOrdinal : idx + 1;
				const shortText = String(cit?.properties?.plainCitation || cit?.properties?.formattedCitation || cit?.text || '').trim();
				for (const ci of cItems) {
					recordHit(Number(ci?.id || ci?.itemID || 0), ordinal, shortText);
				}
			}
		}

		const byItem = session.citationsByItemID;
		if (byItem && typeof byItem === 'object') {
			for (const [rawID, list] of Object.entries(byItem)) {
				const itemID = Number(rawID);
				if (ordinalMap.has(itemID)) continue;
				const entries = Array.isArray(list) ? list : [list];
				for (const entry of entries) {
					if (!entry) continue;
					const ordinal = Number(entry.citationIndex ?? entry.index ?? 1);
					const shortText = String(entry.properties?.plainCitation || entry.properties?.formattedCitation || entry.text || '').trim();
					recordHit(itemID, ordinal > 0 ? ordinal : 1, shortText);
				}
			}
		}

		return [...ordinalMap.entries()].map(([itemID, info]) => {
			const extraRefs = info.ordinals.length > 1 ? ` (${info.ordinals.join(',')})` : '';
			const cleanShort = info.shortText || '';
			return {
				itemID,
				ordinal: info.ordinal,
				shortText: cleanShort ? `${cleanShort}${extraRefs}` : extraRefs.trim(),
			};
		});
	}

	private scheduleItemsViewRefresh(): void {
		if (this.viewRefreshTimer !== null) return;
		const delay = this.kernel.prefs.get('wordCite.itemsViewRefreshDebounceMs');
		this.viewRefreshTimer = setTimeout(() => {
			this.viewRefreshTimer = null;
			const wins: Window[] = (globalThis as any).Zotero?.getMainWindows?.() || [];
			for (const win of wins) {
				try {
					(win as any).ZoteroPane?.itemsView?.refresh?.();
				} catch { /* ignore */ }
			}
		}, Math.max(20, delay));
	}

	private installHooks(): void {
		const integration = (globalThis as any).Zotero?.Integration;
		if (!integration || typeof integration.execCommand !== 'function' || this.unpatchExec) return;
		this.unpatchExec = this.kernel.runtime.patch(
			integration,
			'execCommand',
			'Zotero.Integration',
			(orig) => async (...args: unknown[]) => {
				this.execDepth++;
				try {
					return await Promise.resolve(orig.apply(integration, args));
				} finally {
					this.execDepth = Math.max(0, this.execDepth - 1);
					this.idleRounds = 0;
					setTimeout(() => { if (this.running) void this.pollOnce(); }, 150);
				}
			},
		);
	}

	private scheduleNext(): void {
		if (!this.running) return;
		const delay = this.idleRounds >= 5 ? 3000 : 1200;
		this.timer = setTimeout(() => {
			this.timer = null;
			if (!this.running) return;
			void this.pollOnce()
				.catch((err) => this.kernel.logger.error('word-cite:poll', err))
				.finally(() => { if (this.running) this.scheduleNext(); });
		}, delay);
	}
}
