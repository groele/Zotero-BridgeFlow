import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../kernel/types.ts';
import { normalizeToRegularItemAsync, resolvePdfAttachments, type ResolvedPdfAttachment } from '../../services/item-resolution.ts';
import { normalizePanePosition } from '../../services/pane-positioner.ts';
import type { ServiceContainer } from '../../services/service-container.ts';
import { ensurePdfPreviewStyles, removePdfPreviewStyles } from './pdf-preview-styles.ts';
import {
	applyPreviewLayoutMode, applyStatusMessage, bindPreviewSidenavClick, type CompareState,
	createCompareBar, createToolBtn as toolBtn, createXhtmlEl as el, ensureSectionConnected,
	evictDistantPageCanvases, openPageJumpInput, syncCompareBar,
} from './pdf-preview-ui.ts';
import { openPdfInReader, pickCompareAttachment } from './pdf-renderer.ts';
import {
	disposePreviewDocument, invalidateVisibleSlots, jumpToPreviewPage,
	loadAttachmentPreviewDoc, loadItemPreviewAttachments, syncPreviewControls, type PreviewState,
} from './pdf-viewport-manager.ts';

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.2;

type SectionUpdate = { body: HTMLElement; item?: any; tabType?: string; setEnabled?: (enabled: boolean) => void; setSectionSummary?: (summary: string) => void };
type SectionInitProps = SectionUpdate & { doc?: Document };

export class PdfPreviewSectionController {
	private unregisterFn: Disposable | null = null;
	private prefSub: Disposable | null = null;
	private readonly states = new Map<HTMLElement, PreviewState>();
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
		if (!this.prefSub) {
			this.prefSub = this.kernel.prefs.observeKeys(
				['inspector.pdfPreview.mode', 'inspector.pdfPreview.defaultZoom', 'inspector.pdfPreview.showPageBadge', 'inspector.pdfPreview.enable'],
				(changedKey) => {
					const isFull = this.kernel.prefs.get('inspector.pdfPreview.mode') === 'full' && this.kernel.prefs.get('inspector.pdfPreview.enable');
					const showBadge = this.kernel.prefs.get('inspector.pdfPreview.showPageBadge');
					const defaultZoom = Math.round(this.kernel.prefs.get('inspector.pdfPreview.defaultZoom')) / 100;
					for (const st of this.states.values()) {
						st.fullActive = isFull;
						st.root.setAttribute('data-show-badge', showBadge ? 'true' : 'false');
						if (changedKey === 'inspector.pdfPreview.defaultZoom') st.zoom = defaultZoom;
						applyPreviewLayoutMode(st.body, st.root, st.customSection, isFull);
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
		this.listeners.get(body)?.abort();
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
		const modeBtn = toolBtn(doc, '', 'zbf-pdf-preview-toggle-mode', '', 'toggleMode');
		const openBtn = toolBtn(doc, '在阅读器中打开', 'zbf-pdf-preview-open-reader', 'ztf-pdf-open-btn', 'openReader');
		zoomGroup.append(zoomOutBtn, zoomLabel, zoomInBtn, modeBtn, openBtn);
		const attSelect = el(doc, 'select', 'display:none');
		attSelect.className = 'ztf-pdf-att-select';
		const compare: CompareState = { mode: 'sibling', pickedAttachmentID: null, currentAttachmentID: 0, tabType: tabType || 'library' };
		const compareUI = createCompareBar(doc, controller.signal, () => state.compare, (nextMode, nextPickedID) => {
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
			if (chosen && chosen.attachment !== state.attachment) {
				void loadAttachmentPreviewDoc(state, chosen.attachment, this.isDblClickOpen, this.onRenderError);
			}
		});
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
			fullActive: this.kernel.prefs.get('inspector.pdfPreview.mode') === 'full',
			zoom: Math.round(this.kernel.prefs.get('inspector.pdfPreview.defaultZoom')) / 100,
			currentPage: 0, numPages: 0, lastWidth: 0, resizeTimer: null, resizeObserver: null,
			slots: [], observer: null, statusEl, pageLabel, zoomLabel, prevBtn, nextBtn, openBtn, attSelect, viewportEl, compare, compareUI,
		};
		root.setAttribute('data-show-badge', this.kernel.prefs.get('inspector.pdfPreview.showPageBadge') ? 'true' : 'false');
		this.states.set(body, state);
		ensureSectionConnected(body, root, customSection, collapsible);
		applyPreviewLayoutMode(body, root, customSection, state.fullActive);
		bindPreviewSidenavClick(
			doc,
			controller.signal,
			() => this.kernel.prefs.get('inspector.pdfPreview.mode') === 'full',
			(active) => { state.fullActive = active; applyPreviewLayoutMode(state.body, state.root, state.customSection, active); },
		);
		this.bindToolbar(state, zoomOutBtn, zoomInBtn, modeBtn, controller.signal);
		this.setupResizeObserver(state);
		syncPreviewControls(state);
		this.renderSection(props);
	}

	private isSectionEnabled(tabType?: string): boolean {
		return Boolean(this.kernel.prefs.get('inspector.pdfPreview.enable') && (!tabType || tabType === 'library' || tabType === 'reader'));
	}

	private bindToolbar(state: PreviewState, zoomOutBtn: HTMLButtonElement, zoomInBtn: HTMLButtonElement, modeBtn: HTMLButtonElement, signal: AbortSignal): void {
		const opts = { signal };
		state.prevBtn.addEventListener('click', () => jumpToPreviewPage(state, state.currentPage - 1, this.onRenderError), opts);
		state.nextBtn.addEventListener('click', () => jumpToPreviewPage(state, state.currentPage + 1, this.onRenderError), opts);
		zoomOutBtn.addEventListener('click', () => this.setZoom(state, state.zoom - ZOOM_STEP), opts);
		zoomInBtn.addEventListener('click', () => this.setZoom(state, state.zoom + ZOOM_STEP), opts);
		state.zoomLabel.addEventListener('click', () => this.setZoom(state, 1), opts);
		modeBtn.addEventListener('click', () => {
			const next = this.kernel.prefs.get('inspector.pdfPreview.mode') === 'full' ? 'section' : 'full';
			this.kernel.prefs.set('inspector.pdfPreview.mode', next);
			state.fullActive = next === 'full';
			applyPreviewLayoutMode(state.body, state.root, state.customSection, state.fullActive);
			invalidateVisibleSlots(state, this.onRenderError);
		}, opts);
		state.openBtn.addEventListener('click', () => state.attachment && void openPdfInReader(state.attachment, state.win, state.currentPage || 1), opts);
		const selectAttachmentById = (attId: number) => {
			const chosen = state.attachments.find((entry) => entry.id === attId);
			if (!chosen) return;
			const prevId = Number(state.compare.pickedAttachmentID || state.attachment?.id || 0);
			if (prevId && prevId !== chosen.id) state.compare.lastAttachmentID = prevId;
			state.compare.pickedAttachmentID = chosen.id;
			state.attSelect.value = String(chosen.id);
			syncCompareBar(state.compareUI, state.compare, state.attachments, chosen.id);
			if (chosen.attachment !== state.attachment) {
				void loadAttachmentPreviewDoc(state, chosen.attachment, this.isDblClickOpen, this.onRenderError);
			}
		};
		state.attSelect.addEventListener('change', () => selectAttachmentById(Number(state.attSelect.value || 0)), opts);
		state.doc.addEventListener('zbf:pdf-folder-attachment-selected', ((ev: CustomEvent) => selectAttachmentById(Number(ev?.detail?.attachmentID || 0))) as EventListener, opts);
		state.pageLabel.addEventListener('click', () => openPageJumpInput(state.doc, state.pageLabel, state.currentPage, state.numPages, (p) => jumpToPreviewPage(state, p, this.onRenderError)), opts);
		state.viewportEl.addEventListener('scroll', () => this.updateCurrentPageFromScroll(state), opts);
		state.viewportEl.addEventListener('dblclick', (event: MouseEvent) => {
			if (!state.attachment || !this.isDblClickOpen()) return;
			event.preventDefault?.();
			event.stopPropagation?.();
			const card = (event.target as Element | null)?.closest?.('[data-page-number]');
			void openPdfInReader(state.attachment, state.win, Number(card?.getAttribute?.('data-page-number')) || state.currentPage || 1);
		}, opts);
		state.viewportEl.addEventListener('keydown', (event: KeyboardEvent) => {
			if (!state.numPages) return;
			const k = event.key;
			if (k === 'PageDown' || k === 'ArrowRight') { event.preventDefault?.(); jumpToPreviewPage(state, state.currentPage + 1, this.onRenderError); }
			else if (k === 'PageUp' || k === 'ArrowLeft') { event.preventDefault?.(); jumpToPreviewPage(state, state.currentPage - 1, this.onRenderError); }
			else if (k === 'Home' || k === 'End') { event.preventDefault?.(); jumpToPreviewPage(state, k === 'Home' ? 1 : state.numPages, this.onRenderError); }
			else if ((event.ctrlKey || event.metaKey) && k === '0') { event.preventDefault?.(); this.setZoom(state, 1); }
		}, opts);
		state.viewportEl.addEventListener('wheel', (e: WheelEvent) => {
			if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.setZoom(state, state.zoom + (e.deltaY < 0 ? 0.1 : -0.1)); }
		}, opts);
	}

	private setupResizeObserver(state: PreviewState): void {
		const RO = (state.win as Window & typeof globalThis).ResizeObserver;
		if (!RO) return;
		state.resizeObserver = new RO(() => {
			const width = state.viewportEl.clientWidth || state.body.clientWidth || 0;
			if (!width || !state.pdfDoc || Math.abs(width - state.lastWidth) < 8) return;
			state.lastWidth = width;
			if (state.resizeTimer !== null) state.win.clearTimeout(state.resizeTimer);
			state.resizeTimer = state.win.setTimeout(() => { state.resizeTimer = null; invalidateVisibleSlots(state, this.onRenderError); }, 120);
		});
		state.resizeObserver.observe(state.viewportEl);
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
		applyPreviewLayoutMode(state.body, state.root, state.customSection, state.fullActive && this.kernel.prefs.get('inspector.pdfPreview.mode') === 'full');
		const nextTabType = tabType || 'library';
		const isAtt = Boolean(item?.isAttachment?.() || item?.isPDFAttachment?.() || item?.itemType === 'attachment');
		const ownerRef = (isAtt && item?.parentItem) ? item.parentItem : item;
		const nextAttIdsKey = Array.isArray(ownerRef?.getAttachments?.()) ? ownerRef.getAttachments().join(',') : String(item?.id || '');
		const itemChanged = item !== state.item || nextTabType !== state.compare.tabType || nextAttIdsKey !== state.attIdsKey;
		state.compare.tabType = nextTabType;
		state.attIdsKey = nextAttIdsKey;
		if (!itemChanged && item && (state.pdfDoc || state.loading)) return true;
		const nextOwnerID = isAtt ? Number(item?.parentID || item?.parentItemID || item?.parentItem?.id || 0) : Number(item?.id || 0);
		const sameOwner = nextOwnerID > 0 && nextOwnerID === state.ownerID;
		state.compare.mode = 'sibling';
		state.compare.pickedAttachmentID = isAtt ? (Number(item?.id) || null) : (sameOwner ? state.compare.pickedAttachmentID : null);
		state.compare.currentAttachmentID = 0;
		syncCompareBar(state.compareUI, state.compare, [], 0);
		state.item = item ?? null;
		void loadItemPreviewAttachments(state, state.item, this.isDblClickOpen, this.onRenderError);
		return enabled;
	}

	private setZoom(state: PreviewState, nextZoom: number): void {
		const clamped = Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom)) * 100) / 100;
		if (clamped === state.zoom) return;
		state.zoom = clamped;
		syncPreviewControls(state);
		invalidateVisibleSlots(state, this.onRenderError);
	}

	private updateCurrentPageFromScroll(state: PreviewState): void {
		if (!state.slots.length) return;
		const top = state.viewportEl.scrollTop + (state.slots[0]?.card.offsetTop || 0);
		let best = 1;
		let bestDist = Infinity;
		for (const slot of state.slots) {
			const dist = Math.abs(slot.card.offsetTop - top);
			if (dist < bestDist) { bestDist = dist; best = slot.pageNumber; }
		}
		if (best !== state.currentPage) {
			state.currentPage = best;
			const attID = Number(state.attachment?.id) || 0;
			if (attID > 0) state.pageByAttachment.set(attID, best);
			syncPreviewControls(state);
			evictDistantPageCanvases(state.slots, state.currentPage);
		}
	}
}
