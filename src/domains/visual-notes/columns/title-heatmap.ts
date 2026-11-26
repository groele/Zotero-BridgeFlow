import type { PluginKernel } from '../../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../../kernel/types.ts';
import { patchItemsViewRenderCell } from '../../../services/host/tree-view-adapter.ts';
import type { TabReadingProgress } from '../../../services/reading-stats.ts';
import {
	applyTitleHeatmapToCell,
	clearTitleHeatmapFromCell,
	HEATMAP_CSS,
	HEATMAP_STYLE_ID,
	TITLE_TAG_DOTS_HIDE_CSS,
	TITLE_TAG_DOTS_STYLE_ID,
	type TitleHeatmapOptions,
} from './title-heatmap-dom.ts';

export {
	applyTitleHeatmapToCell,
	buildTitleHeatmapGradient,
	clearTitleHeatmapFromCell,
	formatTitleHeatmapTooltip,
	getHeatmapGradientCacheSize,
	hexToRgbTuple,
	TITLE_TAG_DOTS_HIDE_CSS,
	TITLE_TAG_DOTS_STYLE_ID,
	type TitleHeatmapOptions,
} from './title-heatmap-dom.ts';

export class TitleHeatmapController {
	private readonly kernel: PluginKernel;
	private readonly resolveProgress: (item: any) => TabReadingProgress | undefined;
	private readonly windows = new Set<Window>();
	private readonly disposers = new Map<Window, Disposable>();
	private readonly pollTimers = new Map<Window, ReturnType<typeof setTimeout>>();
	private cachedEnabled = false;
	private cachedOptions: TitleHeatmapOptions = { color: '#0d9488', opacityPercent: 42 };

	constructor(kernel: PluginKernel, resolveProgress: (item: any) => TabReadingProgress | undefined) {
		this.kernel = kernel;
		this.resolveProgress = resolveProgress;
		this.refreshCachedPrefs();
	}

	private refreshCachedPrefs(): void {
		this.cachedEnabled = this.isEnabled();
		this.cachedOptions = this.getOptions();
	}

	isEnabled(): boolean {
		return Boolean(this.kernel.prefs.get('modules.visualNotes.enable') && this.kernel.prefs.get('workspace.readingTitleHeatmap.enable'));
	}

	getOptions(): TitleHeatmapOptions {
		return {
			color: String(this.kernel.prefs.get('workspace.readingHeatmap.color') || '#0d9488'),
			opacityPercent: Number(this.kernel.prefs.get('workspace.readingHeatmap.opacity') || 42),
		};
	}

	attachWindow(win: Window): void {
		if (!win) return;
		this.refreshCachedPrefs();
		this.windows.add(win);
		this.syncTitleTagDotsStyle(win);
		if (!this.cachedEnabled || this.disposers.has(win) || this.pollTimers.has(win)) return;
		this.tryPatchWindow(win, 0);
	}

	detachWindow(win: Window): void {
		this.windows.delete(win);
		try { win.document?.getElementById?.(TITLE_TAG_DOTS_STYLE_ID)?.remove?.(); } catch { /* ignore */ }
		this.clearWindowPatch(win);
	}

	sync(knownWindows?: Iterable<Window>): void {
		this.refreshCachedPrefs();
		if (knownWindows) for (const win of knownWindows) this.windows.add(win);
		for (const win of this.windows) this.syncTitleTagDotsStyle(win);
		if (this.cachedEnabled) {
			for (const win of this.windows) if (!this.disposers.has(win) && !this.pollTimers.has(win)) this.tryPatchWindow(win, 0);
			this.refreshWindows();
		} else {
			for (const win of [...this.windows]) this.clearWindowPatch(win);
		}
	}

	private syncTitleTagDotsStyle(win: Window): void {
		const doc = win?.document;
		if (!doc || typeof doc.createElementNS !== 'function') return;
		const modOn = Boolean(this.kernel.prefs.get('modules.visualNotes.enable'));
		const showDots = Boolean(this.kernel.prefs.get('visualNotes.showTitleTagDots'));
		const existing = doc.getElementById?.(TITLE_TAG_DOTS_STYLE_ID);
		if (!modOn || showDots) {
			existing?.remove?.();
			return;
		}
		if (!existing) {
			const head = doc.head || doc.documentElement;
			if (!head) return;
			const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style') as HTMLStyleElement;
			style.id = TITLE_TAG_DOTS_STYLE_ID;
			style.textContent = TITLE_TAG_DOTS_HIDE_CSS;
			head.appendChild(style);
		}
	}

	refreshWindows(): void {
		for (const win of this.windows) {
			try {
				const view = (win as any)?.ZoteroPane?.itemsView;
				view?.invalidateRowCache?.(true);
				view?.tree?.invalidate?.();
			} catch { /* ignore */ }
		}
	}

	disposeAll(): void {
		for (const win of [...this.windows]) {
			try { win.document?.getElementById?.(TITLE_TAG_DOTS_STYLE_ID)?.remove?.(); } catch { /* ignore */ }
			this.clearWindowPatch(win);
		}
		this.windows.clear();
	}

	private clearWindowPatch(win: Window): void {
		const timer = this.pollTimers.get(win);
		if (timer !== undefined) { clearTimeout(timer); this.pollTimers.delete(win); }
		try { win.document?.getElementById?.(HEATMAP_STYLE_ID)?.remove?.(); } catch { /* ignore */ }
		const dispose = this.disposers.get(win);
		if (dispose) {
			this.disposers.delete(win);
			try { dispose(); } catch { /* ignore */ }
			try {
				const view = (win as any)?.ZoteroPane?.itemsView;
				view?.invalidateRowCache?.(true);
				view?.tree?.invalidate?.();
			} catch { /* ignore */ }
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
		if ((win as any).closed || !this.windows.has(win) || !this.cachedEnabled || this.disposers.has(win)) return;
		const iv = (win as any)?.ZoteroPane?.itemsView;
		const ctrl = this;
		const resolveProgress = this.resolveProgress;
		const dispose = patchItemsViewRenderCell(this.kernel.runtime, iv, (orig) => function (this: any, ...args: unknown[]) {
			const cell = orig.apply(this, args);
			if (!cell || !ctrl.cachedEnabled) return cell;
			const [index, , column] = args as [number, unknown, { dataKey?: string; primary?: boolean }?];
			if (column?.dataKey !== 'title' && column?.primary !== true) return cell;
			const row = this.getRow?.(index) ?? this._rows?.[index];
			const item = row?.ref;
			if (item && typeof item.id === 'number' && !item.deleted && (row?.isItem ?? true)) {
				const prog = resolveProgress(item);
				if (prog) applyTitleHeatmapToCell(cell as Element, prog, ctrl.cachedOptions);
				else if ((cell as Element).getAttribute?.('data-zbf-hm-cell') === '1' || (cell as Element).getAttribute?.('data-zbf-heatmap') === '1') clearTitleHeatmapFromCell(cell as Element);
			} else if ((cell as Element).getAttribute?.('data-zbf-hm-cell') === '1' || (cell as Element).getAttribute?.('data-zbf-heatmap') === '1') {
				clearTitleHeatmapFromCell(cell as Element);
			}
			return cell;
		});
		if (!dispose) {
			if (attempt < 120) this.pollTimers.set(win, setTimeout(() => this.tryPatchWindow(win, attempt + 1), 50));
			return;
		}
		this.ensureWindowStyles(win);
		this.disposers.set(win, dispose);
		try { iv.tree?.invalidate?.(); } catch { /* ignore */ }
	}
}
