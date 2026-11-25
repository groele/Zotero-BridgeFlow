import { createWorkspaceElement } from './workspace-elements.ts';
import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import type { CitationBadgeInfo } from '../../kernel/types.ts';
import type { TrackedTab } from './types.ts';
import { WorkspaceHorizontalBar } from './horizontal-bar.ts';
import { WorkspaceToolbarActions } from './horizontal-toolbar.ts';
import { WorkspaceHoverCard } from './hover-card.ts';
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
	private readonly popover: WorkspacePopover | null = null;
	private readonly toolbar: WorkspaceToolbarActions | null = null;
	private readonly horizontal: WorkspaceHorizontalBar | null = null;
	private readonly sidebar: WorkspaceVerticalSidebar | null = null;
	private readonly spotlightPanel: WorkspaceSpotlightPanel | null = null;
	private tabObserver: MutationObserver | null = null;
	private renderTimer = 0;
	private destroyed = false;
	private readonly lifetime: AbortController | null;
	private readonly onActivity?: () => void;
	private readonly onWindowBlur?: () => void;
	private readonly boundReaderDocs = new WeakSet<Document>();
	private lastActivitySentAt = 0;

	private readonly onInputActivity = () => {
		const now = Date.now();
		if (now - this.lastActivitySentAt < 1500) return;
		this.lastActivitySentAt = now;
		this.onActivity?.();
	};

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
		this.scheduleRender(140);
	};

	constructor(
		win: Window,
		prefs: UnifiedPrefService,
		store: WorkspaceStateStore,
		tabs: WorkspaceTabController,
		spotlightEngine: WorkspaceSpotlightEngine,
		onActivity?: () => void,
		onWindowBlur?: () => void,
	) {
		this.win = win;
		this.doc = win.document;
		this.prefs = prefs;
		this.tabs = tabs;
		this.onActivity = onActivity;
		this.onWindowBlur = onWindowBlur;
		this.lifetime = this.doc ? new ((win as Window & typeof globalThis).AbortController)() : null;
		if (!this.doc || !this.lifetime) return;

		this.mountStyle();
		const refresh = () => this.render();

		this.hoverCard = new WorkspaceHoverCard(this.doc, prefs, store);
		this.popover = new WorkspacePopover(win, prefs, store, tabs, refresh);
		this.spotlightPanel = new WorkspaceSpotlightPanel(win, spotlightEngine);
		this.tabMenu = new WorkspaceTabContextMenu(win, prefs, store, tabs, refresh, this.hoverCard);
		this.toolbar = new WorkspaceToolbarActions(win, prefs, store, tabs, this.popover, (btn) => this.spotlightPanel?.toggle(btn), refresh);
		this.horizontal = new WorkspaceHorizontalBar(win, prefs, store, tabs, this.tabMenu, this.hoverCard, this.toolbar, refresh);
		this.sidebar = new WorkspaceVerticalSidebar(win, prefs, store, tabs, this.tabMenu, this.hoverCard, this.popover, (btn) => this.spotlightPanel?.toggle(btn), refresh);

		this.attachObservers();
		this.bindNativeTabContextMenu();
		this.doc.addEventListener('keydown', this.onKeydown, { capture: true, signal: this.lifetime.signal });
		this.doc.addEventListener('pointerdown', this.onInputActivity, { capture: true, passive: true, signal: this.lifetime.signal });
		this.doc.addEventListener('keydown', this.onInputActivity, { capture: true, passive: true, signal: this.lifetime.signal });
		this.doc.addEventListener('wheel', this.onInputActivity, { capture: true, passive: true, signal: this.lifetime.signal });
		this.win.addEventListener('resize', this.onResize, { signal: this.lifetime.signal });
		this.win.addEventListener('focus', this.onInputActivity, { signal: this.lifetime.signal });
		this.win.addEventListener('blur', () => this.onWindowBlur?.(), { signal: this.lifetime.signal });
		this.render();
	}

	setCitationBadges(badges: ReadonlyMap<number, CitationBadgeInfo>): void {
		this.hoverCard?.setWordCitationBadges(badges);
		this.sidebar?.setWordCitationBadges(badges);
		this.scheduleRender(16);
	}

	openSpotlightWithQuery(initialQuery = ''): void {
		this.spotlightPanel?.open(initialQuery);
	}

	render(): TrackedTab[] {
		if (this.destroyed || !this.doc) return [];
		try {
			this.bindOpenReaderDocs();
			const snapshot = this.tabs.buildTrackedTabs(this.win);
			this.sidebar?.render(snapshot);
			this.horizontal?.render(snapshot);
			return snapshot;
		} catch (error) {
			(globalThis as any).Zotero?.logError?.(error);
			return [];
		}
	}

	private bindOpenReaderDocs(): void {
		if (!this.lifetime) return;
		const nativeTabs: any[] = (this.win as any).Zotero_Tabs?._tabs ?? [];
		for (const tab of nativeTabs) {
			if (!tab?.id || tab.type === 'library') continue;
			const iframeDoc = (globalThis as any).Zotero?.Reader?.getByTabID?.(tab.id)
				?._internalReader?._primaryView?._iframeWindow?.document as Document | undefined;
			if (!iframeDoc || this.boundReaderDocs.has(iframeDoc)) continue;
			this.boundReaderDocs.add(iframeDoc);
			const sig = this.lifetime.signal;
			iframeDoc.addEventListener('keydown', this.onKeydown, { capture: true, signal: sig });
			iframeDoc.addEventListener('pointerdown', this.onInputActivity, { capture: true, passive: true, signal: sig });
			iframeDoc.addEventListener('keydown', this.onInputActivity, { capture: true, passive: true, signal: sig });
			iframeDoc.addEventListener('wheel', this.onInputActivity, { capture: true, passive: true, signal: sig });
		}
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		if (this.renderTimer && typeof this.win.clearTimeout === 'function') {
			this.win.clearTimeout(this.renderTimer);
		}
		this.tabObserver?.disconnect();
		this.tabObserver = null;
		this.lifetime?.abort();
		this.horizontal?.destroy();
		this.sidebar?.destroy();
		this.tabMenu?.destroy();
		this.popover?.destroy();
		this.hoverCard?.destroy();
		this.spotlightPanel?.destroy();
		this.styleEl?.remove();
		this.styleEl = null;
	}

	private mountStyle(): void {
		if (!this.doc) return;
		this.doc.getElementById('zbf-workspace-style')?.remove();
		const style = createWorkspaceElement(this.doc, 'style');
		style.id = 'zbf-workspace-style';
		style.textContent = WORKSPACE_CSS;
		const target = this.doc.head || this.doc.documentElement;
		target?.appendChild(style);
		this.styleEl = style;
	}

	private bindNativeTabContextMenu(): void {
		if (!this.doc || !this.lifetime) return;
		const tabBar = this.doc.getElementById('tab-bar-container');
		if (!tabBar) return;
		tabBar.addEventListener('contextmenu', (ev: Event) => {
			if (this.destroyed || !this.prefs.get('workspace.enableTabContextMenu')) return;
			const target = ev.target as Element | null;
			if (!target || typeof target.closest !== 'function') return;
			if (target.closest('#zbf-inline, #zbf-toolbar-actions')) return;
			const nativeTabEl = target.closest('.tabs-wrapper .tab, .pinned-tabs .tab') as HTMLElement | null;
			if (!nativeTabEl) return;
			const tracked = resolveNativeTabFromElement(this.win, nativeTabEl, this.tabs.buildTrackedTabs(this.win));
			if (!tracked) return;
			ev.preventDefault();
			ev.stopPropagation();
			this.tabMenu?.openTabMenu(nativeTabEl, tracked, ev as MouseEvent);
		}, { signal: this.lifetime.signal });
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
		return Boolean(el.closest('#zbf-inline, #zbf-toolbar-actions, #zbf-sidebar'));
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

export function resolveNativeTabFromElement(
	win: Window,
	tabEl: Element,
	trackedTabs: TrackedTab[],
): TrackedTab | null {
	const liveTabs = trackedTabs.filter((t) => !t.virtual && Boolean(t.tabID));
	if (!liveTabs.length) return null;

	const rawId = tabEl.getAttribute?.('data-tab-id')
		|| tabEl.getAttribute?.('tab-id')
		|| tabEl.getAttribute?.('data-id')
		|| '';
	if (rawId) {
		const byAttr = liveTabs.find((t) => t.tabID === rawId);
		if (byAttr) return byAttr;
	}

	const elId = tabEl.id || '';
	if (elId) {
		const stripped = elId.startsWith('tab-') ? elId.slice(4) : elId;
		const byId = liveTabs.find((t) => t.tabID === elId || t.tabID === stripped);
		if (byId) return byId;
	}

	const doc = win.document;
	const nativeTabs: Array<{ id?: string; title?: string; pinned?: boolean }> =
		Array.isArray((win as any).Zotero_Tabs?._tabs) ? (win as any).Zotero_Tabs._tabs : [];
	const isPinnedEl = Boolean(tabEl.closest?.('.pinned-tabs'));
	const containerSel = isPinnedEl ? '#tab-bar-container .pinned-tabs .tab' : '#tab-bar-container .tabs-wrapper .tab';
	const siblingTabs = doc?.querySelectorAll ? Array.from(doc.querySelectorAll(containerSel)) : [];
	const domIdx = siblingTabs.indexOf(tabEl);
	if (domIdx >= 0 && nativeTabs.length > 0) {
		const pool = isPinnedEl
			? nativeTabs.filter((nt) => Boolean(nt?.pinned))
			: nativeTabs.filter((nt) => !nt?.pinned);
		const candidate = pool[domIdx] || (isPinnedEl ? null : nativeTabs[domIdx]);
		if (candidate?.id) {
			const byIndex = liveTabs.find((t) => t.tabID === candidate.id);
			if (byIndex) return byIndex;
		}
	}

	const labelText = (
		tabEl.querySelector?.('.tab-name')?.textContent
		|| tabEl.getAttribute?.('title')
		|| tabEl.textContent
		|| ''
	).trim();
	if (labelText) {
		const byTitle = liveTabs.find((t) => t.title === labelText || t.shortTitle === labelText || t.filename === labelText);
		if (byTitle) return byTitle;
	}

	return null;
}
