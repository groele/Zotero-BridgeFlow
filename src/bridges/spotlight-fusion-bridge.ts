import { DisposableStack } from '../kernel/disposable.ts';
import type { WordCitePort, WorkspacePort } from '../kernel/domain-ports.ts';
import { tLocale } from '../kernel/locale.ts';
import type { PluginKernel } from '../kernel/plugin-kernel.ts';
import type { BridgeModule, CitationBadgeInfo, CitationSnapshotPayload, SpotlightItemResult } from '../kernel/types.ts';
import { getCachedPrimaryItemFields } from '../services/item-resolution.ts';

export type SpotlightWorkspacePort = Pick<
	WorkspacePort,
	'registerSpotlightProvider' | 'focusOrOpenItem' | 'groupOpenTabsByItemIDs'
>;

export type WordSnapshotSource = Partial<Pick<WordCitePort, 'getSnapshot'>>;

function matchesCmdQuery(rawTerm: string, title: string, subtitle: string, keywords: string): boolean {
	const clean = rawTerm.replace(/^>\s*/, '').trim().toLowerCase();
	if (!clean) return true;
	const hay = `${title} ${subtitle} ${keywords}`.toLowerCase();
	return clean.split(/\s+/).every((tok) => hay.includes(tok));
}

/**
 * Bridge 3: Cross-Domain Word Cite × Workspace Spotlight Fusion.
 * Injects active Word cited items, orphan citation recovery, one-click
 * "Group Active Word Citations", and "Word Citations -> Annotation Matrix"
 * into Workspace Spotlight (Ctrl+P / Cmd+P).
 */
export class SpotlightFusionBridge implements BridgeModule {
	public readonly id = 'spotlight-fusion-bridge';
	public readonly requires = ['workspace', 'word-cite'] as const;

	private readonly disposables = new DisposableStack();
	private readonly kernel: PluginKernel;
	private readonly workspace?: SpotlightWorkspacePort;
	private readonly wordCite?: WordSnapshotSource;
	private latestSnapshot: CitationSnapshotPayload | null = null;
	private sortedByMap = new WeakMap<ReadonlyMap<number, CitationBadgeInfo>, Array<[number, CitationBadgeInfo]>>();

	constructor(kernel: PluginKernel, workspace?: SpotlightWorkspacePort, wordCite?: WordSnapshotSource) {
		this.kernel = kernel;
		this.workspace = workspace;
		this.wordCite = wordCite;
	}

	private sortedCitations(byItemID: ReadonlyMap<number, CitationBadgeInfo>): Array<[number, CitationBadgeInfo]> {
		let entries = this.sortedByMap.get(byItemID);
		if (!entries) {
			entries = [...byItemID.entries()].sort((a, b) => a[1].ordinal - b[1].ordinal);
			this.sortedByMap.set(byItemID, entries);
		}
		return entries;
	}

	private readSnapshot(): CitationSnapshotPayload | null {
		return this.kernel.ports.get('word-cite')?.getSnapshot()
			?? this.wordCite?.getSnapshot?.()
			?? this.latestSnapshot;
	}

	start(): void {
		this.disposables.reset();
		this.disposables.add(
			this.kernel.bus.on('citation:snapshot-updated', (snapshot) => {
				this.latestSnapshot = snapshot;
			}),
		);
		this.latestSnapshot = this.kernel.ports.get('word-cite')?.getSnapshot()
			?? this.wordCite?.getSnapshot?.()
			?? null;
		if (!this.latestSnapshot) {
			this.kernel.bus.emit('word:snapshot-query', { requester: this.id });
		}

		const workspacePort = this.kernel.ports.get('workspace') ?? this.workspace;
		if (!workspacePort) return;

		this.disposables.add(
			workspacePort.registerSpotlightProvider({
				id: 'bridgeflow-cross-domain',
				priority: 80,
				query: (term: string, win: Window, mode?: 'commands'): readonly SpotlightItemResult[] => {
					if (!this.kernel.prefs.get('fusion.spotlightCrossDomain')) return [];
					const snap = this.readSnapshot();
					if (!snap) return [];
					const doc = win?.document ?? null;
					const out: SpotlightItemResult[] = [];

					const clean = term.trim().toLowerCase();
					const activeID = snap.activeSessionID;
					const activeDocName = snap.activeDocumentName;
					const activeByItem = snap.byItemID;

					if (mode !== 'commands' && activeID && activeByItem.size > 0 && !clean.startsWith('>')) {
						const ordMatch = clean.match(/^(?:#|\[)(\d+)\]?$/);
						const targetOrd = ordMatch ? Number(ordMatch[1]) : 0;
						if (targetOrd > 0 || clean.length >= 2) {
							const hostItems = (globalThis as any).Zotero?.Items;
							const candidates = targetOrd > 0 ? activeByItem : this.sortedCitations(activeByItem);
							for (const [itemID, info] of candidates) {
								if (targetOrd > 0 && info.ordinal !== targetOrd) continue;
								const it = hostItems?.get?.(itemID);
								const fields = it ? getCachedPrimaryItemFields(it) : null;
								const title = fields?.title || info.shortText || `Item #${itemID}`;
								const sub = [fields?.creatorYear, fields?.source, activeDocName].filter(Boolean).join(' · ');
								const match = targetOrd > 0 || `${title} ${sub} [${info.ordinal}]`.toLowerCase().includes(clean);
								if (!match) continue;
								out.push({
									id: `word-cited:${itemID}`,
									category: 'citation',
									title,
									subtitle: sub || activeDocName,
									badge: `Word [${info.ordinal}]`,
									action: () => {
										const ws = this.kernel.ports.get('workspace') ?? this.workspace;
										if (ws) void ws.focusOrOpenItem({ itemID, preferExistingTab: true }, win);
									},
								});
								if (out.length >= 8) break;
							}
						}
					}

					for (const ses of snap.sessions ?? []) {
						const orphans = ses.orphans ?? [];
						if (!orphans.length) continue;
						const ordPreview = orphans.slice(0, 4).map((o) => `[${o.ordinal}]`).join(' ') + (orphans.length > 4 ? '…' : '');
						const recoverTitle = tLocale(
							`> ⚠ 一键找回并重连缺失引文：${ses.documentName} (${orphans.length} 篇)`,
							`> ⚠ Recover & Relink Broken Citations: ${ses.documentName} (${orphans.length})`,
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
									const wordPort = this.kernel.ports.get('word-cite');
									if (wordPort) {
										void wordPort.recoverOrphans({ sessionID: ses.sessionID, source: 'spotlight', win });
									} else {
										this.kernel.bus.emit('word:recover-orphans-request', {
											sessionID: ses.sessionID,
											source: 'spotlight',
											win,
										});
									}
								},
							});
						}
					}

					if (activeID) {
						const groupCmdTitle = tLocale(
							`> 将当前 Word 引用文献归入工作区分组：${activeDocName}`,
							`> Group Open Tabs Cited in Word: ${activeDocName}`,
							doc,
						);
						const groupSub = tLocale(
							`共 ${activeByItem.size} 篇已引用文献`,
							`${activeByItem.size} cited items in active document`,
							doc,
						);
						if (matchesCmdQuery(term, groupCmdTitle, groupSub, 'word group 分组 归组')) {
							out.push({
								id: `cmd:group-word:${activeID}`,
								category: 'command',
								title: groupCmdTitle,
								subtitle: groupSub,
								badge: 'WORD',
								action: () => {
									const ws = this.kernel.ports.get('workspace') ?? this.workspace;
									const ids = [...activeByItem.keys()];
									ws?.groupOpenTabsByItemIDs(activeDocName, ids, win);
								},
							});
						}

						if (activeByItem.size > 0 && this.kernel.prefs.get('modules.visualNotes.enable') && this.kernel.prefs.get('workspace.enableAnnotationMatrix')) {
							const matrixTitle = tLocale(
								`> 为当前 Word 已引文献生成批注对比矩阵：${activeDocName}`,
								`> Annotation Comparison Matrix for Word Citations: ${activeDocName}`,
								doc,
							);
							const matrixSub = tLocale(
								`汇总「${activeDocName}」正文中已引 ${activeByItem.size} 篇文献的颜色批注`,
								`Synthesize color annotations across ${activeByItem.size} items cited in "${activeDocName}"`,
								doc,
							);
							if (matchesCmdQuery(term, matrixTitle, matrixSub, 'word matrix 矩阵 批注 对比')) {
								out.push({
									id: `cmd:matrix-word:${activeID}`,
									category: 'command',
									title: matrixTitle,
									subtitle: matrixSub,
									badge: tLocale('矩阵', 'Matrix', doc),
									action: () => {
										const title = tLocale(`Word 已引：${activeDocName}`, `Cited in Word: ${activeDocName}`, doc);
										const itemIDs = [...activeByItem.keys()];
										const visualNotesPort = this.kernel.ports.get('visual-notes');
										if (visualNotesPort) visualNotesPort.openMatrix(win, title, itemIDs);
										else this.kernel.bus.emit('visual-notes:open-matrix', { win, title, itemIDs });
									},
								});
							}
						}
					}

					return out;
				},
			}),
		);
	}

	stop(): void {
		this.latestSnapshot = null;
		this.sortedByMap = new WeakMap();
		this.disposables.disposeAll();
	}
}
