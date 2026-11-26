import type { CommandRegistry } from '../../../kernel/command-registry.ts';
import type { UnifiedPrefService } from '../../../kernel/pref-service.ts';
import type { Disposable, SpotlightItemResult, SpotlightProvider } from '../../../kernel/types.ts';
import { stripItemTitleMarkup } from '../../../services/item-resolution.ts';
import type { WorkspaceStateStore } from '../store/state-store.ts';
import type { WorkspaceTabController } from '../tabs/tab-controller.ts';

export class WorkspaceSpotlightEngine {
	private readonly providers = new Set<SpotlightProvider>();
	private readonly prefs: UnifiedPrefService;
	private readonly store: WorkspaceStateStore;
	private readonly tabs: WorkspaceTabController;
	private readonly commands?: CommandRegistry;
	constructor(prefs: UnifiedPrefService, store: WorkspaceStateStore, tabs: WorkspaceTabController, commands?: CommandRegistry) {
		this.prefs = prefs;
		this.store = store;
		this.tabs = tabs;
		this.commands = commands;
	}

	registerProvider(provider: SpotlightProvider): Disposable {
		this.providers.add(provider);
		return () => {
			this.providers.delete(provider);
		};
	}

	query(rawTerm: string, win: Window): SpotlightItemResult[] {
		const rawMax = this.prefs.get('workspace.spotlightMaxResults');
		const maxRes = typeof rawMax === 'number' && Number.isFinite(rawMax) ? Math.max(10, Math.min(100, rawMax)) : 40;
		const term = rawTerm.trim().toLowerCase();
		if (term.startsWith('>') && term !== '>tabs' && term !== '>recent') {
			const command = term.slice(1).trim();
			const results = this.filterBuiltInCommands(command, win);
			const seen = new Set(results.map((r) => r.id));
			for (const hit of this.commands?.query(command, win) ?? []) {
				if (seen.has(hit.id)) continue;
				seen.add(hit.id);
				results.push(hit);
			}
			for (const provider of this.providers) {
				try {
					for (const hit of provider.query(command, win, 'commands')) {
						if (hit.category !== 'command' || seen.has(hit.id)) continue;
						seen.add(hit.id);
						results.push(hit);
					}
				} catch { /* isolate providers */ }
			}
			return results.slice(0, maxRes);
		}

		const tabList = term === '>tabs' || term === '>recent';
		const needle = tabList ? '' : term;
		const results: SpotlightItemResult[] = [];
		const limit = term ? maxRes : Math.min(12, maxRes);
		if (term === '>recent') {
			for (const rec of this.tabs.getRecentlyClosed(win)) {
				results.push({
					id: 'closed:' + rec.key,
					category: 'tab',
					title: stripItemTitleMarkup(rec.title) || rec.key,
					badge: '已关闭',
					action: () => { void this.tabs.openVirtualOrItem(win, rec.itemID, rec.groupId || undefined, false); },
				});
				if (results.length === limit) return results;
			}
		}
		// Read titles already shown by the host. Projecting full workspace tabs also
		// visits virtual members and fetches library metadata for each window.
		const nativeTabs: { id: string; type: string; title?: string; data?: { itemID?: number } }[] =
			(win as any).Zotero_Tabs?._tabs || [];
		const viewedAt = (tab: (typeof nativeTabs)[number]) => this.store.state.lastViewedAt?.[
			tab.data?.itemID ? 'item:' + tab.data.itemID : 'tab:' + tab.id] || 0;
		const source = tabList ? [...nativeTabs].sort((a, b) => viewedAt(b) - viewedAt(a)) : nativeTabs;
		for (const tab of source) {
			if (tab.type === 'library') continue;
			const key = tab.data?.itemID ? 'item:' + tab.data.itemID : 'tab:' + tab.id;
			const title = stripItemTitleMarkup(tab.title || '') || key;
			const remark = this.prefs.get('workspace.enableTabRemarks')
				? (tab.data?.itemID ? this.store.getItemRemark(tab.data.itemID) : this.store.state.remarks?.[key] || '')
				: '';
			const vm = needle ? this.store.state.virtualMembers?.[key] : undefined;
			const hay = `${title} ${remark} ${vm?.creatorYear || ''} ${vm?.shortTitle || ''} ${vm?.collection || ''}`;
			if (needle && !hay.toLowerCase().includes(needle)) continue;
			results.push({ id: 'tab:' + key, category: 'tab', title, subtitle: remark || vm?.creatorYear || '',
				action: () => { this.tabs.selectTab(win, tab.id); } });
			if (results.length === limit) return results;
		}
		if (!needle) return results;
		if (this.prefs.get('workspace.enableVirtualMembers') && this.store.state.groups?.length && this.store.state.virtualMembers) {
			const liveKeys = new Set<string>();
			for (const tab of nativeTabs) {
				if (tab.type !== 'library') liveKeys.add(tab.data?.itemID ? 'item:' + tab.data.itemID : 'tab:' + tab.id);
			}
			for (const group of this.store.state.groups) {
				for (const key of group.memberKeys || []) {
					if (liveKeys.has(key) || !key.startsWith('item:')) continue;
					const vm = this.store.state.virtualMembers[key];
					if (!vm) continue;
					const vTitle = stripItemTitleMarkup(vm.title) || key;
					const remark = this.prefs.get('workspace.enableTabRemarks') ? (this.store.state.remarks?.[key] || '') : '';
					const vHay = `${vTitle} ${vm.shortTitle || ''} ${vm.creatorYear || ''} ${vm.collection || ''} ${remark}`.toLowerCase();
					if (!vHay.includes(needle)) continue;
					results.push({ id: 'vtab:' + key, category: 'tab', title: vTitle, subtitle: remark || vm.creatorYear || group.name,
						badge: '虚拟保留', action: () => { void this.tabs.openVirtualOrItem(win, vm.itemID, group.id, false); } });
					if (results.length === limit) return results;
				}
			}
		}
		for (const group of this.store.state.groups) {
			if (!group.name.toLowerCase().includes(needle)) continue;
			results.push({ id: 'group:' + group.id, category: 'collection', title: group.name, badge: '分组',
				action: () => {
					this.store.setCollapsed(group.id, false);
					const first = this.tabs.buildTrackedTabs(win).find(tab => !tab.virtual && tab.groupId === group.id);
					if (first) this.tabs.selectTab(win, first.tabID);
				} });
			if (results.length === limit) return results;
		}
		if (this.prefs.get('workspace.enableSessions')) {
			for (const session of this.store.state.sessions) {
				if (session.isTemplate || !session.name.toLowerCase().includes(needle)) continue;
				results.push({ id: 'session:' + session.id, category: 'collection', title: session.name, badge: '工作区',
					action: () => { void this.tabs.restoreSession(win, session, true); } });
				if (results.length === limit) return results;
			}
		}
		if (needle.length >= 2 && !needle.startsWith('@')) {
			for (const provider of this.providers) {
				try {
					for (const hit of provider.query(needle, win)) {
						results.push(hit);
						if (results.length === limit) return results;
					}
				} catch { /* isolate providers */ }
			}
			if (this.prefs.get('workspace.spotlightIncludeCommands')) {
				const seen = new Set(results.map((r) => r.id));
				for (const cmd of this.filterBuiltInCommands(needle, win)) {
					if (seen.has(cmd.id)) continue;
					seen.add(cmd.id);
					results.push(cmd);
					if (results.length === limit) break;
				}
				if (results.length < limit) {
					for (const cmd of this.commands?.query(needle, win) ?? []) {
						if (seen.has(cmd.id)) continue;
						seen.add(cmd.id);
						results.push(cmd);
						if (results.length === limit) break;
					}
				}
			}
		}
		return results;
	}

	private filterBuiltInCommands(command: string, win: Window): SpotlightItemResult[] {
		return this.buildBuiltInCommands(win).filter((item) =>
			(item.title + ' ' + item.subtitle).toLowerCase().includes(command));
	}

	private buildBuiltInCommands(win: Window): SpotlightItemResult[] {
		return [
			{
				id: 'cmd:auto-group',
				category: 'command',
				title: '> 按集合自动分组当前标签页',
				subtitle: '为未分组的阅读标签页按所属 Zotero 集合归组',
				badge: '命令',
				action: () => { this.tabs.autoGroupByCollection(win); },
			},
			{
				id: 'cmd:pub-group',
				category: 'command',
				title: '> 按期刊 / 会议自动归组同期刊文献',
				subtitle: '将同源期刊/会议（>=2篇）的未分组标签自动归组',
				badge: '命令',
				action: () => {
					for (const sug of this.tabs.getPublicationSuggestions(win)) {
						const grp = this.store.state.groups.find((g) => g.name === sug.venue) ?? this.store.createGroup(sug.venue);
						for (const k of sug.keys) this.store.assignToGroup(k, grp.id);
					}
				},
			},
			{
				id: 'cmd:sleep-inactive',
				category: 'command',
				title: '> 休眠所有非活动标签页',
				subtitle: '卸载后台未固定的阅读器以释放内存',
				badge: '命令',
				action: () => { this.tabs.sleepInactiveTabs(win); },
			},
			{
				id: 'cmd:toggle-sidebar',
				category: 'command',
				title: '> 切换左侧竖版工作区侧栏',
				subtitle: '展开或收起 Zotero 左侧文献工作区面板',
				badge: '命令',
				action: () => {
					const cur = this.prefs.get('workspace.enableVerticalSidebar') && !this.prefs.get('workspace.verticalSidebarCollapsed');
					if (!this.prefs.get('workspace.enableVerticalSidebar')) {
						this.prefs.set('workspace.enableVerticalSidebar', true);
						this.prefs.set('workspace.verticalSidebarCollapsed', false);
					} else {
						this.prefs.set('workspace.verticalSidebarCollapsed', cur);
					}
				},
			},
			{
				id: 'cmd:toggle-compact-topbar',
				category: 'command',
				title: '> 切换顶部横栏精简模式',
				subtitle: '在完整横向分栏与精简标签栏间切换',
				badge: '命令',
				action: () => { this.prefs.set('workspace.compactTopBar', !this.prefs.get('workspace.compactTopBar')); },
			},
			{
				id: 'cmd:save-snapshot',
				category: 'command',
				title: '> 保存当前工作区快照',
				subtitle: '保存当前所有分组、固定标签与备注配置',
				badge: '命令',
				action: () => { this.store.saveSession(`快照 ${new Date().toLocaleTimeString()}`, { openKeys: this.tabs.openKeys(win) }); },
			},
			{
				id: 'cmd:copy-active-citation',
				category: 'command',
				title: '> 复制当前阅读文献的标准引文',
				subtitle: '复制当前标签页文献的 CSL 引文并自动记入反查历史',
				badge: '命令',
				action: () => {
					const selID = String((win as any).Zotero_Tabs?.selectedID || '');
					if (selID) void this.tabs.copyTabCitation(win, selID);
				},
			},
			{
				id: 'cmd:undo-close',
				category: 'command',
				title: '> 恢复最近关闭的标签页',
				subtitle: '重新打开刚才关闭的文献阅读器',
				badge: '命令',
				action: () => { this.tabs.undoCloseTab(win); },
			},
			...(this.prefs.get('workspace.enableAnnotationMatrix') ? [{
				id: 'cmd:open-annotation-matrix',
				category: 'command' as const,
				title: '> 生成已开文献对比矩阵',
				subtitle: '按标注颜色维度汇总当前打开文献的批注，支持导出与插入 Word',
				badge: '矩阵',
				action: () => { this.tabs.openGroupAnnotationMatrix(win); },
			}] : []),
		];
	}
}
