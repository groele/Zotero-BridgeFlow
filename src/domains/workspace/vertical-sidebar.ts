import { createWorkspaceElement } from './workspace-elements.ts';
import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import type { CitationBadgeInfo } from '../../kernel/types.ts';
import type { WorkspaceHoverCard } from './hover-card.ts';
import { openTextPromptModal } from './popup-menu-helpers.ts';
import { bindSidebarKeyboardNavigation } from './sidebar-keyboard.ts';
import {
	bindSidebarGroupDrop,
	bindSidebarSplitter,
	buildSidebarTabRow,
} from './sidebar-list-helpers.ts';
import {
	appendSidebarSectionHead,
	renderSidebarCollectionsList,
	renderSidebarEmptyBox,
	renderSidebarStatusBar,
} from './sidebar-sections-helpers.ts';
import { SidebarSelection } from './sidebar-selection.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import type { WorkspaceTabContextMenu } from './tab-context-menu.ts';
import type { WorkspaceTabController } from './tab-controller.ts';
import type { TrackedTab } from './types.ts';
import { createWorkspaceIcon } from './workspace-icons.ts';
import type { WorkspacePopover } from './workspace-popover.ts';

type SidebarViewMode = 'groups' | 'collections' | 'status';

export class WorkspaceVerticalSidebar {
	private readonly win: Window;
	private readonly doc: Document;
	private readonly prefs: UnifiedPrefService;
	private readonly store: WorkspaceStateStore;
	private readonly tabs: WorkspaceTabController;
	private readonly menus: WorkspaceTabContextMenu;
	private readonly hover: WorkspaceHoverCard;
	private readonly popover: WorkspacePopover;
	private readonly onToggleSpotlight: (anchor?: HTMLElement) => void;
	private readonly onRefresh: () => void;

	private asideEl: HTMLElement | null = null;
	private listEl: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
	private viewButtons = new Map<SidebarViewMode, HTMLButtonElement>();
	private selection: SidebarSelection | null = null;

	private viewMode: SidebarViewMode = 'groups';
	private searchTerm = '';
	private lastRenderKey = '';
	private wordCiteMap = new Map<number, CitationBadgeInfo>();

	constructor(
		win: Window,
		prefs: UnifiedPrefService,
		store: WorkspaceStateStore,
		tabs: WorkspaceTabController,
		menus: WorkspaceTabContextMenu,
		hover: WorkspaceHoverCard,
		popover: WorkspacePopover,
		onToggleSpotlight: (anchor?: HTMLElement) => void,
		onRefresh: () => void,
	) {
		this.win = win;
		this.doc = win.document;
		this.prefs = prefs;
		this.store = store;
		this.tabs = tabs;
		this.menus = menus;
		this.hover = hover;
		this.popover = popover;
		this.onToggleSpotlight = onToggleSpotlight;
		this.onRefresh = onRefresh;
	}

	setWordCitationBadges(badges: ReadonlyMap<number, CitationBadgeInfo>): void {
		this.wordCiteMap = new Map(badges);
	}

	render(snapshot?: TrackedTab[]): void {
		const mainDeck: Element | null = (this.win as any).Zotero_Tabs?.deck || this.doc.getElementById('zotero-main-window-deck')
			|| this.doc.querySelector('#main-deck, #zotero-pane-stack')?.parentElement
			|| this.doc.getElementById('zotero-pane')?.parentElement;
		if (!mainDeck) return;

		if (!this.asideEl || !this.asideEl.isConnected) {
			this.doc.getElementById('zbf-sidebar')?.remove();
			this.buildShell(mainDeck);
		}
		if (!this.asideEl) return;

		const enabled = this.prefs.get('workspace.enableVerticalSidebar') && !this.prefs.get('workspace.verticalSidebarCollapsed');
		this.asideEl.toggleAttribute('hidden', !enabled);
		this.asideEl.setAttribute('data-collapsed', enabled ? 'false' : 'true');
		if (!enabled) return;

		const savedW = this.prefs.get('workspace.verticalSidebarWidth');
		if (savedW >= 200 && savedW <= 440) this.asideEl.style.width = `${savedW}px`;
		const fontSize = this.prefs.get('workspace.verticalTabFontSize');
		if (fontSize >= 11 && fontSize <= 18) this.asideEl.style.fontSize = `${fontSize}px`;

		for (const [mode, btn] of this.viewButtons) {
			btn.classList.toggle('active', mode === this.viewMode);
		}
		this.renderList(snapshot);
	}

	destroy(): void {
		this.asideEl?.remove();
		this.asideEl = null;
		this.listEl = null;
		this.statusEl = null;
		this.selection = null;
		this.viewButtons.clear();
	}

	private buildShell(mainDeck: Element): void {
		const aside = createWorkspaceElement(this.doc, 'aside');
		aside.id = 'zbf-sidebar';

		const header = createWorkspaceElement(this.doc, 'div');
		header.className = 'zbf-sb-header';
		const title = createWorkspaceElement(this.doc, 'div');
		title.className = 'zbf-sb-title';
		title.appendChild(createWorkspaceIcon(this.doc, 'layers', 13));
		const titleText = createWorkspaceElement(this.doc, 'span');
		titleText.textContent = 'BridgeFlow';
		title.appendChild(titleText);

		const actions = createWorkspaceElement(this.doc, 'div');
		actions.className = 'zbf-sb-actions';
		header.append(title, actions);
		aside.appendChild(header);

		const searchWrap = createWorkspaceElement(this.doc, 'div');
		searchWrap.className = 'zbf-sb-search-wrap';
		const searchInput = createWorkspaceElement(this.doc, 'input') as HTMLInputElement;
		searchInput.type = 'search';
		searchInput.className = 'zbf-sb-search';
		searchInput.placeholder = '筛选标题、作者、备注、分组...';
		searchInput.value = this.searchTerm;
		searchInput.addEventListener('input', () => {
			this.searchTerm = searchInput.value;
			this.renderList();
		});
		searchWrap.appendChild(searchInput);
		aside.appendChild(searchWrap);

		const views = createWorkspaceElement(this.doc, 'div');
		views.className = 'zbf-sb-views';
		for (const [mode, label] of [['groups', '分组'], ['collections', '集合'], ['status', '状态']] as const) {
			const vBtn = createWorkspaceElement(this.doc, 'button');
			vBtn.type = 'button';
			vBtn.className = 'zbf-sb-view-btn';
			vBtn.setAttribute('data-view-mode', mode);
			vBtn.textContent = label;
			vBtn.addEventListener('click', () => {
				this.viewMode = mode;
				this.render();
			});
			this.viewButtons.set(mode, vBtn);
			views.appendChild(vBtn);
		}
		aside.appendChild(views);

		const list = createWorkspaceElement(this.doc, 'div');
		list.className = 'zbf-sb-list';
		aside.appendChild(list);

		const status = createWorkspaceElement(this.doc, 'div');
		status.className = 'zbf-sb-status';
		aside.appendChild(status);

		const splitter = createWorkspaceElement(this.doc, 'div');
		splitter.className = 'zbf-sb-splitter';
		bindSidebarSplitter(this.doc, aside, splitter, this.prefs);
		aside.appendChild(splitter);

		this.selection = new SidebarSelection(
			this.doc, this.prefs, this.store, actions, aside, list,
			() => this.onRefresh(),
			(ids) => void this.tabs.closeTabs(this.win, ids, { preserveVirtual: true }),
			(itemIDs) => void this.tabs.copyItemsCitations(itemIDs),
			(itemIDs) => { this.tabs.citeItemsInWord(this.win, itemIDs); },
		);
		bindSidebarKeyboardNavigation(aside, list, searchInput, () => {
			this.searchTerm = '';
			searchInput.value = '';
			this.renderList();
		});

		this.addHeaderBtn(actions, 'plus', '新建分组', () => {
			openTextPromptModal(this.win, '新建分组', '输入分组名称...', '新分组', (val) => {
				if (!val.trim()) return;
				this.store.createGroup(val);
				this.onRefresh();
			});
		});
		this.addHeaderBtn(actions, 'sidebar', '折叠 / 展开侧边栏', () => {
			this.prefs.set('workspace.verticalSidebarCollapsed', true);
			this.onRefresh();
		});

		mainDeck.parentElement?.insertBefore(aside, mainDeck);
		this.asideEl = aside;
		this.listEl = list;
		this.statusEl = status;
	}

	private renderList(snapshot?: TrackedTab[]): void {
		if (!this.listEl || !this.selection) return;
		const needle = this.searchTerm.trim().toLowerCase();
		const allTracked = snapshot ?? this.tabs.buildTrackedTabs(this.win);
		const selectedID = String((this.win as any).Zotero_Tabs?.selectedID || '');
		const badgeKey = [...this.wordCiteMap.entries()].map(([id, b]) => `${id}:${b.ordinal}`).join(',');
		const groupKey = this.store.state.groups.map((g) => `${g.id}:${g.name}:${g.color}:${g.memberKeys.length}`).join(',');
		const tabKey = allTracked.map((t) => `${t.key}:${t.tabID}:${t.groupId}:${t.pinned ? 1 : 0}:${t.sleeping ? 1 : 0}:${t.virtual ? 1 : 0}:${t.remark}:${t.title}`).join('|');
		const renderKey = `${this.viewMode}|${needle}|${selectedID}|${this.store.state.collapsed.join(',')}|${this.prefs.get('workspace.verticalTabRowHeight')}|${this.prefs.get('workspace.verticalTabTitleMode')}|${this.prefs.get('workspace.verticalTabSubtitleMode')}|${this.prefs.get('workspace.enableBatchSelection')}|${groupKey}|${badgeKey}|${tabKey}`;
		if (renderKey === this.lastRenderKey && this.listEl.children.length > 0) return;
		this.lastRenderKey = renderKey;
		const prevScroll = this.listEl.scrollTop;
		this.listEl.textContent = '';

		const filtered = needle
			? allTracked.filter((t) => `${t.title} ${t.shortTitle} ${t.creatorYear} ${t.collection} ${t.remark}`.toLowerCase().includes(needle))
			: allTracked;

		this.selection.beginRender(filtered);
		const rowDeps = {
			win: this.win, doc: this.doc, prefs: this.prefs, store: this.store, tabs: this.tabs, menus: this.menus,
			hover: this.hover, selection: this.selection, wordCiteMap: this.wordCiteMap, selectedID, onRefresh: this.onRefresh,
		};

		if (!filtered.length && !(this.viewMode === 'groups' && !this.searchTerm && this.store.state.groups.length)) {
			this.renderEmptyState(allTracked.length > 0);
		} else if (this.viewMode === 'groups') {
			const pinned = filtered.filter((t) => !t.virtual && t.pinned);
			if (pinned.length) this.appendSimpleSection('已固定标签', '#f59e0b', pinned, rowDeps);

			for (const grp of this.store.state.groups) {
				const members = filtered.filter((t) => (t.virtual || !t.pinned) && t.groupId === grp.id);
				const collapsed = this.store.state.collapsed.includes(grp.id);
				const head = createWorkspaceElement(this.doc, 'button');
				head.type = 'button';
				head.className = 'zbf-sb-group-head';
				head.tabIndex = 0;
				head.setAttribute('data-zbf-nav', 'head');
				const dot = createWorkspaceElement(this.doc, 'span');
				dot.className = 'zbf-sb-group-dot';
				dot.style.background = grp.color;
				const label = createWorkspaceElement(this.doc, 'span');
				label.textContent = `${collapsed ? '▸' : '▾'} ${grp.name} (${members.length})`;
				head.append(dot, label);
				head.addEventListener('click', () => {
					this.store.setCollapsed(grp.id, !collapsed);
					this.renderList();
				});
				head.addEventListener('dblclick', (e) => {
					e.stopPropagation();
					openTextPromptModal(this.win, '重命名分组', '输入新的分组名称...', grp.name, (val) => {
						if (this.store.renameGroup(grp.id, val)) this.onRefresh();
					});
				});
				head.addEventListener('contextmenu', (e) => {
					e.preventDefault();
					this.menus.openGroupMenu(head, grp, e as MouseEvent);
				});
				bindSidebarGroupDrop(head, grp.id, this.win, this.store, this.tabs, this.onRefresh);
				this.listEl.appendChild(head);
				if (!collapsed) {
					for (const tab of members) this.listEl.appendChild(buildSidebarTabRow(rowDeps, tab));
				}
			}

			const ungrouped = filtered.filter((t) => !t.pinned && !t.groupId);
			if (ungrouped.length) this.appendSimpleSection('未分组', '#64748b', ungrouped, rowDeps);
		} else if (this.viewMode === 'collections') {
			renderSidebarCollectionsList(this.listEl, rowDeps, filtered);
		} else {
			this.renderStatusView(filtered, rowDeps);
		}

		this.renderFooter(allTracked);
		this.selection.updateControls();
		if (prevScroll > 0) this.listEl.scrollTop = prevScroll;
	}

	private renderStatusView(filtered: readonly TrackedTab[], rowDeps: any): void {
		const cited = filtered.filter((t) => this.wordCiteMap.has(t.parentItemID) || this.wordCiteMap.has(t.itemID));
		const pinned = filtered.filter((t) => !t.virtual && t.pinned);
		const active = filtered.filter((t) => !t.virtual && !t.sleeping && !t.pinned);
		const sleeping = filtered.filter((t) => !t.virtual && t.sleeping);
		const virtual = filtered.filter((t) => t.virtual);
		if (cited.length) this.appendSimpleSection('Word 正在引用', '#0D9488', cited, rowDeps);
		if (pinned.length) this.appendSimpleSection('已固定', '#f59e0b', pinned, rowDeps);
		if (active.length) this.appendSimpleSection('当前活动', '#245ac7', active, rowDeps);
		if (sleeping.length) this.appendSimpleSection('已休眠', '#8b5cf6', sleeping, rowDeps);
		if (virtual.length) this.appendSimpleSection('虚拟保留', '#64748b', virtual, rowDeps);
	}

	private appendSimpleSection(title: string, color: string, tabsList: TrackedTab[], rowDeps: any): void {
		if (!this.listEl) return;
		appendSidebarSectionHead(this.doc, this.listEl, `${title} (${tabsList.length})`, color);
		for (const tab of tabsList) this.listEl.appendChild(buildSidebarTabRow(rowDeps, tab));
	}

	private renderEmptyState(hasAnyTabs: boolean): void {
		if (!this.listEl) return;
		this.listEl.appendChild(renderSidebarEmptyBox(
			this.doc,
			this.win,
			hasAnyTabs,
			() => {
				this.searchTerm = '';
				const inp = this.asideEl?.querySelector('.zbf-sb-search') as HTMLInputElement | null;
				if (inp) inp.value = '';
				this.renderList();
			},
			() => {
				const latest = this.store.state.sessions[0] || this.store.state.rollingSessions[0];
				if (latest && this.prefs.get('workspace.enableSessions')) {
					void this.tabs.restoreSession(this.win, latest, true).then(() => this.onRefresh());
				} else {
					this.popover.openHub();
				}
			},
		));
	}

	private renderFooter(allTracked: readonly TrackedTab[]): void {
		if (this.statusEl) {
			renderSidebarStatusBar(this.doc, this.win, this.statusEl, this.prefs, this.tabs, allTracked, this.onRefresh);
		}
	}

	private addHeaderBtn(
		container: HTMLElement,
		icon: Parameters<typeof createWorkspaceIcon>[1],
		title: string,
		onClick: (btn: HTMLButtonElement) => void,
	): void {
		const btn = createWorkspaceElement(this.doc, 'button');
		btn.type = 'button';
		btn.className = 'zbf-sb-icon-btn';
		btn.title = title;
		btn.setAttribute('tooltiptext', title);
		btn.setAttribute('aria-label', title);
		btn.setAttribute('data-action', icon);
		btn.appendChild(createWorkspaceIcon(this.doc, icon, 13));
		btn.addEventListener('click', () => onClick(btn));
		container.appendChild(btn);
	}
}
