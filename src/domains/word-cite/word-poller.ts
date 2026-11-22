import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { WordSessionTracker } from './session-tracker.ts';

/**
 * Polls Zotero.Integration.sessions with idle backoff and hooks execCommand
 * so active Microsoft Word citations immediately sync to WordSessionTracker
 * and refresh Zotero's itemsView "引用" column.
 */
export class WordIntegrationPoller {
	private timer: number | null = null;
	private viewRefreshTimer: number | null = null;
	private unpatchExec: (() => void) | null = null;
	private running = false;
	private idleRounds = 0;

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
		this.installHooks();
		this.pollOnce();
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
	}

	pollOnce(): boolean {
		const integration = (globalThis as any).Zotero?.Integration;
		const sessionsMap = integration?.sessions;
		if (!sessionsMap) return false;

		const rawSessions: Array<{
			sessionID: string;
			documentPath: string;
			citations: Array<{ itemID: number; ordinal: number; shortText: string }>;
		}> = [];

		const entries: Array<[string, any]> = sessionsMap instanceof Map
			? [...sessionsMap.entries()]
			: Object.entries(sessionsMap);

		for (const [sessionID, session] of entries) {
			if (!session) continue;
			const agent = String(session.agent || 'WinWord');
			if (!/(WinWord|MacWord|Word)/i.test(agent)) continue;

			const ordinalMap = new Map<number, { ordinal: number; shortText: string }>();
			// Prefer citationsByIndex order (1-based appearance order in manuscript)
			const byIndex = session.citationsByIndex;
			if (Array.isArray(byIndex) || (byIndex && typeof byIndex === 'object')) {
				const list = Array.isArray(byIndex) ? byIndex : Object.values(byIndex);
				for (let idx = 0; idx < list.length; idx++) {
					const cit = list[idx];
					const cItems: any[] = Array.isArray(cit?.citationItems) ? cit.citationItems : [];
					const ordinal = Number(cit?.citationIndex ?? cit?.index ?? idx + 1);
					const shortText = String(cit?.properties?.formattedCitation || cit?.text || '').trim();
					for (const ci of cItems) {
						const itemID = Number(ci?.id || ci?.itemID || 0);
						if (!Number.isInteger(itemID) || itemID <= 0) continue;
						if (!ordinalMap.has(itemID)) {
							ordinalMap.set(itemID, { ordinal: ordinal > 0 ? ordinal : idx + 1, shortText });
						}
					}
				}
			}

			// Complement with citationsByItemID (handles direct item lookup)
			const byItem = session.citationsByItemID;
			if (byItem && typeof byItem === 'object') {
				for (const [rawID, list] of Object.entries(byItem)) {
					const itemID = Number(rawID);
					if (!Number.isInteger(itemID) || itemID <= 0 || ordinalMap.has(itemID)) continue;
					const first = Array.isArray(list) ? list[0] : list;
					const ordinal = Number(first?.citationIndex ?? first?.index ?? 1);
					const shortText = String(first?.properties?.formattedCitation || first?.text || '').trim();
					ordinalMap.set(itemID, { ordinal: ordinal > 0 ? ordinal : 1, shortText });
				}
			}

			const citations = [...ordinalMap.entries()].map(([itemID, info]) => ({
				itemID,
				ordinal: info.ordinal,
				shortText: info.shortText,
			}));
			const docPath = String(session.doc?.filePath || session.filePath || session.name || sessionID);
			rawSessions.push({ sessionID: String(sessionID), documentPath: docPath, citations });
		}

		const changed = this.tracker.syncSessions(rawSessions);
		if (changed) {
			this.idleRounds = 0;
			this.scheduleItemsViewRefresh();
		} else {
			this.idleRounds = Math.min(10, this.idleRounds + 1);
		}
		return changed;
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
				try {
					return await Promise.resolve(orig.apply(integration, args));
				} finally {
					this.idleRounds = 0;
					setTimeout(() => { if (this.running) this.pollOnce(); }, 150);
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
			try { this.pollOnce(); } catch (err) { this.kernel.logger.error('word-cite:poll', err); }
			this.scheduleNext();
		}, delay);
	}
}
