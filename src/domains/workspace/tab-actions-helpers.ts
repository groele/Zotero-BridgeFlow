import {
	formatCreatorYear as sharedFormatCreatorYear,
	locateItemInZoteroLibrary,
	resolvePrimaryCollectionName as sharedResolvePrimaryCollectionName,
	revealItemAttachmentInFilesystem,
} from '../../services/item-resolution.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import type { TabReadingProgress, VirtualMemberMeta } from './types.ts';

export interface ClosedTabRecord {
	key: string;
	itemID: number;
	groupId: string;
	title: string;
	closedAt: number;
}

export interface PublicationGroupSuggestion {
	venue: string;
	keys: string[];
	titles: string[];
}

export function computeTabMoveTarget(
	ids: readonly string[],
	draggedTabID: string,
	targetTabID: string,
	after: boolean,
): number {
	const from = ids.indexOf(draggedTabID);
	const to = ids.indexOf(targetTabID);
	if (from < 0 || to < 0 || from === to) return -1;
	let target = after ? to + 1 : to;
	if (from < target) target -= 1;
	return target;
}

export async function openItemAttachmentOrNote(
	win: Window,
	store: WorkspaceStateStore,
	itemID: number,
	groupId?: string,
	openInBackground = false,
): Promise<boolean> {
	try {
		const hostItems = (globalThis as any).Zotero?.Items;
		const item = itemID > 0 ? hostItems?.get?.(itemID) : null;
		if (!item || item.deleted) return false;

		const isNote = item.isNote?.() === true;
		const target = isNote || item.isAttachment?.() ? item : await item.getBestAttachment?.();
		if (!target || target.deleted) return false;

		const key = `item:${target.id}`;
		const altKey = `item:${item.id}`;
		const nativeTabs: any[] = Array.isArray((win as any).Zotero_Tabs?._tabs) ? (win as any).Zotero_Tabs._tabs : [];
		const existing = nativeTabs.find((t) => Number(t?.data?.itemID || 0) === target.id);

		if (existing) {
			if (!openInBackground) (win as any).Zotero_Tabs?.select?.(existing.id);
		} else if (isNote) {
			await (globalThis as any).Zotero?.Notes?.open?.(target.id, undefined, { openInBackground });
		} else {
			if (target.isFileAttachment?.() && typeof target.fileExists === 'function' && !await target.fileExists()) {
				return false;
			}
			await (globalThis as any).Zotero?.Reader?.open?.(target.id, undefined, { openInBackground });
		}

		if (groupId !== undefined) {
			store.assignToGroup(key, groupId || null);
		}
		store.removeVirtualMember(key);
		store.removeVirtualMember(altKey);
		return true;
	} catch (error) {
		(globalThis as any).Zotero?.logError?.(error instanceof Error ? error : new Error(String(error)));
		return false;
	}
}

export async function revealAttachmentFile(win: Window, itemID: number): Promise<boolean> {
	return revealItemAttachmentInFilesystem(itemID, { win });
}

export async function selectItemInLibrary(win: Window, itemID: number, switchCollection: boolean): Promise<boolean> {
	return locateItemInZoteroLibrary(itemID, { win, switchCollection });
}

export function formatReadingDuration(seconds?: number): string {
	const total = Math.max(0, Math.floor(Number(seconds) || 0));
	if (total < 60) return '';
	const mins = Math.floor(total / 60);
	if (mins < 60) return `${mins}m`;
	const hrs = Math.floor(mins / 60);
	const rem = mins % 60;
	return rem ? `${hrs}h${rem}m` : `${hrs}h`;
}

export function formatReadingProgress(prog?: TabReadingProgress): { text: string; ratio: number | null } {
	if (!prog) return { text: '', ratio: null };
	const dur = formatReadingDuration(prog.readSeconds);
	const page = Number(prog.lastPage) || 0;
	const total = Number(prog.totalPages) || 0;
	const pageText = page > 0 ? (total > 0 ? `p.${page}/${total}` : `p.${page}`) : '';
	const text = [dur, pageText].filter(Boolean).join(' · ');
	const ratio = page > 0 && total > 0 ? Math.max(0, Math.min(1, page / total)) : null;
	return { text, ratio };
}

export function trackActiveReaderProgress(
	win: Window,
	store: WorkspaceStateStore,
	tracked: readonly { tabID: string; key: string; type: string; virtual: boolean }[],
	elapsedSeconds: number,
): boolean {
	const doc = win.document as Document | undefined;
	if (typeof doc?.hasFocus === 'function' && !doc.hasFocus()) return false;
	const selectedID = String((win as any).Zotero_Tabs?.selectedID || '');
	if (!selectedID || selectedID === 'zotero-pane') return false;
	const current = tracked.find((t) => !t.virtual && t.tabID === selectedID);
	if (!current || current.key.startsWith('tab:') || !current.type.startsWith('reader')) return false;

	const prevText = formatReadingProgress(store.state.readingProgress[current.key]).text;
	const reader: any = (globalThis as any).Zotero?.Reader?.getByTabID?.(selectedID);
	const pdfApp = reader?._iframeWindow?.PDFViewerApplication;
	const page = Number(pdfApp?.page || (reader?.state?.pageIndex != null ? Number(reader.state.pageIndex) + 1 : 0)) || 0;
	const total = Number(pdfApp?.pagesCount || reader?._internalReader?._pdfDocument?.numPages || reader?.pagesCount || 0) || 0;

	store.touchViewed(current.key);
	const next = store.updateReadingProgress(current.key, elapsedSeconds, page, total);
	return formatReadingProgress(next).text !== prevText;
}

export function buildVirtualMetaFromTracked(tab: {
	key: string;
	itemID: number;
	parentItemID: number;
	title: string;
	shortTitle: string;
	filename: string;
	source: string;
	creatorYear: string;
	collection: string;
	type: string;
}): VirtualMemberMeta {
	return {
		key: tab.key,
		itemID: tab.itemID,
		parentItemID: tab.parentItemID,
		title: tab.title,
		shortTitle: tab.shortTitle,
		filename: tab.filename,
		source: tab.source,
		creatorYear: tab.creatorYear,
		collection: tab.collection,
		type: tab.type,
	};
}

export function formatCreatorYear(item: any): string {
	return sharedFormatCreatorYear(item);
}

export function resolvePrimaryCollectionName(item: any): string {
	return sharedResolvePrimaryCollectionName(item);
}

export function autoGroupTrackedByCollection(
	win: Window,
	store: WorkspaceStateStore,
	strategy: string,
	tracked: readonly { key: string; itemID: number; parentItemID: number; virtual: boolean; groupId: string }[],
): number {
	const pane = (win as any).ZoteroPane;
	const activeCol = pane?.getSelectedCollections?.()?.[0] || pane?.getSelectedCollection?.();
	const activeColName = String(activeCol?.name || '');
	const hostItems = (globalThis as any).Zotero?.Items;
	const hostCols = (globalThis as any).Zotero?.Collections;
	let grouped = 0;

	for (const tab of tracked) {
		if (tab.virtual || tab.groupId) continue;
		const item = hostItems?.get?.(tab.parentItemID || tab.itemID);
		const colIDs: number[] = item?.getCollections?.() || [];
		const colNames = colIDs.map((id) => String(hostCols?.get?.(id)?.name || '')).filter(Boolean);
		if (!colNames.length) continue;

		let chosen = '';
		if (strategy === 'active' && activeColName && colNames.includes(activeColName)) chosen = activeColName;
		else if (strategy === 'existing') chosen = colNames.find((n) => store.state.groups.some((g) => g.name === n)) || colNames[0];
		else chosen = colNames[0];
		if (!chosen) continue;

		const group = store.state.groups.find((g) => g.name === chosen) ?? store.createGroup(chosen);
		store.assignToGroup(tab.key, group.id);
		grouped++;
	}
	return grouped;
}

export async function restoreSessionTabsAndLayout(
	win: Window,
	store: WorkspaceStateStore,
	session: { groups: { id: string; memberKeys: string[] }[]; pinnedKeys: string[] },
	openLimit = 10,
): Promise<number> {
	const keysToOpen: Array<{ key: string; groupId?: string }> = [];
	const seen = new Set<string>();
	for (const g of session.groups) {
		for (const k of g.memberKeys) {
			if (!seen.has(k)) {
				seen.add(k);
				keysToOpen.push({ key: k, groupId: g.id });
			}
		}
	}
	for (const k of session.pinnedKeys) {
		if (!seen.has(k)) {
			seen.add(k);
			keysToOpen.push({ key: k });
		}
	}
	let opened = 0;
	for (const entry of keysToOpen) {
		if (opened >= openLimit) break;
		const match = /^item:(\d+)$/.exec(entry.key);
		if (match) {
			const id = Number(match[1]);
			if (await openItemAttachmentOrNote(win, store, id, entry.groupId, true)) opened++;
		}
	}
	return opened;
}

export function buildPublicationSuggestions(
	tracked: readonly { key: string; source: string; title: string; groupId: string; virtual: boolean }[],
): PublicationGroupSuggestion[] {
	const buckets = new Map<string, { keys: string[]; titles: string[] }>();
	for (const tab of tracked) {
		if (tab.virtual || tab.groupId) continue;
		const venue = tab.source.trim();
		if (!venue) continue;
		const entry = buckets.get(venue) ?? { keys: [], titles: [] };
		entry.keys.push(tab.key);
		entry.titles.push(tab.title);
		buckets.set(venue, entry);
	}
	return [...buckets.entries()]
		.filter(([, b]) => b.keys.length >= 2)
		.map(([venue, b]) => ({ venue, keys: b.keys, titles: b.titles }))
		.sort((a, b) => b.keys.length - a.keys.length);
}

export function collectRecentlyClosed(
	win: Window,
	localStack: readonly ClosedTabRecord[],
	openKeys: ReadonlySet<string>,
): ClosedTabRecord[] {
	const out: ClosedTabRecord[] = [];
	const seen = new Set<number>();
	const push = (rec: ClosedTabRecord) => {
		if (!rec.itemID || seen.has(rec.itemID) || openKeys.has(rec.key)) return;
		seen.add(rec.itemID);
		out.push(rec);
	};
	for (let i = localStack.length - 1; i >= 0; i--) push(localStack[i]);
	const nativeClosed: any[] = (win as any).Zotero_Tabs?._recentlyClosedTabs || [];
	for (let i = nativeClosed.length - 1; i >= 0; i--) {
		const tab = nativeClosed[i];
		const itemID = Number(tab?.data?.itemID || 0);
		if (!itemID || seen.has(itemID)) continue;
		const item = (globalThis as any).Zotero?.Items?.get?.(itemID);
		if (!item || item.deleted) continue;
		push({
			key: `item:${itemID}`,
			itemID,
			groupId: '',
			title: String(tab?.title || item.getField?.('title') || `文献 #${itemID}`),
			closedAt: Number(tab?.closedAt || 0),
		});
	}
	return out.slice(0, 12);
}

export async function focusOrOpenTrackedItem(
	win: Window,
	store: WorkspaceStateStore,
	tracked: readonly { tabID: string; itemID: number; parentItemID: number; groupId: string; virtual: boolean }[],
	req: { itemID: number; attachmentID?: number; preferExistingTab?: boolean; assignToActiveGroup?: boolean },
	onSelectTab: (tabID: string) => void,
): Promise<'focused' | 'opened' | 'not-found'> {
	const match = tracked.find(
		(t) => !t.virtual && (
			t.parentItemID === req.itemID || t.itemID === req.itemID
			|| (req.attachmentID && t.itemID === req.attachmentID)
		),
	);
	if (match && (req.preferExistingTab ?? true)) {
		onSelectTab(match.tabID);
		return 'focused';
	}
	const reader = (globalThis as any).Zotero?.Reader;
	const targetAttachmentID = req.attachmentID || req.itemID;
	if (typeof reader?.open === 'function' && targetAttachmentID > 0) {
		await reader.open(targetAttachmentID);
		store.removeVirtualMember(`item:${targetAttachmentID}`);
		store.removeVirtualMember(`item:${req.itemID}`);
		if (req.assignToActiveGroup) {
			const selectedID = String((win as any).Zotero_Tabs?.selectedID || '');
			const activeTab = tracked.find((t) => t.tabID === selectedID);
			if (activeTab?.groupId) store.assignToGroup(`item:${targetAttachmentID}`, activeTab.groupId);
		}
		return 'opened';
	}
	return 'not-found';
}
