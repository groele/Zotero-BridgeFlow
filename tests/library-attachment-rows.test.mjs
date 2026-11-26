import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectItemAnnotations } from '../src/services/annotation-utils.ts';
import { clearGalleryCardCache, resolveCachedCardStatic } from '../src/domains/visual-notes/gallery/gallery-card-cache.ts';
import { clearExtraRemarkCache, readItemRemarkWithFallback } from '../src/domains/visual-notes/data-source.ts';
import { ReadingColumnsController } from '../src/domains/visual-notes/columns/library-columns.ts';

import { getNormalizedItemRemark, setNormalizedItemRemark } from '../src/domains/workspace/store/workspace-session-ops.ts';

test('library columns render standalone attachment rows without enumerating child attachments', () => {
	const item = {
		id: 42, itemType: 'attachment',
		isAttachment: () => true, isFileAttachment: () => true,
		getAnnotations: () => [], getField: () => '',
		getAttachments() { throw new Error('cannot enumerate children of an attachment'); },
	};
	const source = { getRemark: () => '', getReadingProgress: () => undefined };
	assert.equal(readItemRemarkWithFallback(item, source), '');
	assert.deepEqual(collectItemAnnotations([item], {}), []);
	const columns = new ReadingColumnsController({}, source);
	assert.equal(columns.getReadProgressForItem(item), undefined);
});

test('gallery brief notes resolve attached PDFs and standalone children through the workspace store', (t) => {
	const child = {
		id: 2, parentItemID: 1, isRegularItem: () => false, isAttachment: () => true,
		getAttachments() { throw Error('invalid child enumeration'); },
	};
	const parent = { id: 1, getAttachments: () => [2], getField: () => '' };
	const items = new Map([[1, parent], [2, child]]);
	const previous = globalThis.Zotero;
	t.after(() => { globalThis.Zotero = previous; });
	globalThis.Zotero = { Items: { get: id => items.get(id) } };
	const state = { remarks: {}, virtualMembers: {} };
	const source = { getRemark: id => getNormalizedItemRemark(state, id) };
	assert.equal(readItemRemarkWithFallback(parent, source), '');
	state.remarks['item:2'] = 'legacy PDF note';
	assert.equal(readItemRemarkWithFallback(parent, source), 'legacy PDF note');
	assert.equal(setNormalizedItemRemark(state, 2, 'parent note'), true);
	assert.deepEqual(state.remarks, { 'item:1': 'parent note' });
	assert.equal(source.getRemark(2), 'parent note');
	child.parentItemID = 0;
	assert.equal(source.getRemark(2), '');
	assert.equal(setNormalizedItemRemark(state, 2, 'standalone note'), true);
	assert.equal(source.getRemark(2), 'standalone note');
});

test('gallery cache refreshes changed IDs, versions and display settings independently', () => {
	const make = id => ({
		id, version: 1, text: 'original', itemType: 'book',
		getField(key) { return key === 'title' ? this.text : key === 'extra' ? 'BridgeFlow-Remark: ' + this.text : ''; },
		getTags: () => [{ tag: '/Reading' }],
	});
	const a = make(81001), b = make(81002);
	const card = (item, zh = false, excluded = '/Citations') => resolveCachedCardStatic(item, item.id, zh, excluded);
	const original = card(b);
	assert.equal(card(a).title, 'original');
	assert.equal(readItemRemarkWithFallback(a), 'original');
	assert.equal(readItemRemarkWithFallback(b), 'original');
	a.text = b.text = 'edited';
	clearGalleryCardCache([a.id]);
	clearExtraRemarkCache([a.id]);
	assert.equal(card(a).title, 'edited');
	assert.equal(readItemRemarkWithFallback(a), 'edited');
	assert.equal(card(b), original);
	assert.equal(readItemRemarkWithFallback(b), 'original');
	b.version++;
	assert.equal(card(b).title, 'edited');
	assert.equal(readItemRemarkWithFallback(b), 'edited');
	assert.notEqual(card(a, true).itemTypeLabel, card(a).itemTypeLabel);
	assert.deepEqual(card(a, false, '/Reading').tags, []);
});
