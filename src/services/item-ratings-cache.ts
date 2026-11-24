import { cacheDirectory, cacheFile } from './cache-directory.ts';

export interface ItemRatingsFilePayload {
	readonly format: 'zotero-bridgeflow-item-ratings';
	readonly version: 1;
	readonly ratings: Record<string, number>;
}

const FORMAT_ID = 'zotero-bridgeflow-item-ratings';
const MAX_RATING = 5;

export function buildRatingCacheKeys(item: any): { primary: string; fallback: string } {
	const libId = Number(item?.libraryID || 1);
	const itemKey = typeof item?.key === 'string' && item.key.trim() ? item.key.trim() : '';
	const itemId = Number(item?.id || 0);
	const primary = itemKey ? `${libId}:${itemKey}` : (itemId > 0 ? `item:${itemId}` : '');
	const fallback = itemKey && itemId > 0 ? `item:${itemId}` : '';
	return { primary, fallback };
}

function parseRatingsPayload(raw: string): Record<string, number> | null {
	try {
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		const src = parsed.format === FORMAT_ID && parsed.ratings && typeof parsed.ratings === 'object'
			? parsed.ratings
			: (parsed.ratings && typeof parsed.ratings === 'object' ? parsed.ratings : null);
		if (!src || Array.isArray(src)) return null;
		const clean: Record<string, number> = {};
		for (const [k, v] of Object.entries(src)) {
			const key = String(k || '').trim();
			const n = Math.round(Number(v));
			if (key && Number.isInteger(n) && n >= 0 && n <= MAX_RATING) {
				clean[key] = n;
			}
		}
		return clean;
	} catch {
		return null;
	}
}

/**
 * Dedicated durable local cache for item star ratings:
 * - Writes `<ZoteroDataDir>/bridgeflow-cache/item-ratings.json` + `.bak.json`.
 * - Keeps user Zotero item Extra fields and tags clean unless the user opts into Extra/Tag mode.
 */
export class ItemRatingsDiskCache {
	private ratings: Record<string, number> = {};
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private flushing: Promise<boolean> | null = null;
	private lastWrittenJson = '';
	public lastError = '';
	private directory: string;
	private initialized = false;

	constructor(customDir = '') {
		this.directory = cacheDirectory(customDir);
	}

	configure(customDir = ''): void {
		const nextDir = cacheDirectory(customDir);
		if (nextDir !== this.directory) {
			this.directory = nextDir;
			this.lastWrittenJson = '';
		}
	}

	getDirectoryPath(): string { return this.directory; }
	getFilePath(): string { return cacheFile(this.directory, 'item-ratings.json'); }
	getBackupFilePath(): string { return cacheFile(this.directory, 'item-ratings.bak.json'); }

	async init(): Promise<boolean> {
		this.initialized = true;
		const disk = await this.loadFromDisk();
		if (disk) {
			for (const [k, v] of Object.entries(disk)) {
				if (!(k in this.ratings)) this.ratings[k] = v;
			}
			return true;
		}
		await this.flushNow();
		return false;
	}

	hasEntry(item: any): boolean {
		const { primary, fallback } = buildRatingCacheKeys(item);
		return Boolean((primary && primary in this.ratings) || (fallback && fallback in this.ratings));
	}

	getRating(item: any): number {
		const { primary, fallback } = buildRatingCacheKeys(item);
		if (primary && primary in this.ratings) return this.ratings[primary];
		if (fallback && fallback in this.ratings) return this.ratings[fallback];
		return 0;
	}

	setRating(item: any, rating: number, immediate = false, keepZeroTombstone = false): boolean {
		const { primary, fallback } = buildRatingCacheKeys(item);
		if (!primary) return false;
		const clamped = rating >= 1 && rating <= MAX_RATING ? Math.round(rating) : 0;
		const prevHas = this.hasEntry(item);
		const prev = this.getRating(item);
		let changed = prev !== clamped;
		if (fallback && fallback in this.ratings) {
			delete this.ratings[fallback];
			changed = true;
		}
		if (clamped > 0) {
			if (this.ratings[primary] !== clamped) {
				this.ratings[primary] = clamped;
				changed = true;
			}
		} else if (keepZeroTombstone) {
			if (!prevHas || this.ratings[primary] !== 0) {
				this.ratings[primary] = 0;
				changed = true;
			}
		} else if (primary in this.ratings) {
			delete this.ratings[primary];
			changed = true;
		}
		if (changed) this.scheduleSave(immediate);
		return changed;
	}

	getCount(): number {
		return Object.values(this.ratings).filter((n) => n >= 1 && n <= MAX_RATING).length;
	}

	exportJson(): string {
		const payload: ItemRatingsFilePayload = {
			format: FORMAT_ID,
			version: 1,
			ratings: { ...this.ratings },
		};
		return `${JSON.stringify(payload, null, 2)}\n`;
	}

	clearAll(immediate = true): void {
		this.ratings = {};
		this.scheduleSave(immediate);
	}

	scheduleSave(immediate = false): void {
		const ioUtils = (globalThis as any).IOUtils;
		if (!ioUtils?.writeUTF8) return;
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		if (immediate) {
			void this.flushNow();
			return;
		}
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			void this.flushNow();
		}, 180);
	}

	async flushNow(): Promise<boolean> {
		const ioUtils = (globalThis as any).IOUtils;
		if (!ioUtils?.writeUTF8) return true;
		const payload = this.exportJson();

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

	async loadFromDisk(): Promise<Record<string, number> | null> {
		const ioUtils = (globalThis as any).IOUtils;
		if (!ioUtils?.exists || !ioUtils?.readUTF8) return null;

		const candidates = [this.getFilePath(), this.getBackupFilePath()];
		if (this.directory !== cacheDirectory()) {
			candidates.push(
				cacheFile(cacheDirectory(), 'item-ratings.json'),
				cacheFile(cacheDirectory(), 'item-ratings.bak.json'),
			);
		}
		for (const p of candidates) {
			try {
				if (!(await ioUtils.exists(p))) continue;
				const raw = await ioUtils.readUTF8(p);
				if (!raw) continue;
				const parsed = parseRatingsPayload(raw);
				if (!parsed) continue;
				this.lastWrittenJson = p === this.getFilePath() ? raw : '';
				return parsed;
			} catch { /* try next */ }
		}
		return null;
	}

	isInitialized(): boolean {
		return this.initialized;
	}

	dispose(): void {
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
			void this.flushNow();
		}
	}
}

let activeRatingsCache = new ItemRatingsDiskCache();

export function getActiveRatingsCache(): ItemRatingsDiskCache {
	return activeRatingsCache;
}

export function setActiveRatingsCache(cache: ItemRatingsDiskCache): void {
	activeRatingsCache = cache;
}
