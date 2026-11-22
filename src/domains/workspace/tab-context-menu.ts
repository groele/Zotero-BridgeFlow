import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import type { WorkspaceTabController } from './tab-controller.ts';
import { GROUP_PALETTE, type TabGroup, type TrackedTab } from './types.ts';

export class TabContextMenuController {
	private readonly popups = new Set<Element>();
	private readonly win: Window;
	private readonly doc: Document;
	private readonly prefs: UnifiedPrefService;
	private readonly store: WorkspaceStateStore;
	private readonly tabs: WorkspaceTabController;
	private readonly onRefresh: () => void;

	constructor(
		win: Window,
		doc: Document,
		prefs: UnifiedPrefService,
		store: WorkspaceStateStore,
		tabs: WorkspaceTabController,
		onRefresh: () => void,
	) {
		this.win = win;
		this.doc = doc;
		this.prefs = prefs;
		this.store = store;
		this.tabs = tabs;
		this.onRefresh = onRefresh;
	}

	openTabMenu(event: MouseEvent, tab: TrackedTab): void {
		if (!this.prefs.get('workspace.enableTabContextMenu')) return;
		event.preventDefault();
		event.stopPropagation();
		this.openAt(event, (popup) => {
			if (this.prefs.get('workspace.enablePinnedTabs')) {
				this.addItem(popup, tab.pinned ? 'Unpin Tab' : '📌 Pin Tab (Protect)', () => {
					this.store.setPinned(tab.key, !tab.pinned);
					this.onRefresh();
				});
			}
			if (this.prefs.get('workspace.enableTabRemarks')) {
				this.addItem(popup, tab.remark ? '✎ Edit Tab Remark…' : '✎ Set Tab Remark…', () => {
					this.deferPrompt('Tab Remark', 'Remark (max 300 chars):', tab.remark, (val) => {
						this.store.setRemark(tab.key, val);
						this.onRefresh();
					});
				});
			}
			if (this.prefs.get('workspace.enableTabSleep') && !tab.pinned && tab.tabID) {
				this.addItem(popup, tab.sleeping ? '⚡ Wake Tab' : '💤 Sleep Tab (Free Memory)', () => {
					if (tab.sleeping) this.tabs.selectTab(this.win, tab.tabID);
					else this.tabs.sleepTab(this.win, tab.tabID);
					this.onRefresh();
				});
			}

			// Move to Group submenu
			const moveMenu = this.xul('menu');
			moveMenu.setAttribute('label', 'Move to Group');
			const movePop = this.xul('menupopup');
			moveMenu.append(movePop);
			popup.append(moveMenu);
			this.addItem(movePop, '+ New Group…', () => {
				this.deferPrompt('New Group', 'Group name:', '', (name) => {
					if (!name.trim()) return;
					const g = this.store.createGroup(name);
					this.store.assignToGroup(tab.key, g.id);
					this.onRefresh();
				});
			});
			for (const g of this.store.state.groups) {
				this.addItem(movePop, g.name, () => {
					this.store.assignToGroup(tab.key, g.id);
					this.onRefresh();
				}, { type: 'radio', checked: tab.groupId === g.id });
			}
			if (tab.groupId) {
				this.addItem(movePop, 'Remove from Group', () => {
					this.store.assignToGroup(tab.key, null);
					this.onRefresh();
				});
			}

			popup.append(this.xul('menuseparator'));

			if (this.prefs.get('workspace.enableCopyReference') && tab.tabID) {
				this.addItem(popup, '📋 Copy Citation (→ Lookup History)', () => {
					void this.tabs.copyTabCitation(this.win, tab.tabID);
				});
			}
			if (this.prefs.get('workspace.enableShowInFilesystem') && tab.itemID > 0) {
				this.addItem(popup, '📁 Reveal Attachment in Folder', () => {
					(this.win as any).ZoteroPane?.showAttachmentInFilesystem?.(tab.itemID);
				});
			}
			if (this.prefs.get('workspace.enableReloadTab') && tab.tabID) {
				this.addItem(popup, '↻ Reload Tab', () => {
					void this.tabs.reloadTab(this.win, tab.tabID).then(() => this.onRefresh());
				});
			}
			if (tab.tabID) {
				popup.append(this.xul('menuseparator'));
				this.addItem(popup, 'Close Tab', () => {
					void this.tabs.closeTabs(this.win, [tab.tabID], { protectPinned: false }).then(() => this.onRefresh());
				});
			}
		});
	}

	openGroupMenu(event: MouseEvent, group: TabGroup): void {
		event.preventDefault();
		event.stopPropagation();
		this.openAt(event, (popup) => {
			this.addItem(popup, '✎ Rename Group…', () => {
				this.deferPrompt('Rename Group', 'Group name:', group.name, (val) => {
					this.store.renameGroup(group.id, val);
					this.onRefresh();
				});
			});
			const colorMenu = this.xul('menu');
			colorMenu.setAttribute('label', 'Group Color');
			const colorPop = this.xul('menupopup');
			colorMenu.append(colorPop);
			popup.append(colorMenu);
			GROUP_PALETTE.forEach((c, idx) => {
				this.addItem(colorPop, `Color ${idx + 1} (${c})`, () => {
					this.store.setGroupColor(group.id, c);
					this.onRefresh();
				});
			});
			this.addItem(popup, '💾 Save to Workspace & Close Group', () => {
				void this.tabs.archiveAndCloseGroup(this.win, group.id).then(() => this.onRefresh());
			});
			this.addItem(popup, 'Close All Tabs in Group', () => {
				const ids = this.tabs.buildTrackedTabs(this.win)
					.filter((t) => t.groupId === group.id && t.tabID)
					.map((t) => t.tabID);
				void this.tabs.closeTabs(this.win, ids, { protectPinned: true }).then(() => this.onRefresh());
			});
			this.addItem(popup, 'Delete Group (Keep Tabs)', () => {
				this.store.removeGroup(group.id);
				this.onRefresh();
			});
		});
	}

	dispose(): void {
		for (const p of this.popups) p.remove();
		this.popups.clear();
	}

	private openAt(event: MouseEvent, build: (popup: any) => void): void {
		const popupset = this.doc.getElementById('mainPopupSet') || this.doc.querySelector('popupset');
		if (!popupset) return;
		const popup = this.xul('menupopup');
		popupset.append(popup);
		this.popups.add(popup);
		popup.addEventListener('popuphidden', (e: Event) => {
			if (e.target === popup) {
				this.popups.delete(popup);
				popup.remove();
			}
		});
		build(popup);
		popup.openPopupAtScreen(event.screenX, event.screenY, true);
	}

	private xul(tag: string): any {
		return (this.doc as any).createXULElement
			? (this.doc as any).createXULElement(tag)
			: this.doc.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', tag);
	}

	private addItem(popup: any, label: string, action: () => void, attrs: Record<string, string | boolean> = {}): void {
		const mi = this.xul('menuitem');
		mi.setAttribute('label', label);
		for (const [k, v] of Object.entries(attrs)) {
			if (v !== false) mi.setAttribute(k, String(v));
		}
		mi.addEventListener('command', action);
		popup.append(mi);
	}

	private deferPrompt(title: string, msg: string, initial: string, onOk: (val: string) => void): void {
		this.win.setTimeout?.(() => {
			const promptSvc = (globalThis as any).Services?.prompt;
			if (!promptSvc?.prompt) return;
			const input = { value: initial };
			if (promptSvc.prompt(this.win, title, msg, input, null, {})) {
				onOk(input.value);
			}
		}, 0);
	}
}
