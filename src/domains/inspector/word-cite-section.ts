import { DisposableStack } from '../../kernel/disposable.ts';
import { isChineseLocale } from '../../kernel/locale.ts';
import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { CitationSnapshotPayload, WorkspaceGroupSummary } from '../../kernel/types.ts';
import { locateItemInZoteroLibrary } from '../../services/item-resolution.ts';
import { normalizePanePosition } from '../../services/pane-positioner.ts';
import type { ServiceContainer } from '../../services/service-container.ts';
import {
	assembleWordCiteViewModel,
	formatIgnoreReminderReceipt,
	formatInsertReceipt,
	formatPendingReceipt,
	formatRefreshReceipt,
	preloadUnloadedCitedItems,
	resolveWordCiteTargetItems,
} from './word-cite-panel-model.ts';
import {
	createWordCiteBodyState,
	formatRecoverReceipt,
	OrphanSelectionState,
	renderWordCitePanel,
	type OrphanDomCallbacks,
	type ReceiptAction,
	type ReceiptState,
	type WordCiteBodyState,
} from './word-cite-panel-ui.ts';
import { ReminderUiState, type ReminderItemRecord } from './word-cite-reminders-model.ts';

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
		this.disposables.add(this.kernel.bus.on('citation:snapshot-updated', (snap) => {
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
		}));
		this.disposables.add(this.kernel.bus.on('workspace:groups-updated', ({ groups }) => {
			this.groups = groups;
			this.renderAllBodies();
		}));
		this.disposables.add(this.kernel.bus.on('notifier:event', (ev) => {
			if (ev.type === 'item') this.renderAllBodies();
		}));
		this.disposables.add(this.kernel.bus.on('word:insert-result', (res) => this.finishRequest(res.requestId, formatInsertReceipt(res, isChineseLocale()))));
		this.disposables.add(this.kernel.bus.on('word:refresh-result', (res) => this.finishRequest(res.requestId, formatRefreshReceipt(res, isChineseLocale()))));
		this.disposables.add(this.kernel.bus.on('word:recover-orphans-result', (res) => this.finishRequest(res.requestId, formatRecoverReceipt(res, isChineseLocale()))));

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
			onDestroy: ({ doc, body }: { doc?: Document; body: HTMLElement }) => this.onDestroy(doc || body.ownerDocument, body),
			onItemChange: ({ body, item, setEnabled, setSectionSummary }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void; setSectionSummary?: (s: string) => void }) => {
				const isSticky = Boolean(this.receipt.stickyUntil && Date.now() < this.receipt.stickyUntil);
				if (this.states.get(body) === this.receiptOwner && !this.pendingRequest && !isSticky) {
					this.receipt = { text: '', tone: 'none' };
				}
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
			this.pendingTimer = null; this.pendingRequest = undefined;
			this.receipt = { tone: 'warn', text: isChineseLocale() ? '⌛ 未收到 Word 响应，请检查 Word 后重试' : '⌛ Word request timed out; retry when ready' };
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

		const st = createWordCiteBodyState(
			doc,
			body,
			{
				onToggleAccordion: () => { this.reminderState.expanded = !this.reminderState.expanded; this.renderAllBodies(); },
				onSelectFilter: (f) => { this.reminderState.filter = f; this.renderAllBodies(); },
			},
			controller.signal,
		);
		st.setSectionSummary = setSectionSummary;
		this.states.set(body, st);

		const click = (button: HTMLButtonElement, action: () => void) => {
			button.addEventListener('click', () => { if (!button.disabled && !button.hidden) action(); }, { signal: controller.signal });
		};
		click(st.insertBtn, () => this.citeItemsInWord(st.lastItemIDs, win ?? undefined, st));
		click(st.refreshBtn, () => this.kernel.bus.emit('word:refresh-request', { requestId: this.beginRequest('refresh', st), sessionID: this.snapshot?.activeSessionID || undefined, win: win ?? undefined }));
		click(st.docSwitchBtn, () => this.cycleWordSession());
		click(st.groupBtn, () => this.citeItemsInWord(st.lastGroup?.itemIDs || [], win ?? undefined, st));
		click(st.colBtn, () => this.kernel.bus.emit('word:select-collection-request', { sessionID: this.snapshot?.activeSessionID || undefined, win: win ?? undefined }));
		click(st.orphanRefs.accHeadBtn, () => { this.orphanState.accordionOpen = !this.orphanState.accordionOpen; this.renderAllBodies(); });
		click(st.orphanRefs.toggleBtn, () => { this.orphanState.expanded = !this.orphanState.expanded; this.renderAllBodies(); });
		click(st.orphanRefs.actionBtn, () => {
			const keys = this.orphanState.getSelectedRecoverableKeys(this.snapshot?.orphans);
			if (!keys.length) return;
			this.kernel.bus.emit('word:recover-orphans-request', {
				sessionID: this.snapshot?.activeSessionID || undefined, keys, source: 'panel',
				requestId: this.beginRequest('recover', st), win: win ?? undefined,
			});
		});
		this.bindDocumentEvents(doc);
		this.updateState(body, item, setEnabled, setSectionSummary);
		this.hydrateUnloadedCitedItems(this.snapshot?.citedItemIDs);
	}

	private handleReceiptAction(act: ReceiptAction, st: WordCiteBodyState): void {
		const win = st.root.ownerDocument?.defaultView ?? undefined;
		if (act.kind === 'undo-ignore-reminder' && act.reminderKey) {
			this.services.reminders.setIgnored(act.reminderKey, false);
			this.receipt = { text: '', tone: 'none' };
			this.renderAllBodies();
			return;
		}
		if (act.kind === 'refresh-word') {
			if (this.pendingRequest) return;
			this.kernel.bus.emit('word:refresh-request', { requestId: this.beginRequest('refresh', st), sessionID: act.sessionID, win });
			return;
		}
		if (act.kind === 'locate-recovered' && act.itemIDs?.length) {
			if (act.sessionID && this.kernel.prefs.get('wordCite.collections.enable')) {
				this.kernel.bus.emit('word:select-collection-request', { sessionID: act.sessionID, win });
			}
			const pane = (win as any)?.ZoteroPane;
			if (typeof pane?.selectItems === 'function') {
				setTimeout(() => { void Promise.resolve(pane.selectItems(act.itemIDs)).catch(() => {}); }, 80);
			} else {
				void locateItemInZoteroLibrary(act.itemIDs[0], { win: win ?? null, switchCollection: true });
			}
		}
	}

	private handleLocateReminder(itemID: number, st: WordCiteBodyState, zh: boolean): void {
		const win = st.root.ownerDocument?.defaultView ?? null;
		void locateItemInZoteroLibrary(itemID, { win, switchCollection: false }).then((ok) => {
			if (!ok) return locateItemInZoteroLibrary(itemID, { win, switchCollection: true });
			return true;
		});
		this.receiptOwner = st;
		this.receipt = {
			tone: 'ok',
			text: zh ? '✓ 已定位到文献条目，可在「信息」页核对补全' : '✓ Located item; complete missing fields in Info pane',
			stickyUntil: Date.now() + 4_000,
		};
		this.renderAllBodies();
	}

	private handleIgnoreReminder(rec: ReminderItemRecord, st: WordCiteBodyState, zh: boolean): void {
		const key = this.services.reminders.setIgnored(rec.cacheKey, true);
		this.reminderState.lastUndoKey = key;
		this.receiptOwner = st;
		this.receipt = formatIgnoreReminderReceipt(key, zh);
		this.renderAllBodies();
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

	private cycleWordSession(): void {
		const sessions = this.snapshot?.sessions || [];
		if (sessions.length < 2) return;
		const curIdx = sessions.findIndex((s) => s.sessionID === this.snapshot?.activeSessionID);
		const next = sessions[(curIdx + 1) % sessions.length];
		if (next) this.kernel.bus.emit('word:switch-session-request', { sessionID: next.sessionID });
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
		const enabled = this.isSectionEnabled() && items.length > 0;
		setEnabled?.(enabled);
		st.lastItemIDs = enabled ? items.map((it) => Number(it.id)) : [];
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
		const orphanCb: OrphanDomCallbacks = {
			onToggleAccordion: () => { this.orphanState.accordionOpen = !this.orphanState.accordionOpen; this.renderAllBodies(); },
			onToggleItem: (key) => { this.orphanState.toggleKey(key); this.renderAllBodies(); },
			onToggleExpand: () => { this.orphanState.expanded = !this.orphanState.expanded; this.renderAllBodies(); },
			onReceiptAction: (act) => this.handleReceiptAction(act, st),
			onDismissReceipt: () => { this.receipt = { text: '', tone: 'none' }; this.renderAllBodies(); },
		};
		renderWordCitePanel(st, vm, orphanCb, {
			onLocateItem: (itemID) => this.handleLocateReminder(itemID, st, zh),
			onIgnoreItem: (rec) => this.handleIgnoreReminder(rec, st, zh),
			onRestoreItem: (rec) => { this.services.reminders.setIgnored(rec.cacheKey, false); this.renderAllBodies(); },
		});
	}
}
