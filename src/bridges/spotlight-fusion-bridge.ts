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
						const groupCmdTitle = `Group open tabs cited in ${active.displayName}`;
						if (!term || groupCmdTitle.toLowerCase().includes(term) || 'word'.includes(term)) {
							out.push({
								id: `cmd:group-word:${active.sessionID}`,
								category: 'command',
								title: groupCmdTitle,
								subtitle: `${active.itemCitations.size} cited items`,
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
							const label = `${info.shortText} (${active.displayName})`;
							if (term && !label.toLowerCase().includes(term) && !`[${info.ordinal}]`.includes(term)) {
								continue;
							}
							out.push({
								id: `word-cite:${active.sessionID}:${itemID}`,
								category: 'citation',
								title: info.shortText || `Item #${itemID}`,
								subtitle: active.displayName,
								badge: `[${info.ordinal}]`,
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
					if (this.wordCite.isActive() && this.kernel.prefs.get('wordCite.dragCite.enable')) {
						const insertLabel = '插入当前文献到 Word 光标处';
						if (!term || insertLabel.toLowerCase().includes(term) || 'word'.includes(term) || 'cite'.includes(term)) {
							out.push({
								id: 'cmd:cite-selected-word',
								category: 'command',
								title: `> ${insertLabel}`,
								subtitle: '在当前 Word 光标处生成原生 Zotero 可编辑引文域',
								badge: 'WORD',
								action: async () => {
									await this.wordCite.citeCurrentSelection(win);
								},
							});
						}
					}

					// 4. Clear citation caches command
					if (!term || 'clear cache'.includes(term)) {
						out.push({
							id: 'cmd:clear-citation-cache',
							category: 'command',
							title: 'Clear citation memory & reverse-lookup cache',
							badge: 'CMD',
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
