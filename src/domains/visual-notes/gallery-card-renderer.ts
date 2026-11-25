import { setItemRating, type RatingStorageLocation } from '../../services/item-status-rating.ts';
import { getCachedPdfCoverSync } from '../../services/pdf-cover-service.ts';
import type {
	GalleryCardModel,
	GalleryContentTab,
	GalleryGroupBy,
	GalleryMode,
	GallerySortField,
} from './gallery-board-helpers.ts';
import { createGallerySvgIcon, renderRichTitleNodes, resolvePastelTagStyle } from './gallery-icons.ts';
import { galEl } from './gallery-styles.ts';

export function renderGalleryTopBar(opts: {
	doc: Document;
	zh: boolean;
	contentTab: GalleryContentTab;
	mode: GalleryMode;
	groupBy: GalleryGroupBy;
	sortField: GallerySortField;
	query: string;
	totalCount: number;
	onContentTabChange: (tab: GalleryContentTab) => void;
	onModeChange: (mode: GalleryMode) => void;
	onGroupByChange: (groupBy: GalleryGroupBy) => void;
	onSortChange: (sortField: GallerySortField) => void;
	onQueryInput: (query: string) => void;
}): HTMLElement {
	const { doc, zh } = opts;
	const bar = galEl(doc, 'div');
	bar.className = 'zbf-gal-bar';
	const left = galEl(doc, 'div');
	left.className = 'zbf-gal-bar-left';
	const right = galEl(doc, 'div');
	right.className = 'zbf-gal-bar-right';

	const tabsWrap = galEl(doc, 'div');
	tabsWrap.className = 'zbf-gal-tabs';
	const tabDefs: Array<[GalleryContentTab, string]> = [
		['items', zh ? '条目' : 'Items'],
		['notes', zh ? '笔记' : 'Notes'],
		['annotations', zh ? '标注' : 'Annotations'],
	];
	for (const [key, label] of tabDefs) {
		const btn = galEl(doc, 'button');
		btn.type = 'button';
		btn.className = 'zbf-gal-tab';
		btn.setAttribute('data-active', String(opts.contentTab === key));
		btn.textContent = label;
		btn.addEventListener('click', () => opts.onContentTabChange(key));
		tabsWrap.appendChild(btn);
	}
	const countSpan = galEl(doc, 'span');
	countSpan.className = 'zbf-gal-count';
	countSpan.textContent = String(opts.totalCount);
	left.append(tabsWrap, countSpan);

	const searchBox = galEl(doc, 'div');
	searchBox.className = 'zbf-gal-search-box';
	const searchIcon = galEl(doc, 'span');
	searchIcon.className = 'zbf-gal-search-icon';
	searchIcon.appendChild(createGallerySvgIcon(doc, 'search', 13));
	const search = galEl(doc, 'input');
	search.type = 'text';
	search.className = 'zbf-gal-search';
	search.value = opts.query;
	search.placeholder = opts.contentTab === 'items' ? (zh ? '搜索文献…' : 'Search items…') : (zh ? '筛选正文或标题…' : 'Filter text or title…');
	search.setAttribute('aria-label', search.placeholder);
	let composing = false;
	search.addEventListener('compositionstart', () => { composing = true; });
	search.addEventListener('compositionend', () => { composing = false; opts.onQueryInput(search.value); });
	search.addEventListener('input', () => { if (!composing) opts.onQueryInput(search.value); });
	searchBox.append(searchIcon, search);
	right.appendChild(searchBox);

	if (opts.contentTab === 'items') {
		if (opts.mode === 'board') {
			const grpSel = galEl(doc, 'select');
			grpSel.className = 'zbf-gal-select';
			const grpOpts: Array<[GalleryGroupBy, string]> = [
				['readState', zh ? '阅读进度' : 'Reading Progress'],
				['status', zh ? '阅读状态' : 'Status'],
				['rating', zh ? '星级评价' : 'Star Rating'],
				['year', zh ? '发表年份' : 'Year'],
				['publication', zh ? '期刊来源' : 'Publication'],
				['itemType', zh ? '条目类型' : 'Item Type'],
			];
			for (const [val, lbl] of grpOpts) {
				const o = galEl(doc, 'option');
				o.value = val;
				o.textContent = lbl;
				if (opts.groupBy === val) o.selected = true;
				grpSel.appendChild(o);
			}
			grpSel.addEventListener('change', () => opts.onGroupByChange(grpSel.value as GalleryGroupBy));
			right.appendChild(grpSel);
		}

		const sortSel = galEl(doc, 'select');
		sortSel.className = 'zbf-gal-select';
		for (const [val, lbl] of [
			['dateModified', zh ? '最近修改' : 'Modified'],
			['year', zh ? '发表年份' : 'Year'],
			['rating', zh ? '星级优先' : 'Rating'],
			['readTime', zh ? '阅读时长' : 'Read Time'],
			['title', zh ? '标题 A–Z' : 'Title'],
		] as const) {
			const o = galEl(doc, 'option');
			o.value = val;
			o.textContent = lbl;
			if (opts.sortField === val) o.selected = true;
			sortSel.appendChild(o);
		}
		sortSel.addEventListener('change', () => opts.onSortChange(sortSel.value as GallerySortField));
		right.appendChild(sortSel);

		const modeSeg = galEl(doc, 'div');
		modeSeg.className = 'zbf-gal-seg';
		for (const [m, iconName, lbl] of [
			['gallery', 'grid', zh ? '画廊' : 'Gallery'],
			['board', 'board', zh ? '看板' : 'Board'],
		] as const) {
			const b = galEl(doc, 'button');
			b.type = 'button';
			b.className = 'zbf-gal-seg-btn';
			b.setAttribute('data-active', String(opts.mode === m));
			b.appendChild(createGallerySvgIcon(doc, iconName, 13));
			const s = galEl(doc, 'span');
			s.textContent = lbl;
			b.appendChild(s);
			b.addEventListener('click', () => opts.onModeChange(m));
			modeSeg.appendChild(b);
		}
		right.appendChild(modeSeg);
	}

	bar.append(left, right);
	return bar;
}

export function renderGalleryCardElement(opts: {
	doc: Document;
	card: GalleryCardModel;
	selected: boolean;
	showBrief: boolean;
	ratingStorage: RatingStorageLocation;
	draggable: boolean;
	onSelect: (card: GalleryCardModel, el: HTMLElement, ev: MouseEvent) => void;
	onContextMenu?: (card: GalleryCardModel, el: HTMLElement, ev: MouseEvent) => void;
	onOpenReader: (card: GalleryCardModel, ev?: MouseEvent | KeyboardEvent) => void;
	onNavigateKey?: (card: GalleryCardModel, key: string, ev: KeyboardEvent) => void;
	onDragStateChange?: (dragging: boolean) => void;
	onRated: () => void;
}): HTMLElement {
	const { doc, card } = opts;
	const el = galEl(doc, 'div');
	el.className = 'zbf-gal-card';
	el.tabIndex = 0;
	el.dataset.itemId = String(card.itemID);
	if (opts.selected) el.setAttribute('data-selected', 'true');
	if (opts.draggable) {
		el.draggable = true;
		el.addEventListener('dragstart', (ev) => {
			el.setAttribute('data-dragging', 'true');
			opts.onDragStateChange?.(true);
			ev.dataTransfer?.setData('text/zbf-item-id', String(card.itemID));
		});
		el.addEventListener('dragend', () => {
			el.removeAttribute('data-dragging');
			opts.onDragStateChange?.(false);
		});
	}

	const cover = galEl(doc, 'div');
	cover.className = 'zbf-gal-cover';
	const renderFallbackInside = () => {
		if (card.abstractExcerpt) {
			const ab = galEl(doc, 'div');
			ab.className = 'zbf-gal-cover-abstract';
			ab.textContent = card.abstractExcerpt;
			cover.appendChild(ab);
		} else {
			const fb = galEl(doc, 'div');
			fb.className = 'zbf-gal-cover-fallback';
			fb.appendChild(createGallerySvgIcon(doc, 'doc', 26));
			const lbl = galEl(doc, 'span');
			lbl.textContent = card.itemTypeLabel;
			fb.appendChild(lbl);
			cover.appendChild(fb);
		}
	};

	if (card.pdfAttachmentID > 0) {
		cover.setAttribute('data-pdf-att-id', String(card.pdfAttachmentID));
		const syncUrl = getCachedPdfCoverSync(card.pdfAttachmentID);
		if (syncUrl) {
			const img = galEl(doc, 'img');
			img.className = 'zbf-gal-cover-img';
			img.decoding = 'async';
			img.src = syncUrl;
			img.setAttribute('data-loaded', 'true');
			cover.appendChild(img);
		} else {
			renderFallbackInside();
		}
	} else {
		renderFallbackInside();
	}

	const rateFloat = galEl(doc, 'div');
	rateFloat.className = 'zbf-gal-rate-float';
	let currentRating = card.rating;
	const starEls: HTMLElement[] = [];
	const syncCardStars = (val: number) => {
		if (val > 0) rateFloat.setAttribute('data-has-rating', 'true');
		else rateFloat.removeAttribute('data-has-rating');
		starEls.forEach((elStar, idx) => {
			const n = idx + 1;
			if (n <= val) elStar.setAttribute('data-lit', 'true');
			else elStar.removeAttribute('data-lit');
		});
	};
	rateFloat.addEventListener('mousedown', (ev) => {
		if (ev.button === 0) ev.stopPropagation();
	});
	rateFloat.addEventListener('dblclick', (ev) => {
		ev.stopPropagation();
		ev.preventDefault();
	});
	rateFloat.addEventListener('mouseleave', () => {
		rateFloat.removeAttribute('data-hover');
		rateFloat.removeAttribute('data-clear-hint');
	});
	for (let k = 1; k <= 5; k++) {
		const s = galEl(doc, 'span');
		s.className = 'zbf-gal-star';
		s.textContent = '⭐';
		s.addEventListener('mouseenter', () => {
			rateFloat.setAttribute('data-hover', String(k));
			if (currentRating === k) rateFloat.setAttribute('data-clear-hint', 'true');
			else rateFloat.removeAttribute('data-clear-hint');
		});
		s.addEventListener('click', (ev) => {
			ev.stopPropagation();
			const prev = currentRating;
			const next = currentRating === k ? 0 : k;
			currentRating = next;
			rateFloat.removeAttribute('data-hover');
			rateFloat.removeAttribute('data-clear-hint');
			syncCardStars(next);
			void setItemRating(card.item, next, opts.ratingStorage).then((ok) => {
				if (!ok) { currentRating = prev; syncCardStars(prev); return; }
				opts.onRated();
			}, () => { currentRating = prev; syncCardStars(prev); });
		});
		starEls.push(s);
		rateFloat.appendChild(s);
	}
	syncCardStars(currentRating);
	cover.appendChild(rateFloat);
	el.appendChild(cover);

	const titleRow = galEl(doc, 'div');
	titleRow.className = 'zbf-gal-title-row';
	const titleIcon = galEl(doc, 'span');
	titleIcon.className = 'zbf-gal-title-icon';
	titleIcon.appendChild(createGallerySvgIcon(doc, 'doc', 13));
	const title = galEl(doc, 'div');
	title.className = 'zbf-gal-title';
	renderRichTitleNodes(doc, title, card.title);
	titleRow.append(titleIcon, title);
	el.appendChild(titleRow);

	const metaStack = galEl(doc, 'div');
	metaStack.className = 'zbf-gal-meta-stack';
	const addMetaRow = (icon: 'user' | 'calendar' | 'book' | 'clock', text: string) => {
		if (!text) return;
		const row = galEl(doc, 'div');
		row.className = 'zbf-gal-meta-row';
		row.appendChild(createGallerySvgIcon(doc, icon, 12));
		const span = galEl(doc, 'span');
		span.className = 'zbf-gal-meta-txt';
		span.textContent = text;
		row.appendChild(span);
		metaStack.appendChild(row);
	};
	addMetaRow('user', card.creator);
	addMetaRow('calendar', card.year);
	addMetaRow('book', card.venue);
	if (card.readSeconds > 0 && card.readText) addMetaRow('clock', card.readText);
	el.appendChild(metaStack);

	if (opts.showBrief && card.briefNote) {
		const brief = galEl(doc, 'div');
		brief.className = 'zbf-gal-brief';
		brief.textContent = card.briefNote;
		el.appendChild(brief);
	}

	if (card.tags.length > 0) {
		const tagsRow = galEl(doc, 'div');
		tagsRow.className = 'zbf-gal-tags-row';
		tagsRow.appendChild(createGallerySvgIcon(doc, 'tag', 12));
		const maxShown = 2;
		for (const tag of card.tags.slice(0, maxShown)) {
			const pill = galEl(doc, 'span');
			pill.className = 'zbf-gal-tag-pill';
			const palette = resolvePastelTagStyle(tag);
			pill.style.background = `light-dark(${palette.bg}, ${palette.darkBg})`;
			pill.style.color = `light-dark(${palette.fg}, ${palette.darkFg})`;
			pill.textContent = tag;
			pill.title = tag;
			tagsRow.appendChild(pill);
		}
		if (card.tags.length > maxShown) {
			const more = galEl(doc, 'span');
			more.className = 'zbf-gal-tag-more';
			more.textContent = `+${card.tags.length - maxShown}`;
			tagsRow.appendChild(more);
		}
		el.appendChild(tagsRow);
	}

	el.addEventListener('click', (ev) => opts.onSelect(card, el, ev));
	el.addEventListener('dblclick', (ev) => opts.onOpenReader(card, ev));
	el.addEventListener('contextmenu', (ev) => {
		if (!opts.onContextMenu) return;
		ev.preventDefault();
		ev.stopPropagation();
		opts.onContextMenu(card, el, ev);
	});
	el.addEventListener('keydown', (ev) => {
		if (ev.key === 'Enter') {
			ev.preventDefault();
			opts.onOpenReader(card, ev);
			return;
		}
		if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) {
			ev.preventDefault();
			opts.onNavigateKey?.(card, ev.key, ev);
		}
	});
	return el;
}
