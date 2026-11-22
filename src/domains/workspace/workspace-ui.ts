import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import type { CitationBadgeInfo } from '../../kernel/types.ts';
import { WorkspaceHorizontalBar } from './horizontal-bar.ts';
import { WorkspaceToolbarActions } from './horizontal-toolbar.ts';
import { WorkspaceHoverCard } from './hover-card.ts';
import { ItemContextMenuController } from './item-context-menu.ts';
import type { WorkspaceSpotlightEngine } from './spotlight-engine.ts';
import { WorkspaceSpotlightPanel } from './spotlight-panel.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import { WorkspaceTabContextMenu } from './tab-context-menu.ts';
import type { WorkspaceTabController } from './tab-controller.ts';
import { WorkspaceVerticalSidebar } from './vertical-sidebar.ts';
import { WorkspacePopover } from './workspace-popover.ts';
import { WORKSPACE_CSS } from './workspace-styles.ts';

export class WorkspaceWindowUI {
	private readonly win: Window;
	private readonly doc: Document | undefined;
	private readonly prefs: UnifiedPrefService;
	private readonly tabs: WorkspaceTabController;
	private styleEl: HTMLStyleElement | null = null;
	private readonly hoverCard: WorkspaceHoverCard | null = null;
	private readonly tabMenu: WorkspaceTabContextMenu | null = null;
	private readonly itemMenu: ItemContextMenuController | null = null;
	private readonly popover: WorkspacePopover | null = null;
	private readonly toolbar: WorkspaceToolbarActions | null = null;
	private readonly horizontal: WorkspaceHorizontalBar | null = null;
	private readonly sidebar: WorkspaceVerticalSidebar | null = null;
	private readonly spotlightPanel: WorkspaceSpotlightPanel | null = null;
	private tabObserver: MutationObserver | null = null;
	private renderTimer = 0;
	private destroyed = false;

	private readonly onKeydown = (ev: Event) => {
		const e = ev as KeyboardEvent;
		if (e.defaultPrevented) return;
		const mod = e.ctrlKey || e.metaKey;
		if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p' && this.prefs.get('workspace.enableSpotlight')) {
			e.preventDefault();
			this.spotlightPanel?.toggle();
		} else if (mod && !e.altKey && e.shiftKey && e.key.toLowerCase() === 't') {
			e.preventDefault();
			this.tabs.undoCloseTab(this.win);
			this.scheduleRender(30);
		}
	};

	private readonly onResize = () => {
		this.scheduleRender(80);
	};

	constructor(
		win: Window,
		prefs: UnifiedPrefService,
		store: WorkspaceStateStore,
		tabs: WorkspaceTabController,
		spotlightEngine: WorkspaceSpotlightEngine,
	) {
		this.win = win;
		this.doc = win.document;
		this.prefs = prefs;
		this.tabs = tabs;
		if (!this.doc) return;

		this.mountStyle();
		const refresh = () => this.render();

		this.hoverCard = new WorkspaceHoverCard(this.doc, prefs, store);
		this.popover = new WorkspacePopover(win, prefs, store, tabs, refresh);
		this.spotlightPanel = new WorkspaceSpotlightPanel(win, spotlightEngine);
		this.tabMenu = new WorkspaceTabContextMenu(win, prefs, store, tabs, refresh);
		this.itemMenu = new ItemContextMenuController(win, this.doc, prefs, store, tabs, refresh);
		this.toolbar = new WorkspaceToolbarActions(win, prefs, tabs, this.popover, () => this.spotlightPanel?.toggle(), refresh);
		this.horizontal = new WorkspaceHorizontalBar(win, prefs, store, tabs, this.tabMenu, this.hoverCard, this.toolbar, refresh);
		this.sidebar = new WorkspaceVerticalSidebar(win, prefs, store, tabs, this.tabMenu, this.hoverCard, this.popover, () => this.spotlightPanel?.toggle(), refresh);

		this.itemMenu.attach();
		this.attachObservers();
		this.doc.addEventListener('keydown', this.onKeydown, true);
		this.win.addEventListener('resize', this.onResize);
		this.render();
	}

	setCitationBadges(badges: ReadonlyMap<number, CitationBadgeInfo>): void {
		this.hoverCard?.setWordCitationBadges(badges);
		this.sidebar?.setWordCitationBadges(badges);
		this.render();
	}

	render(): void {
		if (this.destroyed || !this.doc) return;
		try {
			this.horizontal?.render();
			this.sidebar?.render();
		} catch { /* keep Zotero window resilient */ }
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		if (this.renderTimer && typeof this.win.clearTimeout === 'function') {
			this.win.clearTimeout(this.renderTimer);
		}
		this.tabObserver?.disconnect();
		this.tabObserver = null;
		this.doc?.removeEventListener('keydown', this.onKeydown, true);
		this.win.removeEventListener?.('resize', this.onResize);
		this.horizontal?.destroy();
		this.sidebar?.destroy();
		this.tabMenu?.destroy();
		this.itemMenu?.dispose();
		this.popover?.destroy();
		this.hoverCard?.destroy();
		this.spotlightPanel?.destroy();
		this.styleEl?.remove();
		this.styleEl = null;
	}

	private mountStyle(): void {
		if (!this.doc) return;
		this.doc.getElementById('zbf-workspace-style')?.remove();
		const style = this.doc.createElement('style');
		style.id = 'zbf-workspace-style';
		style.textContent = WORKSPACE_CSS;
		const target = this.doc.head || this.doc.documentElement;
		target?.appendChild(style);
		this.styleEl = style;
	}

	private attachObservers(): void {
		if (!this.doc) return;
		const tabBar = this.doc.getElementById('tab-bar-container');
		const ObserverCtor = (this.win as any).MutationObserver || (globalThis as any).MutationObserver;
		if (!tabBar || typeof ObserverCtor !== 'function') return;

		const obs = new ObserverCtor((mutations: MutationRecord[]) => {
			if (this.destroyed) return;
			const external = mutations.some((m) => !this.isOwnNode(m.target));
			if (external) this.scheduleRender(40);
		});
		obs.observe(tabBar, { childList: true, subtree: true, attributes: true, attributeFilter: ['selected', 'class'] });
		this.tabObserver = obs;
	}

	private isOwnNode(node: Node | null): boolean {
		if (!node) return false;
		const el = typeof (node as any).closest === 'function' ? (node as unknown as Element) : (node as any).parentElement;
		if (!el || typeof el.closest !== 'function') return false;
		return Boolean(el.closest('#zbf-inline, #zbf-toolbar-actions'));
	}

	private scheduleRender(delayMs: number): void {
		if (this.destroyed) return;
		if (this.renderTimer && typeof this.win.clearTimeout === 'function') {
			this.win.clearTimeout(this.renderTimer);
		}
		this.renderTimer = this.win.setTimeout(() => {
			this.renderTimer = 0;
			this.render();
		}, delayMs);
	}
}
