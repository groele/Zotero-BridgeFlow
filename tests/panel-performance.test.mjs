import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestPreviewPage } from '../src/domains/inspector/pdf/pdf-viewport-manager.ts';
import { WordIntegrationPoller } from '../src/domains/word-cite/ipc/word-poller.ts';

test('Long PDF scroll locates the nearest page with bounded layout reads', () => {
	let reads = 0;
	const slots = Array.from({ length: 1000 }, (_, i) => ({
		pageNumber: i + 1,
		card: { get offsetTop() { reads++; return i * 100; } },
	}));
	for (const [top, expected] of [[0, 1], [50, 1], [51, 2], [75001, 751], [100500, 1000]]) {
		reads = 0;
		assert.equal(nearestPreviewPage(slots, top), expected);
		assert.ok(reads <= 12);
	}
});

test('Repeated Word citations read item state once per snapshot and observe subsequent trashing', () => {
	let reads = 0;
	let deleted = false;
	const previous = globalThis.Zotero;
	globalThis.Zotero = { Items: { get() { reads++; return { deleted }; } } };
	try {
		const poller = new WordIntegrationPoller({}, {});
		const citation = { citationItems: [{ id: 42 }] };
		const session = { citationsByIndex: Array(1000).fill(citation), citationsByItemID: { 42: [citation] } };
		assert.equal(poller.extractSessionCitations(session)[0].occurrences, 1000);
		assert.equal(reads, 1);
		deleted = true;
		assert.deepEqual(poller.extractSessionCitations(session), []);
		assert.equal(reads, 2);
	} finally {
		globalThis.Zotero = previous;
	}
});
