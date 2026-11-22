import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import type { CitationBadgeInfo } from '../../kernel/types.ts';
import type { WorkspaceHoverCard } from './hover-card.ts';
import type { SidebarSelection } from './sidebar-selection.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import type { WorkspaceTabContextMenu } from './tab-context-menu.ts';
import type { WorkspaceTabController } from './tab-controller.ts';
import type { TrackedTab } from './types.ts';
import {
	beginTabDrag,
	hasBridgeFlowDraggedTab,
	hasZoteroDraggedItems,
	parseZoteroDraggedItemIDs,
	readTabDragPayload,
} from './workspace-drag.ts';
import { createWorkspaceIcon } from './workspace-icons.ts';

export interface SidebarRowDeps {
	win: Window;
	doc: Document;
	prefs: UnifiedPrefService;
	store: WorkspaceStateStore;
	tabs: WorkspaceTabController;
	menus: WorkspaceTabContextMenu;
	hover: WorkspaceHoverCard;
	selection: SidebarSelection;
	wordCiteMap: ReadonlyMap<number, CitationBadgeInfo>;
	selectedID: string;
	onRefresh: () => void;
}

export function buildSidebarTabRow(deps: SidebarRowDeps, tab: TrackedTab): HTMLElement {
	const { win, doc, prefs, store, tabs, menus, hover, selection, wordCiteMap, selectedID, onRefresh } = deps;
	const isSelected = !tab.virtual && tab.tabID === selectedID;
	const row = doc.createElement('div');
	row.className = `zbf-vtab-row${isSelected ? ' selected' : ''}${tab.sleeping ? ' sleeping' : ''}${tab.virtual ? ' virtual' : ''}`;
	row.tabIndex = 0;
	row.setAttribute('data-zbf-nav', 'row');
	row.title = tab.title;
	const rowH = prefs.get('workspace.verticalTabRowHeight');
	if (rowH >= 28 && rowH <= 72) row.style.minHeight = `${rowH}px`;

	selection.addCheckbox(row, tab);

	const iconName = tab.pinned ? 'pin' : tab.sleeping ? 'sleep' : tab.virtual ? 'virtual' : tab.type.includes('note') ? 'note' : 'pdf';
	row.appendChild(createWorkspaceIcon(doc, iconName, 13));

	const main = doc.createElement('div');
	main.className = 'zbf-vtab-main';
	const titleEl = doc.createElement('div');
	titleEl.className = 'zbf-vtab-title';
	titleEl.textContent = tabs.getDisplayTitle(tab);
	main.appendChild(titleEl);

	const subMode = prefs.get('workspace.verticalTabSubtitleMode');
	let subText = '';
	if (tab.remark && prefs.get('workspace.enableTabRemarks')) {
		subText = `备注：${tab.remark}`;
	} else if (subMode !== 'none') {
		if (subMode === 'source') subText = tab.source || tab.creatorYear || tab.collection;
		else if (subMode === 'creatorYear') subText = tab.creatorYear || tab.source || tab.collection;
		else if (subMode === 'collection') subText = tab.collection || tab.creatorYear || tab.source;
	}
	if (subText) {
		const subEl = doc.createElement('div');
		subEl.className = 'zbf-vtab-sub';
		subEl.textContent = subText;
		main.appendChild(subEl);
	}
	row.appendChild(main);

	const right = doc.createElement('div');
	right.className = 'zbf-vtab-right';
	const citeInfo = wordCiteMap.get(tab.parentItemID) || wordCiteMap.get(tab.itemID);
	if (citeInfo) {
		const badge = doc.createElement('span');
		badge.className = 'zbf-cite-badge';
		badge.textContent = `[${citeInfo.ordinal}]`;
		badge.title = `${citeInfo.documentName}: ${citeInfo.shortText}`;
		right.appendChild(badge);
	}

	if (!tab.virtual && tab.itemID > 0 && prefs.get('workspace.enableShowInFilesystem')) {
		const folderBtn = doc.createElement('button');
		folderBtn.type = 'button';
		folderBtn.className = 'zbf-row-btn';
		folderBtn.title = '在文件管理器中显示';
		folderBtn.appendChild(createWorkspaceIcon(doc, 'folder', 12));
		folderBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void tabs.revealTabAttachment(win, tab.itemID);
		});
		right.appendChild(folderBtn);
	}

	if (!tab.virtual && !tab.pinned && prefs.get('workspace.enableTabSleep')) {
		const sleepBtn = doc.createElement('button');
		sleepBtn.type = 'button';
		sleepBtn.className = 'zbf-row-btn';
		sleepBtn.title = tab.sleeping ? '唤醒并重新加载' : '休眠释放内存';
		sleepBtn.appendChild(createWorkspaceIcon(doc, 'sleep', 12));
		sleepBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (tab.sleeping) void tabs.reloadTab(win, tab.tabID).then(onRefresh);
			else {
				tabs.sleepTab(win, tab.tabID);
				onRefresh();
			}
		});
		right.appendChild(sleepBtn);
	}

	const closeBtn = doc.createElement('button');
	closeBtn.type = 'button';
	closeBtn.className = 'zbf-row-btn';
	closeBtn.title = tab.virtual ? '移除虚拟成员' : '关闭标签页';
	closeBtn.appendChild(createWorkspaceIcon(doc, 'close', 12));
	closeBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		if (tab.virtual) {
			store.removeVirtualMember(tab.key);
			store.assignToGroup(tab.key, null);
			onRefresh();
		} else {
			void tabs.closeTabs(win, [tab.tabID], { preserveVirtual: true });
		}
	});
	right.appendChild(closeBtn);
	row.appendChild(right);

	if (!tab.virtual) {
		row.draggable = true;
		row.addEventListener('dragstart', (e) => beginTabDrag((e as DragEvent).dataTransfer, tab.key, tab.tabID));
	}
	bindRowDropTarget(deps, row, tab);

	row.addEventListener('click', () => {
		if (tab.virtual) void tabs.openVirtualOrItem(win, tab.itemID, tab.groupId).then(() => onRefresh());
		else tabs.selectTab(win, tab.tabID);
	});
	row.addEventListener('auxclick', (e) => {
		if ((e as MouseEvent).button !== 1) return;
		e.preventDefault();
		e.stopPropagation();
		if (!tab.virtual) void tabs.closeTabs(win, [tab.tabID], { preserveVirtual: true });
	});
	row.addEventListener('contextmenu', (e) => {
		if (!prefs.get('workspace.enableTabContextMenu')) return;
		e.preventDefault();
		menus.openTabMenu(row, tab, e as MouseEvent);
	});
	hover.attach(row, tab);
	return row;
}

export function bindSidebarGroupDrop(
	head: HTMLElement,
	groupId: string,
	win: Window,
	store: WorkspaceStateStore,
	tabs: WorkspaceTabController,
	onRefresh: () => void,
): void {
	head.addEventListener('dragover', (e) => {
		const de = e as DragEvent;
		if (!hasBridgeFlowDraggedTab(de.dataTransfer) && !hasZoteroDraggedItems(de.dataTransfer)) return;
		de.preventDefault();
		head.style.background = 'var(--zbf-accent-soft)';
	});
	head.addEventListener('dragleave', () => { head.style.background = ''; });
	head.addEventListener('drop', (e) => {
		head.style.background = '';
		const de = e as DragEvent;
		const payload = readTabDragPayload(de.dataTransfer);
		if (payload) {
			de.preventDefault();
			store.assignToGroup(payload.key, groupId);
			onRefresh();
			return;
		}
		const ids = parseZoteroDraggedItemIDs(de.dataTransfer);
		if (ids.length) {
			de.preventDefault();
			void Promise.all(ids.map((id) => tabs.openVirtualOrItem(win, id, groupId, true))).then(() => onRefresh());
		}
	});
}

export function bindSidebarSplitter(
	doc: Document,
	aside: HTMLElement,
	splitter: HTMLElement,
	prefs: UnifiedPrefService,
): void {
	let dragging = false;
	splitter.addEventListener('mousedown', (e) => {
		const me = e as MouseEvent;
		me.preventDefault();
		dragging = true;
		const startX = me.clientX;
		const startW = aside.getBoundingClientRect().width || 276;
		const onMove = (ev: Event) => {
			if (!dragging) return;
			const mv = ev as MouseEvent;
			const next = Math.max(200, Math.min(440, Math.round(startW + (mv.clientX - startX))));
			aside.style.width = `${next}px`;
		};
		const onUp = () => {
			if (!dragging) return;
			dragging = false;
			const w = Math.round(aside.getBoundingClientRect().width || 276);
			prefs.set('workspace.verticalSidebarWidth', Math.max(200, Math.min(440, w)));
			doc.removeEventListener('mousemove', onMove);
			doc.removeEventListener('mouseup', onUp);
		};
		doc.addEventListener('mousemove', onMove);
		doc.addEventListener('mouseup', onUp);
	});
}

function bindRowDropTarget(deps: SidebarRowDeps, row: HTMLElement, target: TrackedTab): void {
	const { win, store, tabs, onRefresh } = deps;
	const clearZone = () => row.removeAttribute('data-zbf-drop');

	row.addEventListener('dragover', (e) => {
		const de = e as DragEvent;
		if (!hasBridgeFlowDraggedTab(de.dataTransfer) && !hasZoteroDraggedItems(de.dataTransfer)) return;
		de.preventDefault();
		const rect = row.getBoundingClientRect();
		const ratio = rect.height > 0 ? (de.clientY - rect.top) / rect.height : 0.5;
		const zone = ratio < 0.28 ? 'before' : ratio > 0.72 ? 'after' : 'join';
		row.setAttribute('data-zbf-drop', zone);
	});
	row.addEventListener('dragleave', clearZone);
	row.addEventListener('drop', (e) => {
		const zone = row.getAttribute('data-zbf-drop') || 'join';
		clearZone();
		const de = e as DragEvent;
		const payload = readTabDragPayload(de.dataTransfer);
		if (payload && payload.key !== target.key) {
			de.preventDefault();
			if (zone === 'join') {
				if (target.groupId) store.assignToGroup(payload.key, target.groupId);
				else {
					const newGrp = store.createGroup(tabs.getDisplayTitle(target).slice(0, 18));
					store.assignToGroup(target.key, newGrp.id);
					store.assignToGroup(payload.key, newGrp.id);
				}
			} else {
				const after = zone === 'after';
				store.assignKeyRelative(payload.key, target.groupId || null, target.key, after);
				if (payload.tabID && target.tabID) tabs.moveTabRelative(win, payload.tabID, target.tabID, after);
			}
			onRefresh();
			return;
		}
		const ids = parseZoteroDraggedItemIDs(de.dataTransfer);
		if (ids.length) {
			de.preventDefault();
			void Promise.all(ids.map((id) => tabs.openVirtualOrItem(win, id, target.groupId || undefined, true))).then(() => onRefresh());
		}
	});
}
