import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import { HorizontalPinnedStrip } from './pinned-strip.ts';
import { openTextPromptModal } from './popup-menu-helpers.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import type { WorkspaceHoverCard } from './hover-card.ts';
import type { WorkspaceTabContextMenu } from './tab-context-menu.ts';
import type { WorkspaceTabController } from './tab-controller.ts';
import type { TabGroup, TrackedTab } from './types.ts';
import {
	beginTabDrag,
	hasBridgeFlowDraggedTab,
	hasZoteroDraggedItems,
	parseZoteroDraggedItemIDs,
	readTabDragPayload,
} from './workspace-drag.ts';
import { createWorkspaceIcon } from './workspace-icons.ts';
import type { WorkspaceToolbarActions } from './horizontal-toolbar.ts';

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

	constructor(
		win: Window,
		prefs: UnifiedPrefService,
		store: WorkspaceStateStore,
		tabs: WorkspaceTabController,
		menus: WorkspaceTabContextMenu,
		hover: WorkspaceHoverCard,
		toolbar: WorkspaceToolbarActions,
		onRefresh: () => void,
	) {
		this.win = win;
		this.doc = win.document;
		this.prefs = prefs;
		this.store = store;
		this.tabs = tabs;
		this.menus = menus;
		this.hover = hover;
		this.toolbar = toolbar;
		this.onRefresh = onRefresh;
		this.pinnedStrip = new HorizontalPinnedStrip(win, prefs, tabs, menus, hover);
	}

	render(): void {
		this.toolbar.render();
		const tabBar = this.doc.getElementById('tab-bar-container');
		const inner = tabBar?.querySelector('.tab-bar-inner-container') as HTMLElement | null;
		if (!tabBar || !inner) return;

		const enabled = this.prefs.get('workspace.enableHorizontalGroups') && !this.prefs.get('workspace.compactTopBar');
		if (!enabled) {
			tabBar.removeAttribute('data-zbf-inline');
			this.inlineEl?.setAttribute('hidden', 'true');
			return;
		}

		tabBar.setAttribute('data-zbf-inline', '1');
		if (!this.inlineEl || !this.inlineEl.isConnected) {
			this.doc.getElementById('zbf-inline')?.remove();
			const inline = this.doc.createElement('div');
			inline.id = 'zbf-inline';
			inner.appendChild(inline);
			this.inlineEl = inline;
		}
		this.inlineEl.removeAttribute('hidden');
		this.inlineEl.textContent = '';

		const selectedID = String((this.win as any).Zotero_Tabs?.selectedID || '');
		const tracked = this.tabs.buildTrackedTabs(this.win);
		const pinnedTabs = tracked.filter((t) => !t.virtual && t.pinned);
		const unpinned = tracked.filter((t) => t.virtual || !t.pinned);

		this.pinnedStrip.render(this.inlineEl, pinnedTabs, selectedID);

		const compactMode = this.prefs.get('workspace.horizontalTabCompactMode');
		const compactInactive = compactMode === 'compact' || (compactMode === 'auto' && unpinned.length > 5);

		for (const group of this.store.state.groups) {
			const members = unpinned.filter((t) => t.groupId === group.id);
			if (!members.length && !this.store.state.groups.length) continue;
			this.inlineEl.appendChild(this.buildGroupSection(group, members, selectedID, compactInactive));
		}

		const ungrouped = unpinned.filter((t) => !t.groupId);
		if (ungrouped.length) {
			const sec = this.doc.createElement('div');
			sec.className = 'zbf-hsection';
			for (const tab of ungrouped) {
				sec.appendChild(this.buildTabChip(tab, selectedID, compactInactive));
			}
			this.inlineEl.appendChild(sec);
		}

		const addBtn = this.doc.createElement('button');
		addBtn.type = 'button';
		addBtn.className = 'zbf-add-group';
		addBtn.title = '新建标签页分组（或拖放标签到此处建组）';
		addBtn.appendChild(createWorkspaceIcon(this.doc, 'plus', 14));
		addBtn.addEventListener('click', () => {
			openTextPromptModal(this.win, '新建分组', '输入分组名称...', '新分组', (name) => {
				if (!name.trim()) return;
				this.store.createGroup(name);
				this.onRefresh();
			});
		});
		this.bindDropToNewGroup(addBtn);
		this.inlineEl.appendChild(addBtn);
	}

	destroy(): void {
		if (this.headingClickTimer) this.win.clearTimeout(this.headingClickTimer);
		this.doc.getElementById('tab-bar-container')?.removeAttribute('data-zbf-inline');
		this.inlineEl?.remove();
		this.inlineEl = null;
		this.pinnedStrip.destroy();
		this.toolbar.destroy();
	}

	private buildGroupSection(group: TabGroup, members: TrackedTab[], selectedID: string, compactInactive: boolean): HTMLElement {
		const sec = this.doc.createElement('div');
		sec.className = 'zbf-hsection';
		sec.setAttribute('data-grouped', 'true');
		sec.style.setProperty('--zbf-gcolor', group.color);

		const isCollapsed = this.store.state.collapsed.includes(group.id);
		const head = this.doc.createElement('button');
		head.type = 'button';
		head.className = 'zbf-hheading';
		head.title = `${group.name} (${members.length}) · 单击折叠/展开，双击重命名，右键管理`;

		const dot = this.doc.createElement('span');
		dot.className = 'zbf-sb-group-dot';
		dot.style.background = group.color;
		const nameSpan = this.doc.createElement('span');
		nameSpan.textContent = `${isCollapsed ? '▸ ' : ''}${group.name} (${members.length})`;
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
			this.startInlineRename(head, group);
		});
		head.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			this.menus.openGroupMenu(head, group, e as MouseEvent);
		});
		this.bindDropToGroup(head, group.id);
		sec.appendChild(head);

		if (!isCollapsed) {
			const body = this.doc.createElement('div');
			body.className = 'zbf-hsection-body';
			for (const tab of members) {
				body.appendChild(this.buildTabChip(tab, selectedID, compactInactive));
			}
			sec.appendChild(body);
		}
		return sec;
	}

	private buildTabChip(tab: TrackedTab, selectedID: string, compactInactive: boolean): HTMLElement {
		const isSelected = !tab.virtual && tab.tabID === selectedID;
		const collapsed = compactInactive && !isSelected;

		const chip = this.doc.createElement('div');
		chip.className = `zbf-htab${isSelected ? ' selected' : ''}${tab.sleeping ? ' sleeping' : ''}${tab.virtual ? ' virtual' : ''}${collapsed ? ' zbf-chip-collapsed' : ''}`;
		chip.title = this.tabs.getDisplayTitle(tab);

		if (!tab.virtual) {
			chip.draggable = true;
			chip.addEventListener('dragstart', (e) => beginTabDrag((e as DragEvent).dataTransfer, tab.key, tab.tabID));
		}

		const titleEl = this.doc.createElement('span');
		titleEl.className = 'zbf-htab-title';
		titleEl.textContent = collapsed ? '···' : this.tabs.getDisplayTitle(tab);
		chip.appendChild(titleEl);

		if (!tab.virtual && !collapsed) {
			const closeBtn = this.doc.createElement('button');
			closeBtn.type = 'button';
			closeBtn.className = 'zbf-htab-close';
			closeBtn.title = '关闭标签页';
			closeBtn.appendChild(createWorkspaceIcon(this.doc, 'close', 11));
			closeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				void this.tabs.closeTabs(this.win, [tab.tabID], { preserveVirtual: true });
			});
			chip.appendChild(closeBtn);
		}

		chip.addEventListener('click', () => {
			if (tab.virtual) void this.tabs.openVirtualOrItem(this.win, tab.itemID, tab.groupId).then(() => this.onRefresh());
			else this.tabs.selectTab(this.win, tab.tabID);
		});
		chip.addEventListener('auxclick', (e) => {
			if ((e as MouseEvent).button !== 1) return;
			e.preventDefault();
			e.stopPropagation();
			if (!tab.virtual) void this.tabs.closeTabs(this.win, [tab.tabID], { preserveVirtual: true });
		});
		chip.addEventListener('contextmenu', (e) => {
			if (!this.prefs.get('workspace.enableTabContextMenu')) return;
			e.preventDefault();
			this.menus.openTabMenu(chip, tab, e as MouseEvent);
		});
		this.bindDropToChip(chip, tab);
		this.hover.attach(chip, tab);
		return chip;
	}

	private startInlineRename(head: HTMLElement, group: TabGroup): void {
		const input = this.doc.createElement('input') as HTMLInputElement;
		input.type = 'text';
		input.className = 'zbf-inline-edit';
		input.value = group.name;
		head.replaceWith(input);
		input.focus();
		input.select();

		let done = false;
		const finish = (commit: boolean) => {
			if (done) return;
			done = true;
			if (commit && input.value.trim()) this.store.renameGroup(group.id, input.value);
			this.onRefresh();
		};
		input.addEventListener('keydown', (e) => {
			const ke = e as KeyboardEvent;
			if (ke.key === 'Enter') finish(true);
			else if (ke.key === 'Escape') finish(false);
		});
		input.addEventListener('blur', () => finish(true));
	}

	private bindDropToGroup(el: HTMLElement, groupId: string): void {
		el.addEventListener('dragover', (e) => {
			const de = e as DragEvent;
			if (!hasBridgeFlowDraggedTab(de.dataTransfer) && !hasZoteroDraggedItems(de.dataTransfer)) return;
			de.preventDefault();
			el.style.outline = '2px solid var(--zbf-accent)';
		});
		el.addEventListener('dragleave', () => {
			el.style.outline = '';
		});
		el.addEventListener('drop', (e) => {
			el.style.outline = '';
			const de = e as DragEvent;
			const payload = readTabDragPayload(de.dataTransfer);
			if (payload) {
				de.preventDefault();
				this.store.assignToGroup(payload.key, groupId);
				this.onRefresh();
				return;
			}
			const ids = parseZoteroDraggedItemIDs(de.dataTransfer);
			if (ids.length) {
				de.preventDefault();
				void Promise.all(ids.map((id) => this.tabs.openVirtualOrItem(this.win, id, groupId, true))).then(() => this.onRefresh());
			}
		});
	}

	private bindDropToChip(el: HTMLElement, target: TrackedTab): void {
		el.addEventListener('dragover', (e) => {
			const de = e as DragEvent;
			if (!hasBridgeFlowDraggedTab(de.dataTransfer) && !hasZoteroDraggedItems(de.dataTransfer)) return;
			de.preventDefault();
			el.setAttribute('data-zbf-drop', 'stack');
		});
		el.addEventListener('dragleave', () => el.removeAttribute('data-zbf-drop'));
		el.addEventListener('drop', (e) => {
			el.removeAttribute('data-zbf-drop');
			const de = e as DragEvent;
			const payload = readTabDragPayload(de.dataTransfer);
			if (payload && payload.key !== target.key) {
				de.preventDefault();
				if (target.groupId) {
					this.store.assignToGroup(payload.key, target.groupId);
					if (payload.tabID && target.tabID) this.tabs.moveTabRelative(this.win, payload.tabID, target.tabID, true);
				} else {
					const newGrp = this.store.createGroup(this.tabs.getDisplayTitle(target).slice(0, 18));
					this.store.assignToGroup(target.key, newGrp.id);
					this.store.assignToGroup(payload.key, newGrp.id);
				}
				this.onRefresh();
				return;
			}
			const ids = parseZoteroDraggedItemIDs(de.dataTransfer);
			if (ids.length) {
				de.preventDefault();
				void Promise.all(ids.map((id) => this.tabs.openVirtualOrItem(this.win, id, target.groupId || undefined, true))).then(() => this.onRefresh());
			}
		});
	}

	private bindDropToNewGroup(btn: HTMLElement): void {
		btn.addEventListener('dragover', (e) => {
			const de = e as DragEvent;
			if (!hasBridgeFlowDraggedTab(de.dataTransfer) && !hasZoteroDraggedItems(de.dataTransfer)) return;
			de.preventDefault();
		});
		btn.addEventListener('drop', (e) => {
			const de = e as DragEvent;
			const payload = readTabDragPayload(de.dataTransfer);
			if (payload) {
				de.preventDefault();
				const grp = this.store.createGroup('新分组');
				this.store.assignToGroup(payload.key, grp.id);
				this.onRefresh();
				return;
			}
			const ids = parseZoteroDraggedItemIDs(de.dataTransfer);
			if (ids.length) {
				de.preventDefault();
				const grp = this.store.createGroup('新分组');
				void Promise.all(ids.map((id) => this.tabs.openVirtualOrItem(this.win, id, grp.id, true))).then(() => this.onRefresh());
			}
		});
	}
}
