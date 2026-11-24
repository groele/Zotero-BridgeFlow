import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import { collectItemAnnotations, parseColorSemantics } from '../../services/annotation-utils.ts';
import { formatReadingProgress, type TabReadingProgress } from '../../services/reading-stats.ts';
import { closeVisualColumnPopover } from './column-popover-styles.ts';
import { readItemRemarkWithFallback, type VisualNotesDataSource } from './data-source.ts';
import {
	buildAnnotationCell,
	buildReadTimeCell,
	type AnnotationSummaryRecord,
	type ReadingColumnCallbacks,
} from './library-column-cells.ts';

export type { ReadingColumnCallbacks };

interface StoreLike {
	state: {
		remarks?: Record<string, string>;
		readingProgress?: Record<string, TabReadingProgress>;
	};
}

function makeSourceFromStore(store?: StoreLike): VisualNotesDataSource | undefined {
	if (!store) return undefined;
	return {
		getReadingProgress: (id) => store.state.readingProgress?.[`item:${id}`],
		getRemark: (id) => store.state.remarks?.[`item:${id}`] || '',
		setRemark: () => {},
	};
}

function registerTreeColumn(registeredKeys: Set<string>, descriptor: Record<string, unknown>, isActive: () => boolean): boolean {
	const manager = (globalThis as any).Zotero?.ItemTreeManager;
	const regFn = manager?.registerColumn || manager?.registerColumns;
	if (typeof regFn !== 'function') return false;
	try {
		const res = regFn.call(manager, descriptor);
		const recordKey = (val: unknown) => {
			for (const k of Array.isArray(val) ? val : [val]) {
				if (typeof k === 'string' && k) registeredKeys.add(k);
			}
			if (!isActive() && registeredKeys.size) flushUnregisterColumns(registeredKeys);
		};
		if (res && typeof (res as Promise<unknown>).then === 'function') {
			void (res as Promise<unknown>).then(recordKey).catch(() => {});
		} else {
			if (typeof res !== 'string' || !res) return false;
			registeredKeys.add(res);
		}
		return true;
	} catch {
		return false;
	}
}

function flushUnregisterColumns(registeredKeys: Set<string>): void {
	if (!registeredKeys.size) return;
	const keys = [...registeredKeys];
	registeredKeys.clear();
	const manager = (globalThis as any).Zotero?.ItemTreeManager;
	try {
		if (typeof manager?.unregisterColumn === 'function') {
			for (const k of keys) void Promise.resolve(manager.unregisterColumn(k)).catch(() => {});
		} else if (typeof manager?.unregisterColumns === 'function') {
			void Promise.resolve(manager.unregisterColumns(keys)).catch(() => {});
		}
	} catch { /* ignore */ }
}

function resolveRowContext(index: number, treeDoc?: Document): { win: Window | null; doc: Document | null; item: any } {
	const win: Window | null = treeDoc?.defaultView || (globalThis as any).Zotero?.getMainWindow?.() || null;
	const doc = win?.document || null;
	const item = (win as any)?.ZoteroPane?.itemsView?.getRow?.(index)?.ref || null;
	return { win, doc, item };
}

export class RemarkColumnController {
	private readonly registeredKeys = new Set<string>();
	private active = false;
	private readonly kernel: PluginKernel;
	private dataSource?: VisualNotesDataSource;

	constructor(kernel: PluginKernel, storeOrSource?: StoreLike | VisualNotesDataSource) {
		this.kernel = kernel;
		this.dataSource = storeOrSource && 'getRemark' in storeOrSource
			? storeOrSource
			: makeSourceFromStore(storeOrSource);
	}

	setDataSource(source?: VisualNotesDataSource): void {
		this.dataSource = source;
	}

	getDisplayForItem(item: any): string {
		return readItemRemarkWithFallback(item, this.dataSource);
	}

	register(): void {
		if (this.active) return;
		this.active = true;
		const zh = Boolean((globalThis as any).Zotero?.locale?.startsWith?.('zh'));
		registerTreeColumn(this.registeredKeys, {
			dataKey: 'bridgeflowRemark',
			label: zh ? '简记' : 'Brief Note',
			enabledTreeIDs: ['main'],
			showInColumnPicker: true,
			columnPickerSubMenu: false,
			zoteroPersist: ['width', 'hidden', 'sortDirection'],
			pluginID: this.kernel.info.id,
			dataProvider: (item: any) => this.getDisplayForItem(item),
		}, () => this.active);
	}

	unregister(): void {
		this.active = false;
		flushUnregisterColumns(this.registeredKeys);
	}

	refresh(): void {
		if (!this.active || !this.registeredKeys.size) return;
		try {
			(globalThis as any).Zotero?.ItemTreeManager?.refreshColumns?.();
		} catch { /* ignore */ }
	}
}

export class ReadingColumnsController {
	private readonly registeredKeys = new Set<string>();
	private activeReadTime = false;
	private activeAnnotations = false;
	private readonly kernel: PluginKernel;
	private dataSource?: VisualNotesDataSource;
	private readonly callbacks?: ReadingColumnCallbacks;
	private cachedColorRaw = '';
	private cachedSemantics = parseColorSemantics(undefined);
	private readonly annSummaryCache = new Map<string, AnnotationSummaryRecord>();

	constructor(
		kernel: PluginKernel,
		storeOrSource?: StoreLike | VisualNotesDataSource,
		callbacks?: ReadingColumnCallbacks,
	) {
		this.kernel = kernel;
		this.callbacks = callbacks;
		this.dataSource = storeOrSource && 'getReadingProgress' in storeOrSource
			? storeOrSource
			: makeSourceFromStore(storeOrSource);
	}

	setDataSource(source?: VisualNotesDataSource): void {
		this.dataSource = source;
	}

	syncColumns(): void {
		const wantRead = Boolean(this.kernel.prefs.get('workspace.readingColumn.enable'));
		const wantAnn = Boolean(this.kernel.prefs.get('workspace.annotationColumn.enable'));
		if (wantRead !== this.activeReadTime || wantAnn !== this.activeAnnotations) {
			this.unregisterAll();
			if (wantRead) this.registerReadTimeColumn();
			if (wantAnn) this.registerAnnotationColumn();
		}
	}

	unregisterAll(): void {
		this.activeReadTime = false;
		this.activeAnnotations = false;
		const wins: Window[] = (globalThis as any).Zotero?.getMainWindows?.() || [];
		for (const w of wins) closeVisualColumnPopover(w?.document);
		flushUnregisterColumns(this.registeredKeys);
	}

	refreshColumns(): void {
		this.annSummaryCache.clear();
		if ((!this.activeReadTime && !this.activeAnnotations) || !this.registeredKeys.size) return;
		try {
			(globalThis as any).Zotero?.ItemTreeManager?.refreshColumns?.();
		} catch { /* ignore */ }
	}

	getReadProgressForItem(item: any): TabReadingProgress | undefined {
		if (!item || !this.dataSource) return undefined;
		const id = Number(item.id || 0);
		if (id > 0) {
			const direct = this.dataSource.getReadingProgress(id);
			if (direct) return direct;
		}
		const attIDs: number[] = typeof item.getAttachments === 'function' ? (item.getAttachments() || []) : [];
		let best: TabReadingProgress | undefined;
		for (const attID of attIDs) {
			const prog = this.dataSource.getReadingProgress(attID);
			if (!prog) continue;
			const hasPages = Boolean(prog.pageSeconds && Object.keys(prog.pageSeconds).length);
			const bestHasPages = Boolean(best?.pageSeconds && Object.keys(best.pageSeconds).length);
			if (!best || (hasPages && !bestHasPages) || (hasPages === bestHasPages && prog.readSeconds > best.readSeconds)) {
				best = prog;
			}
		}
		return best;
	}

	getReadTimeDisplay(item: any): string {
		return formatReadingProgress(this.getReadProgressForItem(item)).text;
	}

	getAnnotationSummaryRecord(item: any): AnnotationSummaryRecord {
		if (!item) return { total: 0, formatted: '', buckets: [] };
		const rawColor = String(this.kernel.prefs.get('inspector.annotations.colorLabels') || '');
		if (rawColor !== this.cachedColorRaw) {
			this.cachedColorRaw = rawColor;
			this.cachedSemantics = parseColorSemantics(rawColor);
			this.annSummaryCache.clear();
		}
		const itemID = Number(item.id || 0);
		const stamp = String(item.dateModified || item.version || '');
		const cacheKey = itemID > 0 && stamp ? `${itemID}:${stamp}` : '';
		if (cacheKey) {
			const hit = this.annSummaryCache.get(cacheKey);
			if (hit !== undefined) {
				this.annSummaryCache.delete(cacheKey);
				this.annSummaryCache.set(cacheKey, hit);
				return hit;
			}
		}
		const collected = collectItemAnnotations([item], this.cachedSemantics);
		let formatted = '';
		const buckets: { hex: string; label: string; count: number }[] = [];
		if (collected.length) {
			const counts = new Map<string, { hex: string; label: string; count: number }>();
			for (const a of collected) {
				const prev = counts.get(a.colorLabel);
				if (prev) prev.count++;
				else counts.set(a.colorLabel, { hex: a.color || '#64748b', label: a.colorLabel, count: 1 });
			}
			buckets.push(...[...counts.values()].sort((a, b) => b.count - a.count));
			const top = buckets.slice(0, 3).map((b) => `${b.label}:${b.count}`).join(' ');
			formatted = `${collected.length} (${top})`;
		}
		const record: AnnotationSummaryRecord = { total: collected.length, formatted, buckets };
		if (cacheKey) {
			if (this.annSummaryCache.has(cacheKey)) this.annSummaryCache.delete(cacheKey);
			else if (this.annSummaryCache.size >= 5000) {
				const oldest = this.annSummaryCache.keys().next().value;
				if (oldest !== undefined) this.annSummaryCache.delete(oldest);
			}
			this.annSummaryCache.set(cacheKey, record);
		}
		return record;
	}

	getAnnotationSummaryDisplay(item: any): string {
		return this.getAnnotationSummaryRecord(item).formatted;
	}

	private registerReadTimeColumn(): void {
		const zh = Boolean((globalThis as any).Zotero?.locale?.startsWith?.('zh'));
		this.activeReadTime = registerTreeColumn(this.registeredKeys, {
			dataKey: 'bridgeflowReadTime',
			label: zh ? '阅读时长' : 'Read Time',
			enabledTreeIDs: ['main'],
			showInColumnPicker: true,
			columnPickerSubMenu: false,
			minWidth: 88,
			zoteroPersist: ['width', 'hidden', 'sortDirection'],
			pluginID: this.kernel.info.id,
			dataProvider: (item: any) => this.getReadTimeDisplay(item),
			renderCell: (index: number, _data: string, column: { className?: string }, _first: boolean, treeDoc?: Document) => {
				const { win, doc, item } = resolveRowContext(index, treeDoc);
				if (!doc) return {} as HTMLElement;
				return buildReadTimeCell({
					win,
					doc,
					item,
					prog: item ? this.getReadProgressForItem(item) : undefined,
					className: column?.className,
					zh,
					heatColor: String(this.kernel.prefs.get('workspace.readingHeatmap.color') || '#0d9488'),
					callbacks: this.callbacks,
				});
			},
		}, () => this.activeReadTime);
	}

	private registerAnnotationColumn(): void {
		const zh = Boolean((globalThis as any).Zotero?.locale?.startsWith?.('zh'));
		this.activeAnnotations = registerTreeColumn(this.registeredKeys, {
			dataKey: 'bridgeflowAnnotations',
			label: zh ? '标注分布' : 'Annotations',
			enabledTreeIDs: ['main'],
			showInColumnPicker: true,
			columnPickerSubMenu: false,
			minWidth: 94,
			zoteroPersist: ['width', 'hidden', 'sortDirection'],
			pluginID: this.kernel.info.id,
			dataProvider: (item: any) => this.getAnnotationSummaryDisplay(item),
			renderCell: (index: number, _data: string, column: { className?: string }, _first: boolean, treeDoc?: Document) => {
				const { win, doc, item } = resolveRowContext(index, treeDoc);
				if (!doc) return {} as HTMLElement;
				return buildAnnotationCell({
					win,
					doc,
					item,
					summary: item ? this.getAnnotationSummaryRecord(item) : null,
					className: column?.className,
					zh,
					semantics: this.cachedSemantics,
					callbacks: this.callbacks,
				});
			},
		}, () => this.activeAnnotations);
	}
}
