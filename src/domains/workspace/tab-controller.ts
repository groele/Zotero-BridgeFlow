import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import type { OpenItemRequestPayload } from '../../kernel/types.ts';
import type { UnifiedClipboardService } from '../../services/clipboard-service.ts';
import { normalizeToRegularItem } from '../../services/item-resolution.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import {
	autoGroupTrackedByCollection,
	buildPublicationSuggestions,
	buildVirtualMetaFromTracked,
	collectRecentlyClosed,
	computeTabMoveTarget,
	focusOrOpenTrackedItem,
	formatCreatorYear,
	openItemAttachmentOrNote,
	resolvePrimaryCollectionName,
	restoreSessionTabsAndLayout,
	revealAttachmentFile,
	selectItemInLibrary,
	trackActiveReaderProgress,
	type ClosedTabRecord,
	type PublicationGroupSuggestion,
} from './tab-actions-helpers.ts';
import type { TabCloseOptions, TrackedTab, WorkspaceSession } from './types.ts';

export class WorkspaceTabController {
	private readonly prefs: UnifiedPrefService;
	private readonly store: WorkspaceStateStore;
	private readonly clipboard: UnifiedClipboardService;
	private closedStack: ClosedTabRecord[] = [];

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
			const creatorYear = formatCreatorYear(displayItem);
			const collection = resolvePrimaryCollectionName(displayItem);

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
				sleeping: this.store.isSleeping(key) || String(tab.type || '').endsWith('-unloaded'),
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
				this.store.saveVirtualMember(buildVirtualMetaFromTracked(t));
			}
			if (t.itemID > 0) {
				this.closedStack.push({ key: t.key, itemID: t.itemID, groupId: t.groupId, title: t.title, closedAt: Date.now() });
				if (this.closedStack.length > 20) this.closedStack.shift();
			}
			toClose.push(id);
		}
		if (!toClose.length) return 0;
		tabsApi.close(toClose.length === 1 ? toClose[0] : toClose);
		return toClose.length;
	}

	undoCloseTab(win: Window): boolean {
		const tabsApi = (win as any).Zotero_Tabs;
		if (typeof tabsApi?.undoClose === 'function') {
			try {
				void Promise.resolve(tabsApi.undoClose());
				return true;
			} catch { /* fall back */ }
		}
		const last = this.closedStack.pop();
		if (!last) return false;
		void this.openVirtualOrItem(win, last.itemID, last.groupId || undefined, false);
		return true;
	}

	sleepTab(win: Window, tabID: string): boolean {
		if (!this.prefs.get('workspace.enableTabSleep')) return false;
		const tabsApi = (win as any).Zotero_Tabs;
		const tracked = this.buildTrackedTabs(win).find((t) => t.tabID === tabID);
		if (!tracked || tracked.pinned || tracked.virtual || tracked.sleeping) return false;
		if (tabsApi?.canUnload?.(tabID) === false) return false;
		if (typeof tabsApi?.unload === 'function') {
			tabsApi.unload(tabID);
		}
		this.store.setSleeping(tracked.key, true);
		return true;
	}

	sleepInactiveTabs(win: Window): number {
		if (!this.prefs.get('workspace.enableTabSleep')) return 0;
		const selectedID = String((win as any).Zotero_Tabs?.selectedID || '');
		let count = 0;
		for (const tab of this.buildTrackedTabs(win)) {
			if (!tab.virtual && !tab.pinned && !tab.sleeping && tab.tabID !== selectedID) {
				if (this.sleepTab(win, tab.tabID)) count++;
			}
		}
		return count;
	}

	sleepIdleTabs(win: Window, now = Date.now()): number {
		const minutes = this.prefs.get('workspace.autoSleepMinutes');
		if (!this.prefs.get('workspace.enableTabSleep') || minutes <= 0) return 0;
		const selectedID = String((win as any).Zotero_Tabs?.selectedID || '');
		const cutoff = now - minutes * 60_000;
		let count = 0;
		for (const tab of this.buildTrackedTabs(win)) {
			if (tab.virtual || tab.pinned || tab.sleeping || tab.tabID === selectedID) continue;
			if (tab.lastViewedAt > 0 && tab.lastViewedAt < cutoff) {
				if (this.sleepTab(win, tab.tabID)) count++;
			}
		}
		return count;
	}

	async reloadTab(win: Window, tabID: string): Promise<boolean> {
		const tracked = this.buildTrackedTabs(win).find((t) => t.tabID === tabID);
		if (!tracked) return false;
		this.store.setSleeping(tracked.key, false);
		this.selectTab(win, tabID);
		const reader = (globalThis as any).Zotero?.Reader?.getByTabID?.(tabID);
		if (typeof reader?.reload === 'function') await reader.reload();
		return true;
	}

	moveTabRelative(win: Window, draggedTabID: string, targetTabID: string, after: boolean): boolean {
		const tabsApi = (win as any).Zotero_Tabs;
		if (!tabsApi?.move) return false;
		const ids: string[] = (Array.isArray(tabsApi._tabs) ? tabsApi._tabs : []).map((t: any) => String(t?.id || ''));
		const targetIdx = computeTabMoveTarget(ids, draggedTabID, targetTabID, after);
		if (targetIdx < 0) return false;
		tabsApi.move(draggedTabID, targetIdx);
		return true;
	}

	openVirtualOrItem(win: Window, itemID: number, groupId?: string, openInBackground = false): Promise<boolean> {
		return openItemAttachmentOrNote(win, this.store, itemID, groupId, openInBackground);
	}

	async restoreSession(win: Window, session: WorkspaceSession, merge = true): Promise<number> {
		this.store.restoreSessionLayout(session, merge);
		return restoreSessionTabsAndLayout(win, this.store, session);
	}

	getRecentlyClosed(win: Window): ClosedTabRecord[] {
		const openKeys = new Set(this.buildTrackedTabs(win).filter((t) => !t.virtual).map((t) => t.key));
		return collectRecentlyClosed(win, this.closedStack, openKeys);
	}

	getPublicationSuggestions(win: Window): PublicationGroupSuggestion[] {
		return buildPublicationSuggestions(this.buildTrackedTabs(win));
	}

	async openGroupVirtuals(win: Window, groupId: string): Promise<number> {
		const virtuals = this.buildTrackedTabs(win).filter((t) => t.virtual && t.groupId === groupId);
		let opened = 0;
		for (const v of virtuals) {
			if (await this.openVirtualOrItem(win, v.itemID, groupId, true)) opened++;
		}
		return opened;
	}

	revealTabAttachment(win: Window, itemID: number): Promise<boolean> {
		return revealAttachmentFile(win, itemID);
	}

	showInLibrary(win: Window, itemID: number, switchCollection = false): Promise<boolean> {
		return selectItemInLibrary(win, itemID, switchCollection);
	}

	async archiveAndCloseGroup(win: Window, groupId: string): Promise<number> {
		const group = this.store.state.groups.find((g) => g.id === groupId);
		if (!group) return 0;
		const ids = this.buildTrackedTabs(win).filter((t) => t.groupId === groupId && t.tabID).map((t) => t.tabID);
		this.store.saveSession(group.name);
		return this.closeTabs(win, ids, { preserveVirtual: true, protectPinned: true });
	}

	autoGroupByCollection(win: Window): number {
		return autoGroupTrackedByCollection(
			win,
			this.store,
			this.prefs.get('workspace.multiCollectionStrategy'),
			this.buildTrackedTabs(win),
		);
	}

	collectionToGroup(win: Window, collectionName: string): number {
		const targetCols = this.buildTrackedTabs(win).filter((t) => (t.collection || '未分类') === collectionName);
		if (!targetCols.length) return 0;
		const group = this.store.state.groups.find((g) => g.name === collectionName) ?? this.store.createGroup(collectionName);
		for (const tab of targetCols) {
			this.store.assignToGroup(tab.key, group.id);
		}
		return targetCols.length;
	}

	getDisplayTitle(tab: { key?: string; title: string; shortTitle?: string; filename?: string; remark?: string }): string {
		const titleMode = this.prefs.get('workspace.verticalTabTitleMode');
		const base = titleMode === 'shortTitle' && tab.shortTitle
			? tab.shortTitle
			: titleMode === 'filename' && tab.filename
				? tab.filename
				: tab.title;
		if (!this.prefs.get('workspace.enableTabRemarks') || !tab.remark) return base;
		const perTabMode = tab.key ? this.store.state.remarkModes[tab.key] : undefined;
		const mode = perTabMode || this.prefs.get('workspace.remarkDisplayMode');
		if (mode === 'remark') return tab.remark;
		if (mode === 'title') return base;
		return `${tab.remark} · ${base}`;
	}

	async copyTabCitation(win: Window, tabID: string): Promise<boolean> {
		const tracked = this.buildTrackedTabs(win).find((t) => t.tabID === tabID);
		if (!tracked) return false;
		const item = (globalThis as any).Zotero?.Items?.get?.(tracked.parentItemID || tracked.itemID);
		if (!item) return false;
		return this.clipboard.copyItems([item], { source: 'tab-menu' });
	}

	focusOrOpenItem(win: Window, req: OpenItemRequestPayload): Promise<'focused' | 'opened' | 'not-found'> {
		return focusOrOpenTrackedItem(
			win,
			this.store,
			this.buildTrackedTabs(win),
			req,
			(tabID) => this.selectTab(win, tabID),
		);
	}

	groupOpenTabsByItemIDs(win: Window, groupName: string, itemIDs: readonly number[]): { groupId: string; count: number } | null {
		const idSet = new Set(itemIDs);
		if (!idSet.size) return null;
		const matching = this.buildTrackedTabs(win).filter(
			(t) => !t.virtual && (idSet.has(t.parentItemID) || idSet.has(t.itemID)),
		);
		if (!matching.length) return null;
		const group = this.store.state.groups.find((g) => g.name === groupName) ?? this.store.createGroup(groupName);
		for (const tab of matching) this.store.assignToGroup(tab.key, group.id);
		return { groupId: group.id, count: matching.length };
	}

	findStaleTabs(win: Window, now = Date.now()): TrackedTab[] {
		const days = this.prefs.get('workspace.staleSuggestDays');
		const cutoff = now - days * 86_400_000;
		return this.buildTrackedTabs(win).filter(
			(t) => !t.virtual && !t.pinned && t.lastViewedAt > 0 && t.lastViewedAt < cutoff,
		);
	}

	trackReadingProgress(win: Window, elapsedSeconds: number): boolean {
		return trackActiveReaderProgress(win, this.store, this.buildTrackedTabs(win), elapsedSeconds);
	}
}
