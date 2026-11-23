import { projectWorkspaceTabs } from './tab-projection.ts';
import { closeWorkspaceTabs, isTabBusy } from './tab-close.ts';
import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import type { OpenItemRequestPayload } from '../../kernel/types.ts';
import type { UnifiedClipboardService } from '../../services/clipboard-service.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import {
	autoGroupTrackedByCollection,
	buildPublicationSuggestions,
	buildVirtualMetaFromTracked,
	collectRecentlyClosed,
	computeTabMoveTarget,
	focusOrOpenTrackedItem,
	openItemAttachmentOrNote,
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
	private readonly closedByWindow = new WeakMap<Window, ClosedTabRecord[]>();

	private closedHistory(win: Window): ClosedTabRecord[] {
		let history = this.closedByWindow.get(win);
		if (!history) { history = []; this.closedByWindow.set(win, history); }
		return history;
	}

	constructor(
		prefs: UnifiedPrefService,
		store: WorkspaceStateStore,
		clipboard: UnifiedClipboardService,
	) {
		this.prefs = prefs;
		this.store = store;
		this.clipboard = clipboard;
	}

	buildTrackedTabs(win: Window): TrackedTab[] {
		return projectWorkspaceTabs(win, this.store, this.prefs);
	}

	openKeys(win: Window): string[] {
		const tracked = this.buildTrackedTabs(win);
		for (const t of tracked) {
			if (t.itemID > 0) this.store.saveVirtualMember(buildVirtualMetaFromTracked(t));
		}
		return tracked.filter((t) => !t.virtual && t.itemID > 0).map((t) => t.key);
	}

	syncTrackedVirtualMeta(win: Window, groupId?: string): string[] {
		const tracked = this.buildTrackedTabs(win).filter((t) => !groupId || t.groupId === groupId);
		const keys: string[] = [];
		for (const t of tracked) {
			if (t.itemID > 0) {
				this.store.saveVirtualMember(buildVirtualMetaFromTracked(t));
				keys.push(t.key);
			}
		}
		if (groupId) {
			const grp = this.store.state.groups.find((g) => g.id === groupId);
			for (const k of grp?.memberKeys || []) {
				if (!keys.includes(k)) keys.push(k);
			}
		}
		return [...new Set(keys)];
	}

	saveGroupSnapshot(win: Window, groupId: string): WorkspaceSession | null {
		const group = this.store.state.groups.find((g) => g.id === groupId);
		if (!group) return null;
		const groupKeys = this.syncTrackedVirtualMeta(win, groupId);
		return this.store.saveSession(group.name, {
			openKeys: groupKeys,
			groupId,
		});
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
		return closeWorkspaceTabs(win, tabIDs, options, this.buildTrackedTabs(win), this.store, this.prefs, this.closedHistory(win));
	}

	undoCloseTab(win: Window): boolean {
		const tabsApi = (win as any).Zotero_Tabs;
		if (typeof tabsApi?.undoClose === 'function') {
			try {
				void Promise.resolve(tabsApi.undoClose());
				return true;
			} catch { /* fall back */ }
		}
		const last = this.closedHistory(win).pop();
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
		if (typeof tabsApi?.unload !== 'function' || tabsApi.selectedID === tabID || isTabBusy(win, tabID)) return false;
		if (tabsApi.unload(tabID) === false) return false;
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
		this.store.restoreSessionLayout(session, merge, this.openKeys(win));
		return restoreSessionTabsAndLayout(win, this.store, session);
	}

	getRecentlyClosed(win: Window): ClosedTabRecord[] {
		const openKeys = new Set(this.buildTrackedTabs(win).filter((t) => !t.virtual).map((t) => t.key));
		return collectRecentlyClosed(win, this.closedHistory(win), openKeys);
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
		this.saveGroupSnapshot(win, groupId);
		const ids = this.buildTrackedTabs(win).filter((t) => !t.virtual && t.groupId === groupId && t.tabID).map((t) => t.tabID);
		const closed = await this.closeTabs(win, ids, { preserveVirtual: false, protectPinned: true });
		const remainingLive = this.buildTrackedTabs(win).some((t) => !t.virtual && t.groupId === groupId);
		if (!remainingLive) {
			this.store.removeGroup(groupId);
		}
		return closed;
	}

	autoGroupByCollection(win: Window, onlyTabIDs?: ReadonlySet<string>): number {
		return autoGroupTrackedByCollection(
			win,
			this.store,
			this.prefs.get('workspace.multiCollectionStrategy'),
			this.buildTrackedTabs(win).filter(tab => !onlyTabIDs || onlyTabIDs.has(tab.tabID)),
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
