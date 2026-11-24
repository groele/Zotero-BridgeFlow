export function makeAbortController(win?: any): AbortController {
	const Ctor = (globalThis as any).AbortController
		|| win?.AbortController
		|| (globalThis as any).Zotero?.getMainWindow?.()?.AbortController;
	if (typeof Ctor === 'function') return new Ctor();
	const listeners = new Set<() => void>();
	const signal: any = {
		aborted: false,
		addEventListener(_type: string, fn: () => void) {
			if (signal.aborted) fn();
			else listeners.add(fn);
		},
		removeEventListener(_type: string, fn: () => void) {
			listeners.delete(fn);
		},
	};
	return {
		signal,
		abort() {
			if (signal.aborted) return;
			signal.aborted = true;
			for (const fn of [...listeners]) {
				listeners.delete(fn);
				try { fn(); } catch { /* ignore */ }
			}
		},
	} as AbortController;
}

export interface GalleryScrollIdle {
	touch(): void;
	setPaused(paused: boolean): void;
	wait(signal: AbortSignal): Promise<void>;
	destroy(): void;
}

export function createGalleryScrollIdle(quietMS = 280): GalleryScrollIdle {
	let idleAt = 0;
	let destroyed = false;
	let paused = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const waiting = new Set<(ready: boolean) => void>();

	const flush = () => {
		timer = undefined;
		if (paused || destroyed) return;
		const rem = idleAt - Date.now();
		if (rem > 0 && waiting.size) {
			timer = setTimeout(flush, rem);
			return;
		}
		for (const fn of [...waiting]) fn(true);
	};

	return {
		touch() {
			idleAt = Date.now() + quietMS;
		},
		setPaused(val: boolean) {
			if (destroyed || paused === val) return;
			paused = val;
			if (paused) {
				if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
			} else {
				idleAt = Date.now() + quietMS;
				if (waiting.size) timer = setTimeout(flush, quietMS);
			}
		},
		wait(signal: AbortSignal): Promise<void> {
			if (destroyed || signal.aborted) return Promise.reject(new Error('cancelled'));
			if (!paused && Date.now() >= idleAt) return Promise.resolve();
			return new Promise<void>((resolve, reject) => {
				const finish = (ready: boolean) => {
					waiting.delete(finish);
					signal.removeEventListener('abort', onAbort);
					if (!waiting.size && timer !== undefined) { clearTimeout(timer); timer = undefined; }
					if (ready) resolve();
					else reject(new Error('cancelled'));
				};
				const onAbort = () => finish(false);
				waiting.add(finish);
				signal.addEventListener('abort', onAbort, { once: true });
				if (!paused && timer === undefined) timer = setTimeout(flush, Math.max(0, idleAt - Date.now()));
			});
		},
		destroy() {
			destroyed = true;
			if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
			for (const fn of [...waiting]) fn(false);
		},
	};
}

export function createGalleryWorkQueue(
	waitUntilIdle: (signal: AbortSignal) => Promise<void> = async () => {},
	concurrency = 2,
) {
	interface QueueJob<T> {
		run: () => Promise<T>;
		signal: AbortSignal;
		priority: () => number;
		resolve: (val: T | undefined) => void;
		reject: (err: unknown) => void;
		abort: () => void;
	}
	const pending = new Set<QueueJob<any>>();
	const waitingWaiters = new Set<AbortController>();
	const limit = Math.max(1, Math.floor(concurrency));
	let running = 0;

	const pickNext = (): QueueJob<any> | undefined => {
		let best: QueueJob<any> | undefined;
		let bestScore = -Infinity;
		for (const job of pending) {
			const score = job.priority();
			if (!best || score > bestScore) { best = job; bestScore = score; }
		}
		if (!best) return undefined;
		pending.delete(best);
		best.signal.removeEventListener('abort', best.abort);
		if (best.signal.aborted) { best.resolve(undefined); return undefined; }
		return best;
	};

	const worker = async () => {
		try {
			while (pending.size) {
				const ctrl = makeAbortController();
				waitingWaiters.add(ctrl);
				try {
					await waitUntilIdle(ctrl.signal);
				} catch {
					if (ctrl.signal.aborted) continue;
				} finally {
					waitingWaiters.delete(ctrl);
				}
				if (ctrl.signal.aborted) continue;
				const job = pickNext();
				if (!job) continue;
				try { job.resolve(await job.run()); } catch (err) { job.reject(err); }
			}
		} finally {
			running = Math.max(0, running - 1);
		}
	};

	return <T>(run: () => Promise<T>, signal: AbortSignal, priority: () => number = () => 0): Promise<T | undefined> => {
		if (signal.aborted) return Promise.resolve(undefined);
		return new Promise<T | undefined>((resolve, reject) => {
			const job: QueueJob<T> = {
				run,
				signal,
				priority,
				resolve,
				reject,
				abort() {
					pending.delete(job);
					signal.removeEventListener('abort', job.abort);
					resolve(undefined);
					if (!pending.size) {
						for (const c of waitingWaiters) c.abort();
					}
				},
			};
			pending.add(job);
			signal.addEventListener('abort', job.abort, { once: true });
			if (running < limit) { running++; void worker(); }
		});
	};
}

export interface CoverCacheFileEntry {
	path: string;
	size: number;
	modified: number;
	temporary?: boolean;
	legacy?: boolean;
}

export function computeCoverCacheEvictions(
	files: readonly CoverCacheFileEntry[],
	now: number,
	limits = { bytes: 256 * 1024 * 1024, entries: 3000, ageMs: 30 * 24 * 3600 * 1000 },
): CoverCacheFileEntry[] {
	const remove: CoverCacheFileEntry[] = [];
	const keep: CoverCacheFileEntry[] = [];
	for (const f of files) {
		if (f.legacy) remove.push(f);
		else if (f.temporary) { if (now - f.modified > 24 * 3600 * 1000) remove.push(f); }
		else if (now - f.modified > limits.ageMs) remove.push(f);
		else keep.push(f);
	}
	keep.sort((a, b) => b.modified - a.modified);
	let total = 0;
	keep.forEach((f, idx) => {
		total += f.size;
		if (idx >= limits.entries || total > limits.bytes) remove.push(f);
	});
	return remove;
}
