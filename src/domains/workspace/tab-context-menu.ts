import { createWorkspaceElement } from './workspace-elements.ts';
import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import type { WorkspaceHoverCard } from './hover-card.ts';
import {
	addPopupButton,
	addPopupSeparator,
	addPopupSubmenuSection,
	createFloatingPopup,
	openTextPromptModal,
} from './popup-menu-helpers.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import type { WorkspaceTabController } from './tab-controller.ts';
import { GROUP_PALETTE, type TabGroup, type TrackedTab } from './types.ts';

export class WorkspaceTabContextMenu {
	private readonly win: Window;
	private readonly doc: Document;
	private readonly prefs: UnifiedPrefService;
	private readonly store: WorkspaceStateStore;
	private readonly tabs: WorkspaceTabController;
	private readonly onRefresh: () => void;
	private readonly hoverCard?: WorkspaceHoverCard | null;
	private activePopup: HTMLElement | null = null;
	private boundOutside: ((e: Event) => void) | null = null;

	constructor(
		win: Window,
		prefs: UnifiedPrefService,
		store: WorkspaceStateStore,
		tabs: WorkspaceTabController,
		onRefresh: () => void,
		hoverCard?: WorkspaceHoverCard | null,
	) {
		this.win = win;
		this.doc = win.document;
		this.prefs = prefs;
		this.store = store;
		this.tabs = tabs;
		this.onRefresh = onRefresh;
		this.hoverCard = hoverCard;
	}

	openTabMenu(anchor: HTMLElement, tab: TrackedTab, event?: MouseEvent): void {
		this.hoverCard?.hide();
		if (tab.virtual) {
			this.openVirtualMenu(anchor, tab, event);
			return;
		}
		this.close();
		const pop = createFloatingPopup(this.doc, anchor, event, 232);
		if (!pop) return;
		const close = () => this.close();

		if (this.prefs.get('workspace.enablePinnedTabs')) {
			addPopupButton(this.doc, pop, tab.pinned ? '取消固定标签' : '固定标签（防误关）', () => {
				this.store.setPinned(tab.key, !tab.pinned);
				this.onRefresh();
			}, close, { icon: 'pin' });
		}
		if (this.prefs.get('workspace.enableTabRemarks')) {
			addPopupButton(this.doc, pop, tab.remark ? '编辑标签备注…' : '设置标签备注…', () => {
				openTextPromptModal(this.win, '设置标签备注', '输入备注（≤300 字，留空清除）：', tab.remark || '', (val) => {
					this.store.setRemark(tab.key, val);
					this.onRefresh();
				}, anchor);
			}, close, { icon: 'edit' });
			if (tab.remark) {
				addPopupSubmenuSection(this.doc, pop, '标签显示模式', 'eye', (sub) => {
					const curMode = this.store.state.remarkModes[tab.key] || '';
					for (const [m, lbl] of [['', '跟随全局设置'], ['both', '备注 + 原标题'], ['remark', '仅显示备注'], ['title', '仅显示原标题']] as const) {
						addPopupButton(this.doc, sub, `${curMode === m ? '✓ ' : '   '}${lbl}`, () => {
							this.store.setRemarkMode(tab.key, m);
							this.onRefresh();
						}, close);
					}
				});
			}
		}
		if (this.prefs.get('workspace.enableTabSleep') && !tab.pinned) {
			addPopupButton(this.doc, pop, tab.sleeping ? '唤醒标签页' : '休眠标签（释放内存）', () => {
				if (tab.sleeping) void this.tabs.reloadTab(this.win, tab.tabID);
				else this.tabs.sleepTab(this.win, tab.tabID);
				this.onRefresh();
			}, close, { icon: 'sleep' });
		}

		addPopupSeparator(this.doc, pop);

		addPopupSubmenuSection(this.doc, pop, '加入分组', 'folder', (sub) => {
			for (const group of this.store.state.groups) {
				const inThis = tab.groupId === group.id;
				addPopupButton(this.doc, sub, `${inThis ? '✓ ' : '   '}${group.name}`, () => {
					this.store.assignToGroup(tab.key, group.id);
					this.onRefresh();
				}, close);
			}
			addPopupButton(this.doc, sub, '新建分组并加入…', () => {
				openTextPromptModal(this.win, '新建分组', '输入分组名称...', '新分组', (name) => {
					if (!name.trim()) return;
					const grp = this.store.createGroup(name);
					this.store.assignToGroup(tab.key, grp.id);
					this.onRefresh();
				}, anchor);
			}, close, { icon: 'plus' });
			if (tab.groupId) {
				addPopupButton(this.doc, sub, '移出当前分组', () => {
					this.store.assignToGroup(tab.key, null);
					this.onRefresh();
				}, close, { icon: 'close' });
			}
		});

		addPopupSeparator(this.doc, pop);

		if (tab.itemID > 0) {
			addPopupButton(this.doc, pop, '在文献库中定位', () => {
				void this.tabs.showInLibrary(this.win, tab.itemID, false);
			}, close, { icon: 'locate' });
			addPopupButton(this.doc, pop, '在集合树中定位所属集合', () => {
				void this.tabs.showInLibrary(this.win, tab.itemID, true);
			}, close, { icon: 'layers' });
		}
		if (this.prefs.get('workspace.enableCopyReference')) {
			addPopupButton(this.doc, pop, '复制引用到剪贴板', () => {
				void this.tabs.copyTabCitation(this.win, tab.tabID);
			}, close, { icon: 'copy' });
		}
		if (tab.itemID > 0 && this.prefs.get('modules.wordCite.enable') && this.prefs.get('wordCite.tabContextMenu.enable')) {
			addPopupButton(this.doc, pop, '插入引文到 Word 光标处', () => {
				this.tabs.citeItemsInWord(this.win, [tab.parentItemID || tab.itemID]);
			}, close, { icon: 'word' });
		}
		if (tab.itemID > 0 && this.prefs.get('workspace.enableShowInFilesystem')) {
			addPopupButton(this.doc, pop, '在文件管理器中显示', () => {
				void this.tabs.revealTabAttachment(this.win, tab.itemID);
			}, close, { icon: 'folder' });
		}
		if (this.prefs.get('workspace.enableReloadTab')) {
			addPopupButton(this.doc, pop, '重新加载标签页', () => {
				void this.tabs.reloadTab(this.win, tab.tabID).then(() => this.onRefresh());
			}, close, { icon: 'refresh' });
		}

		addPopupSeparator(this.doc, pop);

		if (this.prefs.get('workspace.enableVirtualMembers') && tab.groupId) {
			addPopupButton(this.doc, pop, '关闭标签（保留在分组）', () => {
				void this.tabs.closeTabs(this.win, [tab.tabID], { preserveVirtual: true });
			}, close, { icon: 'virtual' });
		}
		addPopupButton(this.doc, pop, '彻底关闭标签页', () => {
			void this.tabs.closeTabs(this.win, [tab.tabID], { preserveVirtual: false });
		}, close, { icon: 'close', danger: true });
		addPopupButton(this.doc, pop, '恢复最近关闭的标签页', () => {
			this.tabs.undoCloseTab(this.win);
			this.onRefresh();
		}, close, { icon: 'undo' });

		this.bindPopup(pop);
	}

	openVirtualMenu(anchor: HTMLElement, tab: TrackedTab, event?: MouseEvent): void {
		this.hoverCard?.hide();
		this.close();
		const pop = createFloatingPopup(this.doc, anchor, event, 215);
		if (!pop) return;
		const close = () => this.close();

		addPopupButton(this.doc, pop, '加载并打开文献', () => {
			void this.tabs.openVirtualOrItem(this.win, tab.itemID, tab.groupId).then(() => this.onRefresh());
		}, close, { icon: 'play' });
		if (tab.itemID > 0) {
			addPopupButton(this.doc, pop, '在文献库中定位', () => {
				void this.tabs.showInLibrary(this.win, tab.itemID, true);
			}, close, { icon: 'locate' });
			if (this.prefs.get('modules.wordCite.enable') && this.prefs.get('wordCite.tabContextMenu.enable')) {
				addPopupButton(this.doc, pop, '插入引文到 Word 光标处', () => {
					this.tabs.citeItemsInWord(this.win, [tab.parentItemID || tab.itemID]);
				}, close, { icon: 'word' });
			}
		}
		addPopupSeparator(this.doc, pop);
		addPopupButton(this.doc, pop, '从分组移除虚拟成员', () => {
			this.store.removeVirtualMember(tab.key);
			this.store.assignToGroup(tab.key, null);
			this.onRefresh();
		}, close, { icon: 'trash', danger: true });

		this.bindPopup(pop);
	}

	openGroupMenu(anchor: HTMLElement, group: TabGroup, event?: MouseEvent): void {
		this.hoverCard?.hide();
		this.close();
		const pop = createFloatingPopup(this.doc, anchor, event, 236);
		if (!pop) return;
		const close = () => this.close();

		addPopupButton(this.doc, pop, '重命名分组…', () => {
			openTextPromptModal(this.win, '重命名分组', '分组名称：', group.name, (val) => {
				if (this.store.renameGroup(group.id, val)) this.onRefresh();
			}, anchor);
		}, close, { icon: 'edit' });

		addPopupSubmenuSection(this.doc, pop, '分组颜色', 'palette', (sub) => {
			const swatchRow = createWorkspaceElement(this.doc, 'div');
			swatchRow.className = 'zbf-color-row';
			for (const color of GROUP_PALETTE) {
				const swatch = createWorkspaceElement(this.doc, 'button');
				swatch.type = 'button';
				swatch.className = `zbf-color-swatch${color === group.color ? ' active' : ''}`;
				swatch.style.background = color;
				swatch.title = color;
				swatch.addEventListener('click', () => {
					this.store.setGroupColor(group.id, color);
					this.close();
					this.onRefresh();
				});
				swatchRow.appendChild(swatch);
			}
			sub.appendChild(swatchRow);
			addPopupButton(this.doc, sub, '自定义 Hex 颜色…', () => {
				openTextPromptModal(this.win, '自定义颜色', '输入 3 位或 6 位 Hex 颜色（如 #3b82f6）：', group.color, (hex) => {
					if (/^#[0-9a-fA-F]{3,8}$/.test(hex.trim())) {
						this.store.setGroupColor(group.id, hex.trim());
						this.onRefresh();
					}
				}, anchor);
			}, close, { icon: 'palette' });
		}, group.color);

		addPopupSeparator(this.doc, pop);

		if (this.prefs.get('workspace.enableSessions')) {
			addPopupButton(this.doc, pop, '保存到工作区并关闭…', () => {
				void this.tabs.archiveAndCloseGroup(this.win, group.id).then(() => this.onRefresh());
			}, close, { icon: 'archive' });
			addPopupButton(this.doc, pop, '保存分组快照（保留标签）', () => {
				this.tabs.saveGroupSnapshot(this.win, group.id);
				this.onRefresh();
			}, close, { icon: 'save' });
		}
		if (this.prefs.get('workspace.enableAnnotationMatrix')) {
			addPopupButton(this.doc, pop, '生成本组文献对比矩阵…', () => {
				this.tabs.openGroupAnnotationMatrix(this.win, group.id);
			}, close, { icon: 'layers' });
		}

		addPopupButton(this.doc, pop, '折叠其他分组', () => {
			this.store.collapseOtherGroups(group.id);
			this.onRefresh();
		}, close, { icon: 'collapse', disabled: this.store.state.groups.length <= 1 });

		const virtualCount = this.tabs.buildTrackedTabs(this.win).filter((t) => t.virtual && t.groupId === group.id).length;
		if (virtualCount > 0) {
			addPopupButton(this.doc, pop, '打开组内全部虚拟文献', () => {
				void this.tabs.openGroupVirtuals(this.win, group.id).then(() => this.onRefresh());
			}, close, { icon: 'play', badge: String(virtualCount) });
		}

		if (this.prefs.get('modules.wordCite.enable') && this.prefs.get('wordCite.tabContextMenu.enable')) {
			const groupItemIDs = [...new Set(
				this.tabs.buildTrackedTabs(this.win)
					.filter((t) => t.groupId === group.id && (t.parentItemID > 0 || t.itemID > 0))
					.map((t) => t.parentItemID || t.itemID),
			)];
			if (groupItemIDs.length > 0) {
				addPopupButton(this.doc, pop, '插入本组引文到 Word', () => {
					this.tabs.citeItemsInWord(this.win, groupItemIDs);
				}, close, { icon: 'word', badge: String(groupItemIDs.length) });
			}
		}

		addPopupSeparator(this.doc, pop);

		addPopupButton(this.doc, pop, '仅打开本组（关闭其他标签）', () => {
			const ids = this.tabs.buildTrackedTabs(this.win).filter((t) => !t.virtual && t.groupId !== group.id).map((t) => t.tabID);
			void this.tabs.closeTabs(this.win, ids, { preserveVirtual: true, protectPinned: true }).then(() => this.onRefresh());
		}, close, { icon: 'layers' });

		addPopupButton(this.doc, pop, '关闭组内所有已开标签', () => {
			const ids = this.tabs.buildTrackedTabs(this.win).filter((t) => !t.virtual && t.groupId === group.id).map((t) => t.tabID);
			void this.tabs.closeTabs(this.win, ids, { preserveVirtual: true, protectPinned: true }).then(() => this.onRefresh());
		}, close, { icon: 'close' });

		addPopupButton(this.doc, pop, '解散此分组', () => {
			this.store.removeGroup(group.id);
			this.onRefresh();
		}, close, { icon: 'trash', danger: true });

		this.bindPopup(pop);
	}

	openAddGroupMenu(anchor: HTMLElement, event?: MouseEvent): void {
		this.hoverCard?.hide();
		this.close();
		const pop = createFloatingPopup(this.doc, anchor, event, 224);
		if (!pop) return;
		const close = () => this.close();
		addPopupButton(this.doc, pop, '新建空白分组…', () => {
			openTextPromptModal(this.win, '新建分组', '输入分组名称...', '新分组', (name) => {
				if (!name.trim()) return;
				this.store.createGroup(name);
				this.onRefresh();
			}, anchor);
		}, close, { icon: 'plus' });
		addPopupButton(this.doc, pop, '按当前 Zotero 集合自动分组', () => {
			this.tabs.autoGroupByCollection(this.win);
			this.onRefresh();
		}, close, { icon: 'folder' });
		this.bindPopup(pop);
	}

	close(): void {
		this.activePopup?.remove();
		this.activePopup = null;
		if (this.boundOutside) {
			this.doc.removeEventListener('mousedown', this.boundOutside, true);
			this.boundOutside = null;
		}
	}

	destroy(): void {
		this.close();
	}

	private bindPopup(pop: HTMLElement): void {
		this.activePopup = pop;
		this.boundOutside = (e: Event) => {
			if (!pop.contains(e.target as Node)) this.close();
		};
		this.win.setTimeout(() => {
			if (this.boundOutside) this.doc.addEventListener('mousedown', this.boundOutside, true);
		}, 15);
	}
}
