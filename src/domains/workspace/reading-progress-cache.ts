import { DurableCacheFile } from '../../services/durable-cache-file.ts';
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
 * - Writes `<ZoteroDataDir>/bridgeflow-cache/reading/reading-progress.json` + `.bak.json`.
 * - Isolated from workspace snapshots AND user-authored brief notes (`brief-notes.json`).
 * - Seamlessly migrates legacy `reading-notes.json` (`v0.4.1`) on startup.
 */
export class ReadingProgressDiskCache {
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly file: DurableCacheFile;
	private readonly root: string;

	constructor(privateDirectory = '') { this.root = privateDirectory; this.file = new DurableCacheFile('reading', 'reading-progress', privateDirectory); }
	get lastError(): string { return this.file.lastError; }
	get loadedFromLegacy(): boolean { return this.file.needsMigration; }
	getDirectoryPath(): string { return this.file.directory; }
	getFilePath(): string { return this.file.path; }
	getBackupFilePath(): string { return this.file.backup; }

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

	flushNow(state: Pick<WorkspaceState, 'lastViewedAt' | 'readingProgress'>): Promise<boolean> {
		return this.file.write(() => JSON.stringify({
			format: 'zotero-bridgeflow-reading-progress', version: 1, state: pickReadingProgressState(state),
		}), 600_000);
	}

	loadFromDisk(): Promise<ReadingProgressState | null> {
		const legacy = [...new Set([cacheDirectory(this.root), cacheDirectory()])].flatMap(root =>
			['reading-notes.json', 'reading-notes.bak.json'].map(name => cacheFile(root, name)));
		return this.file.load((text, path) => legacy.includes(path)
			? pickReadingProgressState(readReadingNotesBackup(text))
			: readReadingProgressBackup(text), legacy);
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
