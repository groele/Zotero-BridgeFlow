import type { CitationHistoryRecord, CitationHistoryStore } from '../../services/citation-history-store.ts';
import { isRegularValidItem, safeGetItemField } from '../../services/item-resolution.ts';
import {
	extractIdentifier, parseCompactCitation, queryPhysicalCandidates, verifyAndFilterCandidates, type ParsedCitation,
} from './citation-lookup-parser.ts';

export interface LookupCandidate {
	readonly itemID: number;
	readonly title: string;
	readonly score: number;
	readonly source: 'history-exact' | 'history-fuzzy' | 'doi' | 'physical-exact' | 'library-weighted';
	readonly item?: any;
}

export interface RichLookupOutcome {
	readonly parsed: ParsedCitation | null;
	readonly historyMatched: boolean;
	readonly candidates: readonly LookupCandidate[];
}

const YEAR_REGEX = /\b(1[89]\d{2}|20\d{2})\b/;
const LOCAL_ITEMS_CACHE_TTL_MS = 15_000;
const nowMs = (): number => (typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now());

function containsStandaloneToken(haystackLower: string, tokenLower: string): boolean {
	if (!tokenLower) return false;
	let pos = haystackLower.indexOf(tokenLower);
	while (pos !== -1) {
		const before = pos === 0 ? '' : haystackLower[pos - 1];
		const after = pos + tokenLower.length >= haystackLower.length ? '' : haystackLower[pos + tokenLower.length];
		if ((!/[a-z0-9]/.test(before)) && (!/[a-z0-9]/.test(after))) return true;
		pos = haystackLower.indexOf(tokenLower, pos + 1);
	}
	return false;
}

export function extractDoi(input: string): string {
	return extractIdentifier(String(input || '')).doi || '';
}

export function extractYear(input: string): string {
	const match = String(input || '').match(YEAR_REGEX);
	return match ? match[0] : '';
}

export class CitationLookupEngine {
	private readonly history: CitationHistoryStore;
	private readonly localItemsCache = new Map<number, { expires: number; result: Promise<any[]> }>();

	constructor(history: CitationHistoryStore) {
		this.history = history;
	}

	clearCache(): void {
		this.localItemsCache.clear();
	}

	async resolveRich(
		rawQuery: string,
		options: { libraryID?: number; useHistory?: boolean; libraryItems?: readonly any[]; signal?: AbortSignal } = {},
	): Promise<RichLookupOutcome> {
		const query = String(rawQuery || '').trim();
		const empty: RichLookupOutcome = { parsed: null, historyMatched: false, candidates: [] };
		const { signal } = options;
		if (!query || signal?.aborted) return empty;
		const parsed = parseCompactCitation(query);
		const inScope = (libraryID?: number) => options.libraryID == null || options.libraryID === libraryID;

		if (options.useHistory !== false) {
			const exact = this.history.lookupExact(query, options.libraryID);
			if (exact && inScope(exact.libraryID)) {
				const liveItem = await this.resolveLiveItem(exact, options.libraryItems);
				if (signal?.aborted) return empty;
				if (liveItem && (!(parsed?.doi || parsed?.arxiv) || verifyAndFilterCandidates([liveItem], parsed).length)) {
					return {
						parsed: null,
						historyMatched: true,
						candidates: [{ itemID: exact.itemID, title: liveItem ? String(liveItem.getField?.('title') || exact.title) : exact.title, score: 100, source: 'history-exact', item: liveItem }],
					};
				}
			}

			const fuzzy = parsed?.doi || parsed?.arxiv ? [] : await this.history.searchFuzzyAsync(query, 5, options.libraryID, signal);
			if (signal?.aborted) return empty;
			if (fuzzy.length) {
				const liveHits: LookupCandidate[] = [];
				const seenFuzzy = new Set<number>();
				for (const rec of fuzzy) {
					if (seenFuzzy.has(rec.itemID)) continue;
					const liveItem = await this.resolveLiveItem(rec, options.libraryItems);
					if (signal?.aborted) return empty;
					if (liveItem) {
						seenFuzzy.add(rec.itemID);
						liveHits.push({
							itemID: rec.itemID,
							title: String(liveItem.getField?.('title') || rec.title),
							score: 90,
							source: 'history-fuzzy',
							item: liveItem,
						});
					}
				}
				if (liveHits.length) {
					return { parsed: null, historyMatched: true, candidates: liveHits };
				}
			}
		}

		if (parsed && !options.libraryItems) {
			const physical = await queryPhysicalCandidates(parsed, options.libraryID, signal);
			if (signal?.aborted) return empty;
			const verified = verifyAndFilterCandidates(physical, parsed);
			if (verified.length) {
				return {
					parsed,
					historyMatched: false,
					candidates: verified.map((it) => ({
						itemID: Number(it.id || 0),
						title: String(it.getField?.('title') || ''),
						score: 99,
						source: 'physical-exact',
						item: it,
					})),
				};
			}
		}

		if (parsed?.arxiv && !parsed.doi && !options.libraryItems) {
			return { parsed, historyMatched: false, candidates: [] };
		}
		const weighted = await this.weightedSearch(query, parsed, options.libraryItems, options.libraryID, signal);
		return { parsed, historyMatched: false, candidates: weighted };
	}

	async lookup(rawQuery: string, libraryItems?: readonly any[]): Promise<LookupCandidate[]> {
		const outcome = await this.resolveRich(rawQuery, { useHistory: true, libraryItems });
		return [...outcome.candidates];
	}

	private async resolveLiveItem({ itemID, itemKey, libraryID }: CitationHistoryRecord, libraryItems?: readonly any[]): Promise<any | null> {
		const hostItems = (globalThis as any).Zotero?.Items;
		const item = libraryItems ? libraryItems.find(it => it?.id === itemID) : typeof hostItems?.getAsync === 'function'
			? await hostItems.getAsync(itemID).catch(() => null)
			: hostItems?.get?.(itemID);
		if (!isRegularValidItem(item)) return null;
		if (item.libraryID != null && item.libraryID !== libraryID) return null;
		if (item.key && itemKey && item.key !== itemKey) return null;
		return item;
	}

	private async weightedSearch(query: string, parsed: ParsedCitation | null, libraryItems?: readonly any[], libraryID?: number, signal?: AbortSignal): Promise<LookupCandidate[]> {
		const candidates = libraryItems ?? await this.fetchLocalLibraryItems(libraryID);
		if (signal?.aborted) return [];
		const targetDoi = parsed?.doi;
		const targetYear = extractYear(query);
		const lowerQuery = query.toLowerCase();
		const results: LookupCandidate[] = [];
		const seen = new Set<number>();
		let deadline = nowMs() + 6;

		for (const item of candidates) {
			if (signal?.aborted) return [];
			if (nowMs() >= deadline) {
				await new Promise<void>(resolve => setTimeout(resolve, 0));
				if (signal?.aborted) return [];
				deadline = nowMs() + 6;
			}
			if (!isRegularValidItem(item) || (libraryID != null && item.libraryID != null && item.libraryID !== libraryID)) continue;
			const id = Number(item.id || 0);
			if (!id || seen.has(id)) continue;

			const title = safeGetItemField(item, 'title') || String(item.title || '');
			seen.add(id);
			if (parsed?.arxiv && !targetDoi) {
				if (verifyAndFilterCandidates([item], parsed).length) results.push({ itemID: id, title, score: 99, source: 'physical-exact', item });
				continue;
			}
			if (targetDoi) {
				const doi = extractDoi(safeGetItemField(item, 'DOI') || String(item.DOI || ''));
				if (doi === targetDoi) {
					results.push({ itemID: id, title, score: 98, source: 'doi', item });
					continue;
				}
				continue;
			}

			let score = 0;
			const year = extractYear(safeGetItemField(item, 'year') || safeGetItemField(item, 'date'));
			if (targetYear && year === targetYear) score += 25;
			const journal = (safeGetItemField(item, 'publicationTitle') || safeGetItemField(item, 'journalAbbreviation')).toLowerCase();
			if (journal && journal.length >= 3 && lowerQuery.includes(journal)) score += 30;
			const pages = safeGetItemField(item, 'pages').replace(/[\u2013\u2014]/g, '-');
			const firstPage = pages.split('-')[0]?.trim().toLowerCase();
			if (firstPage && firstPage.length >= 2 && containsStandaloneToken(lowerQuery, firstPage)) score += 25;
			const creator = String(item.firstCreator || '').toLowerCase().split(',')[0]?.trim();
			if (creator && creator.length >= 2 && lowerQuery.includes(creator)) score += 20;
			if (title && title.length >= 8 && lowerQuery.includes(title.toLowerCase().slice(0, 24))) score += 45;

			if (score >= 45) {
				results.push({ itemID: id, title, score: Math.min(95, score), source: 'library-weighted', item });
			}
		}
		results.sort((a, b) => b.score - a.score);
		return results.slice(0, 8);
	}

	private async fetchLocalLibraryItems(libraryID?: number): Promise<any[]> {
		const hostItems = (globalThis as any).Zotero?.Items;
		const targetLibID = libraryID ?? (globalThis as any).Zotero?.Libraries?.userLibraryID ?? 1;
		const cached = this.localItemsCache.get(targetLibID);
		if (cached && nowMs() < cached.expires) return cached.result;
		if (typeof hostItems?.getAll !== 'function') return [];

		// Cache the pending read too. A detached entry cannot repopulate an invalidated cache.
		const entry = { expires: Infinity, result: Promise.resolve<any[]>([]) };
		entry.result = Promise.resolve().then(() => hostItems.getAll(targetLibID, true, false)).then((items) => {
			if (!Array.isArray(items)) throw new TypeError('Expected library items');
			entry.expires = nowMs() + LOCAL_ITEMS_CACHE_TTL_MS;
			return items;
		}).catch(() => {
			if (this.localItemsCache.get(targetLibID) === entry) this.localItemsCache.delete(targetLibID);
			return [];
		});
		this.localItemsCache.set(targetLibID, entry);
		return entry.result;
	}
}
