import {
	applyStatusMessage, type CompareBarUI, type CompareState, createXhtmlEl as el,
	ensureSectionConnected, evictDistantPageCanvases, syncCompareBar,
} from './pdf-preview-ui.ts';
import {
	openPdfDocumentFromFile, openPdfInReader, pickCompareAttachment, renderPageToCanvas,
	resolveAllPdfAttachments, resolveAttachmentPath, resolveSameItemPdfContext,
	type PdfAttachmentEntry, type PdfDocumentProxy,
} from './pdf-renderer.ts';

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

export function disposePreviewDocument(state: PreviewState, clearAttachments = false): void {
	const prevAttID = Number(state.attachment?.id) || 0;
	if (prevAttID > 0 && state.currentPage >= 1) {
		state.pageByAttachment.set(prevAttID, state.currentPage);
	}
	state.generation += 1;
	state.loading = false;
	state.observer?.disconnect();
	state.observer = null;
	for (const slot of state.slots) {
		slot.cancelTask?.();
		slot.canvas.width = 0;
		slot.canvas.height = 0;
	}
	state.slots = [];
	state.viewportEl.textContent = '';
	state.currentPage = 0;
	state.numPages = 0;
	state.attachment = null;
	if (clearAttachments) {
		state.attachments = [];
		state.attSelect.textContent = '';
		state.attSelect.style.display = 'none';
	}
	const oldDoc = state.pdfDoc;
	state.pdfDoc = null;
	if (oldDoc?.destroy) void Promise.resolve(oldDoc.destroy()).catch(() => {});
	syncPreviewControls(state);
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

export async function loadAttachmentPreviewDoc(
	state: PreviewState,
	att: any,
	isDblClickOpenEnabled: () => boolean,
	onError: (err: unknown) => void,
): Promise<void> {
	disposePreviewDocument(state, false);
	const gen = state.generation;
	state.loading = true;
	state.attachment = att;
	const nextAttID = Number(att?.id) || 0;
	if (nextAttID > 0 && state.ownerID > 0) {
		try {
			const CustomEv = (state.win as any)?.CustomEvent || CustomEvent;
			state.doc.dispatchEvent?.(new CustomEv('zbf:pdf-attachment-selected', {
				detail: { ownerID: state.ownerID, attachmentID: nextAttID },
			}));
		} catch { /* ignore */ }
	}
	syncPreviewControls(state);
	applyStatusMessage(state.statusEl, 'zbf-pdf-preview-loading');
	try {
		const filePath = await resolveAttachmentPath(att);
		if (state.generation !== gen) return;
		if (!filePath) { state.loading = false; applyStatusMessage(state.statusEl, 'zbf-pdf-preview-missing-file'); return; }
		const pdfDoc = await openPdfDocumentFromFile(filePath, state.doc);
		if (state.generation !== gen) { void Promise.resolve(pdfDoc.destroy?.()).catch(() => {}); return; }
		state.loading = false;
		state.pdfDoc = pdfDoc;
		state.numPages = Math.max(0, pdfDoc.numPages || 0);
		const attID = Number(att?.id) || 0;
		const rememberedPage = attID > 0 ? (state.pageByAttachment.get(attID) || 1) : 1;
		state.currentPage = state.numPages > 0 ? Math.max(1, Math.min(state.numPages, rememberedPage)) : 0;
		ensureSectionConnected(state.body, state.root, state.customSection, state.collapsible);
		if (!state.numPages) { applyStatusMessage(state.statusEl, 'zbf-pdf-preview-unavailable'); return; }
		applyStatusMessage(state.statusEl, '');
		buildSlots(state, gen, isDblClickOpenEnabled, onError);
		if (state.currentPage > 1) {
			jumpToPreviewPage(state, state.currentPage, onError);
		} else {
			syncPreviewControls(state);
		}
	} catch (error) {
		if (state.generation === gen) {
			state.loading = false;
			onError(error);
			applyStatusMessage(state.statusEl, 'zbf-pdf-preview-error');
		}
	}
}

export function computeOwnerAttachmentSignature(item: any): string {
	if (!item) return '';
	const isAtt = Boolean(item.isAttachment?.() || item.isPDFAttachment?.() || item.itemType === 'attachment');
	const ownerRef = (isAtt && item.parentItem) ? item.parentItem : item;
	const ids: number[] = Array.isArray(ownerRef?.getAttachments?.()) ? ownerRef.getAttachments() : [];
	if (!ids.length) return `${Number(item.id) || 0}:${item.getField?.('title') || ''}:${item.attachmentFilename || ''}`;
	const hostItems = (globalThis as any).Zotero?.Items;
	return ids.map((id) => {
		const a = hostItems?.get?.(id);
		return `${id}:${a?.getField?.('title') || ''}:${a?.attachmentFilename || ''}`;
	}).join('|');
}

export async function loadItemPreviewAttachments(
	state: PreviewState,
	item: any,
	isDblClickOpenEnabled: () => boolean,
	onError: (err: unknown) => void,
): Promise<void> {
	disposePreviewDocument(state, true);
	const gen = state.generation;
	if (!item) { applyStatusMessage(state.statusEl, 'zbf-pdf-preview-unavailable'); return; }
	state.loading = true;
	applyStatusMessage(state.statusEl, 'zbf-pdf-preview-loading');
	const isReader = state.compare.tabType === 'reader';
	const ctx = await resolveSameItemPdfContext(item, state.win);
	if (state.generation !== gen) return;
	const entries = ctx.entries;
	state.ownerID = ctx.ownerID;
	state.attachments = entries;
	state.compare.currentAttachmentID = ctx.currentAttachmentID;
	const chosen = entries.length > 0
		? pickCompareAttachment(ctx, state.compare.mode, state.compare.pickedAttachmentID, isReader ? 'reader' : 'library')
		: null;
	syncCompareBar(state.compareUI, state.compare, entries, chosen?.id || 0);
	state.attSelect.textContent = '';
	if (entries.length > 1) {
		entries.forEach((entry, idx) => {
			const opt = el(state.doc, 'option');
			opt.value = String(entry.id);
			opt.textContent = `${idx + 1}. ${entry.title}`;
			state.attSelect.append(opt);
		});
		if (chosen) state.attSelect.value = String(chosen.id);
	}
	state.attSelect.style.display = 'none';
	if (!chosen) {
		state.loading = false;
		ensureSectionConnected(state.body, state.root, state.customSection, state.collapsible);
		applyStatusMessage(state.statusEl, 'zbf-pdf-preview-unavailable');
		return;
	}
	await loadAttachmentPreviewDoc(state, chosen.attachment, isDblClickOpenEnabled, onError);
}

function buildSlots(
	state: PreviewState,
	gen: number,
	isDblClickOpenEnabled: () => boolean,
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
		card.addEventListener('dblclick', (e: MouseEvent) => {
			if (state.attachment && isDblClickOpenEnabled()) {
				e.preventDefault?.();
				e.stopPropagation?.();
				void openPdfInReader(state.attachment, state.win, p);
			}
		});
		card.append(canvas, badge);
		frag.append(card);
		state.slots.push({ pageNumber: p, card, canvas, renderedZoom: null, rendering: false, renderToken: 0, lastHeight: 0 });
	}
	state.viewportEl.append(frag);
	const Observer = (state.win as Window & typeof globalThis).IntersectionObserver;
	if (Observer) {
		state.observer = new Observer((entries) => {
			if (state.generation !== gen) return;
			for (const entry of entries) {
				if (entry.isIntersecting) {
					const slot = state.slots.find((s) => s.card === entry.target);
					if (slot) void renderPageSlot(state, slot, gen, onError);
				}
			}
		}, { root: state.viewportEl, rootMargin: '320px 0px', threshold: 0.01 });
		for (const slot of state.slots) state.observer.observe(slot.card);
	}
	if (state.slots[0]) void renderPageSlot(state, state.slots[0], gen, onError);
	if (state.slots[1]) void renderPageSlot(state, state.slots[1], gen, onError);
}
