import { cacheDirectory, cacheFile } from '../../services/cache-directory.ts';
import {
	pickReadingProgressState,
	readReadingNotesBackup,
	readReadingProgressBackup,
	type ReadingProgressState,
} from './workspace-schema.ts';
import type { WorkspaceState } from './types.ts';

/**
 * Dedicated durable local cache for high-frequency reading telemetry & heatmaps:
 * - Writes `<ZoteroDataDir>/bridgeflow-cache/reading-progress.json` + `.bak.json`.
 * - Isolated from workspace snapshots AND user-authored brief notes (`brief-notes.json`).
 * - Seamlessly migrates legacy `reading-notes.json` (`v0.4.1`) on startup.
 */
export class ReadingProgressDiskCache {
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private flushing: Promise<boolean> | null = null;
	private lastWrittenJson = '';
	public lastError = '';
	public loadedFromLegacy = false;
	private readonly directory: string;

	constructor(privateDirectory = '') {
		this.directory = cacheDirectory(privateDirectory);
	}

	getDirectoryPath(): string { return this.directory; }
	getFilePath(): string { return cacheFile(this.directory, 'reading-progress.json'); }
	getBackupFilePath(): string { return cacheFile(this.directory, 'reading-progress.bak.json'); }

	scheduleSave(state: Pick<WorkspaceState, 'lastViewedAt' | 'readingProgress'>, immediate = false): void {
		const ioUtils = (globalThis as any).IOUtils;
		if (!ioUtils?.writeUTF8) return;
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		if (immediate) {
			void this.flushNow(state);
			return;
		}
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			void this.flushNow(state);
		}, 320);
	}

	async flushNow(state: Pick<WorkspaceState, 'lastViewedAt' | 'readingProgress'>): Promise<boolean> {
		const ioUtils = (globalThis as any).IOUtils;
		if (!ioUtils?.writeUTF8) return true;
		const payload = `${JSON.stringify({
			format: 'zotero-bridgeflow-reading-progress',
			version: 1,
			state: pickReadingProgressState(state),
		}, null, 2)}\n`;

		const run = async (): Promise<boolean> => {
			if (payload === this.lastWrittenJson) return true;
			try {
				await ioUtils.makeDirectory?.(this.getDirectoryPath(), { ignoreExisting: true });
				const mainPath = this.getFilePath();
				const bakPath = this.getBackupFilePath();
				if (this.lastWrittenJson) {
					try { await ioUtils.writeUTF8(bakPath, this.lastWrittenJson, { tmpPath: bakPath + '.tmp' }); } catch { /* ignore */ }
				}
				await ioUtils.writeUTF8(mainPath, payload, { tmpPath: mainPath + '.tmp' });
				this.lastWrittenJson = payload;
				this.lastError = '';
				return true;
			} catch (err) {
				this.lastError = err instanceof Error ? err.message : String(err || 'write failed');
				return false;
			}
		};
		this.flushing = (this.flushing || Promise.resolve(true)).then(run, run);
		return this.flushing;
	}

	async loadFromDisk(): Promise<ReadingProgressState | null> {
		const ioUtils = (globalThis as any).IOUtils;
		if (!ioUtils?.exists || !ioUtils?.readUTF8) return null;
		this.loadedFromLegacy = false;

		const primaryPaths = [this.getFilePath(), this.getBackupFilePath()];
		if (this.directory !== cacheDirectory()) {
			primaryPaths.push(cacheFile(cacheDirectory(), 'reading-progress.json'), cacheFile(cacheDirectory(), 'reading-progress.bak.json'));
		}
		for (const p of primaryPaths) {
			try {
				if (!(await ioUtils.exists(p))) continue;
				const raw = await ioUtils.readUTF8(p);
				if (!raw) continue;
				const parsed = readReadingProgressBackup(raw);
				this.lastWrittenJson = p === this.getFilePath() ? raw : '';
				return parsed;
			} catch { /* try next */ }
		}

		const legacyPaths = [cacheFile(this.directory, 'reading-notes.json'), cacheFile(this.directory, 'reading-notes.bak.json')];
		if (this.directory !== cacheDirectory()) {
			legacyPaths.push(cacheFile(cacheDirectory(), 'reading-notes.json'), cacheFile(cacheDirectory(), 'reading-notes.bak.json'));
		}
		for (const lp of legacyPaths) {
			try {
				if (!(await ioUtils.exists(lp))) continue;
				const raw = await ioUtils.readUTF8(lp);
				if (!raw) continue;
				const parsed = readReadingNotesBackup(raw);
				this.loadedFromLegacy = true;
				return pickReadingProgressState(parsed);
			} catch { /* try next */ }
		}
		return null;
	}

	mergeDurableState(
		current: Pick<WorkspaceState, 'lastViewedAt' | 'readingProgress'>,
		disk: ReadingProgressState,
	): boolean {
		let changed = false;
		for (const [k, viewedAt] of Object.entries(disk.lastViewedAt)) {
			if (viewedAt > (current.lastViewedAt[k] || 0)) {
				current.lastViewedAt[k] = viewedAt;
				changed = true;
			}
		}
		for (const [k, diskProg] of Object.entries(disk.readingProgress)) {
			const cur = current.readingProgress[k];
			if (!cur) {
				current.readingProgress[k] = {
					...diskProg,
					...(diskProg.pageSeconds ? { pageSeconds: { ...diskProg.pageSeconds } } : {}),
				};
				changed = true;
				continue;
			}
			const mergedPages: Record<string, number> = { ...(cur.pageSeconds || {}) };
			let pagesChanged = false;
			for (const [p, sec] of Object.entries(diskProg.pageSeconds || {})) {
				if (sec > (mergedPages[p] || 0)) {
					mergedPages[p] = sec;
					pagesChanged = true;
				}
			}
			const mergedSeconds = Math.max(cur.readSeconds, diskProg.readSeconds);
			const nextLastPage = cur.lastPage || diskProg.lastPage;
			const nextTotal = Math.max(cur.totalPages || 0, diskProg.totalPages || 0) || undefined;
			if (pagesChanged || mergedSeconds > cur.readSeconds || nextLastPage !== cur.lastPage || nextTotal !== cur.totalPages) {
				current.readingProgress[k] = {
					readSeconds: mergedSeconds,
					...(nextLastPage ? { lastPage: nextLastPage } : {}),
					...(nextTotal ? { totalPages: nextTotal } : {}),
					...(Object.keys(mergedPages).length ? { pageSeconds: mergedPages } : {}),
				};
				changed = true;
			}
		}
		return changed;
	}

	dispose(): void {
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
	}
}
