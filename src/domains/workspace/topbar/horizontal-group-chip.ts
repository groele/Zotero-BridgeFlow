import { createWorkspaceElement } from '../workspace-elements.ts';
import type { UnifiedPrefService } from '../../../kernel/pref-service.ts';
import type { WorkspaceHoverCard } from '../sidebar/hover-card.ts';
import type { WorkspaceStateStore } from '../store/state-store.ts';
import type { WorkspaceTabContextMenu } from '../tabs/tab-context-menu.ts';
import type { WorkspaceTabController } from '../tabs/tab-controller.ts';
import type { TabGroup, TrackedTab } from '../types.ts';
import {
	beginTabDrag, hasBridgeFlowDraggedTab, hasZoteroDraggedItems, parseZoteroDraggedItemIDs, readTabDragPayload,
} from '../workspace-drag.ts';
import { createWorkspaceIcon } from '../workspace-icons.ts';

export interface HorizontalChipDeps {
	win: Window;
	doc: Document;
	prefs: UnifiedPrefService;
	store: WorkspaceStateStore;
	tabs: WorkspaceTabController;
	menus: WorkspaceTabContextMenu;
	hover: WorkspaceHoverCard;
	onRefresh: () => void;
}

export function buildHorizontalTabChip(
	deps: HorizontalChipDeps,
	tab: TrackedTab,
	selectedID: string,
	compactInactive: boolean,
): HTMLElement {
	const { win, doc, prefs, store, tabs, menus, hover, onRefresh } = deps;
	const isSelected = !tab.virtual && tab.tabID === selectedID;
	const collapsed = compactInactive && !isSelected;

	const chip = createWorkspaceElement(doc, 'div');
	chip.className = `zbf-htab${isSelected ? ' selected' : ''}${tab.sleeping ? ' sleeping' : ''}${tab.virtual ? ' virtual' : ''}${collapsed ? ' zbf-chip-collapsed' : ''}`;
	chip.title = tabs.getDisplayTitle(tab);

	if (!tab.virtual) {
		chip.draggable = true;
		chip.addEventListener('dragstart', (e) => beginTabDrag((e as DragEvent).dataTransfer, tab.key, tab.tabID));
	}

	const titleEl = createWorkspaceElement(doc, 'span');
	titleEl.className = 'zbf-htab-title';
	titleEl.textContent = collapsed ? '···' : tabs.getDisplayTitle(tab);
	chip.appendChild(titleEl);

	if (!tab.virtual && !collapsed) {
		const closeBtn = createWorkspaceElement(doc, 'button');
		closeBtn.type = 'button';
		closeBtn.className = 'zbf-htab-close';
		closeBtn.title = '关闭标签页';
		closeBtn.appendChild(createWorkspaceIcon(doc, 'close', 11));
		closeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void tabs.closeTabs(win, [tab.tabID], { preserveVirtual: true });
		});
		chip.appendChild(closeBtn);
	}

	chip.addEventListener('click', () => {
		if (tab.virtual) void tabs.openVirtualOrItem(win, tab.itemID, tab.groupId).then(() => onRefresh());
		else tabs.selectTab(win, tab.tabID);
	});
	chip.addEventListener('auxclick', (e) => {
		if ((e as MouseEvent).button !== 1) return;
		e.preventDefault();
		e.stopPropagation();
		if (!tab.virtual) void tabs.closeTabs(win, [tab.tabID], { preserveVirtual: true, protectPinned: true });
	});
	chip.addEventListener('contextmenu', (e) => {
		if (!prefs.get('workspace.enableTabContextMenu')) return;
		e.preventDefault();
		e.stopPropagation();
		menus.openTabMenu(chip, tab, e as MouseEvent);
	});
	bindHorizontalDropToChip(deps, chip, tab);
	hover.attach(chip, tab);
	return chip;
}

export function startGroupInlineRename(
	doc: Document,
	store: WorkspaceStateStore,
	head: HTMLElement,
	group: TabGroup,
	onRefresh: () => void,
): void {
	const input = createWorkspaceElement(doc, 'input') as HTMLInputElement;
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
		if (commit && input.value.trim()) store.renameGroup(group.id, input.value);
		onRefresh();
	};
	input.addEventListener('keydown', (e) => {
		const ke = e as KeyboardEvent;
		if (ke.isComposing) return;
		if (ke.key === 'Enter') finish(true);
		else if (ke.key === 'Escape') finish(false);
	});
	input.addEventListener('blur', () => finish(true));
}

export function bindHorizontalDropToGroup(deps: HorizontalChipDeps, el: HTMLElement, groupId: string): void {
	const { win, store, tabs, onRefresh } = deps;
	el.addEventListener('dragover', (e) => {
		const de = e as DragEvent;
		if (!hasBridgeFlowDraggedTab(de.dataTransfer) && !hasZoteroDraggedItems(de.dataTransfer)) return;
		de.preventDefault();
		el.style.outline = '2px solid var(--zbf-accent)';
	});
	el.addEventListener('dragleave', () => { el.style.outline = ''; });
	el.addEventListener('drop', (e) => {
		el.style.outline = '';
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

function bindHorizontalDropToChip(deps: HorizontalChipDeps, el: HTMLElement, target: TrackedTab): void {
	const { win, store, tabs, onRefresh } = deps;
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
				store.assignToGroup(payload.key, target.groupId);
				if (payload.tabID && target.tabID) tabs.moveTabRelative(win, payload.tabID, target.tabID, true);
			} else {
				const newGrp = store.createGroup(tabs.getDisplayTitle(target).slice(0, 18));
				store.assignToGroup(target.key, newGrp.id);
				store.assignToGroup(payload.key, newGrp.id);
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

export function bindHorizontalDropToNewGroup(deps: HorizontalChipDeps, btn: HTMLElement): void {
	const { win, store, tabs, onRefresh } = deps;
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
			const grp = store.createGroup('新分组');
			store.assignToGroup(payload.key, grp.id);
			onRefresh();
			return;
		}
		const ids = parseZoteroDraggedItemIDs(de.dataTransfer);
		if (ids.length) {
			de.preventDefault();
			const grp = store.createGroup('新分组');
			void Promise.all(ids.map((id) => tabs.openVirtualOrItem(win, id, grp.id, true))).then(() => onRefresh());
		}
	});
}
