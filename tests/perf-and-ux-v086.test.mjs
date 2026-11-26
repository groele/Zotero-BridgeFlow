import test from 'node:test';
import assert from 'node:assert/strict';
import { PluginKernel } from '../src/kernel/plugin-kernel.ts';
import { VisualNotesDomainModule } from '../src/domains/visual-notes/module.ts';
import { WorkspaceDomainModule } from '../src/domains/workspace/module.ts';
import { VisualNotesBridge } from '../src/bridges/visual-notes-bridge.ts';
import { SpotlightFusionBridge } from '../src/bridges/spotlight-fusion-bridge.ts';
import { ServiceContainer } from '../src/services/service-container.ts';
import { buildTitleHeatmapGradient, getHeatmapGradientCacheSize } from '../src/domains/visual-notes/title-heatmap.ts';
import { WordIntegrationPoller } from '../src/domains/word-cite/word-poller.ts';
import { WordSessionTracker } from '../src/domains/word-cite/session-tracker.ts';
import { UnifiedPrefService } from '../src/kernel/pref-service.ts';
import { CslFormattingEngine } from '../src/services/csl-engine.ts';
import { ItemPanePositionCoordinator } from '../src/services/pane-positioner.ts';

function createMemoryPrefs(initial = {}) {
	const store = new Map(Object.entries(initial));
	const observers = new Map();
	let nextId = 1;
	return {
		get: (k) => store.get(k),
		set: (k, v) => {
			store.set(k, v);
			for (const obs of observers.values()) {
				if (obs.key === k) obs.fn();
			}
		},
		registerObserver: (key, fn) => {
			const id = nextId++;
			observers.set(id, { key, fn });
			return id;
		},
		unregisterObserver: (id) => observers.delete(id),
	};
}

test('VisualNotesBridge ignores workspace layout changes and scopes remark invalidation to affected item IDs', async () => {
	const kernel = new PluginKernel({ prefAdapter: createMemoryPrefs({ 'modules.visualNotes.enable': true, 'modules.workspace.enable': true }) });
	const services = new ServiceContainer(kernel);
	const workspace = new WorkspaceDomainModule(kernel, services);
	const visualNotes = new VisualNotesDomainModule(kernel, services);
	const refreshCalls = [];
	visualNotes.refreshLibraryViews = (affectedIDs, readingOnly = false) => {
		refreshCalls.push({ ids: affectedIDs ? [...affectedIDs] : null, readingOnly });
	};
	const bridge = new VisualNotesBridge(kernel, workspace, visualNotes);
	bridge.start();

	const grp = workspace.store.createGroup('Reading');
	workspace.store.setCollapsed(grp.id, true);
	workspace.store.setPinned('item:10', true);
	workspace.store.setSleeping('item:10', false);
	assert.equal(refreshCalls.length, 0, 'pure workspace layout mutations must not wipe visual-notes caches');

	workspace.store.setItemRemark(42, 'Key insight');
	assert.deepEqual(refreshCalls, [{ ids: [42], readingOnly: false }]);
	bridge.stop();
	kernel.shutdown();
});

test('TitleHeatmap WeakMap memo avoids rescanning pageSeconds for same progress object', () => {
	let entriesReads = 0;
	const pageSeconds = { get 1() { entriesReads++; return 25; }, get 2() { entriesReads++; return 50; } };
	const progress = { readSeconds: 75, totalPages: 4, lastPage: 2, pageSeconds };
	const beforeCacheSize = getHeatmapGradientCacheSize();
	const first = buildTitleHeatmapGradient(progress, { color: '#0d9488', opacityPercent: 42 });
	const afterFirst = entriesReads;
	const second = buildTitleHeatmapGradient(progress, { color: '#0d9488', opacityPercent: 42 });
	assert.equal(second, first);
	assert.ok(first.includes('linear-gradient'));
	assert.equal(entriesReads, afterFirst, 'second call on identical progress ref must allocate nothing and skip Object.entries');
	assert.ok(getHeatmapGradientCacheSize() >= beforeCacheSize);
});

test('WordIntegrationPoller advances idleRounds and backs off to 12000ms when Zotero.Integration.sessions is empty', async () => {
	const prevZot = globalThis.Zotero;
	globalThis.Zotero = { Integration: {} };
	try {
		const kernel = new PluginKernel({ prefAdapter: createMemoryPrefs() });
		const tracker = new WordSessionTracker(kernel.bus, {});
		const poller = new WordIntegrationPoller(kernel, tracker);
		for (let i = 0; i < 6; i++) {
			const changed = await poller.pollOnce();
			assert.equal(changed, false);
		}
		assert.ok(poller.idleRounds >= 6);
		let scheduledDelay = 0;
		const origSetTimeout = globalThis.setTimeout;
		globalThis.setTimeout = ((_fn, delay) => { scheduledDelay = delay; return 999; });
		try {
			poller.running = true;
			poller.scheduleNext();
			assert.equal(scheduledDelay, 12_000);
		} finally {
			poller.running = false;
			globalThis.setTimeout = origSetTimeout;
		}
		kernel.shutdown();
	} finally {
		globalThis.Zotero = prevZot;
	}
});

test('CslFormattingEngine.peekCached hits synchronously and ItemPanePositionCoordinator short-circuits satisfied order', async () => {
	const prevZot = globalThis.Zotero;
	let formatCalls = 0;
	globalThis.Zotero = {
		Prefs: { get: () => 'bibliography=http://www.zotero.org/styles/apa' },
		Styles: { get: () => ({ id: 'apa' }) },
		QuickCopy: {
			unserializeSetting: () => ({ mode: 'bibliography', id: 'http://www.zotero.org/styles/apa', contentType: 'text' }),
			getContentFromItems: () => { formatCalls++; return { html: '<i>Ref</i>', text: 'Ref' }; },
		},
	};
	try {
		const prefs = new UnifiedPrefService({ adapter: createMemoryPrefs() });
		const csl = new CslFormattingEngine(prefs);
		const item = { id: 7, dateModified: '2026-11-26' };
		assert.equal(csl.peekCached([item]), null);
		await csl.formatItems([item]);
		assert.equal(formatCalls, 1);
		assert.equal(csl.peekCached([item])?.text, 'Ref');
		assert.equal(formatCalls, 1);

		const positioner = new ItemPanePositionCoordinator();
		const owner = {
			getPanes: () => [{ dataset: { pane: 'info' } }, { dataset: { pane: 'csl' } }],
			changePaneOrder: async () => {},
		};
		positioner.setTarget('csl', { sectionID: 'csl', getPosition: () => 'zotero-editpane-item-box' });
		await positioner.applyAll(owner);
		let timerCount = 0;
		const origSetTimeout = globalThis.setTimeout;
		globalThis.setTimeout = ((fn, ms) => { timerCount++; return origSetTimeout(fn, ms); });
		try {
			positioner.queue(owner);
			assert.equal(timerCount, 0, 'queue() must short-circuit when pane order signature has not changed');
		} finally {
			globalThis.setTimeout = origSetTimeout;
		}
	} finally {
		globalThis.Zotero = prevZot;
	}
});

test('Spotlight searches creatorYear & virtualMembers in RAM and resolves Word #ordinal via SpotlightFusionBridge', async () => {
	const prevZot = globalThis.Zotero;
	const item4 = { id: 404, isRegularItem: () => true, firstCreator: 'Ding et al.', getField: (f) => (f === 'title' ? '2H-MoS2 Monolayers' : f === 'year' ? '2017' : '') };
	globalThis.Zotero = { Items: { get: (id) => (id === 404 ? item4 : null) } };
	try {
		const kernel = new PluginKernel({
			prefAdapter: createMemoryPrefs({
				'modules.workspace.enable': true,
				'modules.wordCite.enable': true,
				'workspace.enableVirtualMembers': true,
				'fusion.spotlightCrossDomain': true,
			}),
		});
		const services = new ServiceContainer(kernel);
		const workspace = new WorkspaceDomainModule(kernel, services);
		const { WordCiteDomainModule } = await import('../src/domains/word-cite/module.ts');
		const wordCite = new WordCiteDomainModule(kernel, services);

		workspace.store.state.groups = [{ id: 'g1', name: 'Catalysis', color: '#2563eb', memberKeys: ['item:101', 'item:202'] }];
		workspace.store.state.virtualMembers = {
			'item:101': { key: 'item:101', itemID: 101, parentItemID: 101, type: 'reader', title: 'Live Paper', shortTitle: 'Live', filename: '', source: '', creatorYear: 'Zhang 2024', collection: 'Catalysis' },
			'item:202': { key: 'item:202', itemID: 202, parentItemID: 202, type: 'reader', title: 'Virtual Paper', shortTitle: 'Virtual', filename: '', source: '', creatorYear: 'Chen 2023', collection: 'Catalysis' },
		};
		const win = { Zotero_Tabs: { _tabs: [{ id: 'tab-1', type: 'reader', title: 'Live Paper', data: { itemID: 101 } }] } };
		const byCreator = workspace.spotlight.query('Zhang 2024', win);
		assert.equal(byCreator[0]?.id, 'tab:item:101');
		const byVirtual = workspace.spotlight.query('Chen 2023', win);
		assert.equal(byVirtual[0]?.id, 'vtab:item:202');

		const fusion = new SpotlightFusionBridge(kernel, workspace, wordCite);
		fusion.start();
		wordCite.tracker.syncSessions([{
			sessionID: 's1',
			documentPath: 'C:/docs/Paper.docx',
			citations: [{ itemID: 404, ordinal: 4, shortText: '[4]', occurrences: 2 }],
		}]);
		const wordHit = workspace.spotlight.query('#4', win);
		assert.equal(wordHit[0]?.id, 'word-cited:404');
		assert.equal(wordHit[0]?.badge, 'Word [4]');
		fusion.stop();
		kernel.shutdown();
	} finally {
		globalThis.Zotero = prevZot;
	}
});
