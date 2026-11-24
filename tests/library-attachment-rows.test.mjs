import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectItemAnnotations } from '../src/services/annotation-utils.ts';
import { readItemRemarkWithFallback } from '../src/domains/visual-notes/data-source.ts';
import { ReadingColumnsController } from '../src/domains/visual-notes/library-columns.ts';

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
