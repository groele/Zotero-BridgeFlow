import test from 'node:test';
import assert from 'node:assert/strict';
import { PluginKernel } from '../src/kernel/plugin-kernel.ts';
import { Win32BridgeService } from '../src/services/win32-bridge.ts';
import { insertItemsIntoWord } from '../src/domains/word-cite/word-inserter.ts';
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
