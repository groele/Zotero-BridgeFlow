import test from 'node:test';
import assert from 'node:assert/strict';
import { DisposableStack } from '../src/kernel/disposable.ts';
import { TypedEventBus } from '../src/kernel/event-bus.ts';
import { NativeRuntime } from '../src/kernel/native-runtime.ts';
import { UnifiedPrefService } from '../src/kernel/pref-service.ts';
import { PluginKernel } from '../src/kernel/plugin-kernel.ts';
import { CitationHistoryStore } from '../src/services/citation-history-store.ts';
import { UnifiedClipboardService } from '../src/services/clipboard-service.ts';
import { CslFormattingEngine } from '../src/services/csl-engine.ts';
import { CitationLookupEngine } from '../src/domains/inspector/citation-lookup-engine.ts';
import { focusOrOpenTrackedItem } from '../src/domains/workspace/tab-actions-helpers.ts';
import { WorkspaceStateStore } from '../src/domains/workspace/state-store.ts';
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

test('kernel starts with independent BridgeFlow preferences', async () => {
	const mem = createMemoryPrefs({ 'extensions.zotero.tabflow.verticalSidebarWidth': 320 });
	const kernel = new PluginKernel({ prefAdapter: mem.adapter });
	await kernel.start();
	assert.equal(kernel.prefs.get('workspace.verticalSidebarWidth'), 276);
	assert.equal(mem.store.get('extensions.zotero.tabflow.verticalSidebarWidth'), 320);
	kernel.shutdown();
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

	// Token-overlap fuzzy matching + dash normalization on citation history
	history.record({
		text: 'Vaswani, A. (2017). Attention Is All You Need \u2014 Advances in Neural Processing, 30, 5998-6008.',
		libraryID: 1,
		itemKey: 'KEY002',
		itemID: 99,
		title: 'Attention Is All You Need',
		style: 'apa',
	});
	const fuzzyHits = history.searchFuzzy('Vaswani 2017 Neural Processing 5998-6008');
	assert.equal(fuzzyHits[0]?.itemID, 99);

	// ClipboardService catches CSL formatting errors cleanly instead of rejecting
	const brokenClipboard = new UnifiedClipboardService({
		formatItems: async () => { throw new Error('missing csl style'); },
	}, bus);
	assert.equal(await brokenClipboard.copyItems([item], { source: 'tab-menu' }), false);

	// CitationLookupEngine falls back cleanly to weightedSearch with group libraryID when physical search yields empty
	let capturedLibId = null;
	const groupItem = {
		id: 505,
		deleted: false,
		firstCreator: 'Zhang',
		isRegularItem: () => true,
		getField: (f) => ({
			title: 'Basin Water Balance Under Changing Climate',
			publicationTitle: 'Journal of Hydrology',
			year: '2023',
			pages: '100-112',
			volume: '999', // mismatch with parsed query volume so physical filter returns []
		}[f] || ''),
	};
	globalThis.Zotero = {
		Search: class { addCondition() {} async search() { return []; } },
		Libraries: { userLibraryID: 1 },
		Items: {
			getAll: async (libID) => { capturedLibId = libID; return [groupItem]; },
			getAsync: async () => null,
			get: () => null,
		},
	};
	const lookupEngine = new CitationLookupEngine(new CitationHistoryStore());
	const rich = await lookupEngine.resolveRich('Journal of Hydrology, 2023, 620, 100-112', { libraryID: 9, useHistory: false });
	assert.equal(capturedLibId, 9);
	assert.equal(rich.candidates[0]?.itemID, 505);

	// PluginKernel hot-toggles visual-notes domain when modules.visualNotes.enable flips
	const vnPrefs = createMemoryPrefs({
		'modules.workspace.enable': false,
		'modules.visualNotes.enable': true,
		'modules.inspector.enable': false,
		'modules.wordCite.enable': false,
	});
	const kernel = new PluginKernel({ prefAdapter: vnPrefs.adapter });
	let vnActive = false;
	kernel.registerDomain({
		id: 'visual-notes',
		enabledPref: 'modules.visualNotes.enable',
		isActive: () => vnActive,
		start: () => { vnActive = true; },
		stop: () => { vnActive = false; },
	});
	await kernel.start();
	assert.equal(vnActive, true);
	kernel.prefs.set('modules.visualNotes.enable', false);
	await new Promise((r) => setTimeout(r, 10));
	assert.equal(vnActive, false);
	kernel.prefs.set('modules.visualNotes.enable', true);
	await new Promise((r) => setTimeout(r, 10));
	assert.equal(vnActive, true);
	kernel.shutdown();

	// focusOrOpenTrackedItem resolves parent regular item -> getBestAttachment() instead of opening parent ID directly
	const openedReaderIDs = [];
	const parentPdf = { id: 888, deleted: false, isAttachment: () => true, isFileAttachment: () => true, fileExists: async () => true };
	const parentReg = { id: 777, deleted: false, isNote: () => false, isAttachment: () => false, getBestAttachment: async () => parentPdf };
	globalThis.Zotero = {
		Items: { get: (id) => (id === 777 ? parentReg : id === 888 ? parentPdf : null) },
		Reader: { open: async (id) => { openedReaderIDs.push(id); } },
	};
	const wsStore = new WorkspaceStateStore(kernel.prefs);
	const openedOutcome = await focusOrOpenTrackedItem({ Zotero_Tabs: { _tabs: [] } }, wsStore, [], { itemID: 777 }, () => {});
	assert.equal(openedOutcome, 'opened');
	assert.deepEqual(openedReaderIDs, [888]);
	delete globalThis.Zotero;
});
