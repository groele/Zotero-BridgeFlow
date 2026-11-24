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
const MAX_COVER_BYTES = 4 * 1024 * 1024;
const TARGET_COVER_WIDTH = 480;
const COVER_ASPECT_RATIO = 1.28;
const FAIL_COOLDOWN_MS = 45_000;

export const COVER_RENDER_SPEC = {
	targetWidth: TARGET_COVER_WIDTH,
	aspectRatio: COVER_ASPECT_RATIO,
	cacheVersion: 'v3',
} as const;

const memCoverCache = new Map<number, string>();
const fingerprints = new Map<string, { stamp: string; hashPromise: Promise<string> }>();
const attPathByID = new Map<number, string>();
const touchedAt = new Map<string, number>();
const writingPaths = new Set<string>();
const failedRetryAt = new Map<number, number>();
let lastSweepAt = 0;
let sweepingPromise: Promise<void> | null = null;

function setMemLru(attID: number, url: string): void {
	if (memCoverCache.has(attID)) memCoverCache.delete(attID);
	else if (memCoverCache.size >= MEM_CACHE_LIMIT) {
		const oldest = memCoverCache.keys().next().value;
		if (oldest !== undefined) memCoverCache.delete(oldest);
	}
	memCoverCache.set(attID, url);
}

export function getCachedPdfCoverSync(attID: number): string | null {
	const hit = memCoverCache.get(attID);
	if (!hit) return null;
	memCoverCache.delete(attID);
	memCoverCache.set(attID, hit);
	return hit;
}

function getCoversDir(customDir = ''): string | null {
	try {
		const zotero = (globalThis as any).Zotero;
		const pathUtils = (globalThis as any).PathUtils || zotero?.getMainWindow?.()?.PathUtils;
		const base = String(customDir || '').trim() || (zotero?.DataDirectory?.dir ? pathUtils?.join?.(zotero.DataDirectory.dir, 'bridgeflow-cache') : '');
		return base && pathUtils?.join ? pathUtils.join(base, 'covers') : null;
	} catch { return null; }
}

function isValidJpegDataUrl(url: unknown): url is string {
	return typeof url === 'string' && url.length > 32 && url.length <= MAX_COVER_BYTES && url.startsWith('data:image/');
}

async function locateAttachmentPdf(attID: number, width: number): Promise<{ key: string; path: string; stamp: string } | null> {
	try {
		const zotero = (globalThis as any).Zotero;
		const ioUtils = (globalThis as any).IOUtils || zotero?.getMainWindow?.()?.IOUtils;
		const item = zotero?.Items?.get?.(attID) || (await zotero?.Items?.getAsync?.(attID));
		if (!item || item.deleted || item.isPDFAttachment?.() === false) return null;
		const pdfPath = (await item.getFilePathAsync?.().catch(() => null)) || item.getFilePath?.();
		if (!pdfPath || !ioUtils?.stat) return null;
		const stat = await ioUtils.stat(pdfPath);
		if (stat.type !== 'regular' || !Number.isFinite(stat.lastModified) || !Number.isFinite(stat.size)) return null;
		attPathByID.set(attID, pdfPath);
		return {
			key: `${item.libraryID || 1}-${encodeURIComponent(String(item.key || attID))}-${width}`,
			path: pdfPath,
			stamp: JSON.stringify([stat.lastModified, stat.size]),
		};
	} catch { return null; }
}

async function identifyAttachmentPdf(attID: number, width: number, verify = false): Promise<{ key: string; stamp: string; revision: string } | null> {
	const located = await locateAttachmentPdf(attID, width);
	if (!located) return null;
	const zotero = (globalThis as any).Zotero;
	const ioUtils = (globalThis as any).IOUtils || zotero?.getMainWindow?.()?.IOUtils;
	let fp = fingerprints.get(located.path);
	if (verify || fp?.stamp !== located.stamp) {
		const hashPromise = (async () => {
			const digest = typeof ioUtils?.computeHexDigest === 'function'
				? `sha256:${await ioUtils.computeHexDigest(located.path, 'sha256')}`
				: typeof zotero?.Utilities?.Internal?.md5Async === 'function'
					? `md5:${await zotero.Utilities.Internal.md5Async(located.path)}`
					: `stamp:${located.stamp}`;
			const after = await ioUtils.stat(located.path);
			if (JSON.stringify([after.lastModified, after.size]) !== located.stamp) throw new Error('PDF modified during hash');
			return digest;
		})();
		fp = { stamp: located.stamp, hashPromise };
		fingerprints.set(located.path, fp);
	}
	try {
		return { key: located.key, stamp: located.stamp, revision: await fp.hashPromise };
	} catch {
		if (fingerprints.get(located.path) === fp) fingerprints.delete(located.path);
		return null;
	}
}

function triggerCoverCacheSweep(): void {
	if (sweepingPromise || Date.now() - lastSweepAt < 3600_000) return;
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
			const isLegacyTxt = /^cover-v\d+-\d+\.txt$/i.test(name);
			const isJson = /\.json(?:\.[^.]+\.tmp)?$/i.test(name);
			if (!isLegacyTxt && !isJson) continue;
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
			touchedAt.set(key, Date.now());
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
		await ioUtils.writeUTF8(filePath, JSON.stringify({ version: 2, ...payload }), { tmpPath });
	} catch { /* ignore */ } finally {
		writingPaths.delete(filePath);
		writingPaths.delete(tmpPath);
		await ioUtils.remove?.(tmpPath, { ignoreAbsent: true }).catch(() => {});
		triggerCoverCacheSweep();
	}
}

const defaultScrollIdle = createGalleryScrollIdle(260);
const renderQueue = createGalleryWorkQueue((sig) => defaultScrollIdle.wait(sig), 2);
const ioQueue = createGalleryWorkQueue(async () => {}, 2);
const activeJobs = new Map<string, {
	controller: AbortController;
	subscribers: Set<{ signal: AbortSignal; priority: () => number; onPreview?: (url: string) => void }>;
	promise: Promise<string | null>;
}>();

export function notifyGalleryCoverScroll(paused?: boolean): void {
	if (typeof paused === 'boolean') defaultScrollIdle.setPaused(paused);
	else defaultScrollIdle.touch();
}

export function requestGalleryPdfCover(opts: {
	attID: number;
	doc: Document;
	width?: number;
	signal?: AbortSignal;
	priority?: () => number;
	onPreview?: (url: string) => void;
}): Promise<string | null> {
	const { attID, doc } = opts;
	const width = opts.width ?? TARGET_COVER_WIDTH;
	const callerSignal = opts.signal ?? makeAbortController(doc?.defaultView).signal;
	const priority = opts.priority ?? (() => 0);
	if (!attID || callerSignal.aborted) return Promise.resolve(null);
	const mem = getCachedPdfCoverSync(attID);
	if (mem) return Promise.resolve(mem);
	const cooldown = failedRetryAt.get(attID) || 0;
	if (cooldown > Date.now()) return Promise.resolve(null);
	if (cooldown) failedRetryAt.delete(attID);

	const jobKey = `${attID}:${width}`;
	let job = activeJobs.get(jobKey);
	if (!job) {
		const controller = makeAbortController(doc?.defaultView);
		const subscribers = new Set<{ signal: AbortSignal; priority: () => number; onPreview?: (url: string) => void }>();
		const rank = () => Math.max(0, ...[...subscribers].filter((s) => !s.signal.aborted).map((s) => s.priority()));
		const promise = (async (): Promise<string | null> => {
			const sig = controller.signal;
			const hint = await ioQueue(() => locateAttachmentPdf(attID, width), sig, rank);
			const cand = hint && !sig.aborted ? await ioQueue(() => readDiskEnvelope(hint.key), sig, rank) : null;
			if (cand && hint && cand.stamp === hint.stamp && !sig.aborted) {
				for (const sub of subscribers) if (!sub.signal.aborted) sub.onPreview?.(cand.url);
			}
			const ident = await ioQueue(() => identifyAttachmentPdf(attID, width), sig, rank);
			if (sig.aborted) return null;
			if (ident) {
				const verified = (hint?.key === ident.key ? cand : await ioQueue(() => readDiskEnvelope(ident.key), sig, rank));
				if (verified && verified.revision === ident.revision) {
					setMemLru(attID, verified.url);
					return verified.url;
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
					const viaPreview = await renderAttachmentPreviewCover(attID, width, timeoutCtrl.signal, doc, host, (s) => defaultScrollIdle.wait(s));
					return viaPreview || (await renderFallbackPdfJsCover(attID, width, timeoutCtrl.signal, doc, host));
				} finally {
					clearTimeout(timer);
					sig.removeEventListener('abort', onParentAbort);
				}
			}, sig, rank);
			if (!isValidJpegDataUrl(rendered)) {
				if (!sig.aborted) failedRetryAt.set(attID, Date.now() + FAIL_COOLDOWN_MS);
				return null;
			}
			setMemLru(attID, rendered);
			if (ident && !sig.aborted) {
				void writeDiskEnvelope(ident.key, { revision: ident.revision, stamp: ident.stamp, url: rendered });
			}
			return rendered;
		})().catch(() => null).finally(() => {
			if (activeJobs.get(jobKey)?.controller === controller) activeJobs.delete(jobKey);
		});
		job = { controller, subscribers, promise };
		activeJobs.set(jobKey, job);
	}

	const currentJob = job;
	const sub = { signal: callerSignal, priority, onPreview: opts.onPreview };
	currentJob.subscribers.add(sub);
	const onCallerAbort = () => {
		currentJob.subscribers.delete(sub);
		if (!currentJob.subscribers.size) {
			currentJob.controller.abort();
			activeJobs.delete(jobKey);
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
	memCoverCache.delete(attID);
	failedRetryAt.delete(attID);
	const p = attPathByID.get(attID);
	if (p) fingerprints.delete(p);
	for (const [k, job] of activeJobs.entries()) {
		if (k.startsWith(`${attID}:`)) { job.controller.abort(); activeJobs.delete(k); }
	}
}

export async function clearPdfCoverCache(customDir = ''): Promise<boolean> {
	memCoverCache.clear();
	failedRetryAt.clear();
	fingerprints.clear();
	for (const job of activeJobs.values()) job.controller.abort();
	activeJobs.clear();
	try {
		const ioUtils = (globalThis as any).IOUtils || (globalThis as any).Zotero?.getMainWindow?.()?.IOUtils;
		const coversDir = getCoversDir(customDir);
		if (!coversDir || !ioUtils?.remove) return false;
		await ioUtils.remove(coversDir, { recursive: true, ignoreAbsent: true });
		return true;
	} catch { return false; }
}
