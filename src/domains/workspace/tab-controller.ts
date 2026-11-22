import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import type { OpenItemRequestPayload } from '../../kernel/types.ts';
import type { UnifiedClipboardService } from '../../services/clipboard-service.ts';
import { normalizeToRegularItem } from '../../services/item-resolution.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import type { TabCloseOptions, TrackedTab } from './types.ts';

export class WorkspaceTabController {
	private readonly prefs: UnifiedPrefService;
	private readonly store: WorkspaceStateStore;
	private readonly clipboard: UnifiedClipboardService;

	constructor(
		prefs: UnifiedPrefService,
		store: WorkspaceStateStore,
		clipboard: UnifiedClipboardService,
	) {
		this.prefs = prefs;
		this.store = store;
		this.clipboard = clipboard;
	}

	tabKey(tab: any): string {
		if (!tab) return '';
		if (tab.type === 'library') return 'library';
		const itemID = Number(tab.data?.itemID || tab.itemID || 0);
		if (itemID > 0) return `item:${itemID}`;
		return `tab:${String(tab.id || '')}`;
	}

	buildTrackedTabs(win: Window): TrackedTab[] {
		const tabsApi = (win as any).Zotero_Tabs;
		const nativeTabs: any[] = Array.isArray(tabsApi?._tabs) ? tabsApi._tabs : [];
		const hostItems = (globalThis as any).Zotero?.Items;
		const tracked: TrackedTab[] = [];
		const openKeys = new Set<string>();

		for (const tab of nativeTabs) {
			if (!tab || tab.type === 'library') continue;
			const key = this.tabKey(tab);
			openKeys.add(key);
			const itemID = Number(tab.data?.itemID || 0);
			const rawItem = itemID > 0 ? hostItems?.get?.(itemID) : null;
			const parentItem = rawItem ? normalizeToRegularItem(rawItem) : null;
			const displayItem = parentItem || rawItem;
			const title = String(displayItem?.getField?.('title') || tab.title || key);
			const shortTitle = String(displayItem?.getField?.('shortTitle') || title);
			const filename = String(rawItem?.attachmentFilename || '');
			const source = String(displayItem?.getField?.('publicationTitle') || displayItem?.getField?.('proceedingsTitle') || '');
			const creatorYear = this.formatCreatorYear(displayItem);
			const collection = this.resolvePrimaryCollectionName(displayItem);

			tracked.push({
				tabID: String(tab.id || ''),
				key,
				type: String(tab.type || 'reader'),
				itemID,
				parentItemID: Number(parentItem?.id || itemID),
				title,
				shortTitle,
				filename,
				source,
				creatorYear,
				collection,
				groupId: this.store.groupOfKey(key),
				pinned: this.store.isPinned(key),
				sleeping: this.store.isSleeping(key),
				virtual: false,
				remark: this.store.state.remarks[key] || '',
				lastViewedAt: this.store.state.lastViewedAt[key] || 0,
			});
		}

		if (this.prefs.get('workspace.enableVirtualMembers')) {
			for (const [key, meta] of Object.entries(this.store.state.virtualMembers)) {
				if (openKeys.has(key)) continue;
				const groupId = this.store.groupOfKey(key);
				if (!groupId) continue;
				tracked.push({
					tabID: '',
					key,
					type: meta.type || 'reader',
					itemID: meta.itemID,
					parentItemID: meta.parentItemID || meta.itemID,
					title: meta.title,
					shortTitle: meta.shortTitle || meta.title,
					filename: meta.filename || '',
					source: meta.source || '',
					creatorYear: meta.creatorYear || '',
					collection: meta.collection || '',
					groupId,
					pinned: false,
					sleeping: false,
					virtual: true,
					remark: this.store.state.remarks[key] || '',
					lastViewedAt: this.store.state.lastViewedAt[key] || 0,
				});
			}
		}

		return tracked;
	}

	selectTab(win: Window, tabID: string): boolean {
		const tabsApi = (win as any).Zotero_Tabs;
		if (!tabsApi?.select) return false;
		const tracked = this.buildTrackedTabs(win).find((t) => t.tabID === tabID);
		if (tracked) {
			if (tracked.sleeping) this.store.setSleeping(tracked.key, false);
			if (tracked.groupId && this.store.state.collapsed.includes(tracked.groupId)) {
				this.store.setCollapsed(tracked.groupId, false);
			}
			this.store.touchViewed(tracked.key);
		}
		tabsApi.select(tabID);
		return true;
	}

	async closeTabs(win: Window, tabIDs: readonly string[], options: TabCloseOptions = {}): Promise<number> {
		const tabsApi = (win as any).Zotero_Tabs;
		if (!tabsApi?.close || !tabIDs.length) return 0;
		const selectedID = String(tabsApi.selectedID || '');
		const trackedByID = new Map(this.buildTrackedTabs(win).map((t) => [t.tabID, t]));
		const toClose: string[] = [];

		for (const id of new Set(tabIDs)) {
			const t = trackedByID.get(id);
			if (!t || t.virtual) continue;
			if (options.protectPinned && t.pinned) continue;
			if (options.protectSelected && id === selectedID) continue;
			if (t.groupId && (options.preserveVirtual ?? true) && this.prefs.get('workspace.enableVirtualMembers')) {
				this.store.saveVirtualMember({
					key: t.key,
					itemID: t.itemID,
					parentItemID: t.parentItemID,
					title: t.title,
					shortTitle: t.shortTitle,
					filename: t.filename,
					source: t.source,
					creatorYear: t.creatorYear,
					collection: t.collection,
					type: t.type,
				});
			}
			toClose.push(id);
		}
		if (!toClose.length) return 0;
		tabsApi.close(toClose.length === 1 ? toClose[0] : toClose);
		return toClose.length;
	}

	sleepTab(win: Window, tabID: string): boolean {
		if (!this.prefs.get('workspace.enableTabSleep')) return false;
		const tabsApi = (win as any).Zotero_Tabs;
		const tracked = this.buildTrackedTabs(win).find((t) => t.tabID === tabID);
		if (!tracked || tracked.pinned || tracked.virtual) return false;
		if (typeof tabsApi?.unload === 'function') {
			tabsApi.unload(tabID);
		}
		this.store.setSleeping(tracked.key, true);
		return true;
	}

	async reloadTab(win: Window, tabID: string): Promise<boolean> {
		const tracked = this.buildTrackedTabs(win).find((t) => t.tabID === tabID);
		if (!tracked) return false;
		this.store.setSleeping(tracked.key, false);
		this.selectTab(win, tabID);
		const reader = (globalThis as any).Zotero?.Reader?.getByTabID?.(tabID);
		if (typeof reader?.reload === 'function') {
			await reader.reload();
		}
		return true;
	}

	async archiveAndCloseGroup(win: Window, groupId: string): Promise<number> {
		const group = this.store.state.groups.find((g) => g.id === groupId);
		if (!group) return 0;
		const ids = this.buildTrackedTabs(win).filter((t) => t.groupId === groupId && t.tabID).map((t) => t.tabID);
		this.store.saveSession(group.name);
		return this.closeTabs(win, ids, { preserveVirtual: true, protectPinned: true });
	}

	autoGroupByCollection(win: Window): number {
		const strategy = this.prefs.get('workspace.multiCollectionStrategy');
		const activeColName = String((win as any).ZoteroPane?.getSelectedCollection?.()?.name || '');
		const tracked = this.buildTrackedTabs(win).filter((t) => !t.virtual && !t.groupId);
		const hostItems = (globalThis as any).Zotero?.Items;
		const hostCols = (globalThis as any).Zotero?.Collections;
		let grouped = 0;

		for (const tab of tracked) {
			const item = hostItems?.get?.(tab.parentItemID || tab.itemID);
			const colIDs: number[] = item?.getCollections?.() || [];
			const colNames = colIDs.map((id) => String(hostCols?.get?.(id)?.name || '')).filter(Boolean);
			if (!colNames.length) continue;

			let chosen = '';
			if (strategy === 'active' && activeColName && colNames.includes(activeColName)) {
				chosen = activeColName;
			} else if (strategy === 'existing') {
				chosen = colNames.find((n) => this.store.state.groups.some((g) => g.name === n)) || colNames[0];
			} else {
				chosen = colNames[0];
			}
			if (!chosen) continue;

			let group = this.store.state.groups.find((g) => g.name === chosen);
			if (!group) group = this.store.createGroup(chosen);
			this.store.assignToGroup(tab.key, group.id);
			grouped++;
		}
		return grouped;
	}

	getDisplayTitle(tab: { title: string; shortTitle?: string; filename?: string; remark?: string }): string {
		const titleMode = this.prefs.get('workspace.verticalTabTitleMode');
		const base = titleMode === 'shortTitle' && tab.shortTitle
			? tab.shortTitle
			: titleMode === 'filename' && tab.filename
				? tab.filename
				: tab.title;
		if (!this.prefs.get('workspace.enableTabRemarks') || !tab.remark) return base;
		const mode = this.prefs.get('workspace.remarkDisplayMode');
		if (mode === 'remark') return tab.remark;
		if (mode === 'title') return base;
		return `${tab.remark} · ${base}`;
	}

	/**
	 * Unified copy citation action — delegates to shared UnifiedClipboardService
	 * so tab-menu copies automatically populate reverse-lookup history.
	 */
	async copyTabCitation(win: Window, tabID: string): Promise<boolean> {
		const tracked = this.buildTrackedTabs(win).find((t) => t.tabID === tabID);
		if (!tracked) return false;
		const hostItems = (globalThis as any).Zotero?.Items;
		const item = hostItems?.get?.(tracked.parentItemID || tracked.itemID);
		if (!item) return false;
		return this.clipboard.copyItems([item], { source: 'tab-menu' });
	}

	/**
	 * Cross-domain hook: focus an already-open tab matching itemID/attachmentID,
	 * or open it in reader and optionally assign it to the active tab's group.
	 */
	async focusOrOpenItem(win: Window, req: OpenItemRequestPayload): Promise<'focused' | 'opened' | 'not-found'> {
		const tracked = this.buildTrackedTabs(win);
		const match = tracked.find(
			(t) => !t.virtual && (
				t.parentItemID === req.itemID
				|| t.itemID === req.itemID
				|| (req.attachmentID && t.itemID === req.attachmentID)
			),
		);
		if (match && (req.preferExistingTab ?? true)) {
			this.selectTab(win, match.tabID);
			return 'focused';
		}

		const reader = (globalThis as any).Zotero?.Reader;
		const targetAttachmentID = req.attachmentID || req.itemID;
		if (typeof reader?.open === 'function' && targetAttachmentID > 0) {
			await reader.open(targetAttachmentID);
			if (req.assignToActiveGroup) {
				const selectedID = String((win as any).Zotero_Tabs?.selectedID || '');
				const activeTab = tracked.find((t) => t.tabID === selectedID);
				if (activeTab?.groupId) {
					this.store.assignToGroup(`item:${targetAttachmentID}`, activeTab.groupId);
				}
			}
			return 'opened';
		}
		return 'not-found';
	}

	/**
	 * Cross-domain hook: group all currently open tabs whose parent/item ID
	 * belongs to the provided set (e.g. items cited in the active Word document).
	 */
	groupOpenTabsByItemIDs(win: Window, groupName: string, itemIDs: readonly number[]): { groupId: string; count: number } | null {
		const idSet = new Set(itemIDs);
		if (!idSet.size) return null;
		const matching = this.buildTrackedTabs(win).filter(
			(t) => !t.virtual && (idSet.has(t.parentItemID) || idSet.has(t.itemID)),
		);
		if (!matching.length) return null;
		const existing = this.store.state.groups.find((g) => g.name === groupName);
		const group = existing ?? this.store.createGroup(groupName);
		for (const tab of matching) {
			this.store.assignToGroup(tab.key, group.id);
		}
		return { groupId: group.id, count: matching.length };
	}

	findStaleTabs(win: Window, now = Date.now()): TrackedTab[] {
		const days = this.prefs.get('workspace.staleSuggestDays');
		const cutoff = now - days * 86_400_000;
		return this.buildTrackedTabs(win).filter(
			(t) => !t.virtual && !t.pinned && t.lastViewedAt > 0 && t.lastViewedAt < cutoff,
		);
	}

	private formatCreatorYear(item: any): string {
		if (!item) return '';
		const first = String(item.firstCreator || '');
		const date = String(item.getField?.('year') || item.getField?.('date') || '').slice(0, 4);
		return [first, date].filter(Boolean).join(', ');
	}

	private resolvePrimaryCollectionName(item: any): string {
		if (!item || typeof item.getCollections !== 'function') return '';
		const ids: number[] = item.getCollections() || [];
		if (!ids.length) return '';
		const col = (globalThis as any).Zotero?.Collections?.get?.(ids[0]);
		return String(col?.name || '');
	}
}
