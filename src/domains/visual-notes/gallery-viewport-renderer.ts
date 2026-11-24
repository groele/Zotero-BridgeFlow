import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import { collectHubAnnotations, collectHubNotes } from '../../services/collection-notes.ts';
import type { RatingStorageLocation } from '../../services/item-status-rating.ts';
import { loadPdfCoverDataUrl } from '../../services/pdf-cover-service.ts';
import { extractQueryTerms } from './annotation-matrix-ui.ts';
import {
	ensureCollectionHubStyles,
	renderHubAnnotationsList,
	renderHubNotesList,
} from './collection-notes-ui.ts';
import { readItemRemarkWithFallback, type VisualNotesDataSource } from './data-source.ts';
import {
	applyKanbanColumnDrop,
	buildKanbanColumns,
	type GalleryCardModel,
	type GalleryGroupBy,
	type GalleryMode,
} from './gallery-board-helpers.ts';
import { createGallerySvgIcon, createToolbarArt } from './gallery-icons.ts';
import { galEl } from './gallery-styles.ts';

export function hydrateLazyPdfCovers(viewport: HTMLElement, doc: Document): () => void {
	const targets = [...viewport.querySelectorAll('.zbf-gal-cover[data-pdf-att-id]')] as HTMLElement[];
	if (!targets.length) return () => {};

	let disposed = false;
	const loadForCover = (coverEl: HTMLElement) => {
		if (disposed || coverEl.getAttribute('data-cover-hydrated') === '1') return;
		coverEl.setAttribute('data-cover-hydrated', '1');
		const attID = Number(coverEl.getAttribute('data-pdf-att-id') || 0);
		if (!attID || coverEl.querySelector('.zbf-gal-cover-img')) return;
		void loadPdfCoverDataUrl(attID, doc).then((dataUrl) => {
			if (disposed || !dataUrl || !coverEl.isConnected) return;
			const rateEl = coverEl.querySelector('.zbf-gal-rate-float');
			coverEl.textContent = '';
			const img = galEl(doc, 'img');
			img.className = 'zbf-gal-cover-img';
			img.src = dataUrl;
			coverEl.appendChild(img);
			if (rateEl) coverEl.appendChild(rateEl);
			img.setAttribute('data-loaded', 'true');
		});
	};

	const ObserverCtor = (doc.defaultView as any)?.IntersectionObserver || (globalThis as any).IntersectionObserver;
	if (typeof ObserverCtor === 'function') {
		const io = new ObserverCtor((entries: any[]) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					io.unobserve(entry.target);
					loadForCover(entry.target as HTMLElement);
				}
			}
		}, { root: viewport, rootMargin: '240px' });
		for (const t of targets) io.observe(t);
		return () => {
			disposed = true;
			io.disconnect();
		};
	}

	for (const t of targets.slice(0, 24)) loadForCover(t);
	return () => { disposed = true; };
}

export function renderGalleryViewport(opts: {
	doc: Document;
	zh: boolean;
	mode: GalleryMode;
	groupBy: GalleryGroupBy;
	sorted: readonly GalleryCardModel[];
	rawItems: readonly any[];
	renderLimit: number;
	excludedTag: string;
	ratingStorage: RatingStorageLocation;
	makeCard: (card: GalleryCardModel, draggable: boolean) => HTMLElement;
	onLoadMore: () => void;
	onDropMutated: () => void;
	onBatchAppended?: (container: HTMLElement) => void;
	onClearQuery?: () => void;
}): HTMLElement {
	const { doc, zh, sorted } = opts;
	const viewport = galEl(doc, 'div');
	viewport.className = 'zbf-gal-viewport';
	const cardByID = new Map<number, GalleryCardModel>(sorted.map((c) => [c.itemID, c]));

	if (opts.mode === 'gallery') {
		if (!sorted.length) {
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
			return viewport;
		}
		const grid = galEl(doc, 'div');
		grid.className = 'zbf-gal-grid';
		for (const c of sorted.slice(0, opts.renderLimit)) grid.appendChild(opts.makeCard(c, false));
		viewport.appendChild(grid);
		if (sorted.length > opts.renderLimit) {
			const more = galEl(doc, 'button');
			more.type = 'button';
			more.className = 'zbf-gal-more';
			more.textContent = zh
				? `加载更多 (${opts.renderLimit} / ${sorted.length})`
				: `Load more (${opts.renderLimit} / ${sorted.length})`;
			more.addEventListener('click', opts.onLoadMore);
			viewport.appendChild(more);
		}
		return viewport;
	}

	const board = galEl(doc, 'div');
	board.className = 'zbf-gal-board';
	const cols = buildKanbanColumns(sorted, opts.rawItems, opts.groupBy, zh, opts.excludedTag);
	for (const col of cols) {
		const colEl = galEl(doc, 'div');
		colEl.className = 'zbf-gal-col';
		colEl.style.setProperty('--zbf-col-surface', col.surfaceTint);
		const head = galEl(doc, 'div');
		head.className = 'zbf-gal-col-head';
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
		let shown = 0;
		const more = galEl(doc, 'button');
		more.type = 'button';
		more.className = 'zbf-gal-more';
		more.textContent = zh ? '加载更多' : 'Load more';
		const appendBatch = (fromClick = false) => {
			more.remove();
			for (const card of col.cards.slice(shown, shown + 80)) body.appendChild(opts.makeCard(card, col.droppable));
			shown += 80;
			if (shown < col.cards.length) body.appendChild(more);
			if (fromClick) opts.onBatchAppended?.(body);
		};
		more.addEventListener('click', () => appendBatch(true));
		appendBatch(false);

		if (col.droppable) {
			colEl.addEventListener('dragover', (ev) => {
				ev.preventDefault();
				colEl.setAttribute('data-drop-over', 'true');
			});
			colEl.addEventListener('dragleave', (ev) => {
				if (ev.relatedTarget && colEl.contains(ev.relatedTarget as Node)) return;
				colEl.removeAttribute('data-drop-over');
			});
			colEl.addEventListener('drop', (ev) => {
				ev.preventDefault();
				colEl.removeAttribute('data-drop-over');
				const draggedID = Number(ev.dataTransfer?.getData('text/zbf-item-id') || 0);
				const card = cardByID.get(draggedID);
				if (!card) return;
				void applyKanbanColumnDrop(card, opts.groupBy, col.key, {
					excludedStatusTag: opts.excludedTag,
					ratingStorage: opts.ratingStorage,
					color: col.color,
				}).then((changed) => {
					if (changed) opts.onDropMutated();
				}).catch(() => {});
			});
		}
		colEl.append(head, body);
		board.appendChild(colEl);
	}
	viewport.appendChild(board);
	return viewport;
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
			doc,
			win,
			scroll: feed, selection: opts.selection,
			entries: notesData.entries.filter(entry => entry.briefNote || entry.childNotes.length),
			syncExtra: Boolean(kernel.prefs.get('workspace.syncRemarkToExtra')),
			dataSource,
			terms,
			zh,
			onRemarkMutated: opts.onMutated,
			onStatus: () => {},
			onOpenItem: (itemID) => {
				kernel.bus.emit('workspace:open-item-request', { itemID, preferExistingTab: true });
			},
		});
	} else {
		const annData = collectHubAnnotations(
			rawItems,
			kernel.prefs.get('inspector.annotations.colorLabels'),
			{
				query,
				ignoreFigureTable: Boolean(kernel.prefs.get('visualNotes.collectionHub.ignoreFigureTable')),
			},
		);
		count = annData.annotations.length;
		renderHubAnnotationsList({
			doc,
			scroll: feed, selection: opts.selection,
			annotations: annData.annotations,
			colorHexByLabel: annData.colorHexByLabel,
			preferComment: Boolean(kernel.prefs.get('visualNotes.collectionHub.preferCommentOverQuote')),
			terms,
			zh,
			onStatus: () => {},
			onOpenItem: (itemID) => {
				kernel.bus.emit('workspace:open-item-request', { itemID, preferExistingTab: true });
			},
		});
	}
	viewport.appendChild(feed);
	return { viewport, count };
}

export function syncVisualNotesToolbarGroup(opts: {
	doc: Document;
	zh: boolean;
	galEnabled: boolean;
	hubEnabled: boolean;
	isOpen: boolean;
	existingGroup: HTMLElement | null;
	onToggleGallery: () => void;
	onOpenHub: () => void;
}): { tbGroup: HTMLElement | null; btnGallery: HTMLButtonElement | null; btnHub: HTMLButtonElement | null } {
	const { doc, zh, galEnabled, hubEnabled } = opts;
	const toolbar = doc.getElementById('zotero-items-toolbar');
	if (!toolbar || (!galEnabled && !hubEnabled)) {
		opts.existingGroup?.remove();
		return { tbGroup: null, btnGallery: null, btnHub: null };
	}
	let tbGroup = opts.existingGroup;
	if (!tbGroup || !tbGroup.isConnected) {
		doc.getElementById('zbf-items-tb-group')?.remove();
		tbGroup = galEl(doc, 'div');
		tbGroup.id = 'zbf-items-tb-group';
		tbGroup.className = 'zbf-items-tb-group';
		const anchor = toolbar.querySelector(':scope > spacer[flex="1"]') || toolbar.lastElementChild;
		if (anchor) toolbar.insertBefore(tbGroup, anchor);
		else toolbar.appendChild(tbGroup);
	}
	tbGroup.textContent = '';
	let btnGallery: HTMLButtonElement | null = null;
	let btnHub: HTMLButtonElement | null = null;
	if (galEnabled) {
		btnGallery = galEl(doc, 'button');
		btnGallery.id = 'zbf-tb-gallery-toggle';
		btnGallery.type = 'button';
		btnGallery.className = 'zbf-items-tb-icon';
		btnGallery.setAttribute('aria-pressed', String(opts.isOpen));
		btnGallery.title = zh ? '切换画廊与多维看板视图' : 'Toggle Gallery & Kanban View';
		btnGallery.appendChild(createToolbarArt(doc, 'gallery'));
		btnGallery.addEventListener('click', opts.onToggleGallery);
		tbGroup.appendChild(btnGallery);
	}
	if (hubEnabled) {
		btnHub = galEl(doc, 'button');
		btnHub.id = 'zbf-tb-collection-hub';
		btnHub.type = 'button';
		btnHub.className = 'zbf-items-tb-icon';
		btnHub.title = zh ? '打开当前分类集中笔记与标注中心' : 'Open Collection Notes & Annotations Hub';
		btnHub.appendChild(createToolbarArt(doc, 'notes'));
		btnHub.addEventListener('click', opts.onOpenHub);
		tbGroup.appendChild(btnHub);
	}
	return { tbGroup, btnGallery, btnHub };
}
