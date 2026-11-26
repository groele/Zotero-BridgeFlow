import type { OrphanCitationInfo } from '../../../kernel/types.ts';
import { extractFirstAuthorAndYear, normalizeDoi } from './orphan-identity.ts';

export const CSL_TO_ZOTERO_TYPE: Record<string, string> = {
	'article-journal': 'journalArticle',
	'article-magazine': 'magazineArticle',
	'article-newspaper': 'newspaperArticle',
	'paper-conference': 'conferencePaper',
	book: 'book',
	chapter: 'bookSection',
	'entry-encyclopedia': 'encyclopediaArticle',
	'entry-dictionary': 'dictionaryEntry',
	thesis: 'thesis',
	report: 'report',
	webpage: 'webpage',
	'post-weblog': 'blogPost',
	speech: 'presentation',
	patent: 'patent',
	manuscript: 'manuscript',
	software: 'computerProgram',
	dataset: 'dataset',
	legislation: 'statute',
	bill: 'bill',
	legal_case: 'case',
	standard: 'standard',
	motion_picture: 'film',
	broadcast: 'tvBroadcast',
	interview: 'interview',
	article: 'preprint',
	document: 'document',
};

function normCompareToken(raw: unknown): string {
	return String(raw ?? '')
		.toLowerCase()
		.replace(/[\u0000-\u001F\u007F]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function mapCslCreators(
	itemData: Record<string, unknown>,
	itemType?: string,
): Array<{ firstName?: string; lastName: string; creatorType: string; fieldMode?: number }> {
	const creators: Array<{ firstName?: string; lastName: string; creatorType: string; fieldMode?: number }> = [];
	const primaryRole = itemType === 'patent' ? 'inventor'
		: itemType === 'computerProgram' ? 'programmer'
			: itemType === 'presentation' ? 'presenter'
				: itemType === 'film' || itemType === 'tvBroadcast' ? 'director'
					: 'author';
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
			const nonDrop = String(rec['non-dropping-particle'] || '').trim();
			const drop = String(rec['dropping-particle'] || '').trim();
			const rawFamily = String(rec.family || '').trim();
			const rawGiven = String(rec.given || '').trim();
			const family = [nonDrop, rawFamily].filter(Boolean).join(' ');
			const given = [rawGiven, drop].filter(Boolean).join(' ');
			if (family || given) {
				creators.push({
					lastName: family || given,
					...(family && given ? { firstName: given } : {}),
					creatorType,
				});
			}
		}
	};
	pushRole(itemData.author, primaryRole);
	pushRole(itemData.editor, 'editor');
	pushRole(itemData.translator, 'translator');
	pushRole(itemData.director, itemType === 'film' || itemType === 'tvBroadcast' ? 'director' : 'contributor');
	return creators;
}

export function formatCslIssuedDate(itemData: Record<string, unknown>): string {
	const issued = itemData.issued as { 'date-parts'?: unknown[][]; literal?: string; raw?: string } | undefined;
	if (!issued || typeof issued !== 'object') return '';
	const parts = Array.isArray(issued['date-parts']) && Array.isArray(issued['date-parts'][0])
		? issued['date-parts'][0].map((v) => String(v ?? '').trim()).filter(Boolean)
		: [];
	if (parts.length > 0) return parts.join('-');
	return String(issued.literal || issued.raw || '').trim();
}

export function hasRecoverableCslMetadata(
	data: Record<string, unknown> | undefined,
	creatorsCount: number,
	doi: string,
): boolean {
	if (!data || typeof data !== 'object') return false;
	const title = String(data.title || '').trim();
	const container = String(data['container-title'] || '').trim();
	const url = String(data.URL || '').trim();
	const isbn = String(data.ISBN || '').trim();
	return Boolean(title || container || creatorsCount > 0 || doi || url || isbn);
}

export function buildBatchMetadataKey(libraryID: number, data: Record<string, unknown> | undefined): string {
	if (!data) return '';
	const title = normCompareToken(data.title);
	if (title.length < 6) return '';
	const { author, year } = extractFirstAuthorAndYear(data);
	const normAuthor = normCompareToken(author);
	if (!normAuthor || !year) return '';
	return `meta:${libraryID}:${title}|${normAuthor}|${year}`;
}

function readCandidateField(item: any, field: string): string {
	try {
		return typeof item?.getField === 'function' ? String(item.getField(field) || '').trim() : '';
	} catch {
		return '';
	}
}

function readCandidateFirstSurname(item: any): string {
	try {
		const creators = typeof item?.getCreators === 'function' ? item.getCreators() : null;
		if (Array.isArray(creators) && creators[0]) {
			const c0 = creators[0];
			return normCompareToken(c0.lastName || c0.name || '');
		}
	} catch { /* ignore */ }
	return normCompareToken(item?.firstCreator || '');
}

function matchesExactTitleAuthorYear(candidate: any, cslData: Record<string, unknown>, cslDoi: string): boolean {
	const rawTitle = String(cslData.title || '').trim();
	const targetTitle = normCompareToken(rawTitle);
	if (targetTitle.length < 6) return false;
	if (normCompareToken(readCandidateField(candidate, 'title')) !== targetTitle) return false;

	const candDoi = normalizeDoi(readCandidateField(candidate, 'DOI'));
	if (cslDoi && candDoi && cslDoi !== candDoi) return false;

	const { author, year } = extractFirstAuthorAndYear(cslData);
	const normAuthor = normCompareToken(author);
	if (!normAuthor || !year) return false;

	const candDateRaw = readCandidateField(candidate, 'year') || readCandidateField(candidate, 'date');
	const candYear = candDateRaw.match(/\d{4}/)?.[0] || '';
	if (year !== candYear || !candYear) return false;

	const candCreator = readCandidateFirstSurname(candidate);
	return candCreator === normAuthor
		|| candCreator.startsWith(`${normAuthor} `)
		|| candCreator.startsWith(`${normAuthor},`);
}

/**
 * Finds an existing non-deleted regular item in `libraryID` matching by normalized DOI first,
 * or falling back to strict exact title + author surname + publication year for non-DOI items.
 */
export async function findExistingLibraryItems(
	libraryID: number,
	cslData: Record<string, unknown> | undefined,
	doi: string,
): Promise<any[]> {
	const host = (globalThis as any).Zotero;
	if (typeof host?.Search !== 'function') return [];

	const runFieldSearch = async (field: string, value: string): Promise<any[]> => {
		const search = new host.Search();
		search.libraryID = libraryID;
		search.addCondition(field, 'is', value);
		const ids: number[] = await search.search();
		const out: any[] = [];
		for (const id of ids || []) {
			const candidate = (await host.Items?.getAsync?.(id)) ?? host.Items?.get?.(id);
			if (candidate && !candidate.deleted && !candidate.isTrashed?.() && candidate.isRegularItem?.() !== false
				&& (candidate.libraryID == null || candidate.libraryID === libraryID)) out.push(candidate);
		}
		return out;
	};

	if (doi) {
		const rawDoi = String(cslData?.DOI || '').trim();
		const normalized = await runFieldSearch('DOI', doi);
		if (rawDoi && rawDoi.toLowerCase() !== doi) {
			const raw = await runFieldSearch('DOI', rawDoi);
			normalized.push(...raw);
		}
		const uniqueByDoi = [...new Map(normalized.map(item => [item.id, item])).values()];
		if (uniqueByDoi.length > 0) return uniqueByDoi;
	}
	const title = String(cslData?.title || '').trim();
	if (!cslData || !buildBatchMetadataKey(libraryID, cslData)) return [];
	return (await runFieldSearch('title', title)).filter(item => matchesExactTitleAuthorYear(item, cslData, doi));
}

function setFieldIfEmpty(item: any, field: string, value: unknown): void {
	if (typeof item?.setField !== 'function') return;
	const text = String(value ?? '').trim();
	if (!text) return;
	try {
		const existing = typeof item.getField === 'function' ? String(item.getField(field) || '').trim() : '';
		if (!existing) item.setField(field, text);
	} catch { /* field not valid on this itemType */ }
}

/**
 * Populates a Zotero.Item from embedded CSL-JSON using Zotero's native `itemFromCSLJSON` when
 * available, supplemented by schema-aware container/article-number/creator fallbacks.
 */
export function populateZoteroItemFromCsl(
	item: any,
	itemType: string,
	csl: Record<string, unknown>,
	orphan: OrphanCitationInfo,
	creators: ReturnType<typeof mapCslCreators>,
	zoteroObj: any,
): void {
	if (typeof zoteroObj?.Utilities?.itemFromCSLJSON === 'function') {
		try {
			zoteroObj.Utilities.itemFromCSLJSON(item, { ...csl, type: String(csl.type || 'article-journal') });
		} catch { /* fallback to explicit field assignment below */ }
	}

	setFieldIfEmpty(item, 'title', csl.title || csl['container-title'] || orphan.title);
	setFieldIfEmpty(item, 'shortTitle', csl['title-short'] || csl.shortTitle);

	const container = csl['container-title'];
	if (itemType === 'bookSection') {
		setFieldIfEmpty(item, 'bookTitle', container);
	} else if (itemType === 'conferencePaper') {
		setFieldIfEmpty(item, 'proceedingsTitle', container);
		setFieldIfEmpty(item, 'conferenceName', csl['event-title'] || csl.event);
	} else {
		setFieldIfEmpty(item, 'publicationTitle', container);
	}

	setFieldIfEmpty(item, 'journalAbbreviation', csl['container-title-short'] || csl.journalAbbreviation);
	setFieldIfEmpty(item, 'volume', csl.volume);
	setFieldIfEmpty(item, 'issue', csl.issue);
	setFieldIfEmpty(item, 'pages', csl.page || (itemType === 'journalArticle' ? csl.number : ''));

	if (itemType === 'report') {
		setFieldIfEmpty(item, 'institution', csl.publisher);
		setFieldIfEmpty(item, 'reportNumber', csl.number);
		setFieldIfEmpty(item, 'reportType', csl.genre);
	} else if (itemType === 'thesis') {
		setFieldIfEmpty(item, 'university', csl.publisher);
		setFieldIfEmpty(item, 'thesisType', csl.genre);
	} else if (itemType === 'patent') {
		setFieldIfEmpty(item, 'patentNumber', csl.number);
	} else {
		setFieldIfEmpty(item, 'publisher', csl.publisher);
	}

	setFieldIfEmpty(item, 'series', csl['collection-title']);
	setFieldIfEmpty(item, 'edition', csl.edition);
	setFieldIfEmpty(item, 'place', csl['publisher-place'] || csl['event-place']);
	setFieldIfEmpty(item, 'DOI', csl.DOI);
	setFieldIfEmpty(item, 'ISBN', csl.ISBN);
	setFieldIfEmpty(item, 'ISSN', csl.ISSN);
	setFieldIfEmpty(item, 'url', csl.URL);
	setFieldIfEmpty(item, 'abstractNote', csl.abstract);
	setFieldIfEmpty(item, 'language', csl.language);
	setFieldIfEmpty(item, 'date', formatCslIssuedDate(csl));

	if (creators.length > 0 && typeof item.setCreators === 'function') {
		try {
			const existingCreators = typeof item.getCreators === 'function' ? item.getCreators() : null;
			if (!Array.isArray(existingCreators) || existingCreators.length === 0) {
				item.setCreators(creators);
			}
		} catch { /* ignore */ }
	}
}
