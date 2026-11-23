import {
	formatCompactPdfOptionLabel,
	formatPdfAttachmentDisplayTitle,
	getPdfAttachmentSortRank,
	normalizeToRegularItemAsync,
} from '../../services/item-resolution.ts';

export interface PdfViewport {
	width: number;
	height: number;
}

export interface PdfRenderTask {
	promise: Promise<void>;
	cancel?: () => void;
}

export interface PdfPageProxy {
	getViewport(params: { scale: number }): PdfViewport;
	render(params: {
		canvasContext: CanvasRenderingContext2D;
		viewport: PdfViewport;
		transform?: number[];
	}): PdfRenderTask;
	cleanup?: () => void;
}

export interface PdfDocumentProxy {
	numPages: number;
	getPage(pageNumber: number): Promise<PdfPageProxy>;
	destroy?: () => Promise<void> | void;
}

export interface PdfJsLib {
	GlobalWorkerOptions?: { workerSrc?: string };
	getDocument(src: Record<string, unknown>): {
		promise: Promise<PdfDocumentProxy>;
		destroy?: () => Promise<void> | void;
	};
}

export interface PdfAttachmentEntry {
	id: number;
	title: string;
	shortLabel?: string;
	fullTitle?: string;
	attachment: any;
}

export type CompareMode = 'sibling' | 'self';

export interface SameItemPdfContext {
	ownerID: number;
	currentAttachmentID: number;
	entries: PdfAttachmentEntry[];
}

const PDFJS_MODULE_URL = 'resource://zotero/reader/pdf/build/pdf.mjs';
const PDFJS_WORKER_URL = 'resource://zotero/reader/pdf/build/pdf.worker.mjs';
const PDFJS_CMAP_URL = 'resource://zotero/reader/pdf/web/cmaps/';
const PDFJS_FONT_URL = 'resource://zotero/reader/pdf/web/standard_fonts/';

let cachedPdfJsLib: PdfJsLib | null = null;

function isPdfAttachment(att: any): boolean {
	if (!att || att.deleted || att.isTrashed?.()) return false;
	if (typeof att.isPDFAttachment === 'function') return Boolean(att.isPDFAttachment());
	if (att.isFileAttachment?.() === false) return false;
	const mime = String(att.attachmentContentType || '').toLowerCase();
	if (mime === 'application/pdf') return true;
	const name = String(att.attachmentFilename || att.getField?.('title') || '').toLowerCase();
	return name.endsWith('.pdf');
}

const resolveOwnerRegularItem = async (it: any) => (await normalizeToRegularItemAsync(it)) || it;

export async function resolveAllPdfAttachments(item: any): Promise<PdfAttachmentEntry[]> {
	if (!item || item.deleted || item.isTrashed?.()) return [];
	const target = await resolveOwnerRegularItem(item);
	if (!target || target.deleted || target.isTrashed?.()) return [];
	const rawAtts: any[] = [];
	const seen = new Set<number>();
	const pushIfPdf = (att: any) => {
		if (!isPdfAttachment(att)) return;
		const id = Number(att.id) || rawAtts.length + 1;
		if (seen.has(id)) return;
		seen.add(id);
		rawAtts.push(att);
	};
	if (isPdfAttachment(target) && !target.isRegularItem?.()) {
		pushIfPdf(target);
	} else {
		const best = await target.getBestAttachment?.().catch(() => null);
		pushIfPdf(best);
		const ids: number[] = target.getAttachments?.() || [];
		const hostItems = (globalThis as any).Zotero?.Items;
		if (ids.length && hostItems?.getAsync) {
			const batch = await hostItems.getAsync(ids).catch(() => null);
			if (Array.isArray(batch)) {
				for (const att of batch) pushIfPdf(att);
			}
		}
		for (const rawId of ids) {
			const id = Number(rawId) || 0;
			if (!id || seen.has(id)) continue;
			const att = hostItems?.get?.(id) || (hostItems?.getAsync ? await hostItems.getAsync(id).catch(() => null) : null);
			pushIfPdf(att);
		}
		if (isPdfAttachment(item)) pushIfPdf(item);
	}
	const bestID = Number((await target.getBestAttachment?.().catch(() => null))?.id || 0);
	const ranked = rawAtts.map((att, origIdx) => {
		const id = Number(att.id) || origIdx + 1;
		const rawTitle = String(att?.getField?.('title') || '').trim();
		const filename = String(att?.attachmentFilename || '').trim();
		const rank = getPdfAttachmentSortRank(rawTitle, filename, id === bestID);
		return { att, id, rawTitle, filename, rank, origIdx };
	});
	ranked.sort((a, b) => (a.rank - b.rank) || (a.origIdx - b.origIdx));
	const titleCounts = new Map<string, number>();
	for (const r of ranked) {
		if (r.rawTitle) titleCounts.set(r.rawTitle.toLowerCase(), (titleCounts.get(r.rawTitle.toLowerCase()) || 0) + 1);
	}
	return ranked.map((r, idx) => {
		const hasDup = Boolean(r.rawTitle && (titleCounts.get(r.rawTitle.toLowerCase()) || 0) > 1);
		const title = formatPdfAttachmentDisplayTitle(r.rawTitle, r.filename, idx, hasDup);
		const fullTitle = (r.rawTitle && r.filename && r.rawTitle.toLowerCase() !== r.filename.toLowerCase())
			? `${r.rawTitle} (${r.filename})`
			: title;
		return {
			id: r.id,
			title,
			shortLabel: formatCompactPdfOptionLabel(title, 40),
			fullTitle,
			attachment: r.att,
		};
	});
}

export async function resolveSameItemPdfContext(item: any, win?: Window | null): Promise<SameItemPdfContext> {
	if (!item || item.deleted || item.isTrashed?.()) {
		return { ownerID: 0, currentAttachmentID: 0, entries: [] };
	}
	const isAtt = Boolean(item.isAttachment?.() || item.isPDFAttachment?.() || item.itemType === 'attachment' || isPdfAttachment(item));
	const container = await resolveOwnerRegularItem(item);
	const ownerID = Number(container?.id || item.id) || 0;
	const entries = await resolveAllPdfAttachments(container || item);
	let currentAttachmentID = isAtt ? (Number(item.id) || 0) : 0;
	if (!currentAttachmentID) {
		const hostZotero = (globalThis as any).Zotero;
		const targetWin: any = win || hostZotero?.getMainWindow?.() || null;
		const selectedTabID = String(targetWin?.Zotero_Tabs?.selectedID || '');
		const readerAttID = Number(
			hostZotero?.Reader?.getByTabID?.(selectedTabID)?.itemID
			|| targetWin?.Zotero_Tabs?._tabs?.find?.((t: any) => t?.id === selectedTabID)?.data?.itemID
			|| 0,
		);
		if (readerAttID > 0 && entries.some((entry) => entry.id === readerAttID)) {
			currentAttachmentID = readerAttID;
		}
	}
	return { ownerID, currentAttachmentID, entries };
}

export function pickCompareAttachment(
	ctx: SameItemPdfContext,
	mode: CompareMode,
	explicitAttachmentID: number | null,
	tabType: 'library' | 'reader' = 'library',
): PdfAttachmentEntry | null {
	if (!ctx.entries.length) return null;
	if (ctx.entries.length === 1) return ctx.entries[0];
	if (explicitAttachmentID) {
		const exact = ctx.entries.find((e) => e.id === explicitAttachmentID);
		if (exact) return exact;
	}
	if (tabType === 'library') {
		if (ctx.currentAttachmentID) {
			return ctx.entries.find((e) => e.id === ctx.currentAttachmentID) ?? ctx.entries[0];
		}
		return ctx.entries[0];
	}
	if (mode === 'self' && ctx.currentAttachmentID) {
		return ctx.entries.find((e) => e.id === ctx.currentAttachmentID) ?? ctx.entries[0];
	}
	if (ctx.currentAttachmentID) {
		return ctx.entries.find((e) => e.id !== ctx.currentAttachmentID) ?? ctx.entries[0];
	}
	return ctx.entries[0];
}

export async function resolveAttachmentPath(att: any): Promise<string | null> {
	if (!att) return null;
	const p = (await att.getFilePathAsync?.().catch(() => null)) || att.getFilePath?.();
	return typeof p === 'string' && p.trim() ? p : null;
}

function binaryStringToUint8Array(raw: string): Uint8Array {
	const bytes = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 0xff;
	return bytes;
}

async function readPdfBytes(filePath: string): Promise<Uint8Array> {
	const zotero = (globalThis as any).Zotero;
	const ioUtils = (globalThis as any).IOUtils || zotero?.getMainWindow?.()?.IOUtils;
	if (ioUtils?.read) {
		const data = await ioUtils.read(filePath);
		return data instanceof Uint8Array ? data : new Uint8Array(data);
	}
	if (zotero?.File?.getBinaryContentsAsync) {
		const raw = await zotero.File.getBinaryContentsAsync(filePath);
		return raw instanceof Uint8Array ? raw : binaryStringToUint8Array(String(raw || ''));
	}
	throw new Error('No file reader available for PDF preview');
}

function tryImportModule(cu: any, url: string): any {
	if (!cu?.importESModule) return null;
	for (const opts of [{ global: 'current' }, null] as const) {
		try {
			const mod = opts !== null ? cu.importESModule(url, opts) : cu.importESModule(url);
			if (mod) return mod;
		} catch { /* fallback */ }
	}
	return null;
}

async function loadPdfJsLib(win?: Window | null): Promise<PdfJsLib> {
	if (cachedPdfJsLib) return cachedPdfJsLib;
	const zotero = (globalThis as any).Zotero;
	const hostWin = (win || zotero?.getMainWindow?.()) as any;
	if (hostWin && !(globalThis as any).window) {
		try {
			(globalThis as any).window = hostWin;
			(globalThis as any).document = hostWin.document;
		} catch { /* ignore */ }
	}
	const winCu = hostWin?.ChromeUtils;
	const globalCu = (globalThis as any).ChromeUtils;
	const workerMod = tryImportModule(winCu, PDFJS_WORKER_URL) || tryImportModule(globalCu, PDFJS_WORKER_URL);
	if (workerMod) {
		try {
			(globalThis as any).pdfjsWorker = workerMod;
			if (hostWin) hostWin.pdfjsWorker = workerMod;
		} catch { /* ignore */ }
	}
	let mod: PdfJsLib | null =
		(tryImportModule(winCu, PDFJS_MODULE_URL) as PdfJsLib | null) ||
		(tryImportModule(globalCu, PDFJS_MODULE_URL) as PdfJsLib | null);
	if (typeof mod?.getDocument !== 'function') {
		try {
			mod = (await (new Function('u', 'return import(u)')(PDFJS_MODULE_URL))) as PdfJsLib;
		} catch {
			mod = null;
		}
	}
	if (typeof mod?.getDocument !== 'function') throw new Error('Failed to load Zotero PDF.js module');
	if (mod.GlobalWorkerOptions && !mod.GlobalWorkerOptions.workerSrc) {
		mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
	}
	cachedPdfJsLib = mod;
	return mod;
}

export async function openPdfDocumentFromFile(filePath: string, doc?: Document | null): Promise<PdfDocumentProxy> {
	const win = doc?.defaultView || ((globalThis as any).Zotero?.getMainWindow?.() as Window | undefined);
	const ownerDocument = doc || win?.document;
	const [pdfjsLib, data] = await Promise.all([loadPdfJsLib(win), readPdfBytes(filePath)]);
	const loadingTask = pdfjsLib.getDocument({
		data,
		ownerDocument,
		isEvalSupported: false,
		useWorkerFetch: false,
		cMapUrl: PDFJS_CMAP_URL,
		cMapPacked: true,
		standardFontDataUrl: PDFJS_FONT_URL,
	});
	return await loadingTask.promise;
}

export async function renderPageToCanvas(
	pdfDoc: PdfDocumentProxy,
	pageNumber: number,
	canvas: HTMLCanvasElement,
	targetWidth: number,
	zoomRatio: number,
	dpr: number,
	isAborted: () => boolean,
	onTask?: (cancel: () => void) => void,
): Promise<{ width: number; height: number }> {
	const page = await pdfDoc.getPage(pageNumber);
	if (isAborted()) {
		page.cleanup?.();
		return { width: 0, height: 0 };
	}
	const baseViewport = page.getViewport({ scale: 1 });
	const safeWidth = Math.max(120, targetWidth);
	const cssScale = (safeWidth / Math.max(1, baseViewport.width)) * zoomRatio;
	const cssViewport = page.getViewport({ scale: cssScale });
	const pixelRatio = Math.max(1.25, Math.min(3, (dpr || 1) * 1.15));

	canvas.width = Math.max(1, Math.floor(cssViewport.width * pixelRatio));
	canvas.height = Math.max(1, Math.floor(cssViewport.height * pixelRatio));
	if (Math.abs(zoomRatio - 1) < 0.01) {
		canvas.style.width = '100%';
		canvas.style.height = 'auto';
	} else {
		canvas.style.width = `${Math.floor(cssViewport.width)}px`;
		canvas.style.height = `${Math.floor(cssViewport.height)}px`;
	}

	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
	if (!ctx) throw new Error('Canvas 2D context unavailable');
	const transform = pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0];
	const task = page.render({ canvasContext: ctx, viewport: cssViewport, transform });
	onTask?.(() => { try { task.cancel?.(); } catch { /* ignore */ } });
	try {
		await task.promise;
	} catch (err: any) {
		if (err?.name === 'RenderingCancelledException' || isAborted()) return { width: 0, height: 0 };
		throw err;
	} finally {
		page.cleanup?.();
	}
	return { width: Math.floor(cssViewport.width), height: Math.floor(cssViewport.height) };
}

export async function openPdfInReader(att: any, win?: Window | null, pageNumber?: number): Promise<boolean> {
	if (!att?.id) return false;
	const zotero = (globalThis as any).Zotero;
	const location = typeof pageNumber === 'number' && pageNumber > 1 ? { pageIndex: pageNumber - 1 } : undefined;
	try {
		if (zotero?.Reader?.open) {
			try {
				await zotero.Reader.open(att.id, location, { openInWindow: false });
			} catch {
				await zotero.Reader.open(att.id, undefined, { openInWindow: false });
			}
			return true;
		}
		const targetWin = (win as any)?.ZoteroPane ? win : zotero?.getMainWindow?.();
		if ((targetWin as any)?.ZoteroPane?.viewAttachment) {
			await (targetWin as any).ZoteroPane.viewAttachment([att.id]);
			return true;
		}
	} catch (error) {
		zotero?.logError?.(error instanceof Error ? error : new Error(String(error)));
	}
	return false;
}
