import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import { normalizeRatingStorage } from '../../services/item-status-rating.ts';
import type { TabReadingProgress } from '../../services/reading-stats.ts';
import { readItemRemarkWithFallback, type VisualNotesDataSource } from './data-source.ts';
import {
	extractGalleryCards,
	filterAndSortGalleryCards,
	type GalleryCardModel,
	type GalleryContentTab,
	type GalleryGroupBy,
	type GalleryMode,
	type GallerySortField,
} from './gallery-board-helpers.ts';
import { renderGalleryCardElement, renderGalleryTopBar } from './gallery-card-renderer.ts';
import { ensureGalleryStyles, galEl } from './gallery-styles.ts';
import {
	hydrateLazyPdfCovers,
	renderGalleryInlineFeed,
	renderGalleryViewport,
	syncVisualNotesToolbarGroup,
} from './gallery-viewport-renderer.ts';

interface WindowGalleryState {
	win: Window;
	open: boolean;
	contentTab: GalleryContentTab;
	mode: GalleryMode;
	groupBy: GalleryGroupBy;
	sortField: GallerySortField;
	query: string;
	renderLimit: number;
	selectedItemID: number;
	readingSelection: { itemID: number };
	tbGroup: HTMLElement | null;
	btnGallery: HTMLButtonElement | null;
	btnHub: HTMLButtonElement | null;
	panel: HTMLElement | null;
	colChangeTimer: ReturnType<typeof setTimeout> | null;
	coverDisposers: Array<() => void>;
	cleanupListeners: Array<() => void>;
}

const BATCH_STEP = 120;

export class GalleryBoardController {
	private readonly states = new Map<Window, WindowGalleryState>();
	private readonly kernel: PluginKernel;
	private dataSource?: VisualNotesDataSource;
	private readonly getReadProgress: (item: any) => TabReadingProgress | undefined;
	private readonly onOpenHub: (win: Window) => void;
	private readonly onMutated: () => void;

	constructor(options: {
		kernel: PluginKernel;
		getReadProgress: (item: any) => TabReadingProgress | undefined;
		onOpenHub: (win: Window) => void;
		onMutated: () => void;
	}) {
		this.kernel = options.kernel;
		this.getReadProgress = options.getReadProgress;
		this.onOpenHub = options.onOpenHub;
		this.onMutated = options.onMutated;
	}

	setDataSource(source?: VisualNotesDataSource): void {
		this.dataSource = source;
	}

	private isZh(): boolean {
		return Boolean((globalThis as any).Zotero?.locale?.startsWith?.('zh'));
	}

	private defaultMode(): GalleryMode {
		return this.kernel.prefs.get('visualNotes.gallery.defaultMode') === 'board' ? 'board' : 'gallery';
	}

	private defaultGroupBy(): GalleryGroupBy {
		const v = String(this.kernel.prefs.get('visualNotes.gallery.groupBy') || 'status');
		if (v === 'rating' || v === 'readState' || v === 'year' || v === 'publication' || v === 'itemType') return v;
		return 'status';
	}

	attachWindow(win: Window): void {
		if (!win?.document || this.states.has(win)) return;
		const st: WindowGalleryState = {
			win,
			open: false,
			contentTab: 'items',
			mode: this.defaultMode(),
			groupBy: this.defaultGroupBy(),
			sortField: 'dateModified',
			query: '',
			renderLimit: BATCH_STEP,
			selectedItemID: 0,
			readingSelection: { itemID: 0 },
			tbGroup: null,
			btnGallery: null,
			btnHub: null,
			panel: null,
			colChangeTimer: null,
			coverDisposers: [],
			cleanupListeners: [],
		};
		this.states.set(win, st);
		this.syncWindow(st);

		const colTree = win.document.getElementById('zotero-collections-tree');
		if (colTree) {
			const onColChange = () => {
				if (!st.open) return;
				if (st.colChangeTimer !== null) clearTimeout(st.colChangeTimer);
				st.colChangeTimer = setTimeout(() => {
					st.colChangeTimer = null;
					if (st.open && !(st.win as any).closed) {
						st.renderLimit = BATCH_STEP;
						this.renderPanel(st);
					}
				}, 55);
			};
			colTree.addEventListener('click', onColChange);
			colTree.addEventListener('keyup', onColChange);
			st.cleanupListeners.push(() => {
				if (st.colChangeTimer !== null) { clearTimeout(st.colChangeTimer); st.colChangeTimer = null; }
				colTree.removeEventListener('click', onColChange);
				colTree.removeEventListener('keyup', onColChange);
			});
		}
	}

	private disposeCovers(st: WindowGalleryState): void {
		for (const fn of st.coverDisposers.splice(0)) {
			try { fn(); } catch { /* ignore */ }
		}
	}

	detachWindow(win: Window): void {
		const st = this.states.get(win);
		if (!st) return;
		this.disposeCovers(st);
		this.setGalleryOpen(st, false);
		for (const fn of st.cleanupListeners) fn();
		st.cleanupListeners.length = 0;
		st.tbGroup?.remove();
		st.panel?.remove();
		this.states.delete(win);
	}

	disposeAll(): void {
		for (const win of [...this.states.keys()]) this.detachWindow(win);
	}

	sync(windows: Iterable<Window>): void {
		for (const win of windows) {
			if (!this.states.has(win)) this.attachWindow(win);
			const st = this.states.get(win);
			if (st) this.syncWindow(st);
		}
	}

	refreshWindows(): void {
		for (const st of this.states.values()) {
			const active = st.win.document?.activeElement as Element | null;
			const typingInPanel = Boolean(active && typeof active.closest === 'function' && st.panel?.contains(active.closest('input,textarea')));
			if (st.open && !typingInPanel) this.renderPanel(st);
		}
	}

	toggleWindowGallery(win: Window, mode?: GalleryMode): void {
		let st = this.states.get(win);
		if (!st) {
			this.attachWindow(win);
			st = this.states.get(win);
		}
		if (!st) return;
		if (mode) {
			st.mode = mode;
			this.setGalleryOpen(st, true);
		} else {
			this.setGalleryOpen(st, !st.open);
		}
	}

	private syncWindow(st: WindowGalleryState): void {
		const doc = st.win.document;
		if (!doc) return;
		ensureGalleryStyles(doc);
		const galEnabled = Boolean(this.kernel.prefs.get('visualNotes.gallery.enable'));
		const hubEnabled = Boolean(this.kernel.prefs.get('visualNotes.collectionHub.enable'));

		if (!galEnabled && st.open) this.setGalleryOpen(st, false);

		const mounted = syncVisualNotesToolbarGroup({
			doc,
			zh: this.isZh(),
			galEnabled,
			hubEnabled,
			isOpen: st.open,
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
		const itemsPane = doc.getElementById('zotero-items-pane');
		if (!itemsPane) return;

		if (!nextOpen) {
			if (st.colChangeTimer !== null) { clearTimeout(st.colChangeTimer); st.colChangeTimer = null; }
			this.disposeCovers(st);
			if (st.panel) st.panel.style.display = 'none';
			itemsPane.removeAttribute('data-zbf-gallery');
			const tree = (st.win as any).ZoteroPane?.itemsView?.tree;
			try { tree?.invalidate?.(); tree?.render?.(); } catch { /* ignore */ }
			return;
		}

		if (!st.panel || !st.panel.isConnected) {
			doc.getElementById('zbf-gallery-panel')?.remove();
			const panel = galEl(doc, 'div');
			panel.id = 'zbf-gallery-panel';
			panel.className = 'zbf-gallery-panel';
			itemsPane.prepend(panel);
			st.panel = panel;
		}
		itemsPane.setAttribute('data-zbf-gallery', 'true');
		st.panel.style.display = 'flex';
		this.renderPanel(st);
	}

	private renderPanel(st: WindowGalleryState, keepTopBar = false): void {
		const doc = st.win.document;
		const panel = st.panel;
		if (!doc || !panel || !st.open) return;

		this.disposeCovers(st);

		const zh = this.isZh();
		const density = this.kernel.prefs.get('visualNotes.gallery.cardDensity') === 'compact' ? 'compact' : 'comfortable';
		const showBrief = Boolean(this.kernel.prefs.get('visualNotes.gallery.showBriefNote'));
		const excludedTag = String(this.kernel.prefs.get('wordCite.citationTags.text') || '/Citations');
		const ratingStorage = normalizeRatingStorage(this.kernel.prefs.get('visualNotes.ratingStorage'));

		panel.setAttribute('data-density', density);
		panel.style.setProperty('--zbf-card-width', this.kernel.prefs.get('visualNotes.gallery.cardWidth') + 'px');
		const coverHeight = this.kernel.prefs.get('visualNotes.gallery.coverHeight');
		panel.style.setProperty('--zbf-cover-height', coverHeight > 0 ? coverHeight + 'px' : 'auto');
		panel.style.setProperty('--zbf-cover-aspect', coverHeight > 0 ? 'auto' : (density === 'compact' ? '2.1' : '1.95'));
		const { cards: allCards, rawItems } = extractGalleryCards(st.win, {
			zh,
			excludedStatusTag: excludedTag,
			ratingStorage,
			getBriefNote: (it) => readItemRemarkWithFallback(it, this.dataSource),
			getReadProgress: this.getReadProgress,
		});

		let displayCount = 0;
		let bodyViewport: HTMLElement;

		if (st.contentTab === 'items') {
			const sorted = filterAndSortGalleryCards(allCards, st.query, st.sortField);
			displayCount = sorted.length;
			bodyViewport = renderGalleryViewport({
				doc,
				zh,
				mode: st.mode,
				groupBy: st.groupBy,
				sorted,
				rawItems,
				renderLimit: st.renderLimit,
				excludedTag,
				ratingStorage,
				makeCard: (c: GalleryCardModel, draggable: boolean) => renderGalleryCardElement({
					doc,
					card: c,
					selected: st.selectedItemID === c.itemID,
					showBrief,
					ratingStorage,
					draggable,
					onSelect: (picked, el) => {
						st.selectedItemID = picked.itemID;
						st.panel?.querySelectorAll('.zbf-gal-card[data-selected="true"]').forEach((n) => n.removeAttribute('data-selected'));
						el.setAttribute('data-selected', 'true');
						(st.win as any).ZoteroPane?.itemsView?.selectItem?.(picked.itemID);
					},
					onOpenReader: (itemID) => {
						this.kernel.bus.emit('workspace:open-item-request', { itemID, preferExistingTab: true });
					},
					onRated: () => {
						this.onMutated();
						this.renderPanel(st);
					},
				}),
				onLoadMore: () => {
					st.renderLimit += BATCH_STEP;
					this.renderPanel(st);
				},
				onDropMutated: () => {
					this.onMutated();
					this.renderPanel(st);
				},
				onBatchAppended: (laneEl) => {
					st.coverDisposers.push(hydrateLazyPdfCovers(laneEl, doc));
				},
				onClearQuery: st.query ? () => { st.query = ''; this.renderPanel(st); } : undefined,
			});
		} else {
			const res = renderGalleryInlineFeed({
				doc,
				win: st.win,
				zh,
				tab: st.contentTab, selection: st.readingSelection,
				rawItems,
				query: st.query,
				kernel: this.kernel,
				dataSource: this.dataSource,
				onMutated: () => this.onMutated(),
			});
			bodyViewport = res.viewport;
			displayCount = res.count;
		}

		const existingBar = keepTopBar ? panel.querySelector('.zbf-gal-bar') : null;
		if (existingBar) {
			const cntEl = existingBar.querySelector('.zbf-gal-count');
			if (cntEl) cntEl.textContent = String(displayCount);
			panel.querySelector('.zbf-gal-viewport')?.remove();
			panel.appendChild(bodyViewport);
		} else {
			panel.textContent = '';
			panel.appendChild(renderGalleryTopBar({
				doc, zh, contentTab: st.contentTab, mode: st.mode, groupBy: st.groupBy, sortField: st.sortField, query: st.query, totalCount: displayCount,
				onContentTabChange: (t) => { st.contentTab = t; this.renderPanel(st); },
				onModeChange: (m) => { st.mode = m; this.kernel.prefs.set('visualNotes.gallery.defaultMode', m); this.renderPanel(st); },
				onGroupByChange: (g) => { st.groupBy = g; this.kernel.prefs.set('visualNotes.gallery.groupBy', g); this.renderPanel(st); },
				onSortChange: (s) => { st.sortField = s; this.renderPanel(st); },
				onQueryInput: (q) => { st.query = q; this.renderPanel(st, true); },
			}));
			panel.appendChild(bodyViewport);
		}
		st.coverDisposers.push(hydrateLazyPdfCovers(bodyViewport, doc));
	}
}
