import {
	computeCoverCacheEvictions,
	createGalleryScrollIdle,
	createGalleryWorkQueue,
	makeAbortController,
	type CoverCacheFileEntry,
} from './pdf-cover-queue.ts';
import { renderAttachmentPreviewCover, renderFallbackPdfJsCover } from './pdf-cover-renderer.ts';

export { computeCoverCacheEvictions, createGalleryScrollIdle, createGalleryWorkQueue, makeAbortController };

const MEM_CACHE_LIMIT = 512;
const MEM_CACHE_BASE64_LIMIT = 16 * 1024 * 1024;
const META_MAP_LIMIT = 1024;
const MAX_COVER_BYTES = 4 * 1024 * 1024;
const TARGET_COVER_WIDTH = 480;
const COVER_ASPECT_RATIO = 1.28;
const FAIL_COOLDOWN_MS = 45_000;

export const COVER_RENDER_SPEC = {
	targetWidth: TARGET_COVER_WIDTH,
	aspectRatio: COVER_ASPECT_RATIO,
	cacheVersion: 'v3',
} as const;

const memCoverCache = new Map<string, string>();
let memCacheSize = 0;
const touchedAt = new Map<string, number>();
const writingPaths = new Set<string>();
const rejectedDiskCovers = new Map<string, true>();
const failedRetryAt = new Map<string, number>();
let configuredCoverCacheDir = '';
let lastSweepAt = 0;
let sweepingPromise: Promise<void> | null = null;
let clearing: Promise<boolean> | undefined;
const pendingWrites = new Set<Promise<void>>();

function setBounded<K, V>(map: Map<K, V>, key: K, val: V, limit = META_MAP_LIMIT): void {
	if (map.has(key)) map.delete(key);
	else if (map.size >= limit) {
		const oldest = map.keys().next().value;
		if (oldest !== undefined) map.delete(oldest);
	}
	map.set(key, val);
}

export function configurePdfCoverCacheDirectory(customDir = ''): void {
	configuredCoverCacheDir = String(customDir || '').trim();
}

function removeMemCover(key: string): void {
	memCacheSize -= memCoverCache.get(key)?.length || 0;
	memCoverCache.delete(key);
}

function setMemLru(attID: number, width: number, url: string): void {
	const key = `${attID}:${width}`;
	removeMemCover(key);
	memCoverCache.set(key, url);
	memCacheSize += url.length;
	while (memCoverCache.size > MEM_CACHE_LIMIT || memCacheSize > MEM_CACHE_BASE64_LIMIT) {
		const oldest = memCoverCache.keys().next().value;
		if (!oldest) break;
		removeMemCover(oldest);
	}
}

export function rejectGalleryPdfCover(attID: number, url: string): void {
	const key = `${attID}:${TARGET_COVER_WIDTH}`;
	if (memCoverCache.get(key) !== url) return;
	removeMemCover(key);
	setBounded(rejectedDiskCovers, key, true);
}

export function getCachedPdfCoverSync(attID: number, width = TARGET_COVER_WIDTH): string | null {
	const key = `${attID}:${width}`;
	const hit = memCoverCache.get(key);
	if (!hit) return null;
	memCoverCache.delete(key);
	memCoverCache.set(key, hit);
	return hit;
}

function getCoversDir(customDir = ''): string | null {
	try {
		const zotero = (globalThis as any).Zotero;
		const pathUtils = (globalThis as any).PathUtils || zotero?.getMainWindow?.()?.PathUtils;
		const effectiveDir = String(customDir || configuredCoverCacheDir || '').trim();
		const base = effectiveDir || (zotero?.DataDirectory?.dir ? pathUtils?.join?.(zotero.DataDirectory.dir, 'bridgeflow-cache') : '');
		return base && pathUtils?.join ? pathUtils.join(base, 'covers') : null;
	} catch { return null; }
}

function isValidJpegDataUrl(url: unknown): url is string {
	return typeof url === 'string' && url.length > 32 && url.length <= MAX_COVER_BYTES && url.startsWith('data:image/jpeg;base64,');
}

async function locateAttachmentPdf(attID: number, width: number): Promise<{ key: string; path: string; size: number; stamp: string } | null> {
	try {
		const zotero = (globalThis as any).Zotero;
		const ioUtils = (globalThis as any).IOUtils || zotero?.getMainWindow?.()?.IOUtils;
		const item = zotero?.Items?.get?.(attID) || (await zotero?.Items?.getAsync?.(attID));
		if (!item || item.deleted || item.isPDFAttachment?.() === false) return null;
		const pdfPath = (await item.getFilePathAsync?.().catch(() => null)) || item.getFilePath?.();
		if (!pdfPath || !ioUtils?.stat) return null;
		const stat = await ioUtils.stat(pdfPath);
		if (stat.type !== 'regular' || !Number.isFinite(stat.lastModified) || !Number.isFinite(stat.size)) return null;
		return {
			key: `${item.libraryID || 1}-${encodeURIComponent(String(item.key || attID))}-${width}`,
			path: pdfPath,
			size: stat.size,
			stamp: JSON.stringify([stat.lastModified, stat.size]),
		};
	} catch { return null; }
}

function isBridgeFlowCoverFile(name: string): boolean {
	return /^(?:cover-(?:v\d+-)?\d+\.txt|\d+-[a-z0-9_%]+-\d+\.json(?:\.[a-z0-9]+\.tmp)?)$/i.test(name);
}

export function triggerCoverCacheSweep(force = false): void {
	if (clearing || sweepingPromise || (!force && Date.now() - lastSweepAt < 3600_000)) return;
	const dir = getCoversDir();
	const ioUtils = (globalThis as any).IOUtils || (globalThis as any).Zotero?.getMainWindow?.()?.IOUtils;
	if (!dir || typeof ioUtils?.getChildren !== 'function') return;
	lastSweepAt = Date.now();
	sweepingPromise = (async () => {
		const children: string[] = await ioUtils.getChildren(dir).catch(() => []);
		const entries: CoverCacheFileEntry[] = [];
		for (const p of children) {
			if (writingPaths.has(p)) continue;
			const name = String(p.split(/[\\/]/).pop() || '');
			const isLegacyTxt = /^cover-(?:v\d+-)?\d+\.txt$/i.test(name);
			if (!isBridgeFlowCoverFile(name)) continue;
			try {
				const st = await ioUtils.stat(p);
				if (st.type === 'regular') {
					entries.push({ path: p, size: st.size || 0, modified: st.lastModified || 0, temporary: name.endsWith('.tmp'), legacy: isLegacyTxt });
				}
			} catch { /* ignore */ }
		}
		for (const ev of computeCoverCacheEvictions(entries, Date.now())) {
			if (!writingPaths.has(ev.path)) await ioUtils.remove(ev.path, { ignoreAbsent: true }).catch(() => {});
		}
	})().finally(() => { sweepingPromise = null; });
}

async function readDiskEnvelope(key: string): Promise<{ revision: string; stamp: string; url: string } | null> {
	const dir = getCoversDir();
	const pathUtils = (globalThis as any).PathUtils || (globalThis as any).Zotero?.getMainWindow?.()?.PathUtils;
	const ioUtils = (globalThis as any).IOUtils || (globalThis as any).Zotero?.getMainWindow?.()?.IOUtils;
	if (!dir || !pathUtils?.join || !ioUtils?.readUTF8) return null;
	const filePath = pathUtils.join(dir, `${key}.json`);
	try {
		const st = await ioUtils.stat?.(filePath);
		if (st && (!st.size || st.size > MAX_COVER_BYTES + 8192)) return null;
		const raw = await ioUtils.readUTF8(filePath);
		const parsed = JSON.parse(raw);
		if (parsed?.version !== 2 || typeof parsed.revision !== 'string' || !isValidJpegDataUrl(parsed.url)) return null;
		if (typeof ioUtils.setModificationTime === 'function' && Date.now() - (touchedAt.get(key) ?? 0) >= 3600_000) {
			setBounded(touchedAt, key, Date.now());
			void ioUtils.setModificationTime(filePath).catch(() => {});
		}
		triggerCoverCacheSweep();
		return { revision: parsed.revision, stamp: String(parsed.stamp || ''), url: parsed.url };
	} catch { return null; }
}

async function writeDiskEnvelope(key: string, payload: { revision: string; stamp: string; url: string }): Promise<void> {
	const dir = getCoversDir();
	const pathUtils = (globalThis as any).PathUtils || (globalThis as any).Zotero?.getMainWindow?.()?.PathUtils;
	const ioUtils = (globalThis as any).IOUtils || (globalThis as any).Zotero?.getMainWindow?.()?.IOUtils;
	if (!dir || !pathUtils?.join || !ioUtils?.writeUTF8) return;
	const filePath = pathUtils.join(dir, `${key}.json`);
	const tmpPath = `${filePath}.${Math.random().toString(36).slice(2, 8)}.tmp`;
	writingPaths.add(filePath);
	writingPaths.add(tmpPath);
	try {
		await ioUtils.makeDirectory?.(dir, { ignoreExisting: true, createAncestors: true });
		await ioUtils.writeUTF8(filePath, `${JSON.stringify({ version: 2, ...payload }, null, 2)}\n`, { tmpPath });
	} catch { /* ignore */ } finally {
		writingPaths.delete(filePath);
		writingPaths.delete(tmpPath);
		await ioUtils.remove?.(tmpPath, { ignoreAbsent: true }).catch(() => {});
		triggerCoverCacheSweep();
	}
}

const defaultScrollIdle = createGalleryScrollIdle(100);
const renderQueue = createGalleryWorkQueue((sig) => defaultScrollIdle.wait(sig), 2);
const ioQueue = createGalleryWorkQueue(async () => {}, 8);
const activeJobs = new Map<string, {
	controller: AbortController;
	subscribers: Set<{ signal: AbortSignal; priority: () => number }>;
	promise: Promise<string | null>;
}>();

const draggingViewports = new Set<HTMLElement>();

export function notifyGalleryCoverScroll(): void { defaultScrollIdle.touch(); }

export function setGalleryCoverDragging(viewport: HTMLElement, dragging: boolean): void {
	if (dragging) draggingViewports.add(viewport);
	else draggingViewports.delete(viewport);
	defaultScrollIdle.setPaused(draggingViewports.size > 0);
}

export function requestGalleryPdfCover(opts: {
	attID: number;
	doc: Document;
	width?: number;
	signal?: AbortSignal;
	priority?: () => number;
}): Promise<string | null> {
	const { attID, doc } = opts;
	const width = opts.width ?? TARGET_COVER_WIDTH;
	const callerSignal = opts.signal ?? makeAbortController(doc?.defaultView).signal;
	const priority = opts.priority ?? (() => 0);
	if (!attID || callerSignal.aborted) return Promise.resolve(null);
	if (clearing) return clearing.then(() => requestGalleryPdfCover(opts));
	const mem = getCachedPdfCoverSync(attID, width);
	if (mem) return Promise.resolve(mem);
	const jobKey = `${attID}:${width}`;
	const cooldown = failedRetryAt.get(jobKey) || 0;
	if (cooldown > Date.now()) return Promise.resolve(null);
	if (cooldown) failedRetryAt.delete(jobKey);

	let job = activeJobs.get(jobKey);
	if (!job) {
		const controller = makeAbortController(doc?.defaultView);
		const subscribers = new Set<{ signal: AbortSignal; priority: () => number }>();
		const rank = () => Math.max(0, ...[...subscribers].filter((s) => !s.signal.aborted).map((s) => s.priority()));
		const promise = (async (): Promise<string | null> => {
			const sig = controller.signal;
			const cached = await ioQueue(async () => {
				const hint = await locateAttachmentPdf(attID, width);
				const cover = hint && !sig.aborted && !rejectedDiskCovers.has(jobKey) ? await readDiskEnvelope(hint.key) : null;
				return { hint, cover };
			}, sig, rank);
			if (!cached || sig.aborted) return null;
			const { hint, cover: cand } = cached;
			if (hint) {
				// Fast O(1) stat [lastModified, size] match avoids reading & SHA-256 hashing multi-MB PDFs on disk cache hits.
				if (cand && (cand.stamp === hint.stamp || (!cand.stamp && cand.revision))) {
					setMemLru(attID, width, cand.url);
					return cand.url;
				}
			}
			const rendered = await renderQueue(async () => {
				if (sig.aborted) return false;
				const timeoutCtrl = makeAbortController(doc?.defaultView);
				const onParentAbort = () => timeoutCtrl.abort();
				sig.addEventListener('abort', onParentAbort, { once: true });
				const timer = setTimeout(() => timeoutCtrl.abort(), 15_000);
				try {
					const host = (globalThis as any).Zotero;
					// Direct PDF.js page-1 rasterization is ~20x faster than spawning an offscreen <attachment-preview> reader iframe.
					const viaDirect = await renderFallbackPdfJsCover(attID, width, timeoutCtrl.signal, doc, host, hint?.path, hint?.size);
					if (viaDirect) return viaDirect;
					return await renderAttachmentPreviewCover(attID, width, timeoutCtrl.signal, doc, host, (s) => defaultScrollIdle.wait(s));
				} finally {
					clearTimeout(timer);
					sig.removeEventListener('abort', onParentAbort);
				}
			}, sig, rank);
			if (sig.aborted) return null;
			if (!isValidJpegDataUrl(rendered)) {
				setBounded(failedRetryAt, jobKey, Date.now() + FAIL_COOLDOWN_MS);
				return null;
			}
			setMemLru(attID, width, rendered);
			if (hint && !sig.aborted) {
				const write = writeDiskEnvelope(hint.key, { revision: `stamp:${hint.stamp}`, stamp: hint.stamp, url: rendered });
				pendingWrites.add(write);
				void write.then(() => pendingWrites.delete(write), () => pendingWrites.delete(write));
			}
			return rendered;
		})().catch(() => null).finally(() => {
			if (activeJobs.get(jobKey)?.controller === controller) activeJobs.delete(jobKey);
		});
		job = { controller, subscribers, promise };
		activeJobs.set(jobKey, job);
	}

	const currentJob = job;
	const sub = { signal: callerSignal, priority };
	currentJob.subscribers.add(sub);
	const onCallerAbort = () => {
		currentJob.subscribers.delete(sub);
		if (!currentJob.subscribers.size) {
			currentJob.controller.abort();
			if (activeJobs.get(jobKey) === currentJob) activeJobs.delete(jobKey);
		}
	};
	callerSignal.addEventListener('abort', onCallerAbort, { once: true });
	return currentJob.promise.then((res) => (callerSignal.aborted ? null : res)).finally(() => {
		callerSignal.removeEventListener('abort', onCallerAbort);
		currentJob.subscribers.delete(sub);
	});
}

export function loadPdfCoverDataUrl(attID: number, doc: Document): Promise<string | null> {
	return requestGalleryPdfCover({ attID, doc });
}

export function invalidatePdfCover(attID: number): void {
	const prefix = `${attID}:`;
	for (const key of memCoverCache.keys()) if (key.startsWith(prefix)) removeMemCover(key);
	for (const key of failedRetryAt.keys()) if (key.startsWith(prefix)) failedRetryAt.delete(key);
	for (const [k, job] of activeJobs.entries()) {
		if (k.startsWith(`${attID}:`)) { job.controller.abort(); activeJobs.delete(k); }
	}
}

export function clearPdfCoverCache(customDir = ''): Promise<boolean> {
	if (clearing) return clearing;
	memCoverCache.clear();
	memCacheSize = 0;
	failedRetryAt.clear();
	rejectedDiskCovers.clear();
	for (const job of activeJobs.values()) job.controller.abort();
	activeJobs.clear();
	clearing = (async () => {
		await Promise.allSettled([...pendingWrites, sweepingPromise]);
		const io = (globalThis as any).IOUtils || (globalThis as any).Zotero?.getMainWindow?.()?.IOUtils;
		const dir = getCoversDir(customDir);
		if (!dir || !io?.getChildren || !io?.remove) return false;
		if (io.exists && !(await io.exists(dir))) return true;
		const paths: string[] = await io.getChildren(dir);
		for (const path of paths) {
			if (isBridgeFlowCoverFile(path.split(/[\\/]/).pop() || '')) await io.remove(path, { ignoreAbsent: true });
		}
		return true;
	})().catch(() => false).finally(() => { clearing = undefined; });
	return clearing;
}
