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
	if (typeof target?.getAttachments === 'function') {
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

export function safeGetItemField(item: any, field: string): string {
	if (!item || typeof item.getField !== 'function') return '';
	try {
		return String(item.getField(field, false, true) || '');
	} catch {
		try {
			return String(item.getField(field) || '');
		} catch {
			return '';
		}
	}
}

export function formatCreatorYear(item: any): string {
	if (!item) return '';
	const first = String(item.firstCreator || safeGetItemField(item, 'firstCreator') || '');
	const date = (safeGetItemField(item, 'year') || safeGetItemField(item, 'date')).slice(0, 4);
	return [first, date].filter(Boolean).join(', ');
}

export function resolvePrimaryCollectionName(item: any): string {
	if (!item || typeof item.getCollections !== 'function') return '';
	const ids: number[] = item.getCollections() || [];
	if (!ids.length) return '';
	const col = (globalThis as any).Zotero?.Collections?.get?.(ids[0]);
	return String(col?.name || '');
}
