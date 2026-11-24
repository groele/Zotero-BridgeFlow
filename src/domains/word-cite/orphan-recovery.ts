import type { OrphanCitationInfo, WordRecoverOrphansResultPayload } from '../../kernel/types.ts';
import { classifySyncSafeRelinkUris, normalizeDoi, rememberRelinkedItemUris } from './orphan-identity.ts';

const CSL_TO_ZOTERO_TYPE: Record<string, string> = {
	'article-journal': 'journalArticle',
	'article-magazine': 'magazineArticle',
	'article-newspaper': 'newspaperArticle',
	'paper-conference': 'conferencePaper',
	book: 'book',
	chapter: 'bookSection',
	thesis: 'thesis',
	report: 'report',
	webpage: 'webpage',
	patent: 'patent',
	manuscript: 'manuscript',
	software: 'computerProgram',
	dataset: 'dataset',
	article: 'preprint',
	document: 'document',
};

function mapCslCreators(itemData: Record<string, unknown>): Array<{ firstName?: string; lastName: string; creatorType: string; fieldMode?: number }> {
	const creators: Array<{ firstName?: string; lastName: string; creatorType: string; fieldMode?: number }> = [];
	const pushRole = (list: unknown, creatorType: string) => {
		if (!Array.isArray(list)) return;
		for (const entry of list) {
			if (!entry || typeof entry !== 'object') continue;
			const rec = entry as Record<string, unknown>;
			const literal = String(rec.literal || '').trim();
			if (literal) {
				creators.push({ lastName: literal, creatorType, fieldMode: 1 });
				continue;
			}
			const family = String(rec.family || '').trim();
			const given = String(rec.given || '').trim();
			if (family || given) {
				creators.push({
					lastName: family || given,
					...(family && given ? { firstName: given } : {}),
					creatorType,
				});
			}
		}
	};
	pushRole(itemData.author, 'author');
	pushRole(itemData.editor, 'editor');
	pushRole(itemData.translator, 'translator');
	return creators;
}

function formatCslIssuedDate(itemData: Record<string, unknown>): string {
	const issued = itemData.issued as { 'date-parts'?: unknown[][]; literal?: string; raw?: string } | undefined;
	if (!issued || typeof issued !== 'object') return '';
	const parts = Array.isArray(issued['date-parts']) && Array.isArray(issued['date-parts'][0])
		? issued['date-parts'][0].map((v) => String(v ?? '').trim()).filter(Boolean)
		: [];
	if (parts.length > 0) return parts.join('-');
	return String(issued.literal || issued.raw || '').trim();
}

function setFieldIfPresent(item: any, field: string, value: unknown): void {
	if (typeof item?.setField !== 'function') return;
	const text = String(value ?? '').trim();
	if (!text) return;
	try {
		item.setField(field, text);
	} catch { /* field not supported on this itemType */ }
}

function hasRecoverableCslMetadata(data: Record<string, unknown> | undefined, creatorsCount: number, doi: string): boolean {
	if (!data || typeof data !== 'object') return false;
	const title = String(data.title || '').trim();
	const container = String(data['container-title'] || '').trim();
	const url = String(data.URL || '').trim();
	const isbn = String(data.ISBN || '').trim();
	return Boolean(title || container || creatorsCount > 0 || doi || url || isbn);
}

/** Resolves the library an orphan citation came from; falls back to the user library when unknown or read-only. */
export function resolveOrphanLibraryID(orphan: OrphanCitationInfo, fallbackLibraryID: number): number {
	const host = (globalThis as any).Zotero;
	for (const uri of orphan.uris || []) {
		const match = String(uri).match(/\/groups\/(\d+)\/items\//);
		if (!match) continue;
		try {
			const libraryID = host?.Groups?.getLibraryIDFromGroupID?.(Number(match[1]));
			if (Number.isSafeInteger(libraryID) && libraryID > 0 && host?.Libraries?.get?.(libraryID)?.editable !== false) {
				return libraryID;
			}
		} catch { /* fall through to user library */ }
	}
	return fallbackLibraryID;
}

/** Finds an existing, non-deleted regular item in the library with the same DOI so recovery never duplicates it. */
async function findExistingItemByDoi(libraryID: number, doi: string): Promise<any | null> {
	const host = (globalThis as any).Zotero;
	if (!doi || typeof host?.Search !== 'function') return null;
	try {
		const search = new host.Search();
		search.libraryID = libraryID;
		search.addCondition('DOI', 'is', doi);
		const ids: number[] = await search.search();
		for (const id of ids || []) {
			const candidate = (await host.Items?.getAsync?.(id)) ?? host.Items?.get?.(id);
			if (candidate && !candidate.deleted && candidate.isRegularItem?.() !== false) return candidate;
		}
	} catch { /* search unavailable: treat as no duplicate */ }
	return null;
}

async function attachSyncSafeRelinkRelations(
	targetItem: any,
	orphan: OrphanCitationInfo,
	targetLibraryID: number,
	userLibraryID: number,
	zoteroObj: any,
): Promise<{ attached: boolean; safeUris: string[]; foreignSkipped: boolean }> {
	const { safeUris, foreignSkipped } = classifySyncSafeRelinkUris(orphan.uris, targetLibraryID, userLibraryID, zoteroObj);
	if (!safeUris.length || typeof targetItem?.addRelation !== 'function') {
		return { attached: false, safeUris, foreignSkipped };
	}

	const predicate = zoteroObj?.Relations?.replacedItemPredicate || 'dc:replaces';
	if (targetItem.id && typeof targetItem.loadDataType === 'function') {
		try { await targetItem.loadDataType('relations'); } catch { /* may already be loaded */ }
	}
	let selfUri = '';
	if (targetItem.key && typeof zoteroObj?.URI?.getItemURI === 'function') {
		try { selfUri = String(zoteroObj.URI.getItemURI(targetItem) || '').trim(); } catch { /* ignore */ }
	}

	let attached = false;
	for (const uri of safeUris) {
		if (!uri || uri === selfUri) continue;
		try {
			if (targetItem.hasRelation?.(predicate, uri)) {
				attached = true;
				continue;
			}
			const added = targetItem.addRelation(predicate, uri);
			if (added !== false) attached = true;
		} catch { /* ignore unsupported relation on stub */ }
	}
	return { attached, safeUris, foreignSkipped };
}

type SaveFn = (item: any, options?: Record<string, unknown>) => Promise<unknown>;

async function importOrphanFromMetadata(
	orphan: OrphanCitationInfo,
	userLibraryID: number,
	saveInTx: SaveFn,
	batchDoiCache: Map<string, any>,
	targetCollectionID?: number,
): Promise<{ outcome: 'imported' | 'existing' | 'failed'; relinked: boolean; foreignSkipped: boolean }> {
	const ZoteroObj = (globalThis as any).Zotero;
	const ItemCtor = ZoteroObj?.Item;
	if (typeof ItemCtor !== 'function') return { outcome: 'failed', relinked: false, foreignSkipped: false };

	const data = orphan.itemData && typeof orphan.itemData === 'object' ? orphan.itemData : undefined;
	const targetLibraryID = resolveOrphanLibraryID(orphan, userLibraryID);
	const doi = normalizeDoi(data?.DOI);
	const batchDupKey = doi ? `${targetLibraryID}:${doi}` : '';
	const duplicate = (batchDupKey ? batchDoiCache.get(batchDupKey) : null) || (await findExistingItemByDoi(targetLibraryID, doi));
	if (duplicate) {
		const dupLibID = duplicate.libraryID ?? userLibraryID;
		const relRes = await attachSyncSafeRelinkRelations(duplicate, orphan, dupLibID, userLibraryID, ZoteroObj);
		let addedToCol = false;
		if (targetCollectionID && typeof duplicate.addToCollection === 'function' && dupLibID === userLibraryID) {
			try {
				duplicate.addToCollection(targetCollectionID);
				addedToCol = true;
			} catch { /* collection link is best effort */ }
		}
		if (addedToCol || relRes.attached) {
			await saveInTx(duplicate, addedToCol ? undefined : { skipDateModifiedUpdate: true });
		}
		const dupId = Number(duplicate.id || 0);
		if (relRes.attached && dupId > 0) rememberRelinkedItemUris(orphan.uris || relRes.safeUris, dupId);
		return { outcome: 'existing', relinked: relRes.attached, foreignSkipped: relRes.foreignSkipped };
	}

	const creators = data ? mapCslCreators(data) : [];
	if (!hasRecoverableCslMetadata(data, creators.length, doi)) {
		return { outcome: 'failed', relinked: false, foreignSkipped: false };
	}

	const csl = data!;
	const rawType = String(csl.type || 'article-journal').trim();
	const itemType = CSL_TO_ZOTERO_TYPE[rawType] || 'journalArticle';
	const item = new ItemCtor(itemType);
	item.libraryID = targetLibraryID;

	setFieldIfPresent(item, 'title', csl.title || csl['container-title'] || orphan.title);
	setFieldIfPresent(item, 'publicationTitle', csl['container-title']);
	setFieldIfPresent(item, 'volume', csl.volume);
	setFieldIfPresent(item, 'issue', csl.issue);
	setFieldIfPresent(item, 'pages', csl.page);
	setFieldIfPresent(item, 'DOI', csl.DOI);
	setFieldIfPresent(item, 'ISBN', csl.ISBN);
	setFieldIfPresent(item, 'ISSN', csl.ISSN);
	setFieldIfPresent(item, 'url', csl.URL);
	setFieldIfPresent(item, 'publisher', csl.publisher);
	setFieldIfPresent(item, 'place', csl['publisher-place']);
	setFieldIfPresent(item, 'abstractNote', csl.abstract);
	setFieldIfPresent(item, 'date', formatCslIssuedDate(csl));

	if (creators.length > 0 && typeof item.setCreators === 'function') {
		try { item.setCreators(creators); } catch { /* ignore */ }
	}
	if (targetCollectionID && typeof item.addToCollection === 'function' && targetLibraryID === userLibraryID) {
		try { item.addToCollection(targetCollectionID); } catch { /* ignore */ }
	}
	const relRes = await attachSyncSafeRelinkRelations(item, orphan, targetLibraryID, userLibraryID, ZoteroObj);
	const savedId = await saveInTx(item);
	const resolvedNewId = Number(item.id || savedId || 0);
	if (batchDupKey) batchDoiCache.set(batchDupKey, item);
	if (relRes.attached && resolvedNewId > 0) rememberRelinkedItemUris(orphan.uris || relRes.safeUris, resolvedNewId);
	return { outcome: 'imported', relinked: relRes.attached, foreignSkipped: relRes.foreignSkipped };
}

/**
 * Recovers trashed cited items in-place (preserving original itemID/PDFs/notes) and reverse-imports
 * missing Word-embedded citations into Zotero inside a single DB transaction, attaching native
 * `dc:replaces` relations for same-library URIs so Zotero Word Refresh automatically relinks them.
 */
export async function recoverOrphanCitations(
	orphans: readonly OrphanCitationInfo[],
	options?: { targetCollectionID?: number; collectionName?: string; keys?: readonly string[] },
): Promise<WordRecoverOrphansResultPayload> {
	const ZoteroObj = (globalThis as any).Zotero;
	const hostItems = ZoteroObj?.Items;
	const userLibraryID = Number(ZoteroObj?.Libraries?.userLibraryID ?? 1);
	const keyFilter = options?.keys?.length ? new Set(options.keys) : null;
	const targets = keyFilter ? orphans.filter((o) => keyFilter.has(o.key)) : orphans;

	const hasDbTx = typeof ZoteroObj?.DB?.executeTransaction === 'function';
	const saveInTx: SaveFn = async (item, opts) => {
		if (hasDbTx && typeof item?.save === 'function') {
			return opts ? item.save(opts) : item.save();
		}
		if (typeof item?.saveTx === 'function') {
			return opts ? item.saveTx(opts) : item.saveTx();
		}
		throw new Error('Item persistence API unavailable');
	};
	const runBatch = async <T>(work: () => Promise<T>): Promise<T> =>
		(hasDbTx ? ZoteroObj.DB.executeTransaction(work) : work());

	let restoredCount = 0;
	let importedCount = 0;
	let skippedCount = 0;
	let existingCount = 0;
	let relinkedCount = 0;
	let foreignSkippedCount = 0;
	const restoredIDs = new Set<number>();
	const batchDoiCache = new Map<string, any>();

	await runBatch(async () => {
		for (const orphan of targets) {
			if (orphan.kind === 'trashed' && orphan.itemID) {
				if (restoredIDs.has(orphan.itemID)) continue;
				const existing = typeof hostItems?.getAsync === 'function'
					? await hostItems.getAsync(orphan.itemID)
					: hostItems?.get?.(orphan.itemID);
				if (existing) {
					existing.deleted = false;
					const itemLibID = existing.libraryID ?? userLibraryID;
					if (options?.targetCollectionID && typeof existing.addToCollection === 'function' && itemLibID === userLibraryID) {
						try { existing.addToCollection(options.targetCollectionID); } catch { /* ignore */ }
					}
					await saveInTx(existing);
					restoredIDs.add(orphan.itemID);
					restoredCount += 1;
					relinkedCount += 1;
					continue;
				}
			}

			const res = await importOrphanFromMetadata(orphan, userLibraryID, saveInTx, batchDoiCache, options?.targetCollectionID);
			if (res.relinked) relinkedCount += 1;
			if (res.foreignSkipped) foreignSkippedCount += 1;
			if (res.outcome === 'imported') importedCount += 1;
			else if (res.outcome === 'existing') existingCount += 1;
			else skippedCount += 1;
		}
	});

	return {
		restoredCount,
		importedCount,
		skippedCount,
		...(existingCount ? { existingCount } : {}),
		...(relinkedCount ? { relinkedCount } : {}),
		...(foreignSkippedCount ? { foreignSkippedCount } : {}),
		...(options?.collectionName ? { collectionName: options.collectionName } : {}),
	};
}
