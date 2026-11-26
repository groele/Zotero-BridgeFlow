import type { PluginKernel } from '../../../kernel/plugin-kernel.ts';
import {
	clearStatusRatingCaches,
	getItemRating,
	getItemStatus,
	normalizeRatingStorage,
	type RatingStorageLocation,
} from '../../../services/item-status-rating.ts';
import { flushUnregisterColumns, registerTreeColumn, resolveTreeRowContext } from './column-registry.ts';
import { buildRatingColumnCell, buildStatusColumnCell } from './rating-cell-dom.ts';
import { closeStatusPickerPopover, ensureStatusRatingStyle } from './status-rating-popover.ts';

export class StatusRatingColumnsController {
	private readonly registeredKeys = new Set<string>();
	private readonly styledDocs = new WeakSet<Document>();
	private activeStatus = false;
	private activeRating = false;
	private cachedExcludedTag = '/Citations';
	private cachedRatingStorage: RatingStorageLocation = 'cache';
	private cachedSyncTagColor = false;
	private readonly kernel: PluginKernel;
	private readonly onMutated?: (targetIDs?: readonly number[]) => void;

	constructor(kernel: PluginKernel, onMutated?: (targetIDs?: readonly number[]) => void) {
		this.kernel = kernel;
		this.onMutated = onMutated;
		this.refreshPrefs();
	}

	private isZh(): boolean {
		return Boolean((globalThis as any).Zotero?.locale?.startsWith?.('zh'));
	}

	refreshPrefs(): void {
		this.cachedExcludedTag = String(this.kernel.prefs.get('wordCite.citationTags.text') || '/Citations');
		this.cachedRatingStorage = normalizeRatingStorage(this.kernel.prefs.get('visualNotes.ratingStorage'));
		this.cachedSyncTagColor = Boolean(this.kernel.prefs.get('visualNotes.statusSyncZoteroTagColor'));
	}

	private ensureStyled(doc: Document): void {
		if (this.styledDocs.has(doc)) return;
		ensureStatusRatingStyle(doc);
		if (doc.getElementById?.('zbf-status-rating-style')) this.styledDocs.add(doc);
	}

	syncColumns(): void {
		this.refreshPrefs();
		const wantStatus = Boolean(this.kernel.prefs.get('visualNotes.statusColumn.enable'));
		const wantRating = Boolean(this.kernel.prefs.get('visualNotes.ratingColumn.enable'));
		if (wantStatus !== this.activeStatus || wantRating !== this.activeRating) {
			this.unregisterAll();
			if (wantStatus) this.registerStatusColumn();
			if (wantRating) this.registerRatingColumn();
		}
	}

	unregisterAll(): void {
		this.activeStatus = false;
		this.activeRating = false;
		const wins: Window[] = (globalThis as any).Zotero?.getMainWindows?.() || [];
		for (const w of wins) closeStatusPickerPopover(w?.document);
		flushUnregisterColumns(this.registeredKeys);
	}

	clearCache(itemIDs?: Iterable<number>): void {
		clearStatusRatingCaches(itemIDs);
	}

	refreshColumns(itemIDs?: Iterable<number>): void {
		this.clearCache(itemIDs);
		if ((!this.activeStatus && !this.activeRating) || !this.registeredKeys.size) return;
		try {
			(globalThis as any).Zotero?.ItemTreeManager?.refreshColumns?.();
		} catch { /* ignore */ }
	}

	getStatusDisplay(item: any): string {
		return getItemStatus(item, this.cachedExcludedTag)?.label || '';
	}

	getRatingDisplay(item: any): string {
		const r = getItemRating(item, this.cachedRatingStorage);
		return r > 0 ? String(r) : '';
	}

	private notifyApplied = (targetIDs?: readonly number[]): void => {
		this.refreshColumns(targetIDs);
		this.onMutated?.(targetIDs);
	};

	private registerStatusColumn(): void {
		const zh = this.isZh();
		this.activeStatus = registerTreeColumn(this.registeredKeys, {
			dataKey: 'bridgeflowStatus',
			label: zh ? '阅读状态' : 'Reading Status',
			enabledTreeIDs: ['main'],
			showInColumnPicker: true,
			columnPickerSubMenu: false,
			minWidth: 80,
			zoteroPersist: ['width', 'hidden', 'sortDirection'],
			pluginID: this.kernel.info.id,
			dataProvider: (item: any) => this.getStatusDisplay(item),
			renderCell: (index: number, _data: string, column: { className?: string }, _first: boolean, treeDoc?: Document) => {
				const { win, doc, item } = resolveTreeRowContext(index, treeDoc);
				if (!doc) return {} as HTMLElement;
				this.ensureStyled(doc);
				return buildStatusColumnCell({
					win, doc, item, className: column?.className, zh,
					excludedTag: this.cachedExcludedTag,
					syncZoteroTagColor: this.cachedSyncTagColor,
					onApplied: this.notifyApplied,
				});
			},
		}, () => this.activeStatus, () => { this.activeStatus = false; });
	}

	private registerRatingColumn(): void {
		const zh = this.isZh();
		this.activeRating = registerTreeColumn(this.registeredKeys, {
			dataKey: 'bridgeflowRating',
			label: zh ? '评级' : 'Rating',
			enabledTreeIDs: ['main'],
			showInColumnPicker: true,
			columnPickerSubMenu: false,
			minWidth: 84,
			zoteroPersist: ['width', 'hidden', 'sortDirection'],
			pluginID: this.kernel.info.id,
			dataProvider: (item: any) => this.getRatingDisplay(item),
			renderCell: (index: number, _data: string, column: { className?: string }, _first: boolean, treeDoc?: Document) => {
				const { win, doc, item } = resolveTreeRowContext(index, treeDoc);
				if (!doc) return {} as HTMLElement;
				this.ensureStyled(doc);
				return buildRatingColumnCell({
					win, doc, item, className: column?.className, zh,
					storage: this.cachedRatingStorage,
					onApplied: this.notifyApplied,
				});
			},
		}, () => this.activeRating, () => { this.activeRating = false; });
	}
}
