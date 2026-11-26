import { isRegularValidItem } from '../../services/item-resolution.ts';
import type { TabReadingProgress } from '../../services/reading-stats.ts';
import {
	clearItemRemarkLocalSuppression,
	getItemBriefNote,
	markItemRemarkClearedLocally,
	syncItemRemarkToExtra,
} from '../../services/item-remark-sync.ts';

export interface VisualNotesDataSource {
	getReadingProgress(itemID: number): TabReadingProgress | undefined;
	getRemark(itemID: number): string;
	setRemark(itemID: number, remark: string, skipExtraObserver?: boolean): void;
	persistRemarks?(): Promise<boolean>;
}

export function resolveParentItemID(item: any): number {
	if (!item) return 0;
	if (item.isAttachment?.() && item.parentItemID) return Number(item.parentItemID) || 0;
	return Number(item.id || 0);
}

const EXTRA_REMARK_CACHE_LIMIT = 5000;
const extraRemarkCache = new Map<number, { stamp: string; remark: string }>();

export function clearExtraRemarkCache(itemIDs?: Iterable<number>): void {
	if (!itemIDs) {
		extraRemarkCache.clear();
		return;
	}
	for (const id of itemIDs) extraRemarkCache.delete(id);
}

export function readItemRemarkWithFallback(item: any, dataSource?: VisualNotesDataSource): string {
	if (!item) return '';
	const id = Number(item.id || 0);
	if (id > 0 && dataSource) {
		const cached = dataSource.getRemark(id);
		if (cached) return cached;
	}
	const parentID = resolveParentItemID(item);
	if (parentID > 0 && parentID !== id && dataSource) {
		const parentCached = dataSource.getRemark(parentID);
		if (parentCached) return parentCached;
	}
	const hostItems = (globalThis as any).Zotero?.Items;
	const targetItem = parentID > 0 && parentID !== id ? (hostItems?.get?.(parentID) || item) : item;
	const targetID = Number(targetItem?.id || 0);
	const stamp = String(targetItem?.version ?? targetItem?.dateModified ?? '');
	const cacheable = targetID > 0 && Boolean(stamp);
	const cached = cacheable ? extraRemarkCache.get(targetID) : undefined;
	if (cached?.stamp === stamp && (cached.remark || !dataSource)) return cached.remark;
	if (dataSource && isRegularValidItem(item) && typeof item.getAttachments === 'function') {
		for (const attID of item.getAttachments() || []) {
			const attCached = dataSource.getRemark(attID);
			if (attCached) return attCached;
		}
	}
	if (cached?.stamp === stamp) return cached.remark;
	const resolved = getItemBriefNote(targetItem);
	if (cacheable) {
		extraRemarkCache.delete(targetID);
		if (extraRemarkCache.size >= EXTRA_REMARK_CACHE_LIMIT) {
			const oldest = extraRemarkCache.keys().next().value;
			if (oldest !== undefined) extraRemarkCache.delete(oldest);
		}
		extraRemarkCache.set(targetID, { stamp, remark: resolved });
	}
	return resolved;
}

export function writeItemRemarkWithSync(
	item: any,
	remark: string,
	syncToExtra: boolean,
	dataSource?: VisualNotesDataSource,
): void {
	if (!item) return;
	const clean = String(remark || '').replace(/[\r\n]+/g, ' ').trim();
	const id = Number(item.id || 0);
	const parentID = resolveParentItemID(item);
	const targetID = parentID > 0 ? parentID : id;
	if (targetID > 0) {
		if (clean) clearItemRemarkLocalSuppression(targetID);
		else markItemRemarkClearedLocally(targetID);
	}
	if (id > 0 || parentID > 0) clearExtraRemarkCache([id, parentID].filter((n) => n > 0));
	if (dataSource) {
		if (targetID > 0) dataSource.setRemark(targetID, clean, syncToExtra);
		if (id > 0 && id !== targetID) dataSource.setRemark(id, clean, syncToExtra);
	}
	if (syncToExtra && targetID > 0) {
		void syncItemRemarkToExtra(targetID, clean);
	}
}
