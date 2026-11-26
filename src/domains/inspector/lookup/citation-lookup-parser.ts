import { extractIdentifier, MAX_CITATION_INPUT_LEN } from '../../../services/citation-identifier.ts';
export { extractIdentifier } from '../../../services/citation-identifier.ts';
import { isRegularValidItem, safeGetItemField } from '../../../services/item-resolution.ts';

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

export function stripAuthorPrefix(text: string): { authors?: string; rest: string } {
	const bounded = text.length > MAX_CITATION_INPUT_LEN ? text.slice(0, MAX_CITATION_INPUT_LEN) : text;
	let openQuote = -1;
	let closeChar = '';
	for (let i = 0; i < bounded.length; i++) {
		const ch = bounded[i];
		if (ch === '"' || ch === '\u201c') {
			openQuote = i;
			closeChar = ch === '\u201c' ? '\u201d' : '"';
			break;
		}
	}
	if (openQuote > 0 && /[,.\s]$/.test(bounded.slice(0, openQuote))) {
		let closeQuote = bounded.indexOf(closeChar, openQuote + 1);
		if (closeQuote < 0 && closeChar === '\u201d') closeQuote = bounded.indexOf('"', openQuote + 1);
		if (closeQuote > openQuote + 1) {
			const afterQuote = bounded.slice(closeQuote + 1);
			if (/^[,.\s]+\S/.test(afterQuote)) {
				const authors = bounded.slice(0, openQuote).replace(/[,.\s]+$/, '').trim();
				const rest = afterQuote.replace(/^[,.\s]+/, '').replace(/^in\s+/i, '').trim();
				if (authors && rest) return { authors, rest };
			}
		}
	}

	const jTagIdx = bounded.toLowerCase().indexOf('[j]');
	if (jTagIdx > 1) {
		const dotIdx = bounded.indexOf('.');
		const afterJ = bounded.slice(jTagIdx + 3);
		if (dotIdx > 0 && dotIdx < jTagIdx && /^[.,\s]+\S/.test(afterJ)) {
			const authors = bounded.slice(0, dotIdx).trim();
			const rest = afterJ.replace(/^[.,\s]+/, '').trim();
			if (authors && rest) return { authors, rest };
		}
	}

	const etAlHit = /\bet\s+al\.?(?:,\s*|\s+)/i.exec(bounded);
	if (etAlHit && etAlHit.index > 0) {
		const endIdx = etAlHit.index + etAlHit[0].length;
		const rest = bounded.slice(endIdx).trim();
		const authors = bounded.slice(0, endIdx).replace(/(?:,\s*|\s+)$/, '').trim();
		if (authors && rest) return { authors, rest };
	}

	if (bounded.includes(';')) {
		const parts = bounded.split(';');
		if (parts.length >= 2 && parts.slice(0, -1).every((p) => p.trim().length > 0)) {
			const lastPart = parts[parts.length - 1];
			const commaSplit = lastPart.match(/^(.+),\s+([A-Z].+)$/);
			if (commaSplit) {
				const authors = [...parts.slice(0, -1), commaSplit[1]].join(';').trim();
				const rest = commaSplit[2].trim();
				if (authors && rest) return { authors, rest };
			}
			if (parts.length >= 3 && /^\s+[A-Z]/.test(lastPart)) {
				const authors = parts.slice(0, -1).join(';').trim();
				const rest = lastPart.trim();
				if (authors && rest) return { authors, rest };
			}
		}
	}
	return { rest: bounded };
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
	const bounded = input.length > MAX_CITATION_INPUT_LEN ? input.slice(0, MAX_CITATION_INPUT_LEN) : input;
	const clean = bounded
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

export async function queryPhysicalCandidates(parsed: ParsedCitation, libraryID?: number, signal?: AbortSignal): Promise<any[]> {
	const host = (globalThis as any).Zotero;
	if (!host?.Items || !host.Search || signal?.aborted) return [];
	const scope = libraryID ?? host.Libraries?.userLibraryID;
	const search = new host.Search();
	if (scope != null) search.libraryID = scope;
	if (parsed.doi) {
		search.addCondition('DOI', 'is', parsed.doi);
	} else if (parsed.arxiv) {
		search.addCondition('quicksearch-everything', 'contains', parsed.arxiv.replace(/v\d+$/, ''));
	} else {
		search.addCondition('itemType', 'is', 'journalArticle');
		if (parsed.year) search.addCondition('date', 'contains', String(parsed.year));
	}
	const ids: number[] = await search.search();
	if (signal?.aborted || !ids?.length) return [];
	const loaded = typeof host.Items.getAsync === 'function'
		? await host.Items.getAsync(ids)
		: ids.map(id => host.Items.get?.(id));
	return (Array.isArray(loaded) ? loaded : [loaded]).filter(item => item
		&& (scope == null || item.libraryID == null || item.libraryID === scope));
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
		if (!isRegularValidItem(item)) return false;
		if (parsed.doi) {
			const itemDoi = extractIdentifier(safeGetItemField(item, 'DOI')).doi;
			return itemDoi === parsed.doi.toLowerCase();
		}
		if (parsed.arxiv) {
			const [, qBase = '', qVer] = parsed.arxiv.toLowerCase().match(/^(\d{4}\.\d{4,5})(?:v(\d+))?$/) || [
				'',
				parsed.arxiv.toLowerCase().replace(/v\d+$/, ''),
				undefined,
			];
			const fields = ['archiveID', 'extra', 'DOI', 'url', 'callNumber'].map((f) => safeGetItemField(item, f).toLowerCase());
			return fields.some((val) => {
				for (const m of val.matchAll(/(?:^|[^0-9])(\d{4}\.\d{4,5})(?:v(\d+))?(?=$|[^0-9])/g)) {
					if (m[1] === qBase && (!qVer || m[2] === qVer)) return true;
				}
				return false;
			});
		}
		if (parsed.year) {
			const itemYear = (safeGetItemField(item, 'year') || safeGetItemField(item, 'date')).match(/\b(18|19|20)\d{2}\b/)?.[0];
			if (!itemYear || Number(itemYear) !== parsed.year) return false;
		}
		const rawPages = safeGetItemField(item, 'pages').replace(/[\u2010-\u2015\u2212]/g, '-').trim();
		const [first, last] = rawPages.split('-').map(page => page.trim());
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
