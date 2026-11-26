import { getActiveRatingsCache } from './item-ratings-cache.ts';
import { isItemWritable } from './item-resolution.ts';
import { clearStatusTagCache, resolveTargetRegularItem } from './status-tag-dots.ts';

export {
	clearNativeStatusTagDots,
	DEFAULT_STATUS_PRESETS_EN,
	DEFAULT_STATUS_PRESETS_ZH,
	getItemStatus,
	isStatusTagName,
	listAvailableStatuses,
	normalizeHexColor,
	parseCustomStatusInput,
	resolveStatusColor,
	setItemStatus,
	syncNativeStatusTagDots,
	type StatusOption,
} from './status-tag-dots.ts';

export type RatingStorageLocation = 'cache' | 'extra' | 'tag';

export function normalizeRatingStorage(raw: unknown): RatingStorageLocation {
	return raw === 'extra' || raw === 'tag' ? raw : 'cache';
}

const RATING_STAR = '⭐';
const MAX_RATING = 5;
const EXTRA_RATING_RE = /^Rating:\s*([1-5])\s*$/i;
const CACHE_LIMIT = 5000;
const ratingCache = new Map<string, number>();

function setLru<V>(map: Map<string, V>, key: string, value: V): void {
	if (map.has(key)) map.delete(key);
	else if (map.size >= CACHE_LIMIT) {
		const oldest = map.keys().next().value;
		if (oldest !== undefined) map.delete(oldest);
	}
	map.set(key, value);
}

function getLru<V>(map: Map<string, V>, key: string): V | undefined {
	const hit = map.get(key);
	if (hit !== undefined) { map.delete(key); map.set(key, hit); }
	return hit;
}

export function clearStatusRatingCaches(itemIDs?: Iterable<number>): void {
	clearStatusTagCache(itemIDs);
	if (!itemIDs) { ratingCache.clear(); return; }
	const targets = new Set(itemIDs);
	for (const k of ratingCache.keys()) {
		if (targets.has(Number(k.split(':', 1)[0]))) ratingCache.delete(k);
	}
}

function clearTargetItemCache(item: any, rawItem?: any): void {
	clearStatusRatingCaches([Number(item?.id || 0), Number(rawItem?.id || 0)].filter((n) => n > 0));
}

export function isStarRatingTag(tagName: string): number {
	const chars = Array.from(String(tagName || '').trim());
	return chars.length >= 1 && chars.length <= MAX_RATING && chars.every((c) => c === RATING_STAR || c === '★') ? chars.length : 0;
}

export function parseExtraRating(extra: string): number {
	for (const line of String(extra || '').split(/\r?\n/)) {
		const m = EXTRA_RATING_RE.exec(line.trim());
		if (m) return Number(m[1]);
	}
	return 0;
}

export function writeExtraRating(extra: string, rating: number): string {
	const kept = String(extra || '').split(/\r?\n/).filter((line) => !EXTRA_RATING_RE.test(line.trim()));
	while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
	if (rating >= 1 && rating <= MAX_RATING) kept.push(`Rating: ${rating}`);
	return kept.join('\n');
}

export function getItemRating(rawItem: any, preferredStorage: RatingStorageLocation = 'cache'): number {
	const item = resolveTargetRegularItem(rawItem);
	if (!item) return 0;
	const diskCache = getActiveRatingsCache();
	const cacheHas = diskCache.hasEntry(item);
	const cacheVal = diskCache.getRating(item);
	if (preferredStorage === 'cache' && cacheHas) return cacheVal;

	const id = Number(item.id || 0);
	const stamp = String(item.version ?? item.dateModified ?? '');
	const cacheKey = id > 0 && stamp ? `${id}:${stamp}:${preferredStorage}:${cacheHas ? cacheVal : 'none'}` : '';
	if (cacheKey && ratingCache.has(cacheKey)) {
		return getLru(ratingCache, cacheKey) ?? 0;
	}

	let extraVal = 0;
	try {
		extraVal = parseExtraRating(String(item.getField?.('extra') || ''));
	} catch { /* ignore */ }

	let tagVal = 0;
	if (typeof item.getTags === 'function') {
		for (const entry of item.getTags() || []) {
			const stars = isStarRatingTag(String(entry?.tag || ''));
			if (stars > tagVal) tagVal = stars;
		}
	}

	const resolved = preferredStorage === 'cache'
		? (cacheVal || extraVal || tagVal)
		: preferredStorage === 'tag'
			? (tagVal || extraVal || cacheVal)
			: (extraVal || tagVal || cacheVal);
	if (cacheKey) setLru(ratingCache, cacheKey, resolved);
	return resolved;
}

export async function setItemRating(
	rawItem: any,
	nextRating: number,
	preferredStorage: RatingStorageLocation = 'cache',
): Promise<boolean> {
	const item = resolveTargetRegularItem(rawItem);
	if (!item) return false;
	const clamped = nextRating >= 1 && nextRating <= MAX_RATING ? Math.round(nextRating) : 0;

	if (preferredStorage === 'cache') {
		let hasLegacy = false;
		if (clamped === 0) {
			try {
				if (parseExtraRating(String(item.getField?.('extra') || '')) > 0) hasLegacy = true;
			} catch { /* ignore */ }
			if (!hasLegacy && typeof item.getTags === 'function') {
				hasLegacy = (item.getTags() || []).some((e: any) => isStarRatingTag(String(e?.tag || '')) > 0);
			}
		}
		const changed = getActiveRatingsCache().setRating(item, clamped, false, hasLegacy);
		clearTargetItemCache(item, rawItem);
		return changed;
	}

	if (!isItemWritable(item)) return false;
	let changed = false;
	if (getActiveRatingsCache().setRating(item, 0)) changed = true;

	if (typeof item.getTags === 'function') {
		const targetStarTag = preferredStorage === 'tag' && clamped > 0 ? RATING_STAR.repeat(clamped) : '';
		for (const entry of item.getTags() || []) {
			const t = String(entry?.tag || '');
			if (isStarRatingTag(t) > 0 && t !== targetStarTag) {
				item.removeTag?.(t);
				changed = true;
			}
		}
		if (targetStarTag) {
			const exists = (item.getTags() || []).some((e: any) => String(e?.tag || '') === targetStarTag);
			if (!exists) {
				item.addTag?.(targetStarTag);
				changed = true;
			}
		}
	}

	if (typeof item.getField === 'function' && typeof item.setField === 'function') {
		const currentExtra = String(item.getField('extra') || '');
		const updatedExtra = writeExtraRating(currentExtra, preferredStorage === 'extra' ? clamped : 0);
		if (updatedExtra !== currentExtra) {
			item.setField('extra', updatedExtra);
			changed = true;
		}
	}

	if (changed) {
		clearTargetItemCache(item, rawItem);
		await item.saveTx?.();
	}
	return changed;
}

export function captureBatchTargets(selected: readonly any[], clicked: any): any[] {
	const targetClicked = resolveTargetRegularItem(clicked);
	if (!targetClicked) return [];
	const normalizedSelected = (selected || [])
		.map(resolveTargetRegularItem)
		.filter((it) => it && it.libraryID === targetClicked.libraryID);
	const inSelection = normalizedSelected.some((it) => Number(it.id) === Number(targetClicked.id));
	const pool = inSelection ? normalizedSelected : [targetClicked];
	const dedup = new Map<number, any>();
	for (const it of pool) {
		const id = Number(it.id || 0);
		if (id > 0 && !dedup.has(id)) dedup.set(id, it);
	}
	return [...dedup.values()];
}
