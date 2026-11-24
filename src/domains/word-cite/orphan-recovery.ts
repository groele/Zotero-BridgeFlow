import type { OrphanCitationInfo, WordRecoverOrphansResultPayload } from '../../kernel/types.ts';

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

function normalizeDoi(raw: unknown): string {
	return String(raw ?? '').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase();
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

async function importOrphanFromMetadata(
	orphan: OrphanCitationInfo,
	libraryID: number,
	targetCollectionID?: number,
): Promise<'imported' | 'existing' | 'failed'> {
	const ZoteroObj = (globalThis as any).Zotero;
	const ItemCtor = ZoteroObj?.Item;
	if (typeof ItemCtor !== 'function') return 'failed';

	const data = orphan.itemData || {};
	const targetLibraryID = resolveOrphanLibraryID(orphan, libraryID);
	const doi = normalizeDoi(data.DOI);
	const duplicate = await findExistingItemByDoi(targetLibraryID, doi);
	if (duplicate) {
		if (targetCollectionID && typeof duplicate.addToCollection === 'function' && duplicate.libraryID === libraryID) {
			try {
				duplicate.addToCollection(targetCollectionID);
				await duplicate.saveTx?.();
			} catch { /* collection link is best effort */ }
		}
		return 'existing';
	}
	const rawType = String(data.type || 'article-journal').trim();
	const itemType = CSL_TO_ZOTERO_TYPE[rawType] || 'journalArticle';
	const item = new ItemCtor(itemType);
	item.libraryID = targetLibraryID;

	setFieldIfPresent(item, 'title', data.title || orphan.title);
	setFieldIfPresent(item, 'publicationTitle', data['container-title']);
	setFieldIfPresent(item, 'volume', data.volume);
	setFieldIfPresent(item, 'issue', data.issue);
	setFieldIfPresent(item, 'pages', data.page);
	setFieldIfPresent(item, 'DOI', data.DOI);
	setFieldIfPresent(item, 'ISBN', data.ISBN);
	setFieldIfPresent(item, 'ISSN', data.ISSN);
	setFieldIfPresent(item, 'url', data.URL);
	setFieldIfPresent(item, 'publisher', data.publisher);
	setFieldIfPresent(item, 'place', data['publisher-place']);
	setFieldIfPresent(item, 'abstractNote', data.abstract);
	setFieldIfPresent(item, 'date', formatCslIssuedDate(data));

	const creators = mapCslCreators(data);
	if (creators.length > 0 && typeof item.setCreators === 'function') {
		try { item.setCreators(creators); } catch { /* ignore */ }
	}
	if (targetCollectionID && typeof item.addToCollection === 'function' && targetLibraryID === libraryID) {
		try { item.addToCollection(targetCollectionID); } catch { /* ignore */ }
	}
	if (typeof item.saveTx === 'function') {
		await item.saveTx();
		return 'imported';
	}
	return 'failed';
}

/**
 * Recovers trashed cited items in-place (preserving original itemID) and reverse-imports
 * missing Word-embedded citations into the user's Zotero library.
 */
export async function recoverOrphanCitations(
	orphans: readonly OrphanCitationInfo[],
	options?: { targetCollectionID?: number; collectionName?: string; keys?: readonly string[] },
): Promise<WordRecoverOrphansResultPayload> {
	const ZoteroObj = (globalThis as any).Zotero;
	const hostItems = ZoteroObj?.Items;
	const libraryID = Number(ZoteroObj?.Libraries?.userLibraryID ?? 1);
	const keyFilter = options?.keys?.length ? new Set(options.keys) : null;
	const targets = keyFilter ? orphans.filter((o) => keyFilter.has(o.key)) : orphans;

	let restoredCount = 0;
	let importedCount = 0;
	let skippedCount = 0;
	let existingCount = 0;

	for (const orphan of targets) {
		try {
			if (orphan.kind === 'trashed' && orphan.itemID) {
				const existing = typeof hostItems?.getAsync === 'function'
					? await hostItems.getAsync(orphan.itemID)
					: hostItems?.get?.(orphan.itemID);
				if (existing) {
					existing.deleted = false;
					if (options?.targetCollectionID && typeof existing.addToCollection === 'function') {
						try { existing.addToCollection(options.targetCollectionID); } catch { /* ignore */ }
					}
					if (typeof existing.saveTx === 'function') {
						await existing.saveTx();
						restoredCount += 1;
						continue;
					}
				}
			}

			const outcome = await importOrphanFromMetadata(orphan, libraryID, options?.targetCollectionID);
			if (outcome === 'imported') importedCount += 1;
			else if (outcome === 'existing') existingCount += 1;
			else skippedCount += 1;
		} catch {
			skippedCount += 1;
		}
	}

	return {
		restoredCount,
		importedCount,
		skippedCount,
		...(existingCount ? { existingCount } : {}),
		...(options?.collectionName ? { collectionName: options.collectionName } : {}),
	};
}
