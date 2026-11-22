import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import type { CitationBadgeInfo, Disposable, SpotlightItemResult, SpotlightProvider } from '../../kernel/types.ts';
import { SpotlightLibraryIndex } from './spotlight-library.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import type { WorkspaceTabController } from './tab-controller.ts';

interface ScoredResult {
	score: number;
	item: SpotlightItemResult;
}

export class WorkspaceSpotlightEngine {
	private readonly providers = new Set<SpotlightProvider>();
	private readonly prefs: UnifiedPrefService;
	private readonly store: WorkspaceStateStore;
	private readonly tabs: WorkspaceTabController;
	private readonly libraryIndex: SpotlightLibraryIndex;
	private wordCitedBadges = new Map<number, CitationBadgeInfo>();

	constructor(prefs: UnifiedPrefService, store: WorkspaceStateStore, tabs: WorkspaceTabController) {
		this.prefs = prefs;
		this.store = store;
		this.tabs = tabs;
		this.libraryIndex = new SpotlightLibraryIndex(tabs);
	}

	invalidateLibraryIndex(): void {
		this.libraryIndex.invalidate();
	}

	setWordCitationBadges(badges: ReadonlyMap<number, CitationBadgeInfo>): void {
		this.wordCitedBadges = new Map(badges);
	}

	registerProvider(provider: SpotlightProvider): Disposable {
		this.providers.add(provider);
		return () => {
			this.providers.delete(provider);
		};
	}

	query(rawTerm: string, win: Window): SpotlightItemResult[] {
		const trimmed = rawTerm.trim();
		const isCommand = trimmed.startsWith('>');
		const isLibrary = trimmed.startsWith('@');
		const needle = (isCommand || isLibrary ? trimmed.slice(1) : trimmed).trim().toLowerCase();
		const scored: ScoredResult[] = [];
		const tracked = this.tabs.buildTrackedTabs(win);

		if (isCommand) {
			if (needle === 'tabs' || needle === 'recent') {
				const sorted = [...tracked].sort((a, b) => (b.lastViewedAt || 0) - (a.lastViewedAt || 0));
				for (const tab of sorted) {
					const groupName = this.store.state.groups.find((g) => g.id === tab.groupId)?.name;
					scored.push({
						score: 100,
						item: {
							id: `recent:${tab.key}`,
							category: 'tab',
							title: this.tabs.getDisplayTitle(tab),
							subtitle: [groupName, tab.creatorYear].filter(Boolean).join(' · '),
							badge: tab.virtual ? '虚拟' : tab.sleeping ? '休眠' : '最近',
							action: () => {
								if (tab.virtual) void this.tabs.openVirtualOrItem(win, tab.itemID, tab.groupId);
								else this.tabs.selectTab(win, tab.tabID);
							},
						},
					});
				}
			}
			for (const cmd of this.buildBuiltInCommands(win)) {
				if (!needle || needle === 'tabs' || `${cmd.title} ${cmd.subtitle || ''}`.toLowerCase().includes(needle)) {
					scored.push({ score: 90, item: cmd });
				}
			}
		}

		for (const provider of [...this.providers].sort((a, b) => b.priority - a.priority)) {
			try {
				for (const item of provider.query(needle, win)) {
					scored.push({ score: 80 + (provider.priority || 0) * 0.1, item });
				}
			} catch { /* isolate provider failures */ }
		}

		if (isLibrary) {
			const openIDs = new Set<number>();
			for (const libItem of this.libraryIndex.query(needle, win, openIDs, 20, 1)) {
				scored.push({ score: 95, item: libItem });
			}
		} else if (!isCommand) {
			for (const group of this.store.state.groups) {
				if (!needle || group.name.toLowerCase().includes(needle)) {
					const firstOpen = tracked.find((t) => t.groupId === group.id && !t.virtual);
					scored.push({
						score: needle ? 85 : 58,
						item: {
							id: `group:${group.id}`,
							category: 'collection',
							title: `分组：${group.name}`,
							subtitle: `${group.memberKeys.length} 个成员${firstOpen ? ' · 点击定位首篇文献' : ''}`,
							badge: '分组',
							action: () => {
								this.store.setCollapsed(group.id, false);
								if (firstOpen) this.tabs.selectTab(win, firstOpen.tabID);
							},
						},
					});
				}
			}

			for (const tab of tracked) {
				const groupName = this.store.state.groups.find((g) => g.id === tab.groupId)?.name || '';
				const displayTitle = this.tabs.getDisplayTitle(tab);
				const hay = `${displayTitle} ${tab.title} ${tab.shortTitle} ${tab.creatorYear} ${tab.source} ${tab.collection} ${tab.remark} ${groupName}`.toLowerCase();
				if (needle && !hay.includes(needle)) continue;

				const citeInfo = this.wordCitedBadges.get(tab.parentItemID) || this.wordCitedBadges.get(tab.itemID);
				const tags: string[] = [];
				if (groupName) tags.push(groupName);
				if (tab.pinned) tags.push('已固定');
				if (tab.sleeping) tags.push('已休眠');
				if (tab.virtual) tags.push('虚拟');
				if (citeInfo) tags.push(`Word [${citeInfo.ordinal}]`);

				scored.push({
					score: displayTitle.toLowerCase().startsWith(needle) ? 95 : 75,
					item: {
						id: `tab:${tab.key}`,
						category: 'tab',
						title: displayTitle,
						subtitle: [tab.creatorYear, tab.collection].filter(Boolean).join(' · ') || '已打开阅读标签页',
						badge: tags.join(' · ') || undefined,
						action: () => {
							if (tab.virtual) void this.tabs.openVirtualOrItem(win, tab.itemID, tab.groupId);
							else this.tabs.selectTab(win, tab.tabID);
						},
					},
				});
			}

			for (const closed of this.tabs.getRecentlyClosed(win)) {
				if (needle && !closed.title.toLowerCase().includes(needle)) continue;
				scored.push({
					score: 62,
					item: {
						id: `closed:${closed.key}`,
						category: 'tab',
						title: closed.title,
						subtitle: '重新打开最近关闭的文献标签页',
						badge: '最近关闭',
						action: () => {
							void this.tabs.openVirtualOrItem(win, closed.itemID, closed.groupId || undefined);
						},
					},
				});
			}

			if (this.prefs.get('workspace.enableSessions')) {
				for (const ses of this.store.state.sessions.slice(0, 6)) {
					if (needle && !ses.name.toLowerCase().includes(needle)) continue;
					scored.push({
						score: 52,
						item: {
							id: `session:${ses.id}`,
							category: 'collection',
							title: `工作区：${ses.name}`,
							subtitle: `${ses.groups.length} 个分组 · 点击合并恢复此工作区`,
							badge: ses.isTemplate ? '模板' : '会话',
							action: () => {
								void this.tabs.restoreSession(win, ses, true);
							},
						},
					});
				}
			}

			if (needle.length >= 2) {
				const openIDs = new Set<number>();
				for (const t of tracked) {
					if (t.itemID > 0) openIDs.add(t.itemID);
					if (t.parentItemID > 0) openIDs.add(t.parentItemID);
				}
				for (const libItem of this.libraryIndex.query(needle, win, openIDs, 15, 2)) {
					scored.push({ score: 45, item: libItem });
				}
			}
		}

		return scored.sort((a, b) => b.score - a.score).slice(0, 40).map((s) => s.item);
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
				action: () => { this.store.saveSession(`快照 ${new Date().toLocaleTimeString()}`); },
			},
			{
				id: 'cmd:undo-close',
				category: 'command',
				title: '> 恢复最近关闭的标签页',
				subtitle: '重新打开刚才关闭的文献阅读器',
				badge: '命令',
				action: () => { this.tabs.undoCloseTab(win); },
			},
		];
	}
}
