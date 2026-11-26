import { applyStatusMessage, ensureSectionConnected, syncCompareBar, createXhtmlEl as el } from './pdf-preview-ui.ts';
import {
	buildPreviewSlots, jumpToPreviewPage, syncPreviewControls, type PreviewState,
} from './pdf-page-pool.ts';
import {
	openPdfDocumentFromFile, pickCompareAttachment, resolveAttachmentPath, resolveSameItemPdfContext,
} from './pdf-renderer.ts';

export {
	buildPreviewSlots, invalidateVisibleSlots, jumpToPreviewPage, nearestPreviewPage,
	renderPageSlot, syncPreviewControls, type PageSlot, type PreviewState,
} from './pdf-page-pool.ts';

export function disposePreviewDocument(state: PreviewState, clearAttachments = false): void {
	if (state.loadTimer) {
		clearTimeout(state.loadTimer);
		state.loadTimer = null;
	}
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

export async function loadAttachmentPreviewDoc(
	state: PreviewState,
	att: any,
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
		buildPreviewSlots(state, gen, onError);
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
	const ids: number[] = ownerRef?.getAttachments?.() ?? [];
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
	onError: (err: unknown) => void,
): Promise<void> {
	disposePreviewDocument(state, true);
	const gen = state.generation;
	if (!item) { applyStatusMessage(state.statusEl, 'zbf-pdf-preview-unavailable'); return; }
	state.loading = true;
	applyStatusMessage(state.statusEl, 'zbf-pdf-preview-loading');
	const isReader = state.compare.tabType === 'reader';
	let ctx;
	try {
		ctx = await resolveSameItemPdfContext(item, state.win);
	} catch (error) {
		if (state.generation === gen) {
			state.loading = false;
			applyStatusMessage(state.statusEl, 'zbf-pdf-preview-error');
			onError(error);
		}
		return;
	}
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
	await loadAttachmentPreviewDoc(state, chosen.attachment, onError);
}
