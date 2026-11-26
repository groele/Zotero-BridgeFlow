import type { PluginKernel } from '../../../kernel/plugin-kernel.ts';
import { collectHubAnnotations, collectHubNotes } from '../../../services/collection-notes.ts';
import type { RatingStorageLocation } from '../../../services/item-status-rating.ts';
import { notifyGalleryCoverScroll, setGalleryCoverDragging } from '../../../services/pdf-cover-service.ts';
import { extractQueryTerms } from '../hub/annotation-matrix-ui.ts';
import {
	ensureCollectionHubStyles,
	renderHubAnnotationsList,
	renderHubNotesList,
} from '../hub/collection-notes-ui.ts';
import { readItemRemarkWithFallback, type VisualNotesDataSource } from '../data-source.ts';
import {
	applyKanbanColumnDrop,
	buildKanbanColumns,
	type GalleryCardModel,
	type GalleryGroupBy,
	type GalleryMode,
} from './gallery-board-helpers.ts';
import { createViewportCoverHydrator, syncVisualNotesToolbarGroup } from './gallery-cover-hydrator.ts';
import { createGallerySvgIcon } from './gallery-icons.ts';
import { galEl } from './gallery-styles.ts';
import {
	createGalleryVirtualLayout,
	moveGalleryKeys,
	type GalleryVirtualLayoutController,
} from './gallery-virtual-layout.ts';

export { createViewportCoverHydrator, syncVisualNotesToolbarGroup };

export function renderGalleryViewport(opts: {
	doc: Document;
	zh: boolean;
	mode: GalleryMode;
	groupBy: GalleryGroupBy;
	cardMinWidth: number;
	density: 'comfortable' | 'compact';
	sorted: readonly GalleryCardModel[];
	rawItems: readonly any[];
	getSelectedIDs: () => ReadonlySet<number>;
	columnOrder?: readonly string[];
	measurements?: Map<string, number>;
	excludedTag: string;
	ratingStorage: RatingStorageLocation;
	syncZoteroTagColor?: boolean;
	makeCard: (card: GalleryCardModel, draggable: boolean, onDragStateChange?: (dragging: boolean) => void) => HTMLElement;
	onColumnOrderChange?: (nextKeys: string[]) => void;
	onDropMutated: (targetIDs?: readonly number[]) => void;
	onClearQuery?: () => void;
}): { viewport: HTMLElement; layout: GalleryVirtualLayoutController | null; activate: () => void; dispose: () => void } {
	const { doc, zh, sorted } = opts;
	const viewport = galEl(doc, 'div');
	viewport.className = 'zbf-gal-viewport';
	const gap = opts.density === 'compact' ? 8 : 11;
	const estimateHeight = opts.density === 'compact' ? 210 : 254;

	if (opts.mode === 'gallery' && !sorted.length) {
		const empty = galEl(doc, 'div');
		empty.className = 'zbf-gal-empty';
		empty.appendChild(createGallerySvgIcon(doc, 'search', 28));
		const msg = galEl(doc, 'p');
		msg.textContent = zh ? '当前筛选条件下暂无匹配的文献' : 'No items match the current filter';
		empty.appendChild(msg);
		if (opts.onClearQuery) {
			const reset = galEl(doc, 'button');
			reset.type = 'button';
			reset.className = 'zbf-gal-more';
			reset.textContent = zh ? '清空搜索条件' : 'Clear filter';
			reset.addEventListener('click', opts.onClearQuery);
			empty.appendChild(reset);
		}
		viewport.appendChild(empty);
		return { viewport, layout: null, activate: () => {}, dispose: () => {} };
	}

	const hydrator = createViewportCoverHydrator(viewport, doc);

	if (opts.mode === 'gallery') {
		const grid = galEl(doc, 'div');
		grid.className = 'zbf-gal-grid';
		viewport.appendChild(grid);
		const layout = createGalleryVirtualLayout<GalleryCardModel>({
			doc, scroll: viewport, content: grid, board: false,
			cardMinWidth: opts.cardMinWidth, gap, estimateHeight, measurements: opts.measurements,
			items: sorted.map((c) => ({ id: c.itemID, key: String(c.itemID), data: c })),
			createCard: ({ data }) => opts.makeCard(data, false),
			onCardMounted: (cardEl) => hydrator.observeCard(cardEl),
			onCardUnmounted: (cardEl) => hydrator.unobserveCard(cardEl),
		});
		return { viewport, layout, activate: () => hydrator.activate(), dispose: () => { layout.destroy(); hydrator.dispose(); } };
	}

	const cardByID = new Map<number, GalleryCardModel>(sorted.map((c) => [c.itemID, c]));
	const board = galEl(doc, 'div');
	board.className = 'zbf-gal-board';
	viewport.appendChild(board);
	let cols = buildKanbanColumns(sorted, opts.rawItems, opts.groupBy, zh, opts.excludedTag);
	if (opts.columnOrder?.length) {
		const orderIndex = new Map(opts.columnOrder.map((k, idx) => [k, idx]));
		cols = [...cols].sort((a, b) => (orderIndex.get(a.key) ?? 9999) - (orderIndex.get(b.key) ?? 9999));
	}
	const allColKeys = cols.map((c) => c.key);
	const droppableCols = new Set(cols.filter((c) => c.droppable).map((c) => c.key));

	let layoutRef: GalleryVirtualLayoutController | null = null;
	const setDragging = (dragging: boolean) => {
		setGalleryCoverDragging(viewport, dragging);
		layoutRef?.setDragging(dragging);
	};
	const colSpecs = cols.map((col) => ({
		value: col.key,
		items: col.cards.map((c) => ({ id: c.itemID, key: String(c.itemID), data: c })),
		createShell: () => {
			const colEl = galEl(doc, 'div');
			colEl.className = 'zbf-gal-col';
			colEl.dataset.colKey = col.key;
			colEl.style.setProperty('--zbf-col-surface', col.surfaceTint);

			const head = galEl(doc, 'div');
			head.className = 'zbf-gal-col-head';
			head.draggable = true;
			head.addEventListener('dragstart', (ev) => {
				ev.stopPropagation();
				setDragging(true);
				ev.dataTransfer?.setData('text/zbf-col-key', col.key);
			});
			head.addEventListener('dragend', () => {
				setDragging(false);
			});

			const pill = galEl(doc, 'span');
			pill.className = 'zbf-gal-col-pill';
			pill.style.background = `light-dark(${col.pillBg}, rgba(255,255,255,0.1))`;
			pill.style.color = `light-dark(${col.pillFg}, #f1f5f9)`;
			pill.textContent = col.title;
			const count = galEl(doc, 'span');
			count.className = 'zbf-gal-col-count';
			count.textContent = String(col.cards.length);
			head.append(pill, count);

			const body = galEl(doc, 'div');
			body.className = 'zbf-gal-col-body';
			body.addEventListener('scroll', () => notifyGalleryCoverScroll(), { passive: true });

			colEl.addEventListener('dragover', (ev) => {
				const types = Array.from(ev.dataTransfer?.types || []);
				if (types.includes('text/zbf-col-key')) {
					ev.preventDefault();
					colEl.setAttribute('data-col-drag-over', 'true');
				} else if (col.droppable && types.includes('text/zbf-item-id')) {
					ev.preventDefault();
					colEl.setAttribute('data-drop-over', 'true');
				}
			});
			colEl.addEventListener('dragleave', (ev) => {
				if (ev.relatedTarget && colEl.contains(ev.relatedTarget as Node)) return;
				colEl.removeAttribute('data-drop-over');
				colEl.removeAttribute('data-col-drag-over');
			});
			colEl.addEventListener('drop', (ev) => {
				colEl.removeAttribute('data-drop-over');
				colEl.removeAttribute('data-col-drag-over');
				const draggedCol = ev.dataTransfer?.getData('text/zbf-col-key');
				if (draggedCol && draggedCol !== col.key) {
					ev.preventDefault();
					opts.onColumnOrderChange?.(moveGalleryKeys(allColKeys, [draggedCol], col.key));
					return;
				}
				if (!col.droppable) return;
				const draggedID = Number(ev.dataTransfer?.getData('text/zbf-item-id') || 0);
				if (!draggedID) return;
				ev.preventDefault();
				const selected = opts.getSelectedIDs();
				const targetIDs = selected.has(draggedID) ? [...selected] : [draggedID];
				void (async () => {
					let anyChanged = false;
					for (const tid of targetIDs) {
						const card = cardByID.get(tid);
						if (!card) continue;
						const ch = await applyKanbanColumnDrop(card, opts.groupBy, col.key, {
							excludedStatusTag: opts.excludedTag, ratingStorage: opts.ratingStorage,
							color: col.color, syncZoteroTagColor: opts.syncZoteroTagColor,
						}).catch(() => false);
						if (ch) anyChanged = true;
					}
					if (anyChanged) opts.onDropMutated(targetIDs);
				})();
			});

			colEl.append(head, body);
			return { root: colEl, list: body, headingHeight: 44 };
		},
	}));

	layoutRef = createGalleryVirtualLayout<GalleryCardModel>({
		doc, scroll: viewport, content: board, board: true,
		cardMinWidth: opts.cardMinWidth, gap: 10, estimateHeight,
		measurements: opts.measurements, columns: colSpecs,
		createCard: ({ data, columnValue }) => opts.makeCard(data, droppableCols.has(columnValue), setDragging),
		onCardMounted: (cardEl) => hydrator.observeCard(cardEl),
		onCardUnmounted: (cardEl) => hydrator.unobserveCard(cardEl),
	});

	return { viewport, layout: layoutRef, activate: () => hydrator.activate(), dispose: () => {
		setGalleryCoverDragging(viewport, false);
		layoutRef?.destroy();
		hydrator.dispose();
	} };
}

export function renderGalleryInlineFeed(opts: {
	doc: Document;
	win: Window;
	zh: boolean;
	tab: 'notes' | 'annotations';
	selection: { itemID: number };
	rawItems: readonly any[];
	query: string;
	kernel: PluginKernel;
	dataSource?: VisualNotesDataSource;
	onMutated: () => void;
	onStatus: (message: string) => void;
}): { viewport: HTMLElement; count: number } {
	const { doc, win, zh, rawItems, query, kernel, dataSource } = opts;
	ensureCollectionHubStyles(doc);
	const viewport = galEl(doc, 'div');
	viewport.className = 'zbf-gal-viewport';
	const feed = galEl(doc, 'div');
	feed.className = 'zbf-gal-feed-grid';
	const terms = extractQueryTerms(query);
	let count = 0;

	if (opts.tab === 'notes') {
		const notesData = collectHubNotes(rawItems, (it) => readItemRemarkWithFallback(it, dataSource), query);
		count = notesData.totalBriefNotes + notesData.totalChildNotes;
		renderHubNotesList({
			doc, win, scroll: feed, selection: opts.selection,
			entries: notesData.entries.filter((entry) => entry.briefNote || entry.childNotes.length),
			syncExtra: Boolean(kernel.prefs.get('workspace.syncRemarkToExtra')),
			dataSource, terms, zh,
			onRemarkMutated: opts.onMutated,
			onStatus: opts.onStatus,
			onOpenItem: (itemID) => kernel.bus.emit('workspace:open-item-request', { itemID, preferExistingTab: true }),
		});
	} else {
		const annData = collectHubAnnotations(rawItems, kernel.prefs.get('inspector.annotations.colorLabels'), {
			query, ignoreFigureTable: Boolean(kernel.prefs.get('visualNotes.collectionHub.ignoreFigureTable')),
		});
		count = annData.annotations.length;
		renderHubAnnotationsList({
			doc, scroll: feed, selection: opts.selection,
			annotations: annData.annotations, colorHexByLabel: annData.colorHexByLabel,
			preferComment: Boolean(kernel.prefs.get('visualNotes.collectionHub.preferCommentOverQuote')),
			terms, zh, onStatus: () => {},
			onOpenItem: (itemID) => kernel.bus.emit('workspace:open-item-request', { itemID, preferExistingTab: true }),
		});
	}
	viewport.appendChild(feed);
	return { viewport, count };
}
