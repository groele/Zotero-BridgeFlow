import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import type { CitationBadgeInfo } from '../../kernel/types.ts';
import type { HoverCardController } from './hover-card.ts';
import type { SpotlightPanelController } from './spotlight-panel.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import type { TabContextMenuController } from './tab-context-menu.ts';
import type { WorkspaceTabController } from './tab-controller.ts';
import type { TrackedTab } from './types.ts';
import { createWorkspaceIcon } from './workspace-icons.ts';
import type { WorkspacePopoverController } from './workspace-popover.ts';

export class HorizontalBarController {
	private groupBar: HTMLElement | null = null;
	private pinnedStrip: HTMLElement | null = null;
	private toolbarBar: HTMLElement | null = null;
	private badges: ReadonlyMap<number, CitationBadgeInfo> = new Map();
	private draggedKey: string | null = null;

	private readonly win: Window;
	private readonly doc: Document;
	private readonly prefs: UnifiedPrefService;
	private readonly store: WorkspaceStateStore;
	private readonly tabs: WorkspaceTabController;
	private readonly menus: TabContextMenuController;
	private readonly hover: HoverCardController;
	private readonly spotlightPanel: SpotlightPanelController;
	private readonly workspacePopover: WorkspacePopoverController;
	private readonly onRefresh: () => void;

	constructor(
		win: Window,
		doc: Document,
		prefs: UnifiedPrefService,
		store: WorkspaceStateStore,
		tabs: WorkspaceTabController,
		menus: TabContextMenuController,
		hover: HoverCardController,
		spotlightPanel: SpotlightPanelController,
		workspacePopover: WorkspacePopoverController,
		onRefresh: () => void,
	) {
		this.win = win;
		this.doc = doc;
		this.prefs = prefs;
		this.store = store;
		this.tabs = tabs;
		this.menus = menus;
		this.hover = hover;
		this.spotlightPanel = spotlightPanel;
		this.workspacePopover = workspacePopover;
		this.onRefresh = onRefresh;
	}

	setCitationBadges(badges: ReadonlyMap<number, CitationBadgeInfo>): void {
		this.badges = badges;
		this.render();
	}

	mount(): boolean {
		const host = this.doc?.getElementById?.('tab-bar-container');
		const inner = host?.querySelector('.tab-bar-inner-container');
		if (!host || !inner) return false;

		if (!this.pinnedStrip) {
			const strip = this.h('div', 'zbf-pinned-strip');
			strip.hidden = true;
			this.bindWheel(strip);
			this.pinnedStrip = strip;
		}
		if (!this.groupBar) {
			const bar = this.h('div');
			bar.id = 'zbf-inline';
			this.bindWheel(bar);
			this.groupBar = bar;
		}
		const wrapper = inner.querySelector('.tabs-wrapper');
		if (this.pinnedStrip.parentElement !== inner) inner.insertBefore(this.pinnedStrip, wrapper);
		if (this.groupBar.parentElement !== inner) inner.insertBefore(this.groupBar, wrapper);

		if (!this.toolbarBar) {
			const actions = this.h('div');
			actions.id = 'zbf-toolbar-actions';
			this.toolbarBar = actions;
		}
		const nativeToolbar = this.doc.getElementById('zotero-tabs-toolbar') || inner;
		if (this.toolbarBar.parentElement !== nativeToolbar) {
			nativeToolbar.append(this.toolbarBar);
		}
		return true;
	}

	render(): void {
		const host = this.doc?.getElementById?.('tab-bar-container');
		if (!host || !this.mount()) return;

		const compactTop = this.prefs.get('workspace.enableVerticalSidebar')
			&& !this.prefs.get('workspace.verticalSidebarCollapsed')
			&& this.prefs.get('workspace.compactTopBar');
		const inlineOn = this.prefs.get('workspace.enableHorizontalGroups') && !compactTop;
		host.toggleAttribute('data-zbf-inline', inlineOn);

		if (this.groupBar) this.groupBar.hidden = !inlineOn;
		if (inlineOn) {
			const tracked = this.tabs.buildTrackedTabs(this.win);
			this.renderPinned(tracked);
			this.renderGroupedTabs(tracked);
		} else if (this.pinnedStrip) {
			this.pinnedStrip.hidden = true;
		}
		this.renderToolbarButtons();
	}

	dispose(): void {
		this.pinnedStrip?.remove();
		this.pinnedStrip = null;
		this.groupBar?.remove();
		this.groupBar = null;
		this.toolbarBar?.remove();
		this.toolbarBar = null;
	}

	private renderPinned(tracked: readonly TrackedTab[]): void {
		if (!this.pinnedStrip) return;
		const pinned = this.prefs.get('workspace.enablePinnedTabs')
			? tracked.filter((t) => !t.virtual && t.pinned)
			: [];
		this.pinnedStrip.hidden = pinned.length === 0;
		this.pinnedStrip.textContent = '';
		if (!pinned.length) return;

		const selectedID = String((this.win as any).Zotero_Tabs?.selectedID || '');
		const iconOnly = this.prefs.get('workspace.pinnedIconOnly');
		for (const tab of pinned) {
			const chip = this.h('button', `zbf-pinned-chip${tab.tabID === selectedID ? ' selected' : ''}${iconOnly ? ' icon-only' : ''}`);
			chip.type = 'button';
			chip.title = this.tabs.getDisplayTitle(tab);
			chip.append(createWorkspaceIcon(this.doc, 'pin', 12));
			if (!iconOnly) {
				const span = this.h('span');
				span.textContent = this.tabs.getDisplayTitle(tab);
				chip.append(span);
			}
			chip.addEventListener('click', () => { this.tabs.selectTab(this.win, tab.tabID); this.onRefresh(); });
			chip.addEventListener('contextmenu', (e) => this.menus.openTabMenu(e as MouseEvent, tab));
			this.pinnedStrip.append(chip);
		}
	}

	private renderGroupedTabs(tracked: readonly TrackedTab[]): void {
		if (!this.groupBar || this.groupBar.querySelector('.zbf-inline-edit')) return;
		this.groupBar.textContent = '';
		const selectedID = String((this.win as any).Zotero_Tabs?.selectedID || '');
		const unpinned = tracked.filter((t) => !t.pinned);

		for (const group of this.store.state.groups) {
			const members = unpinned.filter((t) => t.groupId === group.id);
			const collapsed = this.store.state.collapsed.includes(group.id);
			const section = this.h('div', 'zbf-hsection');
			section.setAttribute('data-grouped', 'true');
			section.style.setProperty('--zbf-gcolor', group.color);

			const pill = this.h('button', 'zbf-group-pill');
			pill.type = 'button';
			pill.style.backgroundColor = group.color;
			pill.textContent = `${group.name} (${members.length})`;
			pill.addEventListener('click', () => { this.store.setCollapsed(group.id, !collapsed); this.onRefresh(); });
			pill.addEventListener('dblclick', (e) => {
				e.stopPropagation();
				this.beginInlineEdit(pill, group.name, (val) => this.store.renameGroup(group.id, val));
			});
			pill.addEventListener('contextmenu', (e) => this.menus.openGroupMenu(e as MouseEvent, group));
			pill.addEventListener('dragover', (e) => { if (this.draggedKey) e.preventDefault(); });
			pill.addEventListener('drop', (e) => {
				e.preventDefault();
				if (this.draggedKey) { this.store.assignToGroup(this.draggedKey, group.id); this.draggedKey = null; this.onRefresh(); }
			});
			section.append(pill);

			if (!collapsed) {
				for (const tab of members) section.append(this.buildTabChip(tab, selectedID, group.name));
			}
			this.groupBar.append(section);
		}

		const ungrouped = unpinned.filter((t) => !t.groupId);
		if (ungrouped.length) {
			const loose = this.h('div', 'zbf-hsection');
			for (const tab of ungrouped) loose.append(this.buildTabChip(tab, selectedID, ''));
			this.groupBar.append(loose);
		}

		const addBtn = this.h('button', 'zbf-add-group');
		addBtn.type = 'button';
		addBtn.title = 'New Tab Group';
		addBtn.append(createWorkspaceIcon(this.doc, 'plus', 13));
		addBtn.addEventListener('click', () => {
			this.beginInlineEdit(addBtn, '', (val) => { this.store.createGroup(val); }, 'Group name...');
		});
		this.groupBar.append(addBtn);
	}

	private buildTabChip(tab: TrackedTab, selectedID: string, groupName: string): HTMLElement {
		const cls = [
			'zbf-htab',
			tab.tabID && tab.tabID === selectedID ? 'selected' : '',
			tab.sleeping ? 'sleeping' : '',
			tab.virtual ? 'virtual' : '',
		].filter(Boolean).join(' ');
		const chip = this.h('div', cls);
		chip.draggable = true;
		chip.addEventListener('dragstart', () => { this.draggedKey = tab.key; });
		chip.addEventListener('dragend', () => { this.draggedKey = null; });

		const title = this.h('span', 'zbf-htab-title');
		const badge = this.badges.get(tab.parentItemID) || this.badges.get(tab.itemID);
		const prefix = tab.virtual ? '◌ ' : badge && this.prefs.get('fusion.sidebarCiteBadge') ? `[${badge.ordinal}] ` : '';
		title.textContent = `${prefix}${this.tabs.getDisplayTitle(tab)}`;
		chip.append(title);

		if (tab.tabID) {
			const closeBtn = this.h('button', 'zbf-htab-close');
			closeBtn.type = 'button';
			closeBtn.append(createWorkspaceIcon(this.doc, 'close', 11));
			closeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				void this.tabs.closeTabs(this.win, [tab.tabID], { protectPinned: true }).then(() => this.onRefresh());
			});
			chip.append(closeBtn);
		}

		chip.addEventListener('click', () => {
			if (tab.tabID) this.tabs.selectTab(this.win, tab.tabID);
			else void this.tabs.focusOrOpenItem(this.win, { itemID: tab.parentItemID, attachmentID: tab.itemID });
			this.onRefresh();
		});
		chip.addEventListener('auxclick', (e) => {
			if ((e as MouseEvent).button === 1 && tab.tabID) {
				e.preventDefault();
				void this.tabs.closeTabs(this.win, [tab.tabID], { protectPinned: true }).then(() => this.onRefresh());
			}
		});
		chip.addEventListener('contextmenu', (e) => this.menus.openTabMenu(e as MouseEvent, tab));
		if (this.prefs.get('workspace.enableHoverPreview')) {
			chip.addEventListener('mouseenter', () => this.hover.scheduleShow(chip, tab, groupName, badge));
			chip.addEventListener('mouseleave', () => this.hover.hide());
		}
		return chip;
	}

	private renderToolbarButtons(): void {
		if (!this.toolbarBar) return;
		this.toolbarBar.textContent = '';

		if (this.prefs.get('workspace.enableVerticalSidebar')) {
			const collapsed = this.prefs.get('workspace.verticalSidebarCollapsed');
			this.toolbarBar.append(this.mkBtn('sidebar', '侧栏', 'Toggle vertical sidebar', !collapsed, () => {
				this.prefs.set('workspace.verticalSidebarCollapsed', !collapsed);
				this.onRefresh();
			}));
		}

		this.toolbarBar.append(this.mkBtn('folder', '归组', 'Auto-group tabs by Zotero collection', false, () => {
			this.tabs.autoGroupByCollection(this.win);
			this.onRefresh();
		}));

		if (this.prefs.get('workspace.enableSessions')) {
			const wsBtn = this.mkBtn('archive', '工作区', 'Workspaces & Snapshots', false, () => {
				this.workspacePopover.toggle(wsBtn);
			});
			this.toolbarBar.append(wsBtn);
		}

		if (this.prefs.get('workspace.enableSpotlight')) {
			const spotBtn = this.mkBtn('search', 'Spotlight', 'Spotlight Search (Ctrl+P)', false, () => {
				this.spotlightPanel.toggle(spotBtn);
			});
			this.toolbarBar.append(spotBtn);
		}

		if (this.prefs.get('workspace.enableTabSleep')) {
			this.toolbarBar.append(this.mkBtn('sleep', '休眠', 'Sleep inactive tabs', false, () => {
				const selectedID = String((this.win as any).Zotero_Tabs?.selectedID || '');
				for (const tab of this.tabs.buildTrackedTabs(this.win)) {
					if (tab.tabID && tab.tabID !== selectedID && !tab.pinned && !tab.sleeping && !tab.virtual) {
						this.tabs.sleepTab(this.win, tab.tabID);
					}
				}
				this.onRefresh();
			}));
		}
	}

	private beginInlineEdit(anchor: HTMLElement, initial: string, onCommit: (val: string) => void, placeholder = ''): void {
		const input = this.h('input', 'zbf-inline-edit');
		input.type = 'text';
		input.value = initial;
		if (placeholder) input.placeholder = placeholder;
		let done = false;
		const finish = (save: boolean) => {
			if (done) return;
			done = true;
			input.replaceWith(anchor);
			if (save && input.value.trim()) onCommit(input.value.trim());
			this.onRefresh();
		};
		input.addEventListener('keydown', (e) => {
			const ke = e as KeyboardEvent;
			e.stopPropagation();
			if (ke.key === 'Enter') { e.preventDefault(); finish(true); }
			else if (ke.key === 'Escape') { e.preventDefault(); finish(false); }
		});
		input.addEventListener('blur', () => finish(true));
		anchor.replaceWith(input);
		input.focus();
		input.select();
	}

	private bindWheel(area: HTMLElement): void {
		area.addEventListener('wheel', (e: WheelEvent) => {
			if (e.ctrlKey || area.scrollWidth <= area.clientWidth) return;
			e.preventDefault();
			area.scrollLeft += e.deltaX || e.deltaY;
		}, { passive: false });
	}

	private mkBtn(
		icon: Parameters<typeof createWorkspaceIcon>[1],
		label: string,
		title: string,
		pressed: boolean,
		onClick: () => void,
	): HTMLButtonElement {
		const btn = this.h('button', 'zbf-tb-btn');
		btn.type = 'button';
		btn.title = title;
		btn.setAttribute('aria-pressed', String(pressed));
		const span = this.h('span');
		span.textContent = label;
		btn.append(createWorkspaceIcon(this.doc, icon, 14), span);
		btn.addEventListener('click', onClick);
		return btn;
	}

	private h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
		const el = this.doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K];
		if (className) el.className = className;
		return el;
	}
}
