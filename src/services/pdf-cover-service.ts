const PDFJS_MODULE_URL = 'resource://zotero/reader/pdf/build/pdf.mjs';
const PDFJS_WORKER_URL = 'resource://zotero/reader/pdf/build/pdf.worker.mjs';
const PDFJS_CMAP_URL = 'resource://zotero/reader/pdf/web/cmaps/';
const PDFJS_FONT_URL = 'resource://zotero/reader/pdf/web/standard_fonts/';

const MEM_CACHE_LIMIT = 600;
const MAX_CONCURRENT = 2;
const TARGET_COVER_WIDTH = 480;
const COVER_ASPECT_RATIO = 1.28; // Top ~90% of A4 page 1 so tall cover frames never crop horizontally

export const COVER_RENDER_SPEC = {
	targetWidth: TARGET_COVER_WIDTH,
	aspectRatio: COVER_ASPECT_RATIO,
	cacheVersion: 'v2',
} as const;

let cachedPdfJs: any = null;
const memCoverCache = new Map<number, string>();
const failedRetryAt = new Map<number, number>();
const FAIL_COOLDOWN_MS = 60_000;
const inflightJobs = new Map<number, Promise<string | null>>();

let activeWorkers = 0;
const waitQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
	if (activeWorkers < MAX_CONCURRENT) {
		activeWorkers++;
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		waitQueue.push(() => {
			activeWorkers++;
			resolve();
		});
	});
}

function releaseSlot(): void {
	activeWorkers = Math.max(0, activeWorkers - 1);
	const next = waitQueue.shift();
	if (next) next();
}

function setMemLru(attID: number, dataUrl: string): void {
	if (memCoverCache.has(attID)) memCoverCache.delete(attID);
	else if (memCoverCache.size >= MEM_CACHE_LIMIT) {
		const oldest = memCoverCache.keys().next().value;
		if (oldest !== undefined) memCoverCache.delete(oldest);
	}
	memCoverCache.set(attID, dataUrl);
}

export function getCachedPdfCoverSync(attID: number): string | null {
	const hit = memCoverCache.get(attID);
	if (hit) {
		memCoverCache.delete(attID);
		memCoverCache.set(attID, hit);
		return hit;
	}
	return null;
}

function getCoverDiskPath(attID: number): string | null {
	try {
		const zotero = (globalThis as any).Zotero;
		const pathUtils = (globalThis as any).PathUtils || zotero?.getMainWindow?.()?.PathUtils;
		const dataDir = String(zotero?.DataDirectory?.dir || '');
		if (!dataDir || !pathUtils?.join) return null;
		return pathUtils.join(dataDir, 'bridgeflow-cache', 'covers', `cover-${COVER_RENDER_SPEC.cacheVersion}-${attID}.txt`);
	} catch {
		return null;
	}
}

async function readDiskCover(attID: number): Promise<string | null> {
	const filePath = getCoverDiskPath(attID);
	if (!filePath) return null;
	try {
		const ioUtils = (globalThis as any).IOUtils || (globalThis as any).Zotero?.getMainWindow?.()?.IOUtils;
		if (!ioUtils?.readUTF8) return null;
		const txt = await ioUtils.readUTF8(filePath);
		return typeof txt === 'string' && txt.startsWith('data:image/') ? txt : null;
	} catch {
		return null;
	}
}

async function writeDiskCover(attID: number, dataUrl: string): Promise<void> {
	const filePath = getCoverDiskPath(attID);
	if (!filePath) return;
	try {
		const win = (globalThis as any).Zotero?.getMainWindow?.();
		const ioUtils = (globalThis as any).IOUtils || win?.IOUtils;
		const pathUtils = (globalThis as any).PathUtils || win?.PathUtils;
		if (!ioUtils?.writeUTF8) return;
		if (pathUtils?.parent && ioUtils?.makeDirectory) {
			await ioUtils.makeDirectory(pathUtils.parent(filePath), { createAncestors: true, ignoreExisting: true });
		}
		await ioUtils.writeUTF8(filePath, dataUrl);
	} catch { /* ignore disk cache errors */ }
}

function tryImportEsModule(cu: any, url: string): any {
	if (!cu?.importESModule) return null;
	for (const opts of [{ global: 'current' }, null] as const) {
		try {
			const mod = opts !== null ? cu.importESModule(url, opts) : cu.importESModule(url);
			if (mod) return mod;
		} catch { /* fallback */ }
	}
	return null;
}

async function ensurePdfJs(win?: Window | null): Promise<any> {
	if (cachedPdfJs) return cachedPdfJs;
	const hostWin = (win || (globalThis as any).Zotero?.getMainWindow?.()) as any;
	const winCu = hostWin?.ChromeUtils;
	const globalCu = (globalThis as any).ChromeUtils;
	const workerMod = tryImportEsModule(winCu, PDFJS_WORKER_URL) || tryImportEsModule(globalCu, PDFJS_WORKER_URL);
	if (workerMod) {
		try {
			(globalThis as any).pdfjsWorker = workerMod;
			if (hostWin) hostWin.pdfjsWorker = workerMod;
		} catch { /* ignore */ }
	}
	let mod = tryImportEsModule(winCu, PDFJS_MODULE_URL) || tryImportEsModule(globalCu, PDFJS_MODULE_URL);
	if (typeof mod?.getDocument !== 'function') {
		try {
			mod = await (new Function('u', 'return import(u)')(PDFJS_MODULE_URL));
		} catch {
			mod = null;
		}
	}
	if (typeof mod?.getDocument !== 'function') return null;
	if (mod.GlobalWorkerOptions && !mod.GlobalWorkerOptions.workerSrc) {
		mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
	}
	cachedPdfJs = mod;
	return mod;
}

async function resolveAttachmentFileBytes(attID: number): Promise<Uint8Array | null> {
	try {
		const zotero = (globalThis as any).Zotero;
		const att = zotero?.Items?.get?.(attID) || (await zotero?.Items?.getAsync?.(attID));
		if (!att || att.deleted) return null;
		const filePath = (await att.getFilePathAsync?.().catch(() => null)) || att.getFilePath?.();
		if (typeof filePath !== 'string' || !filePath.trim()) return null;
		const ioUtils = (globalThis as any).IOUtils || zotero?.getMainWindow?.()?.IOUtils;
		if (ioUtils?.read) {
			const raw = await ioUtils.read(filePath);
			return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
		}
	} catch { /* ignore */ }
	return null;
}

async function renderCoverInternal(attID: number, doc: Document): Promise<string | null> {
	const diskHit = await readDiskCover(attID);
	if (diskHit) {
		setMemLru(attID, diskHit);
		return diskHit;
	}
	await acquireSlot();
	let pdfDoc: any = null;
	let page: any = null;
	try {
		const [pdfjs, bytes] = await Promise.all([
			ensurePdfJs(doc.defaultView),
			resolveAttachmentFileBytes(attID),
		]);
		if (!pdfjs || !bytes?.length) return null;

		const task = pdfjs.getDocument({
			data: bytes,
			ownerDocument: doc,
			isEvalSupported: false,
			useWorkerFetch: false,
			cMapUrl: PDFJS_CMAP_URL,
			cMapPacked: true,
			standardFontDataUrl: PDFJS_FONT_URL,
		});
		pdfDoc = await task.promise;
		page = await pdfDoc.getPage(1);
		const baseVp = page.getViewport({ scale: 1 });
		const scale = (TARGET_COVER_WIDTH * 1.5) / Math.max(1, baseVp.width);
		const vp = page.getViewport({ scale });

		const fullCanvas = doc.createElementNS('http://www.w3.org/1999/xhtml', 'canvas') as HTMLCanvasElement;
		fullCanvas.width = Math.max(1, Math.floor(vp.width));
		fullCanvas.height = Math.max(1, Math.floor(vp.height));
		const ctx = fullCanvas.getContext('2d');
		if (!ctx) return null;
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, fullCanvas.width, fullCanvas.height);
		await page.render({ canvasContext: ctx, viewport: vp }).promise;

		// Crop top 58% of page 1 for crisp title/header/abstract thumbnail
		const cropHeight = Math.max(1, Math.min(fullCanvas.height, Math.floor(fullCanvas.width * COVER_ASPECT_RATIO)));
		const outCanvas = doc.createElementNS('http://www.w3.org/1999/xhtml', 'canvas') as HTMLCanvasElement;
		outCanvas.width = fullCanvas.width;
		outCanvas.height = cropHeight;
		const outCtx = outCanvas.getContext('2d');
		if (!outCtx) return null;
		outCtx.fillStyle = '#ffffff';
		outCtx.fillRect(0, 0, outCanvas.width, outCanvas.height);
		outCtx.drawImage(fullCanvas, 0, 0, fullCanvas.width, cropHeight, 0, 0, outCanvas.width, cropHeight);

		const dataUrl = outCanvas.toDataURL('image/jpeg', 0.84);
		if (dataUrl && dataUrl.startsWith('data:image/')) {
			setMemLru(attID, dataUrl);
			void writeDiskCover(attID, dataUrl);
			return dataUrl;
		}
		return null;
	} catch {
		failedRetryAt.set(attID, Date.now() + FAIL_COOLDOWN_MS);
		return null;
	} finally {
		try { page?.cleanup?.(); } catch { /* ignore */ }
		try { await pdfDoc?.destroy?.(); } catch { /* ignore */ }
		releaseSlot();
	}
}

export function loadPdfCoverDataUrl(attID: number, doc: Document): Promise<string | null> {
	if (!attID) return Promise.resolve(null);
	const retryAfter = failedRetryAt.get(attID) || 0;
	if (retryAfter > Date.now()) return Promise.resolve(null);
	if (retryAfter) failedRetryAt.delete(attID);
	const mem = getCachedPdfCoverSync(attID);
	if (mem) return Promise.resolve(mem);
	const existing = inflightJobs.get(attID);
	if (existing) return existing;
	const job = renderCoverInternal(attID, doc).finally(() => {
		inflightJobs.delete(attID);
	});
	inflightJobs.set(attID, job);
	return job;
}

export async function clearPdfCoverCache(customDir = ''): Promise<boolean> {
	memCoverCache.clear();
	failedRetryAt.clear();
	try {
		const zotero = (globalThis as any).Zotero;
		const win = zotero?.getMainWindow?.();
		const ioUtils = (globalThis as any).IOUtils || win?.IOUtils;
		const pathUtils = (globalThis as any).PathUtils || win?.PathUtils;
		if (!ioUtils?.remove || !pathUtils?.join) return true;
		const dirs = new Set<string>();
		const dataDir = String(zotero?.DataDirectory?.dir || '').trim();
		if (dataDir) dirs.add(pathUtils.join(dataDir, 'bridgeflow-cache', 'covers'));
		const custom = String(customDir || '').trim();
		if (custom) dirs.add(pathUtils.join(custom, 'covers'));
		for (const dir of dirs) {
			await ioUtils.remove(dir, { recursive: true, ignoreAbsent: true }).catch(() => {});
		}
		return true;
	} catch {
		return false;
	}
}
