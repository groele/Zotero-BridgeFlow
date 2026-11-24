import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { Disposable, ReaderNeighborsPayload } from '../../kernel/types.ts';
import { normalizeToRegularItemAsync, resolvePdfAttachments, type ResolvedPdfAttachment } from '../../services/item-resolution.ts';
import { normalizePanePosition } from '../../services/pane-positioner.ts';
import type { ServiceContainer } from '../../services/service-container.ts';
import {
	activateNeighborComparison, attachNeighborCompareButtons, syncNeighborCompareButtons,
	type NeighborCompareControls, type NeighborSide,
} from './pdf-compare-helpers.ts';
import { bindPreviewToolbar, setupPreviewResizeObserver } from './pdf-preview-events.ts';
import { ensurePdfPreviewStyles, removePdfPreviewStyles } from './pdf-preview-styles.ts';
import {
	PreviewFocus, applyPreviewLayoutMode, applyStatusMessage, bindPreviewSidenavClick, type CompareState,
	createCompareBar, createToolBtn as toolBtn, createXhtmlEl as el, ensureSectionConnected, syncCompareBar,
} from './pdf-preview-ui.ts';
import { pickCompareAttachment } from './pdf-renderer.ts';
import {
	disposePreviewDocument, invalidateVisibleSlots, loadAttachmentPreviewDoc,
	loadItemPreviewAttachments, syncPreviewControls, type PreviewState,
} from './pdf-viewport-manager.ts';

type SectionUpdate = { body: HTMLElement; item?: any; tabType?: string; setEnabled?: (enabled: boolean) => void; setSectionSummary?: (summary: string) => void };
type SectionInitProps = SectionUpdate & { doc?: Document };

export class PdfPreviewSectionController {
	private unregisterFn: Disposable | null = null;
	private prefSub: Disposable | null = null;
	private neighborSub: Disposable | null = null;
	private latestNeighbors: ReaderNeighborsPayload | null = null;
	private focus = new PreviewFocus();
	private readonly states = new Map<HTMLElement, PreviewState>();
	private readonly neighborControls = new Map<HTMLElement, NeighborCompareControls>();
	private readonly listeners = new Map<HTMLElement, AbortController>();
	private readonly kernel: PluginKernel;
	private readonly services: ServiceContainer;

	constructor(kernel: PluginKernel, services: ServiceContainer) {
		this.kernel = kernel;
		this.services = services;
	}

	register(): void {
		if (this.unregisterFn) return;
		const icon = `${this.kernel.info.rootURI}assets/pdf-preview.svg`;
		const sidenavIcon = `${this.kernel.info.rootURI}assets/pdf-preview-sidenav.svg`;
		const reg = this.services.itemPanes.register({
			paneID: 'bridgeflow-pdf-preview',
			pluginID: this.kernel.info.id,
			header: { l10nID: 'zbf-pane-pdf-preview-header', icon },
			sidenav: { l10nID: 'zbf-pane-pdf-preview-sidenav', icon: sidenavIcon, orderable: true },
			onInit: (props: SectionInitProps) => {
				this.onInit(props);
				this.services.panePositions.observeAndQueue(props.body);
			},
			onDestroy: ({ body }: { body: HTMLElement }) => this.onDestroy(body),
			onItemChange: (props: SectionUpdate) => {
				this.services.panePositions.observeAndQueue(props.body);
				return this.renderSection(props);
			},
			onRender: (props: SectionUpdate) => {
				this.services.panePositions.observeAndQueue(props.body);
				this.renderSection(props);
			},
			onToggle: (props: SectionUpdate) => this.renderSection(props),
		});
		this.unregisterFn = reg.dispose;
		if (reg.sectionID) {
			this.services.panePositions.setTarget('pdf-preview', {
				sectionID: reg.sectionID,
				getPosition: () => normalizePanePosition(this.kernel.prefs.get('inspector.pdfPreview.position'), 'zotero-editpane-related'),
			});
		}
		if (!this.neighborSub) {
			this.neighborSub = this.kernel.bus.on('workspace:reader-neighbors-updated', (payload) => {
				this.latestNeighbors = payload;
				const allowNeighbor = this.kernel.prefs.get('inspector.pdfPreview.neighborCompareEnable');
				for (const [b, st] of this.states.entries()) {
					const ctrl = this.neighborControls.get(b);
					if (ctrl) syncNeighborCompareButtons(ctrl, st.compareUI.bar, st.compare.tabType, st.attachments.length, allowNeighbor ? payload : null);
				}
			});
			this.kernel.bus.emit('workspace:reader-neighbors-query', {});
		}
		if (!this.prefSub) {
			this.prefSub = this.kernel.prefs.observeKeys(
				['inspector.pdfPreview.mode', 'inspector.pdfPreview.defaultZoom', 'inspector.pdfPreview.showPageBadge', 'inspector.pdfPreview.enable', 'inspector.pdfPreview.neighborCompareEnable'],
				(changedKey) => {
					const isFull = this.kernel.prefs.get('inspector.pdfPreview.mode') === 'full' && this.kernel.prefs.get('inspector.pdfPreview.enable');
					const showBadge = this.kernel.prefs.get('inspector.pdfPreview.showPageBadge');
					const defaultZoom = Math.round(this.kernel.prefs.get('inspector.pdfPreview.defaultZoom')) / 100;
					const allowNeighbor = this.kernel.prefs.get('inspector.pdfPreview.neighborCompareEnable');
					for (const [b, st] of this.states.entries()) {
						if (changedKey === 'inspector.pdfPreview.mode' || changedKey === 'inspector.pdfPreview.enable') this.focus.set(st, isFull);
						st.root.setAttribute('data-show-badge', showBadge ? 'true' : 'false');
						if (changedKey === 'inspector.pdfPreview.defaultZoom') st.zoom = defaultZoom;
						const ctrl = this.neighborControls.get(b);
						if (ctrl) syncNeighborCompareButtons(ctrl, st.compareUI.bar, st.compare.tabType, st.attachments.length, allowNeighbor ? this.latestNeighbors : null);
						syncPreviewControls(st);
						invalidateVisibleSlots(st, this.onRenderError);
					}
				},
			);
		}
	}

	async resolveSameItemPdfs(item: any): Promise<ResolvedPdfAttachment[]> {
		if (!item) return [];
		const owner = await normalizeToRegularItemAsync(item);
		return resolvePdfAttachments(owner || item);
	}

	unregister(): void {
		this.services.panePositions.setTarget('pdf-preview', null);
		this.prefSub?.();
		this.prefSub = null;
		this.neighborSub?.();
		this.neighborSub = null;
		this.latestNeighbors = null;
		this.neighborControls.clear();
		for (const state of this.states.values()) {
			if (state.resizeTimer !== null) state.win.clearTimeout?.(state.resizeTimer);
			state.resizeObserver?.disconnect();
			applyPreviewLayoutMode(state.body, state.root, state.customSection, false);
			disposePreviewDocument(state, true);
			removePdfPreviewStyles(state.doc);
		}
		for (const controller of this.listeners.values()) controller.abort();
		this.listeners.clear();
		this.states.clear();
		this.focus = new PreviewFocus();
		this.unregisterFn?.();
		this.unregisterFn = null;
	}

	private readonly onRenderError = (err: unknown): void => {
		this.kernel.logger.error('inspector:pdf-preview', err);
	};

	private readonly isDblClickOpen = (): boolean => this.kernel.prefs.get('inspector.pdfPreview.doubleClickOpen');

	private onInit(props: SectionInitProps): void {
		const { body, item, tabType, setEnabled, setSectionSummary } = props;
		const doc = props.doc || body?.ownerDocument;
		const win = doc?.defaultView || ((globalThis as any).Zotero?.getMainWindow?.() as Window | undefined);
		if (!win || !doc || !body) return;
		const customSection = body.closest?.('item-pane-custom-section') || null;
		const collapsible = body.closest?.('collapsible-section') || null;
		setEnabled?.(this.isSectionEnabled(tabType));
		(win as any).MozXULElement?.insertFTLIfNeeded?.('zotero-bridgeflow.ftl');
		ensurePdfPreviewStyles(doc);
		if (this.states.has(body)) this.onDestroy(body);
		const controller = new (win as Window & typeof globalThis).AbortController();
		this.listeners.set(body, controller);
		body.textContent = '';

		const root = el(doc, 'div');
		root.className = 'ztf-pdf-root';
		const toolbar = el(doc, 'div');
		toolbar.className = 'ztf-pdf-toolbar';
		const navGroup = el(doc, 'div');
		navGroup.className = 'ztf-pdf-btn-group';
		const prevBtn = toolBtn(doc, '‹', 'zbf-pdf-preview-prev', '', 'prev');
		const pageLabel = el(doc, 'span');
		pageLabel.className = 'ztf-pdf-page-label';
		pageLabel.textContent = '0 / 0';
		const nextBtn = toolBtn(doc, '›', 'zbf-pdf-preview-next', '', 'next');
		navGroup.append(prevBtn, pageLabel, nextBtn);

		const zoomGroup = el(doc, 'div');
		zoomGroup.className = 'ztf-pdf-btn-group';
		const zoomOutBtn = toolBtn(doc, '−', 'zbf-pdf-preview-zoom-out', '', 'zoomOut');
		const zoomLabel = toolBtn(doc, '100%');
		const zoomInBtn = toolBtn(doc, '+', 'zbf-pdf-preview-zoom-in', '', 'zoomIn');
		const modeBtn = toolBtn(doc, '', 'zbf-pdf-preview-toggle-mode', 'ztf-pdf-mode-btn', 'toggleMode');
		const openBtn = toolBtn(doc, '在阅读器中打开', 'zbf-pdf-preview-open-reader', 'ztf-pdf-open-btn', 'openReader');
		zoomGroup.append(zoomOutBtn, zoomLabel, zoomInBtn, modeBtn, openBtn);
		const attSelect = el(doc, 'select', 'display:none');
		attSelect.className = 'ztf-pdf-att-select';
		const compare: CompareState = { mode: 'sibling', pickedAttachmentID: null, currentAttachmentID: 0, tabType: tabType || 'library' };
		const compareUI = createCompareBar(doc, controller.signal, () => state.compare, (nextMode, nextPickedID) => {
			const ctrl = this.neighborControls.get(body);
			if (ctrl) ctrl.activeSide = null;
			state.compare.mode = nextMode;
			state.compare.pickedAttachmentID = nextPickedID;
			const chosen = pickCompareAttachment(
				{ ownerID: state.ownerID, currentAttachmentID: state.compare.currentAttachmentID, entries: state.attachments },
				nextMode,
				nextPickedID,
				state.compare.tabType === 'reader' ? 'reader' : 'library',
			);
			if (chosen) {
				state.compare.pickedAttachmentID = chosen.id;
				state.attSelect.value = String(chosen.id);
			}
			syncCompareBar(compareUI, state.compare, state.attachments, chosen?.id || 0);
			const allowNeighbor = this.kernel.prefs.get('inspector.pdfPreview.neighborCompareEnable');
			if (ctrl) syncNeighborCompareButtons(ctrl, compareUI.bar, state.compare.tabType, state.attachments.length, allowNeighbor ? this.latestNeighbors : null);
			if (chosen && chosen.attachment !== state.attachment) {
				void loadAttachmentPreviewDoc(state, chosen.attachment, this.onRenderError);
			}
		});
		const neighborCtrl = attachNeighborCompareButtons(doc, compareUI.bar, controller.signal, (side: NeighborSide) => {
			if (neighborCtrl.activeSide === side) {
				neighborCtrl.activeSide = null;
				syncNeighborCompareButtons(neighborCtrl, compareUI.bar, state.compare.tabType, state.attachments.length, this.latestNeighbors);
				const fallback = pickCompareAttachment(
					{ ownerID: state.ownerID, currentAttachmentID: state.compare.currentAttachmentID, entries: state.attachments },
					state.compare.mode, state.compare.pickedAttachmentID, state.compare.tabType === 'reader' ? 'reader' : 'library',
				);
				if (fallback && fallback.attachment !== state.attachment) void loadAttachmentPreviewDoc(state, fallback.attachment, this.onRenderError);
				return;
			}
			void activateNeighborComparison(state, neighborCtrl, side, this.latestNeighbors, this.onRenderError);
		});
		this.neighborControls.set(body, neighborCtrl);
		toolbar.append(navGroup, zoomGroup, attSelect, compareUI.bar);
		const statusEl = el(doc, 'div');
		statusEl.className = 'ztf-pdf-status';
		const viewportEl = el(doc, 'div');
		viewportEl.className = 'ztf-pdf-viewport';
		viewportEl.setAttribute('tabindex', '0');
		root.append(toolbar, statusEl, viewportEl);
		body.append(root);

		const state: PreviewState = {
			doc, win, body, root, customSection, collapsible, setSectionSummary,
			item: null, ownerID: 0, attIdsKey: '', attachment: null, attachments: [], pageByAttachment: new Map<number, number>(),
			pdfDoc: null, loading: false, generation: 0,
			fullActive: this.focus.isActive(body),
			zoom: Math.round(this.kernel.prefs.get('inspector.pdfPreview.defaultZoom')) / 100,
			currentPage: 0, numPages: 0, lastWidth: 0, resizeTimer: null, resizeObserver: null,
			slots: [], observer: null, statusEl, pageLabel, zoomLabel, prevBtn, nextBtn, openBtn, attSelect, viewportEl, compare, compareUI,
		};
		root.setAttribute('data-show-badge', this.kernel.prefs.get('inspector.pdfPreview.showPageBadge') ? 'true' : 'false');
		this.states.set(body, state);
		ensureSectionConnected(body, root, customSection, collapsible);
		if (state.fullActive && state.collapsible) (state.collapsible as Element & { open: boolean }).open = true;
		applyPreviewLayoutMode(body, root, customSection, state.fullActive);
		bindPreviewSidenavClick(
			doc,
			controller.signal,
			body,
			(active) => {
				this.focus.set(state, active);
				if (!active) this.services.panePositions.observeAndQueue(body);
			},
		);
		bindPreviewToolbar(state, zoomOutBtn, zoomInBtn, modeBtn, controller.signal, {
			isDblClickOpen: this.isDblClickOpen,
			onToggleFullMode: (st) => {
				this.focus.set(st, !st.fullActive);
				if (!st.fullActive) this.services.panePositions.observeAndQueue(st.body);
				invalidateVisibleSlots(st, this.onRenderError);
			},
			getLatestNeighbors: () => (this.kernel.prefs.get('inspector.pdfPreview.neighborCompareEnable') ? this.latestNeighbors : null),
			getNeighborCtrl: (b) => this.neighborControls.get(b),
			onRenderError: this.onRenderError,
		});
		setupPreviewResizeObserver(state, this.onRenderError);
		syncPreviewControls(state);
		this.renderSection(props);
	}

	private isSectionEnabled(tabType?: string): boolean {
		return Boolean(this.kernel.prefs.get('inspector.pdfPreview.enable') && (!tabType || tabType === 'library' || tabType === 'reader'));
	}

	private onDestroy(body: HTMLElement): void {
		const state = this.states.get(body);
		if (state) {
			if (state.resizeTimer !== null) state.win.clearTimeout?.(state.resizeTimer);
			state.resizeObserver?.disconnect();
			applyPreviewLayoutMode(state.body, state.root, state.customSection, false);
			disposePreviewDocument(state, true);
		}
		this.states.delete(body);
		this.neighborControls.delete(body);
		this.listeners.get(body)?.abort();
		this.listeners.delete(body);
	}

	private renderSection({ body, item, tabType, setEnabled, setSectionSummary }: SectionUpdate): boolean {
		const enabled = this.isSectionEnabled(tabType);
		setEnabled?.(enabled);
		let state = this.states.get(body);
		if (!state) {
			const doc = body?.ownerDocument;
			if (!doc) return enabled;
			this.onInit({ doc, body, item, tabType, setEnabled, setSectionSummary });
			state = this.states.get(body);
			if (!state) return enabled;
		}
		if (setSectionSummary) state.setSectionSummary = setSectionSummary;
		ensureSectionConnected(state.body, state.root, state.customSection, state.collapsible);
		if (!enabled) {
			state.item = null;
			applyPreviewLayoutMode(state.body, state.root, state.customSection, false);
			disposePreviewDocument(state, true);
			applyStatusMessage(state.statusEl, '');
			return false;
		}
		applyPreviewLayoutMode(state.body, state.root, state.customSection, state.fullActive);
		const nextTabType = tabType || 'library';
		const isAtt = Boolean(item?.isAttachment?.() || item?.isPDFAttachment?.() || item?.itemType === 'attachment');
		const nextAttIdsKey = `${Number(item?.id || 0)}:${(item?.parentItem?.getAttachments?.() || item?.getAttachments?.() || []).join(',')}`;
		const itemChanged = item !== state.item || nextTabType !== state.compare.tabType || nextAttIdsKey !== state.attIdsKey;
		state.compare.tabType = nextTabType;
		state.attIdsKey = nextAttIdsKey;
		if ((state.collapsible as { open?: boolean } | null)?.open === false && !state.fullActive) {
			if (itemChanged || state.loading) disposePreviewDocument(state, true);
			state.item = item ?? null;
			return enabled;
		}
		if (!itemChanged && item && (state.pdfDoc || state.loading)) return true;
		const nextOwnerID = isAtt ? Number(item?.parentID || item?.parentItemID || item?.parentItem?.id || 0) : Number(item?.id || 0);
		const sameOwner = nextOwnerID > 0 && nextOwnerID === state.ownerID;
		state.compare.mode = 'sibling';
		state.compare.pickedAttachmentID = isAtt ? (Number(item?.id) || null) : (sameOwner ? state.compare.pickedAttachmentID : null);
		state.compare.currentAttachmentID = 0;
		const ctrl = this.neighborControls.get(body);
		if (ctrl) ctrl.activeSide = null;
		const allowNeighbor = this.kernel.prefs.get('inspector.pdfPreview.neighborCompareEnable');
		syncCompareBar(state.compareUI, state.compare, [], 0);
		if (ctrl) syncNeighborCompareButtons(ctrl, state.compareUI.bar, nextTabType, 0, allowNeighbor ? this.latestNeighbors : null);
		state.item = item ?? null;
		void loadItemPreviewAttachments(state, state.item, this.onRenderError).then(() => {
			if (ctrl && state.body.isConnected) {
				const allow = this.kernel.prefs.get('inspector.pdfPreview.neighborCompareEnable');
				syncNeighborCompareButtons(ctrl, state.compareUI.bar, state.compare.tabType, state.attachments.length, allow ? this.latestNeighbors : null);
			}
		});
		return enabled;
	}
}
