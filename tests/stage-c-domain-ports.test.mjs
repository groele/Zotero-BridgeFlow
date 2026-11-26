import test from 'node:test';
import assert from 'node:assert/strict';

import { PluginKernel } from '../src/kernel/plugin-kernel.ts';
import { ServiceContainer } from '../src/services/service-container.ts';
import { WordCiteDomainModule } from '../src/domains/word-cite/module.ts';
import { InspectorDomainModule } from '../src/domains/inspector/module.ts';
import { WordCiteSectionController } from '../src/domains/inspector/word-panel/word-cite-section.ts';
import { CitationLookupSectionController } from '../src/domains/inspector/lookup/citation-lookup-section.ts';
import { CitationLookupEngine } from '../src/domains/inspector/lookup/citation-lookup-engine.ts';

function createMemoryPrefs(initial = {}) {
	const store = new Map(Object.entries(initial));
	return {
		get(key) { return store.get(key); },
		set(key, val) { store.set(key, val); },
		registerObserver() { return 1; },
		unregisterObserver() {},
	};
}

function createMockElement(tag, ownerDocument) {
	const classes = new Set();
	const attrs = new Map();
	const listeners = new Map();
	const children = [];
	const el = {
		localName: tag,
		ownerDocument,
		parentElement: null,
		children,
		hidden: false,
		disabled: false,
		open: false,
		tabIndex: -1,
		textContent: '',
		title: '',
		type: '',
		set className(val) {
			classes.clear();
			for (const c of String(val || '').split(/\s+/).filter(Boolean)) classes.add(c);
		},
		get className() { return [...classes].join(' '); },
		classList: {
			add(...names) { for (const n of names) classes.add(n); },
			remove(...names) { for (const n of names) classes.delete(n); },
			toggle(name, force) {
				const next = force === undefined ? !classes.has(name) : Boolean(force);
				if (next) classes.add(name); else classes.delete(name);
				return next;
			},
			contains(name) { return classes.has(name); },
		},
		setAttribute(k, v) { attrs.set(k, String(v)); },
		getAttribute(k) { return attrs.get(k) ?? null; },
		append(...nodes) {
			for (const n of nodes) {
				if (!n || typeof n === 'string') continue;
				n.parentElement = el;
				children.push(n);
			}
		},
		appendChild(n) { el.append(n); return n; },
		addEventListener(evt, fn, opts) {
			if (!listeners.has(evt)) listeners.set(evt, new Set());
			listeners.get(evt).add(fn);
			opts?.signal?.addEventListener?.('abort', () => listeners.get(evt)?.delete(fn));
		},
		dispatchEvent(evt) {
			evt.target = evt.target || el;
			for (const fn of [...(listeners.get(evt.type) || [])]) fn(evt);
			if (el.parentElement) el.parentElement.dispatchEvent(evt);
			return true;
		},
		click() { el.dispatchEvent({ type: 'click', target: el, preventDefault() {}, stopPropagation() {} }); },
		closest(selector) {
			let cur = el;
			while (cur) {
				if (cur.localName === selector) return cur;
				cur = cur.parentElement;
			}
			return null;
		},
	};
	return el;
}

function createMockDocument(win) {
	const byId = new Map();
	const doc = {
		defaultView: win,
		head: null,
		documentElement: null,
		createElementNS(_ns, tag) { return doc.createElement(tag); },
		createElement(tag) {
			const node = createMockElement(tag, doc);
			let _id = '';
			Object.defineProperty(node, 'id', {
				get: () => _id,
				set: (v) => { _id = String(v); byId.set(_id, node); },
			});
			return node;
		},
		getElementById(id) { return byId.get(id) || null; },
		addEventListener() {},
		dispatchEvent() {},
	};
	doc.head = doc.createElement('head');
	doc.documentElement = doc.createElement('html');
	return doc;
}

function findByClass(root, cls) {
	if (!root) return null;
	if (root.classList?.contains?.(cls)) return root;
	for (const child of root.children || []) {
		const hit = findByClass(child, cls);
		if (hit) return hit;
	}
	return null;
}

function readText(el) {
	if (!el) return '';
	return [el.textContent || '', ...(el.children || []).map(readText)].filter(Boolean).join(' ');
}

function makeItem(id, title = `Paper ${id}`) {
	return {
		id,
		key: `K${id}`,
		libraryID: 1,
		deleted: false,
		itemType: 'journalArticle',
		isRegularItem: () => true,
		isTrashed: () => false,
		getField: (f) => (f === 'title' ? title : f === 'date' ? '2025' : ''),
		getCreators: () => [{ lastName: 'Li' }],
	};
}

test('Stage C: WordCiteDomainModule registers WordCitePort and cmd:cite-selected-word on start() and unregisters cleanly on stop()', () => {
	const prevZotero = globalThis.Zotero;
	globalThis.Zotero = { locale: 'zh-CN' };

	const kernel = new PluginKernel({ prefAdapter: createMemoryPrefs({ 'fusion.spotlightCrossDomain': true }) });
	kernel.init({ id: 'bridgeflow@groele', version: '0.6.11', rootURI: 'chrome://test/' });
	const services = new ServiceContainer(kernel);
	const wordMod = new WordCiteDomainModule(kernel, services);

	try {
		assert.equal(kernel.ports.has('word-cite'), false);
		assert.equal(wordMod.getSnapshot(), null);

		wordMod.start();
		const port = kernel.ports.get('word-cite');
		assert.ok(port, 'WordCitePort must be registered on start()');

		wordMod.tracker.syncSessions([{
			sessionID: 'doc-1',
			documentPath: 'D:\\Manuscript.docx',
			citations: [{ itemID: 101, ordinal: 1, shortText: '[1]', occurrences: 2 }],
		}]);

		const snap = port.getSnapshot();
		assert.equal(snap?.activeSessionID, 'doc-1');
		assert.equal(snap?.activeDocumentName, 'Manuscript.docx');
		assert.equal(snap?.totalCitedCount, 1);
		assert.deepEqual(snap?.citedItemIDs, [101]);
		assert.equal(wordMod.getSnapshot()?.activeSessionID, 'doc-1');

		const mockWin = { document: { documentElement: null } };
		const cmds = kernel.commands.query('>', mockWin);
		const citeCmd = cmds.find((c) => c.id === 'cmd:cite-selected-word');
		assert.ok(citeCmd, 'cmd:cite-selected-word must be registered on CommandRegistry');
		assert.match(citeCmd.title, /插入当前文献到 Word 光标处/);

		// Pref toggle disables Spotlight cross-domain command immediately
		kernel.prefs.set('fusion.spotlightCrossDomain', false);
		assert.equal(kernel.commands.query('>', mockWin).some((c) => c.id === 'cmd:cite-selected-word'), false);
		kernel.prefs.set('fusion.spotlightCrossDomain', true);

		wordMod.stop();
		assert.equal(kernel.ports.has('word-cite'), false, 'WordCitePort must unregister on stop()');
		assert.equal(kernel.commands.listIds().includes('word-cite-commands'), false, 'word-cite-commands must unregister on stop()');
		assert.equal(wordMod.getSnapshot(), null);
	} finally {
		wordMod.stop();
		services.dispose();
		globalThis.Zotero = prevZotero;
	}
});

test('Stage C: InspectorDomainModule registers InspectorPort and cmd:clear-citation-cache on start() and unregisters cleanly on stop()', () => {
	const prevZotero = globalThis.Zotero;
	globalThis.Zotero = { locale: 'zh-CN' };

	const kernel = new PluginKernel({
		prefAdapter: createMemoryPrefs({
			'fusion.spotlightCrossDomain': true,
			'inspector.cslPreview.enable': false,
			'inspector.lookup.enable': false,
			'inspector.pdfPreview.enable': false,
			'inspector.pdfFolder.enable': false,
			'inspector.wordCite.enable': false,
		}),
	});
	kernel.init({ id: 'bridgeflow@groele', version: '0.6.11', rootURI: 'chrome://test/' });
	const services = new ServiceContainer(kernel);
	const inspector = new InspectorDomainModule(kernel, services);

	let cslClears = 0;
	const origCslClear = services.csl.clearCache.bind(services.csl);
	services.csl.clearCache = () => { cslClears += 1; origCslClear(); };

	let busClearEvents = 0;
	kernel.bus.on('inspector:clear-cache', () => { busClearEvents += 1; });

	try {
		assert.equal(kernel.ports.has('inspector'), false);

		inspector.start();
		const port = kernel.ports.get('inspector');
		assert.ok(port, 'InspectorPort must be registered on start()');

		services.history.record({ text: 'Smith et al., 2025', itemID: 1, itemKey: 'K1', libraryID: 1, title: 'Paper', style: 'apa' });
		assert.equal(services.history.count, 1);

		// Target 'memory' clears CSL cache without clearing history
		port.clearCache('memory');
		assert.equal(cslClears, 1);
		assert.equal(services.history.count, 1);
		assert.equal(busClearEvents, 0, 'InspectorPort.clearCache must not re-emit inspector:clear-cache');

		// Target 'all' via Spotlight command clears both CSL cache and history
		const mockWin = { document: { documentElement: null } };
		const clearCmd = kernel.commands.query('> 清空', mockWin).find((c) => c.id === 'cmd:clear-citation-cache');
		assert.ok(clearCmd, 'cmd:clear-citation-cache must be registered on CommandRegistry');
		clearCmd.action();
		assert.equal(cslClears, 2);
		assert.equal(services.history.count, 0);
		assert.equal(busClearEvents, 0);

		inspector.stop();
		assert.equal(kernel.ports.has('inspector'), false, 'InspectorPort must unregister on stop()');
		assert.equal(kernel.commands.listIds().includes('inspector-commands'), false, 'inspector-commands must unregister on stop()');
	} finally {
		inspector.stop();
		services.dispose();
		globalThis.Zotero = prevZotero;
	}
});

test('Stage C: WordCiteSectionController uses WordCitePort & WorkspacePort directly when registered (zero RPC bus emissions)', async () => {
	const prevZotero = globalThis.Zotero;
	const sections = [];
	const itemA = makeItem(401, 'Port Direct Paper');

	globalThis.Zotero = {
		locale: 'zh-CN',
		Items: { get: (id) => (id === 401 ? itemA : null) },
		ItemPaneManager: {
			registerSection(desc) { sections.push(desc); return `sec-${sections.length}`; },
			unregisterSection() {},
		},
	};

	const kernel = new PluginKernel({
		prefAdapter: createMemoryPrefs({
			'inspector.wordCite.enable': true,
			'modules.wordCite.enable': true,
			'wordCite.collections.enable': true,
			'inspector.wordCite.showDocSwitcher': true,
			'inspector.wordCite.showCollectionLink': true,
			'inspector.wordCite.showOrphanRecovery': true,
		}),
	});
	kernel.init({ id: 'bridgeflow@groele', version: '0.6.11', rootURI: 'chrome://test/' });
	const services = new ServiceContainer(kernel);

	const busRpcEvents = [];
	for (const evt of [
		'word:snapshot-query',
		'workspace:groups-query',
		'word:insert-items-request',
		'word:refresh-request',
		'word:recover-orphans-request',
		'word:switch-session-request',
		'word:select-collection-request',
	]) {
		kernel.bus.on(evt, (payload) => busRpcEvents.push({ evt, payload }));
	}

	const portCalls = [];
	const snapshot = {
		activeSessionID: 's1',
		activeDocumentName: 'PaperA.docx',
		byItemID: new Map([[401, { itemID: 401, ordinal: 1, occurrences: 1, shortText: '[1]', documentName: 'PaperA.docx', sessionID: 's1' }]]),
		citedItemIDs: [401],
		totalCitedCount: 1,
		sessions: [
			{ sessionID: 's1', documentName: 'PaperA.docx', totalCitedCount: 1, byItemID: new Map() },
			{ sessionID: 's2', documentName: 'PaperB.docx', totalCitedCount: 0, byItemID: new Map() },
		],
		orphans: [
			{ key: 'o1', kind: 'missing', ordinal: 2, shortText: '[2]', title: 'Missing Ref', itemData: { title: 'Missing Ref', DOI: '10.1000/o1' } },
		],
	};

	kernel.ports.register('word-cite', {
		getSnapshot: () => { portCalls.push('getSnapshot'); return snapshot; },
		citeCurrentSelection: async () => {},
		insertItems: async (itemIDs, _win, requestId) => {
			portCalls.push(['insertItems', itemIDs]);
			return { requestId, status: 'inserted', documentName: 'PaperA.docx', itemCount: itemIDs.length };
		},
		refreshActiveDocument: async (sessionID, requestId) => {
			portCalls.push(['refreshActiveDocument', sessionID]);
			return { requestId, ok: true, documentName: 'PaperA.docx' };
		},
		switchSession: (sessionID) => { portCalls.push(['switchSession', sessionID]); },
		selectCollection: (sessionID) => { portCalls.push(['selectCollection', sessionID]); },
		recoverOrphans: async (opts) => {
			portCalls.push(['recoverOrphans', opts.sessionID, opts.keys]);
			return { requestId: opts.requestId, restoredCount: 0, importedCount: 1, skippedCount: 0, sessionID: opts.sessionID };
		},
	});

	kernel.ports.register('workspace', {
		focusOrOpenItem: async () => 'focused',
		groupOpenTabsByItemIDs: () => null,
		setCitationBadges: () => {},
		getGroupSummaries: () => { portCalls.push('getGroupSummaries'); return [{ groupId: 'g1', groupName: 'Draft', itemIDs: [401, 402] }]; },
		getReaderNeighbors: () => null,
		registerSpotlightProvider: () => () => {},
	});

	const section = new WordCiteSectionController(kernel, services);

	try {
		section.register();
		const reg = sections[0];
		const win = { ZoteroPane: { getSelectedItems: () => [itemA] } };
		const doc = createMockDocument(win);
		const body = doc.createElement('div');
		reg.onInit({ doc, body, item: itemA });

		const receiptEl = findByClass(body, 'zbf-wc-receipt');
		const docSwitchBtn = findByClass(body, 'zbf-wc-doc-switch');
		const colBtn = findByClass(body, 'zbf-word-col-action');
		const insertBtn = findByClass(body, 'zbf-word-cite-action');
		const refreshBtn = findByClass(body, 'zbf-word-refresh-action');
		const orphanActionBtn = findByClass(body, 'zbf-wc-orphan-btn');

		// 1. Direct insert via citeItemsInWord / insertBtn
		insertBtn.click();
		await new Promise((r) => setTimeout(r, 0));
		assert.match(readText(receiptEl), /已提交引文/);

		// 2. Direct refresh via refreshBtn
		refreshBtn.click();
		await new Promise((r) => setTimeout(r, 0));
		assert.match(readText(receiptEl), /已刷新/);

		// 3. Direct recover orphans via orphan action button
		orphanActionBtn.click();
		await new Promise((r) => setTimeout(r, 0));
		assert.match(readText(receiptEl), /备份重建 1 篇|找回 1 篇/);

		// 4. Direct session switch & collection selection
		docSwitchBtn.click();
		colBtn.click();

		// 5. onToggle re-reads ports directly
		reg.onToggle({ body, item: itemA });

		assert.deepEqual(busRpcEvents, [], 'Zero bus RPC events must be emitted when WordCitePort & WorkspacePort are registered');
		assert.ok(portCalls.includes('getSnapshot'));
		assert.ok(portCalls.includes('getGroupSummaries'));
		assert.ok(portCalls.some((c) => Array.isArray(c) && c[0] === 'insertItems'));
		assert.ok(portCalls.some((c) => Array.isArray(c) && c[0] === 'refreshActiveDocument' && c[1] === 's1'));
		assert.ok(portCalls.some((c) => Array.isArray(c) && c[0] === 'recoverOrphans' && c[1] === 's1'));
		assert.ok(portCalls.some((c) => Array.isArray(c) && c[0] === 'switchSession' && c[1] === 's2'));
		assert.ok(portCalls.some((c) => Array.isArray(c) && c[0] === 'selectCollection' && c[1] === 's1'));
	} finally {
		section.unregister();
		services.dispose();
		globalThis.Zotero = prevZotero;
	}
});

test('Stage C: WordCiteSectionController falls back gracefully to EventBus RPC when ports are absent', () => {
	const prevZotero = globalThis.Zotero;
	const sections = [];
	const itemA = makeItem(501, 'Fallback Bus Paper');

	globalThis.Zotero = {
		locale: 'zh-CN',
		Items: { get: (id) => (id === 501 ? itemA : null) },
		ItemPaneManager: {
			registerSection(desc) { sections.push(desc); return `sec-${sections.length}`; },
			unregisterSection() {},
		},
	};

	const kernel = new PluginKernel({
		prefAdapter: createMemoryPrefs({
			'inspector.wordCite.enable': true,
			'modules.wordCite.enable': true,
			'wordCite.collections.enable': true,
			'inspector.wordCite.showDocSwitcher': true,
			'inspector.wordCite.showCollectionLink': true,
		}),
	});
	kernel.init({ id: 'bridgeflow@groele', version: '0.6.11', rootURI: 'chrome://test/' });
	const services = new ServiceContainer(kernel);

	const emitted = [];
	kernel.bus.on('word:snapshot-query', () => emitted.push('word:snapshot-query'));
	kernel.bus.on('workspace:groups-query', () => emitted.push('workspace:groups-query'));
	kernel.bus.on('word:insert-items-request', ({ requestId, itemIDs }) => {
		emitted.push('word:insert-items-request');
		kernel.bus.emit('word:insert-result', { requestId, status: 'inserted', documentName: 'BusDoc.docx', itemCount: itemIDs.length });
	});
	kernel.bus.on('word:refresh-request', ({ requestId }) => {
		emitted.push('word:refresh-request');
		kernel.bus.emit('word:refresh-result', { requestId, ok: true, documentName: 'BusDoc.docx' });
	});
	kernel.bus.on('word:select-collection-request', () => emitted.push('word:select-collection-request'));

	const section = new WordCiteSectionController(kernel, services);

	try {
		assert.equal(kernel.ports.has('word-cite'), false);
		assert.equal(kernel.ports.has('workspace'), false);

		section.register();
		const reg = sections[0];
		const win = { ZoteroPane: { getSelectedItems: () => [itemA] } };
		const doc = createMockDocument(win);
		const body = doc.createElement('div');
		reg.onInit({ doc, body, item: itemA });

		kernel.bus.emit('citation:snapshot-updated', {
			activeSessionID: 'bus-s1',
			activeDocumentName: 'BusDoc.docx',
			byItemID: new Map(),
			citedItemIDs: [],
			totalCitedCount: 0,
			sessions: [{ sessionID: 'bus-s1', documentName: 'BusDoc.docx', totalCitedCount: 0, byItemID: new Map() }],
		});

		const receiptEl = findByClass(body, 'zbf-wc-receipt');
		const insertBtn = findByClass(body, 'zbf-word-cite-action');
		const refreshBtn = findByClass(body, 'zbf-word-refresh-action');
		const colBtn = findByClass(body, 'zbf-word-col-action');

		insertBtn.click();
		assert.match(readText(receiptEl), /BusDoc\.docx/);

		refreshBtn.click();
		assert.match(readText(receiptEl), /已刷新/);

		colBtn.click();

		assert.ok(emitted.includes('word:snapshot-query'));
		assert.ok(emitted.includes('workspace:groups-query'));
		assert.ok(emitted.includes('word:insert-items-request'));
		assert.ok(emitted.includes('word:refresh-request'));
		assert.ok(emitted.includes('word:select-collection-request'));
	} finally {
		section.unregister();
		services.dispose();
		globalThis.Zotero = prevZotero;
	}
});

test('Stage C: CitationLookupSectionController prefers WorkspacePort when registered and falls back to bus when absent', async () => {
	const prevZotero = globalThis.Zotero;
	globalThis.Zotero = {
		Items: { get: () => null },
		getMainWindow: () => null,
	};

	const kernel = new PluginKernel({
		prefAdapter: createMemoryPrefs({ 'fusion.lookupJumpExistingTab': true }),
	});
	kernel.init({ id: 'bridgeflow@groele', version: '0.6.11', rootURI: 'chrome://test/' });
	const services = new ServiceContainer(kernel);
	const lookup = new CitationLookupSectionController(kernel, services, new CitationLookupEngine(services.history));

	const busOpens = [];
	const portOpens = [];
	kernel.bus.on('workspace:open-item-request', (req) => busOpens.push(req));

	try {
		// Without workspace port -> falls back to EventBus
		await lookup.locateItem(777);
		assert.equal(busOpens.length, 1);
		assert.equal(busOpens[0].itemID, 777);

		// With workspace port -> calls port directly without bus emission
		const disposePort = kernel.ports.register('workspace', {
			focusOrOpenItem: async (req) => { portOpens.push(req); return 'focused'; },
			groupOpenTabsByItemIDs: () => null,
			setCitationBadges: () => {},
			getGroupSummaries: () => [],
			getReaderNeighbors: () => null,
			registerSpotlightProvider: () => () => {},
		});
		await lookup.locateItem(888);
		assert.equal(busOpens.length, 1, 'no additional bus open-item emission when WorkspacePort is registered');
		assert.equal(portOpens.length, 1);
		assert.equal(portOpens[0].itemID, 888);
		disposePort();
	} finally {
		services.dispose();
		globalThis.Zotero = prevZotero;
	}
});
