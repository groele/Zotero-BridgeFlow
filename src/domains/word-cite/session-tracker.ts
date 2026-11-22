import type { TypedEventBus } from '../../kernel/event-bus.ts';
import type { CitationBadgeInfo, CitationSnapshotPayload } from '../../kernel/types.ts';
import type { Win32BridgeService } from '../../services/win32-bridge.ts';

export interface WordSessionRecord {
	readonly sessionID: string;
	readonly documentPath: string;
	readonly displayName: string;
	readonly itemCitations: ReadonlyMap<number, { ordinal: number; shortText: string }>;
}

export function extractDocumentBaseName(rawPath: string): string {
	const cleaned = String(rawPath || '').trim();
	if (!cleaned) return 'Untitled Word Document';
	const parts = cleaned.split(/[\\/]/).filter(Boolean);
	return parts[parts.length - 1] || cleaned;
}

export function disambiguateDocumentNames(sessions: readonly { sessionID: string; path: string }[]): Map<string, string> {
	const baseCounts = new Map<string, number>();
	for (const s of sessions) {
		const base = extractDocumentBaseName(s.path);
		baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
	}
	const result = new Map<string, string>();
	for (const s of sessions) {
		const base = extractDocumentBaseName(s.path);
		if ((baseCounts.get(base) ?? 0) <= 1) {
			result.set(s.sessionID, base);
			continue;
		}
		const segments = s.path.split(/[\\/]/).filter(Boolean);
		const parent = segments.length >= 2 ? segments[segments.length - 2] : '';
		result.set(s.sessionID, parent ? `${base} (${parent})` : base);
	}
	return result;
}

/**
 * Tracks active Microsoft Word Zotero.Integration sessions, performs P1-B unique
 * foreground title matching, computes dirty fingerprints, and broadcasts immutable snapshots.
 */
export class WordSessionTracker {
	private readonly sessions = new Map<string, WordSessionRecord>();
	private activeSessionID: string | null = null;
	private lastFingerprint = '';

	private readonly bus: TypedEventBus;
	private readonly win32: Win32BridgeService;

	constructor(bus: TypedEventBus, win32: Win32BridgeService) {
		this.bus = bus;
		this.win32 = win32;
	}

	getActiveSession(): WordSessionRecord | null {
		if (!this.activeSessionID) return null;
		return this.sessions.get(this.activeSessionID) ?? null;
	}

	getAllSessions(): readonly WordSessionRecord[] {
		return [...this.sessions.values()];
	}

	getUnionCitedItemIDs(): Set<number> {
		const union = new Set<number>();
		for (const ses of this.sessions.values()) {
			for (const itemID of ses.itemCitations.keys()) {
				union.add(itemID);
			}
		}
		return union;
	}

	getCitationDisplayForItem(itemID: number): string {
		const active = this.getActiveSession();
		if (active) {
			const hit = active.itemCitations.get(itemID);
			if (hit) return `[${hit.ordinal}] ${hit.shortText}`.trim();
		}
		for (const ses of this.sessions.values()) {
			const hit = ses.itemCitations.get(itemID);
			if (hit) return `[${hit.ordinal}] ${hit.shortText}`.trim();
		}
		return '';
	}

	/**
	 * Updates tracked sessions from Zotero.Integration snapshots (or test fixtures)
	 * and emits `citation:snapshot-updated` only when the deterministic fingerprint changes.
	 */
	syncSessions(rawSessions: readonly {
		sessionID: string;
		documentPath: string;
		citations: ReadonlyArray<{ itemID: number; ordinal: number; shortText: string }>;
	}[]): boolean {
		const names = disambiguateDocumentNames(
			rawSessions.map((s) => ({ sessionID: s.sessionID, path: s.documentPath })),
		);

		this.sessions.clear();
		for (const raw of rawSessions) {
			const map = new Map<number, { ordinal: number; shortText: string }>();
			for (const c of raw.citations) {
				if (!Number.isInteger(c.itemID) || c.itemID <= 0) continue;
				if (!map.has(c.itemID)) {
					map.set(c.itemID, { ordinal: c.ordinal, shortText: c.shortText });
				}
			}
			this.sessions.set(raw.sessionID, {
				sessionID: raw.sessionID,
				documentPath: raw.documentPath,
				displayName: names.get(raw.sessionID) || extractDocumentBaseName(raw.documentPath),
				itemCitations: map,
			});
		}

		if (this.activeSessionID && !this.sessions.has(this.activeSessionID)) {
			this.activeSessionID = null;
		}
		if (!this.activeSessionID && rawSessions.length > 0) {
			this.activeSessionID = rawSessions[0].sessionID;
		}

		this.syncForegroundActiveSession();

		const fingerprint = this.computeFingerprint();
		if (fingerprint === this.lastFingerprint) return false;
		this.lastFingerprint = fingerprint;
		this.emitSnapshot();
		return true;
	}

	/**
	 * P1-B Foreground Word Session Sync:
	 * Only switches activeSessionID when the foreground Word title uniquely matches a single session.
	 */
	syncForegroundActiveSession(overrideTitle?: string): boolean {
		const fgTitle = (overrideTitle ?? this.win32.probeForegroundWordTitle()).trim().toLowerCase();
		if (!fgTitle || this.sessions.size === 0) return false;
		const matches: string[] = [];
		for (const ses of this.sessions.values()) {
			const base = extractDocumentBaseName(ses.documentPath).toLowerCase();
			const stem = base.replace(/\.(docx?|rtf)$/i, '');
			if (base && (fgTitle.includes(base) || (stem && fgTitle.includes(stem)))) {
				matches.push(ses.sessionID);
			}
		}
		if (matches.length !== 1) return false;
		if (this.activeSessionID === matches[0]) return false;
		this.activeSessionID = matches[0];
		return true;
	}

	clear(): void {
		this.sessions.clear();
		this.activeSessionID = null;
		this.lastFingerprint = '';
		this.emitSnapshot();
	}

	private computeFingerprint(): string {
		const parts: string[] = [`active=${this.activeSessionID || ''}`];
		for (const ses of this.sessions.values()) {
			const items = [...ses.itemCitations.entries()]
				.sort((a, b) => a[0] - b[0])
				.map(([id, c]) => `${id}:${c.ordinal}:${c.shortText}`)
				.join(',');
			parts.push(`${ses.sessionID}|${ses.displayName}|${items}`);
		}
		return parts.join(';');
	}

	private emitSnapshot(): void {
		const active = this.getActiveSession();
		const byItemID = new Map<number, CitationBadgeInfo>();
		const citedItemIDs: number[] = [];
		if (active) {
			for (const [itemID, info] of active.itemCitations.entries()) {
				byItemID.set(itemID, {
					itemID,
					ordinal: info.ordinal,
					shortText: info.shortText,
					documentName: active.displayName,
					sessionID: active.sessionID,
				});
				citedItemIDs.push(itemID);
			}
		}
		const payload: CitationSnapshotPayload = {
			activeSessionID: active?.sessionID ?? null,
			activeDocumentName: active?.displayName ?? '',
			byItemID,
			citedItemIDs,
		};
		this.bus.emit('citation:snapshot-updated', payload);
	}
}
