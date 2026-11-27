import { isRegularValidItem } from '../../services/item-resolution.ts';
import type { VisualNotesDataSource } from '../../services/shared-reading-notes.ts';
import {
	clearItemRemarkLocalSuppression,
	getItemBriefNote,
	markItemRemarkClearedLocally,
	syncItemRemarkToExtra,
} from '../../services/item-remark-sync.ts';

export type { VisualNotesDataSource };

export function resolveParentItemID(item: any): number {
	if (!item) return 0;
	if (item.isAttachment?.() && item.parentItemID) return Number(item.parentItemID) || 0;
	return Number(item.id || 0);
}

const EXTRA_REMARK_CACHE_LIMIT = 5000;
const extraRemarkCache = new Map<number, { stamp: string; remark: string; attRev?: number; attRemark?: string }>();

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
	const remarksRev = typeof dataSource?.getRemarksRevision === 'function' ? dataSource.getRemarksRevision() : -1;
	if (cached?.stamp === stamp) {
		if (cached.remark || !dataSource) return cached.remark;
		if (remarksRev >= 0 && cached.attRev === remarksRev) return cached.attRemark ?? '';
	}
	let attRemark = '';
	if (dataSource && isRegularValidItem(item) && typeof item.getAttachments === 'function') {
		for (const attID of item.getAttachments() || []) {
			const attCached = dataSource.getRemark(attID);
			if (attCached) { attRemark = attCached; break; }
		}
	}
	if (attRemark) {
		if (cacheable && cached?.stamp === stamp && remarksRev >= 0) {
			cached.attRev = remarksRev;
			cached.attRemark = attRemark;
		}
		return attRemark;
	}
	if (cached?.stamp === stamp) {
		if (remarksRev >= 0) {
			cached.attRev = remarksRev;
			cached.attRemark = '';
		}
		return cached.remark;
	}
	const resolved = getItemBriefNote(targetItem);
	if (cacheable) {
		extraRemarkCache.delete(targetID);
		if (extraRemarkCache.size >= EXTRA_REMARK_CACHE_LIMIT) {
			const oldest = extraRemarkCache.keys().next().value;
			if (oldest !== undefined) extraRemarkCache.delete(oldest);
		}
		extraRemarkCache.set(targetID, remarksRev >= 0
			? { stamp, remark: resolved, attRev: remarksRev, attRemark: '' }
			: { stamp, remark: resolved });
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
