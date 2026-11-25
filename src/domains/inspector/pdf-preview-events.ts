import { openPdfInReader } from './pdf-renderer.ts';
import {
	invalidateVisibleSlots, jumpToPreviewPage,
	loadAttachmentPreviewDoc, nearestPreviewPage, syncPreviewControls, type PreviewState,
} from './pdf-viewport-manager.ts';
import { evictDistantPageCanvases, openPageJumpInput, syncCompareBar } from './pdf-preview-ui.ts';
import { syncNeighborCompareButtons, type NeighborCompareControls } from './pdf-compare-helpers.ts';
import type { ReaderNeighborsPayload } from '../../kernel/types.ts';

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.2;

export interface PreviewToolbarActions {
	isDblClickOpen: () => boolean;
	onToggleFullMode: (state: PreviewState) => void;
	getLatestNeighbors: () => ReaderNeighborsPayload | null;
	getNeighborCtrl: (body: HTMLElement) => NeighborCompareControls | undefined;
	onRenderError: (err: unknown) => void;
}

export function setPreviewZoom(state: PreviewState, nextZoom: number, onError: (err: unknown) => void): void {
	const clamped = Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom)) * 100) / 100;
	if (clamped === state.zoom) return;
	state.zoom = clamped;
	syncPreviewControls(state);
	invalidateVisibleSlots(state, onError);
}

export function updatePreviewPageFromScroll(state: PreviewState): void {
	if (!state.slots.length) return;
	const top = state.viewportEl.scrollTop + (state.slots[0]?.card.offsetTop || 0);
	const best = nearestPreviewPage(state.slots, top);
	if (best !== state.currentPage) {
		state.currentPage = best;
		const attID = Number(state.attachment?.id) || 0;
		if (attID > 0) state.pageByAttachment.set(attID, best);
		syncPreviewControls(state);
		evictDistantPageCanvases(state.slots, state.currentPage);
	}
}

export function bindPreviewToolbar(
	state: PreviewState,
	zoomOutBtn: HTMLButtonElement,
	zoomInBtn: HTMLButtonElement,
	modeBtn: HTMLButtonElement,
	signal: AbortSignal,
	actions: PreviewToolbarActions,
): void {
	const opts = { signal };
	state.prevBtn.addEventListener('click', () => jumpToPreviewPage(state, state.currentPage - 1, actions.onRenderError), opts);
	state.nextBtn.addEventListener('click', () => jumpToPreviewPage(state, state.currentPage + 1, actions.onRenderError), opts);
	zoomOutBtn.addEventListener('click', () => setPreviewZoom(state, state.zoom - ZOOM_STEP, actions.onRenderError), opts);
	zoomInBtn.addEventListener('click', () => setPreviewZoom(state, state.zoom + ZOOM_STEP, actions.onRenderError), opts);
	state.zoomLabel.addEventListener('click', () => setPreviewZoom(state, 1, actions.onRenderError), opts);
	modeBtn.addEventListener('click', () => actions.onToggleFullMode(state), opts);
	state.openBtn.addEventListener('click', () => state.attachment && void openPdfInReader(state.attachment, state.win, state.currentPage || 1), opts);

	const selectAttachmentById = (attId: number) => {
		const chosen = state.attachments.find((entry) => entry.id === attId);
		if (!chosen) return;
		const ctrl = actions.getNeighborCtrl(state.body);
		if (ctrl) ctrl.activeSide = null;
		const prevId = Number(state.compare.pickedAttachmentID || state.attachment?.id || 0);
		if (prevId && prevId !== chosen.id) state.compare.lastAttachmentID = prevId;
		state.compare.pickedAttachmentID = chosen.id;
		state.attSelect.value = String(chosen.id);
		syncCompareBar(state.compareUI, state.compare, state.attachments, chosen.id);
		if (ctrl) syncNeighborCompareButtons(ctrl, state.compareUI.bar, state.compare.tabType, state.attachments.length, actions.getLatestNeighbors());
		if (chosen.attachment !== state.attachment) {
			void loadAttachmentPreviewDoc(state, chosen.attachment, actions.onRenderError);
		}
	};
	state.attSelect.addEventListener('change', () => selectAttachmentById(Number(state.attSelect.value || 0)), opts);
	state.doc.addEventListener('zbf:pdf-folder-attachment-selected', ((ev: CustomEvent) => {
		const owner = state.body.closest?.('item-details') || null;
		if (ev?.detail?.owner && owner && ev.detail.owner !== owner) return;
		selectAttachmentById(Number(ev?.detail?.attachmentID || 0));
	}) as EventListener, opts);
	state.pageLabel.addEventListener('click', () => openPageJumpInput(state.doc, state.pageLabel, state.currentPage, state.numPages, (p) => jumpToPreviewPage(state, p, actions.onRenderError)), opts);
	state.viewportEl.addEventListener('scroll', () => updatePreviewPageFromScroll(state), opts);
	state.viewportEl.addEventListener('dblclick', (event: MouseEvent) => {
		if (!state.attachment || !actions.isDblClickOpen()) return;
		event.preventDefault?.();
		event.stopPropagation?.();
		const card = (event.target as Element | null)?.closest?.('[data-page-number]');
		void openPdfInReader(state.attachment, state.win, Number(card?.getAttribute?.('data-page-number')) || state.currentPage || 1);
	}, opts);
	state.viewportEl.addEventListener('keydown', (event: KeyboardEvent) => {
		if (!state.numPages) return;
		const k = event.key;
		if (k === 'PageDown' || k === 'ArrowRight') { event.preventDefault?.(); jumpToPreviewPage(state, state.currentPage + 1, actions.onRenderError); }
		else if (k === 'PageUp' || k === 'ArrowLeft') { event.preventDefault?.(); jumpToPreviewPage(state, state.currentPage - 1, actions.onRenderError); }
		else if (k === 'Home' || k === 'End') { event.preventDefault?.(); jumpToPreviewPage(state, k === 'Home' ? 1 : state.numPages, actions.onRenderError); }
		else if ((event.ctrlKey || event.metaKey) && k === '0') { event.preventDefault?.(); setPreviewZoom(state, 1, actions.onRenderError); }
	}, opts);
	state.viewportEl.addEventListener('wheel', (e: WheelEvent) => {
		if (e.ctrlKey || e.metaKey) { e.preventDefault(); setPreviewZoom(state, state.zoom + (e.deltaY < 0 ? 0.1 : -0.1), actions.onRenderError); }
	}, { signal, passive: false });
}

export function setupPreviewResizeObserver(state: PreviewState, onError: (err: unknown) => void): void {
	const RO = (state.win as Window & typeof globalThis).ResizeObserver;
	if (!RO) return;
	state.resizeObserver = new RO(() => {
		const width = state.viewportEl.clientWidth || state.body.clientWidth || 0;
		if (!width || !state.pdfDoc || Math.abs(width - state.lastWidth) < 8) return;
		state.lastWidth = width;
		if (state.resizeTimer !== null) state.win.clearTimeout(state.resizeTimer);
		state.resizeTimer = state.win.setTimeout(() => { state.resizeTimer = null; invalidateVisibleSlots(state, onError); }, 120);
	});
	state.resizeObserver.observe(state.viewportEl);
}
