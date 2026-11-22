import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import type { CitationBadgeInfo } from '../../kernel/types.ts';
import type { HoverCardController } from './hover-card.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import type { TabContextMenuController } from './tab-context-menu.ts';
import type { WorkspaceTabController } from './tab-controller.ts';
import type { TrackedTab } from './types.ts';
import { createWorkspaceIcon } from './workspace-icons.ts';

type ViewMode = 'groups' | 'collection' | 'status';

export class VerticalSidebarController {
	private sidebar: HTMLElement | null = null;
	private listEl: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
	private searchInput: HTMLInputElement | null = null;
	private viewMode: ViewMode = 'groups';
	private badges: ReadonlyMap<number, CitationBadgeInfo> = new Map();
	private draggedKey: string | null = null;

	private readonly win: Window;
	private readonly doc: Document;
	private readonly prefs: UnifiedPrefService;
	private readonly store: WorkspaceStateStore;
	private readonly tabs: WorkspaceTabController;
	private readonly menus: TabContextMenuController;
	private readonly hover: HoverCardController;
	private readonly onRefresh: () => void;

	constructor(
		win: Window,
		doc: Document,
		prefs: UnifiedPrefService,
		store: WorkspaceStateStore,
		tabs: WorkspaceTabController,
		menus: TabContextMenuController,
		hover: HoverCardController,
		onRefresh: () => void,
	) {
		this.win = win;
		this.doc = doc;
		this.prefs = prefs;
		this.store = store;
		this.tabs = tabs;
		this.menus = menus;
		this.hover = hover;
		this.onRefresh = onRefresh;
	}

	setCitationBadges(badges: ReadonlyMap<number, CitationBadgeInfo>): void {
		this.badges = badges;
		this.render();
	}

	mount(): boolean {
		if (this.sidebar?.isConnected) return true;
		const deck: Element | undefined = (this.win as any).Zotero_Tabs?.deck;
		const deckParent = deck?.parentElement;
		if (!deck || !deckParent) return false;

		const aside = (this.doc as any).createXULElement
			? (this.doc as any).createXULElement('vbox')
			: this.doc.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', 'vbox');
		aside.id = 'zbf-sidebar';

		const header = this.h('div', 'zbf-sb-header');
		const title = this.h('span', 'zbf-sb-title');
		title.append(createWorkspaceIcon(this.doc, 'bridge', 14), this.doc.createTextNode('BridgeFlow'));

		const actions = this.h('div', 'zbf-sb-actions');
		actions.append(
			this.mkIconBtn('plus', 'New Group', () => this.promptNewGroup()),
			this.mkIconBtn('folder', 'Auto-Group by Collection', () => { this.tabs.autoGroupByCollection(this.win); this.onRefresh(); }),
			this.mkIconBtn('sleep', 'Sleep Inactive Tabs', () => this.sleepInactiveTabs()),
			this.mkIconBtn('sidebar', 'Collapse Sidebar', () => {
				this.prefs.set('workspace.verticalSidebarCollapsed', !this.prefs.get('workspace.verticalSidebarCollapsed'));
				this.onRefresh();
			}),
		);
		header.append(title, actions);

		const searchWrap = this.h('div', 'zbf-sb-search-wrap');
		const search = this.h('input', 'zbf-sb-search');
		search.type = 'search';
		search.placeholder = 'Filter tabs, remarks, collections...';
		search.addEventListener('input', () => this.renderList());
		searchWrap.append(search);

		const views = this.h('div', 'zbf-sb-views');
		for (const [mode, label] of [['groups', '分组'], ['collection', '集合'], ['status', '状态']] as const) {
			const btn = this.h('button', `zbf-sb-view-btn${this.viewMode === mode ? ' active' : ''}`);
			btn.type = 'button';
			btn.textContent = label;
			btn.addEventListener('click', () => {
				this.viewMode = mode;
				Array.from(views.children).forEach((el, idx) => {
					el.classList.toggle('active', (['groups', 'collection', 'status'] as const)[idx] === mode);
				});
				this.renderList();
			});
			views.append(btn);
		}

		const list = this.h('div', 'zbf-sb-list');
		const status = this.h('div', 'zbf-sb-status');
		const splitter = this.h('div', 'zbf-sb-splitter');
		this.bindSplitter(splitter, aside);

		aside.append(header, searchWrap, views, list, status, splitter);
		deckParent.insertBefore(aside, deck);

		this.sidebar = aside;
		this.listEl = list;
		this.statusEl = status;
		this.searchInput = search;
		return true;
	}

	render(): void {
		if (!this.prefs.get('workspace.enableVerticalSidebar')) {
			this.dispose();
			return;
		}
		if (!this.mount() || !this.sidebar) return;
		const collapsed = this.prefs.get('workspace.verticalSidebarCollapsed');
		this.sidebar.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
		this.sidebar.style.width = `${this.prefs.get('workspace.verticalSidebarWidth')}px`;
		if (!collapsed) this.renderList();
	}

	renderList(): void {
		if (!this.listEl || !this.statusEl) return;
		const tracked = this.tabs.buildTrackedTabs(this.win);
		const filter = (this.searchInput?.value || '').trim().toLowerCase();
		const visible = filter
			? tracked.filter((t) => `${t.title} ${t.remark} ${t.source} ${t.collection}`.toLowerCase().includes(filter))
			: tracked;

		this.listEl.textContent = '';
		if (this.viewMode === 'groups') this.renderByGroups(visible);
		else if (this.viewMode === 'collection') this.renderByKey(visible, (t) => t.collection || 'Uncategorized');
		else this.renderByStatus(visible);

		const activeCount = tracked.filter((t) => !t.sleeping && !t.virtual).length;
		const sleepCount = tracked.filter((t) => t.sleeping).length;
		const virtualCount = tracked.filter((t) => t.virtual).length;
		this.statusEl.textContent = `Active ${activeCount} · Sleep ${sleepCount} · Virtual ${virtualCount}`;
	}

	dispose(): void {
		this.sidebar?.remove();
		this.sidebar = null;
		this.listEl = null;
		this.statusEl = null;
		this.searchInput = null;
	}

	private renderByGroups(tabs: readonly TrackedTab[]): void {
		if (!this.listEl) return;
		const pinned = this.prefs.get('workspace.enablePinnedTabs') ? tabs.filter((t) => t.pinned) : [];
		if (pinned.length) {
			const pHead = this.h('div', 'zbf-sb-group-head');
			pHead.textContent = `📌 Pinned (${pinned.length})`;
			this.listEl.append(pHead);
			for (const tab of pinned) this.listEl.append(this.buildRow(tab, 'Pinned'));
		}

		for (const group of this.store.state.groups) {
			const members = tabs.filter((t) => !t.pinned && t.groupId === group.id);
			const collapsed = this.store.state.collapsed.includes(group.id);
			const head = this.h('div', 'zbf-sb-group-head');
			const left = this.h('span');
			left.style.cssText = 'display:inline-flex;align-items:center;gap:6px;';
			const dot = this.h('span', 'zbf-sb-group-dot');
			dot.style.backgroundColor = group.color;
			left.append(dot, this.doc.createTextNode(`${group.name} (${members.length})`));
			head.append(left);
			head.addEventListener('click', () => { this.store.setCollapsed(group.id, !collapsed); this.renderList(); });
			head.addEventListener('contextmenu', (e) => this.menus.openGroupMenu(e as MouseEvent, group));
			head.addEventListener('dragover', (e) => { if (this.draggedKey) e.preventDefault(); });
			head.addEventListener('drop', (e) => {
				e.preventDefault();
				if (this.draggedKey) { this.store.assignToGroup(this.draggedKey, group.id); this.draggedKey = null; this.onRefresh(); }
			});
			this.listEl.append(head);
			if (!collapsed) {
				for (const tab of members) this.listEl.append(this.buildRow(tab, group.name));
			}
		}
		for (const tab of tabs.filter((t) => !t.pinned && !t.groupId)) {
			this.listEl.append(this.buildRow(tab, ''));
		}
	}

	private renderByKey(tabs: readonly TrackedTab[], keyFn: (t: TrackedTab) => string): void {
		if (!this.listEl) return;
		const buckets = new Map<string, TrackedTab[]>();
		for (const t of tabs) {
			const k = keyFn(t);
			const arr = buckets.get(k) || [];
			arr.push(t);
			buckets.set(k, arr);
		}
		for (const [label, list] of buckets.entries()) {
			const head = this.h('div', 'zbf-sb-group-head');
			head.textContent = `${label} (${list.length})`;
			this.listEl.append(head);
			for (const t of list) this.listEl.append(this.buildRow(t, label));
		}
	}

	private renderByStatus(tabs: readonly TrackedTab[]): void {
		this.renderByKey(tabs, (t) => {
			if (this.badges.has(t.parentItemID) || this.badges.has(t.itemID)) return 'Cited in Word';
			if (t.pinned) return 'Pinned';
			if (t.sleeping) return 'Sleeping';
			if (t.virtual) return 'Virtual';
			return 'Active';
		});
	}

	private buildRow(tab: TrackedTab, groupName: string): HTMLElement {
		const selectedID = String((this.win as any).Zotero_Tabs?.selectedID || '');
		const cls = ['zbf-vtab-row', tab.tabID === selectedID ? 'selected' : '', tab.sleeping ? 'sleeping' : '', tab.virtual ? 'virtual' : ''].filter(Boolean).join(' ');
		const row = this.h('div', cls);
		row.draggable = true;
		row.addEventListener('dragstart', () => { this.draggedKey = tab.key; });
		row.addEventListener('dragend', () => { this.draggedKey = null; });
		row.style.minHeight = `${this.prefs.get('workspace.verticalTabRowHeight')}px`;
		row.style.fontSize = `${this.prefs.get('workspace.verticalTabFontSize')}px`;

		const main = this.h('div', 'zbf-vtab-main');
		const title = this.h('span', 'zbf-vtab-title');
		title.textContent = `${tab.virtual ? '◌ ' : ''}${this.tabs.getDisplayTitle(tab)}`;
		main.append(title);

		const subMode = this.prefs.get('workspace.verticalTabSubtitleMode');
		const subText = subMode === 'none' ? '' : subMode === 'creatorYear' ? tab.creatorYear : subMode === 'collection' ? tab.collection : (tab.source || tab.creatorYear);
		if (subText) {
			const sub = this.h('span', 'zbf-vtab-sub');
			sub.textContent = subText;
			main.append(sub);
		}
		row.append(main);

		const right = this.h('div', 'zbf-vtab-right');
		const badgeInfo = this.badges.get(tab.parentItemID) || this.badges.get(tab.itemID);
		if (badgeInfo && this.prefs.get('fusion.sidebarCiteBadge')) {
			const badge = this.h('span', 'zbf-cite-badge');
			badge.textContent = `[${badgeInfo.ordinal}]`;
			badge.title = `${badgeInfo.documentName}: ${badgeInfo.shortText}`;
			right.append(badge);
		}

		if (tab.itemID > 0 && this.prefs.get('workspace.enableShowInFilesystem')) {
			const folderBtn = this.mkIconBtn('folder', 'Reveal PDF Folder', () => {
				(this.win as any).ZoteroPane?.showAttachmentInFilesystem?.(tab.itemID);
			}, 'zbf-row-btn');
			folderBtn.addEventListener('click', (e) => e.stopPropagation());
			right.append(folderBtn);
		}

		if (tab.tabID) {
			const closeBtn = this.mkIconBtn('close', 'Close tab', () => {
				void this.tabs.closeTabs(this.win, [tab.tabID], { protectPinned: true }).then(() => this.onRefresh());
			}, 'zbf-row-btn');
			closeBtn.addEventListener('click', (e) => e.stopPropagation());
			right.append(closeBtn);
		}
		row.append(right);

		row.addEventListener('click', () => {
			if (tab.tabID) this.tabs.selectTab(this.win, tab.tabID);
			else void this.tabs.focusOrOpenItem(this.win, { itemID: tab.parentItemID, attachmentID: tab.itemID });
			this.onRefresh();
		});
		row.addEventListener('contextmenu', (e) => this.menus.openTabMenu(e as MouseEvent, tab));
		if (this.prefs.get('workspace.enableHoverPreview')) {
			row.addEventListener('mouseenter', () => this.hover.scheduleShow(row, tab, groupName, badgeInfo));
			row.addEventListener('mouseleave', () => this.hover.hide());
		}
		return row;
	}

	private bindSplitter(splitter: HTMLElement, aside: HTMLElement): void {
		splitter.addEventListener('mousedown', (ev: MouseEvent) => {
			ev.preventDefault();
			const startX = ev.clientX;
			const startW = aside.getBoundingClientRect().width || this.prefs.get('workspace.verticalSidebarWidth');
			const onMove = (m: MouseEvent) => {
				const next = Math.max(200, Math.min(440, Math.round(startW + (m.clientX - startX))));
				aside.style.width = `${next}px`;
			};
			const onUp = () => {
				this.win.removeEventListener('mousemove', onMove);
				this.win.removeEventListener('mouseup', onUp);
				const finalW = Math.round(aside.getBoundingClientRect().width || startW);
				this.prefs.set('workspace.verticalSidebarWidth', finalW);
			};
			this.win.addEventListener('mousemove', onMove);
			this.win.addEventListener('mouseup', onUp);
		});
	}

	private promptNewGroup(): void {
		const promptSvc = (globalThis as any).Services?.prompt;
		if (promptSvc?.prompt) {
			const input = { value: '' };
			if (!promptSvc.prompt(this.win, 'New Tab Group', 'Group name:', input, null, {})) return;
			if (input.value.trim()) this.store.createGroup(input.value);
		} else {
			this.store.createGroup(`Group ${this.store.state.groups.length + 1}`);
		}
		this.onRefresh();
	}

	private sleepInactiveTabs(): void {
		const selectedID = String((this.win as any).Zotero_Tabs?.selectedID || '');
		for (const tab of this.tabs.buildTrackedTabs(this.win)) {
			if (tab.tabID && tab.tabID !== selectedID && !tab.pinned && !tab.sleeping && !tab.virtual) {
				this.tabs.sleepTab(this.win, tab.tabID);
			}
		}
		this.onRefresh();
	}

	private mkIconBtn(icon: Parameters<typeof createWorkspaceIcon>[1], title: string, onClick: () => void, cls = 'zbf-sb-icon-btn'): HTMLButtonElement {
		const btn = this.h('button', cls);
		btn.type = 'button';
		btn.title = title;
		btn.append(createWorkspaceIcon(this.doc, icon, 14));
		btn.addEventListener('click', onClick);
		return btn;
	}

	private h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
		const el = this.doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K];
		if (className) el.className = className;
		return el;
	}
}
