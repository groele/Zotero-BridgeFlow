import { createWorkspaceElement } from '../workspace-elements.ts';
import type { UnifiedPrefService } from '../../../kernel/pref-service.ts';
import { HorizontalPinnedStrip } from './pinned-strip.ts';
import { openTextPromptModal } from '../tabs/popup-menu-helpers.ts';
import type { WorkspaceStateStore } from '../store/state-store.ts';
import type { WorkspaceHoverCard } from '../sidebar/hover-card.ts';
import type { WorkspaceTabContextMenu } from '../tabs/tab-context-menu.ts';
import type { WorkspaceTabController } from '../tabs/tab-controller.ts';
import type { TabGroup, TrackedTab } from '../types.ts';
import { createWorkspaceIcon } from '../workspace-icons.ts';
import type { WorkspaceToolbarActions } from './horizontal-toolbar.ts';
import {
	bindHorizontalDropToGroup,
	bindHorizontalDropToNewGroup,
	buildHorizontalTabChip,
	startGroupInlineRename,
	type HorizontalChipDeps,
} from './horizontal-group-chip.ts';

export class WorkspaceHorizontalBar {
	private readonly win: Window;
	private readonly doc: Document;
	private readonly prefs: UnifiedPrefService;
	private readonly store: WorkspaceStateStore;
	private readonly tabs: WorkspaceTabController;
	private readonly menus: WorkspaceTabContextMenu;
	private readonly hover: WorkspaceHoverCard;
	private readonly toolbar: WorkspaceToolbarActions;
	private readonly pinnedStrip: HorizontalPinnedStrip;
	private readonly onRefresh: () => void;
	private inlineEl: HTMLElement | null = null;
	private headingClickTimer = 0;
	private lastSelectedID = '';
	private lastRenderKey = '';

	constructor(
		win: Window, prefs: UnifiedPrefService, store: WorkspaceStateStore, tabs: WorkspaceTabController,
		menus: WorkspaceTabContextMenu, hover: WorkspaceHoverCard, toolbar: WorkspaceToolbarActions, onRefresh: () => void,
	) {
		this.win = win; this.doc = win.document; this.prefs = prefs; this.store = store;
		this.tabs = tabs; this.menus = menus; this.hover = hover; this.toolbar = toolbar; this.onRefresh = onRefresh;
		this.pinnedStrip = new HorizontalPinnedStrip(win, prefs, tabs, menus, hover);
	}

	private get chipDeps(): HorizontalChipDeps {
		return {
			win: this.win, doc: this.doc, prefs: this.prefs, store: this.store,
			tabs: this.tabs, menus: this.menus, hover: this.hover, onRefresh: this.onRefresh,
		};
	}

	render(tracked: TrackedTab[]): void {
		this.toolbar.render(tracked);
		const tabBar = this.doc.getElementById('tab-bar-container');
		const inner = tabBar?.querySelector('.tab-bar-inner-container') as HTMLElement | null;
		if (!tabBar || !inner) return;

		const sidebarHealthy = this.prefs.get('workspace.enableVerticalSidebar') && !this.prefs.get('workspace.verticalSidebarCollapsed') && Boolean(this.doc.getElementById('zbf-sidebar')?.isConnected);
		const compactTop = this.prefs.get('workspace.enableHorizontalGroups') && this.prefs.get('workspace.compactTopBar') && sidebarHealthy;
		const enabled = this.prefs.get('workspace.enableHorizontalGroups') && !compactTop;
		if (!enabled) {
			tabBar.toggleAttribute('data-zbf-inline', compactTop);
			this.inlineEl?.setAttribute('hidden', 'true');
			return;
		}

		tabBar.setAttribute('data-zbf-inline', '1');
		if (!this.inlineEl || !this.inlineEl.isConnected) {
			this.doc.getElementById('zbf-inline')?.remove();
			const inline = createWorkspaceElement(this.doc, 'div');
			inline.id = 'zbf-inline';
			inline.addEventListener('wheel', (e) => {
				const we = e as WheelEvent;
				if (we.ctrlKey || inline.scrollWidth <= inline.clientWidth) return;
				we.preventDefault();
				inline.scrollLeft += we.deltaX || we.deltaY;
			}, { passive: false });
			inner.insertBefore(inline, inner.querySelector('.tabs-wrapper'));
			this.inlineEl = inline;
		}
		this.inlineEl.removeAttribute('hidden');
		const selectedID = String((this.win as any).Zotero_Tabs?.selectedID || '');
		const compactMode = this.prefs.get('workspace.horizontalTabCompactMode');
		const gKey = this.store.state.groups.map((g) => `${g.id}:${g.name}:${g.color}`).join(',');
		const tKey = tracked.map((t) => `${t.key}:${t.tabID}:${t.groupId}:${t.pinned ? 1 : 0}:${t.sleeping ? 1 : 0}:${t.virtual ? 1 : 0}:${t.remark}:${this.store.state.remarkModes[t.key] || ''}:${t.title}:${t.shortTitle}:${t.filename}`).join('|');
		const pKey = `${this.prefs.get('workspace.pinnedIconOnly')}|${this.prefs.get('workspace.enablePinnedTabs')}|${this.prefs.get('workspace.enableTabRemarks')}|${this.prefs.get('workspace.remarkDisplayMode')}|${this.prefs.get('workspace.verticalTabTitleMode')}`;
		const renderKey = `${selectedID}|${compactMode}|${pKey}|${this.store.state.collapsed.join(',')}|${gKey}|${tKey}`;
		if (renderKey === this.lastRenderKey && this.inlineEl.children.length > 0) return;
		this.lastRenderKey = renderKey;
		const frag = this.doc.createDocumentFragment();

		const pinnedTabs = tracked.filter((t) => !t.virtual && t.pinned);
		const unpinned = tracked.filter((t) => t.virtual || !t.pinned);
		this.pinnedStrip.render(frag, pinnedTabs, selectedID);

		const compactInactive = compactMode === 'compact' || (compactMode === 'auto' && unpinned.length > 5);
		const deps = this.chipDeps;

		for (const group of this.store.state.groups) {
			const members = unpinned.filter((t) => t.groupId === group.id);
			frag.appendChild(this.buildGroupSection(deps, group, members, selectedID, compactInactive));
		}

		const ungrouped = unpinned.filter((t) => !t.groupId);
		if (ungrouped.length) {
			const sec = createWorkspaceElement(this.doc, 'div');
			sec.className = 'zbf-hsection';
			for (const tab of ungrouped) sec.appendChild(buildHorizontalTabChip(deps, tab, selectedID, compactInactive));
			frag.appendChild(sec);
		}

		const addBtn = createWorkspaceElement(this.doc, 'button');
		addBtn.type = 'button';
		addBtn.className = 'zbf-add-group';
		addBtn.title = '新建分组';
		addBtn.setAttribute('aria-label', '新建标签页分组');
		addBtn.appendChild(createWorkspaceIcon(this.doc, 'plus', 13));
		addBtn.addEventListener('click', () => {
			openTextPromptModal(this.win, '新建分组', '输入分组名称...', '新分组', (name) => {
				if (!name.trim()) return;
				this.store.createGroup(name);
				this.onRefresh();
			});
		});
		addBtn.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.menus.openAddGroupMenu(addBtn, e as MouseEvent);
		});
		bindHorizontalDropToNewGroup(deps, addBtn);
		frag.appendChild(addBtn);
		this.inlineEl.replaceChildren(frag);
		if (selectedID && selectedID !== this.lastSelectedID) {
			this.lastSelectedID = selectedID;
			this.inlineEl.querySelector('.zbf-htab.selected')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
		}
	}

	destroy(): void {
		if (this.headingClickTimer) this.win.clearTimeout(this.headingClickTimer);
		this.doc.getElementById('tab-bar-container')?.removeAttribute('data-zbf-inline');
		this.inlineEl?.remove();
		this.inlineEl = null;
		this.pinnedStrip.destroy();
		this.toolbar.destroy();
	}

	private buildGroupSection(
		deps: HorizontalChipDeps,
		group: TabGroup,
		members: TrackedTab[],
		selectedID: string,
		compactInactive: boolean,
	): HTMLElement {
		const sec = createWorkspaceElement(this.doc, 'div');
		sec.className = 'zbf-hsection';
		sec.setAttribute('data-grouped', 'true');
		sec.style.setProperty('--zbf-gcolor', group.color);

		const isCollapsed = this.store.state.collapsed.includes(group.id);
		const head = createWorkspaceElement(this.doc, 'button');
		head.type = 'button';
		head.className = 'zbf-hheading';
		const labelText = `${isCollapsed ? '▸' : '▾'} ${group.name} (${members.length})`;
		head.title = labelText;

		const dot = createWorkspaceElement(this.doc, 'span');
		dot.className = 'zbf-sb-group-dot';
		dot.style.backgroundColor = group.color;
		const nameSpan = createWorkspaceElement(this.doc, 'span');
		nameSpan.textContent = labelText;
		head.append(dot, nameSpan);

		head.addEventListener('click', () => {
			if (this.headingClickTimer) this.win.clearTimeout(this.headingClickTimer);
			this.headingClickTimer = this.win.setTimeout(() => {
				this.headingClickTimer = 0;
				this.store.setCollapsed(group.id, !this.store.state.collapsed.includes(group.id));
				this.onRefresh();
			}, 210);
		});
		head.addEventListener('dblclick', (e) => {
			e.stopPropagation();
			if (this.headingClickTimer) {
				this.win.clearTimeout(this.headingClickTimer);
				this.headingClickTimer = 0;
			}
			startGroupInlineRename(this.doc, this.store, head, group, this.onRefresh);
		});
		head.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.menus.openGroupMenu(head, group, e as MouseEvent);
		});
		bindHorizontalDropToGroup(deps, head, group.id);
		sec.appendChild(head);

		if (!isCollapsed) {
			const body = createWorkspaceElement(this.doc, 'div');
			body.className = 'zbf-hsection-body';
			for (const tab of members) body.appendChild(buildHorizontalTabChip(deps, tab, selectedID, compactInactive));
			sec.appendChild(body);
		}
		return sec;
	}
}
