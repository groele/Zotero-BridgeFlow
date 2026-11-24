import type { WordCiteDomainModule } from '../domains/word-cite/module.ts';
import type { WorkspaceDomainModule } from '../domains/workspace/module.ts';
import { DisposableStack } from '../kernel/disposable.ts';
import type { PluginKernel } from '../kernel/plugin-kernel.ts';
import type { BridgeModule, SpotlightItemResult } from '../kernel/types.ts';

/**
 * Bridge 3: Cross-Domain Spotlight Command Hub.
 * Injects active Word cited items, one-click "Group Active Word Citations",
 * and cache management commands into Workspace Spotlight (Ctrl+P / Cmd+P).
 */
export class SpotlightFusionBridge implements BridgeModule {
	public readonly id = 'spotlight-fusion-bridge';
	private readonly disposables = new DisposableStack();

	private readonly kernel: PluginKernel;
	private readonly workspace: WorkspaceDomainModule;
	private readonly wordCite: WordCiteDomainModule;

	constructor(kernel: PluginKernel, workspace: WorkspaceDomainModule, wordCite: WordCiteDomainModule) {
		this.kernel = kernel;
		this.workspace = workspace;
		this.wordCite = wordCite;
	}

	start(): void {
		this.disposables.reset();
		this.disposables.add(
			this.workspace.registerSpotlightProvider({
				id: 'bridgeflow-cross-domain',
				priority: 80,
				query: (term: string, win: Window): readonly SpotlightItemResult[] => {
					if (!this.kernel.prefs.get('fusion.spotlightCrossDomain')) return [];
					const out: SpotlightItemResult[] = [];
					const active = this.wordCite.tracker.getActiveSession();

					for (const ses of this.wordCite.tracker.getAllSessions()) {
						if (!ses.orphans.length) continue;
						const ordPreview = ses.orphans.slice(0, 4).map((o) => `[${o.ordinal}]`).join(' ') + (ses.orphans.length > 4 ? '…' : '');
						const recoverTitle = `> ⚠ 一键找回并重连缺失引文：${ses.displayName} (${ses.orphans.length} 篇)`;
						if (!term || recoverTitle.toLowerCase().includes(term) || 'recover orphan word 找回 恢复 缺失 断链 重连'.includes(term)) {
							out.push({
								id: `cmd:recover-word-orphans:${ses.sessionID}`,
								category: 'command',
								title: recoverTitle,
								subtitle: `单事务找回 ${ordPreview} 至 Zotero 并通过官方 dc:replaces 自动重连 Word`,
								badge: '修复',
								action: () => {
									this.kernel.bus.emit('word:recover-orphans-request', {
										sessionID: ses.sessionID,
										source: 'spotlight',
										win,
									});
								},
							});
						}
					}

					if (active) {
						// 1. One-click command to group open tabs cited in the active Word document
						const groupCmdTitle = `> 将当前 Word 引用文献归入工作区分组：${active.displayName}`;
						if (!term || groupCmdTitle.toLowerCase().includes(term) || 'word'.includes(term) || 'group'.includes(term)) {
							out.push({
								id: `cmd:group-word:${active.sessionID}`,
								category: 'command',
								title: groupCmdTitle,
								subtitle: `共 ${active.itemCitations.size} 篇已引用文献`,
								badge: 'WORD',
								action: () => {
									this.workspace.groupOpenTabsByItemIDs(
										active.displayName,
										[...active.itemCitations.keys()],
										win,
									);
								},
							});
						}

						// 2. Open Annotation Comparison Matrix sorted by active Word document citations
						if (active.itemCitations.size > 0 && this.kernel.prefs.get('modules.visualNotes.enable') && this.kernel.prefs.get('workspace.enableAnnotationMatrix')) {
							const matrixTitle = `> 为当前 Word 已引文献生成批注对比矩阵：${active.displayName}`;
							if (!term || matrixTitle.toLowerCase().includes(term) || 'word'.includes(term) || 'matrix'.includes(term) || '矩阵'.includes(term)) {
								out.push({
									id: `cmd:matrix-word:${active.sessionID}`,
									category: 'command',
									title: matrixTitle,
									subtitle: `汇总「${active.displayName}」正文中已引 ${active.itemCitations.size} 篇文献的颜色批注`,
									badge: '矩阵',
									action: () => {
										this.kernel.bus.emit('visual-notes:open-matrix', {
											win,
											title: `Word 已引：${active.displayName}`,
											itemIDs: [...active.itemCitations.keys()],
										});
									},
								});
							}
						}
					}

					// 3. One-click insert current selected paper into active Word cursor
					if (this.wordCite.isActive()) {
						const insertLabel = '插入当前文献到 Word 光标处';
						if (!term || insertLabel.toLowerCase().includes(term) || 'word'.includes(term) || 'cite'.includes(term)) {
							out.push({
								id: 'cmd:cite-selected-word',
								category: 'command',
								title: insertLabel,
								subtitle: '在当前 Word 光标处生成原生 Zotero 可编辑引文域',
								badge: 'Word',
								action: async () => {
									await this.wordCite.citeCurrentSelection(win);
								},
							});
						}
					}

					// 4. Visual Notes Gallery / Kanban & Collection Notes Hub quick commands
					if (this.kernel.prefs.get('modules.visualNotes.enable')) {
						if (this.kernel.prefs.get('visualNotes.gallery.enable') && (!term || 'gallery kanban board 画廊 看板 卡片'.includes(term))) {
							out.push({
								id: 'cmd:toggle-gallery-board',
								category: 'command',
								title: '> 切换文献画廊 / 多维看板视图',
								subtitle: '在主文献列表与卡片画廊、状态/星级拖拽看板间切换',
								badge: '画廊',
								action: () => {
									this.kernel.bus.emit('visual-notes:toggle-gallery', { win });
								},
							});
						}
						if (this.kernel.prefs.get('visualNotes.collectionHub.enable') && (!term || 'notes hub annotations 笔记 标注 汇总 简记'.includes(term))) {
							out.push({
								id: 'cmd:open-collection-hub',
								category: 'command',
								title: '> 打开当前分类集中笔记与标注管理中心',
								subtitle: '集中浏览与筛选分类下全部文献的 PDF 批注、独立子笔记与条目简记',
								badge: '汇总',
								action: () => {
									this.kernel.bus.emit('visual-notes:open-hub', { win });
								},
							});
						}
					}

					// 5. Clear citation caches command
					if (!term || 'clear cache 清空缓存'.includes(term)) {
						out.push({
							id: 'cmd:clear-citation-cache',
							category: 'command',
							title: '清空引文记忆与反查缓存',
							subtitle: '重置已记录的引文复制历史与反查索引',
							badge: '维护',
							action: () => {
								this.kernel.bus.emit('inspector:clear-cache', { target: 'all' });
							},
						});
					}

					return out;
				},
			}),
		);
	}

	stop(): void {
		this.disposables.disposeAll();
	}
}
