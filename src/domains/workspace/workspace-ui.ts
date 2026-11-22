import { DisposableStack } from '../../kernel/disposable.ts';
import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import type { CitationBadgeInfo } from '../../kernel/types.ts';
import { HorizontalBarController } from './horizontal-bar.ts';
import { HoverCardController } from './hover-card.ts';
import { ItemContextMenuController } from './item-context-menu.ts';
import type { SpotlightEngine } from './spotlight-engine.ts';
import { SpotlightPanelController } from './spotlight-panel.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import { TabContextMenuController } from './tab-context-menu.ts';
import type { WorkspaceTabController } from './tab-controller.ts';
import { VerticalSidebarController } from './vertical-sidebar.ts';
import { WorkspacePopoverController } from './workspace-popover.ts';
import { WORKSPACE_CSS } from './workspace-styles.ts';

export class WorkspaceWindowUI {
	private readonly disposables = new DisposableStack();
	private readonly win: Window;
	private readonly prefs: UnifiedPrefService;
	private readonly store: WorkspaceStateStore;
	private readonly hover: HoverCardController;
	private readonly tabMenus: TabContextMenuController;
	private readonly itemMenus: ItemContextMenuController;
	private readonly spotlightPanel: SpotlightPanelController;
	private readonly workspacePopover: WorkspacePopoverController;
	private readonly horizontal: HorizontalBarController;
	private readonly sidebar: VerticalSidebarController;
	private mountRetryTimer: number | null = null;

	constructor(
		win: Window,
		prefs: UnifiedPrefService,
		store: WorkspaceStateStore,
		tabs: WorkspaceTabController,
		spotlight: SpotlightEngine,
	) {
		this.win = win;
		this.prefs = prefs;
		this.store = store;
		const refresh = () => this.render();
		this.hover = new HoverCardController(win, win.document);
		this.tabMenus = new TabContextMenuController(win, win.document, prefs, store, tabs, refresh);
		this.itemMenus = new ItemContextMenuController(win, win.document, prefs, store, tabs, refresh);
		this.spotlightPanel = new SpotlightPanelController(win, win.document, spotlight);
		this.workspacePopover = new WorkspacePopoverController(win, win.document, store, tabs, refresh);
		this.horizontal = new HorizontalBarController(
			win, win.document, prefs, store, tabs, this.tabMenus, this.hover,
			this.spotlightPanel, this.workspacePopover, refresh,
		);
		this.sidebar = new VerticalSidebarController(
			win, win.document, prefs, store, tabs, this.tabMenus, this.hover, refresh,
		);
	}

	mount(): void {
		const doc = this.win.document;
		if (!doc) return;

		if (doc.readyState === 'loading') {
			const onReady = (): void => { this.mount(); };
			doc.addEventListener('DOMContentLoaded', onReady, { once: true });
			this.disposables.add(() => doc.removeEventListener('DOMContentLoaded', onReady));
			return;
		}

		this.win.MozXULElement?.insertFTLIfNeeded?.('zotero-bridgeflow.ftl');

		if (doc.documentElement && !doc.getElementById('zbf-workspace-style')) {
			const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style') as HTMLStyleElement;
			style.id = 'zbf-workspace-style';
			style.textContent = WORKSPACE_CSS;
			doc.documentElement.append(style);
			this.disposables.add(() => style.remove());
		}

		this.itemMenus.attach();

		const onKeyDown = (ev: KeyboardEvent): void => {
			if (!this.prefs.get('workspace.enableSpotlight')) return;
			if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'p') {
				ev.preventDefault();
				ev.stopPropagation();
				this.spotlightPanel.toggle();
			}
		};
		this.win.addEventListener?.('keydown', onKeyDown as EventListener, true);
		this.disposables.add(() => this.win.removeEventListener?.('keydown', onKeyDown as EventListener, true));
		this.disposables.add(this.store.onChange(() => this.render()));

		this.render();

		if (!doc.getElementById('zbf-toolbar-actions') && typeof this.win.setTimeout === 'function') {
			this.mountRetryTimer = this.win.setTimeout(() => {
				this.mountRetryTimer = null;
				this.itemMenus.attach();
				this.render();
			}, 300);
		}
	}

	setCitationBadges(badges: ReadonlyMap<number, CitationBadgeInfo>): void {
		this.horizontal.setCitationBadges(badges);
		this.sidebar.setCitationBadges(badges);
	}

	render(): void {
		this.horizontal.render();
		this.sidebar.render();
	}

	dispose(): void {
		if (this.mountRetryTimer !== null) {
			this.win.clearTimeout?.(this.mountRetryTimer);
			this.mountRetryTimer = null;
		}
		this.hover.dispose();
		this.tabMenus.dispose();
		this.itemMenus.dispose();
		this.workspacePopover.dispose();
		this.spotlightPanel.dispose();
		this.horizontal.dispose();
		this.sidebar.dispose();
		this.disposables.disposeAll();
	}
}
