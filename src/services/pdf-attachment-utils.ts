import {
	isItemTrashedOrDeleted,
	isRegularValidItem,
	normalizeToRegularItemAsync,
	safeGetItemField,
} from './item-resolution.ts';

export interface ResolvedPdfAttachment {
	readonly item: any;
	readonly id: number;
	readonly title: string;
	readonly filename: string;
}

export function getPdfAttachmentSortRank(rawTitle: string, filename: string, isBest = false): number {
	const probe = `${rawTitle} ${filename}`;
	const isSupp = /\[补充材料\]|【补充材料】|\[附(?:件|录|表|图)?\]|(?:\b|_|-)(?:supp(?:lement(?:ary|al)?)?|si|supporting[\s_-]*info(?:rmation)?|appendix)(?:\b|_|\.pdf|$)/i.test(probe);
	const isReview = /\[审稿|\[回复|(?:\b|_|-)(?:peer[\s_-]*review|rebuttal|response[\s_-]*to[\s_-]*reviewers?)(?:\b|_|\.pdf|$)/i.test(probe);
	const isMain = /\[正文\]|【正文】|(?:\b|_|-)(?:main|manuscript)(?:\b|_|\.pdf|$)/i.test(probe);
	if (isMain && !isSupp) return 0;
	if (!isSupp && !isReview) return isBest ? 1 : 2;
	if (isSupp) return 3;
	return 4;
}

export function formatPdfAttachmentDisplayTitle(
	rawTitle: string,
	filename: string,
	index: number,
	hasDuplicateRawTitle = false,
): string {
	const t = String(rawTitle || '').trim();
	const f = String(filename || '').trim();
	if (!t) return f || `PDF ${index + 1}`;
	if (!f || t.toLowerCase() === f.toLowerCase() || t.toLowerCase().endsWith('.pdf')) return t;
	const hasRolePrefix = /^(?:\[[^\]]+\]|【[^】]+】)/.test(t);
	if ((hasRolePrefix || t.length > 32) && !hasDuplicateRawTitle) {
		return t;
	}
	const shortFile = f.length > 36 ? `…${f.slice(-24)}` : f;
	return `${t} (${shortFile})`;
}

export function formatCompactPdfOptionLabel(title: string, maxChars = 40): string {
	const clean = String(title || '').replace(/\s+/g, ' ').trim();
	if (clean.length <= maxChars) return clean;
	if (/^(?:\[[^\]]+\]|【[^】]+】)/.test(clean)) {
		return `${clean.slice(0, maxChars - 1).trimEnd()}…`;
	}
	const tailLen = Math.min(18, Math.floor((maxChars - 1) * 0.45));
	const headLen = Math.max(12, maxChars - 1 - tailLen);
	return `${clean.slice(0, headLen).trimEnd()}…${clean.slice(-tailLen).trimStart()}`;
}

export async function resolvePdfAttachments(item: any): Promise<ResolvedPdfAttachment[]> {
	if (isItemTrashedOrDeleted(item)) return [];
	const hostItems = (globalThis as any).Zotero?.Items;
	const owner = await normalizeToRegularItemAsync(item);
	const target = owner || item;
	const candidates: any[] = [];
	const seen = new Set<number>();
	const pushIfPdf = (att: any) => {
		if (!att || isItemTrashedOrDeleted(att) || !att.isPDFAttachment?.()) return;
		const id = Number(att.id || 0);
		if (id > 0 && seen.has(id)) return;
		if (id > 0) seen.add(id);
		candidates.push(att);
	};
	const best = typeof target?.getBestAttachment === 'function'
		? await target.getBestAttachment().catch(() => null)
		: null;
	const bestID = Number(best?.id || 0);
	pushIfPdf(best);
	if (isRegularValidItem(target) && typeof target?.getAttachments === 'function') {
		const ids: number[] = target.getAttachments() || [];
		for (const id of ids) {
			const att = hostItems?.get?.(id) || (hostItems?.getAsync ? await hostItems.getAsync(id).catch(() => null) : null);
			pushIfPdf(att);
		}
	}
	pushIfPdf(item);
	const rawList = candidates.map((att, origIdx) => {
		const id = Number(att.id || 0);
		const rawTitle = safeGetItemField(att, 'title').trim();
		const filename = String(att.attachmentFilename || '').trim();
		const rank = getPdfAttachmentSortRank(rawTitle, filename, id > 0 && id === bestID);
		return { att, id, rawTitle, filename, rank, origIdx };
	});
	rawList.sort((a, b) => (a.rank - b.rank) || (a.origIdx - b.origIdx));
	const titleCounts = new Map<string, number>();
	for (const r of rawList) {
		if (r.rawTitle) titleCounts.set(r.rawTitle.toLowerCase(), (titleCounts.get(r.rawTitle.toLowerCase()) || 0) + 1);
	}
	return rawList.map((r, idx) => ({
		item: r.att,
		id: r.id,
		title: formatPdfAttachmentDisplayTitle(
			r.rawTitle,
			r.filename,
			idx,
			Boolean(r.rawTitle && (titleCounts.get(r.rawTitle.toLowerCase()) || 0) > 1),
		),
		filename: r.filename,
	}));
}

export async function resolveBestFileAttachment(itemOrID: any): Promise<any | null> {
	const hostItems = (globalThis as any).Zotero?.Items;
	const item = typeof itemOrID === 'number'
		? (hostItems?.get?.(itemOrID) || await hostItems?.getAsync?.(itemOrID))
		: itemOrID;
	if (!item || isItemTrashedOrDeleted(item)) return null;
	if (item.isFileAttachment?.()) return item;
	const best = await item.getBestAttachment?.().catch(() => null);
	if (best && !isItemTrashedOrDeleted(best) && (best.isFileAttachment?.() ?? true)) return best;
	const owner = await normalizeToRegularItemAsync(item);
	const pdfs = await resolvePdfAttachments(owner || item);
	return pdfs[0]?.item ?? null;
}
