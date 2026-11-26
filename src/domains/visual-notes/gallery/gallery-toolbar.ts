import type { PluginKernel } from '../../../kernel/plugin-kernel.ts';
import type { RatingStorageLocation } from '../../../services/item-status-rating.ts';
import type { GalleryCardModel, GalleryContentTab, GalleryGroupBy, GalleryMode, GallerySortField } from './gallery-board-helpers.ts';
import { renderGalleryCardElement, renderGalleryTopBar } from './gallery-card-renderer.ts';
import { openZoteroGalleryItem, openZoteroItemContextMenu } from './gallery-pane-adapter.ts';
import { galEl } from './gallery-styles.ts';
import type { GalleryVirtualLayoutController } from './gallery-virtual-layout.ts';

export interface GalleryCardFactoryDeps {
	doc: Document;
	win: Window;
	kernel: PluginKernel;
	showBrief: boolean;
	showRatingStars?: boolean;
	showTags?: boolean;
	showReadTime?: boolean;
	ratingStorage: RatingStorageLocation;
	getSelectedIDs: () => ReadonlySet<number>;
	getAnchorID: () => number;
	getLayout: () => GalleryVirtualLayoutController | null;
	getFallbackOrder: () => number[];
	shouldRefreshOnRated: () => boolean;
	applySelection: (nextIDs: number[], anchorID?: number, focusCard?: boolean) => void;
	onMutated: (itemIDs?: readonly number[]) => void;
	onRerenderKeepBar: () => void;
}

export function createGalleryCardElementFactory(deps: GalleryCardFactoryDeps) {
	return (c: GalleryCardModel, draggable: boolean, onDragStateChange?: (d: boolean) => void): HTMLElement =>
		renderGalleryCardElement({
			doc: deps.doc,
			card: c,
			selected: deps.getSelectedIDs().has(c.itemID),
			showBrief: deps.showBrief,
			showRatingStars: deps.showRatingStars,
			showTags: deps.showTags,
			showReadTime: deps.showReadTime,
			ratingStorage: deps.ratingStorage,
			draggable,
			onDragStateChange,
			onSelect: (picked, _el, ev) => {
				const order = deps.getLayout()?.orderIDs || deps.getFallbackOrder();
				const selectedIDs = deps.getSelectedIDs();
				const anchorID = deps.getAnchorID();
				if (ev.shiftKey && anchorID && order.includes(anchorID)) {
					const a = order.indexOf(anchorID);
					const b = order.indexOf(picked.itemID);
					const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
					const merged = ev.ctrlKey || ev.metaKey ? [...new Set([...selectedIDs, ...range])] : range;
					deps.applySelection(merged, anchorID);
				} else if (ev.ctrlKey || ev.metaKey) {
					const next = new Set(selectedIDs);
					if (next.has(picked.itemID)) next.delete(picked.itemID);
					else next.add(picked.itemID);
					deps.applySelection([...next], picked.itemID);
				} else {
					deps.applySelection([picked.itemID], picked.itemID);
				}
			},
			onContextMenu: (picked, _el, ev) => {
				if (!deps.getSelectedIDs().has(picked.itemID)) {
					deps.applySelection([picked.itemID], picked.itemID);
				}
				void openZoteroItemContextMenu(deps.win, ev);
			},
			onOpenReader: (picked, ev) => {
				void openZoteroGalleryItem(deps.win, picked.item, ev, (itemID) => {
					deps.kernel.bus.emit('workspace:open-item-request', { itemID, preferExistingTab: true });
				});
			},
			onNavigateKey: (picked, key, ev) => {
				const nextID = deps.getLayout()?.adjacentItemID(picked.itemID, key);
				if (!nextID) return;
				const nextSel = ev.shiftKey ? [...new Set([...deps.getSelectedIDs(), nextID])] : [nextID];
				deps.applySelection(nextSel, ev.shiftKey ? deps.getAnchorID() : nextID, true);
			},
			onRated: () => {
				deps.onMutated([c.itemID]);
				if (deps.shouldRefreshOnRated()) deps.onRerenderKeepBar();
			},
		});
}

export function mountGalleryPanelHeader(opts: {
	doc: Document;
	panel: HTMLElement;
	zh: boolean;
	keepTopBar: boolean;
	contentTab: GalleryContentTab;
	mode: GalleryMode;
	groupBy: GalleryGroupBy;
	sortField: GallerySortField;
	query: string;
	displayCount: number;
	bodyViewport: HTMLElement;
	onContentTabChange: (t: GalleryContentTab) => void;
	onModeChange: (m: GalleryMode) => void;
	onGroupByChange: (g: GalleryGroupBy) => void;
	onSortChange: (s: GallerySortField) => void;
	onQueryInput: (q: string) => void;
}): void {
	const existingBar = opts.keepTopBar ? opts.panel.querySelector('.zbf-gal-bar') : null;
	if (existingBar) {
		const cntEl = existingBar.querySelector('.zbf-gal-count');
		if (cntEl) cntEl.textContent = String(opts.displayCount);
		opts.panel.querySelector('.zbf-gal-viewport')?.remove();
		opts.panel.appendChild(opts.bodyViewport);
		return;
	}
	opts.panel.textContent = '';
	opts.panel.appendChild(renderGalleryTopBar({
		doc: opts.doc,
		zh: opts.zh,
		contentTab: opts.contentTab,
		mode: opts.mode,
		groupBy: opts.groupBy,
		sortField: opts.sortField,
		query: opts.query,
		totalCount: opts.displayCount,
		onContentTabChange: opts.onContentTabChange,
		onModeChange: opts.onModeChange,
		onGroupByChange: opts.onGroupByChange,
		onSortChange: opts.onSortChange,
		onQueryInput: opts.onQueryInput,
	}));
	if (opts.contentTab === 'notes') {
		const status = galEl(opts.doc, 'div');
		status.className = 'zbf-gal-status';
		status.setAttribute('role', 'status');
		opts.panel.appendChild(status);
	}
	opts.panel.appendChild(opts.bodyViewport);
}
