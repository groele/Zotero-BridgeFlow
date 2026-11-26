export {
	formatCompactPdfOptionLabel,
	formatPdfAttachmentDisplayTitle,
	getPdfAttachmentSortRank,
	resolveBestFileAttachment,
	resolvePdfAttachments,
	type ResolvedPdfAttachment,
} from './pdf-attachment-utils.ts';
import { resolveBestFileAttachment } from './pdf-attachment-utils.ts';

export function isItemTrashedOrDeleted(item: any): boolean {
	if (!item || item.deleted || item.inTrash === true) return true;
	if (typeof item.inTrash === 'function' && item.inTrash()) return true;
	return typeof item.isTrashed === 'function' ? Boolean(item.isTrashed()) : false;
}

export function isItemWritable(item: any): boolean {
	if (isItemTrashedOrDeleted(item) || item.editable === false) return false;
	if (typeof item.isEditable === 'function' && !item.isEditable()) return false;
	const lib = item.libraryID ? (globalThis as any).Zotero?.Libraries?.get?.(Number(item.libraryID)) : null;
	return !lib || lib.editable !== false;
}

export function isRegularValidItem(item: any): boolean {
	if (isItemTrashedOrDeleted(item)) return false;
	if (typeof item.isRegularItem === 'function') return Boolean(item.isRegularItem());
	return !item.isAttachment?.() && item.itemType !== 'attachment' && item.itemType !== 'note' && item.itemType !== 'annotation';
}

export function normalizeToRegularItem(item: any): any | null {
	if (isItemTrashedOrDeleted(item)) return null;
	const seen = new Set<number>();
	let current = item;
	while (current && !isItemTrashedOrDeleted(current)) {
		const id = Number(current.id || 0);
		if (id > 0) {
			if (seen.has(id)) return null;
			seen.add(id);
		}
		if (isRegularValidItem(current)) return current;
		const parentID = Number(current.parentID || current.parentItemID || 0);
		if (current.parentItem) current = current.parentItem;
		else if (parentID > 0 && (globalThis as any).Zotero?.Items?.get) current = (globalThis as any).Zotero.Items.get(parentID);
		else return null;
	}
	return null;
}

export async function normalizeToRegularItemAsync(item: any): Promise<any | null> {
	const sync = normalizeToRegularItem(item);
	if (sync || isItemTrashedOrDeleted(item)) return sync;
	const parentID = Number(item.parentID || item.parentItemID || 0);
	if (parentID > 0 && (globalThis as any).Zotero?.Items?.getAsync) {
		try { return normalizeToRegularItem(await (globalThis as any).Zotero.Items.getAsync(parentID)); } catch { return null; }
	}
	return null;
}

export function deduplicateRegularItems(items: readonly any[], maxItems = Infinity): { items: any[]; truncated: boolean } {
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
		if (result.length >= maxItems) { truncated = true; break; }
		result.push(norm);
	}
	return { items: result, truncated };
}

const recentRevealTimestamps = new Map<string, number>();

/**
 * Shared cross-domain attachment reveal service reused by Workspace (TabFlow) and Inspector (PDF Folder).
 */
export async function revealItemAttachmentInFilesystem(
	itemOrID: any,
	options: { openMode?: string; win?: Window | null; dedupMs?: number } = {},
): Promise<boolean> {
	try {
		const att = await resolveBestFileAttachment(itemOrID);
		if (!att) return false;
		const zotero = (globalThis as any).Zotero;
		const filePath = (await att.getFilePathAsync?.().catch(() => null)) || att.getFilePath?.();
		const nsFile = filePath ? zotero?.File?.pathToFile?.(filePath) : null;
		const folder = nsFile?.parent?.path;
		const cacheKey = filePath || folder || String(att.id || '');
		const dedupMs = options.dedupMs ?? 350;
		if (cacheKey && dedupMs > 0) {
			const now = Date.now();
			if (now - (recentRevealTimestamps.get(cacheKey) ?? 0) < dedupMs) return true;
			recentRevealTimestamps.set(cacheKey, now);
		}
		try {
			if (options.openMode === 'folder' && folder && zotero?.launchFile) {
				await zotero.launchFile(folder);
				return true;
			}
			if (nsFile && nsFile.exists?.() !== false && typeof nsFile.reveal === 'function') {
				await Promise.resolve(nsFile.reveal());
				return true;
			}
			const targetWin = (options.win as any)?.ZoteroPane ? options.win : zotero?.getMainWindow?.();
			if ((targetWin as any)?.ZoteroPane?.showAttachmentInFilesystem) {
				await (targetWin as any).ZoteroPane.showAttachmentInFilesystem(att.id);
				return true;
			}
			if (folder && zotero?.launchFile) {
				await zotero.launchFile(folder);
				return true;
			}
		} catch (err) {
			if (cacheKey) recentRevealTimestamps.delete(cacheKey);
			throw err;
		}
	} catch (error) {
		(globalThis as any).Zotero?.logError?.(error instanceof Error ? error : new Error(String(error)));
	}
	return false;
}

/**
 * Shared cross-domain library & collection tree navigation service reused by Workspace and Inspector Lookup.
 */
export async function locateItemInZoteroLibrary(
	itemOrID: any,
	options: { win?: Window | null; switchCollection?: boolean } = {},
): Promise<boolean> {
	try {
		const zotero = (globalThis as any).Zotero;
		const win = ((options.win as any)?.ZoteroPane ? options.win : zotero?.getMainWindow?.()) as any;
		const pane = win?.ZoteroPane;
		if (!pane) return false;
		const rawItem = typeof itemOrID === 'number'
			? (zotero?.Items?.get?.(itemOrID) || await zotero?.Items?.getAsync?.(itemOrID))
			: itemOrID;
		if (rawItem && isItemTrashedOrDeleted(rawItem)) return false;
		const primary = rawItem ? (normalizeToRegularItem(rawItem) || rawItem) : null;
		const targetID = Number(primary?.id ?? (typeof itemOrID === 'number' ? itemOrID : 0));
		if (!targetID) return false;

		if (win.Zotero_Tabs && win.Zotero_Tabs.selectedID !== 'zotero-pane') {
			win.Zotero_Tabs.select?.('zotero-pane');
		}
		if (options.switchCollection && primary) {
			const cols: number[] = primary.getCollections?.() || [];
			if (cols.length && pane.collectionsView?.selectCollection) {
				await pane.collectionsView.selectCollection(cols[0]);
			}
		}
		const ok = await pane.selectItem?.(targetID, true);
		if (ok === false) return false;
		const tree = win.document?.getElementById?.('zotero-items-tree');
		if (tree?.ensureRowIsVisible && tree?.selection) {
			tree.ensureRowIsVisible(tree.selection.currentIndex);
		}
		return true;
	} catch {
		return false;
	}
}

interface CachedPrimaryFields {
	stamp: string;
	title: string;
	shortTitle: string;
	source: string;
	creatorYear: string;
}

const MAX_ITEM_FIELD_CACHE = 5000;
const itemFieldCache = new Map<number, CachedPrimaryFields>();
const titleMarkupCache = new Map<string, string>();

function setBoundedMap<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
	if (map.has(key)) map.delete(key);
	else if (map.size >= max) { const old = map.keys().next().value; if (old !== undefined) map.delete(old); }
	map.set(key, value);
}

export function invalidateResolvedItemCache(itemIDs?: Iterable<number>): void {
	if (!itemIDs) { itemFieldCache.clear(); titleMarkupCache.clear(); return; }
	for (const id of itemIDs) itemFieldCache.delete(Number(id));
}

export function getCachedPrimaryItemFields(item: any, fallbackTitle = ''): CachedPrimaryFields {
	const primary = normalizeToRegularItem(item) || item;
	const id = Number(primary?.id || 0);
	const stamp = String(primary?.dateModified || primary?.version || '');
	if (id > 0 && stamp) {
		const hit = itemFieldCache.get(id);
		if (hit && hit.stamp === stamp) { itemFieldCache.delete(id); itemFieldCache.set(id, hit); return hit; }
	}
	const title = safeGetItemField(primary, 'title') || stripItemTitleMarkup(fallbackTitle);
	const shortTitle = safeGetItemField(primary, 'shortTitle') || title;
	const source = safeGetItemField(primary, 'publicationTitle') || safeGetItemField(primary, 'proceedingsTitle')
		|| safeGetItemField(primary, 'bookTitle') || safeGetItemField(primary, 'repository');
	const creatorYear = formatCreatorYear(primary);
	const entry: CachedPrimaryFields = { stamp, title, shortTitle, source, creatorYear };
	if (id > 0 && stamp && title) setBoundedMap(itemFieldCache, id, entry, MAX_ITEM_FIELD_CACHE);
	return entry;
}

export function stripItemTitleMarkup(value: string): string {
	const raw = String(value || '');
	if (!raw || !raw.includes('<')) return raw;
	const cached = titleMarkupCache.get(raw);
	if (cached !== undefined) return cached;
	let out = raw.replace(/<[^>]*>/g, '').trim();
	const render = (globalThis as any).Zotero?.Utilities?.Internal?.renderItemTitle;
	if (typeof render === 'function') {
		try {
			const r = render.call((globalThis as any).Zotero.Utilities.Internal, raw);
			out = (typeof r === 'string' ? r : String(r?.textContent ?? raw)).replace(/<[^>]*>/g, '').trim();
		} catch { /* fallback to regex */ }
	}
	setBoundedMap(titleMarkupCache, raw, out, MAX_ITEM_FIELD_CACHE);
	return out;
}

export function safeGetItemField(item: any, field: string): string {
	if (!item || typeof item.getField !== 'function') return '';
	let out = '';
	try { out = String(item.getField(field, false, true) || ''); }
	catch { try { out = String(item.getField(field) || ''); } catch { return ''; } }
	return field === 'title' || field === 'shortTitle' ? stripItemTitleMarkup(out) : out;
}

export function formatCreatorYear(item: any): string {
	if (!item) return '';
	const first = String(item.firstCreator || safeGetItemField(item, 'firstCreator') || '');
	const date = (safeGetItemField(item, 'year') || safeGetItemField(item, 'date')).slice(0, 4);
	return [first, date].filter(Boolean).join(', ');
}

export function resolvePrimaryCollectionName(item: any): string {
	const ids: number[] = item?.getCollections?.() || [];
	const hostCols = (globalThis as any).Zotero?.Collections;
	for (const id of ids) {
		const col = hostCols?.get?.(id);
		const name = col && !col._isBridgeFlowCollection && !col._isCiteFlowCollection ? String(col.name || '') : '';
		if (name && !name.startsWith('📝 ')) return name;
	}
	return '';
}
