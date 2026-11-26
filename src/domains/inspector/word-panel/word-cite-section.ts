import { DisposableStack } from '../../../kernel/disposable.ts';
import { isChineseLocale } from '../../../kernel/locale.ts';
import type { PluginKernel } from '../../../kernel/plugin-kernel.ts';
import type { CitationSnapshotPayload, WorkspaceGroupSummary } from '../../../kernel/types.ts';
import { normalizePanePosition } from '../../../services/pane-positioner.ts';
import type { ServiceContainer } from '../../../services/service-container.ts';
import {
	assembleWordCiteViewModel, formatInsertReceipt,
	formatPendingReceipt, formatRefreshReceipt, preloadUnloadedCitedItems, resolveWordCiteTargetItems,
} from './word-cite-panel-model.ts';
import {
	createWordCiteBodyState, formatRecoverReceipt, OrphanSelectionState, renderWordCitePanel,
	type OrphanDomCallbacks, type ReceiptState, type WordCiteBodyState,
} from './word-cite-panel-ui.ts';
import { clearReminderFieldsCache, ReminderUiState } from './word-cite-reminders-model.ts';
import {
	cycleWordCiteSession, dispatchWordCiteInsert, handleWordCiteIgnoreReminder, handleWordCiteLocateReminder,
	handleWordCiteReceiptAction, requestWordCiteRecoverOrphans, requestWordCiteRefresh,
	selectWordCiteCollection, type WordCiteActionHost,
} from './word-cite-requests.ts';

const WORD_CITE_ICON = 'item-pane-sidenav .btn[data-l10n-id="zbf-pane-word-cite-sidenav"]';

export class WordCiteSectionController {
	private readonly kernel: PluginKernel;
	private readonly services: ServiceContainer;
	private readonly disposables = new DisposableStack();
	private readonly states = new Map<HTMLElement, WordCiteBodyState>();
	private readonly buttonListeners = new Map<HTMLElement, AbortController>();
	private readonly docListeners = new Map<Document, AbortController>();
	private readonly orphanState = new OrphanSelectionState();
	private readonly reminderState = new ReminderUiState();
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
		this.disposables.add(this.kernel.bus.on('citation:snapshot-updated', (snap) => this.applySnapshot(snap)));
		this.disposables.add(this.kernel.bus.on('workspace:groups-updated', ({ groups }) => {
			this.groups = groups;
			this.renderAllBodies();
		}));
		this.disposables.add(this.kernel.bus.on('notifier:event', (ev) => {
			if (ev.type !== 'item') return;
			const numIDs = ev.ids.map((v) => Number(v)).filter((n) => n > 0);
			clearReminderFieldsCache(numIDs.length ? numIDs : undefined);
			const relevant = !numIDs.length || numIDs.some((id) =>
				this.snapshot?.byItemID.has(id) || [...this.states.values()].some((st) => st.lastItemIDs.includes(id) || Number(st.activeItem?.id || 0) === id));
			if (relevant) this.renderAllBodies();
		}));
		this.disposables.add(this.kernel.bus.on('word:insert-result', (res) => this.finishRequest(res.requestId, formatInsertReceipt(res, isChineseLocale()))));
		this.disposables.add(this.kernel.bus.on('word:refresh-result', (res) => this.finishRequest(res.requestId, formatRefreshReceipt(res, isChineseLocale()))));
		this.disposables.add(this.kernel.bus.on('word:recover-orphans-result', (res) => this.finishRequest(res.requestId, formatRecoverReceipt(res, isChineseLocale()))));
		const icon = `${this.kernel.info.rootURI}assets/word-cite.svg`;
		const reg = this.services.itemPanes.register({
			paneID: 'bridgeflow-word-cite', pluginID: this.kernel.info.id,
			header: { l10nID: 'zbf-pane-word-cite-header', icon }, sidenav: { l10nID: 'zbf-pane-word-cite-sidenav', icon, orderable: true },
			onInit: ({ doc, body, item, setEnabled, setSectionSummary }: { doc?: Document; body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void; setSectionSummary?: (s: string) => void }) => {
				this.initBody(doc || body.ownerDocument!, body, item, setEnabled, setSectionSummary);
				this.services.panePositions.observeAndQueue(body);
			},
			onDestroy: ({ doc, body }: { doc?: Document; body: HTMLElement }) => this.onDestroy(doc || body.ownerDocument, body),
			onItemChange: ({ body, item, setEnabled, setSectionSummary }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void; setSectionSummary?: (s: string) => void }) => {
				const isSticky = Boolean(this.receipt.stickyUntil && Date.now() < this.receipt.stickyUntil);
				if (this.states.get(body) === this.receiptOwner && !this.pendingRequest && !isSticky) this.receipt = { text: '', tone: 'none' };
				this.updateState(body, item, setEnabled, setSectionSummary);
				this.services.panePositions.observeAndQueue(body);
				return this.isSectionEnabled() && (Boolean(item) || Boolean(this.snapshot?.activeSessionID) || Boolean(this.snapshot?.orphans?.length));
			},
			onRender: ({ body, item, setEnabled, setSectionSummary }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void; setSectionSummary?: (s: string) => void }) => {
				this.updateState(body, item, setEnabled, setSectionSummary);
				this.services.panePositions.observeAndQueue(body);
			},
			onToggle: ({ body, item, setEnabled, setSectionSummary }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void; setSectionSummary?: (s: string) => void }) => {
				this.updateState(body, item, setEnabled, setSectionSummary);
				this.pullSnapshotAndGroups();
			},
		});
		this.unregisterFn = reg.dispose;
		if (reg.sectionID) {
			this.services.panePositions.setTarget('word-cite', { sectionID: reg.sectionID, getPosition: () => normalizePanePosition(this.kernel.prefs.get('inspector.wordCite.position'), 'zotero-editpane-related') });
		}
		this.pullSnapshotAndGroups();
	}

	private applySnapshot(snap: CitationSnapshotPayload): void {
		this.snapshot = snap;
		const autoExpand = Boolean(this.kernel.prefs.get('inspector.wordCite.orphanAutoExpand') && this.kernel.prefs.get('inspector.wordCite.showOrphanRecovery'));
		if (this.orphanState.syncSnapshot(snap.activeSessionID, snap.orphans, autoExpand)) {
			for (const st of this.states.values()) {
				const col = st.root.closest?.('collapsible-section') as (Element & { open?: boolean }) | null;
				if (col && !col.open) col.open = true;
			}
		}
		this.renderAllBodies();
		this.hydrateUnloadedCitedItems(snap.citedItemIDs);
	}

	private pullSnapshotAndGroups(): void {
		const wordPort = this.kernel.ports.get('word-cite');
		if (wordPort) {
			const snap = wordPort.getSnapshot();
			if (snap) this.applySnapshot(snap);
		} else {
			this.kernel.bus.emit('word:snapshot-query', { requester: 'inspector' });
		}
		const wsPort = this.kernel.ports.get('workspace');
		if (wsPort) {
			this.groups = wsPort.getGroupSummaries();
			this.renderAllBodies();
		} else {
			this.kernel.bus.emit('workspace:groups-query', { requester: 'inspector' });
		}
	}

	refreshAll(): void { this.renderAllBodies(); }

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
		this.orphanState.reset();
		this.reminderState.reset();
		clearReminderFieldsCache();
		this.receiptOwner = undefined;
		this.pendingRequest = undefined;
		this.receipt = { text: '', tone: 'none' };
	}

	citeItemsInWord(itemIDs: readonly number[], win?: Window, owner?: WordCiteBodyState): boolean {
		const valid = [...new Set(itemIDs.filter((id) => Number.isSafeInteger(id) && id > 0))];
		if (!valid.length || !this.isSectionEnabled() || this.pendingRequest) return false;
		const requestId = this.beginRequest('insert', owner);
		dispatchWordCiteInsert(this.actionHost, valid, requestId, win);
		return true;
	}

	private clearPendingTimer(): void { if (this.pendingTimer !== null) { clearTimeout(this.pendingTimer); this.pendingTimer = null; } }

	private finishRequest(requestId: string | undefined, nextReceipt: ReceiptState): void {
		if (!this.pendingRequest || requestId !== this.pendingRequest) return;
		this.clearPendingTimer();
		this.pendingRequest = undefined;
		this.receipt = nextReceipt;
		this.renderAllBodies();
	}

	private beginRequest(kind: 'insert' | 'refresh' | 'recover', owner?: WordCiteBodyState): string {
		this.clearPendingTimer();
		const requestId = `word-${++this.requestSeq}`;
		this.pendingRequest = requestId;
		this.receiptOwner = owner;
		this.receipt = formatPendingReceipt(kind, isChineseLocale());
		this.pendingTimer = setTimeout(() => {
			if (this.pendingRequest !== requestId) return;
			this.pendingTimer = null;
			const zh = isChineseLocale();
			if (kind === 'insert') {
				this.receipt = { tone: 'warn', text: zh
					? '⌛ Word 尚未确认写入，请检查 Word 是否有等待处理的对话框'
					: '⌛ Word has yet to confirm the insertion. Check for a Word dialog.' };
			} else {
				this.pendingRequest = undefined;
				this.receipt = { tone: 'warn', text: zh
					? '⌛ 未收到 Word 响应，请检查 Word 后重试'
					: '⌛ Word request timed out; retry when ready' };
			}
			this.renderAllBodies();
		}, kind === 'insert' ? 12_000 : 25_000);
		this.renderAllBodies();
		return requestId;
	}

	private isSectionEnabled(): boolean {
		return Boolean(this.kernel.prefs.get('inspector.wordCite.enable') && this.kernel.prefs.get('modules.wordCite.enable'));
	}

	private initBody(doc: Document | null, body: HTMLElement, item?: any, setEnabled?: (v: boolean) => void, setSectionSummary?: (s: string) => void): void {
		if (!doc) return;
		this.onDestroy(null, body);
		const win = body.ownerDocument.defaultView;
		const controller = new (win?.AbortController ?? AbortController)();
		this.buttonListeners.set(body, controller);

		const st = createWordCiteBodyState(doc, body, {
			onToggleAccordion: () => { this.reminderState.expanded = !this.reminderState.expanded; this.renderAllBodies(); },
			onSelectFilter: (f) => { this.reminderState.filter = f; this.renderAllBodies(); },
		}, controller.signal);
		st.setSectionSummary = setSectionSummary;
		this.states.set(body, st);

		const click = (button: HTMLButtonElement, action: () => void) => {
			button.addEventListener('click', () => { if (!button.disabled && !button.hidden) action(); }, { signal: controller.signal });
		};
		click(st.insertBtn, () => this.citeItemsInWord(st.lastItemIDs, win ?? undefined, st));
		click(st.refreshBtn, () => requestWordCiteRefresh(this.actionHost, this.snapshot?.activeSessionID || undefined, st, win ?? undefined));
		click(st.docSwitchBtn, () => cycleWordCiteSession(this.kernel, this.snapshot));
		click(st.groupBtn, () => this.citeItemsInWord(st.lastGroup?.itemIDs || [], win ?? undefined, st));
		click(st.colBtn, () => selectWordCiteCollection(this.kernel, this.snapshot?.activeSessionID || undefined, win ?? undefined));
		const onActivate = (el: HTMLElement, fn: () => void) => {
			el.addEventListener('click', fn, { signal: controller.signal });
			el.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault?.(); fn(); } }, { signal: controller.signal });
		};
		onActivate(st.citedCell, () => { if (!st.colBtn.hidden) st.colBtn.click(); });
		onActivate(st.orphanCell, () => {
			if (st.orphanRefs.box.hidden) return;
			this.orphanState.accordionOpen = true;
			this.renderAllBodies();
			st.orphanRefs.box.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
		});
		onActivate(st.ordBadgeEl, () => {
			const txt = st.ordBadgeEl.textContent?.trim();
			if (!txt || !st.ordBadgeEl.classList.contains('is-cited')) return;
			if (this.services.clipboard.writePayload('', txt, true)) {
				const zh = isChineseLocale(st.root.ownerDocument);
				this.receiptOwner = st;
				this.receipt = { tone: 'ok', text: zh ? `✓ 已复制引文标号 ${txt}` : `✓ Copied marker ${txt}`, stickyUntil: Date.now() + 3000 };
				this.renderAllBodies();
			}
		});
		click(st.orphanRefs.accHeadBtn, () => { this.orphanState.accordionOpen = !this.orphanState.accordionOpen; this.renderAllBodies(); });
		click(st.orphanRefs.toggleBtn, () => { this.orphanState.expanded = !this.orphanState.expanded; this.renderAllBodies(); });
		click(st.orphanRefs.actionBtn, () => {
			const keys = this.orphanState.getSelectedRecoverableKeys(this.snapshot?.orphans);
			requestWordCiteRecoverOrphans(this.actionHost, { sessionID: this.snapshot?.activeSessionID || undefined, keys, win: win ?? undefined }, st);
		});
		this.bindDocumentEvents(doc);
		this.updateState(body, item, setEnabled, setSectionSummary);
		this.hydrateUnloadedCitedItems(this.snapshot?.citedItemIDs);
	}

	private get actionHost(): WordCiteActionHost {
		return {
			kernel: this.kernel,
			services: this.services,
			reminderState: this.reminderState,
			hasPendingRequest: () => Boolean(this.pendingRequest),
			beginRequest: (kind, owner) => this.beginRequest(kind, owner),
			finishRequest: (requestId, nextReceipt) => this.finishRequest(requestId, nextReceipt),
			setReceipt: (receipt, owner) => {
				this.receipt = receipt;
				if (owner) this.receiptOwner = owner;
			},
			renderAllBodies: () => this.renderAllBodies(),
		};
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

	private renderAllBodies(): void { for (const st of this.states.values()) this.renderBodyState(st); }

	private hydrateUnloadedCitedItems(citedIDs: readonly number[] | undefined): void {
		preloadUnloadedCitedItems(citedIDs, Boolean(this.kernel.prefs.get('inspector.wordCite.showMetadataReminders')), () => {
			if (this.unregisterFn) this.renderAllBodies();
		});
	}

	private updateState(body: HTMLElement, item: any, setEnabled?: (v: boolean) => void, setSectionSummary?: (s: string) => void): void {
		const st = this.states.get(body);
		if (!st) return;
		if (setSectionSummary) st.setSectionSummary = setSectionSummary;
		st.activeItem = item ?? null;
		const items = resolveWordCiteTargetItems(body.ownerDocument?.defaultView || null, item);
		const enabled = this.isSectionEnabled() && (items.length > 0 || Boolean(this.snapshot?.activeSessionID) || Boolean(this.snapshot?.orphans?.length));
		setEnabled?.(enabled);
		st.lastItemIDs = this.isSectionEnabled() ? items.map((it) => Number(it.id)) : [];
		this.renderBodyState(st, items);
	}

	private renderBodyState(st: WordCiteBodyState, resolvedItems?: any[]): void {
		const items = resolvedItems ?? resolveWordCiteTargetItems(st.root.ownerDocument?.defaultView || null, st.activeItem);
		const zh = isChineseLocale(st.root.ownerDocument);
		const { vm, matchedGroup, summary } = assembleWordCiteViewModel({
			zh, snap: this.snapshot, items, itemIDs: st.lastItemIDs, groups: this.groups,
			getPref: (k) => this.kernel.prefs.get(k), sectionEnabled: this.isSectionEnabled(), pending: Boolean(this.pendingRequest),
			orphanState: this.orphanState, reminderState: this.reminderState,
			isReminderIgnored: (it) => this.services.reminders.isIgnored(it),
			receipt: st === this.receiptOwner ? this.receipt : { text: '', tone: 'none' },
		});
		st.lastGroup = matchedGroup;
		st.setSectionSummary?.(summary);
		const host = this.actionHost;
		const orphanCb: OrphanDomCallbacks = {
			onToggleAccordion: () => { this.orphanState.accordionOpen = !this.orphanState.accordionOpen; this.renderAllBodies(); },
			onToggleItem: (key) => { this.orphanState.toggleKey(key); this.renderAllBodies(); },
			onToggleExpand: () => { this.orphanState.expanded = !this.orphanState.expanded; this.renderAllBodies(); },
			onReceiptAction: (act) => handleWordCiteReceiptAction(host, act, st),
			onDismissReceipt: () => { this.receipt = { text: '', tone: 'none' }; this.renderAllBodies(); },
		};
		renderWordCitePanel(st, vm, orphanCb, {
			onLocateItem: (itemID) => handleWordCiteLocateReminder(host, itemID, st, zh),
			onIgnoreItem: (rec) => handleWordCiteIgnoreReminder(host, rec, st, zh),
			onRestoreItem: (rec) => { this.services.reminders.setIgnored(rec.item || rec.cacheKey, false); this.renderAllBodies(); },
		});
	}
}
