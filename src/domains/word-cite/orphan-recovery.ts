import type { OrphanCitationInfo, WordRecoverOrphansResultPayload } from '../../kernel/types.ts';
import {
	buildBatchMetadataKey,
	CSL_TO_ZOTERO_TYPE,
	findExistingLibraryItem,
	hasRecoverableCslMetadata,
	mapCslCreators,
	populateZoteroItemFromCsl,
} from './orphan-csl-mapper.ts';
import { classifySyncSafeRelinkUris, normalizeDoi, rememberRelinkedItemUris } from './orphan-identity.ts';

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
	batchItemCache: Map<string, any>,
	targetCollectionID?: number,
): Promise<{ outcome: 'imported' | 'existing' | 'failed'; itemID?: number; relinked: boolean; foreignSkipped: boolean }> {
	const ZoteroObj = (globalThis as any).Zotero;
	const ItemCtor = ZoteroObj?.Item;
	if (typeof ItemCtor !== 'function') return { outcome: 'failed', relinked: false, foreignSkipped: false };

	const data = orphan.itemData && typeof orphan.itemData === 'object' ? orphan.itemData : undefined;
	const targetLibraryID = resolveOrphanLibraryID(orphan, userLibraryID);
	const doi = normalizeDoi(data?.DOI);
	const batchDoiKey = doi ? `doi:${targetLibraryID}:${doi}` : '';
	const batchMetaKey = buildBatchMetadataKey(targetLibraryID, data);

	const duplicate = (batchDoiKey ? batchItemCache.get(batchDoiKey) : null)
		|| (batchMetaKey ? batchItemCache.get(batchMetaKey) : null)
		|| (await findExistingLibraryItem(targetLibraryID, data, doi));

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
		if (batchDoiKey) batchItemCache.set(batchDoiKey, duplicate);
		if (batchMetaKey) batchItemCache.set(batchMetaKey, duplicate);
		if (relRes.attached && dupId > 0) rememberRelinkedItemUris(orphan.uris || relRes.safeUris, dupId);
		return {
			outcome: 'existing',
			...(dupId > 0 ? { itemID: dupId } : {}),
			relinked: relRes.attached,
			foreignSkipped: relRes.foreignSkipped,
		};
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

	populateZoteroItemFromCsl(item, itemType, csl, orphan, creators, ZoteroObj);

	if (targetCollectionID && typeof item.addToCollection === 'function' && targetLibraryID === userLibraryID) {
		try { item.addToCollection(targetCollectionID); } catch { /* ignore */ }
	}
	const relRes = await attachSyncSafeRelinkRelations(item, orphan, targetLibraryID, userLibraryID, ZoteroObj);
	const savedId = await saveInTx(item);
	const resolvedNewId = Number(item.id || savedId || 0);
	if (batchDoiKey) batchItemCache.set(batchDoiKey, item);
	if (batchMetaKey) batchItemCache.set(batchMetaKey, item);
	if (relRes.attached && resolvedNewId > 0) rememberRelinkedItemUris(orphan.uris || relRes.safeUris, resolvedNewId);
	return {
		outcome: 'imported',
		...(resolvedNewId > 0 ? { itemID: resolvedNewId } : {}),
		relinked: relRes.attached,
		foreignSkipped: relRes.foreignSkipped,
	};
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
	const recoveredItemIDs: number[] = [];
	const pushRecoveredID = (id?: number) => {
		if (id && Number.isSafeInteger(id) && id > 0 && !recoveredItemIDs.includes(id)) {
			recoveredItemIDs.push(id);
		}
	};
	const batchItemCache = new Map<string, any>();

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
					pushRecoveredID(Number(existing.id || orphan.itemID));
					restoredCount += 1;
					relinkedCount += 1;
					continue;
				}
			}

			const res = await importOrphanFromMetadata(orphan, userLibraryID, saveInTx, batchItemCache, options?.targetCollectionID);
			pushRecoveredID(res.itemID);
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
		...(recoveredItemIDs.length ? { recoveredItemIDs } : {}),
		...(options?.collectionName ? { collectionName: options.collectionName } : {}),
	};
}
