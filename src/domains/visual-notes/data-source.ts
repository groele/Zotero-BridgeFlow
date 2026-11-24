import type { TabReadingProgress } from '../../services/reading-stats.ts';
import { getItemBriefNote, syncItemRemarkToExtra } from '../../services/item-remark-sync.ts';

export interface VisualNotesDataSource {
	getReadingProgress(itemID: number): TabReadingProgress | undefined;
	getRemark(itemID: number): string;
	setRemark(itemID: number, remark: string): void;
}

export function resolveParentItemID(item: any): number {
	if (!item) return 0;
	if (item.isAttachment?.() && item.parentItemID) return Number(item.parentItemID) || 0;
	return Number(item.id || 0);
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
	const attIDs: number[] = typeof item.getAttachments === 'function' ? (item.getAttachments() || []) : [];
	if (dataSource) {
		for (const attID of attIDs) {
			const attCached = dataSource.getRemark(attID);
			if (attCached) return attCached;
		}
	}
	const hostItems = (globalThis as any).Zotero?.Items;
	const targetItem = parentID > 0 && parentID !== id ? (hostItems?.get?.(parentID) || item) : item;
	return getItemBriefNote(targetItem);
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
	if (dataSource) {
		if (id > 0) dataSource.setRemark(id, clean);
		if (parentID > 0 && parentID !== id) dataSource.setRemark(parentID, clean);
	}
	if (syncToExtra) {
		const targetID = parentID > 0 ? parentID : id;
		if (targetID > 0) void syncItemRemarkToExtra(targetID, clean);
	}
}
