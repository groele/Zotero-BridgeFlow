import {
	getItemRating,
	listAvailableStatuses,
	setItemRating,
	setItemStatus,
	type RatingStorageLocation,
	type StatusOption,
} from '../../services/item-status-rating.ts';
import { formatReadingProgress, type TabReadingProgress } from '../../services/reading-stats.ts';
import { clearGalleryCardCache, resolveCachedCardStatic } from './gallery-card-cache.ts';

export { clearGalleryCardCache };

export type GalleryMode = 'gallery' | 'board';
export type GalleryContentTab = 'items' | 'notes' | 'annotations';
export type GalleryGroupBy = 'readState' | 'status' | 'rating' | 'year' | 'publication' | 'itemType';
export type GallerySortField = 'dateModified' | 'year' | 'rating' | 'readTime' | 'title';

export interface GalleryCardModel {
	readonly item: any;
	readonly itemID: number;
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
	readonly rating: number;
	readonly briefNote: string;
	readonly readSeconds: number;
	readonly readRatio: number;
	readonly readText: string;
	readonly searchLower?: string;
}

export interface KanbanColumnModel {
	readonly key: string;
	readonly title: string;
	readonly pillBg: string;
	readonly pillFg: string;
	readonly surfaceTint: string;
	readonly color?: string;
	readonly droppable: boolean;
	readonly cards: GalleryCardModel[];
}

const SOFT_TINTS = [
	{ pillBg: '#ffe4e6', pillFg: '#9f1239', surface: 'rgba(244,63,94,0.045)' },
	{ pillBg: '#dcfce7', pillFg: '#166534', surface: 'rgba(34,197,94,0.045)' },
	{ pillBg: '#e0e7ff', pillFg: '#3730a3', surface: 'rgba(99,102,241,0.045)' },
	{ pillBg: '#fef3c7', pillFg: '#92400e', surface: 'rgba(245,158,11,0.045)' },
	{ pillBg: '#e0f2fe', pillFg: '#075985', surface: 'rgba(14,165,233,0.045)' },
	{ pillBg: '#f3e8ff', pillFg: '#6b21a8', surface: 'rgba(168,85,247,0.045)' },
] as const;

type GalleryDependencies = {
	zh?: boolean;
	excludedStatusTag: string;
	ratingStorage: RatingStorageLocation;
	getBriefNote: (item: any) => string;
	getReadProgress: (item: any) => TabReadingProgress | undefined;
};

class GalleryCard implements GalleryCardModel {
	readonly item: any;
	readonly itemID: number;
	readonly dateModified: string;
	private readonly deps: GalleryDependencies;
	private readonly zh: boolean;
	private fields?: ReturnType<typeof resolveCachedCardStatic>;
	private note?: string;
	private stars?: number;
	private progress?: TabReadingProgress | null;

	constructor(item: any, id: number, deps: GalleryDependencies, zh: boolean) {
		this.item = item;
		this.itemID = id;
		this.dateModified = String(item.dateModified || '');
		this.deps = deps;
		this.zh = zh;
	}
	private get stat() { return this.fields ??= resolveCachedCardStatic(this.item, this.itemID, this.zh, this.deps.excludedStatusTag); }
	private get reading() {
		if (this.progress === undefined) this.progress = this.deps.getReadProgress(this.item) ?? null;
		return this.progress;
	}
	get title() { return this.stat.title; }
	get creator() { return this.stat.creator; }
	get year() { return this.stat.year; }
	get venue() { return this.stat.venue; }
	get itemType() { return this.stat.itemType; }
	get itemTypeLabel() { return this.stat.itemTypeLabel; }
	get pdfAttachmentID() { return this.stat.pdfAttachmentID; }
	get abstractExcerpt() { return this.stat.abstractExcerpt; }
	get tags() { return this.stat.tags; }
	get status() { return this.stat.status; }
	get rating() { return this.stars ??= getItemRating(this.item, this.deps.ratingStorage); }
	get briefNote() { return this.note ??= this.deps.getBriefNote(this.item); }
	get readSeconds() { return Number(this.reading?.readSeconds || 0); }
	get readRatio() {
		const p = this.reading;
		return p?.totalPages && p.totalPages > 0 && p.lastPage ? Math.min(1, Math.max(0, p.lastPage / p.totalPages)) : 0;
	}
	get readText() { return formatReadingProgress(this.reading ?? undefined).text; }
	get searchLower() { return this.briefNote ? this.stat.baseSearchLower + ' ' + this.briefNote.toLowerCase() : this.stat.baseSearchLower; }
}

export function extractGalleryCards(win: Window, deps: GalleryDependencies): { cards: GalleryCardModel[]; rawItems: any[] } {
	const zh = deps.zh ?? Boolean((globalThis as any).Zotero?.locale?.startsWith?.('zh'));
	const view = (win as any)?.ZoteroPane?.itemsView;
	const hostItems = (globalThis as any).Zotero?.Items;
	const rowCount = Math.min(Number(view?.rowCount || 0), 5000);
	const seen = new Set<number>();
	const rawItems: any[] = [];
	const cards: GalleryCardModel[] = [];

	for (let i = 0; i < rowCount; i++) {
		let ref = view?.getRow?.(i)?.ref;
		if (!ref || ref.deleted) continue;
		if (typeof ref.isRegularItem === 'function' && !ref.isRegularItem()) {
			if (ref.parentItemID) ref = hostItems?.get?.(ref.parentItemID);
			if (!ref || ref.deleted || (typeof ref.isRegularItem === 'function' && !ref.isRegularItem())) continue;
		}
		const itemID = Number(ref.id || 0);
		if (!itemID || seen.has(itemID)) continue;
		seen.add(itemID);
		rawItems.push(ref);

		cards.push(new GalleryCard(ref, itemID, deps, zh));
	}
	return { cards, rawItems };
}

export function filterAndSortGalleryCards(
	cards: readonly GalleryCardModel[],
	query: string,
	sortField: GallerySortField,
): GalleryCardModel[] {
	const q = String(query || '').trim().toLowerCase();
	const filtered = q
		? cards.filter((c) => (c.searchLower ?? `${c.title} ${c.creator} ${c.year} ${c.venue} ${c.status?.label || ''} ${c.briefNote} ${c.tags.join(' ')}`.toLowerCase()).includes(q))
		: [...cards];

	filtered.sort((a, b) => {
		if (sortField === 'year') return (Number(b.year) || 0) - (Number(a.year) || 0) || a.title.localeCompare(b.title);
		if (sortField === 'rating') return b.rating - a.rating || b.readSeconds - a.readSeconds || a.title.localeCompare(b.title);
		if (sortField === 'readTime') return b.readSeconds - a.readSeconds || b.readRatio - a.readRatio || a.title.localeCompare(b.title);
		if (sortField === 'title') return a.title.localeCompare(b.title);
		return b.dateModified.localeCompare(a.dateModified) || b.itemID - a.itemID;
	});
	return filtered;
}

export function buildKanbanColumns(
	cards: readonly GalleryCardModel[],
	rawItems: readonly any[],
	groupBy: GalleryGroupBy,
	zh: boolean,
	excludedStatusTag: string,
): KanbanColumnModel[] {
	if (groupBy === 'readState') {
		const unread: GalleryCardModel[] = [];
		const reading: GalleryCardModel[] = [];
		const deep: GalleryCardModel[] = [];
		const finished: GalleryCardModel[] = [];
		for (const c of cards) {
			if (c.readRatio >= 0.95 && c.readSeconds >= 60) finished.push(c);
			else if (c.readSeconds >= 600) deep.push(c);
			else if (c.readSeconds > 0 || c.readRatio > 0) reading.push(c);
			else unread.push(c);
		}
		return [
			{ key: 'unread', title: zh ? '未读' : 'Unread', pillBg: '#ffe4e6', pillFg: '#9f1239', surfaceTint: 'rgba(244,63,94,0.04)', droppable: false, cards: unread },
			{ key: 'skimming', title: zh ? '阅读中' : 'Reading', pillBg: '#dcfce7', pillFg: '#166534', surfaceTint: 'rgba(34,197,94,0.04)', droppable: false, cards: reading },
			{ key: 'deep', title: zh ? '深读 (≥10m)' : 'Deep (≥10m)', pillBg: '#e0f2fe', pillFg: '#075985', surfaceTint: 'rgba(14,165,233,0.04)', droppable: false, cards: deep },
			{ key: 'finished', title: zh ? '已读' : 'Finished', pillBg: '#e0e7ff', pillFg: '#3730a3', surfaceTint: 'rgba(99,102,241,0.04)', droppable: false, cards: finished },
		];
	}
	if (groupBy === 'status') {
		const statuses = listAvailableStatuses(rawItems, zh, excludedStatusTag);
		const map = new Map<string, KanbanColumnModel>();
		statuses.forEach((st, idx) => {
			const t = SOFT_TINTS[(idx + 1) % SOFT_TINTS.length];
			map.set(st.tag.toLowerCase(), { key: st.tag, title: st.label, color: st.color, pillBg: t.pillBg, pillFg: t.pillFg, surfaceTint: t.surface, droppable: true, cards: [] });
		});
		const unassigned: KanbanColumnModel = { key: '__none__', title: zh ? '未设状态' : 'Unassigned', color: '#94a3b8', pillBg: '#f1f5f9', pillFg: '#475569', surfaceTint: 'rgba(100,116,139,0.04)', droppable: true, cards: [] };
		for (const c of cards) {
			const k = c.status?.tag.toLowerCase();
			if (k && map.has(k)) map.get(k)!.cards.push(c);
			else unassigned.cards.push(c);
		}
		return [unassigned, ...map.values()];
	}
	if (groupBy === 'rating') {
		const cols: KanbanColumnModel[] = [];
		for (let stars = 5; stars >= 1; stars--) {
			const t = SOFT_TINTS[(5 - stars) % SOFT_TINTS.length];
			cols.push({ key: String(stars), title: `${stars} ⭐`, color: '#f59e0b', pillBg: t.pillBg, pillFg: t.pillFg, surfaceTint: t.surface, droppable: true, cards: cards.filter((c) => c.rating === stars) });
		}
		cols.push({ key: '0', title: zh ? '未评级' : 'Unrated', color: '#94a3b8', pillBg: '#f1f5f9', pillFg: '#475569', surfaceTint: 'rgba(100,116,139,0.04)', droppable: true, cards: cards.filter((c) => c.rating === 0) });
		return cols;
	}
	const buckets = new Map<string, GalleryCardModel[]>();
	for (const c of cards) {
		const key = groupBy === 'year'
			? (c.year || (zh ? '未知年份' : 'Unknown'))
			: groupBy === 'publication'
				? (c.venue || (zh ? '未标来源' : 'No Venue'))
				: c.itemTypeLabel;
		const list = buckets.get(key) || [];
		list.push(c);
		buckets.set(key, list);
	}
	const entries = [...buckets.entries()];
	if (groupBy === 'year') entries.sort((a, b) => (Number(b[0]) || -1) - (Number(a[0]) || -1));
	else entries.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
	return entries.map(([key, list], idx) => {
		const t = SOFT_TINTS[idx % SOFT_TINTS.length];
		return { key, title: key, pillBg: t.pillBg, pillFg: t.pillFg, surfaceTint: t.surface, droppable: false, cards: list };
	});
}

export async function applyKanbanColumnDrop(
	card: GalleryCardModel,
	groupBy: GalleryGroupBy,
	targetColumnKey: string,
	options: { excludedStatusTag: string; ratingStorage: RatingStorageLocation; color?: string; syncZoteroTagColor?: boolean },
): Promise<boolean> {
	if (groupBy === 'status') {
		return setItemStatus(card.item, targetColumnKey === '__none__' ? null : targetColumnKey, {
			color: options.color,
			excludedTag: options.excludedStatusTag,
			syncZoteroTagColor: options.syncZoteroTagColor,
		});
	}
	if (groupBy === 'rating') {
		return setItemRating(card.item, Number(targetColumnKey) || 0, options.ratingStorage);
	}
	return false;
}
