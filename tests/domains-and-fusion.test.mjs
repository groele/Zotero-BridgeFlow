import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BridgeFlowApp } from '../src/index.ts';
import { PREF_PREFIX, PREF_SCHEMA } from '../src/kernel/pref-schema.ts';
import { disambiguateDocumentNames } from '../src/domains/word-cite/session-tracker.ts';

function createMemoryPrefs(initial = {}) {
	const store = new Map(Object.entries(initial).map(([k, v]) => [k.startsWith('extensions.') ? k : PREF_PREFIX + k, v]));
	const observers = new Map();
	let nextId = 1;
	return {
		store,
		adapter: {
			get(key) { return store.get(key); },
			set(key, val) {
				store.set(key, val);
				for (const [, obs] of observers) {
					if (obs.key === key) obs.fn();
				}
			},
			registerObserver(key, fn) {
				const id = nextId++;
				observers.set(id, { key, fn });
				return id;
			},
			unregisterObserver(id) { observers.delete(id); },
		},
	};
}

function createMockZoteroEnv() {
	const itemsMap = new Map();
	const registeredPanes = new Map();
	const registeredCols = new Map();
	let nextPaneSeq = 1;
	let nextColSeq = 1;
	const copiedPayloads = [];

	const makeItem = (id, fields, options = {}) => {
		const tags = new Set(options.initialTags || []);
		const item = {
			id,
			libraryID: options.libraryID ?? 1,
			key: `KEY${id}`,
			itemType: 'journalArticle',
			deleted: Boolean(options.deleted),
			firstCreator: options.firstCreator || 'Vaswani',
			isRegularItem: () => true,
			isTrashed: () => Boolean(options.trashed),
			isEditable: () => options.editable !== false,
			getField: (f) => fields[f] || '',
			hasTag: (t) => tags.has(t),
			addTag: (t) => tags.add(t),
			removeTag: (t) => tags.delete(t),
			saveTx: async () => {},
			getCollections: () => [],
			_tags: tags,
		};
		itemsMap.set(id, item);
		return item;
	};

	const mockZotero = {
		isWin: true,
		Items: {
			get: (id) => itemsMap.get(id) || null,
			getAll: async () => [...itemsMap.values()],
		},
		Libraries: { userLibraryID: 1 },
		ItemPaneManager: {
			registerSection: (spec) => {
				const id = `sec-${nextPaneSeq++}`;
				registeredPanes.set(id, spec.paneID);
				return id;
			},
			unregisterSection: (id) => registeredPanes.delete(id),
		},
		ItemTreeManager: {
			registerColumn: (spec) => {
				const id = `col-${nextColSeq++}`;
				registeredCols.set(id, spec);
				return id;
			},
			unregisterColumn: (id) => registeredCols.delete(id),
		},
		Utilities: {
			Internal: {
				copyTextToClipboard: (txt) => copiedPayloads.push(txt),
			},
		},
		QuickCopy: {
			getContentFromItems: (items) => {
				const text = items.map((it) => `${it.firstCreator}, ${it.getField('year')}. ${it.getField('title')}.`).join('\n');
				return { html: `<p>${text}</p>`, text };
			},
		},
		Notifier: {
			registerObserver: () => 'notifier-1',
			unregisterObserver: () => {},
		},
		getMainWindows: () => [],
		debug: () => {},
		logError: () => {},
	};

	return { mockZotero, makeItem, registeredPanes, registeredCols, copiedPayloads };
}

function createMockWindow(tabsList) {
	let selectedID = tabsList[0]?.id || '';
	const closed = [];
	const unloaded = [];
	return {
		Zotero_Tabs: {
			_tabs: tabsList,
			get selectedID() { return selectedID; },
			select(id) { selectedID = id; },
			close(ids) { closed.push(...(Array.isArray(ids) ? ids : [ids])); },
			unload(id) { unloaded.push(id); },
		},
		_getSelected: () => selectedID,
		_closed: closed,
		_unloaded: unloaded,
	};
}

test('Domain B: Inspector registers all 5 right-hand sections (including Word Cite icon) and hot-toggles individually', async () => {
	const env = createMockZoteroEnv();
	globalThis.Zotero = env.mockZotero;
	const mem = createMemoryPrefs();
	const app = new BridgeFlowApp({ prefAdapter: mem.adapter });
	app.init({ id: 'bridgeflow@groele', version: '0.0.1', rootURI: 'chrome://test/' });
	await app.start();

	assert.equal(env.registeredPanes.size, 5);
	app.kernel.prefs.set('inspector.pdfFolder.enable', false);
	assert.equal(env.registeredPanes.size, 4);
	app.kernel.prefs.set('inspector.wordCite.enable', false);
	assert.equal(env.registeredPanes.size, 3);
	app.kernel.prefs.set('inspector.pdfFolder.enable', true);
	app.kernel.prefs.set('inspector.wordCite.enable', true);
	assert.equal(env.registeredPanes.size, 5);

	app.shutdown();
	assert.equal(env.registeredPanes.size, 0);
	delete globalThis.Zotero;
});

test('Domain C: Document path disambiguation, P1-B foreground sync & ownership tag governance', async () => {
	const env = createMockZoteroEnv();
	globalThis.Zotero = env.mockZotero;
	const item1 = env.makeItem(101, { title: 'Paper A', year: '2025' });
	const item2 = env.makeItem(102, { title: 'Paper B', year: '2026' }, { initialTags: ['/Citations'] });
	const readOnlyItem = env.makeItem(103, { title: 'Group Paper', year: '2024' }, { editable: false });

	const names = disambiguateDocumentNames([
		{ sessionID: 's1', path: 'D:\\Thesis\\Chapter1\\draft.docx' },
		{ sessionID: 's2', path: 'D:\\Thesis\\Chapter2\\draft.docx' },
	]);
	assert.equal(names.get('s1'), 'draft.docx (Chapter1)');
	assert.equal(names.get('s2'), 'draft.docx (Chapter2)');

	const mem = createMemoryPrefs();
	const app = new BridgeFlowApp({ prefAdapter: mem.adapter });
	app.init({ id: 'bridgeflow@groele', version: '0.0.1', rootURI: 'chrome://test/' });
	await app.start();

	app.wordCite.tracker.syncSessions([
		{
			sessionID: 's1',
			documentPath: 'D:\\Thesis\\manuscript.docx',
			citations: [
				{ itemID: 101, ordinal: 1, shortText: 'Vaswani et al., 2025' },
				{ itemID: 102, ordinal: 2, shortText: 'Manual Tag Paper' },
				{ itemID: 103, ordinal: 3, shortText: 'ReadOnly Paper' },
			],
		},
		{
			sessionID: 's2',
			documentPath: 'D:\\Thesis\\review.docx',
			citations: [{ itemID: 101, ordinal: 1, shortText: 'Vaswani et al., 2025' }],
		},
	]);

	// P1-B unique foreground title switches active session
	assert.equal(app.wordCite.tracker.syncForegroundActiveSession('review.docx - Word'), true);
	assert.equal(app.wordCite.tracker.getActiveSession()?.sessionID, 's2');

	await app.wordCite.tagGovernance.syncCitedItems(new Set([101, 102, 103]));
	assert.equal(item1._tags.has('/Citations'), true);
	assert.equal(item2._tags.has('/Citations'), true);
	assert.equal(readOnlyItem._tags.has('/Citations'), false);

	// Disabling tags strips only plugin-managed item1, preserving manual tag on item2
	app.kernel.prefs.set('wordCite.citationTags.enable', false);
	await app.wordCite.tagGovernance.syncCitedItems(new Set([101, 102, 103]));
	assert.equal(item1._tags.has('/Citations'), false);
	assert.equal(item2._tags.has('/Citations'), true);

	app.shutdown();
	delete globalThis.Zotero;
});

test('Fusion Bridges 1-4: Tab copy -> Reverse lookup -> Jump open tab + Word badge & Spotlight grouping', async () => {
	const env = createMockZoteroEnv();
	globalThis.Zotero = env.mockZotero;
	env.makeItem(201, { title: 'Attention Is All You Need', year: '2017', DOI: '10.48550/arXiv.1706.03762' });
	env.makeItem(202, { title: 'Deep Residual Learning', year: '2016' });

	const win = createMockWindow([
		{ id: 'tab-201', type: 'reader', data: { itemID: 201 }, title: 'Attention Is All You Need' },
		{ id: 'tab-202', type: 'reader', data: { itemID: 202 }, title: 'Deep Residual Learning' },
	]);
	env.mockZotero.getMainWindow = () => win;

	const mem = createMemoryPrefs();
	const app = new BridgeFlowApp({ prefAdapter: mem.adapter });
	app.init({ id: 'bridgeflow@groele', version: '0.0.1', rootURI: 'chrome://test/' });
	await app.start();
	app.onMainWindowLoad(win);

	// Fusion 1: Copy citation from Workspace tab menu -> auto-recorded in Inspector reverse-lookup history
	const copied = await app.workspace.tabs.copyTabCitation(win, 'tab-201');
	assert.equal(copied, true);
	const lookupHits = await app.inspector.lookupQuery('Vaswani, 2017. Attention Is All You Need.');
	assert.equal(lookupHits[0]?.itemID, 201);
	assert.equal(lookupHits[0]?.source, 'history-exact');

	// Fusion 4: Reverse lookup emits open-item-request -> Workspace focuses existing tab & uncollapses its group
	const grp = app.workspace.store.createGroup('Transformers');
	app.workspace.store.assignToGroup('item:201', grp.id);
	app.workspace.store.setCollapsed(grp.id, true);
	win.Zotero_Tabs.select('tab-202');

	app.kernel.bus.emit('workspace:open-item-request', { itemID: 201, preferExistingTab: true });
	await new Promise((r) => setTimeout(r, 10));
	assert.equal(win._getSelected(), 'tab-201');
	assert.equal(app.workspace.store.state.collapsed.includes(grp.id), false);

	// Fusion 2 & 3: Word citation snapshot -> Spotlight shows active Word items & one-click group command
	app.wordCite.tracker.syncSessions([
		{
			sessionID: 'doc-1',
			documentPath: 'D:\\Papers\\survey.docx',
			citations: [{ itemID: 202, ordinal: 1, shortText: 'He et al., 2016' }],
		},
	]);

	const spotlightResults = app.workspace.spotlight.query('>survey.docx', win);
	const groupCmd = spotlightResults.find((r) => r.id.startsWith('cmd:group-word:'));
	assert.ok(groupCmd, 'Expected Spotlight cross-domain group command');
	const matrixCmd = spotlightResults.find((r) => r.id.startsWith('cmd:matrix-word:'));
	assert.ok(matrixCmd, 'Expected Spotlight Word-to-Matrix command');
	let matrixPayload = null;
	const offMatrix = app.kernel.bus.on('visual-notes:open-matrix', (p) => { matrixPayload = p; });
	await matrixCmd.action();
	offMatrix();
	assert.deepEqual(matrixPayload?.itemIDs, [202]);
	await groupCmd.action();
	const surveyGroup = app.workspace.store.state.groups.find((g) => g.name === 'survey.docx');
	assert.ok(surveyGroup?.memberKeys.includes('item:202'), 'Expected cited open tab to be grouped into survey.docx');

	app.shutdown();
	delete globalThis.Zotero;
});

function createMockElement(tag, ownerDocument) {
	const attrs = new Map();
	const listeners = new Map();
	const classes = new Set();
	const children = [];
	const el = {
		tagName: String(tag).toUpperCase(),
		localName: String(tag).toLowerCase(),
		ownerDocument,
		children,
		parentElement: null,
		hidden: false,
		disabled: false,
		open: false,
		textContent: '',
		title: '',
		type: '',
		id: '',
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
			else ownerDocument?.dispatchEvent?.(evt);
			return true;
		},
		click() { el.dispatchEvent({ type: 'click', target: el, preventDefault() {}, stopPropagation() {} }); },
		closest(selector) {
			let cur = el;
			while (cur) {
				if (selector.includes('zbf-pane-word-cite-sidenav') && cur.getAttribute?.('data-l10n-id') === 'zbf-pane-word-cite-sidenav' && cur.parentElement?.localName === 'item-pane-sidenav') return cur;
				if (cur.localName === selector) return cur;
				cur = cur.parentElement;
			}
			return null;
		},
	};
	return el;
}

function createMockDocument(win) {
	const docListeners = new Map();
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
		addEventListener(evt, fn, opts) {
			if (!docListeners.has(evt)) docListeners.set(evt, new Set());
			docListeners.get(evt).add(fn);
			opts?.signal?.addEventListener?.('abort', () => docListeners.get(evt)?.delete(fn));
		},
		dispatchEvent(evt) {
			for (const fn of [...(docListeners.get(evt.type) || [])]) fn(evt);
		},
	};
	doc.head = doc.createElement('head');
	doc.documentElement = doc.createElement('html');
	return doc;
}

test('WordSessionTracker tracks occurrences, totalCitedCount, sessions and manual session switch', () => {
	const app = new BridgeFlowApp({ prefAdapter: createMemoryPrefs().adapter });
	app.init({ id: 'bridgeflow@test', version: '0.1.4', rootURI: 'chrome://test/' });
	const snapshots = [];
	app.kernel.bus.on('citation:snapshot-updated', (s) => snapshots.push(s));

	app.wordCite.tracker.syncSessions([
		{
			sessionID: 'doc-a',
			documentPath: 'C:\\Papers\\draft.docx',
			citations: [
				{ itemID: 101, ordinal: 1, occurrences: 3, shortText: '(Author, 2024)' },
				{ itemID: 102, ordinal: 2, occurrences: 1, shortText: '(Lee, 2025)' },
			],
		},
		{
			sessionID: 'doc-b',
			documentPath: 'C:\\Papers\\notes.docx',
			citations: [{ itemID: 103, ordinal: 1, occurrences: 2, shortText: '(Kim, 2023)' }],
		},
	]);

	const snap1 = snapshots.at(-1);
	assert.equal(snap1.activeSessionID, 'doc-a');
	assert.equal(snap1.totalCitedCount, 2);
	assert.equal(snap1.byItemID.get(101)?.occurrences, 3);
	assert.equal(snap1.sessions?.length, 2);
	assert.equal(snap1.sessions?.[1].documentName, 'notes.docx');

	const switched = app.wordCite.tracker.setActiveSession('doc-b');
	assert.equal(switched, true);
	const snap2 = snapshots.at(-1);
	assert.equal(snap2.activeSessionID, 'doc-b');
	assert.equal(snap2.totalCitedCount, 1);
	assert.equal(snap2.byItemID.get(103)?.occurrences, 2);
});

test('WordCiteSectionController Plan C: sidenav click only opens panel; buttons dispatch Word & Workspace synergy actions', () => {
	const item201 = {
		id: 201, libraryID: 1, key: 'KEY201', deleted: false,
		isRegularItem: () => true, isTrashed: () => false,
		getField: (f) => (f === 'title' ? 'Optical Microcavity' : f === 'date' ? '2024' : ''),
		getCreators: () => [{ lastName: 'Wu' }, { lastName: 'Li' }],
	};
	const sections = [];
	globalThis.Zotero = {
		locale: 'zh-CN',
		Items: { get: (id) => (id === 201 ? item201 : null) },
		ItemPaneManager: {
			registerSection(desc) { sections.push(desc); return `sec-${sections.length}`; },
			unregisterSection() {},
		},
	};

	const app = new BridgeFlowApp({
		prefAdapter: createMemoryPrefs({
			'inspector.wordCite.enable': true,
			'modules.wordCite.enable': true,
			'wordCite.dragCite.enable': true,
		}).adapter,
	});
	app.init({ id: 'bridgeflow@test', version: '0.1.4', rootURI: 'chrome://test/' });
	const inserts = [];
	const refreshes = [];
	const switches = [];
	const colSelects = [];
	app.kernel.bus.on('word:insert-items-request', (e) => inserts.push(e));
	app.kernel.bus.on('word:refresh-request', (e) => refreshes.push(e));
	app.kernel.bus.on('word:switch-session-request', (e) => switches.push(e));
	app.kernel.bus.on('word:select-collection-request', (e) => colSelects.push(e));

	app.inspector.wordCiteSection.register();
	const registered = sections.find((s) => s.paneID === 'bridgeflow-word-cite');
	assert.ok(registered, 'Expected bridgeflow-word-cite section registration');

	const win = { ZoteroPane: { getSelectedItems: () => [item201] } };
	const doc = createMockDocument(win);
	const collapsible = doc.createElement('collapsible-section');
	collapsible.open = false;
	const body = doc.createElement('div');
	collapsible.appendChild(body);
	const sidenav = doc.createElement('item-pane-sidenav');
	const sidenavBtn = doc.createElement('button');
	sidenavBtn.setAttribute('data-l10n-id', 'zbf-pane-word-cite-sidenav');
	sidenav.appendChild(sidenavBtn);

	let latestSummary = '';
	registered.onInit({
		doc, body, item: item201,
		setEnabled() {},
		setSectionSummary(s) { latestSummary = s; },
	});

	app.kernel.bus.emit('citation:snapshot-updated', {
		activeSessionID: 'doc-a',
		activeDocumentName: 'de.docx',
		totalCitedCount: 14,
		citedItemIDs: [201],
		byItemID: new Map([[201, { itemID: 201, ordinal: 3, occurrences: 2, shortText: '[3]', documentName: 'de.docx', sessionID: 'doc-a' }]]),
		sessions: [
			{ sessionID: 'doc-a', documentName: 'de.docx', totalCitedCount: 14, byItemID: new Map() },
			{ sessionID: 'doc-b', documentName: 'si.docx', totalCitedCount: 5, byItemID: new Map() },
		],
	});
	app.kernel.bus.emit('workspace:groups-updated', {
		groups: [{ groupId: 'g1', groupName: '核心基底', itemIDs: [201, 202, 203] }],
	});

	assert.equal(latestSummary, '序号 [3] · 共引 14 篇');
	const wrap = body.children[0];
	const [docCard, citeCard, receipt] = wrap.children;
	const [docRow, statStrip] = docCard.children;
	const [, docMeta, docSwitchBtn] = docRow.children;
	const [docNameEl] = docMeta.children;
	const [citedCell, inTextCell, orphanCell] = statStrip.children;
	const [citeHead, citeTitleEl, , actions, synergy] = citeCard.children;
	const [, ordBadgeEl] = citeHead.children;
	const [insertBtn, refreshBtn] = actions.children;
	const [groupBtn, colBtn] = synergy.children;

	assert.equal(docNameEl.textContent, 'de.docx');
	assert.equal(citedCell.children[0].textContent, '14');
	assert.equal(inTextCell.children[0].textContent, '2');
	assert.equal(orphanCell.children[0].textContent, '0');
	assert.equal(ordBadgeEl.textContent, '[3] · 2次');
	assert.equal(citeTitleEl.textContent, 'Optical Microcavity');
	assert.equal(groupBtn.textContent, '↗ 引用所在分组「核心基底」(3)');
	assert.equal(colBtn.hidden, false);
	assert.equal(colBtn.textContent, '文集：/Citations');

	// Critical UX rule: clicking sidenav W+ icon ONLY opens section and NEVER cites
	sidenavBtn.click();
	assert.equal(collapsible.open, true);
	assert.equal(inserts.length, 0);

	const otherDoc = createMockDocument({ ZoteroPane: { getSelectedItems: () => [item201] } });
	const otherBody = otherDoc.createElement('div');
	registered.onInit({ doc: otherDoc, body: otherBody, item: item201 });
	const otherReceipt = otherBody.children[0].children[2];

	// The host may isolate panel events from document-level delegation.
	doc.dispatchEvent = () => true;
	insertBtn.click();
	assert.deepEqual(inserts.at(-1)?.itemIDs, [201]);
	assert.equal(insertBtn.disabled, true);
	assert.equal(refreshBtn.disabled, true);
	assert.equal(groupBtn.disabled, true);
	assert.match(receipt.textContent, /正在插入/);
	assert.equal(otherReceipt.hidden, true);
	insertBtn.click();
	assert.equal(inserts.length, 1);
	app.kernel.bus.emit('word:insert-result', { requestId: 'stale', status: 'inserted', documentName: '', itemCount: 1 });
	assert.equal(insertBtn.disabled, true);
	app.kernel.bus.emit('word:insert-result', { requestId: inserts[0].requestId, status: 'inserted', documentName: 'de.docx', itemCount: 1 });
	assert.match(receipt.textContent, /✓ 已插入/);
	assert.equal(otherReceipt.hidden, true);
	assert.equal(insertBtn.disabled, false);

	groupBtn.click();
	assert.deepEqual(inserts.at(-1)?.itemIDs, [201, 202, 203]);
	app.kernel.bus.emit('word:insert-result', { requestId: inserts[1].requestId, status: 'unavailable', documentName: '', itemCount: 3 });
	assert.match(receipt.textContent, /插入失败/);
	assert.equal(insertBtn.disabled, false);

	refreshBtn.click();
	assert.equal(refreshes.length, 1);

	docSwitchBtn.click();
	assert.equal(switches.at(-1)?.sessionID, 'doc-b');

	colBtn.click();
	assert.equal(colSelects.at(-1)?.sessionID, 'doc-a');

	app.kernel.bus.emit('word:refresh-result', { requestId: refreshes[0].requestId, ok: true, documentName: 'de.docx' });
	assert.match(receipt.textContent, /已刷新/);

	// Plan C UI switches hide/show sub-elements dynamically
	app.kernel.prefs.set('inspector.wordCite.showDocSwitcher', false);
	app.kernel.prefs.set('inspector.wordCite.showSummaryCounts', false);
	app.kernel.prefs.set('inspector.wordCite.showGroupSynergy', false);
	app.kernel.prefs.set('inspector.wordCite.showCollectionLink', false);
	app.inspector.wordCiteSection.refreshAll();
	assert.equal(docRow.hidden, true);
	assert.equal(statStrip.hidden, true);
	assert.equal(docCard.hidden, true);
	assert.equal(groupBtn.hidden, true);
	assert.equal(colBtn.hidden, true);
	assert.equal(synergy.hidden, true);
	assert.equal(latestSummary, '');

	app.inspector.wordCiteSection.unregister();
	delete globalThis.Zotero;
});

test('WordCite switches: dragCite=false still allows Plan C & menus; column.enable dynamically toggles Citation column', async () => {
	const registeredCols = [];
	const unregisteredKeys = [];
	globalThis.Zotero = {
		locale: 'zh-CN',
		ItemTreeManager: {
			registerColumns(desc) { registeredCols.push(desc.dataKey); return 'col-key-1'; },
			unregisterColumns(keys) { unregisteredKeys.push(...keys); },
		},
		getMainWindows: () => [],
	};
	const app = new BridgeFlowApp({
		prefAdapter: createMemoryPrefs({
			'wordCite.dragCite.enable': false,
			'wordCite.column.enable': true,
			'wordCite.tabContextMenu.enable': true,
			'inspector.wordCite.enable': true,
			'workspace.remarkColumn.enable': false,
			'workspace.readingColumn.enable': false,
			'workspace.annotationColumn.enable': false,
			'visualNotes.statusColumn.enable': false,
			'visualNotes.ratingColumn.enable': false,
		}).adapter,
	});
	app.init({ id: 'bridgeflow@test', version: '0.1.4', rootURI: 'chrome://test/' });
	await app.start();

	assert.deepEqual(registeredCols, ['bridgeflowCitation']);
	assert.equal(app.workspace.tabs.citeItemsInWord({}, [201]), true, 'tabContextMenu should still work when dragCite is false');
	assert.equal(await app.wordCite.dragCite.handleDropEnd([{ id: 201 }]), 'unavailable', 'drag-drop should stay disabled');

	app.kernel.prefs.set('wordCite.column.enable', false);
	assert.deepEqual(unregisteredKeys, ['col-key-1']);
	app.kernel.prefs.set('wordCite.column.enable', true);
	assert.equal(registeredCols.length, 2);

	app.shutdown();
	delete globalThis.Zotero;
});

test('Preferences completeness: every user-facing PREF_SCHEMA key is exposed in prefs.xhtml and vice versa', () => {
	const xhtml = fs.readFileSync(path.resolve(process.cwd(), 'prefs.xhtml'), 'utf8');
	const exposed = new Set();
	for (const m of xhtml.matchAll(/preference="extensions\.zotero\.bridgeflow\.([^"]+)"/g)) exposed.add(m[1]);
	for (const m of xhtml.matchAll(/data-zbf-pref="([^"]+)"/g)) exposed.add(m[1]);

	const runtimeOnly = new Set(['workspace.document', 'workspace.verticalSidebarCollapsed', 'visualNotes.statusCustomColors']);
	const missingFromUI = Object.keys(PREF_SCHEMA).filter((k) => !runtimeOnly.has(k) && !exposed.has(k));
	const unknownInUI = [...exposed].filter((k) => !(k in PREF_SCHEMA) && !k.startsWith(PREF_PREFIX));

	assert.deepEqual(missingFromUI, [], `Prefs missing from prefs.xhtml: ${missingFromUI.join(', ')}`);
	assert.deepEqual(unknownInUI, [], `Unknown prefs in prefs.xhtml: ${unknownInUI.join(', ')}`);
});
