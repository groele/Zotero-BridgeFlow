import { isRegularValidItem } from '../../../services/item-resolution.ts';
import type { PluginKernel } from '../../../kernel/plugin-kernel.ts';
import { parseColorSemantics, summarizeItemAnnotationColors } from '../../../services/annotation-utils.ts';
import { formatReadingProgress, type TabReadingProgress } from '../../../services/reading-stats.ts';
import { closeVisualColumnPopover } from './column-popover-styles.ts';
import { readItemRemarkWithFallback, type VisualNotesDataSource } from '../data-source.ts';
import {
	buildAnnotationCell,
	buildReadTimeCell,
	type AnnotationSummaryRecord,
	type ReadingColumnCallbacks,
} from './library-column-cells.ts';

import {
	flushUnregisterColumns,
	makeSourceFromStore,
	registerTreeColumn,
	resolveTreeRowContext,
	type StoreLike,
} from './column-registry.ts';

export type { ReadingColumnCallbacks };

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
		if (!item || item.deleted || (typeof item.isRegularItem === 'function' && !item.isRegularItem())) return '';
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
	private cachedHeatColor = '#0d9488';
	private readonly annSummaryCache = new Map<string, AnnotationSummaryRecord>();
	private readonly readProgressCache = new Map<number, TabReadingProgress | null>();
	private cachedReadRevision = -1;

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
		this.syncPrefs();
	}

	syncPrefs(): void {
		this.cachedHeatColor = String(this.kernel?.prefs?.get?.('workspace.readingHeatmap.color') || '#0d9488');
	}

	setDataSource(source?: VisualNotesDataSource): void {
		this.dataSource = source;
		this.bumpReadingRevision();
	}

	bumpReadingRevision(): void {
		this.readProgressCache.clear();
		this.cachedReadRevision = -1;
	}

	isReadTimeActive(): boolean {
		return this.activeReadTime && this.registeredKeys.size > 0;
	}

	syncColumns(): void {
		this.syncPrefs();
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

	clearCache(itemIDs?: Iterable<number>): void {
		if (!itemIDs) {
			this.annSummaryCache.clear();
			this.readProgressCache.clear();
			return;
		}
		const targets = new Set(itemIDs);
		if (!targets.size) return;
		for (const id of targets) this.readProgressCache.delete(id);
		for (const k of this.annSummaryCache.keys()) {
			if (targets.has(Number(k.split(':', 1)[0]))) this.annSummaryCache.delete(k);
		}
	}

	refreshColumns(itemIDs?: Iterable<number>): void {
		this.clearCache(itemIDs);
		if ((!this.activeReadTime && !this.activeAnnotations) || !this.registeredKeys.size) return;
		try {
			(globalThis as any).Zotero?.ItemTreeManager?.refreshColumns?.();
		} catch { /* ignore */ }
	}

	getReadProgressForItem(item: any): TabReadingProgress | undefined {
		if (!item || !this.dataSource) return undefined;
		const id = Number(item.id || 0);
		const rev = this.dataSource.getReadingRevision?.() ?? -1;
		if (rev >= 0) {
			if (rev !== this.cachedReadRevision) {
				this.readProgressCache.clear();
				this.cachedReadRevision = rev;
			} else if (id > 0) {
				const hit = this.readProgressCache.get(id);
				if (hit !== undefined) return hit ?? undefined;
			}
		}
		if (id > 0) {
			const direct = this.dataSource.getReadingProgress(id);
			if (direct) {
				if (rev >= 0) {
					if (this.readProgressCache.size >= 5000) this.readProgressCache.clear();
					this.readProgressCache.set(id, direct);
				}
				return direct;
			}
		}
		const attIDs: number[] = isRegularValidItem(item) && typeof item.getAttachments === 'function' ? (item.getAttachments() || []) : [];
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
		if (id > 0 && rev >= 0) {
			if (this.readProgressCache.size >= 5000) this.readProgressCache.clear();
			this.readProgressCache.set(id, best ?? null);
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
		const { total, buckets } = summarizeItemAnnotationColors(item, this.cachedSemantics);
		const formatted = buckets.length ? `${total} (${buckets.slice(0, 3).map((b) => `${b.label}:${b.count}`).join(' ')})` : '';
		const record: AnnotationSummaryRecord = { total, formatted, buckets };
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
				const { win, doc, item } = resolveTreeRowContext(index, treeDoc);
				if (!doc) return {} as HTMLElement;
				return buildReadTimeCell({
					win,
					doc,
					item,
					prog: item ? this.getReadProgressForItem(item) : undefined,
					className: column?.className,
					zh,
					heatColor: this.cachedHeatColor,
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
				const { win, doc, item } = resolveTreeRowContext(index, treeDoc);
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
