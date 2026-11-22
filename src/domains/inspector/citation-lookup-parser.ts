import { safeGetItemField } from '../../services/item-resolution.ts';

export interface ParsedCitation {
	raw: string;
	journalText: string;
	year: number;
	volume?: string;
	issue?: string;
	firstPage?: string;
	lastPage?: string;
	pages?: string;
	doi?: string;
	arxiv?: string;
	authorPrefix?: string;
}

export function extractIdentifier(input: string): { doi?: string; arxiv?: string } {
	const doiMatch = input.match(/\b(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)\b/i);
	const arxivMatch =
		input.match(/\b(?:arXiv:\s*|arxiv\.org\/(?:abs|pdf)\/)(\d{4}\.\d{4,5}(?:v\d+)?)\b/i) ||
		input.trim().match(/^(\d{4}\.\d{4,5}(?:v\d+)?)$/i);
	return {
		doi: doiMatch ? doiMatch[1].replace(/[.,;)]+$/, '') : undefined,
		arxiv: arxivMatch ? arxivMatch[1] : undefined,
	};
}

export function stripAuthorPrefix(text: string): { authors?: string; rest: string } {
	const quoteMatch = text.match(/^(.+?)[,.\s]+["\u201c].+?["\u201d][,.\s]+(.+)$/);
	if (quoteMatch) {
		return { authors: quoteMatch[1].trim(), rest: quoteMatch[2].replace(/^in\s+/i, '').trim() };
	}
	const gbtMatch = text.match(/^([^.]+?)\.\s*.+?\[J\][.,\s]+(.+)$/i);
	if (gbtMatch) {
		return { authors: gbtMatch[1].trim(), rest: gbtMatch[2].trim() };
	}
	const etAlMatch = text.match(/^(.+?\bet\s+al\.?),?\s+(.+)$/i);
	if (etAlMatch) {
		return { authors: etAlMatch[1].trim(), rest: etAlMatch[2].trim() };
	}
	const semiMatch = text.match(/^([^;]+(?:;\s*[^;]+)+)[,;]\s+([A-Z].+)$/);
	if (semiMatch) {
		return { authors: semiMatch[1].trim(), rest: semiMatch[2].trim() };
	}
	return { rest: text };
}

export function normalizeJournal(name: string): string {
	return name
		.toLowerCase()
		.replace(/&/g, 'and')
		.replace(/[.,]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

export function parseCompactCitation(input: string): ParsedCitation | null {
	if (!input || typeof input !== 'string') return null;
	const clean = input
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^(?:\[\d+\]\s*|\(\d+\)\s*|\d{1,3}[.)]\s+|•\s*)/, '')
		.replace(/\.+$/, '')
		.replace(/[\u2010-\u2015\u2212]/g, '-');
	const ids = extractIdentifier(clean);

	let stripped = clean;
	if (ids.doi) {
		stripped = stripped.replace(/(?:doi:?\s*|https?:\/\/(?:dx\.)?doi\.org\/)?10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/i, '').trim().replace(/[.,;:]+$/, '');
	}
	if (ids.arxiv) {
		stripped = stripped.replace(/(?:https?:\/\/)?(?:arXiv:\s*|arxiv\.org\/(?:abs|pdf)\/)?\b\d{4}\.\d{4,5}(?:v\d+)?\b/i, '').trim().replace(/[.,;:]+$/, '');
	}
	const { authors, rest: target } = stripAuthorPrefix(stripped);

	const m1 = target.match(/^(.+?)[,\s;:]+(\d{4})[,\s;:]+(?:vol\.?\s*)?(\d+)(?:\s*\(([\w-]+)\))?[,\s;:]+(?:pp?\.?\s*)?([A-Za-z]*\d+)(?:-([A-Za-z]*\d+))?$/i);
	if (m1) {
		return {
			raw: input,
			journalText: m1[1].trim(),
			year: parseInt(m1[2], 10),
			volume: m1[3].trim(),
			issue: m1[4] || undefined,
			firstPage: m1[5].trim(),
			lastPage: m1[6] ? m1[6].trim() : undefined,
			pages: m1[6] ? `${m1[5].trim()}-${m1[6].trim()}` : m1[5].trim(),
			authorPrefix: authors,
			...ids,
		};
	}

	const m2 = target.match(/^(.+?)[,\s]+(?:vol\.?\s*)?(\d+)(?:\s*\(([\w-]+)\))?\s*\((\d{4})\)[,\s;:]+(?:pp?\.?\s*)?([A-Za-z]*\d+)(?:-([A-Za-z]*\d+))?$/i);
	if (m2) {
		return {
			raw: input,
			journalText: m2[1].trim(),
			volume: m2[2].trim(),
			issue: m2[3] || undefined,
			year: parseInt(m2[4], 10),
			firstPage: m2[5].trim(),
			lastPage: m2[6] ? m2[6].trim() : undefined,
			pages: m2[6] ? `${m2[5].trim()}-${m2[6].trim()}` : m2[5].trim(),
			authorPrefix: authors,
			...ids,
		};
	}

	const m3 = target.match(/^(.+?)[,\s]+(?:vol\.?\s*)?(\d+)(?:(?:\s*\(([\w-]+)\))|[,\s]+(?:no\.?|issue)\s*([\w-]+))?[,\s;:]+(?:pp?\.?\s*)?([A-Za-z]*\d+)(?:-([A-Za-z]*\d+))?(?:\s*\((\d{4})\)|[,\s]+(?:[A-Za-z]+\.?\s+)?(\d{4}))$/i);
	if (m3) {
		return {
			raw: input,
			journalText: m3[1].trim(),
			volume: m3[2].trim(),
			issue: m3[3] || m3[4] || undefined,
			year: parseInt(m3[7] || m3[8], 10),
			firstPage: m3[5].trim(),
			lastPage: m3[6] ? m3[6].trim() : undefined,
			pages: m3[6] ? `${m3[5].trim()}-${m3[6].trim()}` : m3[5].trim(),
			authorPrefix: authors,
			...ids,
		};
	}

	if (ids.doi || ids.arxiv) {
		return { raw: input, journalText: '', year: 0, authorPrefix: authors, ...ids };
	}
	return null;
}

export function isJournalMatch(queryJournal: string, pubTitle: string, abbr: string): boolean {
	const qNorm = normalizeJournal(queryJournal);
	const pubNorm = normalizeJournal(pubTitle);
	const abbrNorm = normalizeJournal(abbr);
	if (pubNorm === qNorm || abbrNorm === qNorm) return true;
	if (!qNorm) return false;

	const stopwords = new Set(['of', 'the', 'and', 'for', 'in', 'on', 'a', 'an']);
	const pubAcronym = pubNorm.split(' ').filter((w) => !stopwords.has(w)).map((w) => w[0]).join('');
	if (pubAcronym && pubAcronym === qNorm) return true;
	const abbrAcronym = abbrNorm.split(' ').filter((w) => !stopwords.has(w)).map((w) => w[0]).join('');
	if (abbrAcronym && abbrAcronym === qNorm) return true;

	const qTokens = qNorm.split(' ').filter((t) => t.length > 0 && !stopwords.has(t));
	if (!qTokens.length) return false;
	const lastToken = qTokens[qTokens.length - 1];
	if (lastToken && lastToken.length === 1 && /[a-z]/i.test(lastToken)) {
		const pubLast = pubNorm.split(' ').pop();
		const abbrLast = abbrNorm.split(' ').pop();
		if (pubLast !== lastToken && abbrLast !== lastToken) return false;
	}

	const matchTokens = (targetNorm: string) => {
		if (!targetNorm) return false;
		const tokens = targetNorm.split(' ').filter((token) => token.length > 0 && !stopwords.has(token));
		return tokens.length === qTokens.length && qTokens.every((token, index) => tokens[index].startsWith(token));
	};
	return matchTokens(pubNorm) || matchTokens(abbrNorm);
}

export async function queryPhysicalCandidates(parsed: ParsedCitation, libraryID?: number): Promise<any[]> {
	const host = (globalThis as any).Zotero;
	if (!host?.Items) return [];
	const runSearch = async (libID?: number): Promise<number[]> => {
		if (!host.Search) return [];
		try {
			const s = new host.Search();
			if (libID !== undefined && libID !== null) s.libraryID = libID;
			if (parsed.doi) {
				s.addCondition('DOI', 'is', parsed.doi);
			} else if (parsed.arxiv && !parsed.journalText) {
				s.addCondition('quicksearch-everything', 'contains', parsed.arxiv.replace(/v\d+$/, ''));
			} else {
				s.addCondition('itemType', 'is', 'journalArticle');
				if (parsed.year) {
					try { s.addCondition('date', 'contains', String(parsed.year)); } catch { /* ignore */ }
				}
			}
			return (await s.search()) || [];
		} catch {
			return [];
		}
	};
	let ids = await runSearch(libraryID);
	if (!ids.length && libraryID !== undefined) ids = await runSearch(undefined);
	if (ids.length && host.Items.getAsync) {
		const items = await host.Items.getAsync(ids).catch(() => []);
		return Array.isArray(items) ? items : (items ? [items] : []);
	}
	if (typeof host.Items.getAll === 'function') {
		const targetLib = libraryID ?? host.Libraries?.userLibraryID ?? 1;
		return (await host.Items.getAll(targetLib, true, false).catch(() => [])) || [];
	}
	return [];
}

function expandEndPage(first?: string, last?: string): string | undefined {
	if (!first || !last) return last;
	if (/^\d+$/.test(first) && /^\d+$/.test(last) && first.length > last.length) {
		const expanded = first.slice(0, first.length - last.length) + last;
		if (parseInt(expanded, 10) > parseInt(first, 10)) return expanded;
	}
	return last;
}

export function verifyAndFilterCandidates(candidates: readonly any[], parsed: ParsedCitation): any[] {
	const matched = candidates.filter((item) => {
		if (!item || item.deleted || !item.isRegularItem?.()) return false;
		if (parsed.doi) {
			const itemDoi = safeGetItemField(item, 'DOI').trim().toLowerCase();
			return itemDoi === parsed.doi.toLowerCase();
		}
		if (parsed.arxiv && !parsed.journalText) {
			const [, qBase = '', qVer] = parsed.arxiv.toLowerCase().match(/^(\d{4}\.\d{4,5})(?:v(\d+))?$/) || [
				'',
				parsed.arxiv.toLowerCase().replace(/v\d+$/, ''),
				undefined,
			];
			const fields = ['archiveID', 'extra', 'DOI', 'url', 'callNumber'].map((f) => safeGetItemField(item, f).toLowerCase());
			return fields.some((val) => {
				for (const m of val.matchAll(/(?:^|[^0-9])(\d{4}\.\d{4,5})(?:v(\d+))?(?=$|[^0-9])/g)) {
					if (m[1] === qBase && (!qVer || !m[2] || m[2] === qVer)) return true;
				}
				return false;
			});
		}
		if (parsed.year) {
			const itemYear = (safeGetItemField(item, 'year') || safeGetItemField(item, 'date')).match(/\b(19|20)\d{2}\b/)?.[0];
			if (!itemYear || Number(itemYear) !== parsed.year) return false;
		}
		const rawPages = safeGetItemField(item, 'pages').replace(/[\u2010-\u2015\u2212]/g, '-').trim();
		const [first, last] = rawPages.split('-');
		const normItemLast = expandEndPage(first, last);
		const normParsedLast = expandEndPage(parsed.firstPage, parsed.lastPage);
		if (parsed.firstPage && first !== parsed.firstPage) return false;
		if (normParsedLast && normItemLast !== normParsedLast) return false;
		if (parsed.volume && safeGetItemField(item, 'volume').trim() !== parsed.volume) return false;
		if (parsed.issue && safeGetItemField(item, 'issue') !== parsed.issue) return false;
		const pubTitle = safeGetItemField(item, 'publicationTitle');
		const abbr = safeGetItemField(item, 'journalAbbreviation');
		return isJournalMatch(parsed.journalText, pubTitle, abbr);
	});

	if (matched.length > 1 && parsed.authorPrefix) {
		const surname = parsed.authorPrefix.replace(/\bet\s+al\.?/i, '').trim().split(/[,;\s]+/)[0]?.toLowerCase();
		if (surname && surname.length >= 2) {
			const byAuthor = matched.filter((it) => {
				const creators = it.getCreators?.() || [];
				const firstCreator = String(it.firstCreator || safeGetItemField(it, 'firstCreator')).toLowerCase();
				return firstCreator.includes(surname) || creators.some((c: any) => String(c.lastName || c.name || '').toLowerCase().includes(surname));
			});
			if (byAuthor.length > 0) return byAuthor;
		}
	}
	return matched;
}
