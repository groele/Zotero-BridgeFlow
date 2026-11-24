import { makeAbortController } from './pdf-cover-queue.ts';

const PDFJS_MODULE_URL = 'resource://zotero/reader/pdf/build/pdf.mjs';
const PDFJS_WORKER_URL = 'resource://zotero/reader/pdf/build/pdf.worker.mjs';
const PDFJS_CMAP_URL = 'resource://zotero/reader/pdf/web/cmaps/';
const PDFJS_FONT_URL = 'resource://zotero/reader/pdf/web/standard_fonts/';

let cachedPdfJs: any = null;

function unwrapWindow(win: any): any {
	if (!win) return undefined;
	try {
		return win.wrappedJSObject ?? win;
	} catch {
		return win;
	}
}

function waitWithSignal<T>(promiseOrVal: Promise<T> | T, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(new Error('aborted'));
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(new Error('aborted'));
		signal.addEventListener('abort', onAbort, { once: true });
		Promise.resolve(promiseOrVal).then(
			(val) => {
				signal.removeEventListener('abort', onAbort);
				if (signal.aborted) reject(new Error('aborted'));
				else resolve(val);
			},
			(err) => {
				signal.removeEventListener('abort', onAbort);
				reject(err);
			},
		);
	});
}

async function pollPreviewValue<T>(probe: () => T | undefined, signal: AbortSignal, timeoutMs = 12_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	while (!signal.aborted && Date.now() < deadline) {
		try {
			const val = probe();
			if (val !== undefined) return val;
		} catch { /* retry */ }
		await waitWithSignal(new Promise((r) => setTimeout(r, 40)), signal);
	}
	throw new Error('preview poll timed out');
}

export async function renderAttachmentPreviewCover(
	attachmentID: number,
	width: number,
	signal: AbortSignal,
	ownerDocument: Document,
	zoteroHost: any,
	waitUntilIdle?: (signal: AbortSignal) => Promise<void>,
): Promise<string | false> {
	if (signal.aborted || !ownerDocument || !Number.isFinite(width) || width <= 0) return false;
	const createXul = (ownerDocument as any).createXULElement;
	if (typeof createXul !== 'function') return false;

	let preview: any = null;
	let renderTask: any = null;
	let pdfDocument: any = null;
	let canvas: HTMLCanvasElement | null = null;
	let continuationTimer: ReturnType<typeof setTimeout> | undefined;
	let disposing = false;
	const pendingPages = new Set<Promise<any>>();
	const trackedDocs = new Set<any>();
	const restores: Array<() => void> = [];

	const trackDoc = (rawDoc: any) => {
		const doc = rawDoc?.wrappedJSObject ?? rawDoc;
		if (!doc || trackedDocs.has(doc) || typeof doc.getPage !== 'function') return;
		trackedDocs.add(doc);
		const orig = doc.getPage;
		const wrapped = function (this: any, pageNum: number) {
			const p = orig.call(this, pageNum);
			pendingPages.add(p);
			void Promise.resolve(p).then(() => pendingPages.delete(p), () => pendingPages.delete(p));
			return p;
		};
		doc.getPage = wrapped;
		restores.push(() => { if (doc.getPage === wrapped) doc.getPage = orig; });
	};

	const onPreviewLoaded = (ev: Event) => {
		if (disposing) return;
		const win = unwrapWindow((ev.target as Document)?.defaultView);
		if (!win) return;
		try { win.PDFViewerApplicationOptions?.set?.('disableAutoFetch', true); } catch { /* ignore */ }
		const app = win.PDFViewerApplication;
		if (app && typeof app.load === 'function') {
			const origLoad = app.load;
			const wrappedLoad = function (this: any, d: any) {
				trackDoc(d);
				return origLoad.call(this, d);
			};
			app.load = wrappedLoad;
			restores.push(() => { if (app.load === wrappedLoad) app.load = origLoad; });
		}
	};

	const cancelRender = () => {
		if (continuationTimer !== undefined) { clearTimeout(continuationTimer); continuationTimer = undefined; }
		try { renderTask?.cancel?.(); } catch { /* ignore */ }
	};
	signal.addEventListener('abort', cancelRender, { once: true });

	try {
		const item = await waitWithSignal(
			zoteroHost?.Items?.getAsync ? zoteroHost.Items.getAsync(attachmentID) : zoteroHost?.Items?.get?.(attachmentID),
			signal,
		);
		if (!item || item.deleted || item.isPDFAttachment?.() === false || typeof item.getFilePathAsync !== 'function') {
			return false;
		}
		const pdfPath = await waitWithSignal(item.getFilePathAsync(), signal);
		if (typeof pdfPath !== 'string' || !pdfPath) return false;
		if (waitUntilIdle) await waitWithSignal(waitUntilIdle(signal), signal);

		preview = createXul.call(ownerDocument, 'attachment-preview');
		if (!preview) return false;
		preview.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:900px;min-width:640px;max-height:none;opacity:0;pointer-events:none;z-index:-1;';
		preview.setAttribute('aria-hidden', 'true');
		preview.setAttribute('tabindex', '-1');
		preview.addEventListener('DOMContentLoaded', onPreviewLoaded, true);
		ownerDocument.documentElement?.appendChild(preview);
		if (!preview._previewInitializePromise?.promise) return false;

		await waitWithSignal(
			Promise.all([
				preview._previewInitializePromise.promise,
				preview._nextPreviewInitializePromise?.promise,
			]),
			signal,
		);
		preview.item = item;
		if (waitUntilIdle) await waitWithSignal(waitUntilIdle(signal), signal);
		await waitWithSignal(preview.render(), signal);

		const status = await pollPreviewValue(() => {
			const v = preview?.getAttribute?.('data-preview-status');
			return v === 'success' || v === 'fail' ? v : undefined;
		}, signal);
		if (status !== 'success') return false;

		const getViewWin = () => unwrapWindow(preview?._reader?._internalReader?._primaryView?._iframeWindow);
		pdfDocument = await pollPreviewValue(() => getViewWin()?.PDFViewerApplication?.pdfDocument ?? undefined, signal);
		trackDoc(pdfDocument);
		if (pdfDocument.loadingParams) pdfDocument.loadingParams.disableAutoFetch = true;

		const rawPage = await waitWithSignal(pdfDocument.getPage(1), signal);
		const page = (rawPage as any)?.wrappedJSObject ?? rawPage;
		const viewWin = getViewWin();
		if (!viewWin) return false;
		const mkOpts = (props: Record<string, unknown>) => Object.assign(new (viewWin.Object ?? Object)(), props);
		const baseVp = page.getViewport(mkOpts({ scale: 1 }));
		if (!Number.isFinite(baseVp?.width) || !Number.isFinite(baseVp?.height) || baseVp.width <= 0 || baseVp.height <= 0) {
			return false;
		}
		const viewport = page.getViewport(mkOpts({ scale: width / baseVp.width }));
		canvas = viewWin.document.createElement('canvas') as HTMLCanvasElement;
		const ctx = canvas.getContext('2d');
		if (!ctx) return false;
		canvas.width = Math.ceil(viewport.width);
		canvas.height = Math.ceil(viewport.height);
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		if (waitUntilIdle) await waitWithSignal(waitUntilIdle(signal), signal);
		renderTask = page.render(mkOpts({ canvasContext: ctx, viewport, intent: 'print' }));
		try {
			renderTask.onContinue = (resume: () => void) => {
				continuationTimer = setTimeout(() => {
					continuationTimer = undefined;
					if (!signal.aborted) resume();
				}, 0);
			};
		} catch { /* cross-compartment Xray safe */ }
		await waitWithSignal(renderTask.promise, signal);
		const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
		return typeof dataUrl === 'string' && dataUrl.startsWith('data:image/jpeg;base64,') ? dataUrl : false;
	} catch {
		return false;
	} finally {
		signal.removeEventListener('abort', cancelRender);
		if (continuationTimer !== undefined) clearTimeout(continuationTimer);
		if (signal.aborted) cancelRender();
		if (canvas) { canvas.width = 0; canvas.height = 0; }
		disposing = true;
		const cleanupCtrl = makeAbortController(ownerDocument.defaultView);
		const cleanupTimer = setTimeout(() => cleanupCtrl.abort(), 2500);
		try {
			const app = unwrapWindow(preview?._reader?._internalReader?._primaryView?._iframeWindow)?.PDFViewerApplication;
			for (const viewer of [app?.pdfViewer, app?.pdfThumbnailViewer]) {
				if (viewer?.forceRendering) viewer.forceRendering = () => false;
			}
			while (pendingPages.size && !cleanupCtrl.signal.aborted) {
				await waitWithSignal(Promise.allSettled([...pendingPages]), cleanupCtrl.signal).catch(() => {});
			}
			const docRef = pdfDocument ?? app?.pdfDocument;
			if (app?.close) await waitWithSignal(app.close(), cleanupCtrl.signal).catch(() => {});
			else if (docRef?.destroy) await waitWithSignal(docRef.destroy(), cleanupCtrl.signal).catch(() => {});
		} catch { /* ignore */ } finally {
			clearTimeout(cleanupTimer);
			try {
				preview?.removeEventListener?.('DOMContentLoaded', onPreviewLoaded, true);
				preview?.destroy?.();
				preview?.remove?.();
			} catch { /* ignore */ }
			for (const fn of restores.reverse()) {
				try { fn(); } catch { /* ignore */ }
			}
		}
	}
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

export async function renderFallbackPdfJsCover(
	attachmentID: number,
	width: number,
	signal: AbortSignal,
	doc: Document,
	zoteroHost: any,
): Promise<string | false> {
	if (signal.aborted || !doc) return false;
	let pdfDoc: any = null;
	let page: any = null;
	try {
		if (!cachedPdfJs) {
			const winCu = (doc.defaultView as any)?.ChromeUtils;
			const globalCu = (globalThis as any).ChromeUtils;
			const workerMod = tryImportModule(winCu, PDFJS_WORKER_URL) || tryImportModule(globalCu, PDFJS_WORKER_URL);
			if (workerMod) {
				try { (globalThis as any).pdfjsWorker = workerMod; } catch { /* ignore */ }
			}
			let mod = tryImportModule(winCu, PDFJS_MODULE_URL) || tryImportModule(globalCu, PDFJS_MODULE_URL);
			if (typeof mod?.getDocument !== 'function') {
				try { mod = await (new Function('u', 'return import(u)')(PDFJS_MODULE_URL)); } catch { mod = null; }
			}
			if (typeof mod?.getDocument === 'function') {
				if (mod.GlobalWorkerOptions && !mod.GlobalWorkerOptions.workerSrc) mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
				cachedPdfJs = mod;
			}
		}
		if (!cachedPdfJs) return false;
		const att = zoteroHost?.Items?.get?.(attachmentID) || (await zoteroHost?.Items?.getAsync?.(attachmentID));
		const path = (await att?.getFilePathAsync?.().catch(() => null)) || att?.getFilePath?.();
		const ioUtils = (globalThis as any).IOUtils || zoteroHost?.getMainWindow?.()?.IOUtils;
		if (!path || !ioUtils?.read || signal.aborted) return false;
		const raw = await ioUtils.read(path);
		const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
		if (!bytes.length || signal.aborted) return false;
		pdfDoc = await cachedPdfJs.getDocument({
			data: bytes, ownerDocument: doc, isEvalSupported: false, useWorkerFetch: false,
			cMapUrl: PDFJS_CMAP_URL, cMapPacked: true, standardFontDataUrl: PDFJS_FONT_URL,
		}).promise;
		page = await pdfDoc.getPage(1);
		const baseVp = page.getViewport({ scale: 1 });
		const vp = page.getViewport({ scale: width / Math.max(1, baseVp.width) });
		const c = doc.createElementNS('http://www.w3.org/1999/xhtml', 'canvas') as HTMLCanvasElement;
		c.width = Math.max(1, Math.ceil(vp.width));
		c.height = Math.max(1, Math.ceil(vp.height));
		const ctx = c.getContext('2d');
		if (!ctx) return false;
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, c.width, c.height);
		await page.render({ canvasContext: ctx, viewport: vp }).promise;
		const url = c.toDataURL('image/jpeg', 0.88);
		return url.startsWith('data:image/') ? url : false;
	} catch {
		return false;
	} finally {
		try { page?.cleanup?.(); } catch { /* ignore */ }
		try { await pdfDoc?.destroy?.(); } catch { /* ignore */ }
	}
}
