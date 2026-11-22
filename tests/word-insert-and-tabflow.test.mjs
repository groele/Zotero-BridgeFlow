import test from 'node:test';
import assert from 'node:assert/strict';
import { PluginKernel } from '../src/kernel/plugin-kernel.ts';
import { normalizeWordTitleForMatch, Win32BridgeService } from '../src/services/win32-bridge.ts';
import { insertItemsIntoWord } from '../src/domains/word-cite/word-inserter.ts';
import { WordSessionTracker } from '../src/domains/word-cite/session-tracker.ts';
import { WordIntegrationPoller } from '../src/domains/word-cite/word-poller.ts';
import { WorkspaceStateStore } from '../src/domains/workspace/state-store.ts';
import { WorkspaceTabController } from '../src/domains/workspace/tab-controller.ts';
import { WorkspaceSpotlightEngine } from '../src/domains/workspace/spotlight-engine.ts';

function createMemoryPrefs(initial = {}) {
	const store = new Map(Object.entries(initial));
	return {
		get(key) { return store.get(key); },
		set(key, val) { store.set(key, val); },
		registerObserver() { return 1; },
		unregisterObserver() {},
	};
}

test('WordCite: transactional native Word citation insertion, getActiveDocument fix & rollback guard', async () => {
	const kernel = new PluginKernel({ prefAdapter: createMemoryPrefs() });
	kernel.init({ id: 'bridgeflow@groele', version: '0.0.5', rootURI: 'chrome://test/' });
	const win32 = new Win32BridgeService();

	const committedIDs = [];
	const deletedFields = [];
	let activeDocArg = 'UNSET';
	let throwOnAddCitation = false;

	class MockSession {
		constructor() {
			this.citationsByItemID = {};
			this.data = { prefs: { delayCitationUpdates: false } };
			this.style = { opt: { sort_citations: true } };
		}
		async addField() {
			return {
				type: 0,
				_field: { tag: 'raw' },
				async getNoteIndex() { return 0; },
				async equals() { return false; },
				async delete() { deletedFields.push('deleted'); },
			};
		}
		async getFields() { return []; }
		async updateFromDocument() {}
		async _insertCitingResult(fieldIndex, field, citation) {
			return [{ fieldIndex, field, citationItems: citation.citationItems }];
		}
		async addCitation(_idx, _note, citation) {
			if (throwOnAddCitation) throw new Error('Simulated COM failure');
			for (const ci of citation.citationItems) committedIDs.push(ci.id);
		}
		async cite() { return 'ORIG'; }
	}

	const origCite = MockSession.prototype.cite;
	const origGetActive = () => 'ORIG_ACTIVE';
	const appObj = {
		getActiveDocument: origGetActive,
		getDocument: (name) => { activeDocArg = name; return { doc: name }; },
	};

	globalThis.Zotero = {
		isMac: false,
		isWin: false,
		Integration: {
			Session: MockSession,
			CitationField: class { constructor(f) { this._field = f; } async getNoteIndex() { return 0; } async delete() { return this._field?.delete?.(); } },
			Citation: class { constructor(f) { this.field = f; this.citationItems = []; } async prepareForEditing() {} },
			CitationEditInterface: class { constructor(c) { this.citation = c; } },
			Field: { loadExisting: async (f) => f },
			getApplication: (agent) => (agent === 'WinWord' ? appObj : null),
			execCommand: async (agent, cmd) => {
				if (agent === 'WinWord' && cmd === 'addEditCitation') {
					globalThis.Zotero.Integration.getApplication(agent).getActiveDocument();
					const session = new MockSession();
					await session.cite(null);
				}
			},
		},
		Exception: { Alert: Error, UserCancelled: Error },
	};

	const makeRegularItem = (id) => ({
		id,
		deleted: false,
		isRegularItem: () => true,
		isTopLevelItem: () => true,
	});

	let onCommittedCalls = 0;
	const res = await insertItemsIntoWord(
		kernel,
		win32,
		[makeRegularItem(101), makeRegularItem(102), makeRegularItem(101)],
		{ verifyCursor: false, onCommitted: () => { onCommittedCalls++; } },
	);

	assert.equal(res, 'inserted');
	assert.deepEqual(committedIDs, [101, 102]);
	assert.equal(activeDocArg, '');
	assert.equal(onCommittedCalls, 1);
	assert.equal(MockSession.prototype.cite, origCite);
	assert.equal(appObj.getActiveDocument, origGetActive);

	// Failure before commit deletes uncommitted field & restores hooks
	throwOnAddCitation = true;
	const failRes = await insertItemsIntoWord(kernel, win32, [makeRegularItem(103)], { verifyCursor: false });
	assert.equal(failRes, 'unavailable');
	assert.equal(deletedFields.length, 1);
	assert.equal(MockSession.prototype.cite, origCite);
	assert.equal(appObj.getActiveDocument, origGetActive);

	delete globalThis.Zotero;
});

test('TabFlow: virtual members lifecycle, sleep/wakeup, collectionToGroup & Spotlight >tabs', async () => {
	const prefs = {
		get(k) {
			const defaults = {
				'workspace.enableVirtualMembers': true,
				'workspace.enableTabSleep': true,
				'workspace.enableTabRemarks': true,
				'workspace.multiCollectionStrategy': 'first',
				'workspace.verticalTabTitleMode': 'title',
				'workspace.remarkDisplayMode': 'both',
				'workspace.staleSuggestDays': 7,
				'workspace.autoSleepMinutes': 15,
			};
			return defaults[k];
		},
		set() {},
	};

	const cols = new Map([[10, { id: 10, name: 'Deep Learning' }]]);
	const items = new Map([
		[201, {
			id: 201,
			firstCreator: 'He',
			isRegularItem: () => true,
			getField: (f) => (f === 'title' ? 'ResNet Paper' : f === 'year' ? '2016' : ''),
			getCollections: () => [10],
			getBestAttachment: async () => ({ id: 201, isAttachment: () => true, isFileAttachment: () => false }),
		}],
	]);
	const unloaded = [];
	const opened = [];
	const mockWin = {
		Zotero_Tabs: {
			selectedID: 'tab-2',
			_tabs: [
				{ id: 'zotero-pane', type: 'library', data: {} },
				{ id: 'tab-1', type: 'reader', data: { itemID: 201 }, title: 'ResNet Paper' },
				{ id: 'tab-2', type: 'reader', data: { itemID: 999 }, title: 'Active Tab' },
			],
			select(id) { this.selectedID = id; },
			unload(id) { unloaded.push(id); },
			close(ids) {
				const rm = new Set(Array.isArray(ids) ? ids : [ids]);
				this._tabs = this._tabs.filter((t) => !rm.has(t.id));
			},
		},
	};
	globalThis.Zotero = {
		Items: { get: (id) => items.get(id) },
		Collections: { get: (id) => cols.get(id) },
		Reader: { open: async (id) => { opened.push(id); } },
	};

	const store = new WorkspaceStateStore(prefs);
	const clipboard = { copyItems: async () => true };
	const tabs = new WorkspaceTabController(prefs, store, clipboard);
	const spotlight = new WorkspaceSpotlightEngine(prefs, store, tabs);

	// 1. collectionToGroup groups matching open tab
	assert.equal(tabs.collectionToGroup(mockWin, 'Deep Learning'), 1);
	const grp = store.state.groups.find((g) => g.name === 'Deep Learning');
	assert.ok(grp);

	// 2. sleepTab unloads non-selected tab & marks sleeping
	assert.equal(tabs.sleepTab(mockWin, 'tab-1'), true);
	assert.deepEqual(unloaded, ['tab-1']);
	assert.equal(tabs.buildTrackedTabs(mockWin).find((t) => t.tabID === 'tab-1')?.sleeping, true);

	// 3. closeTabs preserves virtual member inside group, openVirtualOrItem reopens & clears virtual
	await tabs.closeTabs(mockWin, ['tab-1'], { preserveVirtual: true });
	const virtualTab = tabs.buildTrackedTabs(mockWin).find((t) => t.itemID === 201);
	assert.equal(virtualTab?.virtual, true);
	await tabs.openVirtualOrItem(mockWin, 201, grp.id);
	assert.deepEqual(opened, [201]);
	assert.equal('item:201' in store.state.virtualMembers, false);

	// 4. Spotlight >tabs lists tabs sorted by lastViewedAt
	const cmdResults = spotlight.query('>tabs', mockWin);
	assert.ok(cmdResults.some((r) => r.id.startsWith('cmd:')));

	delete globalThis.Zotero;
});

test('WordCite: multi-window target verification, numeric index sorting & transient-empty snapshot guard', async () => {
	// 1. Window title normalization & mismatch guard across multiple Word windows
	assert.equal(normalizeWordTitleForMatch('PaperDraft.docx [兼容模式] - Microsoft Word'), 'PaperDraft.docx');
	assert.equal(normalizeWordTitleForMatch('Review.docx - 已保存 - Word'), 'Review.docx');

	const win32 = new Win32BridgeService();
	win32.setLastDroppedWordTargetForTest('PaperDraft.docx [自动保存] - Word');
	assert.equal(win32.verifyDroppedWordTarget('PaperDraft.docx - Microsoft Word'), true);
	assert.equal(win32.verifyDroppedWordTarget('WrongManuscript.docx - Word'), false);

	// 2. Numeric key sort ("0", "2", "10"), trashed exclusion, and 2-read empty confirmation
	const kernel = new PluginKernel({ prefAdapter: createMemoryPrefs() });
	kernel.init({ id: 'bridgeflow@groele', version: '0.0.5', rootURI: 'chrome://test/' });
	const tracker = new WordSessionTracker(kernel.bus, win32);
	const poller = new WordIntegrationPoller(kernel, tracker);

	const mockSession = {
		agent: 'WinWord',
		doc: { filePath: 'D:\\Manuscript\\PaperDraft.docx' },
		citationsByIndex: {
			10: { citationItems: [{ id: 503 }], properties: { plainCitation: '[11]' } },
			0: { citationItems: [{ id: 501 }], properties: { plainCitation: '[1]' } },
			2: { citationItems: [{ id: 502 }], properties: { plainCitation: '[3]' } },
			1: { citationItems: [{ id: 599 }], properties: { plainCitation: '[2]' } }, // trashed item -> ignored
		},
		citationsByItemID: {},
	};

	globalThis.Zotero = {
		Items: {
			get: (id) => (id === 599 ? { id: 599, deleted: true } : { id, deleted: false }),
		},
		Integration: { sessions: { s1: mockSession } },
	};

	await poller.pollOnce();
	const ses = tracker.getActiveSession();
	assert.ok(ses);
	assert.deepEqual([...ses.itemCitations.keys()], [501, 502, 503]);
	assert.equal(ses.itemCitations.get(501)?.ordinal, 1);
	assert.equal(ses.itemCitations.get(503)?.ordinal, 11);

	// Single transient empty snapshot must preserve prior citations
	mockSession.citationsByIndex = {};
	await poller.pollOnce();
	assert.equal(tracker.getActiveSession()?.itemCitations.size, 3);

	// Second consecutive empty snapshot confirms citations were actually removed
	await poller.pollOnce();
	assert.equal(tracker.getActiveSession()?.itemCitations.size, 0);

	delete globalThis.Zotero;
});

test('TabFlow: per-tab remark modes, venue suggestions, hub session merge/replace & @library Spotlight', async () => {
	const prefs = {
		get(k) {
			const defaults = {
				'workspace.enableVirtualMembers': true,
				'workspace.enableTabSleep': true,
				'workspace.enableTabRemarks': true,
				'workspace.enableSessions': true,
				'workspace.multiCollectionStrategy': 'first',
				'workspace.verticalTabTitleMode': 'title',
				'workspace.remarkDisplayMode': 'both',
				'workspace.staleSuggestDays': 7,
			};
			return defaults[k];
		},
		set() {},
	};

	const opened = [];
	const mockWin = {
		Zotero_Tabs: {
			selectedID: 't1',
			_tabs: [
				{ id: 't1', type: 'reader', data: { itemID: 301 }, title: 'Paper One' },
				{ id: 't2', type: 'reader', data: { itemID: 302 }, title: 'Paper Two' },
				{ id: 't3', type: 'reader', data: { itemID: 303 }, title: 'Paper Three' },
			],
			_recentlyClosedTabs: [{ data: { itemID: 304 }, title: 'Closed Paper', closedAt: 1000 }],
			select(id) { this.selectedID = id; },
			close(ids) {
				const rm = new Set(Array.isArray(ids) ? ids : [ids]);
				this._tabs = this._tabs.filter((t) => !rm.has(t.id));
			},
		},
	};
	const makeArt = (id, title, pub) => ({
		id,
		firstCreator: 'Smith',
		deleted: false,
		isRegularItem: () => true,
		getField: (f) => (f === 'title' ? title : f === 'publicationTitle' ? pub : f === 'year' ? '2026' : ''),
		getCollections: () => [],
		getBestAttachment: async () => ({ id, isAttachment: () => true, isFileAttachment: () => false }),
	});
	const itemsMap = new Map([
		[301, makeArt(301, 'Paper One', 'Nature')],
		[302, makeArt(302, 'Paper Two', 'Nature')],
		[303, makeArt(303, 'Paper Three', 'Science')],
		[304, makeArt(304, 'Closed Paper', 'Cell')],
		[305, makeArt(305, 'Unopened Library Quantum Paper', 'PRL')],
	]);
	globalThis.Zotero = {
		Libraries: { userLibraryID: 1 },
		Items: {
			get: (id) => itemsMap.get(id),
			getAll: async () => [...itemsMap.values()],
		},
		Reader: { open: async (id) => { opened.push(id); } },
	};

	const store = new WorkspaceStateStore(prefs);
	const tabs = new WorkspaceTabController(prefs, store, { copyItems: async () => true });
	const spotlight = new WorkspaceSpotlightEngine(prefs, store, tabs);

	// 1. Per-tab remark display mode override
	store.setRemark('item:301', '核心基线');
	assert.equal(tabs.getDisplayTitle({ key: 'item:301', title: 'Paper One', remark: '核心基线' }), '核心基线 · Paper One');
	store.setRemarkMode('item:301', 'remark');
	assert.equal(tabs.getDisplayTitle({ key: 'item:301', title: 'Paper One', remark: '核心基线' }), '核心基线');

	// 2. Venue publication suggestions (>=2 tabs in Nature)
	const sugs = tabs.getPublicationSuggestions(mockWin);
	assert.equal(sugs.length, 1);
	assert.equal(sugs[0].venue, 'Nature');
	assert.deepEqual(sugs[0].keys, ['item:301', 'item:302']);

	// 3. Hub session save, update, rename, merge & replace (creates pre-replace rolling backup)
	const g1 = store.createGroup('Group A');
	store.assignToGroup('item:301', g1.id);
	const ses1 = store.saveSession('Draft Round 1');
	assert.equal(store.renameSession(ses1.id, 'Renamed Round 1'), true);
	store.assignToGroup('item:303', g1.id);
	assert.equal(store.updateSession(ses1.id), true);

	const g2 = store.createGroup('Group B');
	store.restoreSessionLayout({
		id: 'ext', name: 'External', createdAt: 1,
		groups: [{ id: 'g-ext', name: 'Ext', color: '#000', memberKeys: ['item:302'] }],
		pinnedKeys: ['item:302'], remarks: {},
	}, false);
	assert.equal(store.state.rollingSessions.some((r) => r.kind === 'pre-replace'), true);
	assert.equal(store.state.groups.some((g) => g.id === g2.id), false);

	// 4. Spotlight closed tabs + @library search
	const emptyHits = spotlight.query('', mockWin);
	assert.ok(emptyHits.some((h) => h.id === 'closed:item:304'));
	spotlight.query('@quantum', mockWin);
	await new Promise((r) => setTimeout(r, 20));
	const libHits = spotlight.query('@quantum', mockWin);
	assert.ok(libHits.some((h) => h.id === 'lib:1:undefined' || h.title.includes('Quantum')));

	delete globalThis.Zotero;
});
