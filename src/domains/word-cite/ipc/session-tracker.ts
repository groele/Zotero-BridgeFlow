import type { TypedEventBus } from '../../../kernel/event-bus.ts';
import type { CitationBadgeInfo, CitationSessionSummary, CitationSnapshotPayload, OrphanCitationInfo } from '../../../kernel/types.ts';
import type { Win32BridgeService } from '../../../services/win32-bridge.ts';

export interface WordSessionRecord {
	readonly sessionID: string;
	readonly documentPath: string;
	readonly displayName: string;
	readonly itemCitations: ReadonlyMap<number, { ordinal: number; shortText: string; occurrences?: number }>;
	readonly orphans: readonly OrphanCitationInfo[];
}

interface RawWordSession {
	sessionID: string;
	documentPath: string;
	citations: ReadonlyArray<{ itemID: number; ordinal: number; shortText: string; occurrences?: number }>;
	orphans?: readonly OrphanCitationInfo[];
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
	const groups = new Map<string, typeof sessions[number][]>();
	for (const session of sessions) {
		const base = extractDocumentBaseName(session.path);
		const group = groups.get(base);
		if (group) group.push(session);
		else groups.set(base, [session]);
	}
	const result = new Map<string, string>();
	for (const [base, peers] of groups) {
		for (const session of peers) result.set(session.sessionID, base);
		if (peers.length < 2) continue;
		const unresolved = new Set(peers);
		for (const depth of [1, 2, 3]) {
			const names = peers.map(peer => extractParentQualifier(peer.path, depth));
			const counts = new Map<string, number>();
			for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
			peers.forEach((peer, i) => {
				if (!unresolved.has(peer)) return;
				if (names[i]) result.set(peer.sessionID, `${base} (${names[i]})`);
				if (!names[i] || counts.get(names[i]) === 1) unresolved.delete(peer);
			});
			if (!unresolved.size) break;
		}
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
	private fingerprintedActiveID: string | null = null;
	private firstCitationByItem: Map<number, { ordinal: number; shortText: string }> | null = null;

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

	getSession(id: string): WordSessionRecord | undefined {
		return this.sessions.get(id);
	}

	getAllSessions(): readonly WordSessionRecord[] {
		return [...this.sessions.values()];
	}

	getUnionCitedItemIDs(): Set<number> {
		return new Set(this.fallbackCitations().keys());
	}

	private fallbackCitations() {
		if (!this.firstCitationByItem) {
			const index = new Map<number, { ordinal: number; shortText: string }>();
			for (const session of this.sessions.values()) {
				for (const [id, citation] of session.itemCitations) {
					if (!index.has(id)) index.set(id, citation);
				}
			}
			this.firstCitationByItem = index;
		}
		return this.firstCitationByItem;
	}

	private formatCitationHit(hit?: { ordinal: number; shortText: string }): string {
		if (!hit) return '';
		const prefix = `[${hit.ordinal}]`;
		if (!hit.shortText || hit.shortText === prefix) return prefix;
		return hit.shortText.startsWith(`${prefix} `) ? hit.shortText : `${prefix} ${hit.shortText}`.trim();
	}

	getCitationDisplayForItem(itemID: number, preferredSessionID?: string | null): string {
		if (preferredSessionID && this.sessions.has(preferredSessionID)) {
			return this.formatCitationHit(this.sessions.get(preferredSessionID)!.itemCitations.get(itemID));
		}
		const active = this.getActiveSession();
		if (active) {
			const hit = active.itemCitations.get(itemID);
			if (hit) return this.formatCitationHit(hit);
		}
		return this.sessions.size > 1 ? this.formatCitationHit(this.fallbackCitations().get(itemID)) : '';
	}

	private matchesPreviousInput(input: readonly RawWordSession[]): boolean {
		if (!this.lastFingerprint || input.length !== this.sessions.size) return false;
		const previous = this.sessions.values();
		for (const raw of input) {
			const session = previous.next().value;
			if (!session || session.sessionID !== raw.sessionID || session.documentPath !== raw.documentPath
				|| session.orphans.length || raw.orphans?.length || session.itemCitations.size !== raw.citations.length) return false;
			const entries = session.itemCitations.entries();
			for (const citation of raw.citations) {
				const entry = entries.next().value;
				if (!entry || entry[0] !== citation.itemID) return false;
				const old = entry[1];
				if (old.ordinal !== citation.ordinal || old.shortText !== citation.shortText
					|| old.occurrences !== (citation.occurrences ?? 1)) return false;
			}
		}
		return true;
	}

	/**
	 * Updates tracked sessions from Zotero.Integration snapshots (or test fixtures)
	 * and emits `citation:snapshot-updated` only when the deterministic fingerprint changes.
	 */
	syncSessions(rawSessions: readonly RawWordSession[]): boolean {
		if (this.matchesPreviousInput(rawSessions)) {
			this.syncForegroundActiveSession();
			if (this.activeSessionID === this.fingerprintedActiveID) return false;
			this.recordActiveChange();
			return true;
		}
		const names = disambiguateDocumentNames(
			rawSessions.map((s) => ({ sessionID: s.sessionID, path: s.documentPath })),
		);

		this.sessions.clear();
		for (const raw of rawSessions) {
			const map = new Map<number, { ordinal: number; shortText: string; occurrences?: number }>();
			for (const c of raw.citations) {
				if (!Number.isInteger(c.itemID) || c.itemID <= 0) continue;
				if (!map.has(c.itemID)) {
					map.set(c.itemID, { ordinal: c.ordinal, shortText: c.shortText, occurrences: c.occurrences ?? 1 });
				}
			}
			this.sessions.set(raw.sessionID, {
				sessionID: raw.sessionID,
				documentPath: raw.documentPath,
				displayName: names.get(raw.sessionID) || extractDocumentBaseName(raw.documentPath),
				itemCitations: map,
				orphans: raw.orphans ? [...raw.orphans] : [],
			});
		}

		if (this.activeSessionID && !this.sessions.has(this.activeSessionID)) {
			this.activeSessionID = null;
		}
		if (!this.activeSessionID && rawSessions.length > 0) {
			this.activeSessionID = rawSessions[0].sessionID;
		}

		this.syncForegroundActiveSession();

		this.firstCitationByItem = null;
		const fingerprint = this.computeFingerprint();
		if (fingerprint === this.lastFingerprint) return false;
		this.lastFingerprint = fingerprint;
		this.fingerprintedActiveID = this.activeSessionID;
		this.emitSnapshot();
		return true;
	}

	/**
	 * P1-B Foreground Word Session Sync:
	 * Only switches activeSessionID when the foreground Word title uniquely matches a single session.
	 */
	syncForegroundActiveSession(overrideTitle?: string): boolean {
		if (this.sessions.size <= 1) return false;
		const rawFg = (overrideTitle ?? this.win32.probeForegroundWordTitle()).trim();
		if (!rawFg) return false;
		const docExtRe = /\.(?:docx|docm|doc|dotx|dotm|rtf|odt)$/i;
		const fgBase = extractDocumentBaseName(`window-title:${rawFg}`).toLowerCase();
		const fgStem = fgBase.replace(docExtRe, '');
		const fgLower = rawFg.toLowerCase();
		const exactMatches: string[] = [];
		const fuzzyMatches: string[] = [];
		for (const ses of this.sessions.values()) {
			const base = extractDocumentBaseName(ses.documentPath).toLowerCase();
			const stem = base.replace(docExtRe, '');
			if (!base) continue;
			if (fgBase === base || fgBase === stem || (fgStem && fgStem === stem)) {
				exactMatches.push(ses.sessionID);
			} else if (fgLower.includes(base) || (stem && fgLower.includes(stem))) {
				fuzzyMatches.push(ses.sessionID);
			}
		}
		const matches = exactMatches.length > 0 ? exactMatches : fuzzyMatches;
		if (matches.length !== 1) return false;
		if (this.activeSessionID === matches[0]) return false;
		this.activeSessionID = matches[0];
		return true;
	}

	setActiveSession(sessionID: string): boolean {
		if (!sessionID || !this.sessions.has(sessionID)) return false;
		if (this.activeSessionID === sessionID) return false;
		this.activeSessionID = sessionID;
		this.recordActiveChange();
		return true;
	}

	private recordActiveChange(): void {
		this.lastFingerprint = this.computeFingerprint();
		this.fingerprintedActiveID = this.activeSessionID;
		this.emitSnapshot();
	}

	emitCurrentSnapshot(): void {
		this.emitSnapshot();
	}

	clear(): void {
		this.sessions.clear();
		this.firstCitationByItem = null;
		this.activeSessionID = null;
		this.lastFingerprint = '';
		this.emitSnapshot();
	}

	private computeFingerprint(): string {
		const sessions = [...this.sessions.values()].map(session => [
			session.sessionID, session.documentPath, session.displayName,
			[...session.itemCitations.entries()].sort((a, b) => a[0] - b[0]),
			session.orphans.map(o => [o.key, o.kind, o.ordinal, o.shortText, o.title, o.authorYear, o.itemID, o.uris, o.itemData]),
		]);
		return JSON.stringify([this.activeSessionID, sessions]);
	}

	private emitSnapshot(): void {
		const active = this.getActiveSession();
		const sessions: CitationSessionSummary[] = [];
		let activeByItemID = new Map<number, CitationBadgeInfo>();
		const citedItemIDs: number[] = [];

		for (const ses of this.sessions.values()) {
			const map = new Map<number, CitationBadgeInfo>();
			for (const [itemID, info] of ses.itemCitations.entries()) {
				map.set(itemID, {
					itemID,
					ordinal: info.ordinal,
					occurrences: info.occurrences ?? 1,
					shortText: info.shortText,
					documentName: ses.displayName,
					sessionID: ses.sessionID,
				});
				if (ses.sessionID === active?.sessionID) citedItemIDs.push(itemID);
			}
			if (ses.sessionID === active?.sessionID) activeByItemID = map;
			sessions.push({
				sessionID: ses.sessionID,
				documentName: ses.displayName,
				totalCitedCount: map.size,
				byItemID: map,
				orphans: ses.orphans,
			});
		}

		const payload: CitationSnapshotPayload = {
			activeSessionID: active?.sessionID ?? null,
			activeDocumentName: active?.displayName ?? '',
			byItemID: activeByItemID,
			citedItemIDs,
			totalCitedCount: activeByItemID.size,
			sessions,
			orphans: active?.orphans ?? [],
		};
		this.bus.emit('citation:snapshot-updated', payload);
	}
}
