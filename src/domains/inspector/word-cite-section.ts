import { DisposableStack } from '../../kernel/disposable.ts';
import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type {
	CitationSnapshotPayload,
	WordInsertResultPayload,
	WordRefreshResultPayload,
	WorkspaceGroupSummary,
} from '../../kernel/types.ts';
import { deduplicateRegularItems, getCachedPrimaryItemFields, normalizeToRegularItem } from '../../services/item-resolution.ts';
import { normalizePanePosition } from '../../services/pane-positioner.ts';
import type { ServiceContainer } from '../../services/service-container.ts';
import { createWordCiteBodyState, renderWordCitePanel, type WordCiteBodyState, type WordCiteViewModel } from './word-cite-panel-ui.ts';

const WORD_CITE_ICON = 'item-pane-sidenav .btn[data-l10n-id="zbf-pane-word-cite-sidenav"]';

interface ReceiptState {
	text: string;
	tone: 'ok' | 'warn' | 'err' | 'none';
}

function isZhLocale(): boolean {
	return String((globalThis as any).Zotero?.locale || 'zh-CN').toLowerCase().startsWith('zh');
}

export class WordCiteSectionController {
	private readonly kernel: PluginKernel;
	private readonly services: ServiceContainer;
	private readonly disposables = new DisposableStack();
	private readonly states = new Map<HTMLElement, WordCiteBodyState>();
	private readonly bodyListeners = new Map<HTMLElement, AbortController>();
	private readonly docListeners = new Map<Document, AbortController>();
	private unregisterFn: (() => void) | null = null;
	private snapshot: CitationSnapshotPayload | null = null;
	private groups: readonly WorkspaceGroupSummary[] = [];
	private receipt: ReceiptState = { text: '', tone: 'none' };
	private requestSeq = 0;

	constructor(kernel: PluginKernel, services: ServiceContainer) {
		this.kernel = kernel;
		this.services = services;
	}

	register(): void {
		if (this.unregisterFn) return;
		this.disposables.reset();
		this.disposables.add(this.kernel.bus.on('citation:snapshot-updated', (snap) => {
			this.snapshot = snap;
			this.renderAllBodies();
		}));
		this.disposables.add(this.kernel.bus.on('workspace:groups-updated', ({ groups }) => {
			this.groups = groups;
			this.renderAllBodies();
		}));
		this.disposables.add(this.kernel.bus.on('word:insert-result', (res) => {
			this.receipt = this.formatInsertReceipt(res);
			this.renderAllBodies();
		}));
		this.disposables.add(this.kernel.bus.on('word:refresh-result', (res) => {
			this.receipt = this.formatRefreshReceipt(res);
			this.renderAllBodies();
		}));

		const icon = `${this.kernel.info.rootURI}assets/word-cite.svg`;
		const reg = this.services.itemPanes.register({
			paneID: 'bridgeflow-word-cite',
			pluginID: this.kernel.info.id,
			header: { l10nID: 'zbf-pane-word-cite-header', icon },
			sidenav: { l10nID: 'zbf-pane-word-cite-sidenav', icon, orderable: true },
			onInit: ({ doc, body, item, setEnabled, setSectionSummary }: { doc?: Document; body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void; setSectionSummary?: (s: string) => void }) => {
				this.initBody(doc || body.ownerDocument!, body, item, setEnabled, setSectionSummary);
				this.services.panePositions.observeAndQueue(body);
			},
			onDestroy: ({ doc, body }: { doc?: Document; body: HTMLElement }) => {
				this.onDestroy(doc || body.ownerDocument, body);
			},
			onItemChange: ({ body, item, setEnabled, setSectionSummary }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void; setSectionSummary?: (s: string) => void }) => {
				this.receipt = { text: '', tone: 'none' };
				this.updateState(body, item, setEnabled, setSectionSummary);
				this.services.panePositions.observeAndQueue(body);
				return this.isSectionEnabled() && Boolean(item);
			},
			onRender: ({ body, item, setEnabled, setSectionSummary }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void; setSectionSummary?: (s: string) => void }) => {
				this.updateState(body, item, setEnabled, setSectionSummary);
				this.services.panePositions.observeAndQueue(body);
			},
		});
		this.unregisterFn = reg.dispose;
		if (reg.sectionID) {
			this.services.panePositions.setTarget('word-cite', {
				sectionID: reg.sectionID,
				getPosition: () => normalizePanePosition(this.kernel.prefs.get('inspector.wordCite.position'), 'zotero-editpane-related'),
			});
		}
		this.kernel.bus.emit('word:snapshot-query', { requester: 'inspector' });
		this.kernel.bus.emit('workspace:groups-query', { requester: 'inspector' });
	}

	unregister(): void {
		this.services.panePositions.setTarget('word-cite', null);
		this.disposables.disposeAll();
		for (const c of this.bodyListeners.values()) c.abort();
		this.bodyListeners.clear();
		for (const c of this.docListeners.values()) c.abort();
		this.docListeners.clear();
		this.unregisterFn?.();
		this.unregisterFn = null;
		this.states.clear();
	}

	citeItemsInWord(itemIDs: readonly number[], win?: Window): boolean {
		const valid = [...new Set(itemIDs.filter((id) => Number.isSafeInteger(id) && id > 0))];
		if (!valid.length || !this.isSectionEnabled()) return false;
		const requestId = `wc-${++this.requestSeq}`;
		this.kernel.bus.emit('word:insert-items-request', { itemIDs: valid, win, requestId });
		return true;
	}

	private isSectionEnabled(): boolean {
		return Boolean(
			this.kernel.prefs.get('inspector.wordCite.enable')
			&& this.kernel.prefs.get('modules.wordCite.enable')
			&& this.kernel.prefs.get('wordCite.dragCite.enable'),
		);
	}

	private initBody(doc: Document | null, body: HTMLElement, item?: any, setEnabled?: (v: boolean) => void, setSectionSummary?: (s: string) => void): void {
		if (!doc) return;
		this.onDestroy(null, body);
		const st = createWordCiteBodyState(doc, body);
		st.setSectionSummary = setSectionSummary;
		this.states.set(body, st);

		const ac = new AbortController();
		this.bodyListeners.set(body, ac);
		const { signal } = ac;

		st.insertBtn.addEventListener('click', () => {
			if (st.lastItemIDs.length) this.citeItemsInWord(st.lastItemIDs, doc.defaultView || undefined);
		}, { signal });
		st.refreshBtn.addEventListener('click', () => {
			const requestId = `wr-${++this.requestSeq}`;
			this.kernel.bus.emit('word:refresh-request', { requestId, win: doc.defaultView || undefined });
		}, { signal });
		st.docBtn.addEventListener('click', () => this.cycleWordSession(), { signal });
		st.groupBtn.addEventListener('click', () => {
			if (st.lastGroup?.itemIDs.length) this.citeItemsInWord(st.lastGroup.itemIDs, doc.defaultView || undefined);
		}, { signal });
		st.colBtn.addEventListener('click', () => {
			this.kernel.bus.emit('word:select-collection-request', {
				sessionID: this.snapshot?.activeSessionID || undefined,
				win: doc.defaultView || undefined,
			});
		}, { signal });

		this.bindDocumentSidenav(doc);
		this.updateState(body, item, setEnabled, setSectionSummary);
	}

	private bindDocumentSidenav(doc: Document): void {
		if (this.docListeners.has(doc)) return;
		const ac = new AbortController();
		this.docListeners.set(doc, ac);
		doc.addEventListener('click', (event: Event) => {
			const target = event.target as Element | null;
			if (!target?.closest?.(WORD_CITE_ICON)) return;
			for (const st of this.states.values()) {
				if (st.root.ownerDocument !== doc) continue;
				const collapsible = st.root.closest?.('collapsible-section') as (Element & { open?: boolean }) | null;
				if (collapsible && !collapsible.open) collapsible.open = true;
				this.renderBodyState(st);
			}
		}, { signal: ac.signal });
	}

	private onDestroy(doc: Document | null, body: HTMLElement): void {
		this.bodyListeners.get(body)?.abort();
		this.bodyListeners.delete(body);
		this.states.delete(body);
		body.textContent = '';
		if (doc && ![...this.states.keys()].some((b) => b.ownerDocument === doc)) {
			this.docListeners.get(doc)?.abort();
			this.docListeners.delete(doc);
		}
	}

	private cycleWordSession(): void {
		const sessions = this.snapshot?.sessions || [];
		if (sessions.length < 2) return;
		const curIdx = sessions.findIndex((s) => s.sessionID === this.snapshot?.activeSessionID);
		const next = sessions[(curIdx + 1) % sessions.length];
		if (next) this.kernel.bus.emit('word:switch-session-request', { sessionID: next.sessionID });
	}

	private renderAllBodies(): void {
		for (const st of this.states.values()) this.renderBodyState(st);
	}

	private updateState(body: HTMLElement, item: any, setEnabled?: (v: boolean) => void, setSectionSummary?: (s: string) => void): void {
		const st = this.states.get(body);
		if (!st) return;
		if (setSectionSummary) st.setSectionSummary = setSectionSummary;
		st.activeItem = item ?? null;
		const items = this.resolveTargetItems(body.ownerDocument?.defaultView || null, item);
		const enabled = this.isSectionEnabled() && items.length > 0;
		setEnabled?.(enabled);
		st.lastItemIDs = enabled ? items.map((it) => Number(it.id)) : [];
		this.renderBodyState(st, items);
	}

	private renderBodyState(st: WordCiteBodyState, resolvedItems?: any[]): void {
		const items = resolvedItems ?? this.resolveTargetItems(st.root.ownerDocument?.defaultView || null, st.activeItem);
		const zh = isZhLocale();
		const snap = this.snapshot;
		const hasSession = Boolean(snap?.activeSessionID);
		const total = snap?.totalCitedCount ?? 0;
		const sessionCount = snap?.sessions?.length ?? 0;
		const primaryId = st.lastItemIDs[0] || 0;
		const matchedGroup = primaryId ? this.groups.find((g) => g.itemIDs.includes(primaryId) && g.itemIDs.length >= 2) ?? null : null;
		st.lastGroup = matchedGroup;

		st.setSectionSummary?.(this.buildSectionSummary(zh, snap, st.lastItemIDs));
		const stats = this.buildStats(zh, snap, st.lastItemIDs);
		const meta = this.buildMetaText(zh, items);

		const vm: WordCiteViewModel = {
			docName: hasSession ? (snap!.activeDocumentName || 'Word') : (zh ? '未连接 Word' : 'No Word session'),
			docTitle: sessionCount >= 2
				? (zh ? `点击切换目标 Word 文档 (${sessionCount} 个已打开)` : `Click to switch active Word doc (${sessionCount} open)`)
				: (hasSession ? snap!.activeDocumentName : (zh ? '请打开 Word 文档' : 'Open a Word document')),
			isMultiSession: sessionCount >= 2,
			hasWordSession: hasSession,
			statsText: stats.text,
			statsTitle: stats.title,
			statsState: stats.state,
			metaText: meta,
			metaTitle: meta,
			insertLabel: st.lastItemIDs.length > 1
				? (zh ? `合并插入 ${st.lastItemIDs.length} 篇引文到 Word` : `Insert ${st.lastItemIDs.length} Citations in Word`)
				: (zh ? '插入引文到 Word 光标处' : 'Insert Citation at Word Cursor'),
			insertDisabled: st.lastItemIDs.length === 0 || !this.isSectionEnabled(),
			refreshDisabled: !this.isSectionEnabled(),
			refreshTitle: zh ? '刷新当前 Word 文档引文与编号' : 'Refresh Word document & sync ordinals',
			groupButtonText: matchedGroup
				? (zh ? `引用所在分组「${matchedGroup.groupName}」(${matchedGroup.itemIDs.length})` : `Cite Group "${matchedGroup.groupName}" (${matchedGroup.itemIDs.length})`)
				: '',
			groupButtonTitle: matchedGroup
				? (zh ? `将工作区分组「${matchedGroup.groupName}」中的 ${matchedGroup.itemIDs.length} 篇文献合并插入 Word` : `Insert all ${matchedGroup.itemIDs.length} papers from "${matchedGroup.groupName}"`)
				: '',
			showCollectionButton: hasSession,
			colButtonText: zh ? '已引清单' : 'Cited List',
			colButtonTitle: zh ? '在左侧目录树定位当前文档的已引用文献合集' : 'Reveal temporary Word collection in library tree',
			receiptText: this.receipt.text,
			receiptTone: this.receipt.tone,
		};
		renderWordCitePanel(st, vm);
	}

	private buildSectionSummary(zh: boolean, snap: CitationSnapshotPayload | null, ids: readonly number[]): string {
		if (!snap?.activeSessionID) return zh ? '插入引文到 Word' : 'Insert Citation in Word';
		const total = snap.totalCitedCount;
		if (ids.length > 1) return zh ? `已选 ${ids.length} 篇 · 共引 ${total} 篇` : `${ids.length} selected · ${total} cited`;
		const badge = ids.length === 1 ? snap.byItemID.get(ids[0]) : undefined;
		if (badge) return zh ? `序号 [${badge.ordinal}] · 共引 ${total} 篇` : `[${badge.ordinal}] · ${total} cited`;
		return zh ? `未引用 · 共引 ${total} 篇` : `Uncited · ${total} cited`;
	}

	private buildStats(zh: boolean, snap: CitationSnapshotPayload | null, ids: readonly number[]): { text: string; title: string; state: 'cited' | 'uncited' | 'none' } {
		if (!snap?.activeSessionID) {
			return { text: zh ? '请先打开 Word' : 'Open Word first', title: zh ? '暂未检测到活动 Word 文档会话' : 'No active Word session detected', state: 'none' };
		}
		const total = snap.totalCitedCount;
		if (ids.length === 1) {
			const b = snap.byItemID.get(ids[0]);
			if (b) {
				const occ = b.occurrences ?? 1;
				return {
					text: zh ? `序号 [${b.ordinal}] / 共 ${total} 篇` : `[${b.ordinal}] / ${total} cited`,
					title: zh ? `在「${snap.activeDocumentName}」中出现 ${occ} 次${b.shortText ? ` · ${b.shortText}` : ''}` : `Cited ${occ} time(s) in "${snap.activeDocumentName}"`,
					state: 'cited',
				};
			}
			return {
				text: zh ? `未引 / 共 ${total} 篇` : `Uncited / ${total}`,
				title: zh ? `尚未在「${snap.activeDocumentName}」中引用 (当前共引 ${total} 篇)` : `Not yet cited in "${snap.activeDocumentName}" (${total} total)`,
				state: 'uncited',
			};
		}
		if (ids.length > 1) {
			const cited = ids.map((id) => snap.byItemID.get(id)).filter((b): b is NonNullable<typeof b> => Boolean(b)).sort((a, b) => a.ordinal - b.ordinal);
			if (cited.length) {
				const list = `[${cited.slice(0, 3).map((b) => b.ordinal).join(', ')}${cited.length > 3 ? '…' : ''}]`;
				return {
					text: zh ? `已引 ${list} / 共 ${total} 篇` : `${cited.length}/${ids.length} cited · ${total} total`,
					title: zh ? `所选 ${ids.length} 篇中有 ${cited.length} 篇已引用` : `${cited.length} of ${ids.length} selected items cited`,
					state: 'cited',
				};
			}
			return {
				text: zh ? `未引 (${ids.length} 篇) / 共 ${total} 篇` : `0/${ids.length} cited · ${total} total`,
				title: zh ? '当前选中文献均尚未在 Word 中引用' : 'None of the selected items are cited yet',
				state: 'uncited',
			};
		}
		return { text: zh ? `共引 ${total} 篇` : `${total} cited`, title: snap.activeDocumentName, state: 'uncited' };
	}

	private buildMetaText(zh: boolean, items: readonly any[]): string {
		if (!items.length) return zh ? '请选择文献条目以插入 Word 引文' : 'Select an item to insert a Word citation';
		const info = getCachedPrimaryItemFields(items[0]);
		const first = [info.creatorYear, info.title].filter(Boolean).join(' · ') || info.title;
		if (items.length === 1) return first;
		return zh ? `已选 ${items.length} 篇：${first}` : `${items.length} items: ${first}`;
	}

	private resolveTargetItems(win: Window | null, item: any): any[] {
		if (!item) return [];
		const reg = normalizeToRegularItem(item) || item;
		const paneItems: any[] = (win as any)?.ZoteroPane?.getSelectedItems?.() || [];
		const regId = Number(reg?.id || 0);
		const itemId = Number(item?.id || 0);
		if (paneItems.length > 1 && paneItems.some((p) => Number(p?.id || 0) === itemId || (regId > 0 && Number(p?.id || 0) === regId))) {
			return deduplicateRegularItems(paneItems).items;
		}
		return deduplicateRegularItems([reg]).items;
	}

	private formatInsertReceipt(res: WordInsertResultPayload): ReceiptState {
		const zh = isZhLocale();
		const doc = res.documentName || 'Word';
		if (res.status === 'inserted') return { tone: 'ok', text: zh ? `✓ 已插入 ${res.itemCount} 篇引文到「${doc}」` : `✓ Inserted ${res.itemCount} citation(s) into "${doc}"` };
		if (res.status === 'busy') return { tone: 'warn', text: zh ? '⌛ Word 正在处理引文，请稍候再试' : '⌛ Word is busy updating citations, try again' };
		if (res.status === 'non-word') return { tone: 'warn', text: zh ? '⚠ 当前激活文档不是受支持的 Word 文档' : '⚠ Active document is not a supported Word document' };
		if (res.status === 'cancelled') return { tone: 'warn', text: zh ? 'ⓘ 已取消插入引文' : 'ⓘ Citation insertion cancelled' };
		return { tone: 'err', text: zh ? '✕ 插入失败：请先打开 Word 并确认插件连接正常' : '✕ Unable to insert: verify Word is open and connected' };
	}

	private formatRefreshReceipt(res: WordRefreshResultPayload): ReceiptState {
		const zh = isZhLocale();
		const doc = res.documentName || 'Word';
		if (res.ok) return { tone: 'ok', text: zh ? `↻ 已刷新「${doc}」并同步序号` : `↻ Refreshed "${doc}" citations` };
		return { tone: 'warn', text: zh ? '⚠ 未检测到可刷新的活动 Word 文档' : '⚠ No active Word document to refresh' };
	}
}
