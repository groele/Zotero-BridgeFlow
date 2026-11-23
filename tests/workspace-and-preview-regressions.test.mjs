import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceDiskCache } from '../src/domains/workspace/workspace-disk-cache.ts';
import { SpotlightLibraryIndex } from '../src/domains/workspace/spotlight-library.ts';
import { CslFormattingEngine } from '../src/services/csl-engine.ts';
import { displayAttachmentName } from '../src/domains/inspector/pdf-folder-section.ts';

test('queued workspace writes preserve a fast revert and deduplicate adjacent identical states', async (t) => {
	const writes = [];
	const original = globalThis.IOUtils;
	t.after(() => { globalThis.IOUtils = original; });
	globalThis.IOUtils = { async writeUTF8(path, raw) {
		if (!path.includes('.bak.')) writes.push(JSON.parse(raw).state.name);
	} };
	const cache = new WorkspaceDiskCache();
	await cache.flushNow({ name: 'A' });
	await Promise.all(['B', 'A', 'A'].map(name => cache.flushNow({ name })));
	assert.deepEqual(writes, ['A', 'B', 'A']);
});

test('Spotlight coalesces invalidations received during library enumeration', async (t) => {
	const original = globalThis.Zotero;
	t.after(() => { globalThis.Zotero = original; });
	let release, calls = 0;
	const item = { id: 1, key: 'K', isRegularItem: () => true, getField: () => 'updated' };
	globalThis.Zotero = { Items: { async getAll() {
		if (++calls === 1) { await new Promise(resolve => { release = resolve; }); return []; }
		return [item];
	} } };
	const index = new SpotlightLibraryIndex({});
	index.warmUp();
	index.invalidate();
	index.invalidate();
	release();
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(calls, 2);
	assert.equal(index.query('updated', {}, new Set()).length, 1);
});

test('CSL concurrent calls share initialization and locale changes invalidate the formatted result', async (t) => {
	const original = globalThis.Zotero;
	t.after(() => { globalThis.Zotero = original; });
	let starts = 0, locale = 'en-US';
	globalThis.Zotero = { Styles: { async init() { starts++; } }, QuickCopy: {
		getFormatFromURL: () => '', unserializeSetting: () => ({ id: 'apa', mode: 'bibliography', locale }),
		getContentFromItems: (_items, fmt) => ({ text: fmt.locale, html: fmt.locale }),
	} };
	const engine = new CslFormattingEngine({ get: () => '' });
	const items = [{ id: 1 }];
	await Promise.all([engine.formatItems(items), engine.formatItems(items)]);
	locale = 'zh-CN';
	assert.equal((await engine.formatItems(items)).text, 'zh-CN');
	assert.equal(starts, 1);
});

test('filename labels decode valid sequences while retaining malformed escapes', () => {
	assert.equal(displayAttachmentName('Atomic%E2%80%90Scale%20A.pdf'), 'Atomic‐Scale A.pdf');
	assert.equal(displayAttachmentName('10% - %FF.pdf'), '10% - %FF.pdf');
});
import { bindPreviewSidenavClick, PreviewFocus } from '../src/domains/inspector/pdf-preview-ui.ts';

test('PDF icon selects only its own pane and opens a previously empty section', () => {
	let click;
	const results = [];
	const body = { closest: name => name === 'collapsible-section' ? collapsible : section };
	const section = { getAttribute: () => 'pdf' };
	const collapsible = { empty: true, removeAttribute() { this.empty = false; }, set open(value) { assert.equal(this.empty, false); this.opened = value; } };
	const owner = { contains: element => element === body };
	const doc = { addEventListener(_type, fn) { click = fn; } };
	bindPreviewSidenavClick(doc, new AbortController().signal, body, active => results.push(active));
	function select(id, container) {
		const btn = { matches: () => true, hasAttribute: () => false, getAttribute: () => id, closest: () => ({ container }) };
		click({ button: 0, detail: 1, composedPath: () => [btn] });
	}
	select('pdf', { contains: () => false });
	select('pdf', owner);
	select('word', owner);
	assert.equal(collapsible.opened, true);
	assert.deepEqual(results, [true, false]);
});

test('PDF focus survives section replacement within the same item pane', () => {
	const focus = new PreviewFocus();
	const owner = {}, replacement = { closest: () => owner };
	const body = { closest: name => name === 'item-details' ? owner : null };
	const state = { body, root: { setAttribute() {} }, customSection: null, fullActive: false };
	focus.set(state, true);
	assert.equal(focus.isActive(replacement), true);
	assert.equal(focus.isActive({ closest: () => ({}) }), false);
	focus.set(state, false);
	assert.equal(focus.isActive(replacement), false);
});
import { ItemPanePositionCoordinator } from '../src/services/pane-positioner.ts';
import { patchCollectionsViewForWindow } from '../src/domains/word-cite/collection-tree-order.ts';
import { NativeRuntime } from '../src/kernel/native-runtime.ts';

test('Word panel moves beside each native anchor without shifting other plugin panels', async () => {
	const positioner = new ItemPanePositionCoordinator();
	const panes = ['info', 'abstract', 'attachments', 'notes', 'tags', 'related', 'word', 'pdf'];
	const moves = [];
	const owner = {
		getPanes: () => panes.map(pane => ({ dataset: { pane } })),
		async changePaneOrder(id, index) {
			moves.push(id);
			const current = panes.indexOf(id);
			panes.splice(current, 1);
			panes.splice(index - Number(current < index), 0, id);
		},
	};
	let position = 'zotero-editpane-related';
	positioner.setTarget('pdf', { sectionID: 'pdf', getPosition: () => 'zotero-editpane-related' });
	positioner.setTarget('word', { sectionID: 'word', getPosition: () => position });
	for (const [value, previous] of [
		['zotero-editpane-related', 'pdf'], ['zotero-item-pane-header', undefined],
		['zotero-editpane-item-box', 'info'], ['zotero-editpane-abstract', 'abstract'],
		['zotero-editpane-attachments', 'attachments'], ['zotero-editpane-notes', 'notes'],
		['zotero-editpane-related', 'pdf'],
	]) {
		position = value;
		await positioner.applyAll(owner);
		assert.equal(panes[panes.indexOf('word') - 1], previous);
		assert.deepEqual(panes.filter(id => id !== 'word'), ['info', 'abstract', 'attachments', 'notes', 'tags', 'related', 'pdf']);
	}
	moves.length = 0;
	await positioner.applyAll(owner);
	assert.deepEqual(moves, []);
});

test('a mounted collection row renderer picks up the Word icon and restores the folder on disposal', () => {
	const rows = [
		{ type: 'collection', ref: { key: 'WORD', name: 'de.docx' } },
		{ type: 'collection', ref: { key: 'OTHER', name: 'Literature' } },
	];
	const cv = {
		getRow: index => rows[index],
		_getIcon: () => ({ type: 'folder' }),
		renderItem: index => cv._getIcon(index),
	};
	const renderMountedRow = cv.renderItem;
	const win = { ZoteroPane: { collectionsView: cv }, document: { createElementNS: (_ns, type) => ({ type }) } };
	const dispose = patchCollectionsViewForWindow(win, new NativeRuntime(), () => new Set(['WORD']), 'assets/word.svg');
	assert.equal(renderMountedRow(0).src, 'assets/word.svg');
	assert.equal(renderMountedRow(1).type, 'folder');
	dispose();
	assert.equal(renderMountedRow(0).type, 'folder');
});
