import type { OrphanCitationInfo } from '../../kernel/types.ts';
import {
	buildOrphanIdentity,
	cleanCitationText,
	extractCitationItemUris,
	formatCslAuthorYear,
	isForeignUserItemUri,
	lookupKnownOrdinal,
	mergeOrphanMetadata,
	resolveCiteprocOrdinalMap,
	resolveItemIdFromUris,
} from './orphan-identity.ts';

export { cleanCitationText };

const VALID_INDEX_KEY_RE = /^(?:0|[1-9]\d*)$/;

export interface ExtractedCitationEntry {
	itemID: number;
	ordinal: number;
	shortText: string;
	occurrences: number;
}

export interface ExtractedSessionCitations {
	citations: ExtractedCitationEntry[];
	orphans: OrphanCitationInfo[];
}

/**
 * Extracts unique valid cited items AND orphan/trashed citations with exact document ordinals:
 * 1) Reads true citeproc bibliography ordinals when available (accurate for sorted/custom styles).
 * 2) Falls back to document appearance order with URI/DOI/title+author+year deduplication across repeated missing citations.
 * 3) Resolves trashed items via `uris`/`uri` even after Word refresh replaces numeric IDs with `<sessionID>/<randomID>`.
 */
export function extractSessionCitationsWithOrphans(session: any): ExtractedSessionCitations {
	const zoteroObj = (globalThis as any).Zotero;
	const hostItems = zoteroObj?.Items;
	const hasItemLookup = typeof hostItems?.get === 'function';
	const sessionID = String(session?.sessionID || session?.data?.sessionID || '').trim();
	const citeprocOrdinals = resolveCiteprocOrdinalMap(session);

	const validMap = new Map<number, { ordinal: number; knownOrdinal?: number; occurrences: number; labels: string[] }>();
	const orphanMap = new Map<string, { info: OrphanCitationInfo; knownOrdinal?: number; doi: string }>();
	const orphanAliasToKey = new Map<string, string>();
	const orphanItemIDs = new Set<number>();
	const conflictingIDs = new Set<number>();
	const orderQueue: Array<{ kind: 'valid'; itemID: number } | { kind: 'orphan'; key: string }> = [];
	const statusCache = new Map<number, { status: 'valid' | 'trashed' | 'missing'; zotItem: any }>();
	let fallbackSeq = 1;

	const inspectItemById = (itemID: number): { status: 'valid' | 'trashed' | 'missing'; zotItem: any } => {
		if (!Number.isSafeInteger(itemID) || itemID <= 0) return { status: 'missing', zotItem: null };
		if (!hasItemLookup) return { status: 'valid', zotItem: null };
		const cached = statusCache.get(itemID);
		if (cached !== undefined) return cached;
		const zotItem = hostItems.get(itemID);
		if (!zotItem) {
			const res = { status: 'missing' as const, zotItem: null };
			statusCache.set(itemID, res);
			return res;
		}
		const inTrash = (typeof zotItem.inTrash === 'function' ? zotItem.inTrash() === true : zotItem.inTrash === true)
			|| zotItem.isTrashed?.() === true;
		const res = { status: (zotItem.deleted === true || inTrash ? 'trashed' : 'valid') as 'trashed' | 'valid', zotItem };
		statusCache.set(itemID, res);
		return res;
	};

	const recordValidHit = (itemID: number, shortText: unknown, knownOrdinal?: number, countOcc = false) => {
		if (!Number.isSafeInteger(itemID) || itemID <= 0 || orphanItemIDs.has(itemID)) return;
		if (inspectItemById(itemID).status !== 'valid') return;
		const label = cleanCitationText(shortText);
		let existing = validMap.get(itemID);
		if (!existing) {
			existing = { ordinal: 0, knownOrdinal, occurrences: 0, labels: [] };
			validMap.set(itemID, existing);
			orderQueue.push({ kind: 'valid', itemID });
		} else if (!existing.knownOrdinal && knownOrdinal) {
			existing.knownOrdinal = knownOrdinal;
		}
		if (countOcc) existing.occurrences += 1;
		else if (existing.occurrences === 0) existing.occurrences = 1;
		if (label && !existing.labels.includes(label)) existing.labels.push(label);
	};

	const recordOrphanHit = (
		ci: any,
		zotItem: any,
		itemID: number,
		kind: 'trashed' | 'missing',
		uris: readonly string[],
		shortText: string,
		knownOrdinal?: number,
	) => {
		const rawData = ci?.itemData && typeof ci.itemData === 'object' ? (ci.itemData as Record<string, unknown>) : undefined;
		const ident = buildOrphanIdentity(itemID, uris, rawData, sessionID, `${fallbackSeq++}:${shortText}`);
		if (Number.isSafeInteger(itemID) && itemID > 0) orphanItemIDs.add(itemID);

		let matchedKey: string | undefined = orphanMap.has(ident.key) ? ident.key : undefined;
		if (!matchedKey) {
			for (const alias of ident.aliases) {
				const found = orphanAliasToKey.get(alias);
				if (found && orphanMap.has(found)) { matchedKey = found; break; }
			}
		}
		if (!matchedKey && ident.fpAlias) {
			const fpOwnerKey = orphanAliasToKey.get(ident.fpAlias);
			const fpEntry = fpOwnerKey ? orphanMap.get(fpOwnerKey) : undefined;
			if (fpEntry && (!ident.doi || !fpEntry.doi || ident.doi === fpEntry.doi)) {
				matchedKey = fpOwnerKey;
			}
		}

		if (matchedKey) {
			const slot = orphanMap.get(matchedKey)!;
			slot.info = mergeOrphanMetadata(slot.info, uris, rawData, itemID);
			if (!slot.knownOrdinal && knownOrdinal) slot.knownOrdinal = knownOrdinal;
			if (!slot.doi && ident.doi) slot.doi = ident.doi;
			for (const alias of ident.aliases) orphanAliasToKey.set(alias, matchedKey);
			if (ident.fpAlias && !orphanAliasToKey.has(ident.fpAlias)) orphanAliasToKey.set(ident.fpAlias, matchedKey);
			return;
		}

		const itemTitle = typeof zotItem?.getField === 'function' ? String(zotItem.getField('title') || '').trim() : '';
		const dataTitle = String(rawData?.title || rawData?.['container-title'] || '').trim();
		const title = itemTitle || dataTitle || (shortText ? `Citation ${shortText}` : `#${orderQueue.length + 1}`);
		const authorYear = formatCslAuthorYear(rawData);
		const info: OrphanCitationInfo = {
			key: ident.key,
			kind,
			ordinal: 0,
			shortText,
			title,
			...(authorYear ? { authorYear } : {}),
			...(Number.isSafeInteger(itemID) && itemID > 0 ? { itemID } : {}),
			...(uris.length ? { uris: [...uris] } : {}),
			...(rawData ? { itemData: rawData } : {}),
		};
		orphanMap.set(ident.key, { info, knownOrdinal, doi: ident.doi });
		for (const alias of ident.aliases) orphanAliasToKey.set(alias, ident.key);
		if (ident.fpAlias && !orphanAliasToKey.has(ident.fpAlias)) orphanAliasToKey.set(ident.fpAlias, ident.key);
		orderQueue.push({ kind: 'orphan', key: ident.key });
	};

	const byIndex = session?.citationsByIndex;
	if (byIndex && typeof byIndex === 'object') {
		const sortedKeys = Object.keys(byIndex)
			.filter((k) => VALID_INDEX_KEY_RE.test(k))
			.sort((a, b) => Number(a) - Number(b));

		for (const key of sortedKeys) {
			const cit = byIndex[key];
			const cItems: any[] = Array.isArray(cit?.citationItems) ? cit.citationItems : [];
			const cleanedShort = cleanCitationText(cit?.properties?.plainCitation ?? cit?.properties?.formattedCitation ?? cit?.text ?? '');
			for (const ci of cItems) {
				if (!ci || typeof ci !== 'object') continue;
				const uris = extractCitationItemUris(ci);
				const rawData = ci?.itemData && typeof ci.itemData === 'object' ? (ci.itemData as Record<string, unknown>) : undefined;
				const rawNumericID = Number(ci?.id ?? ci?.itemID ?? 0);
				let resolvedID = rawNumericID;
				let inspected = inspectItemById(resolvedID);
				if (uris.length && hasItemLookup) {
					let canonical = '';
					if (inspected.zotItem && typeof zoteroObj?.URI?.getItemURI === 'function') {
						try { canonical = String(zoteroObj.URI.getItemURI(inspected.zotItem) || '').replace(/^https:/i, 'http:').replace(/\/+$/, ''); } catch { /* ignore */ }
					}
					if (!canonical || !uris.some(uri => uri.replace(/[?#].*$/, '').replace(/^https:/i, 'http:').replace(/\/+$/, '') === canonical)) {
						const uriID = resolveItemIdFromUris(uris, zoteroObj, hostItems);
						const hasAuthCtx = Boolean(
							canonical
							|| typeof zoteroObj?.Users?.getCurrentUserID === 'function'
							|| typeof zoteroObj?.Users?.getLocalUserKey === 'function'
							|| typeof zoteroObj?.Groups?.getLibraryIDFromGroupID === 'function',
						);
						const allForeign = hasAuthCtx && uris.every((u) => isForeignUserItemUri(u, zoteroObj));
						if ((uriID || canonical || allForeign) && uriID !== resolvedID) {
							if (Number.isSafeInteger(resolvedID) && resolvedID > 0) conflictingIDs.add(resolvedID);
							resolvedID = uriID;
							inspected = inspectItemById(resolvedID);
						}
					}
				}
				const skipRawId = Number.isSafeInteger(rawNumericID) && rawNumericID > 0 && conflictingIDs.has(rawNumericID) && resolvedID !== rawNumericID;
				const knownOrdinal = lookupKnownOrdinal(ci, citeprocOrdinals, resolvedID, rawData, skipRawId);
				if (inspected.status === 'valid') {
					recordValidHit(resolvedID, cleanedShort, knownOrdinal, true);
				} else {
					recordOrphanHit(ci, inspected.zotItem, resolvedID, inspected.status, uris, cleanedShort, knownOrdinal);
				}
			}
		}
	}

	const byItem = session?.citationsByItemID;
	if (byItem && typeof byItem === 'object') {
		for (const [rawID, list] of Object.entries(byItem)) {
			const itemID = Number(rawID);
			if (conflictingIDs.has(itemID)) continue;
			const knownOrdinal = lookupKnownOrdinal({ id: rawID }, citeprocOrdinals, itemID, undefined);
			for (const entry of Array.isArray(list) ? list : [list]) {
				if (!entry) continue;
				recordValidHit(itemID, entry.properties?.plainCitation ?? entry.properties?.formattedCitation ?? entry.text ?? '', knownOrdinal);
			}
		}
	}

	const usedOrdinals = new Set<number>();
	for (const entry of validMap.values()) {
		if (entry.knownOrdinal && entry.knownOrdinal > 0) usedOrdinals.add(entry.knownOrdinal);
	}
	for (const entry of orphanMap.values()) {
		if (entry.knownOrdinal && entry.knownOrdinal > 0) usedOrdinals.add(entry.knownOrdinal);
	}

	let nextOrdinal = 1;
	const allocOrdinal = (known?: number): number => {
		if (known && known > 0) return known;
		while (usedOrdinals.has(nextOrdinal)) nextOrdinal += 1;
		usedOrdinals.add(nextOrdinal);
		return nextOrdinal++;
	};

	for (const node of orderQueue) {
		if (node.kind === 'valid') {
			const slot = validMap.get(node.itemID);
			if (slot && slot.ordinal <= 0) slot.ordinal = allocOrdinal(slot.knownOrdinal);
		} else {
			const slot = orphanMap.get(node.key);
			if (slot && slot.info.ordinal <= 0) {
				const ord = allocOrdinal(slot.knownOrdinal);
				slot.info = {
					...slot.info,
					ordinal: ord,
					title: slot.info.title.startsWith('#') ? `#${ord}` : slot.info.title,
				};
			}
		}
	}

	return {
		citations: [...validMap.entries()].map(([itemID, info]) => ({
			itemID,
			ordinal: info.ordinal,
			shortText: info.labels.join(', '),
			occurrences: info.occurrences,
		})),
		orphans: [...orphanMap.values()].map((slot) => slot.info).sort((a, b) => a.ordinal - b.ordinal),
	};
}
