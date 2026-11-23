import { DisposableStack } from '../../kernel/disposable.ts';
import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type {
	CitationBadgeInfo,
	Disposable,
	DomainModule,
	OpenItemRequestPayload,
	SpotlightProvider,
	WorkspaceGroupSummary,
} from '../../kernel/types.ts';
import type { ServiceContainer } from '../../services/service-container.ts';
import { normalizeToRegularItem } from '../../services/item-resolution.ts';
import { WorkspaceSpotlightEngine } from './spotlight-engine.ts';
import { WorkspaceStateStore } from './state-store.ts';
import { WorkspaceTabController } from './tab-controller.ts';
import { invalidateTabProjectionCache } from './tab-projection.ts';
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
	private refreshTimer: ReturnType<typeof setTimeout> | null = null;
	private lastGroupFingerprint = '';

	constructor(kernel: PluginKernel, services: ServiceContainer) {
		this.kernel = kernel;
		this.store = new WorkspaceStateStore(kernel.prefs);
		this.tabs = new WorkspaceTabController(kernel.prefs, this.store, services.clipboard, kernel.bus);
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
			this.kernel.bus.on('inspector:lookup-clipboard', ({ win }) => {
				const targetWin = win || this.getTargetWindow();
				if (targetWin && this.active) {
					this.windows.get(targetWin)?.openSpotlightWithQuery('');
				}
			}),
		);

		this.disposables.add(
			this.kernel.bus.on('workspace:groups-query', () => {
				if (this.active) this.emitGroupSummaries(true);
			}),
		);

		this.disposables.add(
			this.kernel.notifier.subscribe(['tab', 'collection', 'item'], ({ event, type, ids }) => {
				if (type === 'tab') {
					this.handleTabEvent(event, ids.map(String));
				} else if (event === 'modify' || event === 'add' || event === 'delete') {
					invalidateTabProjectionCache();
					if (type === 'item') this.spotlight.invalidateLibraryIndex();
					this.queueRefresh(32);
				}
			}),
		);

		for (const win of this.getMainWindows()) {
			this.onMainWindowLoad(win);
		}
		this.emitGroupSummaries(true);

		this.maintenanceTimer = setInterval(() => this.runPeriodicMaintenance(), 60_000);
		this.readingTimer = setInterval(() => {
			for (const win of this.windows.keys()) {
				if (this.tabs.trackReadingProgress(win, 15)) {
					this.viewedDirty = true;
				}
			}
			if (this.viewedDirty && this.kernel.prefs.get('workspace.verticalTabSubtitleMode') === 'lastViewed') {
				this.queueRefresh(50);
			}
		}, 15_000);
	}

	stop(): void {
		if (!this.active) return;
		this.active = false;
		if (this.refreshTimer !== null) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
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

	private queueRefresh(delayMs = 16): void {
		if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = null;
			if (this.active) this.refreshAllWindows();
		}, delayMs);
	}

	refreshAllWindows(): void {
		for (const ui of this.windows.values()) {
			ui.render();
		}
		this.emitGroupSummaries();
	}

	private emitGroupSummaries(force = false): void {
		if (!this.store.state.groups.length && !force && this.lastGroupFingerprint === '') return;
		const tabParentByKey = new Map<string, number>();
		for (const win of this.windows.keys()) {
			for (const tab of this.tabs.buildTrackedTabs(win)) {
				const pid = Number(tab.parentItemID || tab.itemID || 0);
				if (pid > 0) tabParentByKey.set(tab.key, pid);
			}
		}
		const hostItems = (globalThis as any).Zotero?.Items;
		const resolveRegularId = (rawId: number): number => {
			if (!Number.isSafeInteger(rawId) || rawId <= 0) return 0;
			const zItem = hostItems?.get?.(rawId);
			if (!zItem) return rawId;
			const reg = normalizeToRegularItem(zItem);
			return Number(reg?.id || 0);
		};
		const groups: WorkspaceGroupSummary[] = [];
		for (const group of this.store.state.groups) {
			const seen = new Set<number>();
			for (const key of group.memberKeys) {
				let rawId = tabParentByKey.get(key) || 0;
				if (!rawId) {
					const vm = this.store.state.virtualMembers[key];
					if (vm) rawId = Number(vm.parentItemID || vm.itemID || 0);
				}
				if (!rawId) {
					const m = key.match(/^item:(\d+)/);
					if (m) rawId = Number(m[1]);
				}
				const resolved = resolveRegularId(rawId);
				if (resolved > 0) seen.add(resolved);
			}
			groups.push({ groupId: group.id, groupName: group.name, itemIDs: [...seen] });
		}
		const fp = groups.map((g) => `${g.groupId}:${g.groupName}:${g.itemIDs.join(',')}`).join('|');
		if (!force && fp === this.lastGroupFingerprint) return;
		this.lastGroupFingerprint = fp;
		this.kernel.bus.emit('workspace:groups-updated', { groups });
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
