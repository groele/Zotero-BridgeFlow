import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceStateStore } from '../src/domains/workspace/state-store.ts';
import { WorkspaceTabController } from '../src/domains/workspace/tab-controller.ts';

function setup(state = '') {
	const values = new Map([['workspace.document', state]]);
	const prefs = { get: k => values.get(k) ?? true, set: (k, v) => values.set(k, v) };
	const store = new WorkspaceStateStore(prefs);
	return { store, tabs: new WorkspaceTabController(prefs, store, {}) };
}

test('only current, schema-valid workspace backups replace state', () => {
	const { store } = setup();
	store.createGroup('Reading');
	const original = store.exportJson();
	assert.equal(store.importJson(JSON.stringify({ version: 1, groups: [] })), false);
	const invalid = JSON.parse(original);
	invalid.state.groups[0].memberKeys = null;
	assert.equal(store.importJson(JSON.stringify(invalid)), false);
	assert.equal(store.exportJson(), original);
	const restored = setup().store;
	assert.equal(restored.importJson(original), true);
	assert.equal(restored.exportJson(), original);
});

test('session restores twelve ungrouped readers without reopening virtual-only group members', async () => {
	const opened = [];
	globalThis.Zotero = { Items: { get: id => ({ id, isAttachment: () => true }) }, Reader: { open: async id => opened.push(id) } };
	const { store, tabs } = setup();
	const group = store.createGroup('Archive');
	store.assignToGroup('item:88', group.id);
	const win = { Zotero_Tabs: { _tabs: Array.from({ length: 12 }, (_, i) => ({ id: 't'+i, type: 'reader', data: { itemID: i+1 } })) } };
	const session = store.saveSession('Reading', { openKeys: tabs.openKeys(win) });
	win.Zotero_Tabs._tabs = [];
	assert.equal(await tabs.restoreSession(win, session), 12);
	assert.deepEqual(opened, Array.from({ length: 12 }, (_, i) => i + 1));
});

test('unavailable unload, busy reader and rejected close preserve state', async () => {
	globalThis.Zotero = {};
	const { store, tabs } = setup();
	const native = { id: 't', type: 'reader', data: { itemID: 9 } };
	const api = { _tabs: [native], close: async () => { throw new Error('close rejected'); } };
	const win = { Zotero_Tabs: api };
	store.assignToGroup('item:9', store.createGroup('Working').id);
	assert.equal(tabs.sleepTab(win, 't'), false);
	assert.equal(store.isSleeping('item:9'), false);
	native.audioStatus = { active: true };
	assert.equal(await tabs.closeTabs(win, ['t']), 0);
	native.audioStatus.paused = true;
	await assert.rejects(tabs.closeTabs(win, ['t']), /close rejected/);
	assert.deepEqual(store.state.virtualMembers, {});
	assert.deepEqual(tabs.getRecentlyClosed(win), []);
});

test('a grouped native reader becomes virtual even if the host closes it without a notification', () => {
	globalThis.Zotero = { Items: { get: id => ({ id, getField: () => 'Attachment' }) } };
	const { store, tabs } = setup();
	const group = store.createGroup('Working');
	store.assignToGroup('item:45', group.id);
	const win = { Zotero_Tabs: { _tabs: [{ id: 'native', type: 'reader', data: { itemID: 45 } }] } };
	assert.equal(tabs.buildTrackedTabs(win)[0].virtual, false);
	win.Zotero_Tabs._tabs = [];
	assert.equal(tabs.buildTrackedTabs(win)[0].virtual, true);
	assert.equal(tabs.buildTrackedTabs(win)[0].groupId, group.id);
	store.assignToGroup('item:45', null);
	assert.deepEqual(tabs.buildTrackedTabs(win), []);
});

test('durable local disk cache persists and recovers saved group snapshots and items across preference loss', async () => {
	const diskFiles = new Map();
	globalThis.IOUtils = {
		makeDirectory: async () => {},
		exists: async (p) => diskFiles.has(p),
		writeUTF8: async (p, content) => { diskFiles.set(p, content); },
		readUTF8: async (p) => diskFiles.get(p),
	};
	globalThis.Zotero = {
		Items: { get: (id) => ({ id, isAttachment: () => true, getField: (f) => (f === 'title' ? `CVD Paper #${id}` : '') }) },
		Reader: { open: async () => {} },
	};

	const { store, tabs } = setup();
	const grp = store.createGroup('CVD');
	store.assignToGroup('item:101', grp.id);
	store.assignToGroup('item:102', grp.id);
	const win = {
		Zotero_Tabs: {
			_tabs: [
				{ id: 't1', type: 'reader', data: { itemID: 101 }, title: 'CVD Paper #101' },
				{ id: 't2', type: 'reader', data: { itemID: 102 }, title: 'CVD Paper #102' },
			],
			close: async () => { win.Zotero_Tabs._tabs = []; },
		},
	};

	// Save group snapshot & flush to local disk cache
	const saved = tabs.saveGroupSnapshot(win, grp.id);
	assert.ok(saved);
	assert.deepEqual(saved.openKeys, ['item:101', 'item:102']);
	assert.equal(saved.virtualMembers['item:101']?.title, 'CVD Paper #101');
	await store.diskCache.flushNow(store.state);

	// Simulate months later: prefs.js was reset/cleared, new store starts with empty prefs
	const recovered = setup('').store;
	assert.equal(recovered.state.sessions.length, 0);
	assert.equal(await recovered.initDiskCache(), true);
	assert.equal(recovered.state.sessions.length, 1);
	assert.equal(recovered.state.sessions[0].name, 'CVD');
	assert.deepEqual(recovered.state.sessions[0].openKeys, ['item:101', 'item:102']);
	assert.equal(recovered.state.sessions[0].virtualMembers['item:101']?.title, 'CVD Paper #101');

	delete globalThis.IOUtils;
	delete globalThis.Zotero;
});

test('cross-domain fusion: shared primary item field cache, multi-item copy history indexing, and workspace-to-word cite event', async () => {
	const { getCachedPrimaryItemFields, invalidateResolvedItemCache, stripItemTitleMarkup } = await import('../src/services/item-resolution.ts');
	const { TypedEventBus } = await import('../src/kernel/event-bus.ts');
	const { CopyHistoryBridge } = await import('../src/bridges/copy-history-bridge.ts');
	const { CitationHistoryStore } = await import('../src/services/citation-history-store.ts');
	const { WorkspaceSpotlightEngine } = await import('../src/domains/workspace/spotlight-engine.ts');

	// 1. HTML tag stripping & cached primary item fields
	assert.equal(stripItemTitleMarkup('Exciton in MoS<sub>2</sub> and WS<sup>2+</sup>'), 'Exciton in MoS2 and WS2+');
	let getFieldCalls = 0;
	const mockItem = {
		id: 701,
		dateModified: '2026-11-23 10:00:00',
		firstCreator: 'Wang',
		isRegularItem: () => true,
		getField: (f) => {
			getFieldCalls++;
			if (f === 'title') return 'Valley Polarization in MoS<sub>2</sub>';
			if (f === 'publicationTitle') return 'Nature Physics';
			if (f === 'year') return '2026';
			return '';
		},
	};
	const first = getCachedPrimaryItemFields(mockItem);
	const callsAfterFirst = getFieldCalls;
	const second = getCachedPrimaryItemFields(mockItem);
	assert.equal(first.title, 'Valley Polarization in MoS2');
	assert.equal(second.title, 'Valley Polarization in MoS2');
	assert.equal(getFieldCalls, callsAfterFirst); // 0 extra DB calls on cache hit
	invalidateResolvedItemCache([701]);

	// 2. Multi-item batch citation copy indexes each line into CitationHistoryStore
	globalThis.Zotero = {
		Items: {
			get: (id) => ({
				id,
				libraryID: 1,
				key: `KEY_${id}`,
				getField: (f) => (f === 'title' ? `Paper Title #${id}` : ''),
			}),
		},
	};
	const bus = new TypedEventBus();
	const prefsMap = new Map([
		['fusion.copyToLookupHistory', true],
		['inspector.lookup.historyEnable', true],
		['modules.wordCite.enable', true],
		['wordCite.dragCite.enable', true],
		['workspace.enableSessions', true],
	]);
	const prefs = { get: (k) => prefsMap.get(k) ?? true, set: (k, v) => prefsMap.set(k, v) };
	const history = new CitationHistoryStore();
	const copyBridge = new CopyHistoryBridge({ prefs, bus }, { history });
	copyBridge.start();

	bus.emit('citation:copied', {
		itemIDs: [801, 802],
		styleID: 'apa',
		html: '',
		text: 'Wang et al. (2025). Valley hall effect in MoS2. Nature, 600, 10-15.\nLi et al. (2026). Ferroelectric gate tuning in WS2. Science, 380, 20-25.',
		source: 'tab-menu',
	});
	assert.equal(history.lookupExact('Wang et al. (2025). Valley hall effect in MoS2. Nature, 600, 10-15.')?.itemID, 801);
	assert.equal(history.lookupExact('Li et al. (2026). Ferroelectric gate tuning in WS2. Science, 380, 20-25.')?.itemID, 802);
	copyBridge.stop();

	// 3. WorkspaceTabController.citeItemsInWord emits word:insert-items-request & Spotlight indexes individual papers inside saved snapshots
	const store = new WorkspaceStateStore(prefs);
	const tabs = new WorkspaceTabController(prefs, store, {}, bus);
	let wordRequestedIDs = [];
	bus.on('word:insert-items-request', ({ itemIDs }) => { wordRequestedIDs = [...itemIDs]; });
	assert.equal(tabs.citeItemsInWord({}, [801, 802, 801]), true);
	assert.deepEqual(wordRequestedIDs, [801, 802]);

	store.saveVirtualMember({
		key: 'item:801', itemID: 801, parentItemID: 801, type: 'reader',
		title: 'Archived Ferroelectric MoS2 Paper', shortTitle: 'Ferroelectric MoS2',
		filename: 'mos2.pdf', source: 'Nature', creatorYear: 'Wang, 2025', collection: 'CVD',
	});
	const grp = store.createGroup('Archived CVD Group');
	store.assignToGroup('item:801', grp.id);
	store.saveSession('Archived CVD Group', { groupId: grp.id, openKeys: ['item:801'] });
	store.removeGroup(grp.id);

	const spotlight = new WorkspaceSpotlightEngine(prefs, store, tabs);
	const snapPaperHits = spotlight.query('ferroelectric', { Zotero_Tabs: { _tabs: [] } });
	assert.ok(snapPaperHits.some((h) => h.badge === '快照文献' && h.title.includes('Archived Ferroelectric MoS2')));

	delete globalThis.Zotero;
});
