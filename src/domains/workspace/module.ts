import { DisposableStack } from '../../kernel/disposable.ts';
import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { CitationBadgeInfo, Disposable, DomainModule, OpenItemRequestPayload, SpotlightProvider } from '../../kernel/types.ts';
import type { ServiceContainer } from '../../services/service-container.ts';
import { WorkspaceSpotlightEngine } from './spotlight-engine.ts';
import { WorkspaceStateStore } from './state-store.ts';
import { WorkspaceTabController } from './tab-controller.ts';
import { WorkspaceWindowUI } from './workspace-ui.ts';

const WATCHED_WORKSPACE_PREFS = [
	'workspace.enableHorizontalGroups',
	'workspace.horizontalTabCompactMode',
	'workspace.compactTopBar',
	'workspace.enableVerticalSidebar',
	'workspace.verticalSidebarCollapsed',
	'workspace.verticalSidebarWidth',
	'workspace.enableBatchSelection',
	'workspace.enablePinnedTabs',
	'workspace.pinnedIconOnly',
	'workspace.enableVirtualMembers',
	'workspace.enableTabRemarks',
	'workspace.remarkDisplayMode',
	'workspace.verticalTabTitleMode',
	'workspace.verticalTabSubtitleMode',
	'workspace.verticalTabRowHeight',
	'workspace.verticalTabFontSize',
	'workspace.enableHoverPreview',
	'workspace.enableSpotlight',
	'workspace.enableSessions',
	'workspace.enableTabSleep',
	'workspace.activeReaderBudget',
	'workspace.enableStaleSuggestions',
	'workspace.staleSuggestDays',
] as const;

export class WorkspaceDomainModule implements DomainModule {
	public readonly id = 'workspace' as const;
	public readonly enabledPref = 'modules.workspace.enable' as const;

	public readonly store: WorkspaceStateStore;
	public readonly tabs: WorkspaceTabController;
	public readonly spotlight: WorkspaceSpotlightEngine;

	private readonly kernel: PluginKernel;
	private readonly disposables = new DisposableStack();
	private readonly windows = new Map<Window, WorkspaceWindowUI>();
	private active = false;
	private latestBadges: ReadonlyMap<number, CitationBadgeInfo> = new Map();
	private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
	private readingTimer: ReturnType<typeof setInterval> | null = null;
	private autoGroupTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingAutoGroup = new Set<string>();
	private lastRollingAt = 0;
	private viewedDirty = false;
	private refreshQueued = false;

	constructor(kernel: PluginKernel, services: ServiceContainer) {
		this.kernel = kernel;
		this.store = new WorkspaceStateStore(kernel.prefs);
		this.tabs = new WorkspaceTabController(kernel.prefs, this.store, services.clipboard);
		this.spotlight = new WorkspaceSpotlightEngine(kernel.prefs, this.store, this.tabs);
	}

	async start(): Promise<void> {
		if (this.active) return;
		this.active = true;
		this.disposables.reset();
		this.store.load();
		void this.store.initDiskCache().then((merged) => {
			if (merged && this.active) this.refreshAllWindows();
		});

		this.disposables.add(this.store.onChange(() => this.queueRefresh()));

		this.disposables.add(
			this.kernel.prefs.observeKeys([...WATCHED_WORKSPACE_PREFS], () => this.refreshAllWindows()),
		);

		this.disposables.add(
			this.kernel.notifier.subscribe(['tab', 'collection', 'item'], ({ event, type, ids }) => {
				if (type === 'tab') {
					this.handleTabEvent(event, ids.map(String));
				} else if (event === 'modify' || event === 'add' || event === 'delete') {
					if (type === 'item') this.spotlight.invalidateLibraryIndex();
					this.refreshAllWindows();
				}
			}),
		);

		for (const win of this.getMainWindows()) {
			this.onMainWindowLoad(win);
		}

		this.maintenanceTimer = setInterval(() => this.runPeriodicMaintenance(), 60_000);
		this.readingTimer = setInterval(() => {
			let updated = false;
			for (const win of this.windows.keys()) {
				if (this.tabs.trackReadingProgress(win, 15)) {
					this.viewedDirty = true;
					updated = true;
				}
			}
			if (updated) this.refreshAllWindows();
		}, 15_000);
	}

	stop(): void {
		if (!this.active) return;
		this.active = false;
		if (this.maintenanceTimer !== null) {
			clearInterval(this.maintenanceTimer);
			this.maintenanceTimer = null;
		}
		if (this.readingTimer !== null) {
			clearInterval(this.readingTimer);
			this.readingTimer = null;
		}
		if (this.autoGroupTimer !== null) {
			clearTimeout(this.autoGroupTimer);
			this.autoGroupTimer = null;
		}
		for (const ui of this.windows.values()) {
			ui.destroy();
		}
		this.windows.clear();
		this.pendingAutoGroup.clear();
		if (this.viewedDirty) { this.viewedDirty = false; this.store.save(true); }
		else { void this.store.diskCache.flushNow(this.store.state); }
		this.store.diskCache.dispose();
		this.disposables.disposeAll();
	}

	isActive(): boolean {
		return this.active;
	}

	onMainWindowLoad(win: Window): void {
		if (!this.active || this.windows.has(win)) return;
		const ui = new WorkspaceWindowUI(win, this.kernel.prefs, this.store, this.tabs, this.spotlight);
		ui.setCitationBadges(this.latestBadges);
		this.windows.set(win, ui);
	}

	onMainWindowUnload(win: Window): void {
		const ui = this.windows.get(win);
		if (!ui) return;
		ui.destroy();
		this.windows.delete(win);
	}

	private queueRefresh(): void {
		if (this.refreshQueued) return;
		this.refreshQueued = true;
		Promise.resolve().then(() => {
			this.refreshQueued = false;
			if (this.active) this.refreshAllWindows();
		});
	}

	refreshAllWindows(): void {
		for (const ui of this.windows.values()) {
			ui.render();
		}
	}

	setCitationBadges(badges: ReadonlyMap<number, CitationBadgeInfo>): void {
		this.latestBadges = new Map(badges);
		this.spotlight.setWordCitationBadges(badges);
		for (const ui of this.windows.values()) {
			ui.setCitationBadges(badges);
		}
	}

	registerSpotlightProvider(provider: SpotlightProvider): Disposable {
		return this.spotlight.registerProvider(provider);
	}

	async focusOrOpenItem(req: OpenItemRequestPayload, preferredWin?: Window): Promise<'focused' | 'opened' | 'not-found'> {
		const win = preferredWin || this.getTargetWindow();
		if (!win) return 'not-found';
		const res = await this.tabs.focusOrOpenItem(win, req);
		this.refreshAllWindows();
		return res;
	}

	groupOpenTabsByItemIDs(
		groupName: string,
		itemIDs: readonly number[],
		preferredWin?: Window,
	): { groupId: string; count: number } | null {
		const win = preferredWin || this.getTargetWindow();
		if (!win) return null;
		const res = this.tabs.groupOpenTabsByItemIDs(win, groupName, itemIDs);
		if (res) this.refreshAllWindows();
		return res;
	}

	private handleTabEvent(event: string, tabIDs: readonly string[]): void {
		for (const win of this.windows.keys()) {
			const tracked = this.tabs.buildTrackedTabs(win);

			for (const id of tabIDs) {
				const tab = tracked.find((t) => t.tabID === id);
				if (!tab) continue;
				if (event === 'select' || event === 'add') {
					this.store.touchViewed(tab.key);
					this.viewedDirty = true;
					this.store.removeVirtualMember(tab.key);
					if (tab.sleeping) this.store.setSleeping(tab.key, false);
					if (tab.groupId && this.store.state.collapsed.includes(tab.groupId)) {
						this.store.setCollapsed(tab.groupId, false);
					}
				}
			}
		}

		if (event === 'add' && this.kernel.prefs.get('workspace.newTabMode') === 'collection') {
			for (const id of tabIDs) this.pendingAutoGroup.add(id);
			if (this.autoGroupTimer !== null) clearTimeout(this.autoGroupTimer);
			this.autoGroupTimer = setTimeout(() => {
				this.autoGroupTimer = null;
				const added = this.pendingAutoGroup;
				this.pendingAutoGroup = new Set();
				for (const win of this.windows.keys()) this.tabs.autoGroupByCollection(win, added);
				this.refreshAllWindows();
			}, 80);
		}
		this.refreshAllWindows();
	}

	private runPeriodicMaintenance(): void {
		if (!this.active) return;
		let changed = false;
		for (const win of this.windows.keys()) {
			if (this.tabs.sleepIdleTabs(win) > 0) changed = true;
		}
		if (this.viewedDirty) {
			this.viewedDirty = false;
			this.store.save();
		}
		if (this.kernel.prefs.get('workspace.enableRollingSnapshots') && Date.now() - this.lastRollingAt > 900_000) {
			const openKeys = [...new Set([...this.windows.keys()].flatMap(win => this.tabs.openKeys(win)))];
			if (openKeys.length || this.store.state.groups.length > 0 || this.store.state.pinnedKeys.length > 0) {
				this.store.saveSession(`自动滚动快照 ${new Date().toLocaleTimeString()}`, { rolling: true, openKeys });
				this.lastRollingAt = Date.now();
			}
		}
		if (changed) this.refreshAllWindows();
	}

	private getTargetWindow(): Window | null {
		const hostWin = (globalThis as any).Zotero?.getMainWindow?.();
		if (hostWin) return hostWin;
		return this.windows.keys().next().value ?? null;
	}

	private getMainWindows(): Window[] {
		const wins = (globalThis as any).Zotero?.getMainWindows?.();
		return Array.isArray(wins) ? wins : [];
	}
}
