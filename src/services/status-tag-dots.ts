import { getActiveRatingsCache } from './item-ratings-cache.ts';
import { isItemTrashedOrDeleted, isItemWritable, isRegularValidItem } from './item-resolution.ts';
import {
	getCustomStatusColor,
	purgeZoteroStatusTagColors,
	rememberCustomStatusColor,
	restoreZoteroStatusTagColors,
} from './status-tag-colors.ts';

export interface StatusOption {
	readonly tag: string;
	readonly label: string;
	readonly color: string;
}

const CACHE_LIMIT = 5000;

export const DEFAULT_STATUS_PRESETS_ZH: readonly StatusOption[] = [
	{ tag: '/待读', label: '待读', color: '#64748b' },
	{ tag: '/在读', label: '在读', color: '#2563eb' },
	{ tag: '/精读', label: '精读', color: '#0d9488' },
	{ tag: '/核心', label: '核心', color: '#e11d48' },
	{ tag: '/已读', label: '已读', color: '#16a34a' },
];

export const DEFAULT_STATUS_PRESETS_EN: readonly StatusOption[] = [
	{ tag: '/Unread', label: 'Unread', color: '#64748b' },
	{ tag: '/Reading', label: 'Reading', color: '#2563eb' },
	{ tag: '/DeepRead', label: 'DeepRead', color: '#0d9488' },
	{ tag: '/Core', label: 'Core', color: '#e11d48' },
	{ tag: '/Done', label: 'Done', color: '#16a34a' },
];

const FALLBACK_PALETTE = ['#2563eb', '#0d9488', '#e11d48', '#d97706', '#7c3aed', '#16a34a', '#0284c7', '#64748b'];
const statusCache = new Map<string, StatusOption | null>();

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

export function clearStatusTagCache(itemIDs?: Iterable<number>): void {
	if (!itemIDs) { statusCache.clear(); return; }
	const targets = new Set(itemIDs);
	for (const k of statusCache.keys()) {
		if (targets.has(Number(k.split(':', 1)[0]))) statusCache.delete(k);
	}
}

export function resolveTargetRegularItem(item: any): any {
	if (!item || isItemTrashedOrDeleted(item)) return null;
	let candidate = item;
	if (!isRegularValidItem(candidate) && (candidate.parentItem || candidate.parentItemID)) {
		candidate = candidate.parentItem || (globalThis as any).Zotero?.Items?.get?.(candidate.parentItemID) || candidate;
	}
	return isRegularValidItem(candidate) ? candidate : null;
}

export function isStatusTagName(tagName: string, excludedTag = '/Citations'): boolean {
	const t = String(tagName || '').trim();
	if (!t.startsWith('/') || t.length < 2) return false;
	return !(excludedTag && t.toLowerCase() === excludedTag.trim().toLowerCase());
}

export function normalizeHexColor(raw: string, fallback = '#2563eb'): string {
	const hex = String(raw || '').trim();
	if (/^#[\da-f]{6}$/i.test(hex)) return hex.toLowerCase();
	if (/^#[\da-f]{3}$/i.test(hex)) return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`.toLowerCase();
	return fallback;
}

export function parseCustomStatusInput(name: string, color: string, excludedTag = '/Citations'): StatusOption | null {
	const cleanLabel = String(name || '').trim().replace(/^\/+/, '').trim();
	if (!cleanLabel || /[\r\n]/.test(cleanLabel)) return null;
	const tag = `/${cleanLabel}`;
	if (!isStatusTagName(tag, excludedTag)) return null;
	return { tag, label: cleanLabel, color: normalizeHexColor(color, '#2563eb') };
}

function hashTagColor(tag: string): string {
	let h = 0;
	for (let i = 0; i < tag.length; i++) h = ((h << 5) - h + tag.charCodeAt(i)) | 0;
	return FALLBACK_PALETTE[Math.abs(h) % FALLBACK_PALETTE.length];
}

export function resolveStatusColor(libraryID: number | undefined, tag: string): string {
	const savedCustom = getCustomStatusColor(tag);
	if (savedCustom) return savedCustom;
	for (const p of [...DEFAULT_STATUS_PRESETS_ZH, ...DEFAULT_STATUS_PRESETS_EN]) {
		if (p.tag.toLowerCase() === tag.toLowerCase()) return p.color;
	}
	try {
		const zTags = (globalThis as any).Zotero?.Tags;
		const colorEntry = libraryID ? zTags?.getColor?.(libraryID, tag) : null;
		const hex = typeof colorEntry === 'string' ? colorEntry : colorEntry?.color;
		if (hex && /^#[\da-f]{3,6}$/i.test(hex)) return normalizeHexColor(hex);
	} catch { /* ignore */ }
	return hashTagColor(tag);
}

export function getItemStatus(rawItem: any, excludedTag = '/Citations'): StatusOption | null {
	const item = resolveTargetRegularItem(rawItem);
	if (!item || typeof item.getTags !== 'function') return null;
	const id = Number(item.id || 0);
	const stamp = String(item.version ?? item.dateModified ?? '');
	const cacheKey = id > 0 && stamp ? `${id}:${stamp}:${excludedTag}` : '';
	if (cacheKey && statusCache.has(cacheKey)) return getLru(statusCache, cacheKey) ?? null;
	let found: StatusOption | null = null;
	for (const entry of item.getTags() || []) {
		const t = String(entry?.tag || '').trim();
		if (isStatusTagName(t, excludedTag)) {
			found = { tag: t, label: t.replace(/^\/+/, ''), color: resolveStatusColor(item.libraryID, t) };
			break;
		}
	}
	if (cacheKey) setLru(statusCache, cacheKey, found);
	return found;
}

export function listAvailableStatuses(items: readonly any[], zh = true, excludedTag = '/Citations'): StatusOption[] {
	const presets = zh ? DEFAULT_STATUS_PRESETS_ZH : DEFAULT_STATUS_PRESETS_EN;
	const byLower = new Map<string, StatusOption>();
	for (const p of presets) byLower.set(p.tag.toLowerCase(), { ...p, color: resolveStatusColor(undefined, p.tag) });
	for (const raw of items) {
		const item = resolveTargetRegularItem(raw);
		if (!item || typeof item.getTags !== 'function') continue;
		for (const entry of item.getTags() || []) {
			const t = String(entry?.tag || '').trim();
			if (isStatusTagName(t, excludedTag) && !byLower.has(t.toLowerCase())) {
				byLower.set(t.toLowerCase(), { tag: t, label: t.replace(/^\/+/, ''), color: resolveStatusColor(item.libraryID, t) });
			}
		}
	}
	return [...byLower.values()];
}

export async function setItemStatus(
	rawItem: any,
	statusTag: string | null,
	options?: { color?: string; excludedTag?: string; syncZoteroTagColor?: boolean },
): Promise<boolean> {
	const item = resolveTargetRegularItem(rawItem);
	if (!item || !isItemWritable(item) || typeof item.getTags !== 'function') return false;
	const excluded = options?.excludedTag ?? '/Citations';
	if (statusTag !== null && !isStatusTagName(statusTag, excluded)) return false;

	let changed = false;
	for (const entry of item.getTags() || []) {
		const t = String(entry?.tag || '').trim();
		if (isStatusTagName(t, excluded) && t !== statusTag) {
			item.removeTag?.(t);
			changed = true;
		}
	}
	if (statusTag !== null) {
		const hasAlready = (item.getTags() || []).some((e: any) => String(e?.tag || '').trim() === statusTag);
		if (!hasAlready) {
			item.addTag?.(statusTag);
			changed = true;
		}
		if (options?.color) {
			const cleanHex = normalizeHexColor(options.color);
			rememberCustomStatusColor(statusTag, cleanHex);
			if (options.syncZoteroTagColor) {
				try {
					const zTags = (globalThis as any).Zotero?.Tags;
					if (item.libraryID && typeof zTags?.setColor === 'function' && !zTags?.getColor?.(item.libraryID, statusTag)) {
						await zTags.setColor(item.libraryID, statusTag, cleanHex);
					}
				} catch { /* ignore */ }
			}
		}
	}
	if (changed) {
		clearStatusTagCache([Number(item?.id || 0), Number(rawItem?.id || 0)].filter((n) => n > 0));
		await item.saveTx?.();
	}
	return changed;
}

export function clearNativeStatusTagDots(excludedTag = '/Citations'): Promise<number> {
	statusCache.clear();
	return purgeZoteroStatusTagColors(isStatusTagName, excludedTag);
}

export function syncNativeStatusTagDots(enable: boolean, excludedTag = '/Citations'): Promise<number> {
	statusCache.clear();
	return enable
		? restoreZoteroStatusTagColors(isStatusTagName, resolveStatusColor, excludedTag)
		: purgeZoteroStatusTagColors(isStatusTagName, excludedTag);
}

export { getActiveRatingsCache };
