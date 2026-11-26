import { buildReadingHeatmapBuckets, type TabReadingProgress } from '../../../services/reading-stats.ts';

export interface TitleHeatmapOptions {
	color?: string;
	opacityPercent?: number;
	bucketCount?: number;
}

const DEFAULT_RGB = '13, 148, 136';
export const HEATMAP_STYLE_ID = 'zbf-title-heatmap-style';
export const TITLE_TAG_DOTS_STYLE_ID = 'zbf-title-tag-dots-style';
export const TITLE_TAG_DOTS_HIDE_CSS = '#zotero-items-pane .cell.primary .colored-tag-swatches { display: none !important; }';
export const HEATMAP_CSS = `.virtualized-table .cell-text[data-zbf-heatmap="1"]{border-radius:4px;padding-inline:4px;margin-inline:-4px;background-repeat:no-repeat;box-decoration-break:clone;transition:filter .14s ease}.virtualized-table .row:hover .cell-text[data-zbf-heatmap="1"]{filter:saturate(1.12)}.virtualized-table:focus-within .row.selected .cell-text[data-zbf-heatmap="1"]{--zbf-heat-rgb:255,255,255!important}@media (prefers-reduced-motion:reduce){.virtualized-table .cell-text[data-zbf-heatmap="1"]{transition:none!important}}`;

const MAX_GRADIENT_CACHE = 5000;
const heatmapGradientCache = new Map<string, string>();
const progressGradientMemo = new WeakMap<TabReadingProgress, Map<string, string>>();
const progressSummaryMemo = new WeakMap<TabReadingProgress, { zh?: string; en?: string }>();

function setGradientCache(key: string, value: string): void {
	if (heatmapGradientCache.has(key)) heatmapGradientCache.delete(key);
	else if (heatmapGradientCache.size >= MAX_GRADIENT_CACHE) {
		const oldest = heatmapGradientCache.keys().next().value;
		if (oldest !== undefined) heatmapGradientCache.delete(oldest);
	}
	heatmapGradientCache.set(key, value);
}

function resolveProgressTooltipSummary(progress: TabReadingProgress, zh: boolean): string {
	const memo = progressSummaryMemo.get(progress);
	const cached = zh ? memo?.zh : memo?.en;
	if (cached !== undefined) return cached;
	const secs = Math.max(0, Math.floor(Number(progress.readSeconds) || 0));
	const dur = secs < 60 ? (secs > 0 ? `${secs}s` : '') : (secs < 3600 ? `${Math.floor(secs / 60)}m` : `${Math.floor(secs / 3600)}h${Math.floor((secs % 3600) / 60) || ''}m`);
	let peakPage = 0, peakSec = 0;
	for (const [k, v] of Object.entries(progress.pageSeconds || {})) {
		const p = Number(k), s = Number(v);
		if (p > 0 && s > peakSec) { peakPage = p; peakSec = s; }
	}
	const parts: string[] = [];
	if (dur) parts.push(dur);
	if (progress.lastPage) parts.push(progress.totalPages ? `p.${progress.lastPage}/${progress.totalPages}` : `p.${progress.lastPage}`);
	if (peakPage > 0) parts.push(zh ? `峰值 p.${peakPage} (${peakSec < 60 ? `${peakSec}s` : `${Math.floor(peakSec / 60)}m`})` : `Peak p.${peakPage} (${peakSec < 60 ? `${peakSec}s` : `${Math.floor(peakSec / 60)}m`})`);
	const summary = parts.length ? (zh ? `阅读热图：${parts.join(' · ')}` : `Reading Heatmap: ${parts.join(' · ')}`) : '';
	const slot = memo || {};
	if (zh) slot.zh = summary;
	else slot.en = summary;
	progressSummaryMemo.set(progress, slot);
	return summary;
}

export function formatTitleHeatmapTooltip(
	baseTitle: string,
	progress?: TabReadingProgress,
	zh = true,
): string {
	if (!progress) return baseTitle;
	const summary = resolveProgressTooltipSummary(progress, zh);
	if (!summary) return baseTitle;
	return baseTitle ? `${baseTitle}\n${summary}` : summary;
}

export function hexToRgbTuple(hex: string | null | undefined): string {
	const raw = String(hex || '').trim().replace(/^#/, '');
	let full = raw;
	if (/^[0-9a-f]{3}$/i.test(raw)) {
		full = `${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
	}
	if (!/^[0-9a-f]{6}$/i.test(full)) return DEFAULT_RGB;
	const r = Number.parseInt(full.slice(0, 2), 16);
	const g = Number.parseInt(full.slice(2, 4), 16);
	const b = Number.parseInt(full.slice(4, 6), 16);
	return `${r}, ${g}, ${b}`;
}

function formatStopPct(idx: number, total: number): string {
	return `${((idx / total) * 100).toFixed(2)}%`;
}

export function getHeatmapGradientCacheSize(): number {
	return heatmapGradientCache.size;
}

export function buildTitleHeatmapGradient(
	progress?: TabReadingProgress,
	options: TitleHeatmapOptions = {},
): string {
	if (!progress?.pageSeconds) return '';
	const optKey = `${options.bucketCount ?? ''}|${options.color || ''}|${options.opacityPercent ?? ''}`;
	let progMap = progressGradientMemo.get(progress);
	const memoHit = progMap?.get(optKey);
	if (memoHit !== undefined) return memoHit;

	const rawTotal = Number(progress.totalPages || 0);
	const bucketCount = options.bucketCount ?? (rawTotal > 0 && rawTotal < 16 ? rawTotal : 16);
	const pageEntries = Object.entries(progress.pageSeconds);
	if (!pageEntries.length) return '';

	const rememberProgress = (val: string) => {
		if (!progMap) { progMap = new Map(); progressGradientMemo.set(progress, progMap); }
		progMap.set(optKey, val);
	};

	const cacheKey = `${Number(progress.readSeconds || 0)}|${rawTotal}|${bucketCount}|${options.color || ''}|${options.opacityPercent ?? ''}|${pageEntries.map(([p, s]) => `${p}:${s}`).join(',')}`;
	const cached = heatmapGradientCache.get(cacheKey);
	if (cached !== undefined) {
		heatmapGradientCache.delete(cacheKey);
		heatmapGradientCache.set(cacheKey, cached);
		rememberProgress(cached);
		return cached;
	}

	const buckets = buildReadingHeatmapBuckets(progress, bucketCount);
	if (!buckets.length || !buckets.some((v) => v > 0)) {
		setGradientCache(cacheKey, '');
		rememberProgress('');
		return '';
	}

	const rgb = hexToRgbTuple(options.color);
	const maxPct = Number(options.opacityPercent);
	const maxAlpha = Number.isFinite(maxPct)
		? Math.max(0.1, Math.min(0.9, maxPct / 100))
		: 0.42;
	const minAlpha = Math.max(0.05, maxAlpha * 0.34);

	const stops: string[] = [];
	const total = buckets.length;
	let i = 0;
	while (i < total) {
		const ratio = buckets[i];
		let end = i + 1;
		while (end < total && buckets[end] === ratio) end += 1;
		const color = ratio > 0
			? `rgba(var(--zbf-heat-rgb, ${rgb}), ${(minAlpha + ratio * (maxAlpha - minAlpha)).toFixed(3)})`
			: 'transparent';
		stops.push(`${color} ${formatStopPct(i, total)}`, `${color} ${formatStopPct(end, total)}`);
		i = end;
	}
	const out = `linear-gradient(to right, ${stops.join(', ')})`;
	setGradientCache(cacheKey, out);
	rememberProgress(out);
	return out;
}

function findCellText(cell: Element | null | undefined): HTMLElement | null {
	if (!cell) return null;
	if (cell.classList?.contains?.('cell-text')) return cell as HTMLElement;
	return (cell.querySelector?.('.cell-text') as HTMLElement | null) ?? null;
}

export function clearTitleHeatmapFromCell(cell: Element | null | undefined): void {
	const textEl = findCellText(cell);
	if (!textEl) return;
	if (textEl.getAttribute?.('data-zbf-heatmap') !== '1' && !textEl.style?.backgroundImage) return;
	if (typeof textEl.style?.removeProperty === 'function') {
		textEl.style.removeProperty('background-image');
		textEl.style.removeProperty('--zbf-heat-rgb');
	} else if (textEl.style) {
		textEl.style.backgroundImage = '';
	}
	if (textEl.getAttribute?.('data-zbf-heatmap-title') === '1') {
		textEl.removeAttribute?.('title');
		textEl.removeAttribute?.('data-zbf-heatmap-title');
	}
	textEl.removeAttribute?.('data-zbf-heatmap');
	cell?.removeAttribute?.('data-zbf-hm-cell');
}

export function applyTitleHeatmapToCell(
	cell: Element | null | undefined,
	progress?: TabReadingProgress,
	options: TitleHeatmapOptions = {},
): boolean {
	const textEl = findCellText(cell);
	if (!textEl) return false;
	const gradient = buildTitleHeatmapGradient(progress, options);
	if (!gradient) {
		clearTitleHeatmapFromCell(textEl);
		return false;
	}
	if (textEl.style && textEl.style.backgroundImage !== gradient) {
		textEl.style.backgroundImage = gradient;
	}
	if (textEl.getAttribute?.('data-zbf-heatmap') !== '1') {
		textEl.setAttribute?.('data-zbf-heatmap', '1');
	}
	cell?.setAttribute?.('data-zbf-hm-cell', '1');
	if (typeof textEl.setAttribute === 'function') {
		const zh = Boolean((globalThis as any).Zotero?.locale?.startsWith?.('zh'));
		const baseTitle = String(textEl.textContent || '').trim();
		const tip = formatTitleHeatmapTooltip(baseTitle, progress, zh);
		if (tip && textEl.getAttribute?.('title') !== tip) {
			textEl.setAttribute('title', tip);
			textEl.setAttribute('data-zbf-heatmap-title', '1');
		}
	}
	return true;
}
