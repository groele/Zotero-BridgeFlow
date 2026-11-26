import test from 'node:test';
import assert from 'node:assert/strict';

import { TypedEventBus } from '../src/kernel/event-bus.ts';
import { NativeRuntime } from '../src/kernel/native-runtime.ts';
import { PluginKernel } from '../src/kernel/plugin-kernel.ts';
import { UnifiedPrefService } from '../src/kernel/pref-service.ts';
import {
	clearStatusRatingCaches,
	getItemRating,
	getItemStatus,
	setItemRating,
	setItemStatus,
} from '../src/services/item-status-rating.ts';
import {
	collectItemAnnotations,
	extractFourDigitYear,
	mergeAnnotationsByIDs,
} from '../src/services/annotation-utils.ts';
import { buildAnnotationMatrixFromCollected } from '../src/services/annotation-matrix.ts';
import { collectHubNotes } from '../src/services/collection-notes.ts';
import { syncItemRemarkToExtra } from '../src/services/item-remark-sync.ts';
import { CitationHistoryStore } from '../src/services/citation-history-store.ts';
import { CitationLookupEngine } from '../src/domains/inspector/citation-lookup-engine.ts';
import {
	buildMetadataRemindersModel,
	clearReminderFieldsCache,
	DEFAULT_REMINDER_RULE_CONFIG,
} from '../src/domains/inspector/word-cite-reminders-model.ts';
import { ReaderPopupLabelsController } from '../src/domains/visual-notes/annotation-popup-labels.ts';
import { patchCollectionsViewForWindow } from '../src/domains/word-cite/collection-tree-order.ts';

function createMemoryPrefs(initial = {}) {
	const store = new Map(Object.entries(initial));
	const observers = new Map();
	let nextId = 1;
	let registerCalls = 0;
	return {
		store,
		get registerCalls() { return registerCalls; },
		get observerCount() { return observers.size; },
		emitExternal(fullKey, value) {
			store.set(fullKey, value);
			for (const [, obs] of observers) {
				if (obs.key === fullKey) obs.fn();
			}
		},
		adapter: {
			get(key) { return store.get(key); },
			set(key, val) {
				store.set(key, val);
				for (const [, obs] of observers) {
					if (obs.key === key) obs.fn();
				}
			},
			registerObserver(key, fn) {
				registerCalls++;
				const id = nextId++;
				observers.set(id, { key, fn });
				return id;
			},
			unregisterObserver(id) { observers.delete(id); },
		},
	};
}

test('UnifiedPrefService registers at most one host observer per key and emits prefs:changed once per set()', () => {
	const mem = createMemoryPrefs();
	const bus = new TypedEventBus();
	const prefs = new UnifiedPrefService({ bus, adapter: mem.adapter });

	const busEvents = [];
	const sub1Events = [];
	const sub2Events = [];
	bus.on('prefs:changed', (e) => busEvents.push(e));

	assert.equal(prefs.get('workspace.verticalSidebarWidth'), 276);
	const d1 = prefs.observeKeys(['workspace.verticalSidebarWidth'], (k, v) => sub1Events.push([k, v]));
	const d2 = prefs.observeKeys(['workspace.verticalSidebarWidth'], (k, v) => sub2Events.push([k, v]));
	assert.equal(mem.registerCalls, 1);
	assert.equal(mem.observerCount, 1);

	prefs.set('workspace.verticalSidebarWidth', 310);
	assert.equal(busEvents.length, 1);
	assert.deepEqual(busEvents[0], { key: 'workspace.verticalSidebarWidth', value: 310 });
	assert.deepEqual(sub1Events, [['workspace.verticalSidebarWidth', 310]]);
	assert.deepEqual(sub2Events, [['workspace.verticalSidebarWidth', 310]]);

	d1();
	mem.emitExternal('extensions.zotero.bridgeflow.workspace.verticalSidebarWidth', 340);
	assert.equal(busEvents.length, 2);
	assert.deepEqual(sub1Events, [['workspace.verticalSidebarWidth', 310]]);
	assert.deepEqual(sub2Events, [['workspace.verticalSidebarWidth', 310], ['workspace.verticalSidebarWidth', 340]]);

	d2();
	prefs.dispose();
	assert.equal(mem.observerCount, 0);
});

test('setItemStatus and setItemRating preserve untouched item caches instead of wiping all 5000 entries', async () => {
	clearStatusRatingCaches();
	let aTagCalls = 0;
	let bTagCalls = 0;
	let bExtraCalls = 0;
	const itemA = {
		id: 101,
		version: 1,
		libraryID: 1,
		deleted: false,
		_tags: [{ tag: '/待读' }],
		_extra: 'Rating: 2',
		isRegularItem: () => true,
		getTags() { aTagCalls++; return this._tags; },
		addTag(t) { this._tags.push({ tag: t }); },
		removeTag(t) { this._tags = this._tags.filter((e) => e.tag !== t); },
		getField(f) { return f === 'extra' ? this._extra : ''; },
		setField(f, v) { if (f === 'extra') this._extra = v; },
		async saveTx() { this.version++; },
	};
	const itemB = {
		id: 202,
		version: 5,
		libraryID: 1,
		deleted: false,
		_tags: [{ tag: '/精读' }],
		_extra: 'Rating: 4',
		isRegularItem: () => true,
		getTags() { bTagCalls++; return this._tags; },
		getField(f) { if (f === 'extra') bExtraCalls++; return f === 'extra' ? this._extra : ''; },
	};

	assert.equal(getItemStatus(itemA)?.tag, '/待读');
	assert.equal(getItemStatus(itemB)?.tag, '/精读');
	assert.equal(getItemRating(itemA, 'extra'), 2);
	assert.equal(getItemRating(itemB, 'extra'), 4);
	assert.equal(aTagCalls, 2);
	assert.equal(bTagCalls, 2);
	assert.equal(bExtraCalls, 1);

	await setItemStatus(itemA, '/已读');
	await setItemRating(itemA, 5, 'extra');

	// Item B must remain a cache hit across both status and rating lookups
	assert.equal(getItemStatus(itemB)?.tag, '/精读');
	assert.equal(getItemRating(itemB, 'extra'), 4);
	assert.equal(bTagCalls, 2);
	assert.equal(bExtraCalls, 1);
	assert.equal(getItemStatus(itemA)?.tag, '/已读');
	assert.equal(getItemRating(itemA, 'extra'), 5);
	clearStatusRatingCaches();
});

test('extractFourDigitYear fixes month-prefix truncation across annotation utils, matrix, hub, and lookup engine', async () => {
	assert.equal(extractFourDigitYear('May 15, 2024'), '2024');
	assert.equal(extractFourDigitYear('15/06/2023'), '2023');
	assert.equal(extractFourDigitYear('1998'), '1998');
	assert.equal(extractFourDigitYear('unpublished'), '');

	const prevZotero = globalThis.Zotero;
	try {
		const att = {
			id: 701,
			deleted: false,
			isFileAttachment: () => true,
			getAnnotations: () => [{
				id: 801,
				deleted: false,
				annotationColor: '#ffd400',
				annotationText: 'Key context sentence',
				annotationComment: 'Read again',
				annotationPageLabel: '12',
				getTags: () => [],
			}],
		};
		const item = {
			id: 700,
			deleted: false,
			firstCreator: 'Alice',
			title: 'Electrochemical Catalyst',
			isRegularItem: () => true,
			getAttachments: () => [701],
			getNotes: () => [],
			getField: (f) => (f === 'title' ? 'Electrochemical Catalyst' : f === 'date' ? 'May 15, 2024' : f === 'pages' ? '12-20' : ''),
		};
		globalThis.Zotero = { Items: { get: (id) => (id === 701 ? att : id === 700 ? item : null) } };

		const anns = collectItemAnnotations([item], {});
		assert.equal(anns.length, 1);
		assert.equal(anns[0].creatorYear, 'Alice 2024');

		const matrix = buildAnnotationMatrixFromCollected([item], { '#ffd400': 'Context' }, anns);
		assert.equal(matrix.rows[0]?.creatorYear, 'Alice 2024');

		const hubNotes = collectHubNotes([item], () => 'Brief summary');
		assert.equal(hubNotes.entries[0]?.creatorYear, 'Alice 2024');

		const engine = new CitationLookupEngine(new CitationHistoryStore());
		// Page "12" must NOT match "2012" substring, and date "May 15, 2024" extracts year "2024"
		const noFalseHit = await engine.lookup('Smith, Unknown Journal 2012, p. 120', [item]);
		assert.equal(noFalseHit.length, 0);
		const trueHit = await engine.lookup('Alice, Unknown Journal 2024, p. 12', [item]);
		assert.equal(trueHit.length, 1);
		assert.equal(trueHit[0].itemID, 700);
	} finally {
		globalThis.Zotero = prevZotero;
	}
});

test('mergeAnnotationsByIDs rejects unparented (parentID=0) and read-only sibling annotations atomically', async () => {
	const prevZotero = globalThis.Zotero;
	try {
		const orphanA = { id: 1, parentID: 0, itemType: 'annotation', annotationText: 'A', annotationComment: '' };
		const orphanB = { id: 2, parentID: 0, itemType: 'annotation', annotationText: 'B', annotationComment: '' };
		let saveCalls = 0;
		const writableAnn = {
			id: 11, parentID: 50, itemType: 'annotation', editable: true,
			annotationText: 'First', annotationComment: '',
			async saveTx() { saveCalls++; },
		};
		const readOnlySibling = {
			id: 12, parentID: 50, itemType: 'annotation', editable: false,
			annotationText: 'Second', annotationComment: '',
			async saveTx() { saveCalls++; },
		};
		const map = new Map([[1, orphanA], [2, orphanB], [11, writableAnn], [12, readOnlySibling]]);
		globalThis.Zotero = { Items: { get: (id) => map.get(id) || null } };

		const orphanRes = await mergeAnnotationsByIDs([1, 2]);
		assert.equal(orphanRes.ok, false);

		const roRes = await mergeAnnotationsByIDs([11, 12]);
		assert.equal(roRes.ok, false);
		assert.equal(writableAnn.annotationText, 'First');
		assert.equal(saveCalls, 0);
	} finally {
		globalThis.Zotero = prevZotero;
	}
});

test('buildMetadataRemindersModel memoizes by item version and ReaderPopupLabelsController avoids repeat JSON parses', () => {
	clearReminderFieldsCache();
	let fieldGets = 0;
	const item = {
		id: 901,
		version: 7,
		itemType: 'journalArticle',
		firstCreator: 'Bob',
		isRegularItem: () => true,
		getCreators: () => [{ lastName: 'Bob', creatorType: 'author' }],
		getField(f) {
			fieldGets++;
			if (f === 'title') return 'Sample Article';
			if (f === 'date' || f === 'year') return '2025';
			return '';
		},
	};
	const common = {
		zh: true,
		snap: null,
		selectedItems: [item],
		isIgnored: () => false,
		expanded: false,
		filter: 'active',
		rules: DEFAULT_REMINDER_RULE_CONFIG,
	};
	const m1 = buildMetadataRemindersModel(common);
	const afterFirst = fieldGets;
	const m2 = buildMetadataRemindersModel(common);
	// Second pass reads title + year (via buildReminderItemKeys & safeGetItemField) but skips inspectItemMetadataFields checks
	const secondDelta = fieldGets - afterFirst;
	assert.ok(secondDelta < afterFirst, `Expected memoized inspection calls (${secondDelta} < ${afterFirst})`);
	assert.deepEqual(m2.rows[0].fields, m1.rows[0].fields);

	// Check JSON.parse memoization inside ReaderPopupLabelsController
	const mem = createMemoryPrefs({
		'extensions.zotero.bridgeflow.inspector.annotations.popupLabelsEnable': true,
		'extensions.zotero.bridgeflow.inspector.annotations.colorLabels': '{"#ffd400":"Ctx"}',
	});
	const kernel = new PluginKernel({ prefAdapter: mem.adapter });
	const ctrl = new ReaderPopupLabelsController(kernel);
	let parseCalls = 0;
	const origParse = JSON.parse;
	JSON.parse = (...args) => { parseCalls++; return origParse(...args); };
	try {
		ctrl.start();
		const s1 = ctrl['getSemantics']();
		const s2 = ctrl['getSemantics']();
		assert.equal(s1['#ffd400'], 'Ctx');
		assert.equal(s1, s2);
		assert.equal(parseCalls, 1);
	} finally {
		JSON.parse = origParse;
		ctrl.stop();
		kernel.shutdown();
		clearReminderFieldsCache();
	}
});

test('patchCollectionsViewForWindow propagates activeNames and syncItemRemarkToExtra serializes att + parent writes', async () => {
	const prevZotero = globalThis.Zotero;
	try {
		const runtime = new NativeRuntime();
		const addedRows = [];
		const colCited = { id: 10, key: 'COL_TEMP', name: 'Draft.docx', parentID: null, libraryID: 1, getRelationsByPredicate: () => [] };
		const pubRow = { type: 'publications', level: 1, isPublications: () => true };
		const libRow = { type: 'library', level: 0, isLibrary: () => true, ref: { libraryID: 1 } };
		const colOther = { type: 'collection', level: 1, isCollection: () => true, ref: { id: 2, key: 'OTHER', name: 'A Normal Col' } };
		const fakeCv = {
			_rows: [libRow, colOther, pubRow],
			_rowMap: { L1: 0 },
			isContainerOpen: () => true,
			isContainerEmpty: () => false,
			getLevel: (i) => fakeCv._rows[i]?.level ?? 0,
			getRow: (i) => fakeCv._rows[i],
			_refreshRowMap() {},
			tree: { invalidate() {} },
			_getIcon: () => ({ tag: 'orig' }),
			_addRow: (row, beforeRow) => addedRows.push({ row, beforeRow }),
			_expandRow: async () => 1,
			_addSortedRow: async () => 0,
		};
		const fakeWin = {
			ZoteroPane: { collectionsView: fakeCv },
			document: { createElementNS: (_ns, tag) => ({ tag }) },
		};
		globalThis.Zotero = {
			Collections: { get: (id) => (id === 10 ? colCited : null) },
			CollectionTreeRow: class {
				constructor(_cv, type, ref, level) {
					this.type = type;
					this.ref = ref;
					this.level = level;
				}
			},
		};
		const dispose = patchCollectionsViewForWindow(
			fakeWin,
			runtime,
			() => new Set(),
			undefined,
			() => new Set(['Draft.docx']),
		);
		// Matched purely via activeNames even before key is synced
		const insertedAt = await fakeCv._addSortedRow('collection', 10);
		assert.equal(insertedAt, 2);
		assert.equal(addedRows.length, 1);
		dispose();

		// syncItemRemarkToExtra serializes concurrent writes on attachment + parent item
		let parentExtra = '';
		const saveOrder = [];
		const parent = {
			id: 400,
			deleted: false,
			isRegularItem: () => true,
			getField: (f) => (f === 'extra' ? parentExtra : ''),
			setField: (f, v) => { if (f === 'extra') parentExtra = v; },
			async saveTx() {
				saveOrder.push(parentExtra);
				await new Promise((r) => setTimeout(r, 10));
			},
		};
		const att = { id: 401, deleted: false, isAttachment: () => true, parentItemID: 400 };
		globalThis.Zotero = { Items: { get: (id) => (id === 400 ? parent : id === 401 ? att : null) } };
		await Promise.all([
			syncItemRemarkToExtra(att, 'First from attachment'),
			syncItemRemarkToExtra(parent, 'Second from parent'),
		]);
		assert.equal(saveOrder.length, 2);
		assert.equal(parentExtra, 'BridgeFlow-Remark: Second from parent');
		let activeSaves = 0;
		let peakSaves = 0;
		parent.saveTx = async () => {
			peakSaves = Math.max(peakSaves, ++activeSaves);
			await new Promise(resolve => setImmediate(resolve));
			activeSaves--;
		};
		globalThis.Zotero.Items.get = () => null;
		globalThis.Zotero.Items.getAsync = async id => id === att.id ? att : parent;
		assert.deepEqual(await Promise.all([
			syncItemRemarkToExtra(att.id, 'Cold attachment'),
			syncItemRemarkToExtra(parent, 'Newest edit'),
		]), [true, true]);
		assert.equal(peakSaves, 1);
		assert.equal(parentExtra, 'BridgeFlow-Remark: Newest edit');
	} finally {
		globalThis.Zotero = prevZotero;
	}
});

test('CitationHistoryStore.searchFuzzyAsync and CitationLookupEngine.lookup run safely without global performance (XPCOM sandbox)', async () => {
	const desc = Object.getOwnPropertyDescriptor(globalThis, 'performance');
	try {
		Object.defineProperty(globalThis, 'performance', { value: undefined, configurable: true, writable: true });
		const history = new CitationHistoryStore();
		history.record({
			text: 'Ding et al., ACS Applied Materials & Interfaces 2024, 16, 12-20',
			libraryID: 1,
			itemKey: 'KEY_PERF_1',
			itemID: 910,
			title: 'Basal-plane ligand functionalization',
			style: 'apa',
		});
		const fuzzy = await history.searchFuzzyAsync('Ding ACS Applied Materials 2024', 5, 1);
		assert.equal(fuzzy.length, 1);

		const engine = new CitationLookupEngine(new CitationHistoryStore());
		const item = {
			id: 910,
			deleted: false,
			firstCreator: 'X. Ding',
			isRegularItem: () => true,
			getField: (f) => (f === 'title' ? 'Basal-plane ligand functionalization' : f === 'date' ? 'May 15, 2024' : f === 'pages' ? '12-20' : ''),
		};
		const hits = await engine.lookup('Ding, Some Journal 2024, p. 12', [item]);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].itemID, 910);
	} finally {
		if (desc) Object.defineProperty(globalThis, 'performance', desc);
	}
});

test('overlapping lookup reads share a fetch and invalidation wins over a late result', async (t) => {
	const pending = [];
	const previous = globalThis.Zotero;
	t.after(() => { globalThis.Zotero = previous; });
	globalThis.Zotero = { Items: { getAll: () => new Promise(resolve => pending.push(resolve)) } };
	const engine = new CitationLookupEngine(new CitationHistoryStore());
	const lookup = () => engine.resolveRich('example paper', { useHistory: false });
	const first = lookup();
	const duplicate = lookup();
	await Promise.resolve();
	assert.equal(pending.length, 1);
	engine.clearCache();
	const fresh = lookup();
	await Promise.resolve();
	assert.equal(pending.length, 2);
	const item = { id: 17, isRegularItem: () => true, getField: key => key === 'title' ? 'example paper' : '' };
	pending[1]([item]);
	await fresh;
	pending[0]([]);
	await Promise.all([first, duplicate]);
	assert.deepEqual((await lookup()).candidates.map(hit => hit.itemID), [17]);
});
