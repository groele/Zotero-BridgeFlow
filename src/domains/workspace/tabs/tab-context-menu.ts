import type { UnifiedPrefService } from '../../../kernel/pref-service.ts';
import type { WorkspaceHoverCard } from '../sidebar/hover-card.ts';
import { openTextPromptModal } from './popup-menu-helpers.ts';
import type { WorkspaceStateStore } from '../store/state-store.ts';
import type { WorkspaceTabController } from './tab-controller.ts';
import type { TabGroup, TrackedTab } from '../types.ts';
import { openContextMenu, type ActiveMenuHandle } from './xul-menu-helpers.ts';

export class WorkspaceTabContextMenu {
	private readonly win: Window;
	private readonly prefs: UnifiedPrefService;
	private readonly store: WorkspaceStateStore;
	private readonly tabs: WorkspaceTabController;
	private readonly onRefresh: () => void;
	private readonly hoverCard?: WorkspaceHoverCard | null;
	private activeMenu: ActiveMenuHandle | null = null;

	constructor(
		win: Window,
		prefs: UnifiedPrefService,
		store: WorkspaceStateStore,
		tabs: WorkspaceTabController,
		onRefresh: () => void,
		hoverCard?: WorkspaceHoverCard | null,
	) {
		this.win = win;
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
		this.activeMenu = openContextMenu(this.win, anchor, event, 232, (menu) => {
			if (this.prefs.get('workspace.enablePinnedTabs')) {
				menu.addItem(tab.pinned ? '取消固定标签' : '固定标签（防误关）', () => {
					this.store.setPinned(tab.key, !tab.pinned);
					this.onRefresh();
				}, { icon: 'pin' });
			}
			if (this.prefs.get('workspace.enableTabRemarks')) {
				menu.addItem(tab.remark ? '编辑标签备注…' : '设置标签备注…', () => {
					openTextPromptModal(this.win, '设置标签备注', '输入备注（≤300 字，留空清除）：', tab.remark || '', (val) => {
						this.store.setRemark(tab.key, val);
						this.onRefresh();
					}, anchor);
				}, { icon: 'edit' });
				if (tab.remark) {
					menu.addSubmenu('标签显示模式', 'eye', (sub) => {
						const curMode = this.store.state.remarkModes[tab.key] || '';
						for (const [m, lbl] of [['', '跟随全局设置'], ['both', '备注 + 原标题'], ['remark', '仅显示备注'], ['title', '仅显示原标题']] as const) {
							sub.addItem(lbl, () => {
								this.store.setRemarkMode(tab.key, m);
								this.onRefresh();
							}, { checked: curMode === m });
						}
					});
				}
			}
			if (this.prefs.get('workspace.enableTabSleep') && !tab.pinned) {
				menu.addItem(tab.sleeping ? '唤醒标签页' : '休眠标签（释放内存）', () => {
					if (tab.sleeping) void this.tabs.reloadTab(this.win, tab.tabID);
					else this.tabs.sleepTab(this.win, tab.tabID);
					this.onRefresh();
				}, { icon: 'sleep' });
			}

			menu.addSeparator();

			menu.addSubmenu('加入分组', 'folder', (sub) => {
				for (const group of this.store.state.groups) {
					const inThis = tab.groupId === group.id;
					sub.addItem(group.name, () => {
						this.store.assignToGroup(tab.key, group.id);
						this.onRefresh();
					}, { checked: inThis });
				}
				sub.addItem('新建分组并加入…', () => {
					openTextPromptModal(this.win, '新建分组', '输入分组名称...', '新分组', (name) => {
						if (!name.trim()) return;
						const grp = this.store.createGroup(name);
						this.store.assignToGroup(tab.key, grp.id);
						this.onRefresh();
					}, anchor);
				}, { icon: 'plus' });
				if (tab.groupId) {
					sub.addItem('移出当前分组', () => {
						this.store.assignToGroup(tab.key, null);
						this.onRefresh();
					}, { icon: 'close' });
				}
			});

			menu.addSeparator();

			if (tab.itemID > 0) {
				menu.addItem('在文献库中定位', () => {
					void this.tabs.showInLibrary(this.win, tab.itemID, false);
				}, { icon: 'locate' });
				menu.addItem('在集合树中定位所属集合', () => {
					void this.tabs.showInLibrary(this.win, tab.itemID, true);
				}, { icon: 'layers' });
			}
			if (this.prefs.get('workspace.enableCopyReference')) {
				menu.addItem('复制引用到剪贴板', () => {
					void this.tabs.copyTabCitation(this.win, tab.tabID);
				}, { icon: 'copy' });
			}
			if (tab.itemID > 0 && this.prefs.get('modules.wordCite.enable') && this.prefs.get('wordCite.tabContextMenu.enable')) {
				menu.addItem('插入引文到 Word 光标处', () => {
					this.tabs.citeItemsInWord(this.win, [tab.parentItemID || tab.itemID]);
				}, { icon: 'word' });
			}
			if (tab.itemID > 0 && this.prefs.get('workspace.enableShowInFilesystem')) {
				menu.addItem('在文件管理器中显示', () => {
					void this.tabs.revealTabAttachment(this.win, tab.itemID);
				}, { icon: 'folder' });
			}
			if (this.prefs.get('workspace.enableReloadTab')) {
				menu.addItem('重新加载标签页', () => {
					void this.tabs.reloadTab(this.win, tab.tabID).then(() => this.onRefresh());
				}, { icon: 'refresh' });
			}

			menu.addSeparator();

			if (this.prefs.get('workspace.enableVirtualMembers') && tab.groupId) {
				menu.addItem('关闭标签（保留在分组）', () => {
					void this.tabs.closeTabs(this.win, [tab.tabID], { preserveVirtual: true });
				}, { icon: 'virtual' });
			}
			menu.addItem('彻底关闭标签页', () => {
				void this.tabs.closeTabs(this.win, [tab.tabID], { preserveVirtual: false });
			}, { icon: 'close', danger: true });
			menu.addItem('恢复最近关闭的标签页', () => {
				this.tabs.undoCloseTab(this.win);
				this.onRefresh();
			}, { icon: 'undo' });
		});
	}

	openVirtualMenu(anchor: HTMLElement, tab: TrackedTab, event?: MouseEvent): void {
		this.hoverCard?.hide();
		this.close();
		this.activeMenu = openContextMenu(this.win, anchor, event, 215, (menu) => {
			menu.addItem('加载并打开文献', () => {
				void this.tabs.openVirtualOrItem(this.win, tab.itemID, tab.groupId).then(() => this.onRefresh());
			}, { icon: 'play' });
			if (tab.itemID > 0) {
				menu.addItem('在文献库中定位', () => {
					void this.tabs.showInLibrary(this.win, tab.itemID, true);
				}, { icon: 'locate' });
				if (this.prefs.get('modules.wordCite.enable') && this.prefs.get('wordCite.tabContextMenu.enable')) {
					menu.addItem('插入引文到 Word 光标处', () => {
						this.tabs.citeItemsInWord(this.win, [tab.parentItemID || tab.itemID]);
					}, { icon: 'word' });
				}
			}
			menu.addSeparator();
			menu.addItem('从分组移除虚拟成员', () => {
				this.store.removeVirtualMember(tab.key);
				this.store.assignToGroup(tab.key, null);
				this.onRefresh();
			}, { icon: 'trash', danger: true });
		});
	}

	openGroupMenu(anchor: HTMLElement, group: TabGroup, event?: MouseEvent): void {
		this.hoverCard?.hide();
		this.close();
		this.activeMenu = openContextMenu(this.win, anchor, event, 236, (menu) => {
			menu.addItem('重命名分组…', () => {
				openTextPromptModal(this.win, '重命名分组', '分组名称：', group.name, (val) => {
					if (this.store.renameGroup(group.id, val)) this.onRefresh();
				}, anchor);
			}, { icon: 'edit' });

			menu.addSubmenu('分组颜色', 'palette', (sub) => {
				sub.addColorPicker?.(
					group.color,
					(hex) => {
						this.store.setGroupColor(group.id, hex);
						this.onRefresh();
					},
					() => {
						openTextPromptModal(this.win, '自定义颜色', '输入 3 位或 6 位 Hex 颜色（如 #3b82f6）：', group.color, (hex) => {
							if (/^#[0-9a-fA-F]{3,8}$/.test(hex.trim())) {
								this.store.setGroupColor(group.id, hex.trim());
								this.onRefresh();
							}
						}, anchor);
					},
				);
			}, group.color);

			menu.addSeparator();

			if (this.prefs.get('workspace.enableSessions')) {
				menu.addItem('保存到工作区并关闭…', () => {
					void this.tabs.archiveAndCloseGroup(this.win, group.id).then(() => this.onRefresh());
				}, { icon: 'archive' });
				menu.addItem('保存分组快照（保留标签）', () => {
					this.tabs.saveGroupSnapshot(this.win, group.id);
					this.onRefresh();
				}, { icon: 'save' });
			}
			if (this.prefs.get('workspace.enableAnnotationMatrix')) {
				menu.addItem('生成本组文献对比矩阵…', () => {
					this.tabs.openGroupAnnotationMatrix(this.win, group.id);
				}, { icon: 'layers' });
			}

			menu.addItem('折叠其他分组', () => {
				this.store.collapseOtherGroups(group.id);
				this.onRefresh();
			}, { icon: 'collapse', disabled: this.store.state.groups.length <= 1 });

			const virtualCount = this.tabs.buildTrackedTabs(this.win).filter((t) => t.virtual && t.groupId === group.id).length;
			if (virtualCount > 0) {
				menu.addItem('打开组内全部虚拟文献', () => {
					void this.tabs.openGroupVirtuals(this.win, group.id).then(() => this.onRefresh());
				}, { icon: 'play', badge: String(virtualCount) });
			}

			if (this.prefs.get('modules.wordCite.enable') && this.prefs.get('wordCite.tabContextMenu.enable')) {
				const groupItemIDs = [...new Set(
					this.tabs.buildTrackedTabs(this.win)
						.filter((t) => t.groupId === group.id && (t.parentItemID > 0 || t.itemID > 0))
						.map((t) => t.parentItemID || t.itemID),
				)];
				if (groupItemIDs.length > 0) {
					menu.addItem('插入本组引文到 Word', () => {
						this.tabs.citeItemsInWord(this.win, groupItemIDs);
					}, { icon: 'word', badge: String(groupItemIDs.length) });
				}
			}

			menu.addSeparator();

			menu.addItem('仅打开本组（关闭其他标签）', () => {
				const ids = this.tabs.buildTrackedTabs(this.win).filter((t) => !t.virtual && t.groupId !== group.id).map((t) => t.tabID);
				void this.tabs.closeTabs(this.win, ids, { preserveVirtual: true, protectPinned: true }).then(() => this.onRefresh());
			}, { icon: 'layers' });

			menu.addItem('关闭组内所有已开标签', () => {
				const ids = this.tabs.buildTrackedTabs(this.win).filter((t) => !t.virtual && t.groupId === group.id).map((t) => t.tabID);
				void this.tabs.closeTabs(this.win, ids, { preserveVirtual: true, protectPinned: true }).then(() => this.onRefresh());
			}, { icon: 'close' });

			menu.addItem('解散此分组', () => {
				this.store.removeGroup(group.id);
				this.onRefresh();
			}, { icon: 'trash', danger: true });
		});
	}

	openAddGroupMenu(anchor: HTMLElement, event?: MouseEvent): void {
		this.hoverCard?.hide();
		this.close();
		this.activeMenu = openContextMenu(this.win, anchor, event, 224, (menu) => {
			menu.addItem('新建空白分组…', () => {
				openTextPromptModal(this.win, '新建分组', '输入分组名称...', '新分组', (name) => {
					if (!name.trim()) return;
					this.store.createGroup(name);
					this.onRefresh();
				}, anchor);
			}, { icon: 'plus' });
			menu.addItem('按当前 Zotero 集合自动分组', () => {
				this.tabs.autoGroupByCollection(this.win);
				this.onRefresh();
			}, { icon: 'folder' });
		});
	}

	close(): void {
		this.activeMenu?.close();
		this.activeMenu = null;
	}

	destroy(): void {
		this.close();
	}
}
