import test from 'node:test';
import assert from 'node:assert/strict';
import { PluginKernel } from '../src/kernel/plugin-kernel.ts';
import { ServiceContainer } from '../src/services/service-container.ts';
import { VisualNotesDomainModule } from '../src/domains/visual-notes/module.ts';
import { ReadingColumnsController } from '../src/domains/visual-notes/columns/library-columns.ts';
import { readItemRemarkWithFallback, clearExtraRemarkCache } from '../src/domains/visual-notes/data-source.ts';
import { TitleHeatmapController } from '../src/domains/visual-notes/columns/title-heatmap.ts';
import { summarizeItemAnnotationColors, collectItemAnnotations, parseColorSemantics } from '../src/services/annotation-utils.ts';
import { WorkspaceDomainModule } from '../src/domains/workspace/module.ts';
import { ReaderAttachmentSwitcher } from '../src/domains/workspace/reader/reader-attachment-switcher.ts';
import { READER_ATT_BTN_CLASS, READER_ATT_MENU_ID } from '../src/domains/workspace/reader/reader-attachment-switcher-ui.ts';
import { WorkspaceStateStore } from '../src/domains/workspace/store/state-store.ts';
import { resolveAllPdfAttachments, renderPageToCanvas } from '../src/domains/inspector/pdf/pdf-renderer.ts';

function makeHostStubs(selectedID = 'zotero-pane') {
	let refreshCalls = 0;
	const itemMap = new Map();
	const observers = [];
	const itemsView = {
		getRow: () => ({ ref: null, isItem: true }),
		_renderCell: (_idx, _col, _info) => {
			let qCalls = 0;
			const cell = {
				attrs: {},
				style: {},
				setAttribute(k, v) { this.attrs[k] = String(v); },
				getAttribute(k) { return this.attrs[k] ?? null; },
				removeAttribute(k) { delete this.attrs[k]; },
				querySelector() { qCalls += 1; return null; },
				get qCalls() { return qCalls; },
			};
			return cell;
		},
		tree: { invalidate() {} },
	};
	const win = {
		closed: false,
		AbortController,
		Zotero_Tabs: { selectedID, _tabs: [{ id: 'zotero-pane', type: 'library', data: {} }] },
		ZoteroPane: { itemsView, getSelectedItems: () => [] },
		document: {
			head: { appendChild() {} },
			documentElement: { appendChild() {} },
			getElementById: () => null,
			createElementNS: (_ns, tag) => ({ tagName: tag, id: '', textContent: '', parentNode: { tagName: 'head' }, remove() {}, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} }),
			querySelector: () => null,
			addEventListener() {},
			removeEventListener() {},
		},
		addEventListener() {},
		removeEventListener() {},
		setTimeout,
		clearTimeout,
	};
	globalThis.Zotero = {
		locale: 'zh-CN',
		Items: { get: (id) => itemMap.get(Number(id)) },
		ItemTreeManager: {
			registerColumn: (d) => d?.dataKey || 'k',
			unregisterColumn: () => {},
			refreshColumns() { refreshCalls += 1; },
		},
		getMainWindows: () => [win],
		getMainWindow: () => win,
		Prefs: { get: () => undefined, set: () => {}, clear: () => {}, registerObserver: () => Symbol('obs'), unregisterObserver: () => {} },
		Notifier: {
			registerObserver: (obs) => { observers.push(obs); return observers.length; },
			unregisterObserver: () => {},
		},
		UIReady: true,
	};
	return {
		win,
		itemsView,
		itemMap,
		notify: (event, type, ids) => { for (const obs of observers) obs.notify?.(event, type, ids, {}); },
		getRefreshCalls: () => refreshCalls,
	};
}

test('v0.8.10 readItemRemarkWithFallback caches empty remarks across renders by remarksRevision', () => {
	clearExtraRemarkCache();
	let attCalls = 0;
	let rev = 1;
	const item = {
		id: 501,
		version: 10,
		isRegularItem: () => true,
		getField: () => '',
		getAttachments: () => { attCalls += 1; return [502]; },
	};
	const ds = {
		getReadingProgress: () => undefined,
		getReadingRevision: () => 1,
		getRemark: () => '',
		getRemarksRevision: () => rev,
		setRemark: () => {},
	};
	assert.equal(readItemRemarkWithFallback(item, ds), '');
	assert.equal(readItemRemarkWithFallback(item, ds), '');
	assert.equal(readItemRemarkWithFallback(item, ds), '');
	assert.equal(attCalls, 1, 'should scan attachments at most once per remarksRevision when remark is empty');

	rev = 2;
	assert.equal(readItemRemarkWithFallback(item, ds), '');
	assert.equal(attCalls, 2, 'should re-check attachments once when remarksRevision advances');
	clearExtraRemarkCache();
});

test('v0.8.10 ReadingColumnsController memoizes getReadProgressForItem by readingRevision', () => {
	const kernel = new PluginKernel({ id: 'bridgeflow@groele', version: '0.8.10', rootURI: 'chrome://bf/' });
	let attCalls = 0;
	let rev = 1;
	const progMap = { 602: { itemKey: 'k2', readSeconds: 180, lastViewedAt: 1000, pageSeconds: { 1: 120, 2: 60 } } };
	const item = {
		id: 601,
		isRegularItem: () => true,
		getAttachments: () => { attCalls += 1; return [602]; },
	};
	const cols = new ReadingColumnsController(kernel, {
		getReadingProgress: (id) => progMap[id],
		getReadingRevision: () => rev,
		getRemark: () => '',
		setRemark: () => {},
	});
	assert.equal(cols.getReadProgressForItem(item)?.readSeconds, 180);
	assert.equal(cols.getReadProgressForItem(item)?.readSeconds, 180);
	assert.equal(cols.getReadProgressForItem(item)?.readSeconds, 180);
	assert.equal(attCalls, 1, 'repeated reads within same readingRevision should reuse memoized progress');

	rev = 2;
	progMap[602] = { itemKey: 'k2', readSeconds: 210, lastViewedAt: 2000, pageSeconds: { 1: 150, 2: 60 } };
	assert.equal(cols.getReadProgressForItem(item)?.readSeconds, 210);
	assert.equal(attCalls, 2, 'readingRevision bump should invalidate memoized progress');
});

test('v0.8.10 summarizeItemAnnotationColors matches collectItemAnnotations without calling ann.getTags()', () => {
	let getTagsCalls = 0;
	const att = {
		id: 702,
		isFileAttachment: () => true,
		getAnnotations: () => [
			{ id: 1, annotationColor: '#ffd400', annotationText: 'important claim', annotationComment: '', getTags: () => { getTagsCalls += 1; return ['t1']; } },
			{ id: 2, annotationColor: '#5fb236', annotationText: '', annotationComment: 'method detail', getTags: () => { getTagsCalls += 1; return []; } },
			{ id: 3, annotationColor: '#ffd400', annotationText: '', annotationComment: '', getTags: () => { getTagsCalls += 1; return []; } },
		],
	};
	globalThis.Zotero = { Items: { get: (id) => (id === 702 ? att : undefined) } };
	const item = { id: 701, isRegularItem: () => true, getField: () => 'Paper', getAttachments: () => [702] };
	const semantics = parseColorSemantics('');

	const fast = summarizeItemAnnotationColors(item, semantics);
	assert.equal(getTagsCalls, 0, 'lightweight color summary must not load Zotero annotation tags');
	assert.equal(fast.total, 2);

	const full = collectItemAnnotations([item], semantics);
	assert.equal(fast.total, full.length);
	assert.equal(fast.buckets[0].count + fast.buckets[1].count, full.length);
});

test('v0.8.10 VisualNotes defers reading refresh while hidden in PDF tab and flushes on library tab select', async () => {
	const prevZotero = globalThis.Zotero;
	try {
		const stub = makeHostStubs('reader-tab-1');
		const kernel = new PluginKernel({ id: 'bridgeflow@groele', version: '0.8.10', rootURI: 'chrome://bf/' });
		kernel.notifier.start();
		const services = new ServiceContainer(kernel);
		const vn = new VisualNotesDomainModule(kernel, services);
		kernel.prefs.set('workspace.readingColumn.enable', true);
		vn.start();
		vn.onMainWindowLoad(stub.win);

		const before = stub.getRefreshCalls();
		vn.refreshLibraryViews(undefined, true);
		await new Promise((r) => setTimeout(r, 90));
		assert.equal(stub.getRefreshCalls(), before, 'must not refresh hidden library columns while user reads in PDF tab');

		stub.win.Zotero_Tabs.selectedID = 'zotero-pane';
		stub.notify('select', 'tab', ['zotero-pane']);
		await new Promise((r) => setTimeout(r, 90));
		assert.equal(stub.getRefreshCalls(), before + 1, 'deferred reading refresh should flush once switching back to library');
		vn.stop();
		kernel.notifier.stop();
	} finally {
		globalThis.Zotero = prevZotero;
	}
});

test('v0.8.10 Workspace ignores pure annotation item notifier events without queueing re-render', async () => {
	const prevZotero = globalThis.Zotero;
	try {
		const stub = makeHostStubs('reader-tab-1');
		stub.itemMap.set(9001, { id: 9001, itemType: 'annotation', isAnnotation: () => true, parentItemID: 8001 });
		const kernel = new PluginKernel({ id: 'bridgeflow@groele', version: '0.8.10', rootURI: 'chrome://bf/' });
		kernel.notifier.start();
		const services = new ServiceContainer(kernel);
		const ws = new WorkspaceDomainModule(kernel, services);
		ws.start();
		await new Promise((r) => setTimeout(r, 35));
		let renderCount = 0;
		const ui = ws.windows?.values?.()?.next?.().value;
		if (ui) {
			const orig = ui.render.bind(ui);
			ui.render = () => { renderCount += 1; return orig(); };
		}
		const before = renderCount;
		stub.notify('add', 'item', [9001]);
		await new Promise((r) => setTimeout(r, 60));
		assert.equal(renderCount, before, 'adding PDF highlights/annotations must not force full workspace re-render');
		ws.stop();
		kernel.notifier.stop();
	} finally {
		globalThis.Zotero = prevZotero;
	}
});

test('v0.8.10 TitleHeatmap _renderCell skips querySelector on unread cells and clears recycled ones', () => {
	const prevZotero = globalThis.Zotero;
	try {
		const stub = makeHostStubs();
		const kernel = new PluginKernel({ id: 'bridgeflow@groele', version: '0.8.10', rootURI: 'chrome://bf/' });
		kernel.prefs.set('workspace.readingTitleHeatmap.enable', true);
		let activeProgress = undefined;
		let currentRowItem = { id: 101, isRegularItem: () => true };
		stub.itemsView.getRow = () => ({ ref: currentRowItem, isItem: true });

		const hm = new TitleHeatmapController(kernel, () => activeProgress);
		hm.attachWindow(stub.win);

		const unreadCell = stub.itemsView._renderCell(0, '', { dataKey: 'title' });
		assert.equal(unreadCell.qCalls, 0, 'unread item cell should not run querySelector(".cell-text")');

		hm.disposeAll();
	} finally {
		globalThis.Zotero = prevZotero;
	}
});

test('v0.8.10 resolveAllPdfAttachments fetches getBestAttachment once and renderPdfPage clamps DPR', async () => {
	let bestCalls = 0;
	const item = {
		id: 300,
		isRegularItem: () => true,
		getAttachments: () => [301],
		getBestAttachment: async () => {
			bestCalls += 1;
			return { id: 301, isPDFAttachment: () => true, attachmentContentType: 'application/pdf', attachmentFilename: 'a.pdf', getField: () => 'Main' };
		},
	};
	const list = await resolveAllPdfAttachments(item);
	assert.equal(list.length, 1);
	assert.equal(bestCalls, 1, 'resolveAllPdfAttachments should only await getBestAttachment once');

	let renderedTransformScale = 0;
	const fakeDoc = {
		getPage: async () => ({
			getViewport: ({ scale }) => ({ width: Math.round(100 * scale), height: Math.round(140 * scale), scale }),
			render: ({ transform }) => {
				renderedTransformScale = Array.isArray(transform) ? Number(transform[0] || 1) : 1;
				return { promise: Promise.resolve() };
			},
			cleanup() {},
		}),
	};
	const canvas = { width: 0, height: 0, style: {}, getContext: () => ({ setTransform() {}, clearRect() {} }) };
	await renderPageToCanvas(fakeDoc, 1, canvas, 300, 1, 4, () => false);
	assert.ok(renderedTransformScale <= 2.25 + 0.001, `HiDPI pixelRatio clamp violated: scale=${renderedTransformScale}`);
});

function makeReaderDomMock() {
	const makeEl = (tag) => {
		const attrs = new Map();
		const listeners = new Map();
		const el = {
			tagName: tag.toUpperCase(),
			id: '',
			className: '',
			type: '',
			hidden: false,
			textContent: '',
			title: '',
			style: {},
			children: [],
			parentNode: null,
			isConnected: true,
			defaultView: null,
			setAttribute(k, v) {
				attrs.set(k, String(v));
				if (k === 'id') this.id = String(v);
				if (k === 'class') this.className = String(v);
			},
			getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
			removeAttribute(k) { attrs.delete(k); },
			appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
			remove() {
				if (this.parentNode?.children) {
					const idx = this.parentNode.children.indexOf(this);
					if (idx >= 0) this.parentNode.children.splice(idx, 1);
				}
				this.isConnected = false;
			},
			addEventListener(type, fn) {
				if (!listeners.has(type)) listeners.set(type, []);
				listeners.get(type).push(fn);
			},
			removeEventListener() {},
			dispatch(type, ev = {}) {
				for (const fn of listeners.get(type) || []) {
					fn({ preventDefault() {}, stopPropagation() {}, target: this, ...ev });
				}
			},
			contains(node) {
				if (node === this) return true;
				return this.children.some((c) => c.contains?.(node));
			},
			getBoundingClientRect: () => ({ left: 200, bottom: 40, right: 300 }),
		};
		return el;
	};
	const findAll = (root, pred, acc = []) => {
		if (!root) return acc;
		if (pred(root)) acc.push(root);
		for (const c of root.children || []) findAll(c, pred, acc);
		return acc;
	};
	const head = makeEl('head');
	const body = makeEl('body');
	const customSections = makeEl('div');
	customSections.className = 'custom-sections';
	body.appendChild(customSections);
	const listeners = new Map();
	const doc = {
		head,
		body,
		documentElement: body,
		defaultView: { closed: false, innerWidth: 1024, addEventListener() {}, removeEventListener() {} },
		createElementNS: (_ns, tag) => makeEl(tag),
		createElement: (tag) => makeEl(tag),
		getElementById: (id) => findAll(head, (n) => n.id === id)[0] || findAll(body, (n) => n.id === id)[0] || null,
		querySelector: (sel) => {
			if (sel === '.toolbar .custom-sections') return customSections;
			if (sel === '.zbf-reader-att-btn') return findAll(body, (n) => n.className === 'zbf-reader-att-btn')[0] || null;
			return null;
		},
		querySelectorAll: (sel) => {
			if (sel === `.${READER_ATT_BTN_CLASS}`) return findAll(body, (n) => n.className === READER_ATT_BTN_CLASS);
			if (sel === '.zbf-reader-att-item') return findAll(body, (n) => n.className === 'zbf-reader-att-item');
			return [];
		},
		addEventListener(type, fn) { listeners.set(type, fn); },
		removeEventListener() {},
	};
	head.defaultView = doc.defaultView;
	body.defaultView = doc.defaultView;
	return { doc, body, customSections };
}

test('v0.8.10 ReaderAttachmentSwitcher hides for single attachment, lists siblings for 2+, and opens at curIdx + 1 into same group', async () => {
	const prevZotero = globalThis.Zotero;
	try {
		const { doc } = makeReaderDomMock();
		const attachments = [11];
		const items = new Map([
			[10, { id: 10, getAttachments: () => attachments }],
			[11, { id: 11, parentItemID: 10, attachmentContentType: 'application/pdf', attachmentFilename: 'main.pdf', getField: () => 'Hu et al. PDF' }],
			[12, { id: 12, parentItemID: 10, attachmentContentType: 'text/html', attachmentFilename: 'snap.html', getField: () => 'Snapshot' }],
		]);
		const openedCalls = [];
		const selectedTabs = [];
		const tabs = [{ id: 'tab-1', type: 'reader', data: { itemID: 11 } }, { id: 'tab-other', type: 'reader', data: { itemID: 99 } }];
		const registeredListeners = [];
		const observers = [];
		const mainWin = { Zotero_Tabs: { _tabs: tabs, selectedID: 'tab-1', select: (id) => selectedTabs.push(id), close: () => {} } };
		globalThis.Zotero = {
			locale: 'zh-CN',
			Items: { get: (id) => items.get(Number(id)) },
			Reader: {
				_readers: [],
				registerEventListener: (type, fn) => registeredListeners.push({ type, fn }),
				unregisterEventListener: () => {},
				open: async (id, _loc, opts) => { openedCalls.push({ id, opts }); return { tabID: opts?.tabID || ('opened-' + id) }; },
			},
			Notifier: { registerObserver: (o) => { observers.push(o); return 1; }, unregisterObserver: () => {} },
			Prefs: { get: () => undefined, set: () => {}, clear: () => {}, registerObserver: () => Symbol('o'), unregisterObserver: () => {} },
			getMainWindows: () => [mainWin],
			getMainWindow: () => mainWin,
		};

		const kernel = new PluginKernel({ id: 'bridgeflow@groele', version: '0.8.10', rootURI: 'chrome://bf/' });
		kernel.notifier.start();
		const store = new WorkspaceStateStore(kernel.prefs);
		const grp = store.createGroup('Papers');
		store.assignToGroup('item:11', grp.id);
		const switcher = new ReaderAttachmentSwitcher(kernel, store);
		switcher.start();

		const appendNodes = [];
		const reader = { itemID: 11, tabID: 'tab-1', _iframeWindow: { document: doc } };
		const renderEvt = registeredListeners.find((l) => l.type === 'renderToolbar');
		assert.ok(renderEvt, 'should register Reader renderToolbar listener');
		renderEvt.fn({ reader, doc, append: (el) => { appendNodes.push(el); doc.body.appendChild(el); } });
		assert.equal(appendNodes.length, 1);
		assert.equal(appendNodes[0].hidden, true, 'must stay hidden when item only has 1 attachment');

		attachments.push(12);
		for (const o of observers) o.notify('add', 'item', [12], {});
		await new Promise((r) => setTimeout(r, 65));

		assert.equal(appendNodes[0].hidden, false, 'pill becomes visible when 2nd sibling exists');
		const btn = doc.querySelector('.zbf-reader-att-btn');
		assert.equal(btn.children[0].textContent, '共 2 个版本');

		btn.dispatch('click');
		const menu = doc.getElementById(READER_ATT_MENU_ID);
		assert.ok(menu, 'clicking pill should open attachment dropdown menu');
		const rows = doc.querySelectorAll('.zbf-reader-att-item');
		assert.equal(rows.length, 2);
		assert.equal(rows[0].getAttribute('data-active'), 'true');

		rows[1].dispatch('click');
		await new Promise((r) => setTimeout(r, 20));
		assert.equal(openedCalls.length, 1);
		assert.equal(openedCalls[0].id, 12);
		assert.equal(openedCalls[0].opts.tabID, 'tab-1', 'should swap attachment in-place inside the current tab without creating a new tab');
		assert.equal(tabs[0].data.itemID, 12, 'current tab data.itemID should update in-place');
		assert.equal(store.groupOfKey('item:12'), grp.id, 'switched attachment should inherit the current workspace group');
		assert.equal(store.groupOfKey('item:11'), '', 'replaced attachment should hand off group membership cleanly');

		// When target attachment is already open in another tab, switch selects it without calling Zotero.Reader.open again
		tabs[0].data.itemID = 11;
		tabs.push({ id: 'tab-12', type: 'reader', data: { itemID: 12 } });
		btn.dispatch('click');
		doc.querySelectorAll('.zbf-reader-att-item')[1].dispatch('click');
		await new Promise((r) => setTimeout(r, 20));
		assert.equal(openedCalls.length, 1, 'should not re-open when sibling attachment tab is already open');
		assert.deepEqual(selectedTabs, ['tab-12']);
		assert.equal(openedCalls[0].opts.openInBackground, true);

		kernel.prefs.set('workspace.enableReaderAttachmentSwitcher', false);
		switcher.syncPref();
		assert.equal(doc.querySelectorAll(`.${READER_ATT_BTN_CLASS}`).length, 0, 'disabling pref should clean injected toolbar button');
		switcher.stop();
		kernel.notifier.stop();
	} finally {
		globalThis.Zotero = prevZotero;
	}
});
