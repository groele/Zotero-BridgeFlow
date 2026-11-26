import { isRegularValidItem } from '../../../services/item-resolution.ts';
import { getItemStatus, isStarRatingTag, type StatusOption } from '../../../services/item-status-rating.ts';

export interface CachedCardStaticFields {
	readonly title: string;
	readonly creator: string;
	readonly year: string;
	readonly venue: string;
	readonly itemType: string;
	readonly itemTypeLabel: string;
	readonly dateModified: string;
	readonly pdfAttachmentID: number;
	readonly abstractExcerpt: string;
	readonly tags: readonly string[];
	readonly status: StatusOption | null;
	readonly baseSearchLower: string;
}

const ITEM_TYPE_ZH: Readonly<Record<string, string>> = {
	journalArticle: '期刊文章',
	conferencePaper: '会议论文',
	thesis: '学位论文',
	book: '专著',
	bookSection: '图书章节',
	preprint: '预印本',
	report: '研究报告',
	webpage: '网页资料',
};

const CARD_STATIC_CACHE_LIMIT = 5000;
const cardStaticCache = new Map<number, { signature: string; fields: CachedCardStaticFields }>();

export function clearGalleryCardCache(itemIDs?: Iterable<number>): void {
	if (!itemIDs) {
		cardStaticCache.clear();
		return;
	}
	for (const id of itemIDs) cardStaticCache.delete(id);
}

function safeField(item: any, field: string): string {
	try { return String(item?.getField?.(field) || '').trim(); } catch { return ''; }
}

function resolveVenue(item: any): string {
	for (const f of ['publicationTitle', 'proceedingsTitle', 'conferenceName', 'university', 'publisher', 'repository']) {
		const val = safeField(item, f);
		if (val) return val;
	}
	return '';
}

function formatCreatorLine(item: any, zh: boolean): string {
	const first = String(item?.firstCreator || '').trim();
	if (first && (first.includes('等') || first.toLowerCase().includes('et al'))) return first;
	try {
		const creators = item?.getCreators?.();
		if (Array.isArray(creators) && creators.length > 1) {
			const lead = String(creators[0]?.lastName || creators[0]?.name || first).trim();
			if (lead) return zh ? `${lead} 等` : `${lead} et al.`;
		}
	} catch { /* ignore */ }
	return first;
}

function resolvePrimaryPdfAttachmentID(item: any): number {
	try {
		const attIDs: number[] = isRegularValidItem(item) && typeof item?.getAttachments === 'function' ? (item.getAttachments() || []) : [];
		const hostItems = (globalThis as any).Zotero?.Items;
		for (const rawId of attIDs) {
			const id = Number(rawId) || 0;
			if (!id) continue;
			const att = hostItems?.get?.(id);
			if (!att || att.deleted) continue;
			const ct = String(att.attachmentContentType || '').toLowerCase();
			const fn = String(att.attachmentFilename || att.getField?.('title') || '').toLowerCase();
			if (ct === 'application/pdf' || fn.endsWith('.pdf') || att.isPDFAttachment?.()) return id;
		}
	} catch { /* ignore */ }
	return 0;
}

function extractCleanTags(item: any, excludedStatusTag: string): string[] {
	if (typeof item?.getTags !== 'function') return [];
	const excludedLower = String(excludedStatusTag || '/Citations').trim().toLowerCase();
	const out: string[] = [];
	for (const entry of item.getTags() || []) {
		const t = String(entry?.tag || '').trim();
		if (t && t.toLowerCase() !== excludedLower && isStarRatingTag(t) === 0) out.push(t);
	}
	return out;
}

export function resolveCachedCardStatic(ref: any, itemID: number, zh: boolean, excludedStatusTag: string): CachedCardStaticFields {
	const stamp = String(ref.version ?? ref.dateModified ?? '');
	const signature = `${stamp}:${excludedStatusTag}:${zh ? 1 : 0}`;
	if (stamp) {
		const cached = cardStaticCache.get(itemID);
		if (cached?.signature === signature) {
			cardStaticCache.delete(itemID);
			cardStaticCache.set(itemID, cached);
			return cached.fields;
		}
	}
	const title = safeField(ref, 'title') || String(ref.title || `#${itemID}`);
	const rawDate = safeField(ref, 'year') || safeField(ref, 'date');
	const yearMatch = /\b(19\d\d|20\d\d)\b/.exec(rawDate);
	const year = yearMatch ? yearMatch[1] : rawDate.slice(0, 4);
	const creator = formatCreatorLine(ref, zh);
	const venue = resolveVenue(ref);
	const itemType = String(ref.itemType || (globalThis as any).Zotero?.ItemTypes?.getName?.(ref.itemTypeID) || 'journalArticle');
	const tags = extractCleanTags(ref, excludedStatusTag);
	const status = getItemStatus(ref, excludedStatusTag);
	let attachmentID: number | undefined;
	let abstractExcerpt: string | undefined;
	const built: CachedCardStaticFields = {
		title,
		creator,
		year,
		venue,
		itemType,
		itemTypeLabel: (zh ? ITEM_TYPE_ZH[itemType] : '') || itemType,
		dateModified: String(ref.dateModified || ''),
		get pdfAttachmentID() { return attachmentID ??= resolvePrimaryPdfAttachmentID(ref); },
		get abstractExcerpt() { return abstractExcerpt ??= safeField(ref, 'abstractNote').replace(/\s+/g, ' ').slice(0, 620); },
		tags,
		status,
		baseSearchLower: `${title} ${creator} ${year} ${venue} ${status?.label || ''} ${tags.join(' ')}`.toLowerCase(),
	};
	if (stamp) {
		cardStaticCache.delete(itemID);
		if (cardStaticCache.size >= CARD_STATIC_CACHE_LIMIT) {
			const oldest = cardStaticCache.keys().next().value;
			if (oldest !== undefined) cardStaticCache.delete(oldest);
		}
		cardStaticCache.set(itemID, { signature, fields: built });
	}
	return built;
}
