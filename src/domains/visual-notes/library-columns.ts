import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import { collectItemAnnotations, parseColorSemantics } from '../../services/annotation-utils.ts';
import { formatReadingProgress, type TabReadingProgress } from '../../services/reading-stats.ts';
import { readItemRemarkWithFallback, type VisualNotesDataSource } from './data-source.ts';

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
	const regFn = manager?.registerColumns || manager?.registerColumn;
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
			recordKey(res);
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
		if (typeof manager?.unregisterColumns === 'function') {
			void Promise.resolve(manager.unregisterColumns(keys)).catch(() => {});
		} else if (typeof manager?.unregisterColumn === 'function') {
			for (const k of keys) void Promise.resolve(manager.unregisterColumn(k)).catch(() => {});
		}
	} catch { /* ignore */ }
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
		if (!this.active) return;
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
	private cachedColorRaw = '';
	private cachedSemantics = parseColorSemantics(undefined);
	private readonly annSummaryCache = new Map<string, string>();

	constructor(kernel: PluginKernel, storeOrSource?: StoreLike | VisualNotesDataSource) {
		this.kernel = kernel;
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
		flushUnregisterColumns(this.registeredKeys);
	}

	refreshColumns(): void {
		this.annSummaryCache.clear();
		if (!this.activeReadTime && !this.activeAnnotations) return;
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

	getAnnotationSummaryDisplay(item: any): string {
		if (!item) return '';
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
			if (hit !== undefined) return hit;
		}
		const collected = collectItemAnnotations([item], this.cachedSemantics);
		let formatted = '';
		if (collected.length) {
			const counts = new Map<string, number>();
			for (const a of collected) {
				counts.set(a.colorLabel, (counts.get(a.colorLabel) || 0) + 1);
			}
			const top = [...counts.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 3)
				.map(([lbl, n]) => `${lbl}:${n}`)
				.join(' ');
			formatted = `${collected.length} (${top})`;
		}
		if (cacheKey) {
			if (this.annSummaryCache.size >= 600) this.annSummaryCache.clear();
			this.annSummaryCache.set(cacheKey, formatted);
		}
		return formatted;
	}

	private registerReadTimeColumn(): void {
		const zh = Boolean((globalThis as any).Zotero?.locale?.startsWith?.('zh'));
		this.activeReadTime = registerTreeColumn(this.registeredKeys, {
			dataKey: 'bridgeflowReadTime',
			label: zh ? '阅读时长' : 'Read Time',
			enabledTreeIDs: ['main'],
			zoteroPersist: ['width', 'hidden', 'sortDirection'],
			pluginID: this.kernel.info.id,
			dataProvider: (item: any) => this.getReadTimeDisplay(item),
		}, () => this.activeReadTime);
	}

	private registerAnnotationColumn(): void {
		const zh = Boolean((globalThis as any).Zotero?.locale?.startsWith?.('zh'));
		this.activeAnnotations = registerTreeColumn(this.registeredKeys, {
			dataKey: 'bridgeflowAnnotations',
			label: zh ? '标注分布' : 'Annotations',
			enabledTreeIDs: ['main'],
			zoteroPersist: ['width', 'hidden', 'sortDirection'],
			pluginID: this.kernel.info.id,
			dataProvider: (item: any) => this.getAnnotationSummaryDisplay(item),
		}, () => this.activeAnnotations);
	}
}
