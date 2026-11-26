import type { WordCiteDomainModule } from '../domains/word-cite/module.ts';
import type { WorkspaceDomainModule } from '../domains/workspace/module.ts';
import { DisposableStack } from '../kernel/disposable.ts';
import { tLocale } from '../kernel/locale.ts';
import type { PluginKernel } from '../kernel/plugin-kernel.ts';
import type { BridgeModule, SpotlightItemResult } from '../kernel/types.ts';
import { getCachedPrimaryItemFields } from '../services/item-resolution.ts';

function matchesCmdQuery(rawTerm: string, title: string, subtitle: string, keywords: string): boolean {
	const clean = rawTerm.replace(/^>\s*/, '').trim().toLowerCase();
	if (!clean) return true;
	const hay = `${title} ${subtitle} ${keywords}`.toLowerCase();
	return clean.split(/\s+/).every((tok) => hay.includes(tok));
}

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
					const doc = win?.document ?? null;
					const out: SpotlightItemResult[] = [];
					const active = this.wordCite.tracker.getActiveSession();

					const clean = term.trim().toLowerCase();
					if (active && active.itemCitations.size > 0 && !clean.startsWith('>')) {
						const ordMatch = clean.match(/^(?:#|\[)(\d+)\]?$/);
						const targetOrd = ordMatch ? Number(ordMatch[1]) : 0;
						if (targetOrd > 0 || clean.length >= 2) {
							const hostItems = (globalThis as any).Zotero?.Items;
							const sorted = [...active.itemCitations.entries()].sort((a, b) => a[1].ordinal - b[1].ordinal);
							for (const [itemID, info] of sorted) {
								const it = hostItems?.get?.(itemID);
								const fields = it ? getCachedPrimaryItemFields(it) : null;
								const title = fields?.title || info.shortText || `Item #${itemID}`;
								const sub = [fields?.creatorYear, fields?.source, active.displayName].filter(Boolean).join(' · ');
								const match = targetOrd > 0
									? info.ordinal === targetOrd
									: `${title} ${sub} [${info.ordinal}]`.toLowerCase().includes(clean);
								if (!match) continue;
								out.push({
									id: `word-cited:${itemID}`,
									category: 'citation',
									title,
									subtitle: sub || active.displayName,
									badge: `Word [${info.ordinal}]`,
									action: () => { void this.workspace.focusOrOpenItem({ itemID, preferExistingTab: true }, win); },
								});
								if (out.length >= 8) break;
							}
						}
					}

					for (const ses of this.wordCite.tracker.getAllSessions()) {
						if (!ses.orphans.length) continue;
						const ordPreview = ses.orphans.slice(0, 4).map((o) => `[${o.ordinal}]`).join(' ') + (ses.orphans.length > 4 ? '…' : '');
						const recoverTitle = tLocale(
							`> ⚠ 一键找回并重连缺失引文：${ses.displayName} (${ses.orphans.length} 篇)`,
							`> ⚠ Recover & Relink Broken Citations: ${ses.displayName} (${ses.orphans.length})`,
							doc,
						);
						const recoverSub = tLocale(
							`单事务找回 ${ordPreview} 至 Zotero 并通过官方 dc:replaces 自动重连 Word`,
							`Atomically restore ${ordPreview} to Zotero and relink Word via dc:replaces`,
							doc,
						);
						if (matchesCmdQuery(term, recoverTitle, recoverSub, 'recover orphan word 找回 恢复 缺失 断链 重连')) {
							out.push({
								id: `cmd:recover-word-orphans:${ses.sessionID}`,
								category: 'command',
								title: recoverTitle,
								subtitle: recoverSub,
								badge: tLocale('修复', 'Fix', doc),
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
						const groupCmdTitle = tLocale(
							`> 将当前 Word 引用文献归入工作区分组：${active.displayName}`,
							`> Group Open Tabs Cited in Word: ${active.displayName}`,
							doc,
						);
						const groupSub = tLocale(
							`共 ${active.itemCitations.size} 篇已引用文献`,
							`${active.itemCitations.size} cited items in active document`,
							doc,
						);
						if (matchesCmdQuery(term, groupCmdTitle, groupSub, 'word group 分组 归组')) {
							out.push({
								id: `cmd:group-word:${active.sessionID}`,
								category: 'command',
								title: groupCmdTitle,
								subtitle: groupSub,
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

						if (active.itemCitations.size > 0 && this.kernel.prefs.get('modules.visualNotes.enable') && this.kernel.prefs.get('workspace.enableAnnotationMatrix')) {
							const matrixTitle = tLocale(
								`> 为当前 Word 已引文献生成批注对比矩阵：${active.displayName}`,
								`> Annotation Comparison Matrix for Word Citations: ${active.displayName}`,
								doc,
							);
							const matrixSub = tLocale(
								`汇总「${active.displayName}」正文中已引 ${active.itemCitations.size} 篇文献的颜色批注`,
								`Synthesize color annotations across ${active.itemCitations.size} items cited in "${active.displayName}"`,
								doc,
							);
							if (matchesCmdQuery(term, matrixTitle, matrixSub, 'word matrix 矩阵 批注 对比')) {
								out.push({
									id: `cmd:matrix-word:${active.sessionID}`,
									category: 'command',
									title: matrixTitle,
									subtitle: matrixSub,
									badge: tLocale('矩阵', 'Matrix', doc),
									action: () => {
										this.kernel.bus.emit('visual-notes:open-matrix', {
											win,
											title: tLocale(`Word 已引：${active.displayName}`, `Cited in Word: ${active.displayName}`, doc),
											itemIDs: [...active.itemCitations.keys()],
										});
									},
								});
							}
						}
					}

					if (this.wordCite.isActive()) {
						const insertLabel = tLocale('> 插入当前文献到 Word 光标处', '> Insert Selected Citation at Word Cursor', doc);
						const insertSub = tLocale('在当前 Word 光标处生成原生 Zotero 可编辑引文域', 'Insert a native editable Zotero citation field at the Word cursor', doc);
						if (matchesCmdQuery(term, insertLabel, insertSub, 'word cite insert 插入 引文')) {
							out.push({
								id: 'cmd:cite-selected-word',
								category: 'command',
								title: insertLabel,
								subtitle: insertSub,
								badge: 'Word',
								action: async () => {
									await this.wordCite.citeCurrentSelection(win);
								},
							});
						}
					}

					if (this.kernel.prefs.get('modules.visualNotes.enable')) {
						const galTitle = tLocale('> 切换文献画廊 / 多维看板视图', '> Toggle Literature Gallery / Kanban Board', doc);
						const galSub = tLocale('在主文献列表与卡片画廊、状态/星级拖拽看板间切换', 'Switch between item list, card gallery, and status/rating Kanban board', doc);
						if (this.kernel.prefs.get('visualNotes.gallery.enable') && matchesCmdQuery(term, galTitle, galSub, 'gallery kanban board 画廊 看板 卡片')) {
							out.push({
								id: 'cmd:toggle-gallery-board',
								category: 'command',
								title: galTitle,
								subtitle: galSub,
								badge: tLocale('画廊', 'Gallery', doc),
								action: () => {
									this.kernel.bus.emit('visual-notes:toggle-gallery', { win });
								},
							});
						}
						const hubTitle = tLocale('> 打开当前分类集中笔记与标注管理中心', '> Open Collection Notes & Annotations Hub', doc);
						const hubSub = tLocale('集中浏览与筛选分类下全部文献的 PDF 批注、独立子笔记与条目简记', 'Browse & filter PDF annotations, child notes, and brief notes in collection', doc);
						if (this.kernel.prefs.get('visualNotes.collectionHub.enable') && matchesCmdQuery(term, hubTitle, hubSub, 'notes hub annotations 笔记 标注 汇总 简记')) {
							out.push({
								id: 'cmd:open-collection-hub',
								category: 'command',
								title: hubTitle,
								subtitle: hubSub,
								badge: tLocale('汇总', 'Hub', doc),
								action: () => {
									this.kernel.bus.emit('visual-notes:open-hub', { win });
								},
							});
						}
					}

					const clearTitle = tLocale('> 清空引文记忆与反查缓存', '> Clear Citation & Lookup Caches', doc);
					const clearSub = tLocale('重置已记录的引文复制历史与反查索引', 'Reset copied citation lookup history and formatted preview cache', doc);
					if (matchesCmdQuery(term, clearTitle, clearSub, 'clear cache 清空缓存 反查')) {
						out.push({
							id: 'cmd:clear-citation-cache',
							category: 'command',
							title: clearTitle,
							subtitle: clearSub,
							badge: tLocale('维护', 'Maint', doc),
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
