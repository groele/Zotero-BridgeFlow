import { DurableCacheFile } from './durable-cache-file.ts';

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
 * - Writes `<ZoteroDataDir>/bridgeflow-cache/ratings/item-ratings.json` + `.bak.json`.
 * - Keeps user Zotero item Extra fields and tags clean unless the user opts into Extra/Tag mode.
 */
export class ItemRatingsDiskCache {
	private ratings: Record<string, number> = {};
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private file: DurableCacheFile;
	private root: string;
	private initialized = false;

	constructor(customDir = '') {
		this.root = customDir;
		this.file = new DurableCacheFile('ratings', 'item-ratings', customDir);
	}

	configure(customDir = ''): void {
		if (!this.initialized && customDir !== this.root) {
			this.root = customDir;
			this.file = new DurableCacheFile('ratings', 'item-ratings', customDir);
		}
	}

	get lastError(): string { return this.file.lastError; }
	getDirectoryPath(): string { return this.file.directory; }
	getFilePath(): string { return this.file.path; }
	getBackupFilePath(): string { return this.file.backup; }

	async init(): Promise<boolean> {
		this.initialized = true;
		const disk = await this.loadFromDisk();
		if (disk) {
			for (const [k, v] of Object.entries(disk)) {
				if (!(k in this.ratings)) this.ratings[k] = v;
			}
			if (this.file.needsMigration) await this.flushNow();
			return true;
		}
		// Create the destination on first mutation.
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

	flushNow(): Promise<boolean> {
		return this.file.write(() => this.exportJson());
	}

	loadFromDisk(): Promise<Record<string, number> | null> {
		return this.file.load(text => {
			const parsed = parseRatingsPayload(text);
			if (!parsed) throw new Error('Invalid ratings file');
			return parsed;
		});
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
