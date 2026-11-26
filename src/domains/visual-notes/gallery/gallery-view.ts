import { captureGalleryScroll } from './gallery-scroll.ts';
import type { PluginKernel } from '../../../kernel/plugin-kernel.ts';
import { normalizeRatingStorage } from '../../../services/item-status-rating.ts';
import type { TabReadingProgress } from '../../../services/reading-stats.ts';
import { readItemRemarkWithFallback, type VisualNotesDataSource } from '../data-source.ts';
import {
	extractGalleryCards, filterAndSortGalleryCards,
	type GalleryContentTab, type GalleryGroupBy, type GalleryMode, type GallerySortField,
} from './gallery-board-helpers.ts';
import {
	createGalleryVisibilityGuard, createZoteroPaneGalleryAdapter,
	selectZoteroGalleryItems, type ZoteroPaneGalleryAdapter,
} from './gallery-pane-adapter.ts';
import { ensureGalleryStyles, galEl } from './gallery-styles.ts';
import { createGalleryCardElementFactory, mountGalleryPanelHeader } from './gallery-toolbar.ts';
import { renderGalleryInlineFeed, renderGalleryViewport, syncVisualNotesToolbarGroup } from './gallery-viewport-renderer.ts';
import type { GalleryVirtualLayoutController } from './gallery-virtual-layout.ts';

interface WindowGalleryState {
	win: Window; open: boolean; contentTab: GalleryContentTab; mode: GalleryMode; groupBy: GalleryGroupBy;
	sortField: GallerySortField; query: string; selectedIDs: Set<number>; anchorItemID: number;
	readingSelection: { itemID: number }; columnOrders: Map<GalleryGroupBy, string[]>; measurements: Map<string, number>;
	measureSig: string; tbGroup: HTMLElement | null; btnGallery: HTMLButtonElement | null; btnHub: HTMLButtonElement | null;
	panel: HTMLElement | null; layout: GalleryVirtualLayoutController | null; viewportDispose: (() => void) | null;
	queryTimer: ReturnType<typeof setTimeout> | null;
	visibilityGuard: ReturnType<typeof createGalleryVisibilityGuard> | null;
	paneAdapter: ZoteroPaneGalleryAdapter | null;
}

export class GalleryBoardController {
	private readonly states = new Map<Window, WindowGalleryState>();
	private readonly kernel: PluginKernel;
	private dataSource?: VisualNotesDataSource;
	private readonly getReadProgress: (item: any) => TabReadingProgress | undefined;
	private readonly onOpenHub: (win: Window) => void;
	private readonly onMutated: (itemIDs?: readonly number[]) => void;

	constructor(options: {
		kernel: PluginKernel; getReadProgress: (item: any) => TabReadingProgress | undefined;
		onOpenHub: (win: Window) => void; onMutated: (itemIDs?: readonly number[]) => void;
	}) {
		this.kernel = options.kernel; this.getReadProgress = options.getReadProgress;
		this.onOpenHub = options.onOpenHub; this.onMutated = options.onMutated;
	}

	setDataSource(source?: VisualNotesDataSource): void { this.dataSource = source; }
	private isZh(): boolean { return Boolean((globalThis as any).Zotero?.locale?.startsWith?.('zh')); }
	private defaultMode(): GalleryMode { return this.kernel.prefs.get('visualNotes.gallery.defaultMode') === 'board' ? 'board' : 'gallery'; }
	private defaultGroupBy(): GalleryGroupBy {
		const v = String(this.kernel.prefs.get('visualNotes.gallery.groupBy') || 'status');
		if (v === 'rating' || v === 'readState' || v === 'year' || v === 'publication' || v === 'itemType') return v;
		return 'status';
	}
	private defaultSort(): GallerySortField {
		const v = String(this.kernel.prefs.get('visualNotes.gallery.defaultSort') || 'dateModified');
		if (v === 'year' || v === 'rating' || v === 'readTime' || v === 'title') return v;
		return 'dateModified';
	}
	syncDefaultSort(): void {
		const next = this.defaultSort();
		for (const st of this.states.values()) {
			st.sortField = next;
			if (st.open) this.renderPanel(st);
		}
	}

	attachWindow(win: Window): void {
		if (!win?.document || this.states.has(win)) return;
		const st: WindowGalleryState = {
			win, open: false, contentTab: 'items', mode: this.defaultMode(), groupBy: this.defaultGroupBy(),
			sortField: this.defaultSort(), query: '', selectedIDs: new Set(), anchorItemID: 0,
			readingSelection: { itemID: 0 }, columnOrders: new Map(), measurements: new Map(), measureSig: '',
			tbGroup: null, btnGallery: null, btnHub: null, panel: null, layout: null,
			viewportDispose: null, queryTimer: null, visibilityGuard: null, paneAdapter: null,
		};
		this.states.set(win, st);
		this.syncWindow(st);
	}

	private bindGallery(st: WindowGalleryState): void {
		if (st.paneAdapter) return;
		const adapter = createZoteroPaneGalleryAdapter(st.win);
		st.paneAdapter = adapter;
		adapter.onRefresh(() => { if (st.open && !st.win.closed) this.renderPanel(st, true); });
		adapter.onSelection(() => {
			if (!st.open || st.contentTab !== 'items') return;
			const ids = adapter.getSelectedIDs();
			st.selectedIDs = new Set(ids);
			if (ids.length) st.anchorItemID = ids[ids.length - 1];
			this.syncSelectionAttributes(st);
		});
	}

	private syncSelectionAttributes(st: WindowGalleryState): void {
		if (!st.panel) return;
		st.panel.querySelectorAll('.zbf-gal-card[data-item-id]').forEach((node) => {
			const el = node as HTMLElement;
			const id = Number(el.dataset.itemId || 0);
			if (st.selectedIDs.has(id)) el.setAttribute('data-selected', 'true');
			else el.removeAttribute('data-selected');
		});
	}

	private applyGallerySelection(st: WindowGalleryState, nextIDs: number[], anchorID?: number, focusCard = false): void {
		st.selectedIDs = new Set(nextIDs);
		if (anchorID) st.anchorItemID = anchorID;
		this.syncSelectionAttributes(st);
		void selectZoteroGalleryItems(st.win, nextIDs);
		if (focusCard && anchorID) {
			const cardEl = st.layout?.ensureItemVisible(anchorID);
			cardEl?.focus?.({ preventScroll: true });
		}
	}

	private disposeViewport(st: WindowGalleryState): void {
		st.layout = null;
		const fn = st.viewportDispose;
		st.viewportDispose = null;
		try { fn?.(); } catch { /* ignore */ }
	}

	detachWindow(win: Window): void {
		const st = this.states.get(win);
		if (!st) return;
		this.setGalleryOpen(st, false);
		st.visibilityGuard?.destroy();
		st.visibilityGuard = null;
		st.tbGroup?.remove();
		st.panel?.remove();
		this.states.delete(win);
	}

	disposeAll(): void { for (const win of [...this.states.keys()]) this.detachWindow(win); }

	sync(windows: Iterable<Window>): void {
		for (const win of windows) {
			if (!this.states.has(win)) { this.attachWindow(win); continue; }
			const st = this.states.get(win);
			if (st) this.syncWindow(st);
		}
	}

	refreshWindows(readingOnly = false): void {
		for (const st of this.states.values()) {
			if (!st.open) continue;
			if (readingOnly && (st.contentTab !== 'items' || (st.sortField !== 'readTime' && !(st.mode === 'board' && st.groupBy === 'readState')))) continue;
			const active = st.win.document?.activeElement as Element | null;
			const typingInPanel = Boolean(active && typeof active.closest === 'function' && st.panel?.contains(active.closest('input,textarea')));
			if (!typingInPanel || active?.matches('.zbf-gal-search')) this.renderPanel(st, true);
		}
	}

	toggleWindowGallery(win: Window, mode?: GalleryMode): void {
		if (!this.states.has(win)) this.attachWindow(win);
		const st = this.states.get(win);
		if (!st) return;
		if (mode) { st.mode = mode; this.setGalleryOpen(st, true); }
		else this.setGalleryOpen(st, !st.open);
	}

	private syncWindow(st: WindowGalleryState): void {
		const doc = st.win.document;
		if (!doc) return;
		ensureGalleryStyles(doc);
		const galEnabled = Boolean(this.kernel.prefs.get('visualNotes.gallery.enable'));
		const hubEnabled = Boolean(this.kernel.prefs.get('visualNotes.collectionHub.enable'));
		if (!galEnabled && st.open) this.setGalleryOpen(st, false);

		const mounted = syncVisualNotesToolbarGroup({
			doc, zh: this.isZh(), galEnabled, hubEnabled, isOpen: st.open,
			existingGroup: st.tbGroup,
			onToggleGallery: () => this.setGalleryOpen(st, !st.open),
			onOpenHub: () => this.onOpenHub(st.win),
		});
		st.tbGroup = mounted.tbGroup;
		st.btnGallery = mounted.btnGallery;
		st.btnHub = mounted.btnHub;
		if (st.open) this.renderPanel(st);
	}

	private setGalleryOpen(st: WindowGalleryState, nextOpen: boolean): void {
		const doc = st.win.document;
		if (!doc) return;
		st.open = nextOpen;
		st.btnGallery?.setAttribute('aria-pressed', String(nextOpen));

		if (!nextOpen) {
			if (st.queryTimer !== null) { clearTimeout(st.queryTimer); st.queryTimer = null; }
			st.paneAdapter?.destroy();
			st.paneAdapter = null;
			this.disposeViewport(st);
			st.visibilityGuard?.setEnabled(false);
			st.panel?.replaceChildren();
			st.measurements.clear();
			return;
		}

		const itemsPane = doc.getElementById('zotero-items-pane') as HTMLElement | null;
		if (!itemsPane) { this.setGalleryOpen(st, false); return; }
		this.bindGallery(st);
		if (!st.panel || !st.panel.isConnected) {
			doc.getElementById('zbf-gallery-panel')?.remove();
			st.visibilityGuard?.destroy();
			const panel = galEl(doc, 'div');
			panel.id = 'zbf-gallery-panel';
			panel.className = 'zbf-gallery-panel';
			itemsPane.prepend(panel);
			st.panel = panel;
			st.visibilityGuard = createGalleryVisibilityGuard(st.win, itemsPane, panel, () => { st.paneAdapter?.rebind(); });
		}
		st.selectedIDs = new Set(st.paneAdapter?.getSelectedIDs() || []);
		st.anchorItemID = [...st.selectedIDs].at(-1) || 0;
		st.visibilityGuard?.setEnabled(true);
		try { this.renderPanel(st); } catch (error) {
			this.setGalleryOpen(st, false);
			this.kernel.logger.error('gallery:open', error);
		}
	}

	private renderPanel(st: WindowGalleryState, keepTopBar = false): void {
		const doc = st.win.document;
		const panel = st.panel;
		if (!doc || !panel || !st.open) return;

		const restoreScroll = captureGalleryScroll(panel);
		this.disposeViewport(st);

		const zh = this.isZh();
		const density = this.kernel.prefs.get('visualNotes.gallery.cardDensity') === 'compact' ? 'compact' : 'comfortable';
		const showBrief = Boolean(this.kernel.prefs.get('visualNotes.gallery.showBriefNote'));
		const showRatingStars = this.kernel.prefs.get('visualNotes.gallery.showRatingStars') !== false;
		const showTags = this.kernel.prefs.get('visualNotes.gallery.showTags') !== false;
		const showReadTime = this.kernel.prefs.get('visualNotes.gallery.showReadTime') !== false;
		const excludedTag = String(this.kernel.prefs.get('wordCite.citationTags.text') || '/Citations');
		const ratingStorage = normalizeRatingStorage(this.kernel.prefs.get('visualNotes.ratingStorage'));
		const cardWidth = Number(this.kernel.prefs.get('visualNotes.gallery.cardWidth')) || 220;
		const coverHeight = Number(this.kernel.prefs.get('visualNotes.gallery.coverHeight')) || 0;
		const nextMeasureSig = `${cardWidth}|${coverHeight}|${density}|${showBrief ? 1 : 0}|${showTags ? 1 : 0}|${showReadTime ? 1 : 0}`;
		if (st.measureSig && st.measureSig !== nextMeasureSig) st.measurements.clear();
		st.measureSig = nextMeasureSig;

		panel.setAttribute('data-density', density);
		panel.style.setProperty('--zbf-card-width', `${cardWidth}px`);
		panel.style.setProperty('--zbf-cover-height', coverHeight > 0 ? `${coverHeight}px` : 'auto');
		panel.style.setProperty('--zbf-cover-aspect', coverHeight > 0 ? 'auto' : (density === 'compact' ? '2.1' : '1.95'));

		const { cards: allCards, rawItems } = extractGalleryCards(st.win, {
			zh, excludedStatusTag: excludedTag, ratingStorage,
			getBriefNote: (it) => readItemRemarkWithFallback(it, this.dataSource),
			getReadProgress: this.getReadProgress,
		});

		let displayCount = 0;
		let bodyViewport: HTMLElement;
		let activateCovers: (() => void) | undefined;

		if (st.contentTab === 'items') {
			const sorted = filterAndSortGalleryCards(allCards, st.query, st.sortField);
			displayCount = sorted.length;
			const makeCard = createGalleryCardElementFactory({
				doc, win: st.win, kernel: this.kernel, showBrief, showRatingStars, showTags, showReadTime, ratingStorage,
				getSelectedIDs: () => st.selectedIDs,
				getAnchorID: () => st.anchorItemID,
				getLayout: () => st.layout,
				getFallbackOrder: () => sorted.map((x) => x.itemID),
				shouldRefreshOnRated: () => st.sortField === 'rating' || (st.mode === 'board' && st.groupBy === 'rating'),
				applySelection: (nextIDs, anchorID, focusCard) => this.applyGallerySelection(st, nextIDs, anchorID, focusCard),
				onMutated: this.onMutated,
				onRerenderKeepBar: () => this.renderPanel(st, true),
			});
			const vpRes = renderGalleryViewport({
				doc, zh, mode: st.mode, groupBy: st.groupBy, cardMinWidth: cardWidth, density,
				sorted, rawItems, getSelectedIDs: () => st.selectedIDs,
				columnOrder: st.columnOrders.get(st.groupBy), measurements: st.measurements,
				excludedTag, ratingStorage,
				syncZoteroTagColor: Boolean(this.kernel.prefs.get('visualNotes.statusSyncZoteroTagColor')),
				makeCard,
				onColumnOrderChange: (nextKeys) => { st.columnOrders.set(st.groupBy, nextKeys); this.renderPanel(st, true); },
				onDropMutated: (targetIDs) => { this.onMutated(targetIDs); this.renderPanel(st, true); },
				onClearQuery: st.query ? () => { st.query = ''; this.renderPanel(st); } : undefined,
			});
			bodyViewport = vpRes.viewport;
			st.layout = vpRes.layout;
			st.viewportDispose = vpRes.dispose;
			activateCovers = vpRes.activate;
		} else {
			const res = renderGalleryInlineFeed({
				doc, win: st.win, zh, tab: st.contentTab, selection: st.readingSelection,
				rawItems, query: st.query, kernel: this.kernel, dataSource: this.dataSource,
				onMutated: () => this.onMutated(),
				onStatus: (message) => {
					const status = panel.querySelector('.zbf-gal-status');
					if (status) status.textContent = message;
				},
			});
			bodyViewport = res.viewport;
			displayCount = res.count;
		}

		mountGalleryPanelHeader({
			doc, panel, zh, keepTopBar, contentTab: st.contentTab, mode: st.mode, groupBy: st.groupBy,
			sortField: st.sortField, query: st.query, displayCount, bodyViewport,
			onContentTabChange: (t) => { st.contentTab = t; this.renderPanel(st); },
			onModeChange: (m) => { st.mode = m; this.kernel.prefs.set('visualNotes.gallery.defaultMode', m); this.renderPanel(st); },
			onGroupByChange: (g) => { st.groupBy = g; this.kernel.prefs.set('visualNotes.gallery.groupBy', g); this.renderPanel(st); },
			onSortChange: (s) => { st.sortField = s; this.kernel.prefs.set('visualNotes.gallery.defaultSort', s); this.renderPanel(st); },
			onQueryInput: (q) => {
				st.query = q;
				if (st.queryTimer !== null) clearTimeout(st.queryTimer);
				st.queryTimer = setTimeout(() => { st.queryTimer = null; if (st.open) this.renderPanel(st, true); }, 110);
			},
		});
		st.layout?.refresh();
		if (restoreScroll(bodyViewport)) st.layout?.refresh();
		activateCovers?.();
	}

	hasOpenGallery(): boolean { for (const s of this.states.values()) if (s.open) return true; return false; }
}
