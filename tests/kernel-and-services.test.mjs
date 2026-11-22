import test from 'node:test';
import assert from 'node:assert/strict';
import { DisposableStack } from '../src/kernel/disposable.ts';
import { TypedEventBus } from '../src/kernel/event-bus.ts';
import { runLegacyPrefMigration, CURRENT_MIGRATION_VERSION } from '../src/kernel/migration.ts';
import { NativeRuntime } from '../src/kernel/native-runtime.ts';
import { UnifiedPrefService } from '../src/kernel/pref-service.ts';
import { PluginKernel } from '../src/kernel/plugin-kernel.ts';
import { CitationHistoryStore } from '../src/services/citation-history-store.ts';
import { UnifiedClipboardService } from '../src/services/clipboard-service.ts';
import { CslFormattingEngine } from '../src/services/csl-engine.ts';
import { deduplicateRegularItems, normalizeToRegularItem } from '../src/services/item-resolution.ts';

function createMemoryPrefs(initial = {}) {
	const store = new Map(Object.entries(initial));
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

test('DisposableStack disposes in LIFO order and isolates errors', () => {
	const order = [];
	const errors = [];
	const stack = new DisposableStack();
	stack.add(() => order.push('first'));
	stack.add(() => { order.push('boom'); throw new Error('fail'); });
	stack.add(() => order.push('last'));
	stack.disposeAll((err) => errors.push(err));
	assert.deepEqual(order, ['last', 'boom', 'first']);
	assert.equal(errors.length, 1);
	assert.equal(stack.size, 0);
});

test('NativeRuntime patches and restores nested wrapper chains safely', () => {
	const rt = new NativeRuntime();
	const target = { fn: (x) => x + 1 };
	const d1 = rt.patch(target, 'fn', 't', (orig) => (x) => orig(x) * 2);
	const d2 = rt.patch(target, 'fn', 't', (orig) => (x) => orig(x) + 10);
	assert.equal(target.fn(3), 18); // (3+1)*2 + 10
	d1();
	assert.equal(target.fn(3), 14); // (3+1) + 10
	d2();
	assert.equal(target.fn(3), 4);
	assert.equal(rt.pendingPatchCount, 0);
});

test('MigrationEngine migrates non-default legacy prefs idempotently without deleting legacy keys', () => {
	const mem = createMemoryPrefs({
		'extensions.zotero.tabflow.verticalSidebarWidth': 320,
		'extensions.zoteropreview.whatToShow': 'zpbib',
		'extensions.zotero.zoterocitation.citationTags.text': 'CitedInPaper',
	});
	const prefs = new UnifiedPrefService({ adapter: mem.adapter });
	const report1 = runLegacyPrefMigration(prefs);
	assert.equal(report1.skipped, false);
	assert.deepEqual(new Set(report1.sourcesDetected), new Set(['TabFlow', 'ViewFlow', 'CiteFlow']));
	assert.equal(prefs.get('workspace.verticalSidebarWidth'), 320);
	assert.equal(prefs.get('inspector.cslPreview.whatToShow'), 'zpbib');
	assert.equal(prefs.get('wordCite.citationTags.text'), 'CitedInPaper');
	assert.equal(prefs.get('migrationVersion'), CURRENT_MIGRATION_VERSION);
	// Legacy keys remain intact for rollback
	assert.equal(mem.store.get('extensions.zotero.tabflow.verticalSidebarWidth'), 320);

	// Second run is a no-op
	const report2 = runLegacyPrefMigration(prefs);
	assert.equal(report2.skipped, true);
});

test('PluginKernel hot-toggles domain modules cleanly on pref change', async () => {
	const mem = createMemoryPrefs();
	const kernel = new PluginKernel({ prefAdapter: mem.adapter });
	let active = false;
	let starts = 0;
	let stops = 0;
	kernel.registerDomain({
		id: 'workspace',
		enabledPref: 'modules.workspace.enable',
		start() { active = true; starts++; },
		stop() { active = false; stops++; },
		isActive() { return active; },
	});
	kernel.init({ id: 'bridgeflow@groele', version: '0.0.1', rootURI: 'chrome://test/' });
	await kernel.start();
	assert.equal(active, true);
	assert.equal(starts, 1);

	kernel.prefs.set('modules.workspace.enable', false);
	await new Promise((r) => setTimeout(r, 10));
	assert.equal(active, false);
	assert.equal(stops, 1);

	kernel.shutdown();
});

test('ItemResolution guards against cycles and trashed items', () => {
	const parent = { id: 10, itemType: 'journalArticle', isRegularItem: () => true };
	const child = { id: 11, itemType: 'attachment', isRegularItem: () => false, parentItem: parent };
	assert.equal(normalizeToRegularItem(child), parent);

	const cycA = { id: 20, itemType: 'attachment', isRegularItem: () => false };
	cycA.parentItem = cycA;
	assert.equal(normalizeToRegularItem(cycA), null);

	const trashed = { id: 30, itemType: 'journalArticle', isRegularItem: () => true, isTrashed: () => true };
	const { items } = deduplicateRegularItems([child, parent, trashed]);
	assert.equal(items.length, 1);
	assert.equal(items[0].id, 10);
});

test('CslFormattingEngine + ClipboardService + CitationHistoryStore roundtrip', async () => {
	const mem = createMemoryPrefs();
	const bus = new TypedEventBus();
	const prefs = new UnifiedPrefService({ bus, adapter: mem.adapter });
	const csl = new CslFormattingEngine(prefs);
	const clipboard = new UnifiedClipboardService(csl, bus);
	const history = new CitationHistoryStore();

	// Mock Zotero clipboard fallback
	globalThis.Zotero = {
		Utilities: { Internal: { copyTextToClipboard: () => {} } },
	};

	const copiedEvents = [];
	bus.on('citation:copied', (ev) => {
		copiedEvents.push(ev);
		history.record({
			text: ev.text,
			libraryID: 1,
			itemKey: 'KEY001',
			itemID: ev.itemIDs[0],
			title: 'Attention Is All You Need',
			style: ev.styleID,
		});
	});

	const item = { id: 42, itemType: 'journalArticle', isRegularItem: () => true, getField: () => 'Attention Is All You Need' };
	const ok = await clipboard.copyItems([item], { source: 'tab-menu' });
	assert.equal(ok, true);
	assert.equal(copiedEvents.length, 1);
	assert.equal(copiedEvents[0].source, 'tab-menu');

	const found = history.lookupExact('Attention Is All You Need');
	assert.equal(found?.itemID, 42);
	delete globalThis.Zotero;
});
