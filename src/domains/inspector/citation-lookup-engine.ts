import type { CitationHistoryStore } from '../../services/citation-history-store.ts';
import { isRegularValidItem } from '../../services/item-resolution.ts';

export interface LookupCandidate {
	readonly itemID: number;
	readonly title: string;
	readonly score: number;
	readonly source: 'history-exact' | 'history-fuzzy' | 'doi' | 'library-weighted';
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

/**
 * Compact citation reverse-lookup engine.
 * Priority: 1. Local CitationHistoryStore (exact/fuzzy) -> 2. DOI -> 3. Weighted library metadata match.
 */
export class CitationLookupEngine {
	private readonly history: CitationHistoryStore;

	constructor(history: CitationHistoryStore) {
		this.history = history;
	}

	async lookup(rawQuery: string, libraryItems?: readonly any[]): Promise<LookupCandidate[]> {
		const query = String(rawQuery || '').trim();
		if (!query) return [];

		// 1. Exact history hit (sub-millisecond)
		const exact = this.history.lookupExact(query);
		if (exact) {
			return [{ itemID: exact.itemID, title: exact.title, score: 100, source: 'history-exact' }];
		}

		// 2. Fuzzy history hit
		const fuzzy = this.history.searchFuzzy(query, 3);
		const results: LookupCandidate[] = fuzzy.map((rec) => ({
			itemID: rec.itemID,
			title: rec.title,
			score: 85,
			source: 'history-fuzzy',
		}));

		// 3. Library items lookup (DOI + weighted year/title/author/journal scoring)
		const candidates = libraryItems ?? await this.fetchLocalLibraryItems();
		const targetDoi = extractDoi(query);
		const targetYear = extractYear(query);
		const lowerQuery = query.toLowerCase();
		const seen = new Set(results.map((r) => r.itemID));

		for (const item of candidates) {
			if (!isRegularValidItem(item)) continue;
			const id = Number(item.id || 0);
			if (!id || seen.has(id)) continue;

			const title = String(item.getField?.('title') || item.title || '');
			const doi = String(item.getField?.('DOI') || item.DOI || '').trim().toLowerCase();
			if (targetDoi && doi && doi === targetDoi) {
				seen.add(id);
				results.push({ itemID: id, title, score: 98, source: 'doi' });
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

			if (title && title.length >= 8 && lowerQuery.includes(title.toLowerCase().slice(0, 24))) {
				score += 45;
			}

			if (score >= 45) {
				seen.add(id);
				results.push({ itemID: id, title, score: Math.min(95, score), source: 'library-weighted' });
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
