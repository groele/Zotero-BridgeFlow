import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceSpotlightEngine } from '../src/domains/workspace/spotlight-engine.ts';
import { WorkspaceDiskCache } from '../src/domains/workspace/workspace-disk-cache.ts';
import { CitationHistoryStore } from '../src/services/citation-history-store.ts';

test('shared custom root recovers a legacy default snapshot and writes a compact primary there', async t => {
	const oldIO = globalThis.IOUtils, oldZ = globalThis.Zotero;
	t.after(() => { globalThis.IOUtils = oldIO; globalThis.Zotero = oldZ; });
	globalThis.Zotero = { DataDirectory: { dir: 'data' } };
	const files = new Map();
	globalThis.IOUtils = { writeUTF8: async (p, s) => files.set(p, s), exists: async p => files.has(p), readUTF8: async p => files.get(p) };
	const primary = new WorkspaceDiskCache();
	const state = {
		version: 2, groups: [], collapsed: [], pinnedKeys: [], sleepingKeys: [], remarks: { 'item:5': 'keep' },
		remarkModes: {}, lastViewedAt: {}, readingProgress: {}, virtualMembers: {}, sessions: [], rollingSessions: [],
	};
	await primary.flushNow(state);
	const migrated = new WorkspaceDiskCache('shared');
	const restored = await migrated.loadFromDisk();
	assert.equal(restored.remarks['item:5'], 'keep');
	await migrated.flushNow(restored);
	const history = new CitationHistoryStore();
	history.configure({ customDir: 'shared' });
	assert.equal(migrated.getDirectoryPath(), 'shared/workspace');
	assert.equal(history.getDirectoryPath(), 'shared/citations');
	assert.ok(files.has(migrated.getFilePath()));
	assert.ok(files.has(primary.getFilePath()));
	history.dispose();
});

test('opening and typing never hydrate library records, project virtual tabs, or enumerate snapshot contents', t => {
	const fail = () => assert.fail('heavy path reached');
	const old = globalThis.Zotero;
	t.after(() => { globalThis.Zotero = old; });
	globalThis.Zotero = { get Items() { return fail(); }, get DB() { return fail(); } };
	const state = { remarks: {}, groups: [], sessions: [{ name: 'Draft', get openKeys() { return fail(); } }] };
	const engine = new WorkspaceSpotlightEngine({get: () => true}, {state}, {buildTrackedTabs: fail});
	engine.registerProvider({priority: 1, id:'sentinel', query: fail});
	let visited = 0;
	const native = Array.from({length:50000}, (_, i) => ({id:String(i), type:'reader',
		get title() { visited++; return 'Paper ' + i; }}));
	const win = {Zotero_Tabs:{_tabs:native}};
	assert.equal(engine.query('',win).length,12);
	assert.equal(visited,12);
	assert.equal(engine.query('paper',win).length,40);
	assert.equal(visited,52);
	assert.equal(engine.query('Draft',win)[0].title,'Draft');
	assert.deepEqual(engine.query('@absent',win),[]);
});
