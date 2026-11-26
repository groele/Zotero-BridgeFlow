import test from 'node:test';
import assert from 'node:assert/strict';

import { PluginKernel } from '../src/kernel/plugin-kernel.ts';
import { ServiceContainer } from '../src/services/service-container.ts';
import { WordCiteDomainModule } from '../src/domains/word-cite/module.ts';
import { extractSessionCitationsWithOrphans } from '../src/domains/word-cite/orphan/orphan-extraction.ts';
import { clearRelinkedItemUris, classifySyncSafeRelinkUris, resolveItemIdFromUris } from '../src/domains/word-cite/orphan/orphan-identity.ts';
import { recoverOrphanCitations } from '../src/domains/word-cite/orphan/orphan-recovery.ts';
import { SpotlightFusionBridge } from '../src/bridges/spotlight-fusion-bridge.ts';
import { WorkspaceDomainModule } from '../src/domains/workspace/module.ts';
import { buildOrphanBannerModel, formatRecoverReceipt, OrphanSelectionState } from '../src/domains/inspector/word-panel/word-cite-panel-ui.ts';

function createItemStub(id, { title = `Paper ${id}`, inTrash = false, deleted = false, libraryID = 1, key = `K${id}` } = {}) {
	return {
		id,
		key,
		libraryID,
		deleted,
		inTrash: () => inTrash,
		isRegularItem: () => true,
		getField: (f) => (f === 'title' ? title : ''),
		collections: [],
		relations: new Map(),
		loadedDataTypes: new Set(),
		async loadDataType(dt) { this.loadedDataTypes.add(dt); },
		hasRelation(pred, obj) { return this.relations.get(pred)?.has(obj) ?? false; },
		addRelation(pred, obj) {
			if (!this.relations.has(pred)) this.relations.set(pred, new Set());
			this.relations.get(pred).add(obj);
			return true;
		},
		addToCollection(cid) { this.collections.push(cid); },
		saveCount: 0,
		async save() { this.saveCount += 1; return this.id; },
		async saveTx() { this.saveCount += 1; return this.id; },
	};
}

test('extractSessionCitationsWithOrphans preserves true document ordinals across trashed & missing items', () => {
	const prevZotero = globalThis.Zotero;
	const itemsById = new Map([
		[101, createItemStub(101, { title: 'Valid 1' })],
		[102, createItemStub(102, { title: 'Valid 2' })],
		[103, createItemStub(103, { title: 'Trashed 3', inTrash: true })],
		// 104 is completely deleted / missing from Zotero
		[105, createItemStub(105, { title: 'Valid 5' })],
	]);
	globalThis.Zotero = {
		Items: { get: (id) => itemsById.get(id) ?? null },
	};

	try {
		const session = {
			citationsByIndex: {
				0: {
					properties: { plainCitation: '1,2' },
					citationItems: [{ id: 101 }, { id: 102 }],
				},
				1: {
					properties: { plainCitation: '3,4' },
					citationItems: [
						{ id: 103 },
						{
							id: 104,
							uris: ['http://zotero.org/users/1/items/MISSING4'],
							itemData: {
								type: 'article-journal',
								title: 'Embedded Missing Study',
								author: [{ family: 'Zhang', given: 'Wei' }],
								issued: { 'date-parts': [[2025]] },
								DOI: '10.1000/missing.4',
							},
						},
					],
				},
				2: {
					properties: { plainCitation: '5' },
					citationItems: [{ id: 105 }],
				},
			},
			citationsByItemID: {
				101: [{ properties: { plainCitation: '1,2' } }],
				102: [{ properties: { plainCitation: '1,2' } }],
				103: [{ properties: { plainCitation: '3,4' } }],
				105: [{ properties: { plainCitation: '5' } }],
			},
		};

		const { citations, orphans } = extractSessionCitationsWithOrphans(session);
		const map = new Map(citations.map((c) => [c.itemID, c]));

		assert.equal(map.get(101)?.ordinal, 1);
		assert.equal(map.get(102)?.ordinal, 2);
		assert.equal(map.get(105)?.ordinal, 5, 'Valid item after 2 orphans must stay at ordinal 5, not shift to 3');
		assert.equal(map.has(103), false);
		assert.equal(map.has(104), false);

		assert.equal(orphans.length, 2);
		assert.equal(orphans[0].kind, 'trashed');
		assert.equal(orphans[0].ordinal, 3);
		assert.equal(orphans[0].title, 'Trashed 3');

		assert.equal(orphans[1].kind, 'missing');
		assert.equal(orphans[1].ordinal, 4);
		assert.equal(orphans[1].title, 'Embedded Missing Study');
		assert.equal(orphans[1].authorYear, 'Zhang, 2025');
	} finally {
		globalThis.Zotero = prevZotero;
	}
});

test('Bug #1/#2/#3 fixes: singular ci.uri, ephemeral surrogate dedup, citeproc sorted seq & post-refresh Trash URI lookup', () => {
	const prevZotero = globalThis.Zotero;
	clearRelinkedItemUris();
	const itemsById = new Map([
		[301, createItemStub(301, { title: 'Zhang Paper', key: 'ZHANG301' })],
		[302, createItemStub(302, { title: 'Brown Paper', key: 'BROWN302' })],
		// 303 is in Zotero Trash, AND Word was already refreshed so ci.id became 'sessA/rand303'
		[303, createItemStub(303, { title: 'Trashed After Refresh', key: 'TRASH303', deleted: true, inTrash: true })],
		[304, createItemStub(304, { title: 'Delayed Unindexed Paper', key: 'DELAY304' })],
	]);
	const keyToId = new Map([
		['1:ZHANG301', 301],
		['1:BROWN302', 302],
		['1:TRASH303', 303],
		['1:DELAY304', 304],
	]);

	globalThis.Zotero = {
		Users: { getCurrentUserID: () => 888, getLocalUserKey: () => 'MYLOCAL' },
		URI: {
			getURIItemID: (uri) => {
				const m = String(uri).match(/\/users\/(\d+)\/items\/([A-Z0-9]+)/i);
				if (!m) return false;
				// Simulate Zotero uri.js mapping any /users/ URI onto library 1
				return keyToId.get(`1:${m[2]}`) ?? false;
			},
		},
		Items: { get: (id) => itemsById.get(id) ?? null },
	};

	try {
		// Style sorts bibliography alphabetically:
		// [1] Adams (missing, legacy singular `uri`, cited twice with different surrogate IDs!)
		// [2] Brown (302)
		// [3] Li (missing without URI, cited twice with ephemeral 'sessA/ephem1' and 'sessA/ephem2')
		// [4] Trashed After Refresh (303, surrogate 'sessA/rand303', URI points to TRASH303)
		// [5] Delayed Unindexed Paper (304, not yet in citeproc registry -> must receive gap-filled ordinal 5)
		// [6] Zhang (301, cited first in text at index 0, but sorted to #6 in bibliography!)
		const session = {
			sessionID: 'sessA',
			style: {
				registry: {
					registry: {
						301: { seq: 6 },
						'sessA/adams1': { seq: 1 },
						302: { seq: 2 },
						'sessA/ephem1': { seq: 3 },
						'sessA/rand303': { seq: 4 },
						'sessA/foreign999': { seq: 7 },
					},
				},
			},
			citationsByIndex: {
				0: {
					properties: { plainCitation: '[6]' },
					citationItems: [{ id: 301 }],
				},
				1: {
					properties: { plainCitation: '[1, 3]' },
					citationItems: [
						// First hit lacks itemData (pasted legacy citation), uses singular `uri`
						{ id: 'sessA/adams1', uri: 'http://zotero.org/users/888/items/ADAMS001' },
						// Missing without URI, ephemeral id #1
						{
							id: 'sessA/ephem1',
							itemData: {
								id: 'sessA/ephem1',
								type: 'article-journal',
								title: ' Valleytronics in MoS2 ',
								author: [{ family: 'Li', given: 'Ming' }],
								issued: { 'date-parts': [[2024]] },
							},
						},
					],
				},
				2: {
					properties: { plainCitation: '[1, 2, 3, 4]' },
					citationItems: [
						// Repeated Adams hit now provides itemData -> must merge & NOT allocate a new ordinal!
						{
							id: 'sessA/adams2',
							uri: 'http://zotero.org/users/888/items/ADAMS001',
							itemData: { id: 'sessA/adams2', title: 'Adams Seminal Work', author: [{ family: 'Adams' }], issued: { 'date-parts': [[2020]] } },
						},
						{ id: 302 },
						// Repeated Li hit with brand-new ephemeral ID -> must dedup via title+author+year fingerprint!
						{
							id: 'sessA/ephem2',
							itemData: {
								id: 'sessA/ephem2',
								type: 'article-journal',
								title: 'valleytronics in mos2',
								author: [{ family: 'Li', given: 'Ming' }],
								issued: { 'date-parts': [[2024]] },
							},
						},
						// Trashed item whose numeric ID was wiped by Word Refresh -> must penetrate Trash via URI!
						{
							id: 'sessA/rand303',
							uris: ['http://zotero.org/users/888/items/TRASH303'],
							itemData: { id: 'sessA/rand303', title: 'Stale Embedded Title' },
						},
						// Foreign user URI that happens to share key TRASH303 -> must NOT spoof local Trash item 303!
						{
							id: 'sessA/foreign999',
							uris: ['http://zotero.org/users/999999/items/TRASH303'],
							itemData: { id: 'sessA/foreign999', title: 'Coauthor Paper', DOI: '10.1000/coauthor' },
						},
					],
				},
				3: {
					properties: { plainCitation: '[5]' },
					citationItems: [{ id: 304 }],
				},
			},
			citationsByItemID: {},
		};

		const { citations, orphans } = extractSessionCitationsWithOrphans(session);
		const validById = new Map(citations.map((c) => [c.itemID, c]));

		// Citeproc sorted ordinals + gap-free fallback ordinal
		assert.equal(validById.get(301)?.ordinal, 6, 'Zhang cited first in text gets true citeproc bibliography ordinal 6');
		assert.equal(validById.get(302)?.ordinal, 2);
		assert.equal(validById.get(304)?.ordinal, 5, 'Delayed unindexed item fills unused ordinal 5 instead of colliding with 6');

		// Orphans: Adams (#1), Li (#3), Trashed 303 (#4), Coauthor (#7) — zero duplicate slots!
		assert.equal(orphans.length, 4);
		assert.equal(orphans[0].ordinal, 1);
		assert.equal(orphans[0].title, 'Adams Seminal Work', 'Later occurrence itemData merged into first singular-uri hit');
		assert.deepEqual(orphans[0].uris, ['http://zotero.org/users/888/items/ADAMS001']);

		assert.equal(orphans[1].ordinal, 3);
		assert.equal(orphans[1].authorYear, 'Li, 2024');

		assert.equal(orphans[2].ordinal, 4);
		assert.equal(orphans[2].kind, 'trashed', 'Post-refresh trashed item resolved via URI as trashed, not missing');
		assert.equal(orphans[2].itemID, 303);
		assert.equal(orphans[2].title, 'Trashed After Refresh');

		assert.equal(orphans[3].kind, 'missing', 'Foreign co-author URI must not match local item key');
		assert.equal(orphans[3].itemID, undefined);
		assert.equal(orphans[3].ordinal, 7);
	} finally {
		clearRelinkedItemUris();
		globalThis.Zotero = prevZotero;
	}
});

test('Bug #4 & safety guardrails: single-tx recovery, dc:replaces relinking, local URI normalization, foreign URI guard, junk guard & auto-refresh', async () => {
	const prevZotero = globalThis.Zotero;
	clearRelinkedItemUris();

	let txCount = 0;
	let refreshCalls = 0;
	let nativeSessionID = 's1';
	let toastCount = 0;
	const trashedItem = createItemStub(203, { title: 'Trashed Paper With PDF', deleted: true, inTrash: true, key: 'TR203' });
	const existingDoiItem = createItemStub(209, { title: 'Existing DOI Paper', deleted: false, key: 'EX209' });
	const createdItems = [];
	let nextNewId = 500;

	class FakeZoteroItem {
		constructor(itemType) {
			this.id = 0;
			this.key = '';
			this.libraryID = 1;
			this.itemType = itemType;
			this.fields = {};
			this.creators = [];
			this.collections = [];
			this.relations = new Map();
		}
		setField(k, v) { this.fields[k] = v; }
		setCreators(c) { this.creators = c; }
		addToCollection(cid) { this.collections.push(cid); }
		hasRelation(pred, obj) { return this.relations.get(pred)?.has(obj) ?? false; }
		addRelation(pred, obj) {
			if (!this.relations.has(pred)) this.relations.set(pred, new Set());
			this.relations.get(pred).add(obj);
			return true;
		}
		async save() {
			this.id = ++nextNewId;
			this.key = `NEW${this.id}`;
			createdItems.push(this);
			return this.id;
		}
	}

	class FakeSearch {
		constructor() { this.conditions = []; }
		addCondition(f, op, v) { this.conditions.push([f, op, v]); }
		async search() {
			const hit = this.conditions.find((c) => c[0] === 'DOI' && c[2] === '10.1038/existing.209');
			return hit ? [209] : [];
		}
	}

	class FakeProgressWindow {
		changeHeadline() {}
		addDescription() {}
		show() { toastCount += 1; }
		startCloseTimer() {}
	}

	const itemsMap = new Map([
		[201, createItemStub(201, { title: 'Valid Cited 1' })],
		[203, trashedItem],
		[209, existingDoiItem],
	]);

	globalThis.Zotero = {
		isWin: true,
		isMac: false,
		Item: FakeZoteroItem,
		Search: FakeSearch,
		ProgressWindow: FakeProgressWindow,
		Relations: { replacedItemPredicate: 'dc:replaces' },
		Users: { getCurrentUserID: () => 888, getLocalUserKey: () => 'OWNLOCAL' },
		Libraries: { userLibraryID: 1, get: () => ({ editable: true }) },
		URI: {
			getItemURI: (it) => `http://zotero.org/users/888/items/${it.key}`,
			getURIItemID: () => false,
		},
		DB: {
			async executeTransaction(work) {
				txCount += 1;
				return work();
			},
		},
		Items: {
			get: (id) => itemsMap.get(id) || createdItems.find((x) => x.id === id) || null,
			getAsync: async (id) => itemsMap.get(id) || createdItems.find((x) => x.id === id) || null,
		},
		Integration: {
			Interface: class {
				constructor(app, doc, session) { this._app = app; this._doc = doc; this._session = session; }
				async refresh() { refreshCalls += 1; }
			},
			getApplication: () => ({
				getActiveDocument: async () => ({ doc: 'Paper.docx' }),
				getDocument: async () => ({ doc: 'Paper.docx' }),
			}),
			async execCommand(_agent, cmd) {
				const app = this.getApplication('WinWord', cmd, null);
				const doc = await app.getActiveDocument();
				await new this.Interface(app, doc, { sessionID: nativeSessionID })[cmd]();
			},
		},
		Prefs: { get: () => '', set: () => {}, registerObserver: () => 0, unregisterObserver: () => {} },
	};

	const kernel = new PluginKernel({ id: 'bridgeflow@groele', version: '0.6.3', rootURI: 'chrome://bridgeflow/' });
	const services = new ServiceContainer(kernel);
	const mod = new WordCiteDomainModule(kernel, services);

	try {
		mod.start();
		const sessionOrphans = [
			// 1. Trashed item -> in-place restore
			{ key: 'id:203', kind: 'trashed', itemID: 203, ordinal: 2, shortText: '2', title: 'Trashed Paper With PDF' },
			// 2. Permanently deleted own item (with legacy local URI + synced URI) -> rebuild + dc:replaces normalized to users/888
			{
				key: 'uri:http://zotero.org/users/local/OWNLOCAL/items/DEL204',
				kind: 'missing',
				ordinal: 3,
				shortText: '3',
				title: 'Rebuilt Paper',
				uris: ['http://zotero.org/users/local/OWNLOCAL/items/DEL204'],
				itemData: {
					type: 'article-journal',
					title: 'Rebuilt Paper',
					author: [{ family: 'Doe', given: 'Jane' }],
					issued: { 'date-parts': [[2024, 5]] },
					DOI: '10.1234/rebuilt',
					'container-title': 'Nature',
				},
			},
			// 3. Permanently deleted item whose DOI already exists in library (209) -> no duplicate created, dc:replaces attached to 209!
			{
				key: 'uri:http://zotero.org/users/888/items/OLD209',
				kind: 'missing',
				ordinal: 4,
				shortText: '4',
				title: 'Existing DOI Paper',
				uris: ['http://zotero.org/users/888/items/OLD209'],
				itemData: {
					type: 'article-journal',
					title: 'Existing DOI Paper',
					DOI: 'https://doi.org/10.1038/EXISTING.209',
				},
			},
			// 4. Co-author foreign URI (users/999999 !== 888) -> imported safely into Zotero, NO dc:replaces written!
			{
				key: 'uri:http://zotero.org/users/999999/items/COAUTH1',
				kind: 'missing',
				ordinal: 5,
				shortText: '5',
				title: 'Coauthor Paper',
				uris: ['http://zotero.org/users/999999/items/COAUTH1'],
				itemData: {
					type: 'article-journal',
					title: 'Coauthor Paper',
					author: [{ family: 'Kim' }],
					DOI: '10.5555/coauthor',
				},
			},
			// 5. Unembedded empty orphan (no itemData) -> must be skipped, NEVER create junk "Citation 6" item!
			{
				key: 'uri:http://zotero.org/users/888/items/NOEMBED6',
				kind: 'missing',
				ordinal: 6,
				shortText: '6',
				title: 'Citation 6',
				uris: ['http://zotero.org/users/888/items/NOEMBED6'],
			},
		];

		mod.tracker.syncSessions([{
			sessionID: 's1',
			documentPath: 'Paper.docx',
			citations: [{ itemID: 201, ordinal: 1, shortText: '1', occurrences: 1 }],
			orphans: sessionOrphans,
		}]);

		// Proactive ProgressWindow toast fired once for this orphan signature, and must not re-fire on identical snapshot
		assert.equal(toastCount, 1);
		mod.tracker.emitCurrentSnapshot();
		assert.equal(toastCount, 1, 'identical orphan set must not spam ProgressWindow toasts');

		const banner = buildOrphanBannerModel(mod.tracker.getSession('s1')?.orphans, true);
		assert.match(banner.title, /5 篇/);
		assert.match(banner.buttonLabel, /一键还原并导入 \(4\)/);

		const resultPromise = new Promise((resolve) => {
			kernel.bus.on('word:recover-orphans-result', (res) => resolve(res));
		});
		kernel.bus.emit('word:recover-orphans-request', { sessionID: 's1', requestId: 'rec-all' });
		const res = await resultPromise;

		assert.equal(res.requestId, 'rec-all');
		assert.equal(txCount, 1, 'entire recovery batch must execute inside a single Zotero.DB.executeTransaction');
		assert.equal(res.restoredCount, 1);
		assert.equal(res.importedCount, 2, 'Rebuilt Paper + Coauthor Paper imported; empty Citation 6 skipped; DOI 209 deduplicated');
		assert.equal(res.existingCount, 1);
		assert.equal(res.skippedCount, 1);
		assert.equal(res.relinkedCount, 3, 'trashed 203 + own rebuilt + own DOI 209 relinked');
		assert.equal(res.foreignSkippedCount, 1, 'foreign co-author URI excluded from dc:replaces');
		assert.equal(res.refreshed, true, 'active Word document automatically refreshed after recovery');
		assert.equal(refreshCalls, 1);
		nativeSessionID = 'another-document';
		const guarded = await new Promise(resolve => {
			kernel.bus.on('word:refresh-result', resolve);
			kernel.bus.emit('word:refresh-request', { requestId: 'stale-receipt', sessionID: 's1' });
		});
		assert.equal(guarded.ok, false);
		assert.equal(refreshCalls, 1);

		// Verify Trash restore
		assert.equal(trashedItem.deleted, false);

		// Verify existing DOI item loaded 'relations' datatype before attaching dc:replaces
		assert.equal(existingDoiItem.loadedDataTypes.has('relations'), true);
		assert.equal(existingDoiItem.hasRelation('dc:replaces', 'http://zotero.org/users/888/items/OLD209'), true);

		// Verify local URI normalized to synced users/888 URI for Cloud Sync safety
		const rebuilt = createdItems.find((it) => it.fields.title === 'Rebuilt Paper');
		assert.ok(rebuilt);
		assert.equal(rebuilt.hasRelation('dc:replaces', 'http://zotero.org/users/888/items/DEL204'), true);
		assert.equal(rebuilt.hasRelation('dc:replaces', 'http://zotero.org/users/local/OWNLOCAL/items/DEL204'), false);

		// Verify foreign co-author item has ZERO dc:replaces relations
		const coauth = createdItems.find((it) => it.fields.title === 'Coauthor Paper');
		assert.ok(coauth);
		assert.equal(coauth.relations.size, 0);

		// Verify immediate in-memory URI bridge resolves recovered items even before Word rewrites field JSON
		const postExtract = extractSessionCitationsWithOrphans({
			sessionID: 's1',
			citationsByIndex: {
				0: { properties: { plainCitation: '3,4' }, citationItems: [
					{ id: 's1/old204', uris: ['http://zotero.org/users/local/OWNLOCAL/items/DEL204'] },
					{ id: 's1/old209', uris: ['http://zotero.org/users/888/items/OLD209'] },
				] },
			},
		});
		assert.equal(postExtract.orphans.length, 0, 'relinked URIs resolve directly to recovered Zotero items');
		assert.deepEqual(postExtract.citations.map((c) => c.itemID), [rebuilt.id, 209]);

		// Verify receipt formatting for mixed & DOI-only outcomes
		const receipt = formatRecoverReceipt(res, true);
		assert.equal(receipt.tone, 'ok');
		assert.match(receipt.text, /已从回收站还原 1 篇/);
		assert.match(receipt.text, /已反向导入 2 篇/);
		assert.match(receipt.text, /已复用库内匹配文献 1 篇/);
		assert.match(receipt.text, /已执行 Word 刷新，请核对文内引文/);
		assert.match(receipt.text, /1 篇外部账号引文未写跨库映射/);

		const doiOnlyReceipt = formatRecoverReceipt({
			restoredCount: 0,
			importedCount: 0,
			skippedCount: 0,
			existingCount: 1,
			relinkedCount: 1,
			refreshed: false,
		}, true);
		assert.equal(doiOnlyReceipt.tone, 'ok', 'DOI-only match must report success, not warning');
		assert.match(doiOnlyReceipt.text, /请在目标 Word 文档刷新并核对引文/);
	} finally {
		mod.stop();
		clearRelinkedItemUris();
		globalThis.Zotero = prevZotero;
	}
});

test('Transaction rollback emits clean error receipt without leaving half-written state', async () => {
	const prevZotero = globalThis.Zotero;
	globalThis.Zotero = {
		Item: class { setField() {} async save() { throw new Error('SQLITE_FULL'); } },
		Libraries: { userLibraryID: 1 },
		DB: { executeTransaction: async (work) => work() },
		Items: { get: () => null },
		Prefs: { get: () => '', set: () => {}, registerObserver: () => 0, unregisterObserver: () => {} },
	};

	const kernel = new PluginKernel({ id: 'bridgeflow@groele', version: '0.6.3', rootURI: 'chrome://bridgeflow/' });
	const services = new ServiceContainer(kernel);
	const mod = new WordCiteDomainModule(kernel, services);

	try {
		mod.start();
		mod.tracker.syncSessions([{
			sessionID: 's-err',
			documentPath: 'Broken.docx',
			citations: [],
			orphans: [{
				key: 'o1',
				kind: 'missing',
				ordinal: 1,
				shortText: '1',
				title: 'Will Fail Save',
				itemData: { title: 'Will Fail Save', DOI: '10.1000/fail' },
			}],
		}]);

		const res = await new Promise((resolve) => {
			kernel.bus.on('word:recover-orphans-result', resolve);
			kernel.bus.emit('word:recover-orphans-request', { sessionID: 's-err', requestId: 'req-fail' });
		});
		assert.equal(res.requestId, 'req-fail');
		assert.equal(res.restoredCount, 0);
		assert.equal(res.importedCount, 0);
		assert.ok(res.error);
		assert.equal(formatRecoverReceipt(res, true).tone, 'err');
	} finally {
		mod.stop();
		globalThis.Zotero = prevZotero;
	}
});

test('recoverOrphanCitations deduplicates identical DOIs within the same recovery batch', async () => {
	const prevZotero = globalThis.Zotero;
	const saved = [];
	let seq = 800;
	globalThis.Zotero = {
		Users: { getCurrentUserID: () => 1 },
		Libraries: { userLibraryID: 1 },
		Relations: { replacedItemPredicate: 'dc:replaces' },
		Item: class {
			constructor() { this.id = 0; this.libraryID = 1; this.fields = {}; this.rels = []; }
			setField(k, v) { this.fields[k] = v; }
			setCreators() {}
			hasRelation(p, u) { return this.rels.some(([rp, ru]) => rp === p && ru === u); }
			addRelation(p, u) { this.rels.push([p, u]); return true; }
			async saveTx() { if (!this.id) { this.id = ++seq; saved.push(this); } return this.id; }
		},
	};
	try {
		const res = await recoverOrphanCitations([
			{
				key: 'k1',
				kind: 'missing',
				ordinal: 1,
				shortText: '1',
				title: 'Same Paper Copy 1',
				uris: ['http://zotero.org/users/1/items/AAA11111'],
				itemData: { title: 'Same Paper', DOI: '10.1000/same' },
			},
			{
				key: 'k2',
				kind: 'missing',
				ordinal: 2,
				shortText: '2',
				title: 'Same Paper Copy 2',
				uris: ['http://zotero.org/users/1/items/BBB22222'],
				itemData: { title: 'Same Paper', DOI: 'https://doi.org/10.1000/SAME' },
			},
		]);
		assert.equal(saved.length, 1, 'identical DOI within one batch must create only 1 item');
		assert.equal(res.importedCount, 1);
		assert.equal(res.existingCount, 1);
		assert.equal(res.relinkedCount, 2);
		assert.equal(saved[0].rels.length, 2, 'both old URIs attached as dc:replaces onto the single created item');
	} finally {
		clearRelinkedItemUris();
		globalThis.Zotero = prevZotero;
	}
});

test('v0.6.4: non-DOI exact title+author+year dedup, schema-aware CSL fields, selective UI & multi-doc refresh guard', async () => {
	const prevZotero = globalThis.Zotero;
	clearRelinkedItemUris();

	const existingPreprint = createItemStub(701, { title: 'Quantum Spin Hall Effect in Monolayer WTe2', key: 'PRE701' });
	existingPreprint.firstCreator = 'Qian et al.';
	existingPreprint.getField = (f) => (f === 'title' ? 'Quantum Spin Hall Effect in Monolayer WTe2' : f === 'date' ? '2024-03' : '');

	const created = [];
	let seq = 900;
	class SchemaAwareItem {
		constructor(itemType) {
			this.id = 0;
			this.libraryID = 1;
			this.itemType = itemType;
			this.fields = {};
			this.creators = [];
			this.rels = [];
		}
		getField(k) { return this.fields[k] || ''; }
		setField(k, v) {
			if (this.itemType === 'bookSection' && k === 'publicationTitle') throw new Error('Invalid field publicationTitle for bookSection');
			if (this.itemType === 'conferencePaper' && k === 'publicationTitle') throw new Error('Invalid field publicationTitle for conferencePaper');
			this.fields[k] = v;
		}
		getCreators() { return this.creators; }
		setCreators(c) { this.creators = c; }
		hasRelation(p, u) { return this.rels.some(([rp, ru]) => rp === p && ru === u); }
		addRelation(p, u) { this.rels.push([p, u]); return true; }
		async saveTx() { if (!this.id) { this.id = ++seq; created.push(this); } return this.id; }
	}

	globalThis.Zotero = {
		isWin: true,
		Item: SchemaAwareItem,
		Relations: { replacedItemPredicate: 'dc:replaces' },
		Users: { getCurrentUserID: () => 1 },
		Libraries: { userLibraryID: 1, get: () => ({ editable: true }) },
		Search: class {
			constructor() { this.conds = []; }
			addCondition(f, op, v) { this.conds.push([f, op, v]); }
			async search() {
				const t = this.conds.find((c) => c[0] === 'title');
				if (t && /Quantum Spin Hall Effect/i.test(t[2])) return [701];
				return [];
			}
		},
		Items: {
			get: (id) => (id === 701 ? existingPreprint : null),
			getAsync: async (id) => (id === 701 ? existingPreprint : null),
		},
		Integration: {
			Interface: class { async refresh() { throw new Error('Must NOT refresh wrong foreground Word doc!'); } },
			getApplication: () => ({ getActiveDocument: async () => ({}) }),
			execCommand: async () => {},
		},
		Prefs: { get: () => '', set: () => {}, registerObserver: () => 0, unregisterObserver: () => {} },
	};

	try {
		const orphans = [
			// 1. Non-DOI preprint already in library -> matched by exact title + author surname + year!
			{
				key: 'o-nodoi',
				kind: 'missing',
				ordinal: 1,
				shortText: '[1]',
				title: 'Quantum Spin Hall Effect in Monolayer WTe2',
				uris: ['http://zotero.org/users/1/items/OLDWTE21'],
				itemData: {
					type: 'article',
					title: 'Quantum Spin Hall Effect in Monolayer WTe2',
					author: [{ family: 'Qian', given: 'Xiaofeng' }],
					issued: { 'date-parts': [[2024]] },
				},
			},
			// 2. Book chapter -> must populate `bookTitle` (not throw on `publicationTitle`)
			{
				key: 'o-chap',
				kind: 'missing',
				ordinal: 2,
				shortText: '[2]',
				title: '2D Ferroelectrics Chapter',
				uris: ['http://zotero.org/users/1/items/OLDCHAP2'],
				itemData: {
					type: 'chapter',
					title: '2D Ferroelectrics Chapter',
					'container-title': 'Handbook of Low-Dimensional Materials',
					publisher: 'Springer',
					author: [{ family: 'Wang' }],
					issued: { 'date-parts': [[2025]] },
				},
			},
			// 3. Conference paper + Nature Comm electronic article `number` + `container-title-short`
			{
				key: 'o-artnum',
				kind: 'missing',
				ordinal: 3,
				shortText: '[3]',
				title: 'Exciton Funneling Study',
				itemData: {
					type: 'article-journal',
					title: 'Exciton Funneling Study',
					'container-title': 'Nature Communications',
					'container-title-short': 'Nat. Commun.',
					volume: '16',
					number: '4821',
					DOI: '10.1038/s41467-025-04821-x',
				},
			},
			// 4. Unchecked item excluded by user in UI
			{
				key: 'o-skip-user',
				kind: 'missing',
				ordinal: 4,
				shortText: '[4]',
				title: 'User Unchecked Citation',
				itemData: { type: 'article-journal', title: 'User Unchecked Citation', DOI: '10.1000/unchecked' },
			},
		];

		// Test OrphanSelectionState & expand/collapse + selective checkbox UI model
		const selState = new OrphanSelectionState();
		assert.equal(selState.syncSnapshot('si-doc', orphans), true, 'auto-opens once on fresh orphan set');
		assert.equal(selState.syncSnapshot('si-doc', orphans), false, 'does not repeatedly force-open on same set');
		selState.toggleKey('o-skip-user');

		const collapsedModel = buildOrphanBannerModel(orphans, true, { uncheckedKeys: selState.uncheckedKeys, expanded: false });
		assert.equal(collapsedModel.showToggle, true);
		assert.equal(collapsedModel.rows.length, 3, 'collapsed view shows compact top 3 rows');
		assert.match(collapsedModel.buttonLabel, /找回已选 3 篇/);

		const selectedKeys = selState.getSelectedRecoverableKeys(orphans);
		assert.deepEqual(selectedKeys, ['o-nodoi', 'o-chap', 'o-artnum']);

		// Verify multi-Word-window guard + Spotlight command registration
		const kernel = new PluginKernel({ id: 'bridgeflow@groele', version: '0.6.4', rootURI: 'chrome://bridgeflow/' });
		const services = new ServiceContainer(kernel);
		services.win32.probeForegroundWordTitle = () => 'Main_Manuscript.docx - Microsoft Word';
		const workspace = new WorkspaceDomainModule(kernel, services);
		const wordMod = new WordCiteDomainModule(kernel, services);
		const bridge = new SpotlightFusionBridge(kernel, workspace, wordMod);
		try {
			workspace.start();
			wordMod.start();
			bridge.start();

			wordMod.tracker.syncSessions([
				{ sessionID: 'si-doc', documentPath: 'D:\\Supporting_Information.docx', citations: [], orphans },
				{ sessionID: 'main-doc', documentPath: 'D:\\Main_Manuscript.docx', citations: [{ itemID: 701, ordinal: 1, shortText: '[1]' }], orphans: [] },
			]);
			// Switch active tracked session back to si-doc while Main_Manuscript.docx remains foregrounded in Windows
			wordMod.tracker.setActiveSession('si-doc');

			const spotCommands = workspace.spotlight.query('> 找回', {});
			assert.ok(spotCommands.some((c) => c.id === 'cmd:recover-word-orphans:si-doc'), 'Spotlight exposes 0-selection orphan recovery command');

			const res = await new Promise((resolve) => {
				kernel.bus.on('word:recover-orphans-result', resolve);
				kernel.bus.emit('word:recover-orphans-request', { sessionID: 'si-doc', keys: selectedKeys, requestId: 'r-v064' });
			});

			assert.equal(res.existingCount, 1, 'non-DOI preprint matched existing item 701 without duplicating');
			assert.equal(existingPreprint.hasRelation('dc:replaces', 'http://zotero.org/users/1/items/OLDWTE21'), true);
			assert.equal(res.importedCount, 2, 'book chapter + journal article imported; unchecked #4 excluded');
			assert.equal(res.refreshed, undefined, 'skipped auto-refresh because Main_Manuscript.docx was in foreground instead of Supporting_Information.docx');
			assert.deepEqual(res.recoveredItemIDs?.length, 3);

			const chapItem = created.find((x) => x.itemType === 'bookSection');
			assert.equal(chapItem?.fields.bookTitle, 'Handbook of Low-Dimensional Materials');
			const artItem = created.find((x) => x.itemType === 'journalArticle');
			assert.equal(artItem?.fields.journalAbbreviation, 'Nat. Commun.');
			assert.equal(artItem?.fields.pages, '4821', 'electronic article number mapped to pages');

			const richReceipt = formatRecoverReceipt({ ...res, collectionName: 'Supporting Information.docx' }, true);
			assert.equal(richReceipt.headline, '✓ 已成功找回 3 篇缺失引文');
			assert.ok(richReceipt.chips?.some((c) => c.text.includes('备份重建 2 篇')));
			assert.ok(richReceipt.chips?.some((c) => c.text.includes('复用已有 1 篇')));
			assert.ok(richReceipt.actions?.some((a) => a.kind === 'refresh-word'), 'offers 1-click Refresh Word action when auto-refresh was deferred');
			assert.ok(richReceipt.actions?.some((a) => a.kind === 'locate-recovered' && a.itemIDs?.length === 3), 'offers 1-click Locate action for recovered items');
		} finally {
			bridge.stop();
			wordMod.stop();
			workspace.stop();
		}
	} finally {
		clearRelinkedItemUris();
		globalThis.Zotero = prevZotero;
	}
});

test('A foreign citation with a colliding local ID remains missing in both Word indexes', () => {
	const prev = globalThis.Zotero;
	const uri = 'http://zotero.org/users/99/items/FOREIGN1';
	try {
		globalThis.Zotero = {
			Users: { getCurrentUserID: () => 1 },
			Items: { get: () => createItemStub(44) },
			URI: { getItemURI: () => 'http://zotero.org/users/1/items/LOCAL001', getURIItemID: () => 44 },
		};
		const result = extractSessionCitationsWithOrphans({
			citationsByIndex: [{ citationItems: [{ id: 44, uris: [uri], itemData: { title: 'Foreign paper' } }] }],
			citationsByItemID: { 44: [{}] },
		});
		assert.equal(result.citations.length, 0);
		assert.equal(result.orphans[0].kind, 'missing');
		assert.equal(result.orphans[0].itemID, undefined);
		assert.deepEqual(classifySyncSafeRelinkUris([uri, 'http://zotero.org/users/local/UNKNOWN/items/K'], 1, 1, {}).safeUris, []);
	} finally { globalThis.Zotero = prev; }
});

test('Empty selection, conflicting DOIs and transaction commit failures preserve citation identity', async () => {
	const prev = globalThis.Zotero;
	const items = [];
	const uri = 'http://zotero.org/users/1/items/OLDENTRY';
	try {
		globalThis.Zotero = {
			Users: { getCurrentUserID: () => 1 }, Libraries: { userLibraryID: 1 },
			Items: { get: id => items.find(item => item.id === id) },
			DB: { executeTransaction: fn => fn() },
			Item: class {
				setField() {} addRelation() { return true; }
				async save() { this.id = items.push(this); return this.id; }
			},
		};
		const orphan = DOI => ({
			kind: 'missing', key: DOI, title: 'Shared title', uris: [uri],
			itemData: { title: 'Shared title', DOI, author: [{family:'Lee'}], issued:{'date-parts':[[2025]]} },
		});
		const batch = [orphan('10.1234/a'), { ...orphan('10.1234/b'), uris: [] }];
		await recoverOrphanCitations(batch, {keys: []});
		assert.equal(items.length, 0);
		assert.equal((await recoverOrphanCitations(batch)).importedCount, 2);
		clearRelinkedItemUris();
		globalThis.Zotero.DB.executeTransaction = async fn => { await fn(); throw Error('commit failure'); };
		await assert.rejects(recoverOrphanCitations(batch), /commit failure/);
		assert.equal(resolveItemIdFromUris([uri], globalThis.Zotero, globalThis.Zotero.Items), 0);
	} finally { clearRelinkedItemUris(); globalThis.Zotero = prev; }
});

test('Startup cleanup only erases recorded BridgeFlow leaf collections', async () => {
	const { WordCitationCollectionManager } = await import('../src/domains/word-cite/governance/citation-collections.ts');
	const { TEMP_COLLECTION_MARKER } = await import('../src/domains/word-cite/governance/collection-tree-order.ts');
	const prev = globalThis.Zotero;
	const erased = [], visited = [];
	const lookup = (key, markers, children) => ({
		key, name: 'Manuscript.docx', hasChildCollections: () => children,
		getRelationsByPredicate: () => markers, eraseTx: async () => erased.push(key),
	});
	const entries = [
		lookup('user', [], false), lookup('owned', [TEMP_COLLECTION_MARKER], false),
		lookup('parent', [TEMP_COLLECTION_MARKER], true), lookup('other', ['BridgeFlow'], false),
		lookup('unrecorded', [], false),
	];
	try {
		globalThis.Zotero = {
			Prefs: { get: () => JSON.stringify(entries.slice(0,4).map(e => e.key)), set() {} },
			Libraries: {userLibraryID: 1},
			Collections: { getByLibraryAndKey: (_, key) => { visited.push(key); return entries.find(e => e.key === key); } },
		};
		await new WordCitationCollectionManager(new PluginKernel()).purgeStaleCollections();
		assert.deepEqual(erased, ['owned']);
		assert.ok(!visited.includes('unrecorded'));
	} finally { globalThis.Zotero = prev; }
});

test('Persisted Zotero replacement is reused without CSL, and ambiguous DOI does not write', async () => {
	const prev = globalThis.Zotero;
	const uri = 'http://zotero.org/users/1/items/OLD12345';
	const rows = [createItemStub(11), createItemStub(12)];
	let searchIDs = [];
	let created = 0;
	globalThis.Zotero = {
		Users: { getCurrentUserID: () => 1 },
		Libraries: { userLibraryID: 1 },
		Items: { getAsync: async id => rows.find(row => row.id === id) },
		Relations: { getByPredicateAndObject: async (_, __, object) => object === uri ? [rows[0]] : [] },
		Search: class { addCondition() {} async search() { return searchIDs; } },
		Item: class { constructor() { created++; } },
	};
	try {
		clearRelinkedItemUris();
		const orphan = { key: 'old', kind: 'missing', title: 'Paper', uris: [uri] };
		const reused = await recoverOrphanCitations([orphan]);
		assert.deepEqual(reused.recoveredItemIDs, [11]);
		assert.equal(reused.relinkedCount, 1);
		searchIDs = [11,12];
		const ambiguous = await recoverOrphanCitations([{ ...orphan, uris: [], itemData: { DOI: '10.1234/shared' } }]);
		assert.equal(ambiguous.ambiguousCount, 1);
		assert.equal(ambiguous.skippedCount, 1);
		assert.equal(created, 0);
		assert.match(formatRecoverReceipt(ambiguous, true).text, /多条文库记录/);
		globalThis.Zotero.Search = class { addCondition() {} async search() { throw Error('read failed'); } };
		await assert.rejects(recoverOrphanCitations([{ ...orphan, uris: [], itemData: { DOI: '10.1234/shared' } }]), /read failed/);
		assert.equal(created, 0);
	} finally { clearRelinkedItemUris(); globalThis.Zotero = prev; }
});
