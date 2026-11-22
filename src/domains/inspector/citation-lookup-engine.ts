import type { CitationHistoryStore } from '../../services/citation-history-store.ts';
import { isRegularValidItem } from '../../services/item-resolution.ts';
import {
	parseCompactCitation, queryPhysicalCandidates, verifyAndFilterCandidates, type ParsedCitation,
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

const DOI_REGEX = /\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)\b/i;
const YEAR_REGEX = /\b(19|20)\d{2}\b/;

export function extractDoi(input: string): string {
	const match = String(input || '').match(DOI_REGEX);
	return match ? match[1].replace(/[.,;)\]]+$/, '').toLowerCase() : '';
}

export function extractYear(input: string): string {
	const match = String(input || '').match(YEAR_REGEX);
	return match ? match[0] : '';
}

export class CitationLookupEngine {
	private readonly history: CitationHistoryStore;

	constructor(history: CitationHistoryStore) {
		this.history = history;
	}

	async resolveRich(
		rawQuery: string,
		options: { libraryID?: number; useHistory?: boolean; libraryItems?: readonly any[] } = {},
	): Promise<RichLookupOutcome> {
		const query = String(rawQuery || '').trim();
		if (!query) return { parsed: null, historyMatched: false, candidates: [] };

		if (options.useHistory !== false) {
			const exact = this.history.lookupExact(query);
			if (exact) {
				const liveItem = await this.resolveLiveItem(exact.itemID);
				if (liveItem || options.libraryItems) {
					return {
						parsed: null,
						historyMatched: true,
						candidates: [{ itemID: exact.itemID, title: liveItem ? String(liveItem.getField?.('title') || exact.title) : exact.title, score: 100, source: 'history-exact', item: liveItem }],
					};
				}
			}

			const fuzzy = this.history.searchFuzzy(query, 5);
			if (fuzzy.length) {
				const liveHits: LookupCandidate[] = [];
				for (const rec of fuzzy) {
					const liveItem = await this.resolveLiveItem(rec.itemID);
					if (liveItem) {
						liveHits.push({
							itemID: rec.itemID,
							title: String(liveItem.getField?.('title') || rec.title),
							score: 90,
							source: 'history-fuzzy',
							item: liveItem,
						});
					} else if (options.libraryItems) {
						liveHits.push({ itemID: rec.itemID, title: rec.title, score: 85, source: 'history-fuzzy' });
					}
				}
				if (liveHits.length) {
					return { parsed: null, historyMatched: true, candidates: liveHits };
				}
			}
		}

		const parsed = parseCompactCitation(query);
		if (parsed && !options.libraryItems) {
			const physical = await queryPhysicalCandidates(parsed, options.libraryID);
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
			return { parsed, historyMatched: false, candidates: [] };
		}

		const weighted = await this.weightedSearch(query, options.libraryItems);
		return { parsed, historyMatched: false, candidates: weighted };
	}

	async lookup(rawQuery: string, libraryItems?: readonly any[]): Promise<LookupCandidate[]> {
		const outcome = await this.resolveRich(rawQuery, { useHistory: true, libraryItems });
		return [...outcome.candidates];
	}

	private async resolveLiveItem(itemID: number): Promise<any | null> {
		const hostItems = (globalThis as any).Zotero?.Items;
		if (!hostItems) return null;
		const item = typeof hostItems.getAsync === 'function'
			? await hostItems.getAsync(itemID).catch(() => null)
			: hostItems.get?.(itemID);
		if (!item || item.deleted || item.isTrashed?.() || !item.isRegularItem?.()) return null;
		return item;
	}

	private async weightedSearch(query: string, libraryItems?: readonly any[]): Promise<LookupCandidate[]> {
		const candidates = libraryItems ?? await this.fetchLocalLibraryItems();
		const targetDoi = extractDoi(query);
		const targetYear = extractYear(query);
		const lowerQuery = query.toLowerCase();
		const results: LookupCandidate[] = [];
		const seen = new Set<number>();

		for (const item of candidates) {
			if (!isRegularValidItem(item)) continue;
			const id = Number(item.id || 0);
			if (!id || seen.has(id)) continue;

			const title = String(item.getField?.('title') || item.title || '');
			const doi = String(item.getField?.('DOI') || item.DOI || '').trim().toLowerCase();
			if (targetDoi && doi && doi === targetDoi) {
				seen.add(id);
				results.push({ itemID: id, title, score: 98, source: 'doi', item });
				continue;
			}

			let score = 0;
			const year = String(item.getField?.('year') || item.getField?.('date') || '').slice(0, 4);
			if (targetYear && year === targetYear) score += 25;
			const journal = String(item.getField?.('publicationTitle') || item.getField?.('journalAbbreviation') || '').toLowerCase();
			if (journal && journal.length >= 3 && lowerQuery.includes(journal)) score += 30;
			const pages = String(item.getField?.('pages') || '').replace(/[\u2013\u2014]/g, '-');
			const firstPage = pages.split('-')[0]?.trim();
			if (firstPage && firstPage.length >= 2 && lowerQuery.includes(firstPage)) score += 25;
			const creator = String(item.firstCreator || '').toLowerCase().split(',')[0]?.trim();
			if (creator && creator.length >= 2 && lowerQuery.includes(creator)) score += 20;
			if (title && title.length >= 8 && lowerQuery.includes(title.toLowerCase().slice(0, 24))) score += 45;

			if (score >= 45) {
				seen.add(id);
				results.push({ itemID: id, title, score: Math.min(95, score), source: 'library-weighted', item });
			}
		}
		results.sort((a, b) => b.score - a.score);
		return results.slice(0, 8);
	}

	private async fetchLocalLibraryItems(): Promise<any[]> {
		const hostItems = (globalThis as any).Zotero?.Items;
		const userLibID = (globalThis as any).Zotero?.Libraries?.userLibraryID ?? 1;
		if (typeof hostItems?.getAll === 'function') {
			try {
				return await hostItems.getAll(userLibID, true, false);
			} catch {
				return [];
			}
		}
		return [];
	}
}
