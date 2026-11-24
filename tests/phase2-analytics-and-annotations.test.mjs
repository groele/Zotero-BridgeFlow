import test from 'node:test';
import assert from 'node:assert/strict';

import { WorkspaceStateStore } from '../src/domains/workspace/state-store.ts';
import { buildReadingHeatmapBuckets } from '../src/services/reading-stats.ts';
import { ReadingColumnsController } from '../src/domains/visual-notes/library-columns.ts';
import {
	applyTitleHeatmapToCell,
	buildTitleHeatmapGradient,
	clearTitleHeatmapFromCell,
	TitleHeatmapController,
} from '../src/domains/visual-notes/title-heatmap.ts';
import { ReaderAnnotationTools } from '../src/domains/visual-notes/annotation-tools.ts';
import { decorateSelectionPopupDoc } from '../src/domains/visual-notes/annotation-popup-labels.ts';
import { trackActiveReaderProgress } from '../src/domains/workspace/tab-actions-helpers.ts';
import { WorkspaceDiskCache } from '../src/domains/workspace/workspace-disk-cache.ts';
import { readWorkspace } from '../src/domains/workspace/workspace-schema.ts';
import { CitationHistoryStore } from '../src/services/citation-history-store.ts';
import { NativeRuntime } from '../src/kernel/native-runtime.ts';
import {
	collectItemAnnotations,
	mergeAnnotationsByIDs,
	parseColorSemantics,
} from '../src/services/annotation-utils.ts';
import { UnifiedPrefService } from '../src/kernel/pref-service.ts';

function createMemoryPrefs(initial = {}) {
	const map = new Map(Object.entries(initial));
	const adapter = {
		get(key) { return map.get(key); },
		set(key, val) { map.set(key, val); },
		clear(key) { map.delete(key); },
		registerObserver() { return 'obs-1'; },
		unregisterObserver() {},
	};
	return { adapter, prefs: new UnifiedPrefService(adapter) };
}

test('Phase 2.1: page-level reading progress accumulates pageSeconds and builds normalized heatmap', () => {
	const { prefs } = createMemoryPrefs();
	const store = new WorkspaceStateStore(prefs);
	store.updateReadingProgress('item:10', 30, 1, 8);
	store.updateReadingProgress('item:10', 60, 4, 8);
	store.updateReadingProgress('item:10', 30, 4, 8);
	store.updateReadingProgress('item:10', 45, 8, 8);

	const prog = store.state.readingProgress['item:10'];
	assert.equal(prog.readSeconds, 165);
	assert.deepEqual(prog.pageSeconds, { '1': 30, '4': 90, '8': 45 });

	const heat = buildReadingHeatmapBuckets(prog, 8);
	assert.equal(heat.length, 8);
	assert.equal(heat[3], 1); // page 4 is peak (90s)
	assert.ok(heat[0] > 0 && heat[0] < 0.5);
	assert.equal(heat[7], 0.5);

	const parsed = readWorkspace(JSON.stringify(store.state));
	assert.deepEqual(parsed.readingProgress['item:10'].pageSeconds, { '1': 30, '4': 90, '8': 45 });
});

test('Phase 2.1: ReadingColumnsController formats read time and annotation color distribution', () => {
	const { prefs } = createMemoryPrefs({
		'workspace.readingColumn.enable': true,
		'workspace.annotationColumn.enable': true,
	});
	const store = new WorkspaceStateStore(prefs);
	store.updateReadingProgress('item:201', 180, 3, 10);

	const fakeAtt = {
		id: 201,
		deleted: false,
		getAnnotations: () => [
			{ id: 1, deleted: false, annotationColor: '#ff6666', annotationText: 'Method A', annotationComment: '', annotationPageLabel: '2' },
			{ id: 2, deleted: false, annotationColor: '#ff6666', annotationText: 'Method B', annotationComment: '', annotationPageLabel: '3' },
			{ id: 3, deleted: false, annotationColor: '#2ea8e5', annotationText: 'Novelty', annotationComment: '', annotationPageLabel: '1' },
		],
	};
	const parentItem = {
		id: 200,
		deleted: false,
		firstCreator: 'Alice',
		getField: (f) => (f === 'title' ? 'Sample' : f === 'year' ? '2026' : ''),
		getAttachments: () => [201],
	};
	globalThis.Zotero = { Items: { get: (id) => (id === 201 ? fakeAtt : id === 200 ? parentItem : null) }, locale: 'zh-CN' };

	const cols = new ReadingColumnsController({ prefs, info: { id: 'bridgeflow@test' } }, store);
	assert.equal(cols.getReadTimeDisplay(parentItem), '3m · p.3/10');
	assert.equal(cols.getAnnotationSummaryDisplay(parentItem), '3 (Method:2 Finding:1)');

	const semantics = parseColorSemantics('{"#ff6666":"核心方法"}');
	const collected = collectItemAnnotations([parentItem], semantics);
	assert.equal(collected.length, 3);
	assert.equal(collected[0].colorLabel, 'Finding'); // page 1 sorts before page 2
	assert.equal(collected[1].colorLabel, '核心方法');
	delete globalThis.Zotero;
});

test('Phase 2.2: mergeAnnotationsByIDs joins hyphenated text, deduplicates comments, and trashes secondary items', async () => {
	const a1 = {
		id: 901,
		parentID: 55,
		deleted: false,
		isAnnotation: () => true,
		annotationSortIndex: '00001|00010|00001',
		annotationPageLabel: '2',
		annotationText: 'cross-page hyphen-',
		annotationComment: '重要结论',
		annotationPosition: JSON.stringify({ pageIndex: 1, rects: [[1, 2, 3, 4]] }),
		saveTx: async () => { a1.saved = true; },
	};
	const a2 = {
		id: 902,
		parentID: 55,
		deleted: false,
		isAnnotation: () => true,
		annotationSortIndex: '00002|00001|00001',
		annotationPageLabel: '3',
		annotationText: 'ated paragraph.',
		annotationComment: '补充说明',
		annotationPosition: JSON.stringify({ pageIndex: 2, rects: [[5, 6, 7, 8]] }),
		saveTx: async () => {},
	};
	const trashed = [];
	globalThis.Zotero = {
		Items: {
			get: (id) => (id === 901 ? a1 : id === 902 ? a2 : null),
			trashTx: async (ids) => { trashed.push(...ids); },
		},
	};

	const res = await mergeAnnotationsByIDs([902, 901]);
	assert.equal(res.ok, true);
	assert.equal(res.keptID, 901);
	assert.equal(res.removedCount, 1);
	assert.equal(a1.annotationText, 'cross-page hyphenated paragraph.');
	assert.equal(a1.annotationComment, '重要结论\n补充说明');
	assert.deepEqual(trashed, [902]);

	// Context menu integration check
	const listeners = [];
	globalThis.Zotero.Reader = {
		registerEventListener(name, fn) { listeners.push({ name, fn }); },
		unregisterEventListener() {},
	};
	globalThis.Zotero.locale = 'zh-CN';
	const { prefs } = createMemoryPrefs({ 'inspector.annotations.mergeEnable': true });
	const tools = new ReaderAnnotationTools({ prefs, info: { id: 'bridgeflow@test' } });
	tools.register();
	assert.equal(listeners.length, 1);
	const appended = [];
	listeners[0].fn({ params: { ids: [901, 902] }, append: (item) => appended.push(item) });
	assert.equal(appended.length, 1);
	assert.match(appended[0].label, /合并选中的 2 条标注/);
	tools.unregister();
	delete globalThis.Zotero;
});

test('Phase 2.3: Zotero 10 reader page tracking, disk cache merge & title heatmap overlay', async () => {
	const { prefs } = createMemoryPrefs({
		'modules.workspace.enable': true,
		'modules.visualNotes.enable': true,
		'workspace.readingTitleHeatmap.enable': true,
	});
	const store = new WorkspaceStateStore(prefs);
	const mockWin = {
		document: { hasFocus: () => true },
		Zotero_Tabs: { selectedID: 'tab-z10' },
	};
	globalThis.Zotero = {
		Reader: {
			getByTabID: (id) => (id === 'tab-z10' ? {
				_internalReader: {
					_state: { primaryViewStats: { pageIndex: 2, pagesCount: 16 } },
					_primaryView: { _iframeWindow: {} },
				},
			} : null),
		},
	};
	const tracked = [{ tabID: 'tab-z10', key: 'item:501', type: 'reader', virtual: false }];
	assert.equal(trackActiveReaderProgress(mockWin, store, tracked, 15), true);
	assert.equal(trackActiveReaderProgress(mockWin, store, tracked, 15), true);
	assert.deepEqual(store.state.readingProgress['item:501'], {
		readSeconds: 30,
		lastPage: 3,
		totalPages: 16,
		pageSeconds: { '3': 30 },
	});

	// Disk cache merges readingProgress & pageSeconds durably
	const diskCache = new WorkspaceDiskCache('');
	const restoredStore = new WorkspaceStateStore(createMemoryPrefs().prefs);
	assert.equal(diskCache.mergeDurableState(restoredStore.state, store.state), true);
	assert.deepEqual(restoredStore.state.readingProgress['item:501'].pageSeconds, { '3': 30 });

	// Gradient & TitleHeatmapController with custom color & opacity
	const grad = buildTitleHeatmapGradient(store.state.readingProgress['item:501'], {
		color: '#ef4444',
		opacityPercent: 60,
	});
	assert.match(grad, /^linear-gradient\(to right,/);
	assert.match(grad, /239, 68, 68/);
	assert.match(grad, /0\.600/);

	// Array-pair color semantics & PDF Reader selection popup decoration (hides duplicate unlabeled swatches cleanly)
	const arrSem = parseColorSemantics('[["Background","#ffd400"],["Method","#ff6666"]]');
	assert.equal(arrSem['#ffd400'], 'Background');
	assert.equal(arrSem['#ff6666'], 'Method');
	const makePopupBtn = (hex, parent, selected = false) => {
		const attrs = new Map();
		const btn = {
			parentElement: parent,
			attrs,
			children: [],
			classList: { contains: (c) => selected && c === 'active' },
			querySelector: (sel) => {
				if (sel.includes('fill')) return { getAttribute: () => hex };
				if (sel.includes('zbf-popup-color-name')) return btn.children[0] || null;
				return null;
			},
			appendChild(node) { this.children.push(node); },
			setAttribute(k, v) { attrs.set(k, v); },
			getAttribute(k) { return attrs.get(k) ?? null; },
			removeAttribute(k) { attrs.delete(k); },
			hasAttribute(k) { return attrs.has(k); },
		};
		return btn;
	};
	const groupEl = {};
	const defSem = parseColorSemantics('');
	const popupBtns = [
		makePopupBtn('#ffd400', groupEl),
		makePopupBtn('#ff6666', groupEl),
		makePopupBtn('#5fb236', groupEl),
		makePopupBtn('#2ea8e5', groupEl),
		makePopupBtn('#a28ae5', groupEl),
		makePopupBtn('#e56eee', groupEl),
		makePopupBtn('#f19837', groupEl),
		makePopupBtn('#aaaaaa', groupEl),
	];
	const fakeReaderDoc = {
		querySelectorAll: (sel) => (sel.includes('.color-button') ? popupBtns : []),
		createElementNS: (_ns, tag) => ({ tagName: tag, className: '', textContent: '', remove() {} }),
	};
	assert.equal(decorateSelectionPopupDoc(fakeReaderDoc, defSem), 5);
	assert.deepEqual(
		popupBtns.filter((b) => b.getAttribute('data-zbf-dedup-hidden') !== 'true').map((b) => b.children[0]?.textContent),
		['Context', 'Method', 'Gap', 'Finding', 'Evidence'],
	);
	assert.equal(popupBtns[4].getAttribute('data-zbf-dedup-hidden'), null);
	assert.equal(popupBtns[5].getAttribute('data-zbf-dedup-hidden'), 'true');
	assert.equal(popupBtns[6].getAttribute('data-zbf-dedup-hidden'), 'true');
	assert.equal(popupBtns[7].getAttribute('data-zbf-dedup-hidden'), 'true');
	// Switching user enabled palette to 3 colors or 8 colors updates popup cleanly
	assert.equal(decorateSelectionPopupDoc(fakeReaderDoc, defSem, new Set(['#ffd400', '#ff6666', '#2ea8e5'])), 3);
	assert.equal(decorateSelectionPopupDoc(fakeReaderDoc, defSem, new Set(Object.keys(defSem))), 8);
	// Active disabled swatch stays visible with its label on existing annotations
	const activeExtraBtn = makePopupBtn('#e56eee', {}, true);
	assert.equal(decorateSelectionPopupDoc({
		querySelectorAll: (sel) => (sel.includes('.color-button') ? [makePopupBtn('#2ea8e5', activeExtraBtn.parentElement), activeExtraBtn] : []),
		createElementNS: (_ns, tag) => ({ tagName: tag, className: '', textContent: '', remove() {} }),
	}, defSem), 2);
	assert.equal(activeExtraBtn.getAttribute('data-zbf-dedup-hidden'), null);
	assert.equal(activeExtraBtn.children[0]?.textContent, 'Quote');

	// Pretty-printed multi-line JSON formatting for workspace & citation caches
	const writtenJson = {};
	const prevIO = globalThis.IOUtils;
	globalThis.IOUtils = {
		makeDirectory: async () => {},
		writeUTF8: async (p, content) => { writtenJson[p] = content; },
	};
	await diskCache.flushNow(store.state);
	assert.equal(JSON.parse(writtenJson[diskCache.getFilePath()]).format, 'zotero-bridgeflow-workspace');
	const hist = new CitationHistoryStore();
	hist.record({ text: 'Doe 2026', libraryID: 1, itemKey: 'K1', itemID: 1, title: 'T', style: 'apa' });
	await hist.retrySave();
	assert.equal(JSON.parse(writtenJson[hist.getFilePath()]).version, 1);
	globalThis.IOUtils = prevIO;

	const makeCell = (withText = true) => {
		const attrs = new Map();
		const textEl = {
			style: {
				backgroundImage: '',
				removeProperty(name) { if (name === 'background-image') this.backgroundImage = ''; },
			},
			classList: { contains: (cls) => cls === 'cell-text' },
			setAttribute(k, v) { attrs.set(k, v); },
			getAttribute(k) { return attrs.get(k) ?? null; },
			removeAttribute(k) { attrs.delete(k); },
		};
		return {
			textEl,
			classList: { contains: () => false },
			querySelector: (sel) => (withText && sel === '.cell-text' ? textEl : null),
		};
	};

	const cell = makeCell();
	assert.equal(applyTitleHeatmapToCell(cell, store.state.readingProgress['item:501']), true);
	assert.equal(cell.textEl.getAttribute('data-zbf-heatmap'), '1');
	assert.match(cell.textEl.style.backgroundImage, /linear-gradient/);
	clearTitleHeatmapFromCell(cell);
	assert.equal(cell.textEl.getAttribute('data-zbf-heatmap'), null);
	assert.equal(cell.textEl.style.backgroundImage, '');

	// Controller patches itemsView._renderCell, injects heatmap on title cell, and restores cleanly
	let invalidations = 0;
	const origRenderCell = () => makeCell();
	const itemsView = {
		_renderCell: origRenderCell,
		getRow: (idx) => (idx === 0 ? { isItem: true, ref: { id: 501, deleted: false } } : { isItem: false }),
		tree: { invalidate: () => { invalidations++; } },
	};
	const fakeWin = { closed: false, ZoteroPane: { itemsView } };
	const runtime = new NativeRuntime();
	const ctrl = new TitleHeatmapController({ prefs, runtime }, (item) => store.state.readingProgress[`item:${item.id}`]);
	ctrl.attachWindow(fakeWin);
	assert.notEqual(itemsView._renderCell, origRenderCell);
	assert.equal(invalidations, 1);

	const renderedTitle = itemsView._renderCell(0, 'Paper', { dataKey: 'title', primary: true }, true);
	assert.equal(renderedTitle.textEl.getAttribute('data-zbf-heatmap'), '1');
	const renderedYear = itemsView._renderCell(0, '2026', { dataKey: 'year', primary: false }, false);
	assert.equal(renderedYear.textEl.getAttribute('data-zbf-heatmap'), null);

	prefs.set('workspace.readingTitleHeatmap.enable', false);
	ctrl.sync();
	assert.equal(itemsView._renderCell, origRenderCell);
	assert.equal(invalidations, 2);

	ctrl.disposeAll();
	delete globalThis.Zotero;
});

test('Phase 2.4: reading-progress.json & brief-notes.json strict isolation, legacy migration, independent clear & idle/prev-tab accuracy', async (t) => {
	const oldIO = globalThis.IOUtils;
	const oldZ = globalThis.Zotero;
	t.after(() => { globalThis.IOUtils = oldIO; globalThis.Zotero = oldZ; });

	const files = new Map();
	globalThis.Zotero = { DataDirectory: { dir: 'zdata' } };
	globalThis.IOUtils = {
		makeDirectory: async () => {},
		exists: async (p) => files.has(p),
		readUTF8: async (p) => files.get(p),
		writeUTF8: async (p, content) => { files.set(p, content); },
	};

	const { prefs } = createMemoryPrefs();
	const store = new WorkspaceStateStore(prefs);
	store.createGroup('Isolated Group');
	store.updateReadingProgress('item:808', 90, 2, 12);
	store.setRemark('item:808', 'Important insight');
	store.setRemarkMode('item:808', 'remark');
	await store.diskCache.flushNow({ ...store.state, readingProgress: {}, remarks: {}, remarkModes: {}, lastViewedAt: {} });
	await store.readingCache.flushNow(store.state);
	await store.notesCache.flushNow(store.state);

	// 1. Strict 3-way isolation: layout (workspace-snapshots + prefs), reading (reading-progress.json), brief notes (brief-notes.json)
	const wsPref = JSON.parse(prefs.get('workspace.document'));
	assert.deepEqual(wsPref.readingProgress, {});
	assert.deepEqual(wsPref.remarks, {});
	const snapJson = JSON.parse(files.get(store.diskCache.getFilePath()));
	assert.deepEqual(snapJson.state.readingProgress, {});
	assert.deepEqual(snapJson.state.remarks, {});

	const progressJson = JSON.parse(files.get(store.readingCache.getFilePath()));
	assert.equal(progressJson.format, 'zotero-bridgeflow-reading-progress');
	assert.equal(progressJson.state.readingProgress['item:808'].readSeconds, 90);
	assert.equal('remarks' in progressJson.state, false);

	const briefNotesJson = JSON.parse(files.get(store.notesCache.getFilePath()));
	assert.equal(briefNotesJson.format, 'zotero-bridgeflow-brief-notes');
	assert.equal(briefNotesJson.state.remarks['item:808'], 'Important insight');
	assert.equal(briefNotesJson.state.remarkModes['item:808'], 'remark');
	assert.equal('readingProgress' in briefNotesJson.state, false);

	// 2. Three completely independent clears
	store.clearWorkspaceLayout();
	assert.equal(store.state.groups.length, 0);
	assert.equal(store.state.readingProgress['item:808'].readSeconds, 90);
	assert.equal(store.state.remarks['item:808'], 'Important insight');

	store.createGroup('Keep Group');
	store.clearReadingProgress();
	assert.equal(store.state.groups.length, 1);
	assert.deepEqual(store.state.readingProgress, {});
	assert.equal(store.state.remarks['item:808'], 'Important insight');

	store.clearBriefNotes();
	assert.equal(store.state.groups.length, 1);
	assert.deepEqual(store.state.remarks, {});

	// 3. Seamless one-time migration from legacy v<=0.4.0 combined workspace-snapshots.json into both isolated caches
	const legacyFiles = new Map();
	globalThis.IOUtils = {
		makeDirectory: async () => {},
		exists: async (p) => legacyFiles.has(p),
		readUTF8: async (p) => legacyFiles.get(p),
		writeUTF8: async (p, content) => { legacyFiles.set(p, content); },
	};
	const legacyStore = new WorkspaceStateStore(createMemoryPrefs().prefs);
	legacyFiles.set(legacyStore.diskCache.getFilePath(), JSON.stringify({
		format: 'zotero-bridgeflow-workspace',
		version: 2,
		state: {
			version: 2, groups: [{ id: 'g1', name: 'Migrated', color: '#2563eb', memberKeys: ['item:99'] }],
			collapsed: [], pinnedKeys: [], sleepingKeys: [],
			remarks: { 'item:99': 'Legacy remark' }, remarkModes: { 'item:99': 'both' }, lastViewedAt: { 'item:99': 12345 },
			readingProgress: { 'item:99': { readSeconds: 240, lastPage: 5, totalPages: 10, pageSeconds: { '5': 240 } } },
			virtualMembers: {}, sessions: [], rollingSessions: [],
		},
	}));
	assert.equal(await legacyStore.initDiskCache(), true);
	assert.equal(legacyStore.state.readingProgress['item:99'].readSeconds, 240);
	assert.equal(legacyStore.state.remarks['item:99'], 'Legacy remark');
	assert.ok(legacyFiles.has(legacyStore.readingCache.getFilePath()));
	assert.ok(legacyFiles.has(legacyStore.notesCache.getFilePath()));
	assert.deepEqual(JSON.parse(legacyFiles.get(legacyStore.diskCache.getFilePath())).state.readingProgress, {});
	assert.deepEqual(JSON.parse(legacyFiles.get(legacyStore.diskCache.getFilePath())).state.remarks, {});

	// 4. Per-page Math.max merge + idle cutoff + previous-tab overrideKey attribution
	legacyStore.readingCache.mergeDurableState(legacyStore.state, {
		lastViewedAt: {},
		readingProgress: { 'item:99': { readSeconds: 260, lastPage: 6, totalPages: 10, pageSeconds: { '2': 50, '5': 100 } } },
	});
	assert.equal(legacyStore.state.readingProgress['item:99'].readSeconds, 260);
	assert.deepEqual(legacyStore.state.readingProgress['item:99'].pageSeconds, { '2': 50, '5': 240 });

	const win = { document: { hasFocus: () => true }, Zotero_Tabs: { selectedID: 'new-tab' } };
	assert.equal(trackActiveReaderProgress(win, legacyStore, [], 15, {
		overrideKey: 'item:99', overrideLastPage: 5, overrideTotalPages: 10,
		idleCutoffMs: 180_000, lastActivityAt: 1000, now: 500_000,
	}), false);
	assert.equal(trackActiveReaderProgress(win, legacyStore, [], 15, {
		overrideKey: 'item:99', overrideLastPage: 5, overrideTotalPages: 10,
		idleCutoffMs: 180_000, lastActivityAt: 490_000, now: 500_000,
	}), true);
	assert.equal(legacyStore.state.readingProgress['item:99'].readSeconds, 275);
});

test('Phase 2.5: hover card sub-60s duration formatting & ReadingColumnsController annotation summary cache invalidation', async (t) => {
	const { WorkspaceHoverCard } = await import('../src/domains/workspace/hover-card.ts');
	const oldZ = globalThis.Zotero;
	t.after(() => { globalThis.Zotero = oldZ; });

	const { prefs } = createMemoryPrefs({ 'workspace.annotationColumn.enable': true });
	const store = new WorkspaceStateStore(prefs);
	store.updateReadingProgress('item:310', 45, 3, 6);

	let annQueries = 0;
	const item310 = {
		id: 310,
		dateModified: '2026-11-24 08:00:00',
		deleted: false,
		getAttachments: () => [311],
	};
	const att311 = {
		id: 311,
		deleted: false,
		getAnnotations: () => {
			annQueries++;
			return [{ id: 1, deleted: false, annotationColor: '#ff6666', annotationText: 'Test', annotationComment: '', annotationPageLabel: '1' }];
		},
	};
	globalThis.Zotero = {
		Items: { get: (id) => (id === 310 ? item310 : id === 311 ? att311 : null) },
		Reader: {
			getByTabID: () => ({ _internalReader: { _state: { primaryViewStats: { pageIndex: 2, pagesCount: 6 } } } }),
		},
		locale: 'zh-CN',
	};

	const makeEl = (tag) => {
		const el = {
			tagName: tag, className: '', textContent: '', title: '', children: [], attrs: new Map(),
			style: { setProperty() {} },
			append(...n) { this.children.push(...n); },
			appendChild(n) { this.children.push(n); return n; },
			setAttribute(k, v) { this.attrs.set(k, v); },
			remove() {},
			offsetWidth: 320, offsetHeight: 110,
		};
		return el;
	};
	const host = makeEl('body');
	const doc = {
		documentElement: host,
		body: host,
		defaultView: { innerWidth: 1200, innerHeight: 800, setTimeout: () => 1, clearTimeout() {} },
		createElementNS: (_ns, tag) => makeEl(tag),
	};

	const hc = new WorkspaceHoverCard(doc, prefs, store);
	hc.show({ getBoundingClientRect: () => ({ left: 20, top: 20, bottom: 40, width: 100, height: 20 }) }, {
		key: 'item:310', itemID: 310, parentItemID: 310, tabID: 't-310',
		title: 'Sub-minute paper', shortTitle: 'Sub-minute', filename: '', source: '', creatorYear: '', collection: '',
		type: 'reader', groupId: '', pinned: false, sleeping: false, virtual: false, remark: '', lastViewedAt: 0,
	});
	const metaRow = host.children[0].children.find((c) => c.className === 'zbf-hc-meta' && c.textContent.includes('第 3 / 6 页'));
	assert.ok(metaRow);
	assert.match(metaRow.textContent, /第 3 \/ 6 页 · 45s/);
	assert.doesNotMatch(metaRow.textContent, /p\.3\/6/);
	hc.destroy();

	const cols = new ReadingColumnsController({ prefs, info: { id: 'bridgeflow@test' } }, store);
	assert.equal(cols.getAnnotationSummaryDisplay(item310), '1 (Method:1)');
	assert.equal(cols.getAnnotationSummaryDisplay(item310), '1 (Method:1)');
	assert.equal(annQueries, 1);
	cols.refreshColumns();
	assert.equal(cols.getAnnotationSummaryDisplay(item310), '1 (Method:1)');
	assert.equal(annQueries, 2);

	const { getHeatmapGradientCacheSize } = await import('../src/domains/visual-notes/title-heatmap.ts');
	for (let k = 1; k <= 5010; k++) {
		buildTitleHeatmapGradient({ readSeconds: k * 10, totalPages: 10, pageSeconds: { [String((k % 10) + 1)]: k * 10 } });
	}
	assert.equal(getHeatmapGradientCacheSize(), 5000);
});
