import type { PluginKernel } from '../../../kernel/plugin-kernel.ts';
import type { Disposable, ReaderNeighborsPayload } from '../../../kernel/types.ts';
import { normalizeToRegularItemAsync, resolvePdfAttachments, type ResolvedPdfAttachment } from '../../../services/item-resolution.ts';
import { normalizePanePosition } from '../../../services/pane-positioner.ts';
import type { ServiceContainer } from '../../../services/service-container.ts';
import {
	syncNeighborCompareButtons,
	type NeighborCompareControls,
} from './pdf-compare-helpers.ts';
import { bindPreviewToolbar, setupPreviewResizeObserver } from './pdf-preview-events.ts';
import { buildPdfPreviewShell } from './pdf-preview-nav.ts';
import { ensurePdfPreviewStyles, removePdfPreviewStyles } from './pdf-preview-styles.ts';
import {
	PreviewFocus, applyPreviewLayoutMode, applyStatusMessage, bindPreviewSidenavClick,
	ensureSectionConnected, syncCompareBar,
} from './pdf-preview-ui.ts';
import {
	disposePreviewDocument, invalidateVisibleSlots, loadItemPreviewAttachments, syncPreviewControls, type PreviewState,
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

		const { state, zoomOutBtn, zoomInBtn, modeBtn } = buildPdfPreviewShell({
			doc, win, body, customSection, collapsible, tabType,
			fullActive: this.focus.isActive(body),
			defaultZoom: Math.round(this.kernel.prefs.get('inspector.pdfPreview.defaultZoom')) / 100,
			signal: controller.signal,
			setSectionSummary,
			getAllowNeighbor: () => Boolean(this.kernel.prefs.get('inspector.pdfPreview.neighborCompareEnable')),
			getLatestNeighbors: () => this.latestNeighbors,
			getNeighborCtrl: (b) => this.neighborControls.get(b),
			setNeighborCtrl: (b, ctrl) => { this.neighborControls.set(b, ctrl); },
			onRenderError: this.onRenderError,
		});
		state.root.setAttribute('data-show-badge', this.kernel.prefs.get('inspector.pdfPreview.showPageBadge') ? 'true' : 'false');
		this.states.set(body, state);
		ensureSectionConnected(body, state.root, customSection, collapsible);
		if (state.fullActive && state.collapsible) (state.collapsible as Element & { open: boolean }).open = true;
		applyPreviewLayoutMode(body, state.root, customSection, state.fullActive);
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
		if (!itemChanged && item && (state.pdfDoc || state.loading || state.loadTimer)) return true;
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
		const now = Date.now();
		const rapidScrub = Boolean(item && itemChanged && state.lastSwitchAt && (now - state.lastSwitchAt) < 260);
		if (itemChanged) state.lastSwitchAt = now;
		disposePreviewDocument(state, true);
		const runLoad = () => {
			state.loadTimer = null;
			if (!state.body.isConnected) return;
			void loadItemPreviewAttachments(state, state.item, this.onRenderError).then(() => {
				if (ctrl && state.body.isConnected) {
					const allow = this.kernel.prefs.get('inspector.pdfPreview.neighborCompareEnable');
					syncNeighborCompareButtons(ctrl, state.compareUI.bar, state.compare.tabType, state.attachments.length, allow ? this.latestNeighbors : null);
				}
			});
		};
		if (rapidScrub) {
			state.loadTimer = setTimeout(runLoad, 95);
		} else {
			runLoad();
		}
		return enabled;
	}
}
