import { captureGalleryScroll } from '../src/domains/visual-notes/gallery-scroll.ts';
import test from 'node:test';
import assert from 'node:assert/strict';

import { StatusRatingColumnsController } from '../src/domains/visual-notes/status-rating-columns.ts';
import {
	captureBatchTargets,
	clearNativeStatusTagDots,
	clearStatusRatingCaches,
	getItemRating,
	getItemStatus,
	isStatusTagName,
	listAvailableStatuses,
	normalizeRatingStorage,
	parseCustomStatusInput,
	setItemRating,
	setItemStatus,
	syncNativeStatusTagDots,
} from '../src/services/item-status-rating.ts';
import {
	ItemRatingsDiskCache,
	setActiveRatingsCache,
} from '../src/services/item-ratings-cache.ts';
import {
	VISUAL_COLUMN_CSS,
	findPeakReadingPage,
	formatSubMinuteDuration,
	openItemPdfAtPage,
} from '../src/domains/visual-notes/column-popover-styles.ts';
import { loadCustomStatusColors, serializeCustomStatusColors } from '../src/services/status-tag-colors.ts';
import { STATUS_RATING_CSS } from '../src/domains/visual-notes/status-rating-popover.ts';
import { formatTitleHeatmapTooltip, TITLE_TAG_DOTS_HIDE_CSS } from '../src/domains/visual-notes/title-heatmap.ts';
import {
	collectHubAnnotations,
	collectHubNotes,
	formatHubAnnotationBody,
	isFigureOrTableAnnotation,
	renderCollectionHubMarkdown,
	stripNoteHtml,
} from '../src/services/collection-notes.ts';
import {
	applyKanbanColumnDrop,
	buildKanbanColumns,
	extractGalleryCards,
	filterAndSortGalleryCards,
} from '../src/domains/visual-notes/gallery-board-helpers.ts';
import {
	renderRichTitleNodes,
	resolvePastelTagStyle,
} from '../src/domains/visual-notes/gallery-icons.ts';
import { GALLERY_BOARD_CSS } from '../src/domains/visual-notes/gallery-styles.ts';
import { closeHubPage, openHubPage } from '../src/domains/visual-notes/hub-page.ts';
import { READING_LAYOUT_CSS } from '../src/domains/visual-notes/reading-layout.ts';
import { parseEnabledAnnotationColors, serializeEnabledAnnotationColors } from '../src/services/annotation-utils.ts';
import {
	computeMasonryColumnCount,
	GalleryHeightIndex,
	moveGalleryKeys,
} from '../src/domains/visual-notes/gallery-height-index.ts';
import {
	getGallerySourceSnapshot,
	createGalleryVisibilityGuard,
	sameGallerySourceSnapshot,
} from '../src/domains/visual-notes/gallery-pane-adapter.ts';
import {
	COVER_RENDER_SPEC,
	clearPdfCoverCache,
	computeCoverCacheEvictions,
	createGalleryScrollIdle,
	createGalleryWorkQueue,
} from '../src/services/pdf-cover-service.ts';

function createFakeRegularItem({
	id,
	libraryID = 1,
	title = `Paper #${id}`,
	creator = 'Lin',
	year = '2025',
	venue = 'Nature Water',
	itemType = 'journalArticle',
	extra = '',
	tags = [],
	notes = [],
	attachments = [],
}) {
	let currentExtra = extra;
	let version = 1;
	const tagSet = new Set(tags);
	return {
		id,
		libraryID,
		firstCreator: creator,
		itemType,
		dateModified: `2026-11-24 08:00:0${id % 9}`,
		get version() { return version; },
		isRegularItem: () => true,
		getField(field) {
			if (field === 'title') return title;
			if (field === 'year' || field === 'date') return year;
			if (field === 'publicationTitle') return venue;
			if (field === 'extra') return currentExtra;
			return '';
		},
		setField(field, val) {
			if (field === 'extra') {
				currentExtra = String(val || '');
				version++;
			}
		},
		getTags() {
			return [...tagSet].map((tag) => ({ tag }));
		},
		addTag(tag) {
			tagSet.add(tag);
			version++;
		},
		removeTag(tag) {
			tagSet.delete(tag);
			version++;
		},
		getNotes() {
			return notes;
		},
		getAttachments() {
			return attachments;
		},
		async saveTx() {
			version++;
			return id;
		},
	};
}

test('Phase 4.1: Status & Rating service handles /Citations exclusion, batch targets, and Extra/Tag storage switching', async () => {
	clearStatusRatingCaches();
	assert.equal(isStatusTagName('/精读', '/Citations'), true);
	assert.equal(isStatusTagName('/Citations', '/Citations'), false);

	const custom = parseCustomStatusInput('  /待复现  ', '#abc', '/Citations');
	assert.deepEqual(custom, { tag: '/待复现', label: '待复现', color: '#aabbcc' });

	const itemA = createFakeRegularItem({
		id: 101,
		tags: ['/Citations', '/待读'],
		extra: 'BriefNote: 关键通量模型\nDOI: 10.1000/test',
	});
	const itemB = createFakeRegularItem({ id: 102, tags: [] });

	assert.equal(getItemStatus(itemA, '/Citations')?.tag, '/待读');
	await setItemStatus(itemA, '/精读', { excludedTag: '/Citations' });
	assert.equal(getItemStatus(itemA, '/Citations')?.tag, '/精读');
	// Managed Word citation tag MUST remain untouched
	assert.ok(itemA.getTags().some((t) => t.tag === '/Citations'));
	assert.ok(!itemA.getTags().some((t) => t.tag === '/待读'));

	// Batch target resolution when clicked item is inside selection
	const batch = captureBatchTargets([itemA, itemB], itemA);
	assert.equal(batch.length, 2);

	// Rating in Extra preserves BriefNote & other fields
	await setItemRating(itemA, 4, 'extra');
	assert.equal(getItemRating(itemA, 'extra'), 4);
	assert.match(itemA.getField('extra'), /BriefNote: 关键通量模型/);
	assert.match(itemA.getField('extra'), /Rating: 4/);

	// Switching to star-tag storage cleans Rating: line from Extra and writes ⭐⭐⭐⭐⭐
	await setItemRating(itemA, 5, 'tag');
	assert.equal(getItemRating(itemA, 'tag'), 5);
	assert.ok(!/Rating:/i.test(itemA.getField('extra')));
	assert.ok(itemA.getTags().some((t) => t.tag === '⭐⭐⭐⭐⭐'));

	// Clearing rating removes star tag cleanly
	await setItemRating(itemA, 0, 'tag');
	assert.equal(getItemRating(itemA, 'tag'), 0);
	assert.ok(!itemA.getTags().some((t) => t.tag.includes('⭐')));

	const available = listAvailableStatuses([itemB, createFakeRegularItem({ id: 103, tags: ['/待复现'] })], true, '/Citations');
	assert.ok(available.some((s) => s.tag === '/待复现'));
});

test('Phase 4.2: Collection Notes & Annotations Hub aggregates child notes, brief notes, figure filters, and Markdown export', () => {
	const stripped = stripNoteHtml('<h1>研究结论</h1><p>蒸散发在干旱年显著下降 &amp; 水分利用效率上升。</p>');
	assert.equal(stripped.heading, '研究结论');
	assert.match(stripped.snippet, /蒸散发在干旱年显著下降 & 水分利用效率上升/);

	const prevZotero = globalThis.Zotero;
	const pdfAtt = {
		id: 501,
		isAttachment: () => true,
		isPDFAttachment: () => true,
		getAnnotations: () => [
			{
				id: 601,
				annotationColor: '#ff6666',
				annotationText: '采用涡度相关法连续观测十年',
				annotationComment: '核心方法优势',
				annotationPageLabel: '4',
				getTags: () => [{ tag: '方法' }],
			},
			{
				id: 602,
				annotationColor: '#2ea8e5',
				annotationText: '',
				annotationComment: 'Figure 2 通量季节变化',
				annotationPageLabel: '6',
				getTags: () => [{ tag: 'Figure 2' }],
			},
		],
	};
	const childNote = {
		id: 701,
		deleted: false,
		dateModified: '2026-11-24 09:00:00',
		getNote: () => '<p>子笔记：需要对比华北平原站点数据。</p>',
	};
	globalThis.Zotero = {
		Items: {
			get(id) {
				if (id === 501) return pdfAtt;
				if (id === 701) return childNote;
				return null;
			},
		},
	};

	try {
		const paper = createFakeRegularItem({
			id: 201,
			title: '淮河流域农田水热碳通量研究',
			creator: 'Zhang',
			year: '2026',
			notes: [701],
			attachments: [501],
		});

		const withFig = collectHubAnnotations([paper], '', { ignoreFigureTable: false });
		assert.equal(withFig.annotations.length, 2);
		assert.equal(isFigureOrTableAnnotation(withFig.annotations[1]), true);

		const noFig = collectHubAnnotations([paper], '', { ignoreFigureTable: true });
		assert.equal(noFig.annotations.length, 1);
		assert.equal(formatHubAnnotationBody(noFig.annotations[0], true), '[p.4] 核心方法优势');
		assert.match(formatHubAnnotationBody(noFig.annotations[0], false), /采用涡度相关法连续观测十年（评注：核心方法优势）/);

		const notesAgg = collectHubNotes([paper], () => '十年长序列通量基准文献', '华北平原 && 基准');
		assert.equal(notesAgg.entries.length, 1);
		assert.equal(notesAgg.totalBriefNotes, 1);
		assert.equal(notesAgg.totalChildNotes, 1);

		const md = renderCollectionHubMarkdown('测试分类汇总', notesAgg.entries, noFig.annotations, false);
		assert.match(md, /# 测试分类汇总/);
		assert.match(md, /十年长序列通量基准文献/);
		assert.match(md, /需要对比华北平原站点数据/);
		assert.match(md, /\*\*\[Method\]\*\* \[p\.4\] 采用涡度相关法连续观测十年/);
	} finally {
		globalThis.Zotero = prevZotero;
	}
});

test('Phase 4.3: Gallery & Multi-Dimensional Kanban Board extracts cards, groups 6 dimensions, and applies drag-drop mutations', async () => {
	clearStatusRatingCaches();
	const p1 = createFakeRegularItem({ id: 301, title: 'Alpha Paper', year: '2026', venue: 'Science', tags: ['/精读'], extra: 'Rating: 5' });
	const p2 = createFakeRegularItem({ id: 302, title: 'Beta Paper', year: '2024', venue: 'Nature', tags: [], extra: 'Rating: 3' });

	const fakeWin = {
		ZoteroPane: {
			itemsView: {
				rowCount: 2,
				getRow(idx) {
					return { ref: idx === 0 ? p1 : p2 };
				},
			},
		},
	};

	const { cards, rawItems } = extractGalleryCards(fakeWin, {
		excludedStatusTag: '/Citations',
		ratingStorage: 'extra',
		getBriefNote: (it) => (it.id === 301 ? '重点阅读' : ''),
		getReadProgress: (it) => (it.id === 301 ? { readSeconds: 900, lastPage: 8, totalPages: 10, updatedAt: 1 } : undefined),
	});
	assert.equal(cards.length, 2);

	const byRating = filterAndSortGalleryCards(cards, '', 'rating');
	assert.equal(byRating[0].itemID, 301);

	const statusCols = buildKanbanColumns(cards, rawItems, 'status', true, '/Citations');
	assert.ok(statusCols.find((c) => c.key === '/精读')?.cards.some((c) => c.itemID === 301));
	assert.ok(statusCols.find((c) => c.key === '__none__')?.cards.some((c) => c.itemID === 302));

	const readCols = buildKanbanColumns(cards, rawItems, 'readState', true, '/Citations');
	assert.ok(readCols.find((c) => c.key === 'deep')?.cards.some((c) => c.itemID === 301));
	assert.ok(readCols.find((c) => c.key === 'unread')?.cards.some((c) => c.itemID === 302));

	// Simulate dragging p2 onto '/核心' status column and '5' rating column
	const card2 = cards.find((c) => c.itemID === 302);
	const movedStatus = await applyKanbanColumnDrop(card2, 'status', '/核心', {
		excludedStatusTag: '/Citations',
		ratingStorage: 'extra',
		color: '#e11d48',
	});
	assert.equal(movedStatus, true);
	assert.equal(getItemStatus(p2, '/Citations')?.tag, '/核心');

	const movedRating = await applyKanbanColumnDrop(card2, 'rating', '5', {
		excludedStatusTag: '/Citations',
		ratingStorage: 'extra',
	});
	assert.equal(movedRating, true);
	assert.equal(getItemRating(p2, 'extra'), 5);
});

test('Phase 4.4: Rich academic title parser renders chemical <sub>/<sup>/<i> tags cleanly without raw markup', () => {
	const makeNode = (tag) => {
		const children = [];
		return {
			tag,
			children,
			_text: '',
			set textContent(v) { this._text = String(v || ''); children.length = 0; },
			get textContent() {
				return this._text + children.map((c) => c.textContent).join('');
			},
			appendChild(child) { children.push(child); return child; },
		};
	};
	const fakeDoc = {
		createTextNode(t) { return { tag: '#text', textContent: t }; },
		createElementNS(_ns, tag) { return makeNode(tag); },
	};
	const host = makeNode('div');
	renderRichTitleNodes(fakeDoc, host, 'Valley polarization in monolayer MoS<sub>2</sub> and <i>in situ</i> WSe<sub>2</sub>');
	assert.equal(host.textContent, 'Valley polarization in monolayer MoS2 and in situ WSe2');
	const subNodes = host.children.filter((c) => c.tag === 'sub');
	const iNodes = host.children.filter((c) => c.tag === 'i');
	assert.equal(subNodes.length, 2);
	assert.equal(subNodes[0].textContent, '2');
	assert.equal(iNodes.length, 1);
	assert.equal(iNodes[0].textContent, 'in situ');

	const pal = resolvePastelTagStyle('single crystal');
	assert.match(pal.bg, /^#[0-9a-f]{6}$/i);
	assert.match(pal.fg, /^#[0-9a-f]{6}$/i);
});

test('synchronous column registration survives sync and independent preference changes', () => {
	const previous = globalThis.Zotero;
	const columns = new Set();
	let statusEnabled = true;
	globalThis.Zotero = { ItemTreeManager: {
		registerColumn({ dataKey }) { columns.add(dataKey); return dataKey; },
		unregisterColumn(key) { columns.delete(key); },
	} };
	try {
		const controller = new StatusRatingColumnsController({
			info: { id: 'bridgeflow@groele' },
			prefs: { get: key => key === 'visualNotes.statusColumn.enable' ? statusEnabled : true },
		});
		controller.syncColumns();
		assert.deepEqual([...columns], ['bridgeflowStatus', 'bridgeflowRating']);
		statusEnabled = false;
		controller.syncColumns();
		assert.deepEqual([...columns], ['bridgeflowRating']);
		controller.unregisterAll();
		assert.equal(columns.size, 0);
	} finally { globalThis.Zotero = previous; }
});

test('Phase 4.5: Gallery cover frame sizing preserves portrait PDF ratio, smooth abstract fade, and kanban column linkage', () => {
	assert.ok(COVER_RENDER_SPEC.targetWidth >= 480, 'PDF cover render width should stay sharp on wide cards');
	assert.ok(COVER_RENDER_SPEC.aspectRatio >= 1.2, 'PDF cover crop ratio must be tall enough to prevent horizontal cropping in tall frames');
	assert.equal(COVER_RENDER_SPEC.cacheVersion, 'v3');
	assert.match(GALLERY_BOARD_CSS, /aspect-ratio:\s*var\(--zbf-cover-aspect,\s*1\.95\)/);
	assert.match(GALLERY_BOARD_CSS, /height:\s*var\(--zbf-cover-height,\s*auto\)/);
	assert.match(GALLERY_BOARD_CSS, /\.zbf-gal-col\s*\{[^}]*var\(--zbf-card-width/);
	assert.match(GALLERY_BOARD_CSS, /\.zbf-gal-cover-abstract\s*\{[^}]*mask-image:\s*linear-gradient/);
	assert.doesNotMatch(GALLERY_BOARD_CSS, /-webkit-line-clamp:\s*5/);
	assert.match(GALLERY_BOARD_CSS, /visibility:hidden !important/);
	assert.doesNotMatch(GALLERY_BOARD_CSS, /> :not\(#zbf-gallery-panel\)\s*\{\s*display:none/);
	assert.match(READING_LAYOUT_CSS, /\.zbf-reading-grid\s*\{[^}]*display:\s*flex/);
	assert.match(READING_LAYOUT_CSS, /\.zbf-masonry-col\s*\{[^}]*flex-direction:\s*column/);
	assert.match(READING_LAYOUT_CSS, /\.zbf-ann-badge\s*\{/);
	assert.match(GALLERY_BOARD_CSS, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
	assert.match(READING_LAYOUT_CSS, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('Phase 4.6: Robustness guards — enabled color palette parsing, idempotent hub lifecycle, and missing-host resilience', () => {
	const defSet = parseEnabledAnnotationColors('');
	assert.equal(defSet.size, 5);
	assert.equal(serializeEnabledAnnotationColors(defSet), '');

	const custom3 = parseEnabledAnnotationColors('#FFD400, #ff6666, invalid, #2ea8e5');
	assert.deepEqual([...custom3], ['#ffd400', '#ff6666', '#2ea8e5']);
	assert.equal(serializeEnabledAnnotationColors(custom3), '#ffd400,#ff6666,#2ea8e5');

	// Malformed / empty strings fall back cleanly to 5-color defaults
	assert.equal(parseEnabledAnnotationColors('not-a-hex, ???').size, 5);

	// Hub page gracefully handles missing Zotero_Tabs and idempotent double-close
	let closedTimes = 0;
	const fakeWinNoTabs = {};
	assert.doesNotThrow(() => openHubPage(fakeWinNoTabs, false, 'Hub', () => {}));
	const fakeWin = {
		Zotero_Tabs: {
			add(opts) {
				this._onClose = opts.onClose;
				return { id: 'hub-1', container: {} };
			},
			close() { closedTimes++; },
		},
	};
	let closeCb = null;
	openHubPage(fakeWin, false, 'Hub', (_c, close) => { closeCb = close; });
	closeCb();
	closeCb();
	closeHubPage(fakeWin);
	assert.equal(closedTimes, 1);
});

test('Phase 4.7: Dedicated item-ratings.json disk cache stores ratings without mutating Extra/tags and supports backup, reload, legacy fallback, and clear', async () => {
	clearStatusRatingCaches();
	assert.equal(normalizeRatingStorage('cache'), 'cache');
	assert.equal(normalizeRatingStorage('extra'), 'extra');
	assert.equal(normalizeRatingStorage('tag'), 'tag');
	assert.equal(normalizeRatingStorage('unknown'), 'cache');

	const prevIOUtils = globalThis.IOUtils;
	const prevZotero = globalThis.Zotero;
	const files = new Map();
	const dirs = new Set();

	globalThis.IOUtils = {
		async makeDirectory(dir) { dirs.add(dir); },
		async exists(p) { return files.has(p); },
		async readUTF8(p) { return files.get(p) ?? ''; },
		async writeUTF8(p, content) { files.set(p, String(content)); },
	};
	globalThis.Zotero = {
		DataDirectory: { dir: '/mock-zotero-data' },
	};

	const cache = new ItemRatingsDiskCache();
	setActiveRatingsCache(cache);
	try {
		// The cache is created when the first rating is recorded.
		await cache.init();
		const mainPath = cache.getFilePath();
		const bakPath = cache.getBackupFilePath();
		assert.match(mainPath, /bridgeflow-cache[\\/]ratings[\\/]item-ratings\.json$/);
		assert.ok(!files.has(mainPath), 'an empty ratings cache should not write at startup');

		let saveTxCalls = 0;
		const cleanItem = createFakeRegularItem({ id: 901, extra: 'DOI: 10.1000/clean' });
		cleanItem.key = 'ABCD1234';
		const origSave = cleanItem.saveTx;
		cleanItem.saveTx = async () => { saveTxCalls++; return origSave(); };

		// Write one revision so the next save can preserve its previous state.
		cache.setRating(cleanItem, 3);
		await cache.flushNow();
		// Writing a 4-star rating in cache mode leaves Extra & tags completely untouched
		const changed = await setItemRating(cleanItem, 4, 'cache');
		assert.equal(changed, true);
		await cache.flushNow();
		assert.equal(saveTxCalls, 0, 'cache mode must not call item.saveTx()');
		assert.equal(cleanItem.getField('extra'), 'DOI: 10.1000/clean');
		assert.equal(cleanItem.getTags().length, 0);
		assert.equal(getItemRating(cleanItem, 'cache'), 4);
		assert.ok(files.has(bakPath), 'second write should rotate previous state to item-ratings.bak.json');

		const parsedDisk = JSON.parse(files.get(mainPath));
		assert.equal(parsedDisk.format, 'zotero-bridgeflow-item-ratings');
		assert.equal(parsedDisk.version, 1);
		assert.equal(parsedDisk.ratings['1:ABCD1234'], 4);

		// Reload in a fresh cache instance recovers persisted rating from disk
		const reloaded = new ItemRatingsDiskCache();
		setActiveRatingsCache(reloaded);
		await reloaded.init();
		assert.equal(getItemRating(cleanItem, 'cache'), 4);
		assert.equal(reloaded.getCount(), 1);

		// Legacy Extra rating falls back cleanly when uncached, can be overridden/cleared in cache without mutating Extra
		const legacyItem = createFakeRegularItem({ id: 902, extra: 'Rating: 5\nDOI: 10.1000/legacy' });
		legacyItem.key = 'LEGACY99';
		assert.equal(getItemRating(legacyItem, 'cache'), 5);
		await setItemRating(legacyItem, 0, 'cache');
		assert.equal(getItemRating(legacyItem, 'cache'), 0);
		assert.equal(legacyItem.getField('extra'), 'Rating: 5\nDOI: 10.1000/legacy');

		// Export & Clear
		const exported = JSON.parse(reloaded.exportJson());
		assert.equal(exported.ratings['1:ABCD1234'], 4);
		reloaded.clearAll(false);
		await reloaded.flushNow();
		assert.equal(reloaded.getCount(), 0);
		assert.equal(getItemRating(cleanItem, 'cache'), 0);
	} finally {
		cache.dispose();
		setActiveRatingsCache(new ItemRatingsDiskCache());
		clearStatusRatingCaches();
		globalThis.IOUtils = prevIOUtils;
		globalThis.Zotero = prevZotero;
	}
});

test('Phase 4.8: Interactive visual columns — cumulative star hover CSS, selected-row contrast, peak-page helpers, and title heatmap tooltip', () => {
	assert.equal(formatSubMinuteDuration(0), '');
	assert.equal(formatSubMinuteDuration(42), '42s');
	assert.equal(formatSubMinuteDuration(185), '3m');

	const peak = findPeakReadingPage({ readSeconds: 500, lastPage: 8, totalPages: 12, pageSeconds: { '2': 60, '6': 240, '8': 110 } });
	assert.deepEqual(peak, { page: 6, seconds: 240 });

	const tipZh = formatTitleHeatmapTooltip('Monolayer MoS2', { readSeconds: 420, lastPage: 8, totalPages: 12, pageSeconds: { '6': 180 } }, true);
	assert.match(tipZh, /Monolayer MoS2/);
	assert.match(tipZh, /阅读热图：7m · p\.8\/12 · 峰值 p\.6 \(3m\)/);

	const tipEn = formatTitleHeatmapTooltip('Monolayer MoS2', { readSeconds: 45, lastPage: 2, totalPages: 10, pageSeconds: { '2': 45 } }, false);
	assert.match(tipEn, /Reading Heatmap: 45s · p\.2\/10 · Peak p\.2 \(45s\)/);

	// Cumulative 1..5 star hover preview + selected-row contrast + reduced motion
	assert.match(STATUS_RATING_CSS, /\.zbf-rating-stars\[data-hover="5"\]/);
	assert.match(STATUS_RATING_CSS, /\.zbf-rating-stars\[data-clear-hint="true"\]/);
	assert.match(STATUS_RATING_CSS, /\.row\.selected \.zbf-status-pill/);
	assert.match(STATUS_RATING_CSS, /\.row\.selected \.zbf-rating-star\[data-lit="true"\]/);
	assert.match(STATUS_RATING_CSS, /\.zbf-status-pop-swatch/);
	assert.match(VISUAL_COLUMN_CSS, /\.zbf-read-bar-fill/);
	assert.match(VISUAL_COLUMN_CSS, /\.zbf-ann-stack/);
	assert.match(VISUAL_COLUMN_CSS, /\.zbf-vc-heatbars/);
	assert.match(VISUAL_COLUMN_CSS, /container-type:\s*inline-size/);
	assert.match(VISUAL_COLUMN_CSS, /@container\s+zbf-cell\s*\(min-width:\s*164px\)/);
	assert.match(STATUS_RATING_CSS, /@container\s+zbf-sr\s*\(min-width:\s*96px\)/);
	assert.ok(!STATUS_RATING_CSS.includes('.zbf-rating-score'), 'numeric 5/5 score must not be shown');
	assert.match(VISUAL_COLUMN_CSS, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
	assert.match(GALLERY_BOARD_CSS, /\.zbf-gal-rate-float\[data-hover="5"\]/);
	assert.match(GALLERY_BOARD_CSS, /\.zbf-gal-masonry-col/);
	assert.match(GALLERY_BOARD_CSS, /\.zbf-gal-virtual-spacer/);
	assert.match(TITLE_TAG_DOTS_HIDE_CSS, /\.colored-tag-swatches\s*\{\s*display:\s*none\s*!important/);
	assert.equal(typeof clearPdfCoverCache, 'function');
});

test('Phase 4.9: PDF page jump navigation, annotation-only Hub Markdown synthesis, and Zotero native status tag dot purge/toggle', async () => {
	const prevZotero = globalThis.Zotero;
	loadCustomStatusColors('');
	try {
		const navCalls = [];
		let selectedTab = '';
		const tagColorMap = new Map([
			['/unread', { color: '#64748b', position: 0 }],
			['/待复现', { color: '#7c3aed', position: 1 }],
			['/Citations', { color: '#2563eb', position: 2 }],
			['Important', { color: '#ef4444', position: 3 }],
		]);
		let invalidated = 0;

		const annObj = { id: 8801, key: 'ANNKEY88' };
		const pdfAtt = { id: 7701, deleted: false, isPDFAttachment: () => true };
		const parentItem = {
			id: 6601,
			libraryID: 1,
			isRegularItem: () => true,
			getBestAttachment: async () => pdfAtt,
			getAttachments: () => [7701],
		};

		globalThis.Zotero = {
			Libraries: { userLibraryID: 1, getAll: () => [{ libraryID: 1 }] },
			Items: {
				get(id) {
					if (id === 8801) return annObj;
					if (id === 6601) return parentItem;
					return undefined; // Simulate unloaded child attachment requiring async getBestAttachment()
				},
				async getAsync(id) {
					if (id === 7701) return pdfAtt;
					if (id === 6601) return parentItem;
					return null;
				},
			},
			Reader: {
				async open(attID, loc, opts) {
					navCalls.push({ stage: 'open', attID, loc, opts });
					return {
						tabID: 'reader-tab-7701',
						async _waitForReader() { navCalls.push({ stage: 'ready' }); },
						navigate(targetLoc) { navCalls.push({ stage: 'navigate', targetLoc }); },
					};
				},
			},
			Tags: {
				getColors() { return tagColorMap; },
				getColor(_libID, name) { return tagColorMap.get(name) || false; },
				async setColor(_libID, name, color) {
					if (!color) tagColorMap.delete(name);
					else tagColorMap.set(name, { color, position: tagColorMap.size });
				},
			},
			getMainWindow: () => ({
				Zotero_Tabs: { select(id) { selectedTab = id; } },
				ZoteroPane: { itemsView: { rowCount: 0, tree: { invalidate() { invalidated++; } } } },
			}),
			getMainWindows: () => [{
				ZoteroPane: {
					itemsView: {
						rowCount: 1,
						getRow: () => ({ ref: createFakeRegularItem({ id: 950, tags: ['/待复现'] }) }),
						tree: { invalidate() { invalidated++; } },
					},
				},
			}],
		};

		// 1. PDF jump converts 1-based pageNumber=3 -> 0-based pageIndex=2 and resolves annotation item.key
		const jumped = await openItemPdfAtPage(parentItem, 3, 8801);
		assert.equal(jumped, true);
		assert.equal(selectedTab, 'reader-tab-7701');
		assert.deepEqual(navCalls.map((c) => c.stage), ['open', 'ready', 'navigate']);
		assert.deepEqual(navCalls[0].loc, { pageIndex: 2, annotationID: 'ANNKEY88' });
		assert.deepEqual(navCalls[2].targetLoc, { pageIndex: 2, annotationID: 'ANNKEY88' });

		// 2. Hub Markdown synthesis preserves annotations even when notes array is empty
		const md = renderCollectionHubMarkdown('01_Triage', [], [{
			annotationID: 8801,
			itemID: 6601,
			itemTitle: 'Giant trion modulation in monolayer MoS2',
			creatorYear: 'Lin · 2025',
			color: '#ffd400',
			colorLabel: 'Finding',
			text: 'Exciton binding energy reaches 320 meV.',
			comment: '关键实验观测',
			pageLabel: '3',
			sortIndex: '00003|00000',
			tags: [],
		}]);
		assert.match(md, /Giant trion modulation in monolayer MoS2/);
		assert.match(md, /Exciton binding energy reaches 320 meV\./);
		assert.match(md, /关键实验观测/);

		// 3. Purging native status tag dots removes /unread & /待复现 from Zotero.Tags, backs up custom color, and preserves /Citations & Important
		const purged = await clearNativeStatusTagDots('/Citations');
		assert.equal(purged, 2);
		assert.equal(tagColorMap.has('/unread'), false);
		assert.equal(tagColorMap.has('/待复现'), false);
		assert.equal(tagColorMap.has('/Citations'), true);
		assert.equal(tagColorMap.has('Important'), true);
		assert.ok(invalidated > 0);
		assert.match(serializeCustomStatusColors(), /#7c3aed/);

		const customItem = createFakeRegularItem({ id: 951, tags: ['/待复现'] });
		assert.equal(getItemStatus(customItem, '/Citations')?.color, '#7c3aed');

		// 4. Default setItemStatus does NOT register Zotero colored tag dot; opting in with syncZoteroTagColor=true does
		const statusTarget = createFakeRegularItem({ id: 952, tags: [] });
		await setItemStatus(statusTarget, '/精读', { color: '#0d9488', excludedTag: '/Citations', syncZoteroTagColor: false });
		assert.equal(tagColorMap.has('/精读'), false);
		await setItemStatus(statusTarget, '/精读', { color: '#0d9488', excludedTag: '/Citations', syncZoteroTagColor: true });
		assert.equal(tagColorMap.get('/精读')?.color, '#0d9488');

		// 5. Restoring status tag dots when user enables switch re-applies color for visible status tags
		await clearNativeStatusTagDots('/Citations');
		assert.equal(tagColorMap.has('/待复现'), false);
		const restored = await syncNativeStatusTagDots(true, '/Citations');
		assert.equal(restored, 1);
		assert.equal(tagColorMap.get('/待复现')?.color, '#7c3aed');
	} finally {
		loadCustomStatusColors('');
		clearStatusRatingCaches();
		globalThis.Zotero = prevZotero;
	}
});

test('Phase 4.10: Gallery Fenwick virtualization, priority cover work queue, visibility guard, and 1-click rating without numeric score', async () => {
	// 1. Fenwick GalleryHeightIndex prefix offsets, dynamic measurement, and binary search range
	const idx = new GalleryHeightIndex(5, 200, 10);
	assert.equal(idx.offset(0), 0);
	assert.equal(idx.offset(2), 420);
	assert.equal(idx.total, 5 * 210 - 10);
	assert.equal(idx.measure(1, 300), true);
	assert.equal(idx.offset(2), 520);
	assert.deepEqual(idx.range(220, 600), [1, 3]);
	assert.equal(computeMasonryColumnCount(960, 220, 12), 4);
	assert.deepEqual(moveGalleryKeys(['a', 'b', 'c', 'd'], ['c'], 'a'), ['c', 'a', 'b', 'd']);

	// 2. Priority cover queue executes highest viewport priority next & aborts cleanly
	const idle = createGalleryScrollIdle(10);
	const queue = createGalleryWorkQueue((s) => idle.wait(s), 1);
	const executed = [];
	const abortMid = new AbortController();
	let releaseFirst;
	const firstGate = new Promise((r) => { releaseFirst = r; });

	const p1 = queue(async () => { executed.push('first'); await firstGate; return 1; }, new AbortController().signal, () => 1);
	const pLow = queue(async () => { executed.push('low'); return 2; }, new AbortController().signal, () => 10);
	const pCancelled = queue(async () => { executed.push('cancelled'); return 3; }, abortMid.signal, () => 999);
	const pHigh = queue(async () => { executed.push('high'); return 4; }, new AbortController().signal, () => 500);
	abortMid.abort();
	releaseFirst();
	const results = await Promise.all([p1, pLow, pCancelled, pHigh]);
	assert.deepEqual(results, [1, 2, undefined, 4]);
	assert.deepEqual(executed, ['high', 'low', 'first']);
	idle.destroy();

	// 3. Cover disk cache retention evicts legacy cover-v2-*.txt and stale .tmp files while keeping fresh JSON envelopes
	const now = 1_700_000_000_000;
	const evicted = computeCoverCacheEvictions([
		{ path: '/covers/cover-v2-101.txt', size: 1000, modified: now, legacy: true },
		{ path: '/covers/1-ABC-480.json.xyz.tmp', size: 500, modified: now - 48 * 3600 * 1000, temporary: true },
		{ path: '/covers/1-ABC-480.json', size: 40_000, modified: now - 1000 },
	], now);
	assert.deepEqual(evicted.map((e) => e.path), ['/covers/cover-v2-101.txt', '/covers/1-ABC-480.json.xyz.tmp']);

	// 4. Source snapshot equality & mutual-exclusion visibility guard
	assert.equal(sameGallerySourceSnapshot({ context: 'c1', ids: [1, 2] }, { context: 'c1', ids: [1, 2] }), true);
	assert.equal(sameGallerySourceSnapshot({ context: 'c1', ids: [1, 2] }, { context: 'c1', ids: [2, 1] }), false);

	const makeStyle = () => {
		const map = new Map();
		return {
			getPropertyValue: (k) => map.get(k)?.[0] || '',
			getPropertyPriority: (k) => map.get(k)?.[1] || '',
			setProperty: (k, v, p = '') => map.set(k, [v, p]),
			removeProperty: (k) => map.delete(k),
		};
	};
	const mkElem = (id) => {
		const attrs = new Map();
		return {
			id,
			style: makeStyle(),
			children: [],
			contains(other) { return other === this; },
			querySelectorAll: () => [],
			getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
			setAttribute: (k, v) => attrs.set(k, String(v)),
			removeAttribute: (k) => attrs.delete(k),
		};
	};
	const treeNode = mkElem('zotero-items-tree');
	const galPanel = mkElem('zbf-gallery-panel');
	const itemsPane = mkElem('zotero-items-pane');
	itemsPane.children = [galPanel, treeNode];
	const guard = createGalleryVisibilityGuard({}, itemsPane, galPanel);
	guard.setEnabled(true);
	assert.equal(itemsPane.getAttribute('data-zbf-gallery'), 'true');
	assert.equal(galPanel.style.getPropertyValue('display'), 'flex');
	assert.equal(treeNode.style.getPropertyValue('visibility'), 'hidden');
	assert.equal(treeNode.getAttribute('inert'), '');
	guard.setEnabled(false);
	assert.equal(itemsPane.getAttribute('data-zbf-gallery'), null);
	assert.equal(galPanel.style.getPropertyValue('display'), 'none');
	assert.equal(treeNode.style.getPropertyValue('visibility'), '');
	assert.equal(treeNode.getAttribute('inert'), null);
	guard.destroy();
});

test('a board refresh restores horizontal position and surviving columns by key', () => {
	const column = (key, offset) => {
		const body = { scrollTop: offset };
		return { dataset: { colKey: key }, querySelector: () => body };
	};
	const viewport = (left, columns) => {
		const board = { scrollLeft: left };
		return { scrollTop: 0, scrollLeft: 0, querySelector: () => board, querySelectorAll: () => columns };
	};
	const old = viewport(325, [column('A', 540), column('removed', 90)]);
	const restore = captureGalleryScroll({ querySelector: () => old });
	const fresh = viewport(0, [column('new', 0), column('A', 0)]);
	assert.equal(restore(fresh), true);
	assert.equal(fresh.querySelector().scrollLeft, 325);
	assert.deepEqual(fresh.querySelectorAll().map(c => c.querySelector().scrollTop), [0, 540]);
});

test('gallery collection snapshots and cards include changes past row 5000', () => {
	const rows = Array.from({ length: 5105 }, (_, n) => ({ id: n + 1, isRegularItem: () => true }));
	const win = { ZoteroPane: { itemsView: { rowCount: rows.length, getRow: i => ({ ref: rows[i] }) } } };
	const before = getGallerySourceSnapshot(win);
	const { cards } = extractGalleryCards(win, { zh: false, getBriefNote: () => '', getReadProgress: () => undefined });
	assert.equal(cards.length, rows.length);
	assert.equal(cards.at(-1).itemID, 5105);
	rows[5104] = { id: 6100, isRegularItem: () => true };
	assert.equal(sameGallerySourceSnapshot(before, getGallerySourceSnapshot(win)), false);
});
