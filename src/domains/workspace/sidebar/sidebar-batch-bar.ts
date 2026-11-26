import { createWorkspaceElement } from '../workspace-elements.ts';
import type { CitationBadgeInfo } from '../../../kernel/types.ts';
import { openTextPromptModal } from '../tabs/popup-menu-helpers.ts';
import { bindSidebarGroupDrop, buildSidebarTabRow } from './sidebar-list-helpers.ts';
import { appendSidebarSectionHead } from './sidebar-sections-helpers.ts';
import type { WorkspaceStateStore } from '../store/state-store.ts';
import type { WorkspaceTabContextMenu } from '../tabs/tab-context-menu.ts';
import type { WorkspaceTabController } from '../tabs/tab-controller.ts';
import type { TrackedTab } from '../types.ts';

export function appendSidebarSimpleSection(
	doc: Document,
	listEl: HTMLElement,
	title: string,
	color: string,
	tabsList: TrackedTab[],
	rowDeps: any,
): void {
	appendSidebarSectionHead(doc, listEl, `${title} (${tabsList.length})`, color);
	for (const tab of tabsList) listEl.appendChild(buildSidebarTabRow(rowDeps, tab));
}

export function renderSidebarGroupsList(
	win: Window,
	doc: Document,
	listEl: HTMLElement,
	store: WorkspaceStateStore,
	tabs: WorkspaceTabController,
	menus: WorkspaceTabContextMenu,
	filtered: readonly TrackedTab[],
	rowDeps: any,
	onRefreshList: () => void,
	onRefreshAll: () => void,
): void {
	const pinned = filtered.filter((t) => !t.virtual && t.pinned);
	if (pinned.length) appendSidebarSimpleSection(doc, listEl, '已固定标签', '#f59e0b', pinned, rowDeps);

	for (const grp of store.state.groups) {
		const members = filtered.filter((t) => (t.virtual || !t.pinned) && t.groupId === grp.id);
		const collapsed = store.state.collapsed.includes(grp.id);
		const head = createWorkspaceElement(doc, 'button');
		head.type = 'button';
		head.className = 'zbf-sb-group-head';
		head.tabIndex = 0;
		head.setAttribute('data-zbf-nav', 'head');
		const dot = createWorkspaceElement(doc, 'span');
		dot.className = 'zbf-sb-group-dot';
		dot.style.backgroundColor = grp.color;
		const label = createWorkspaceElement(doc, 'span');
		label.textContent = `${collapsed ? '▸' : '▾'} ${grp.name} (${members.length})`;
		head.append(dot, label);
		head.addEventListener('click', () => {
			store.setCollapsed(grp.id, !collapsed);
			onRefreshList();
		});
		head.addEventListener('dblclick', (e) => {
			e.stopPropagation();
			openTextPromptModal(win, '重命名分组', '输入新的分组名称...', grp.name, (val) => {
				if (store.renameGroup(grp.id, val)) onRefreshAll();
			});
		});
		head.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			e.stopPropagation();
			menus.openGroupMenu(head, grp, e as MouseEvent);
		});
		bindSidebarGroupDrop(head, grp.id, win, store, tabs, onRefreshAll);
		listEl.appendChild(head);
		if (!collapsed) {
			for (const tab of members) listEl.appendChild(buildSidebarTabRow(rowDeps, tab));
		}
	}

	const ungrouped = filtered.filter((t) => !t.pinned && !t.groupId);
	if (ungrouped.length) appendSidebarSimpleSection(doc, listEl, '未分组', '#64748b', ungrouped, rowDeps);
}

export function renderSidebarStatusSections(
	doc: Document,
	listEl: HTMLElement,
	filtered: readonly TrackedTab[],
	wordCiteMap: ReadonlyMap<number, CitationBadgeInfo>,
	rowDeps: any,
): void {
	const isCited = (t: TrackedTab) => wordCiteMap.has(t.parentItemID) || wordCiteMap.has(t.itemID);
	const cited = filtered.filter((t) => isCited(t));
	const rest = filtered.filter((t) => !isCited(t));
	const pinned = rest.filter((t) => !t.virtual && t.pinned);
	const active = rest.filter((t) => !t.virtual && !t.sleeping && !t.pinned);
	const sleeping = rest.filter((t) => !t.virtual && t.sleeping);
	const virtual = rest.filter((t) => t.virtual);
	if (cited.length) appendSidebarSimpleSection(doc, listEl, 'Word 正在引用', '#0D9488', cited, rowDeps);
	if (pinned.length) appendSidebarSimpleSection(doc, listEl, '已固定', '#f59e0b', pinned, rowDeps);
	if (active.length) appendSidebarSimpleSection(doc, listEl, '当前活动', '#245ac7', active, rowDeps);
	if (sleeping.length) appendSidebarSimpleSection(doc, listEl, '已休眠', '#8b5cf6', sleeping, rowDeps);
	if (virtual.length) appendSidebarSimpleSection(doc, listEl, '虚拟保留', '#64748b', virtual, rowDeps);
}
