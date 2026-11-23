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

						// 2. Active Word cited items quick jump
						for (const [itemID, info] of active.itemCitations.entries()) {
							const zotItem = (globalThis as any).Zotero?.Items?.get?.(itemID);
							const itemTitle = String(zotItem?.getField?.('title') || info.shortText || `文献 #${itemID}`);
							const label = `${itemTitle} ${info.shortText} (${active.displayName})`;
							if (term && !label.toLowerCase().includes(term) && !`[${info.ordinal}]`.includes(term)) {
								continue;
							}
							out.push({
								id: `word-cite:${active.sessionID}:${itemID}`,
								category: 'citation',
								title: itemTitle,
								subtitle: `${active.displayName} · ${info.shortText}`,
								badge: `Word [${info.ordinal}]`,
								action: async () => {
									await this.workspace.focusOrOpenItem({
										itemID,
										preferExistingTab: true,
										assignToActiveGroup: false,
									}, win);
								},
							});
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

					// 4. Clear citation caches command
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
