import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BridgeFlowApp } from '../src/index.ts';
import { PluginKernel } from '../src/kernel/plugin-kernel.ts';
import { PREF_PREFIX } from '../src/kernel/pref-schema.ts';
import { ServiceContainer } from '../src/services/service-container.ts';
import { WorkspaceDomainModule } from '../src/domains/workspace/module.ts';
import { VisualNotesDomainModule } from '../src/domains/visual-notes/module.ts';
import { VisualNotesBridge } from '../src/bridges/visual-notes-bridge.ts';

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

function createMockZotero() {
	const items = new Map([
		[404, {
			id: 404,
			libraryID: 1,
			key: 'KEY404',
			isRegularItem: () => true,
			isTrashed: () => false,
			firstCreator: 'Ding et al.',
			getField: (f) => (f === 'title' ? '2H-MoS2 Monolayers' : f === 'year' ? '2017' : ''),
		}],
	]);
	return {
		isWin: false,
		locale: 'zh-CN',
		Items: { get: (id) => items.get(id) || null, getAll: async () => [...items.values()] },
		Libraries: { userLibraryID: 1 },
		ItemPaneManager: { registerSection: () => 'sec-1', unregisterSection: () => {} },
		ItemTreeManager: { registerColumn: () => 'col-1', unregisterColumn: () => {}, refreshColumns: () => {} },
		Notifier: { registerObserver: () => 'notif-1', unregisterObserver: () => {} },
		getMainWindows: () => [],
		debug: () => {},
		logError: () => {},
	};
}

test('PluginKernel automatically stops/restarts bridges based on required domain modules', async (t) => {
	const prevZotero = globalThis.Zotero;
	t.after(() => { globalThis.Zotero = prevZotero; });
	globalThis.Zotero = createMockZotero();

	const mem = createMemoryPrefs({
		'modules.workspace.enable': true,
		'modules.visualNotes.enable': true,
		'modules.wordCite.enable': true,
		'modules.inspector.enable': true,
		'fusion.spotlightCrossDomain': true,
	});
	const app = new BridgeFlowApp({ prefAdapter: mem.adapter });
	t.after(() => app.shutdown());
	app.init({ id: 'bridgeflow@groele', version: '0.9.0', rootURI: 'chrome://test/' });
	await app.start();

	assert.equal(app.kernel.isBridgeActive('cite-badge-bridge'), true);
	assert.equal(app.kernel.isBridgeActive('spotlight-fusion-bridge'), true);
	assert.equal(app.kernel.isBridgeActive('visual-notes-bridge'), true);
	assert.equal(app.kernel.isBridgeActive('lookup-workspace-bridge'), true);
	assert.equal(app.kernel.isBridgeActive('copy-history-bridge'), true);
	assert.equal(app.kernel.ports.has('workspace'), true);
	assert.equal(app.kernel.ports.has('visual-notes'), true);

	// Track badge clearing when CiteBadgeBridge stops
	const badgeCounts = [];
	const origSetBadges = app.workspace.setCitationBadges.bind(app.workspace);
	app.workspace.setCitationBadges = (badges) => {
		badgeCounts.push(badges.size);
		origSetBadges(badges);
	};

	app.wordCite.tracker.syncSessions([{
		sessionID: 'doc-1',
		documentPath: 'C:/docs/Paper.docx',
		citations: [{ itemID: 404, ordinal: 4, shortText: '[4]', occurrences: 1 }],
	}]);
	assert.equal(badgeCounts.at(-1), 1);

	const mockWin = { Zotero_Tabs: { _tabs: [] } };
	assert.equal(app.workspace.spotlight.query('#4', mockWin)[0]?.id, 'word-cited:404');

	// Disabling wordCite automatically stops CiteBadgeBridge and SpotlightFusionBridge, leaving VisualNotesBridge active
	app.kernel.prefs.set('modules.wordCite.enable', false);
	await app.kernel.syncDomainStates();

	assert.equal(app.wordCite.isActive(), false);
	assert.equal(app.kernel.isBridgeActive('cite-badge-bridge'), false);
	assert.equal(app.kernel.isBridgeActive('spotlight-fusion-bridge'), false);
	assert.equal(app.kernel.isBridgeActive('visual-notes-bridge'), true);
	assert.equal(app.kernel.isBridgeActive('lookup-workspace-bridge'), true);
	assert.equal(badgeCounts.at(-1), 0, 'CiteBadgeBridge.stop() should clear sidebar badges');
	assert.equal(app.workspace.spotlight.query('#4', mockWin).length, 0, 'SpotlightFusionBridge provider should be unregistered');

	// Re-enabling wordCite automatically restarts CiteBadgeBridge and SpotlightFusionBridge
	app.kernel.prefs.set('modules.wordCite.enable', true);
	await app.kernel.syncDomainStates();

	assert.equal(app.wordCite.isActive(), true);
	assert.equal(app.kernel.isBridgeActive('cite-badge-bridge'), true);
	assert.equal(app.kernel.isBridgeActive('spotlight-fusion-bridge'), true);

	app.wordCite.tracker.syncSessions([{
		sessionID: 'doc-2',
		documentPath: 'C:/docs/Paper2.docx',
		citations: [{ itemID: 404, ordinal: 4, shortText: '[4]', occurrences: 2 }],
	}]);
	assert.equal(badgeCounts.at(-1), 1);
	assert.equal(app.workspace.spotlight.query('#4', mockWin)[0]?.id, 'word-cited:404');

	// Disabling visualNotes stops VisualNotesBridge and unregisters visual-notes port while keeping word-cite bridges running
	app.kernel.prefs.set('modules.visualNotes.enable', false);
	await app.kernel.syncDomainStates();

	assert.equal(app.kernel.isBridgeActive('visual-notes-bridge'), false);
	assert.equal(app.kernel.ports.has('visual-notes'), false);
	assert.equal(app.kernel.isBridgeActive('cite-badge-bridge'), true);
	assert.equal(app.kernel.isBridgeActive('spotlight-fusion-bridge'), true);
});

test('VisualNotesDomainModule self-registers Spotlight commands via CommandRegistry and cleans them up on stop()', async (t) => {
	const prevZotero = globalThis.Zotero;
	t.after(() => { globalThis.Zotero = prevZotero; });
	globalThis.Zotero = createMockZotero();

	const mem = createMemoryPrefs({
		'modules.workspace.enable': true,
		'modules.visualNotes.enable': true,
		'visualNotes.gallery.enable': true,
		'visualNotes.collectionHub.enable': true,
		'fusion.spotlightCrossDomain': true,
		'workspace.spotlightIncludeCommands': true,
	});
	const kernel = new PluginKernel({ prefAdapter: mem.adapter });
	t.after(() => kernel.shutdown());
	const services = new ServiceContainer(kernel);
	const workspace = new WorkspaceDomainModule(kernel, services);
	const visualNotes = new VisualNotesDomainModule(kernel, services);

	const mockWin = { Zotero_Tabs: { _tabs: [] } };
	assert.equal(workspace.spotlight.query('>画廊', mockWin).some((r) => r.id === 'cmd:toggle-gallery-board'), false);

	await workspace.start();
	visualNotes.start();

	const galleryHits = workspace.spotlight.query('>画廊', mockWin);
	const galleryCmd = galleryHits.find((r) => r.id === 'cmd:toggle-gallery-board');
	assert.ok(galleryCmd, 'VisualNotes should expose cmd:toggle-gallery-board on > query');

	const hubHits = workspace.spotlight.query('>笔记', mockWin);
	const hubCmd = hubHits.find((r) => r.id === 'cmd:open-collection-hub');
	assert.ok(hubCmd, 'VisualNotes should expose cmd:open-collection-hub on > query');

	// Also exposed on regular search when workspace.spotlightIncludeCommands is true
	const inlineHits = workspace.spotlight.query('kanban', mockWin);
	assert.ok(inlineHits.some((r) => r.id === 'cmd:toggle-gallery-board'));

	// Executing commands delegates directly to VisualNotesDomainModule controllers
	let toggledWin = null;
	let openedHubWin = null;
	visualNotes.galleryBoard.toggleWindowGallery = (w) => { toggledWin = w; };
	visualNotes.openCollectionHub = (w) => { openedHubWin = w; };

	await galleryCmd.action();
	await hubCmd.action();
	assert.equal(toggledWin, mockWin);
	assert.equal(openedHubWin, mockWin);

	// Stopping visualNotes automatically unregisters its CommandRegistry contribution and port
	visualNotes.stop();
	assert.equal(kernel.ports.has('visual-notes'), false);
	assert.equal(workspace.spotlight.query('>', mockWin).some((r) => r.id === 'cmd:toggle-gallery-board'), false);
	assert.equal(workspace.spotlight.query('>', mockWin).some((r) => r.id === 'cmd:open-collection-hub'), false);

	workspace.stop();
	assert.equal(kernel.ports.has('workspace'), false);
});

test('VisualNotesBridge synchronizes remarks and reading progress exclusively via SharedReadingNotesFacade', async (t) => {
	const prevZotero = globalThis.Zotero;
	t.after(() => { globalThis.Zotero = prevZotero; });
	let savedExtra = '';
	const mockItem = {
		id: 42,
		isRegularItem: () => true,
		getField: () => savedExtra,
		setField: (_f, val) => { savedExtra = val; },
		saveTx: async () => {},
	};
	globalThis.Zotero = {
		...createMockZotero(),
		Items: { get: (id) => (id === 42 ? mockItem : null) },
	};

	const mem = createMemoryPrefs({
		'modules.workspace.enable': true,
		'modules.visualNotes.enable': true,
		'workspace.syncRemarkToExtra': true,
	});
	const kernel = new PluginKernel({ prefAdapter: mem.adapter });
	t.after(() => kernel.shutdown());
	const services = new ServiceContainer(kernel);
	const workspace = new WorkspaceDomainModule(kernel, services);
	const visualNotes = new VisualNotesDomainModule(kernel, services);

	let capturedSource = null;
	const origSetDataSource = visualNotes.setDataSource.bind(visualNotes);
	visualNotes.setDataSource = (src) => {
		capturedSource = src;
		origSetDataSource(src);
	};

	const refreshCalls = [];
	visualNotes.refreshLibraryViews = (affectedIDs, readingOnly = false) => {
		refreshCalls.push({ ids: affectedIDs ? [...affectedIDs] : null, readingOnly });
	};

	let workspaceRefreshes = 0;
	workspace.refreshAllWindows = () => { workspaceRefreshes += 1; };

	visualNotes.start();
	const bridge = new VisualNotesBridge(kernel, workspace, visualNotes);
	bridge.start();

	assert.ok(capturedSource, 'VisualNotesBridge should attach a VisualNotesDataSource');
	const rev0 = capturedSource.getReadingRevision();
	const noteRev0 = capturedSource.getRemarksRevision();

	// 1. Reading progress update flows through facade -> readingOnly refresh & revision bump
	workspace.store.updateReadingProgress('item:42', 120, 3, 10);
	workspace.store.saveReadingProgress();
	assert.equal(capturedSource.getReadingProgress(42)?.readSeconds, 120);
	assert.equal(capturedSource.getReadingRevision(), rev0 + 1);
	assert.deepEqual(refreshCalls.at(-1), { ids: null, readingOnly: true });

	// 2. Remark edit in workspace store flows through facade -> scoped refresh & Extra sync
	workspace.store.setItemRemark(42, 'Important theorem');
	await new Promise((r) => setTimeout(r, 10));
	assert.equal(capturedSource.getRemark(42), 'Important theorem');
	assert.equal(capturedSource.getRemarksRevision(), noteRev0 + 1);
	assert.deepEqual(refreshCalls.at(-1), { ids: [42], readingOnly: false });
	assert.match(savedExtra, /Important theorem/);

	// 3. Remark write from visual-notes with skipExtraObserver=true refreshes workspace without duplicate Extra sync
	const callsBefore = refreshCalls.length;
	const extraBefore = savedExtra;
	capturedSource.setRemark(42, 'Edited in visual notes', true);
	await new Promise((r) => setTimeout(r, 10));
	assert.equal(workspace.store.getItemRemark(42), 'Edited in visual notes');
	assert.equal(workspaceRefreshes, 1);
	assert.equal(savedExtra, extraBefore, 'skipExtraObserver=true must suppress duplicate Extra sync');
	assert.equal(refreshCalls.length, callsBefore, 'skipExtraObserver=true must not trigger redundant visual-notes refresh');
	assert.equal(capturedSource.getRemarksRevision(), noteRev0 + 2);

	// 4. Local clear triggers full refresh without wiping Extra
	await workspace.store.clearBriefNotes();
	assert.deepEqual(refreshCalls.at(-1), { ids: null, readingOnly: false });
	assert.equal(savedExtra, extraBefore);

	// 5. Static decoupling check: bridges must not penetrate .store.state, .store.notesCache, or .tracker
	const vnBridgeSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/bridges/visual-notes-bridge.ts'), 'utf8');
	const spotBridgeSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/bridges/spotlight-fusion-bridge.ts'), 'utf8');
	assert.equal(/\.store\.(?:state|notesCache)/.test(vnBridgeSrc), false, 'visual-notes-bridge.ts must not access store.state or store.notesCache');
	assert.equal(/\.tracker\b/.test(spotBridgeSrc), false, 'spotlight-fusion-bridge.ts must not access wordCite.tracker directly');

	bridge.stop();
	assert.equal(capturedSource, undefined);
	visualNotes.stop();
});
