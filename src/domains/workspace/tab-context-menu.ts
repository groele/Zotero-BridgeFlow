import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import { addPopupButton, addPopupSeparator, createFloatingPopup, openTextPromptModal } from './popup-menu-helpers.ts';
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
	private activePopup: HTMLElement | null = null;
	private boundOutside: ((e: Event) => void) | null = null;

	constructor(
		win: Window,
		prefs: UnifiedPrefService,
		store: WorkspaceStateStore,
		tabs: WorkspaceTabController,
		onRefresh: () => void,
	) {
		this.win = win;
		this.doc = win.document;
		this.prefs = prefs;
		this.store = store;
		this.tabs = tabs;
		this.onRefresh = onRefresh;
	}

	openTabMenu(anchor: HTMLElement, tab: TrackedTab, event?: MouseEvent): void {
		if (tab.virtual) {
			this.openVirtualMenu(anchor, tab, event);
			return;
		}
		this.close();
		const pop = createFloatingPopup(this.doc, anchor, event, 215);
		if (!pop) return;
		const close = () => this.close();

		addPopupButton(this.doc, pop, '➕ 新建分组并加入', () => {
			openTextPromptModal(this.win, '新建分组', '输入分组名称...', '新分组', (name) => {
				if (!name.trim()) return;
				const grp = this.store.createGroup(name);
				this.store.assignToGroup(tab.key, grp.id);
				this.onRefresh();
			});
		}, close);

		for (const group of this.store.state.groups) {
			const inThis = tab.groupId === group.id;
			addPopupButton(this.doc, pop, `${inThis ? '✓ ' : '   '}加入分组：${group.name}`, () => {
				this.store.assignToGroup(tab.key, group.id);
				this.onRefresh();
			}, close);
		}
		if (tab.groupId) {
			addPopupButton(this.doc, pop, '从当前分组移出', () => {
				this.store.assignToGroup(tab.key, null);
				this.onRefresh();
			}, close);
		}

		addPopupSeparator(this.doc, pop);

		if (this.prefs.get('workspace.enablePinnedTabs')) {
			addPopupButton(this.doc, pop, tab.pinned ? '📌 取消固定标签' : '📌 固定此标签', () => {
				this.store.setPinned(tab.key, !tab.pinned);
				this.onRefresh();
			}, close);
		}
		if (this.prefs.get('workspace.enableTabSleep') && !tab.pinned) {
			addPopupButton(this.doc, pop, tab.sleeping ? '⚡ 唤醒并重新加载' : '🌙 休眠释放内存', () => {
				if (tab.sleeping) void this.tabs.reloadTab(this.win, tab.tabID);
				else this.tabs.sleepTab(this.win, tab.tabID);
				this.onRefresh();
			}, close);
		}
		if (this.prefs.get('workspace.enableTabRemarks')) {
			addPopupButton(this.doc, pop, tab.remark ? '✎ 编辑标签页备注' : '✎ 添加标签页备注', () => {
				openTextPromptModal(this.win, '设置标签页备注', '输入简短备注（留空清除）...', tab.remark || '', (val) => {
					this.store.setRemark(tab.key, val);
					this.onRefresh();
				});
			}, close);
			if (tab.remark) {
				const curMode = this.store.state.remarkModes[tab.key] || '';
				for (const [m, lbl] of [['', '显示：跟随全局'], ['both', '显示：备注+标题'], ['remark', '显示：仅备注'], ['title', '显示：仅标题']] as const) {
					addPopupButton(this.doc, pop, `${curMode === m ? '✓ ' : '   '}${lbl}`, () => {
						this.store.setRemarkMode(tab.key, m);
						this.onRefresh();
					}, close);
				}
			}
		}

		addPopupSeparator(this.doc, pop);
		if (this.prefs.get('workspace.enableCopyReference')) {
			addPopupButton(this.doc, pop, '📋 复制标准引文（并记入反查）', () => {
				void this.tabs.copyTabCitation(this.win, tab.tabID);
			}, close);
		}
		if (tab.itemID > 0) {
			addPopupButton(this.doc, pop, '📚 在文献库中定位', () => {
				void this.tabs.showInLibrary(this.win, tab.itemID, false);
			}, close);
			addPopupButton(this.doc, pop, '🗂 在集合树中定位所属集合', () => {
				void this.tabs.showInLibrary(this.win, tab.itemID, true);
			}, close);
			if (this.prefs.get('workspace.enableShowInFilesystem')) {
				addPopupButton(this.doc, pop, '📂 在文件管理器中显示', () => {
					void this.tabs.revealTabAttachment(this.win, tab.itemID);
				}, close);
			}
		}
		if (this.prefs.get('workspace.enableReloadTab')) {
			addPopupButton(this.doc, pop, '🔄 重新加载此标签页', () => {
				void this.tabs.reloadTab(this.win, tab.tabID).then(() => this.onRefresh());
			}, close);
		}
		addPopupButton(this.doc, pop, '↩ 恢复最近关闭的标签页', () => {
			this.tabs.undoCloseTab(this.win);
			this.onRefresh();
		}, close);

		addPopupSeparator(this.doc, pop);
		addPopupButton(this.doc, pop, '关闭右侧标签页', () => {
			const open = this.tabs.buildTrackedTabs(this.win).filter((t) => !t.virtual);
			const idx = open.findIndex((t) => t.tabID === tab.tabID);
			if (idx >= 0) void this.tabs.closeTabs(this.win, open.slice(idx + 1).map((t) => t.tabID), { protectPinned: true });
		}, close);
		addPopupButton(this.doc, pop, '关闭其他未固定标签页', () => {
			const others = this.tabs.buildTrackedTabs(this.win).filter((t) => !t.virtual && t.tabID !== tab.tabID).map((t) => t.tabID);
			void this.tabs.closeTabs(this.win, others, { protectPinned: true });
		}, close);
		if (this.prefs.get('workspace.enableVirtualMembers') && tab.groupId) {
			addPopupButton(this.doc, pop, '关闭标签（保留在分组）', () => {
				void this.tabs.closeTabs(this.win, [tab.tabID], { preserveVirtual: true });
			}, close);
		}
		addPopupButton(this.doc, pop, '彻底关闭标签页', () => {
			void this.tabs.closeTabs(this.win, [tab.tabID], { preserveVirtual: false });
		}, close, { danger: true });

		this.bindPopup(pop);
	}

	openVirtualMenu(anchor: HTMLElement, tab: TrackedTab, event?: MouseEvent): void {
		this.close();
		const pop = createFloatingPopup(this.doc, anchor, event, 200);
		if (!pop) return;
		const close = () => this.close();

		addPopupButton(this.doc, pop, '📖 加载并打开文献', () => {
			void this.tabs.openVirtualOrItem(this.win, tab.itemID, tab.groupId).then(() => this.onRefresh());
		}, close);
		if (tab.itemID > 0) {
			addPopupButton(this.doc, pop, '📚 在文献库中定位', () => {
				void this.tabs.showInLibrary(this.win, tab.itemID, true);
			}, close);
		}
		addPopupButton(this.doc, pop, '🗑 从分组移除虚拟成员', () => {
			this.store.removeVirtualMember(tab.key);
			this.store.assignToGroup(tab.key, null);
			this.onRefresh();
		}, close, { danger: true });

		this.bindPopup(pop);
	}

	openGroupMenu(anchor: HTMLElement, group: TabGroup, event?: MouseEvent): void {
		this.close();
		const pop = createFloatingPopup(this.doc, anchor, event, 210);
		if (!pop) return;
		const close = () => this.close();
		const isCollapsed = this.store.state.collapsed.includes(group.id);

		addPopupButton(this.doc, pop, isCollapsed ? '▾ 展开此分组' : '▸ 折叠此分组', () => {
			this.store.setCollapsed(group.id, !isCollapsed);
			this.onRefresh();
		}, close);
		addPopupButton(this.doc, pop, '✎ 重命名分组', () => {
			openTextPromptModal(this.win, '重命名分组', '输入新的分组名称...', group.name, (val) => {
				if (this.store.renameGroup(group.id, val)) this.onRefresh();
			});
		}, close);

		const swatchRow = this.doc.createElement('div');
		swatchRow.className = 'zbf-color-row';
		for (const color of GROUP_PALETTE) {
			const swatch = this.doc.createElement('button');
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
		pop.appendChild(swatchRow);

		addPopupButton(this.doc, pop, '🎨 自定义十六进制颜色...', () => {
			openTextPromptModal(this.win, '自定义分组颜色', '例如 #3b82f6', group.color, (hex) => {
				if (/^#[0-9a-fA-F]{3,8}$/.test(hex.trim())) {
					this.store.setGroupColor(group.id, hex.trim());
					this.onRefresh();
				}
			});
		}, close);

		const hasVirtual = this.tabs.buildTrackedTabs(this.win).some((t) => t.virtual && t.groupId === group.id);
		if (hasVirtual) {
			addPopupButton(this.doc, pop, '📖 打开组内全部虚拟文献', () => {
				void this.tabs.openGroupVirtuals(this.win, group.id).then(() => this.onRefresh());
			}, close);
		}

		addPopupSeparator(this.doc, pop);
		addPopupButton(this.doc, pop, '折叠其他分组', () => {
			this.store.collapseOtherGroups(group.id);
			this.onRefresh();
		}, close);
		if (this.prefs.get('workspace.enableSessions')) {
			addPopupButton(this.doc, pop, '📦 归档为快照并关闭组内标签', () => {
				void this.tabs.archiveAndCloseGroup(this.win, group.id).then(() => this.onRefresh());
			}, close);
		}
		addPopupButton(this.doc, pop, '仅保留本组（关闭其他标签）', () => {
			const ids = this.tabs.buildTrackedTabs(this.win).filter((t) => !t.virtual && t.groupId !== group.id).map((t) => t.tabID);
			void this.tabs.closeTabs(this.win, ids, { preserveVirtual: true, protectPinned: true }).then(() => this.onRefresh());
		}, close);
		addPopupButton(this.doc, pop, '关闭组内所有已开标签', () => {
			const ids = this.tabs.buildTrackedTabs(this.win).filter((t) => !t.virtual && t.groupId === group.id).map((t) => t.tabID);
			void this.tabs.closeTabs(this.win, ids, { preserveVirtual: true, protectPinned: true }).then(() => this.onRefresh());
		}, close);
		addPopupButton(this.doc, pop, '解散分组（保留已打开标签）', () => {
			this.store.removeGroup(group.id);
			this.onRefresh();
		}, close, { danger: true });

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
