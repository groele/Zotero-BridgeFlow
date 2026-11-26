import {
	applyStatusMessage, type CompareBarUI, type CompareState, createXhtmlEl as el,
	evictDistantPageCanvases,
} from './pdf-preview-ui.ts';
import { renderPageToCanvas, type PdfAttachmentEntry, type PdfDocumentProxy } from './pdf-renderer.ts';

export interface PageSlot {
	pageNumber: number;
	card: HTMLDivElement;
	canvas: HTMLCanvasElement;
	renderedZoom: number | null;
	rendering: boolean;
	renderToken: number;
	lastHeight: number;
	cancelTask?: () => void;
}

export interface PreviewState {
	doc: Document;
	win: Window;
	body: HTMLElement;
	root: HTMLDivElement;
	customSection: Element | null;
	collapsible: Element | null;
	setSectionSummary?: (summary: string) => void;
	item: any | null;
	ownerID: number;
	attIdsKey: string;
	attachment: any | null;
	attachments: PdfAttachmentEntry[];
	pageByAttachment: Map<number, number>;
	pdfDoc: PdfDocumentProxy | null;
	loading: boolean;
	generation: number;
	fullActive: boolean;
	zoom: number;
	currentPage: number;
	numPages: number;
	lastWidth: number;
	resizeTimer: number | null;
	loadTimer?: ReturnType<typeof setTimeout> | null;
	lastSwitchAt?: number;
	resizeObserver: ResizeObserver | null;
	slots: PageSlot[];
	observer: IntersectionObserver | null;
	statusEl: HTMLDivElement;
	pageLabel: HTMLSpanElement;
	zoomLabel: HTMLButtonElement;
	prevBtn: HTMLButtonElement;
	nextBtn: HTMLButtonElement;
	openBtn: HTMLButtonElement;
	attSelect: HTMLSelectElement;
	viewportEl: HTMLDivElement;
	compare: CompareState;
	compareUI: CompareBarUI;
}

export function syncPreviewControls(state: PreviewState): void {
	const hasDoc = state.numPages > 0;
	const pageText = hasDoc ? `${state.currentPage} / ${state.numPages}` : '0 / 0';
	state.pageLabel.textContent = pageText;
	state.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
	const attID = Number(state.attachment?.id) || 0;
	const attIdx = attID > 0 ? state.attachments.findIndex((e) => e.id === attID) : -1;
	const summaryText = hasDoc
		? (state.attachments.length > 1 && attIdx >= 0 ? `PDF ${attIdx + 1}/${state.attachments.length} · ${pageText}` : pageText)
		: '';
	state.setSectionSummary?.(summaryText);
	state.prevBtn.disabled = !hasDoc || state.currentPage <= 1;
	state.nextBtn.disabled = !hasDoc || state.currentPage >= state.numPages;
	state.openBtn.disabled = !state.attachment;
}

export async function renderPageSlot(
	state: PreviewState,
	slot: PageSlot,
	gen: number,
	onError: (err: unknown) => void,
): Promise<void> {
	if (!state.pdfDoc || state.generation !== gen || slot.rendering || slot.renderedZoom === state.zoom) return;
	slot.rendering = true;
	const token = ++slot.renderToken;
	try {
		const w = Math.max(180, (state.viewportEl.clientWidth || state.body.clientWidth || 260) - 2);
		state.lastWidth = state.viewportEl.clientWidth || state.body.clientWidth || state.lastWidth;
		const m = await renderPageToCanvas(
			state.pdfDoc,
			slot.pageNumber,
			slot.canvas,
			w,
			state.zoom,
			state.win.devicePixelRatio || 1,
			() => state.generation !== gen || slot.renderToken !== token,
			(c) => { slot.cancelTask = c; },
		);
		if (state.generation === gen && slot.renderToken === token && m.height > 0) {
			slot.lastHeight = m.height;
			slot.card.removeAttribute('data-unrendered');
			slot.card.style.minBlockSize = '0';
			slot.renderedZoom = state.zoom;
		}
	} catch (error) {
		if (state.generation === gen && slot.renderToken === token) onError(error);
	} finally {
		if (slot.renderToken === token) {
			slot.rendering = false;
			slot.cancelTask = undefined;
		}
	}
}

export function invalidateVisibleSlots(state: PreviewState, onError: (err: unknown) => void): void {
	for (const slot of state.slots) {
		slot.renderToken += 1;
		slot.cancelTask?.();
		slot.cancelTask = undefined;
		slot.rendering = false;
		slot.renderedZoom = null;
	}
	const startIdx = Math.max(0, state.currentPage - 2);
	const endIdx = Math.min(state.slots.length, Math.max(2, state.currentPage + 1));
	for (let i = startIdx; i < endIdx; i++) {
		void renderPageSlot(state, state.slots[i], state.generation, onError);
	}
}

export function jumpToPreviewPage(state: PreviewState, pageNumber: number, onError: (err: unknown) => void): void {
	if (!state.numPages) return;
	const target = Math.max(1, Math.min(state.numPages, pageNumber));
	state.currentPage = target;
	const attID = Number(state.attachment?.id) || 0;
	if (attID > 0) state.pageByAttachment.set(attID, target);
	syncPreviewControls(state);
	const slot = state.slots[target - 1];
	if (!slot) return;
	state.viewportEl.scrollTop = Math.max(0, slot.card.offsetTop - (state.slots[0]?.card.offsetTop || 0));
	void renderPageSlot(state, slot, state.generation, onError);
	evictDistantPageCanvases(state.slots, state.currentPage);
}

export function buildPreviewSlots(
	state: PreviewState,
	gen: number,
	onError: (err: unknown) => void,
): void {
	state.viewportEl.textContent = '';
	state.slots = [];
	const frag = state.doc.createDocumentFragment();
	for (let p = 1; p <= state.numPages; p++) {
		const card = el(state.doc, 'div');
		card.className = 'ztf-pdf-page-card';
		card.setAttribute('data-unrendered', 'true');
		card.setAttribute('data-page-number', String(p));
		const canvas = el(state.doc, 'canvas');
		canvas.className = 'ztf-pdf-canvas';
		const badge = el(state.doc, 'span');
		badge.className = 'ztf-pdf-page-badge';
		badge.textContent = String(p);
		card.append(canvas, badge);
		frag.append(card);
		state.slots.push({ pageNumber: p, card, canvas, renderedZoom: null, rendering: false, renderToken: 0, lastHeight: 0 });
	}
	state.viewportEl.append(frag);
	const Observer = (state.win as Window & typeof globalThis).IntersectionObserver;
	if (Observer) {
		const slotByCard = new Map<Element, PageSlot>(state.slots.map((s) => [s.card, s]));
		state.observer = new Observer((entries) => {
			if (state.generation !== gen) return;
			for (const entry of entries) {
				if (entry.isIntersecting) {
					const slot = slotByCard.get(entry.target);
					if (slot) {
						void renderPageSlot(state, slot, gen, onError);
						evictDistantPageCanvases(state.slots, slot.pageNumber, 6);
					}
				}
			}
		}, { root: state.viewportEl, rootMargin: '220px 0px', threshold: 0.01 });
		for (const slot of state.slots) state.observer.observe(slot.card);
	}
	if (state.slots[0]) void renderPageSlot(state, state.slots[0], gen, onError);
	if (state.slots[1]) void renderPageSlot(state, state.slots[1], gen, onError);
}

/** Cards are laid out in page order. Prefer the earlier page at an exact midpoint. */
export function nearestPreviewPage(slots: readonly PageSlot[], top: number): number {
	let low = 0;
	let high = slots.length - 1;
	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		if (slots[mid].card.offsetTop < top) low = mid + 1;
		else high = mid;
	}
	if (low > 0 && top - slots[low - 1].card.offsetTop <= slots[low].card.offsetTop - top) low--;
	return slots[low].pageNumber;
}

export { applyStatusMessage };
