import { DisposableStack } from '../../kernel/disposable.ts';
import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type {
	CitationBadgeInfo, Disposable, DomainModule, OpenItemRequestPayload, SpotlightProvider,
} from '../../kernel/types.ts';
import type { ServiceContainer } from '../../services/service-container.ts';
import { SpotlightEngine } from './spotlight-engine.ts';
import { WorkspaceStateStore } from './state-store.ts';
import { WorkspaceTabController } from './tab-controller.ts';
import { WorkspaceWindowUI } from './workspace-ui.ts';

export class WorkspaceDomainModule implements DomainModule {
	public readonly id = 'workspace' as const;
	public readonly enabledPref = 'modules.workspace.enable';
	public readonly store: WorkspaceStateStore;
	public readonly tabs: WorkspaceTabController;
	public readonly spotlight: SpotlightEngine;

	private readonly kernel: PluginKernel;
	private readonly disposables = new DisposableStack();
	private readonly windowUIs = new Map<Window, WorkspaceWindowUI>();
	private citationBadges: ReadonlyMap<number, CitationBadgeInfo> = new Map();
	private active = false;

	constructor(kernel: PluginKernel, services: ServiceContainer) {
		this.kernel = kernel;
		this.store = new WorkspaceStateStore(kernel.prefs);
		this.tabs = new WorkspaceTabController(kernel.prefs, this.store, services.clipboard);
		this.spotlight = new SpotlightEngine(this.tabs);
	}

	isActive(): boolean {
		return this.active;
	}

	start(): void {
		if (this.active) return;
		this.active = true;
		this.disposables.reset();

		this.disposables.add(
			this.kernel.notifier.subscribe(['tab', 'item', 'collection'], () => {
				for (const ui of this.windowUIs.values()) ui.render();
				this.emitTabsSummary();
			}),
		);

		this.disposables.add(
			this.kernel.prefs.observeKeys(
				[
					'workspace.enableHorizontalGroups',
					'workspace.enableVerticalSidebar',
					'workspace.verticalSidebarWidth',
					'workspace.verticalSidebarCollapsed',
					'workspace.verticalTabRowHeight',
					'workspace.verticalTabFontSize',
					'fusion.sidebarCiteBadge',
				],
				() => {
					for (const ui of this.windowUIs.values()) ui.render();
				},
			),
		);
	}

	onMainWindowLoad(win: Window): void {
		if (!this.active || this.windowUIs.has(win)) return;
		const ui = new WorkspaceWindowUI(win, this.kernel.prefs, this.store, this.tabs, this.spotlight);
		ui.setCitationBadges(this.citationBadges);
		ui.mount();
		this.windowUIs.set(win, ui);
		this.emitTabsSummary();
	}

	onMainWindowUnload(win: Window): void {
		const ui = this.windowUIs.get(win);
		if (!ui) return;
		this.windowUIs.delete(win);
		ui.dispose();
	}

	stop(): void {
		if (!this.active) return;
		this.active = false;
		for (const ui of this.windowUIs.values()) ui.dispose();
		this.windowUIs.clear();
		this.disposables.disposeAll();
	}

	// === Cross-domain controlled hooks (called by Layer 4 Bridges) ===
	registerSpotlightProvider(provider: SpotlightProvider): Disposable {
		return this.spotlight.registerProvider(provider);
	}

	setCitationBadges(badges: ReadonlyMap<number, CitationBadgeInfo>): void {
		this.citationBadges = badges;
		for (const ui of this.windowUIs.values()) ui.setCitationBadges(badges);
	}

	async focusOrOpenItem(req: OpenItemRequestPayload, preferredWin?: Window): Promise<'focused' | 'opened' | 'not-found'> {
		const targetWin = preferredWin || [...this.windowUIs.keys()][0] || (globalThis as any).Zotero?.getMainWindow?.();
		if (!targetWin) return 'not-found';
		return this.tabs.focusOrOpenItem(targetWin, req);
	}

	groupOpenTabsByItemIDs(groupName: string, itemIDs: readonly number[], preferredWin?: Window): { groupId: string; count: number } | null {
		const targetWin = preferredWin || [...this.windowUIs.keys()][0] || (globalThis as any).Zotero?.getMainWindow?.();
		if (!targetWin) return null;
		return this.tabs.groupOpenTabsByItemIDs(targetWin, groupName, itemIDs);
	}

	private emitTabsSummary(): void {
		const openItemIDs = new Set<number>();
		for (const win of this.windowUIs.keys()) {
			for (const t of this.tabs.buildTrackedTabs(win)) {
				if (!t.virtual && t.parentItemID > 0) openItemIDs.add(t.parentItemID);
			}
		}
		this.kernel.bus.emit('workspace:tabs-updated', {
			windowCount: this.windowUIs.size,
			openItemIDs: [...openItemIDs],
		});
	}
}
