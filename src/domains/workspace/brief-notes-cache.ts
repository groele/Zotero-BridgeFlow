import { DurableCacheFile } from '../../services/durable-cache-file.ts';
import { cacheDirectory, cacheFile } from '../../services/cache-directory.ts';
import {
	pickBriefNotesState,
	readBriefNotesBackup,
	readReadingNotesBackup,
	type BriefNotesState,
} from './workspace-schema.ts';
import type { WorkspaceState } from './types.ts';

/**
 * Dedicated durable local cache for user-authored Brief Notes ("简记"):
 * - Writes `<ZoteroDataDir>/bridgeflow-cache/reading/brief-notes.json` + `.bak.json`.
 * - Strictly isolated from 15s reading-progress telemetry and ephemeral workspace
 *   groups/snapshots so manual notes are never overwritten by automatic ticks or clears.
 * - Seamlessly migrates legacy `reading-notes.json` (`v0.4.1`) on startup.
 */
export class BriefNotesDiskCache {
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly file: DurableCacheFile;
	private readonly root: string;

	constructor(privateDirectory = '') { this.root = privateDirectory; this.file = new DurableCacheFile('reading', 'brief-notes', privateDirectory); }
	get lastError(): string { return this.file.lastError; }
	get loadedFromLegacy(): boolean { return this.file.needsMigration; }
	getDirectoryPath(): string { return this.file.directory; }
	getFilePath(): string { return this.file.path; }
	getBackupFilePath(): string { return this.file.backup; }

	scheduleSave(state: Pick<WorkspaceState, 'remarks' | 'remarkModes'>, immediate = false): void {
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
		}, 240);
	}

	flushNow(state: BriefNotesState, replaceBackup = false): Promise<boolean> {
		this.dispose();
		return this.file.write(() => `${JSON.stringify({
			format: 'zotero-bridgeflow-brief-notes', version: 1, state: pickBriefNotesState(state),
		}, null, 2)}\n`, 0, replaceBackup);
	}

	loadFromDisk(): Promise<BriefNotesState | null> {
		const legacy = [...new Set([cacheDirectory(this.root), cacheDirectory()])].flatMap(root =>
			['reading-notes.json', 'reading-notes.bak.json'].map(name => cacheFile(root, name)));
		return this.file.load((text, path) => legacy.includes(path)
			? pickBriefNotesState(readReadingNotesBackup(text))
			: readBriefNotesBackup(text), legacy);
	}

	mergeDurableState(
		current: Pick<WorkspaceState, 'remarks' | 'remarkModes'>,
		disk: BriefNotesState,
	): boolean {
		let changed = false;
		for (const [k, rem] of Object.entries(disk.remarks)) {
			if (!current.remarks[k]) {
				current.remarks[k] = rem;
				changed = true;
			}
		}
		for (const [k, mode] of Object.entries(disk.remarkModes)) {
			if (!current.remarkModes[k]) {
				current.remarkModes[k] = mode;
				changed = true;
			}
		}
		return changed;
	}

	flushPending(state: BriefNotesState): void {
		if (this.flushTimer !== null || this.lastError) void this.flushNow(state);
	}

	private dispose(): void {
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
	}
}
