import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../kernel/types.ts';
import { buildReadingHeatmapBuckets, type TabReadingProgress } from '../../services/reading-stats.ts';

export interface TitleHeatmapOptions {
	color?: string;
	opacityPercent?: number;
	bucketCount?: number;
}

const DEFAULT_RGB = '13, 148, 136';
const HEATMAP_STYLE_ID = 'zbf-title-heatmap-style';
const MAX_GRADIENT_CACHE = 500;
const heatmapGradientCache = new Map<string, string>();
const HEATMAP_CSS = `
.virtualized-table .cell-text[data-zbf-heatmap="1"] {
  border-radius: 3px; background-repeat: no-repeat; box-decoration-break: clone;
}
.virtualized-table:focus-within .row.selected .cell-text[data-zbf-heatmap="1"] {
  --zbf-heat-rgb: 255, 255, 255 !important;
}
`;

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

export function buildTitleHeatmapGradient(
	progress?: TabReadingProgress,
	options: TitleHeatmapOptions = {},
): string {
	const rawTotal = Number(progress?.totalPages || 0);
	const bucketCount = options.bucketCount ?? (rawTotal > 0 && rawTotal < 16 ? rawTotal : 16);
	const pageEntries = progress?.pageSeconds ? Object.entries(progress.pageSeconds) : [];
	if (!pageEntries.length) return '';

	const cacheKey = `${Number(progress?.readSeconds || 0)}|${rawTotal}|${bucketCount}|${options.color || ''}|${options.opacityPercent ?? ''}|${pageEntries.map(([p, s]) => `${p}:${s}`).join(',')}`;
	const cached = heatmapGradientCache.get(cacheKey);
	if (cached !== undefined) return cached;

	const buckets = buildReadingHeatmapBuckets(progress, bucketCount);
	if (!buckets.length || !buckets.some((v) => v > 0)) {
		if (heatmapGradientCache.size >= MAX_GRADIENT_CACHE) heatmapGradientCache.clear();
		heatmapGradientCache.set(cacheKey, '');
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
	if (heatmapGradientCache.size >= MAX_GRADIENT_CACHE) heatmapGradientCache.clear();
	heatmapGradientCache.set(cacheKey, out);
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
	textEl.removeAttribute?.('data-zbf-heatmap');
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
	return true;
}

export class TitleHeatmapController {
	private readonly kernel: PluginKernel;
	private readonly resolveProgress: (item: any) => TabReadingProgress | undefined;
	private readonly windows = new Set<Window>();
	private readonly disposers = new Map<Window, Disposable>();
	private readonly pollTimers = new Map<Window, ReturnType<typeof setTimeout>>();

	constructor(kernel: PluginKernel, resolveProgress: (item: any) => TabReadingProgress | undefined) {
		this.kernel = kernel;
		this.resolveProgress = resolveProgress;
	}

	isEnabled(): boolean {
		return Boolean(
			this.kernel.prefs.get('modules.visualNotes.enable')
			&& this.kernel.prefs.get('workspace.readingTitleHeatmap.enable'),
		);
	}

	getOptions(): TitleHeatmapOptions {
		return {
			color: String(this.kernel.prefs.get('workspace.readingHeatmap.color') || '#0d9488'),
			opacityPercent: Number(this.kernel.prefs.get('workspace.readingHeatmap.opacity') || 42),
		};
	}

	attachWindow(win: Window): void {
		if (!win) return;
		this.windows.add(win);
		if (!this.isEnabled() || this.disposers.has(win) || this.pollTimers.has(win)) return;
		this.tryPatchWindow(win, 0);
	}

	detachWindow(win: Window): void {
		this.windows.delete(win);
		this.clearWindowPatch(win);
	}

	sync(knownWindows?: Iterable<Window>): void {
		if (knownWindows) {
			for (const win of knownWindows) this.windows.add(win);
		}
		if (this.isEnabled()) {
			for (const win of this.windows) {
				if (!this.disposers.has(win) && !this.pollTimers.has(win)) {
					this.tryPatchWindow(win, 0);
				}
			}
			this.refreshWindows();
		} else {
			for (const win of [...this.windows]) {
				this.clearWindowPatch(win);
			}
		}
	}

	refreshWindows(): void {
		for (const win of this.windows) {
			try {
				(win as any)?.ZoteroPane?.itemsView?.tree?.invalidate?.();
			} catch { /* ignore */ }
		}
	}

	disposeAll(): void {
		for (const win of [...this.windows]) {
			this.clearWindowPatch(win);
		}
		this.windows.clear();
	}

	private clearWindowPatch(win: Window): void {
		const timer = this.pollTimers.get(win);
		if (timer !== undefined) {
			clearTimeout(timer);
			this.pollTimers.delete(win);
		}
		try { win.document?.getElementById?.(HEATMAP_STYLE_ID)?.remove?.(); } catch { /* ignore */ }
		const dispose = this.disposers.get(win);
		if (dispose) {
			this.disposers.delete(win);
			try { dispose(); } catch { /* ignore */ }
			try { (win as any)?.ZoteroPane?.itemsView?.tree?.invalidate?.(); } catch { /* ignore */ }
		}
	}

	private ensureWindowStyles(win: Window): void {
		const doc = win?.document;
		if (!doc || doc.getElementById?.(HEATMAP_STYLE_ID)) return;
		const head = doc.head || doc.documentElement;
		if (!head || typeof doc.createElementNS !== 'function') return;
		const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style') as HTMLStyleElement;
		style.id = HEATMAP_STYLE_ID;
		style.textContent = HEATMAP_CSS;
		head.appendChild(style);
	}

	private tryPatchWindow(win: Window, attempt: number): void {
		this.pollTimers.delete(win);
		if ((win as any).closed || !this.windows.has(win) || !this.isEnabled() || this.disposers.has(win)) {
			return;
		}
		const iv = (win as any)?.ZoteroPane?.itemsView;
		if (!iv || typeof iv._renderCell !== 'function') {
			if (attempt < 120) {
				const timer = setTimeout(() => this.tryPatchWindow(win, attempt + 1), 50);
				this.pollTimers.set(win, timer);
			}
			return;
		}
		this.ensureWindowStyles(win);
		const resolveProgress = this.resolveProgress;
		const isEnabled = () => this.isEnabled();
		const getOptions = () => this.getOptions();
		const dispose = this.kernel.runtime.patch(iv, '_renderCell', 'itemsView', (orig) => function (this: any, ...args: unknown[]) {
			const cell = orig.apply(this, args);
			if (!isEnabled() || !cell) return cell;
			const [index, , column] = args as [number, unknown, { dataKey?: string; primary?: boolean }?];
			if (column?.dataKey !== 'title' && column?.primary !== true) return cell;
			const row = this.getRow?.(index) ?? this._rows?.[index];
			const item = row?.ref;
			if (item && typeof item.id === 'number' && !item.deleted && (row?.isItem ?? true)) {
				applyTitleHeatmapToCell(cell as Element, resolveProgress(item), getOptions());
			} else {
				clearTitleHeatmapFromCell(cell as Element);
			}
			return cell;
		});
		this.disposers.set(win, dispose);
		try { iv.tree?.invalidate?.(); } catch { /* ignore */ }
	}
}
