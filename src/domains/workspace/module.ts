import { DisposableStack } from '../../kernel/disposable.ts';
import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { CitationBadgeInfo, Disposable, DomainModule, OpenItemRequestPayload, ReaderNeighborsPayload, SpotlightProvider, WorkspaceGroupSummary } from '../../kernel/types.ts';
import { invalidateResolvedItemCache } from '../../services/item-resolution.ts';
import type { ServiceContainer } from '../../services/service-container.ts';
import { createWorkspaceReadingNotesFacade, type SharedReadingNotesFacade } from '../../services/shared-reading-notes.ts';
import { ReaderAttachmentSwitcher } from './reader/reader-attachment-switcher.ts';
import { WorkspaceSpotlightEngine } from './spotlight/spotlight-engine.ts';
import { computeReaderNeighbors, ReaderNeighborPublisher } from './reader/reader-neighbors.ts';
import { WorkspaceStateStore } from './store/state-store.ts';
import { WorkspaceTabController } from './tabs/tab-controller.ts';
import { invalidateTabProjectionCache } from './tabs/tab-projection.ts';
import { buildWorkspaceGroupSummaries } from './workspace-group-emitter.ts';
import { flushWorkspaceReadingProgress, runWorkspaceMaintenance, type ReaderSnapshot } from './workspace-maintenance.ts';
import { WorkspaceWindowUI } from './workspace-ui.ts';

const WATCHED_WORKSPACE_PREFS = [
	'workspace.enableHorizontalGroups', 'workspace.horizontalTabCompactMode', 'workspace.horizontalAutoCompactThreshold',
	'workspace.compactTopBar', 'workspace.middleClickCloseTab', 'workspace.enableVerticalSidebar',
	'workspace.verticalSidebarCollapsed', 'workspace.verticalSidebarWidth', 'workspace.enableBatchSelection',
	'workspace.showSidebarProgressBar', 'workspace.showSidebarRowActions', 'workspace.enablePinnedTabs',
	'workspace.pinnedIconOnly', 'workspace.enableVirtualMembers', 'workspace.enableTabRemarks',
	'workspace.remarkDisplayMode', 'workspace.verticalTabTitleMode', 'workspace.verticalTabSubtitleMode',
	'workspace.verticalTabRowHeight', 'workspace.verticalTabFontSize', 'workspace.enableHoverPreview',
	'workspace.hoverPreviewDelayMs', 'workspace.hoverPreviewShowMeta', 'workspace.hoverPreviewShowRemark',
	'workspace.hoverPreviewShowReadingStats', 'workspace.hoverPreviewShowHeatmap', 'workspace.enableSpotlight',
	'workspace.enableSessions', 'workspace.enableTabSleep', 'workspace.activeReaderBudget',
	'workspace.enableStaleSuggestions', 'workspace.staleSuggestDays', 'workspace.enableShowInFilesystem',
	'workspace.enableTabContextMenu', 'workspace.enableCopyReference', 'workspace.enableReloadTab',
	'workspace.enableAnnotationMatrix', 'fusion.sidebarCiteBadge',
] as const;

export class WorkspaceDomainModule implements DomainModule {
	public readonly id = 'workspace' as const;
	public readonly enabledPref = 'modules.workspace.enable' as const;

	public readonly store: WorkspaceStateStore;
	public readonly tabs: WorkspaceTabController;
	public readonly spotlight: WorkspaceSpotlightEngine;
	public readonly attachmentSwitcher: ReaderAttachmentSwitcher;

	private readonly kernel: PluginKernel;
	private readonly neighbors: ReaderNeighborPublisher;
	private readonly readingNotesFacade: SharedReadingNotesFacade;
	private readonly disposables = new DisposableStack();
	private readonly windows = new Map<Window, WorkspaceWindowUI>();
	private active = false;
	private latestBadges: ReadonlyMap<number, CitationBadgeInfo> = new Map();
	private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
	private readingTimer: ReturnType<typeof setInterval> | null = null;
	private autoGroupTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingAutoGroup = new Set<string>();
	private lastRollingAt = 0;
	private lastReadingTickAt = Date.now();
	private lastActivityAt = Date.now();
	private readingDirty = false;
	private readonly lastReaderByWin = new WeakMap<Window, ReaderSnapshot>();
	private refreshTimer: ReturnType<typeof setTimeout> | null = null;
	private lastGroupFingerprint = '';

	constructor(kernel: PluginKernel, services: ServiceContainer) {
		this.kernel = kernel;
		this.store = new WorkspaceStateStore(kernel.prefs);
		this.tabs = new WorkspaceTabController(kernel.prefs, this.store, services.clipboard, kernel.bus);
		this.spotlight = new WorkspaceSpotlightEngine(kernel.prefs, this.store, this.tabs, kernel.commands);
		this.neighbors = new ReaderNeighborPublisher(kernel.bus);
		this.attachmentSwitcher = new ReaderAttachmentSwitcher(kernel, this.store);
		this.readingNotesFacade = createWorkspaceReadingNotesFacade(this.store, () => this.refreshAllWindows());
	}

	async start(): Promise<void> {
		if (this.active) return;
		this.active = true;
		this.disposables.reset();
		this.disposables.add(this.kernel.ports.register('workspace', {
			focusOrOpenItem: (req, win) => this.focusOrOpenItem(req, win),
			groupOpenTabsByItemIDs: (name, ids, win) => this.groupOpenTabsByItemIDs(name, ids, win),
			setCitationBadges: (badges) => this.setCitationBadges(badges),
			getGroupSummaries: () => this.getGroupSummaries(),
			getReaderNeighbors: (win) => this.getReaderNeighbors(win),
			registerSpotlightProvider: (provider) => this.registerSpotlightProvider(provider),
		}));
		this.disposables.add(this.store.onChange((change) => { if (change !== 'reading') this.queueRefresh(); }));
		this.disposables.add(this.kernel.prefs.observeKeys([...WATCHED_WORKSPACE_PREFS], () => this.refreshAllWindows()));
		this.disposables.add(this.kernel.prefs.observeKeys(['workspace.enableReaderAttachmentSwitcher', 'workspace.readerSwitcherIncludeSnapshots'], () => this.attachmentSwitcher.syncPref()));
		this.disposables.add(this.kernel.bus.on('workspace:groups-query', () => {
			if (this.active) this.emitGroupSummaries(true);
		}));
		this.disposables.add(this.kernel.bus.on('workspace:reader-neighbors-query', ({ win }) => {
			const targetWin = win || this.getTargetWindow();
			if (this.active && targetWin) this.neighbors.publish(targetWin, this.tabs.buildTrackedTabs(targetWin), true);
		}));

		this.disposables.add(
			this.kernel.notifier.subscribe(['tab', 'collection', 'item'], ({ event, type, ids }) => {
				if (type === 'tab') {
					this.handleTabEvent(event, ids.map(String));
				} else if (event === 'modify' || event === 'add' || event === 'delete' || event === 'trash' || event === 'restore') {
					const affectedIds = new Set<number>();
					const hostItems = (globalThis as any).Zotero?.Items;
					let hasNonAnnotation = event === 'delete' || type !== 'item' || !ids.length || !hostItems?.get;
					for (const raw of ids) {
						const id = Number(raw);
						if (!Number.isFinite(id) || id <= 0) continue;
						affectedIds.add(id);
						if (type === 'item' && hostItems?.get) {
							const it = hostItems.get(id);
							if (!it || (!it.isAnnotation?.() && it.itemType !== 'annotation')) hasNonAnnotation = true;
							const pid = Number(it?.parentItemID || 0);
							if (pid > 0) affectedIds.add(pid);
						}
					}
					if (!hasNonAnnotation) return;
					const idList = [...affectedIds];
					invalidateResolvedItemCache(idList);
					invalidateTabProjectionCache(type === 'item' ? idList : undefined);
					this.queueRefresh(32);
				}
			}),
		);

		this.attachmentSwitcher.start();
		for (const win of this.getMainWindows()) {
			this.onMainWindowLoad(win);
		}
		this.emitGroupSummaries(true);

		this.lastReadingTickAt = Date.now();
		this.lastActivityAt = Date.now();
		this.maintenanceTimer = setInterval(() => this.runPeriodicMaintenance(), 60_000);
		this.readingTimer = setInterval(() => this.flushReadingProgress(1), 15_000);
	}

	stop(): void {
		if (!this.active) return;
		this.active = false;
		if (this.refreshTimer !== null) { clearTimeout(this.refreshTimer); this.refreshTimer = null; }
		if (this.maintenanceTimer !== null) { clearInterval(this.maintenanceTimer); this.maintenanceTimer = null; }
		if (this.readingTimer !== null) { clearInterval(this.readingTimer); this.readingTimer = null; }
		if (this.autoGroupTimer !== null) { clearTimeout(this.autoGroupTimer); this.autoGroupTimer = null; }
		for (const ui of this.windows.values()) ui.destroy();
		this.windows.clear();
		this.pendingAutoGroup.clear();
		this.readingDirty = false;
		void this.store.flushLayoutToDisk();
		void this.store.readingCache.flushNow(this.store.state);
		void this.store.notesCache.flushNow(this.store.state);
		this.store.readingCache.dispose();
		this.store.notesCache.dispose();
		this.store.diskCache.dispose();
		this.attachmentSwitcher.stop();
		this.neighbors.reset();
		this.disposables.disposeAll();
	}

	isActive(): boolean { return this.active; }

	async initPersistence(): Promise<void> {
		await this.store.initDiskCache();
	}

	flushPendingNotes(): void {
		this.store.notesCache.flushPending(this.store.state);
	}

	onMainWindowLoad(win: Window): void {
		if (!this.active || this.windows.has(win)) return;
		const ui = new WorkspaceWindowUI(win, this.kernel.prefs, this.store, this.tabs, this.spotlight, () => {
			this.lastActivityAt = Date.now();
		}, () => this.flushReadingProgress(1, false));
		ui.setCitationBadges(this.latestBadges);
		this.windows.set(win, ui);
		const snap = this.tabs.resolveActiveReaderSnapshot(win);
		if (snap) this.lastReaderByWin.set(win, snap);
	}

	onMainWindowUnload(win: Window): void {
		const ui = this.windows.get(win);
		if (!ui) return;
		ui.destroy();
		this.windows.delete(win);
		this.lastReaderByWin.delete(win);
	}

	private flushReadingProgress(minElapsed = 1, usePreviousReader = false): void {
		const res = flushWorkspaceReadingProgress({
			windows: this.windows.keys(), tabs: this.tabs, store: this.store, kernel: this.kernel,
			lastReaderByWin: this.lastReaderByWin, lastReadingTickAt: this.lastReadingTickAt,
			lastActivityAt: this.lastActivityAt, readingDirty: this.readingDirty,
			onScheduleRefresh: () => this.queueRefresh(50),
		}, minElapsed, usePreviousReader);
		this.lastReadingTickAt = res.lastReadingTickAt;
		this.lastActivityAt = res.lastActivityAt;
		this.readingDirty = res.readingDirty;
	}

	private queueRefresh(delayMs = 16): void {
		if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => { this.refreshTimer = null; if (this.active) this.refreshAllWindows(); }, delayMs);
	}

	refreshAllWindows(): void {
		if (this.refreshTimer !== null) { clearTimeout(this.refreshTimer); this.refreshTimer = null; }
		const targetWin = this.getTargetWindow();
		let targetSnapshot: ReturnType<WorkspaceTabController['buildTrackedTabs']> | null = null;
		const snapshots: ReturnType<WorkspaceTabController['buildTrackedTabs']>[] = [];
		for (const [win, ui] of [...this.windows.entries()]) {
			if ((win as any).closed) { ui.destroy(); this.windows.delete(win); continue; }
			try {
				const snap = ui.render();
				snapshots.push(snap);
				if (win === targetWin) targetSnapshot = snap;
			} catch (err) { this.kernel.logger.error('workspace:render', err); }
		}
		if (targetWin && !(targetWin as any).closed) {
			try { this.neighbors.publish(targetWin, targetSnapshot ?? this.tabs.buildTrackedTabs(targetWin)); } catch { /* ignore */ }
		}
		this.emitGroupSummaries(false, snapshots);
	}

	private emitGroupSummaries(force = false, precomputedSnapshots?: ReadonlyArray<ReturnType<WorkspaceTabController['buildTrackedTabs']>>): void {
		if (!this.store.state.groups.length && !force && this.lastGroupFingerprint === '') return;
		const groups: WorkspaceGroupSummary[] = buildWorkspaceGroupSummaries(this.windows.keys(), this.tabs, this.store, precomputedSnapshots);
		const fp = groups.map((g) => `${g.groupId}:${g.groupName}:${g.itemIDs.join(',')}`).join('|');
		if (!force && fp === this.lastGroupFingerprint) return;
		this.lastGroupFingerprint = fp;
		this.kernel.bus.emit('workspace:groups-updated', { groups });
	}

	getReadingNotesFacade(): SharedReadingNotesFacade { return this.readingNotesFacade; }

	getGroupSummaries(): readonly WorkspaceGroupSummary[] {
		return buildWorkspaceGroupSummaries(this.windows.keys(), this.tabs, this.store);
	}

	getReaderNeighbors(win?: Window): ReaderNeighborsPayload | null {
		const targetWin = win || this.getTargetWindow();
		return targetWin ? computeReaderNeighbors(targetWin, this.tabs.buildTrackedTabs(targetWin)) : null;
	}

	setCitationBadges(badges: ReadonlyMap<number, CitationBadgeInfo>): void {
		this.latestBadges = new Map(badges);
		for (const ui of this.windows.values()) ui.setCitationBadges(badges);
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
		if (event === 'select' || event === 'close') {
			this.flushReadingProgress(2, true);
			this.lastActivityAt = Date.now();
		} else if (event === 'add') {
			this.lastActivityAt = Date.now();
		}
		for (const win of this.windows.keys()) {
			const tracked = this.tabs.buildTrackedTabs(win);

			for (const id of tabIDs) {
				const tab = tracked.find((t) => t.tabID === id);
				if (!tab) continue;
				if (event === 'select' || event === 'add') {
					this.store.touchViewed(tab.key);
					this.readingDirty = true;
					this.store.removeVirtualMember(tab.key);
					if (tab.sleeping) this.store.setSleeping(tab.key, false);
					if (tab.groupId && this.store.state.collapsed.includes(tab.groupId)) {
						this.store.setCollapsed(tab.groupId, false);
					}
				}
			}
			const snap = this.tabs.resolveActiveReaderSnapshot(win);
			if (snap) this.lastReaderByWin.set(win, snap);
			else this.lastReaderByWin.delete(win);
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
		const res = runWorkspaceMaintenance({
			windows: this.windows.keys(),
			tabs: this.tabs,
			store: this.store,
			kernel: this.kernel,
			readingDirty: this.readingDirty,
			lastRollingAt: this.lastRollingAt,
			refreshAllWindows: () => this.refreshAllWindows(),
		});
		this.readingDirty = res.readingDirty;
		this.lastRollingAt = res.lastRollingAt;
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
