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
 * - Writes `<ZoteroDataDir>/bridgeflow-cache/brief-notes.json` + `.bak.json`.
 * - Strictly isolated from 15s reading-progress telemetry and ephemeral workspace
 *   groups/snapshots so manual notes are never overwritten by automatic ticks or clears.
 * - Seamlessly migrates legacy `reading-notes.json` (`v0.4.1`) on startup.
 */
export class BriefNotesDiskCache {
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
	getFilePath(): string { return cacheFile(this.directory, 'brief-notes.json'); }
	getBackupFilePath(): string { return cacheFile(this.directory, 'brief-notes.bak.json'); }

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

	async flushNow(state: Pick<WorkspaceState, 'remarks' | 'remarkModes'>): Promise<boolean> {
		const ioUtils = (globalThis as any).IOUtils;
		if (!ioUtils?.writeUTF8) return true;
		const payload = `${JSON.stringify({
			format: 'zotero-bridgeflow-brief-notes',
			version: 1,
			state: pickBriefNotesState(state),
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

	async loadFromDisk(): Promise<BriefNotesState | null> {
		const ioUtils = (globalThis as any).IOUtils;
		if (!ioUtils?.exists || !ioUtils?.readUTF8) return null;
		this.loadedFromLegacy = false;

		const primaryPaths = [this.getFilePath(), this.getBackupFilePath()];
		if (this.directory !== cacheDirectory()) {
			primaryPaths.push(cacheFile(cacheDirectory(), 'brief-notes.json'), cacheFile(cacheDirectory(), 'brief-notes.bak.json'));
		}
		for (const p of primaryPaths) {
			try {
				if (!(await ioUtils.exists(p))) continue;
				const raw = await ioUtils.readUTF8(p);
				if (!raw) continue;
				const parsed = readBriefNotesBackup(raw);
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
				return pickBriefNotesState(parsed);
			} catch { /* try next */ }
		}
		return null;
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

	dispose(): void {
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
	}
}
