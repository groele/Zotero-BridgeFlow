import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { WordSessionTracker } from './session-tracker.ts';

/**
 * Polls Zotero.Integration.sessions with idle backoff and hooks execCommand
 * so active Microsoft Word citations immediately sync to WordSessionTracker.
 */
export class WordIntegrationPoller {
	private timer: number | null = null;
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
			const citations: Array<{ itemID: number; ordinal: number; shortText: string }> = [];
			const byItem = session.citationsByItemID;
			if (byItem && typeof byItem === 'object') {
				for (const [rawID, list] of Object.entries(byItem)) {
					const itemID = Number(rawID);
					if (!Number.isInteger(itemID) || itemID <= 0) continue;
					const first = Array.isArray(list) ? list[0] : list;
					const ordinal = Number(first?.citationIndex ?? first?.index ?? 1);
					const shortText = String(first?.properties?.formattedCitation || first?.text || '').trim();
					citations.push({ itemID, ordinal, shortText });
				}
			}
			const docPath = String(session.doc?.filePath || session.filePath || session.name || sessionID);
			rawSessions.push({ sessionID: String(sessionID), documentPath: docPath, citations });
		}

		const changed = this.tracker.syncSessions(rawSessions);
		if (changed) this.idleRounds = 0;
		else this.idleRounds = Math.min(10, this.idleRounds + 1);
		return changed;
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
