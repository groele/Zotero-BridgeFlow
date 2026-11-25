import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectItemAnnotations } from '../src/services/annotation-utils.ts';
import { readItemRemarkWithFallback } from '../src/domains/visual-notes/data-source.ts';
import { ReadingColumnsController } from '../src/domains/visual-notes/library-columns.ts';

import { getNormalizedItemRemark, setNormalizedItemRemark } from '../src/domains/workspace/workspace-session-ops.ts';

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
