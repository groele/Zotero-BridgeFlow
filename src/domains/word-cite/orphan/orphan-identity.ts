import type { OrphanCitationInfo } from '../../../kernel/types.ts';

export function cleanCitationText(raw: unknown): string {
	return String(raw || '').replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeDoi(raw: unknown): string {
	return String(raw ?? '')
		.trim()
		.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
		.replace(/^doi:\s*/i, '')
		.toLowerCase();
}

function normalizeMetaToken(raw: unknown): string {
	return String(raw ?? '')
		.toLowerCase()
		.replace(/[\u0000-\u001F\u007F]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function extractCitationItemUris(ci: any): string[] {
	const rawList: unknown[] = [];
	if (Array.isArray(ci?.uris)) rawList.push(...ci.uris);
	if (ci?.uri !== undefined && ci?.uri !== null) rawList.push(ci.uri);
	const seen = new Set<string>();
	const out: string[] = [];
	for (const entry of rawList) {
		const trimmed = String(entry || '').trim();
		if (trimmed && !seen.has(trimmed)) {
			seen.add(trimmed);
			out.push(trimmed);
		}
	}
	return out;
}

export function extractFirstAuthorAndYear(itemData: Record<string, unknown> | undefined): { author: string; year: string } {
	if (!itemData) return { author: '', year: '' };
	const authors = Array.isArray(itemData.author) ? itemData.author : Array.isArray(itemData.editor) ? itemData.editor : [];
	const first = authors[0] as Record<string, unknown> | undefined;
	const author = String(first?.family || first?.literal || first?.given || '').trim();
	const issued = itemData.issued as { 'date-parts'?: unknown[][]; literal?: string; raw?: string } | undefined;
	const yearPart = issued?.['date-parts']?.[0]?.[0] ?? issued?.literal ?? issued?.raw ?? '';
	const year = String(yearPart || '').match(/\d{4}/)?.[0] || '';
	return { author, year };
}

export function formatCslAuthorYear(itemData: Record<string, unknown> | undefined): string {
	const { author, year } = extractFirstAuthorAndYear(itemData);
	return [author, year].filter(Boolean).join(', ');
}

function isEphemeralSurrogateId(rawId: string, sessionID: string): boolean {
	if (!rawId) return true;
	const lower = rawId.toLowerCase();
	if (lower === 'undefined' || lower === 'null' || lower === 'false') return true;
	if (rawId.includes('/')) return true;
	if (sessionID && rawId.startsWith(sessionID)) return true;
	return false;
}

export interface OrphanIdentity {
	key: string;
	doi: string;
	fpAlias: string;
	aliases: string[];
}

export function buildOrphanIdentity(
	itemID: number,
	uris: readonly string[],
	itemData: Record<string, unknown> | undefined,
	sessionID: string,
	fallbackText: string,
): OrphanIdentity {
	const doi = normalizeDoi(itemData?.DOI);
	const rawCslId = itemData?.id !== undefined && itemData?.id !== null ? String(itemData.id).trim() : '';
	const stableCslId = rawCslId && !isEphemeralSurrogateId(rawCslId, sessionID) ? rawCslId : '';
	const { author, year } = extractFirstAuthorAndYear(itemData);
	const normTitle = normalizeMetaToken(itemData?.title || itemData?.['container-title']);
	const fpAlias = normTitle && author && year ? `fp:${normTitle}|${normalizeMetaToken(author)}|${year}` : '';

	let key = '';
	if (Number.isSafeInteger(itemID) && itemID > 0) key = `id:${itemID}`;
	else if (uris.length > 0) key = `uri:${uris[0]}`;
	else if (doi) key = `doi:${doi}`;
	else if (stableCslId) key = `csl:${stableCslId}`;
	else if (fpAlias) key = fpAlias;
	else key = `raw:${fallbackText || 'unknown'}`;

	const aliases: string[] = [];
	if (Number.isSafeInteger(itemID) && itemID > 0) aliases.push(`id:${itemID}`);
	for (const uri of uris) aliases.push(`uri:${uri}`);
	if (doi) aliases.push(`doi:${doi}`);
	if (stableCslId) aliases.push(`csl:${stableCslId}`);

	return { key, doi, fpAlias, aliases };
}

export function isForeignUserItemUri(uri: string, zoteroObj: any): boolean {
	const clean = String(uri || '').trim().replace(/[?#].*$/, '').replace(/^https:\/\/zotero\.org\//i, 'http://zotero.org/').replace(/\/+$/, '');
	const match = clean.match(/^http:\/\/zotero\.org\/(?:users\/local\/([A-Za-z0-9_-]+)|users\/(\d+)|groups\/(\d+))\/items\/([A-Za-z0-9_-]+)$/i);
	if (!match) return true;
	const [, localKey, userId, groupId] = match;
	if (userId) {
		const currentUid = typeof zoteroObj?.Users?.getCurrentUserID === 'function'
			? String(zoteroObj.Users.getCurrentUserID() || '').trim()
			: '';
		return !currentUid || userId !== currentUid;
	}
	if (localKey) {
		const ownLocal = typeof zoteroObj?.Users?.getLocalUserKey === 'function'
			? String(zoteroObj.Users.getLocalUserKey() || '').trim()
			: '';
		return !ownLocal || localKey !== ownLocal;
	}
	if (groupId) {
		if (typeof zoteroObj?.Groups?.getLibraryIDFromGroupID === 'function') {
			const libId = Number(zoteroObj.Groups.getLibraryIDFromGroupID(Number(groupId)) ?? 0);
			return !(Number.isSafeInteger(libId) && libId > 0);
		}
		return typeof zoteroObj?.URI?.getURIItemID !== 'function' && typeof zoteroObj?.URI?.getURIItemLibraryKey !== 'function';
	}
	return true;
}

const relinkedUriMap = new Map<string, number>();

export function rememberRelinkedItemUris(uris: readonly string[], itemID: number): void {
	if (!Number.isSafeInteger(itemID) || itemID <= 0) return;
	for (const raw of uris) {
		const norm = String(raw || '').trim().replace(/^https:\/\/zotero\.org\//i, 'http://zotero.org/').replace(/\/+$/, '');
		if (norm) relinkedUriMap.set(norm, itemID);
	}
}

export function clearRelinkedItemUris(): void {
	relinkedUriMap.clear();
}

export function resolveItemIdFromUris(uris: readonly string[], zoteroObj: any, hostItems: any): number {
	if (!uris.length || !hostItems) return 0;
	const uriSvc = zoteroObj?.URI;
	for (const uri of uris) {
		if (!uri) continue;
		const norm = uri.trim().replace(/[?#].*$/, '').replace(/^https:\/\/zotero\.org\//i, 'http://zotero.org/').replace(/\/+$/, '');
		const mapped = relinkedUriMap.get(norm);
		if (mapped && hostItems.get?.(mapped)) return mapped;
		if (isForeignUserItemUri(uri, zoteroObj)) continue;
		try {
			if (typeof uriSvc?.getURIItemID === 'function') {
				const id = Number(uriSvc.getURIItemID(uri));
				if (Number.isSafeInteger(id) && id > 0) return id;
			}
			if (typeof uriSvc?.getURIItemLibraryKey === 'function') {
				const parsed = uriSvc.getURIItemLibraryKey(uri);
				if (parsed && parsed.libraryID != null && parsed.key) {
					if (typeof hostItems.getIDFromLibraryAndKey === 'function') {
						const id = Number(hostItems.getIDFromLibraryAndKey(parsed.libraryID, parsed.key));
						if (Number.isSafeInteger(id) && id > 0) return id;
					}
					if (typeof hostItems.getByLibraryAndKey === 'function') {
						const item = hostItems.getByLibraryAndKey(parsed.libraryID, parsed.key);
						const id = Number(item?.id || 0);
						if (Number.isSafeInteger(id) && id > 0) return id;
					}
				}
			}
		} catch { /* ignore malformed or unknown URI */ }
	}
	return 0;
}

/**
 * Classifies orphan citation URIs against the recovered Zotero item's library & signed-in account.
 * Returns only same-owner/same-editable-group URIs normalized for Zotero Cloud Sync,
 * skipping any foreign co-author or cross-library URIs so sync never fails or conflicts.
 */
export function classifySyncSafeRelinkUris(
	uris: readonly string[] | undefined,
	targetLibraryID: number,
	userLibraryID: number,
	zoteroObj: any,
): { safeUris: string[]; foreignSkipped: boolean } {
	const safeUris: string[] = [];
	const seen = new Set<string>();
	let foreignSkipped = false;
	if (!uris?.length) return { safeUris, foreignSkipped };

	const hasUsersApi = typeof zoteroObj?.Users?.getCurrentUserID === 'function';
	const currentUid = hasUsersApi ? String(zoteroObj.Users.getCurrentUserID() || '').trim() : '';
	const hasLocalKeyApi = typeof zoteroObj?.Users?.getLocalUserKey === 'function';
	const ownLocalKey = hasLocalKeyApi ? String(zoteroObj.Users.getLocalUserKey() || '').trim() : '';

	const pushSafe = (uri: string) => {
		if (uri && !seen.has(uri)) {
			seen.add(uri);
			safeUris.push(uri);
		}
	};

	for (const raw of uris) {
		const trimmed = String(raw || '').trim().replace(/^https:\/\/zotero\.org\//i, 'http://zotero.org/').replace(/\/+$/, '');
		const match = trimmed.match(/^http:\/\/zotero\.org\/(?:users\/local\/([A-Za-z0-9]+)|users\/(\d+)|groups\/(\d+))\/items\/([A-Za-z0-9]+)$/i);
		if (!match) continue;
		const [, localKey, userId, groupId, itemKey] = match;

		if (groupId) {
			const groupLibId = Number(zoteroObj?.Groups?.getLibraryIDFromGroupID?.(Number(groupId)) ?? 0);
			const editable = groupLibId > 0 && zoteroObj?.Libraries?.get?.(groupLibId)?.editable === true;
			if (groupLibId === targetLibraryID && editable) {
				pushSafe(`http://zotero.org/groups/${groupId}/items/${itemKey}`);
			} else {
				foreignSkipped = true;
			}
			continue;
		}

		if (targetLibraryID !== userLibraryID) {
			foreignSkipped = true;
			continue;
		}

		if (userId) {
			if (currentUid && userId === currentUid) {
				pushSafe(`http://zotero.org/users/${userId}/items/${itemKey}`);
			} else {
				foreignSkipped = true;
			}
			continue;
		}

		if (localKey) {
			if (!ownLocalKey || localKey !== ownLocalKey) {
				foreignSkipped = true;
			} else if (currentUid) {
				pushSafe(`http://zotero.org/users/${currentUid}/items/${itemKey}`);
			} else {
				pushSafe(`http://zotero.org/users/local/${localKey}/items/${itemKey}`);
			}
		}
	}

	return { safeUris, foreignSkipped };
}

/**
 * Reads sorted bibliography sequence numbers from citeproc-js (`session.style.registry`)
 * when available without mutating processor state.
 */
export function resolveCiteprocOrdinalMap(session: any): Map<string, number> {
	const ordinals = new Map<string, number>();
	const style = session?.style;
	const regObj = style?.registry;
	if (!regObj || typeof regObj !== 'object') return ordinals;

	const descDir = style?.bibliography_sort?.opt?.citation_number_sort_direction;
	const descMap = descDir ? style?.bibliography_sort?.tmp?.citation_number_map : undefined;
	const normalizeSeq = (rawSeq: unknown): number => {
		const seq = Number(rawSeq);
		if (!Number.isSafeInteger(seq) || seq <= 0) return 0;
		const mapped = descMap && descMap[seq] !== undefined ? Number(descMap[seq]) : seq;
		return Number.isSafeInteger(mapped) && mapped > 0 ? mapped : seq;
	};

	const reg = regObj.registry;
	if (reg && typeof reg === 'object') {
		for (const [idKey, entry] of Object.entries(reg)) {
			const seq = normalizeSeq((entry as { seq?: unknown } | undefined)?.seq);
			if (seq > 0) ordinals.set(String(idKey).trim(), seq);
		}
	}
	if (Array.isArray(regObj.reflist)) {
		for (const entry of regObj.reflist) {
			const idKey = entry?.id !== undefined && entry?.id !== null ? String(entry.id).trim() : '';
			const seq = normalizeSeq(entry?.seq);
			if (idKey && seq > 0 && !ordinals.has(idKey)) ordinals.set(idKey, seq);
		}
	}
	return ordinals;
}

export function lookupKnownOrdinal(
	ci: any,
	citeprocMap: ReadonlyMap<string, number>,
	resolvedItemID: number,
	rawData: Record<string, unknown> | undefined,
	skipRawItemId = false,
): number | undefined {
	const explicit = Number(ci?.ordinal ?? ci?.citationNumber ?? 0);
	if (Number.isSafeInteger(explicit) && explicit > 0) return explicit;
	if (!citeprocMap.size) return undefined;
	const rawCiId = ci?.id !== undefined && ci?.id !== null ? String(ci.id).trim() : '';
	const rawItemId = ci?.itemID !== undefined && ci?.itemID !== null ? String(ci.itemID).trim() : '';
	const rawDataId = rawData?.id !== undefined && rawData?.id !== null ? String(rawData.id).trim() : '';
	const candidates = skipRawItemId
		? [resolvedItemID > 0 ? String(resolvedItemID) : '', rawDataId && rawDataId !== rawCiId && rawDataId !== rawItemId ? rawDataId : '']
		: [rawCiId, rawItemId, resolvedItemID > 0 ? String(resolvedItemID) : '', rawDataId];
	for (const key of candidates) {
		if (!key) continue;
		const seq = citeprocMap.get(key);
		if (seq && seq > 0) return seq;
	}
	return undefined;
}

export function mergeOrphanMetadata(
	existing: OrphanCitationInfo,
	uris: readonly string[],
	rawData: Record<string, unknown> | undefined,
	itemID: number,
): OrphanCitationInfo {
	const mergedUris = uris.length
		? [...new Set([...(existing.uris || []), ...uris])]
		: existing.uris;
	let mergedData = existing.itemData || rawData;
	if (existing.itemData && rawData) {
		const combined = { ...rawData };
		for (const [key, value] of Object.entries(existing.itemData)) {
			if (value != null && value !== '' && !(Array.isArray(value) && !value.length)) {
				Object.defineProperty(combined, key, { value, enumerable: true, writable: true, configurable: true });
			}
		}
		mergedData = combined;
	}
	const mergedAuthorYear = existing.authorYear || formatCslAuthorYear(rawData);
	const candidateTitle = String(rawData?.title || rawData?.['container-title'] || '').trim();
	const mergedTitle = (existing.title.startsWith('Citation ') || /^#\d+$/.test(existing.title)) && candidateTitle ? candidateTitle : existing.title;
	const mergedId = existing.itemID || (Number.isSafeInteger(itemID) && itemID > 0 ? itemID : undefined);
	return {
		...existing,
		title: mergedTitle,
		...(mergedAuthorYear ? { authorYear: mergedAuthorYear } : {}),
		...(mergedId ? { itemID: mergedId } : {}),
		...(mergedUris?.length ? { uris: mergedUris } : {}),
		...(mergedData ? { itemData: mergedData } : {}),
	};
}
