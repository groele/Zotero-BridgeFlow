export interface ResolvedPdfAttachment {
	readonly item: any;
	readonly id: number;
	readonly title: string;
	readonly filename: string;
}

export function isItemTrashedOrDeleted(item: any): boolean {
	if (!item) return true;
	if (item.deleted) return true;
	if (typeof item.isTrashed === 'function' && item.isTrashed()) return true;
	return false;
}

export function isItemWritable(item: any): boolean {
	if (isItemTrashedOrDeleted(item)) return false;
	if (typeof item.isEditable === 'function' && !item.isEditable()) return false;
	return true;
}

export function isRegularValidItem(item: any): boolean {
	if (isItemTrashedOrDeleted(item)) return false;
	if (typeof item.isRegularItem === 'function') return Boolean(item.isRegularItem());
	return item.itemType !== 'attachment' && item.itemType !== 'note' && item.itemType !== 'annotation';
}

/**
 * Traverses attachment/note parent chains safely with cycle detection
 * and returns the owning regular item if available and non-trashed.
 */
export function normalizeToRegularItem(item: any): any | null {
	if (isItemTrashedOrDeleted(item)) return null;
	const seen = new Set<number>();
	let current = item;
	while (current) {
		if (isItemTrashedOrDeleted(current)) return null;
		const id = Number(current.id || 0);
		if (id > 0) {
			if (seen.has(id)) return null;
			seen.add(id);
		}
		if (isRegularValidItem(current)) return current;
		const parentID = Number(current.parentID || current.parentItemID || 0);
		if (current.parentItem) {
			current = current.parentItem;
			continue;
		}
		if (parentID > 0 && (globalThis as any).Zotero?.Items?.get) {
			current = (globalThis as any).Zotero.Items.get(parentID);
			continue;
		}
		return null;
	}
	return null;
}

export async function normalizeToRegularItemAsync(item: any): Promise<any | null> {
	const sync = normalizeToRegularItem(item);
	if (sync) return sync;
	if (isItemTrashedOrDeleted(item)) return null;
	const parentID = Number(item.parentID || item.parentItemID || 0);
	if (parentID > 0 && (globalThis as any).Zotero?.Items?.getAsync) {
		try {
			const parent = await (globalThis as any).Zotero.Items.getAsync(parentID);
			return normalizeToRegularItem(parent);
		} catch {
			return null;
		}
	}
	return null;
}

export function deduplicateRegularItems(items: readonly any[], maxItems = 100): { items: any[]; truncated: boolean } {
	const result: any[] = [];
	const seen = new Set<number>();
	let truncated = false;
	for (const raw of items) {
		const norm = normalizeToRegularItem(raw);
		if (!norm) continue;
		const id = Number(norm.id || 0);
		if (id > 0) {
			if (seen.has(id)) continue;
			seen.add(id);
		}
		if (result.length >= maxItems) {
			truncated = true;
			break;
		}
		result.push(norm);
	}
	return { items: result, truncated };
}

export async function resolvePdfAttachments(item: any): Promise<ResolvedPdfAttachment[]> {
	if (isItemTrashedOrDeleted(item)) return [];
	const hostItems = (globalThis as any).Zotero?.Items;
	const candidates: any[] = [];
	if (typeof item.isPDFAttachment === 'function' && item.isPDFAttachment()) {
		candidates.push(item);
	} else if (typeof item.getAttachments === 'function') {
		const ids: number[] = item.getAttachments() || [];
		for (const id of ids) {
			const att = hostItems?.getAsync ? await hostItems.getAsync(id) : hostItems?.get?.(id);
			if (att && !isItemTrashedOrDeleted(att) && att.isPDFAttachment?.()) {
				candidates.push(att);
			}
		}
	}
	return candidates.map((att) => ({
		item: att,
		id: Number(att.id || 0),
		title: String(att.getField?.('title') || att.attachmentFilename || 'PDF'),
		filename: String(att.attachmentFilename || ''),
	}));
}
