export const PDFJS_MODULE_URL = 'resource://zotero/reader/pdf/build/pdf.mjs';
export const PDFJS_WORKER_URL = 'resource://zotero/reader/pdf/build/pdf.worker.mjs';
export const PDFJS_CMAP_URL = 'resource://zotero/reader/pdf/web/cmaps/';
export const PDFJS_FONT_URL = 'resource://zotero/reader/pdf/web/standard_fonts/';

export interface SharedPdfJsModule {
	GlobalWorkerOptions?: { workerSrc?: string };
	getDocument(src: Record<string, unknown>): {
		promise: Promise<any>;
		destroy?: () => Promise<void> | void;
	};
}

let cachedPdfJs: SharedPdfJsModule | null = null;

function tryImportEsModule(cu: any, url: string): any {
	if (typeof cu?.importESModule !== 'function') return null;
	for (const opts of [{ global: 'current' }, undefined] as const) {
		try {
			const mod = opts ? cu.importESModule(url, opts) : cu.importESModule(url);
			if (mod) return mod;
		} catch { /* try next */ }
	}
	return null;
}

/**
 * Shared, eval-free Zotero PDF.js loader reused by Inspector PDF preview and Visual Notes cover rendering.
 * Never mutates `globalThis.window` or `globalThis.document`.
 */
export function getSharedPdfJsSync(win?: Window | null): SharedPdfJsModule | null {
	if (cachedPdfJs) return cachedPdfJs;
	const hostWin = (win || (globalThis as any).Zotero?.getMainWindow?.()) as any;
	const winCu = hostWin?.ChromeUtils;
	const globalCu = (globalThis as any).ChromeUtils;

	const workerMod = tryImportEsModule(winCu, PDFJS_WORKER_URL) || tryImportEsModule(globalCu, PDFJS_WORKER_URL);
	if (workerMod) {
		try {
			(globalThis as any).pdfjsWorker = workerMod;
			if (hostWin && !hostWin.pdfjsWorker) hostWin.pdfjsWorker = workerMod;
		} catch { /* ignore read-only global */ }
	}

	const mod = (tryImportEsModule(winCu, PDFJS_MODULE_URL) || tryImportEsModule(globalCu, PDFJS_MODULE_URL)) as SharedPdfJsModule | null;
	if (typeof mod?.getDocument !== 'function') return null;
	if (mod.GlobalWorkerOptions && !mod.GlobalWorkerOptions.workerSrc) {
		mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
	}
	cachedPdfJs = mod;
	return mod;
}
