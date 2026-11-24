import { DisposableStack } from '../../kernel/disposable.ts';
import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { CitationSnapshotPayload, WorkspaceGroupSummary } from '../../kernel/types.ts';
import { deduplicateRegularItems, normalizeToRegularItem } from '../../services/item-resolution.ts';
import { normalizePanePosition } from '../../services/pane-positioner.ts';
import type { ServiceContainer } from '../../services/service-container.ts';
import {
	buildWordCiteMetaText,
	createWordCiteBodyState,
	formatInsertReceipt,
	formatPendingReceipt,
	formatRefreshReceipt,
	renderWordCitePanel,
	type ReceiptState,
	type WordCiteBodyState,
	type WordCiteViewModel,
} from './word-cite-panel-ui.ts';

const WORD_CITE_ICON = 'item-pane-sidenav .btn[data-l10n-id="zbf-pane-word-cite-sidenav"]';

function isZhLocale(): boolean {
	return String((globalThis as any).Zotero?.locale || 'zh-CN').toLowerCase().startsWith('zh');
}

export class WordCiteSectionController {
	private readonly kernel: PluginKernel;
	private readonly services: ServiceContainer;
	private readonly disposables = new DisposableStack();
	private readonly states = new Map<HTMLElement, WordCiteBodyState>();
	private readonly buttonListeners = new Map<HTMLElement, AbortController>();
	private readonly docListeners = new Map<Document, AbortController>();
	private unregisterFn: (() => void) | null = null;
	private snapshot: CitationSnapshotPayload | null = null;
	private groups: readonly WorkspaceGroupSummary[] = [];
	private receiptOwner?: WordCiteBodyState;
	private receipt: ReceiptState = { text: '', tone: 'none' };
	private requestSeq = 0;
	private pendingRequest: string | undefined;
	private pendingTimer: ReturnType<typeof setTimeout> | null = null;

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
			if (!this.pendingRequest || res.requestId !== this.pendingRequest) return;
			this.clearPendingTimer();
			this.pendingRequest = undefined;
			this.receipt = formatInsertReceipt(res, isZhLocale());
			this.renderAllBodies();
		}));
		this.disposables.add(this.kernel.bus.on('word:refresh-result', (res) => {
			if (!this.pendingRequest || res.requestId !== this.pendingRequest) return;
			this.clearPendingTimer();
			this.pendingRequest = undefined;
			this.receipt = formatRefreshReceipt(res, isZhLocale());
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
				if (this.states.get(body) === this.receiptOwner && !this.pendingRequest) this.receipt = { text: '', tone: 'none' };
				this.updateState(body, item, setEnabled, setSectionSummary);
				this.services.panePositions.observeAndQueue(body);
				return this.isSectionEnabled() && Boolean(item);
			},
			onRender: ({ body, item, setEnabled, setSectionSummary }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void; setSectionSummary?: (s: string) => void }) => {
				this.updateState(body, item, setEnabled, setSectionSummary);
				this.services.panePositions.observeAndQueue(body);
			},
			onToggle: ({ body, item, setEnabled, setSectionSummary }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void; setSectionSummary?: (s: string) => void }) => {
				this.updateState(body, item, setEnabled, setSectionSummary);
				this.kernel.bus.emit('word:snapshot-query', { requester: 'inspector' });
				this.kernel.bus.emit('workspace:groups-query', { requester: 'inspector' });
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

	refreshAll(): void {
		this.renderAllBodies();
	}

	unregister(): void {
		this.clearPendingTimer();
		this.services.panePositions.setTarget('word-cite', null);
		this.disposables.disposeAll();
		for (const c of this.buttonListeners.values()) c.abort();
		this.buttonListeners.clear();
		for (const c of this.docListeners.values()) c.abort();
		this.docListeners.clear();
		this.unregisterFn?.();
		this.unregisterFn = null;
		this.states.clear();
		this.receiptOwner = undefined;
		this.pendingRequest = undefined;
		this.receipt = { text: '', tone: 'none' };
	}

	citeItemsInWord(itemIDs: readonly number[], win?: Window, owner?: WordCiteBodyState): boolean {
		const valid = [...new Set(itemIDs.filter((id) => Number.isSafeInteger(id) && id > 0))];
		if (!valid.length || !this.isSectionEnabled() || this.pendingRequest) return false;
		const requestId = this.beginRequest('insert', owner);
		this.kernel.bus.emit('word:insert-items-request', { itemIDs: valid, win, requestId });
		return true;
	}

	private clearPendingTimer(): void { if (this.pendingTimer !== null) { clearTimeout(this.pendingTimer); this.pendingTimer = null; } }

	private beginRequest(kind: 'insert' | 'refresh', owner?: WordCiteBodyState): string {
		this.clearPendingTimer();
		const requestId = `word-${++this.requestSeq}`;
		this.pendingRequest = requestId;
		this.receiptOwner = owner;
		this.receipt = formatPendingReceipt(kind, isZhLocale());
		this.pendingTimer = setTimeout(() => {
			if (this.pendingRequest !== requestId) return;
			this.pendingTimer = null; this.pendingRequest = undefined;
			this.receipt = { tone: 'warn', text: isZhLocale() ? '⌛ 未收到 Word 响应，请检查 Word 后重试' : '⌛ Word request timed out; retry when ready' };
			this.renderAllBodies();
		}, 12_000);
		this.renderAllBodies();
		return requestId;
	}

	private isSectionEnabled(): boolean {
		return Boolean(
			this.kernel.prefs.get('inspector.wordCite.enable')
			&& this.kernel.prefs.get('modules.wordCite.enable'),
		);
	}

	private initBody(doc: Document | null, body: HTMLElement, item?: any, setEnabled?: (v: boolean) => void, setSectionSummary?: (s: string) => void): void {
		if (!doc) return;
		this.onDestroy(null, body);
		const st = createWordCiteBodyState(doc, body);
		st.setSectionSummary = setSectionSummary;
		this.states.set(body, st);

		const win = body.ownerDocument.defaultView;
		const controller = new (win?.AbortController ?? AbortController)();
		this.buttonListeners.set(body, controller);
		const click = (button: HTMLButtonElement, action: () => void) => {
			button.addEventListener('click', () => {
				if (!button.disabled && !button.hidden) action();
			}, { signal: controller.signal });
		};
		click(st.insertBtn, () => this.citeItemsInWord(st.lastItemIDs, win ?? undefined, st));
		click(st.refreshBtn, () => this.kernel.bus.emit('word:refresh-request', {
			requestId: this.beginRequest('refresh', st), win: win ?? undefined,
		}));
		click(st.docBtn, () => this.cycleWordSession());
		click(st.groupBtn, () => this.citeItemsInWord(st.lastGroup?.itemIDs || [], win ?? undefined, st));
		click(st.colBtn, () => this.kernel.bus.emit('word:select-collection-request', {
			sessionID: this.snapshot?.activeSessionID || undefined, win: win ?? undefined,
		}));
		this.bindDocumentEvents(doc);
		this.updateState(body, item, setEnabled, setSectionSummary);
	}

	private bindDocumentEvents(doc: Document): void {
		if (this.docListeners.has(doc)) return;
		const ac = new (doc.defaultView?.AbortController ?? AbortController)();
		this.docListeners.set(doc, ac);
		doc.addEventListener('click', (event: Event) => {
			const me = event as MouseEvent;
			if (typeof me.button === 'number' && me.button !== 0) return;
			const target = event.target as Element | null;
			const path = (event as { composedPath?: () => EventTarget[] }).composedPath?.();
			const hitIcon = path?.some((n) => (n as Element)?.matches?.(WORD_CITE_ICON)) ?? Boolean(target?.closest?.(WORD_CITE_ICON));
			if (hitIcon) {
				for (const st of this.states.values()) {
					if (st.root.ownerDocument !== doc) continue;
					const collapsible = st.root.closest?.('collapsible-section') as (Element & { open?: boolean }) | null;
					if (collapsible && !collapsible.open) collapsible.open = true;
					this.renderBodyState(st);
				}
				return;
			}
		}, { capture: true, signal: ac.signal });
	}

	private onDestroy(doc: Document | null, body: HTMLElement): void {
		this.buttonListeners.get(body)?.abort();
		this.buttonListeners.delete(body);
		if (this.states.get(body) === this.receiptOwner) this.receiptOwner = undefined;
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
		const sessionCount = snap?.sessions?.length ?? 0;
		const showDocSwitcher = this.kernel.prefs.get('inspector.wordCite.showDocSwitcher');
		const showSummaryCounts = this.kernel.prefs.get('inspector.wordCite.showSummaryCounts');
		const showGroupSynergy = this.kernel.prefs.get('inspector.wordCite.showGroupSynergy');
		const showCollectionLink = this.kernel.prefs.get('inspector.wordCite.showCollectionLink');

		const idSet = new Set(st.lastItemIDs);
		const matchedGroup = showGroupSynergy && idSet.size > 0
			? this.groups.find((g) => g.itemIDs.length >= 2 && g.itemIDs.some((id) => idSet.has(id))) ?? null
			: null;
		st.lastGroup = matchedGroup;
		const uncitedInGroup = matchedGroup && hasSession
			? matchedGroup.itemIDs.filter((id) => !snap!.byItemID.has(id)).length
			: 0;

		st.setSectionSummary?.(showSummaryCounts ? this.buildSectionSummary(zh, snap, st.lastItemIDs) : '');
		const stats = this.buildStats(zh, snap, st.lastItemIDs);
		const meta = buildWordCiteMetaText(zh, items);

		const vm: WordCiteViewModel = {
			showDocSwitcher,
			showSummaryCounts,
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
			insertDisabled: Boolean(this.pendingRequest) || st.lastItemIDs.length === 0 || !this.isSectionEnabled(),
			refreshDisabled: Boolean(this.pendingRequest) || !this.isSectionEnabled(),
			refreshTitle: zh ? '刷新当前 Word 文档引文与编号' : 'Refresh Word document & sync ordinals',
			groupButtonText: matchedGroup
				? (zh ? `引用所在分组「${matchedGroup.groupName}」(${matchedGroup.itemIDs.length})` : `Cite Group "${matchedGroup.groupName}" (${matchedGroup.itemIDs.length})`)
				: '',
			groupButtonTitle: matchedGroup
				? (zh
					? `将工作区分组「${matchedGroup.groupName}」中的 ${matchedGroup.itemIDs.length} 篇文献合并插入 Word${hasSession ? `（其中 ${uncitedInGroup} 篇尚未引用）` : ''}`
					: `Insert all ${matchedGroup.itemIDs.length} papers from "${matchedGroup.groupName}"${hasSession ? ` (${uncitedInGroup} uncited)` : ''}`)
				: '',
			showCollectionButton: showCollectionLink && hasSession && Boolean(this.kernel.prefs.get('wordCite.collections.enable')),
			colButtonText: zh ? '已引清单' : 'Cited List',
			colButtonTitle: zh ? '在左侧目录树定位当前文档的已引用文献合集' : 'Reveal temporary Word collection in library tree',
			receiptText: st === this.receiptOwner ? this.receipt.text : '',
			receiptTone: st === this.receiptOwner ? this.receipt.tone : 'none',
		};
		renderWordCitePanel(st, vm);
	}

	private buildSectionSummary(zh: boolean, snap: CitationSnapshotPayload | null, ids: readonly number[]): string {
		if (!snap?.activeSessionID) return '';
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
				return { text: zh ? `序号 [${b.ordinal}] / 共 ${total} 篇` : `[${b.ordinal}] / ${total} cited`, title: zh ? `在「${snap.activeDocumentName}」中出现 ${occ} 次${b.shortText ? ` · ${b.shortText}` : ''}` : `Cited ${occ} time(s) in "${snap.activeDocumentName}"`, state: 'cited' };
			}
			return { text: zh ? `未引 / 共 ${total} 篇` : `Uncited / ${total}`, title: zh ? `尚未在「${snap.activeDocumentName}」中引用 (当前共引 ${total} 篇)` : `Not yet cited in "${snap.activeDocumentName}" (${total} total)`, state: 'uncited' };
		}
		if (ids.length > 1) {
			const cited = ids.map((id) => snap.byItemID.get(id)).filter((b): b is NonNullable<typeof b> => Boolean(b)).sort((a, b) => a.ordinal - b.ordinal);
			if (cited.length) {
				const list = `[${cited.slice(0, 3).map((b) => b.ordinal).join(', ')}${cited.length > 3 ? '…' : ''}]`;
				return { text: zh ? `已引 ${list} / 共 ${total} 篇` : `${cited.length}/${ids.length} cited · ${total} total`, title: zh ? `所选 ${ids.length} 篇中有 ${cited.length} 篇已引用` : `${cited.length} of ${ids.length} selected items cited`, state: 'cited' };
			}
			return { text: zh ? `未引 (${ids.length} 篇) / 共 ${total} 篇` : `0/${ids.length} cited · ${total} total`, title: zh ? '当前选中文献均尚未在 Word 中引用' : 'None of the selected items are cited yet', state: 'uncited' };
		}
		return { text: zh ? `共引 ${total} 篇` : `${total} cited`, title: snap.activeDocumentName, state: 'uncited' };
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
}
