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
	let cleaned = String(rawPath || '').replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim();
	if (!cleaned || cleaned === '__doc__') return 'Untitled Word Document';
	cleaned = cleaned.replace(/^(["'])(.*)\1$/, '$2').trim();
	if (cleaned.startsWith('window-title:')) {
		cleaned = cleaned.slice('window-title:'.length).trim();
	}
	const wordSuffixRe = /\s+[-–—]\s+(?:Microsoft\s+)?Word(?:\s*\([^)]*\))?$/i;
	if (wordSuffixRe.test(cleaned)) {
		cleaned = cleaned.replace(wordSuffixRe, '').trim();
	}
	const isURL = /^[a-z][a-z0-9+.-]*:\/\//i.test(cleaned);
	if (isURL && /(?:\/|^)(?:Doc|WopiFrame2?|redir)\.aspx(?:\?|$)/i.test(cleaned)) {
		const fileParam = cleaned.match(/[?&](?:file|filename|name)=([^&#]+)/i);
		if (fileParam?.[1]) {
			try {
				const decoded = decodeURIComponent(fileParam[1].replace(/\+/g, '%20')).trim();
				if (decoded && !/[\\/]/.test(decoded)) cleaned = decoded;
			} catch { /* fall through */ }
		}
	}
	const withoutQuery = isURL ? cleaned.replace(/[?#].*$/, '') : cleaned;
	const parts = withoutQuery.split(/[\\/]/).filter(Boolean);
	let candidate = parts[parts.length - 1] || cleaned;
	if (isURL || /%[0-9A-Fa-f]{2}/.test(candidate)) {
		try {
			candidate = decodeURIComponent(candidate);
		} catch { /* keep raw */ }
	}
	const extMatch = candidate.match(/^(.+?\.(?:docx|docm|doc|dotx|dotm|rtf|odt))(?:\s*\[[^\]]*\]|\s+[-–—]\s+.*)*$/i);
	if (extMatch) {
		candidate = extMatch[1].trim();
	} else {
		const statusRe = /(?:\s*\[(?:兼容模式|Compatibility Mode|只读|Read-Only|受保护的视图|Protected View|自动保存|AutoSave)[^\]]*\]|\s+[-–—]\s+(?:已保存.*|正在保存.*|上次保存.*|只读|兼容模式|受保护的视图|未保存|Saved.*|Saving.*|Last saved.*|Read-Only|Compatibility Mode|Protected View|Unsaved))\s*$/i;
		let prev = '';
		while (candidate && candidate !== prev) {
			prev = candidate;
			candidate = candidate.replace(statusRe, '').trim();
		}
	}
	return (candidate || 'Untitled Word Document').slice(0, 200);
}

function extractParentQualifier(rawPath: string, depth = 1): string {
	const trimmed = String(rawPath || '').trim();
	if (!trimmed || trimmed.startsWith('window-title:')) return '';
	const clean = trimmed.replace(/[?#].*$/, '');
	const parts = clean.split(/[\\/]+/).filter(Boolean);
	const parents = parts.slice(0, -1).filter((p) => !/^[A-Za-z]:$/.test(p) && !/^[a-z]+:$/i.test(p));
	return parents.length ? parents.slice(-depth).join('/') : '';
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
		const peers = sessions.filter((p) => p.sessionID !== s.sessionID && extractDocumentBaseName(p.path) === base);
		let qualified = base;
		for (const depth of [1, 2, 3]) {
			const own = extractParentQualifier(s.path, depth);
			if (!own) break;
			if (peers.every((p) => extractParentQualifier(p.path, depth) !== own)) {
				qualified = `${base} (${own})`;
				break;
			}
			qualified = `${base} (${own})`;
		}
		result.set(s.sessionID, qualified);
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

	getCitationDisplayForItem(itemID: number, preferredSessionID?: string | null): string {
		if (preferredSessionID && this.sessions.has(preferredSessionID)) {
			const prefSes = this.sessions.get(preferredSessionID)!;
			const hit = prefSes.itemCitations.get(itemID);
			return hit ? `[${hit.ordinal}] ${hit.shortText}`.trim() : '';
		}
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
