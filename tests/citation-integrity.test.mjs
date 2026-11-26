import test from 'node:test';
import assert from 'node:assert/strict';
import { CitationLookupEngine } from '../src/domains/inspector/lookup/citation-lookup-engine.ts';
import { CitationHistoryStore } from '../src/services/citation-history-store.ts';
import { UnifiedClipboardService } from '../src/services/clipboard-service.ts';
import { CslFormattingEngine } from '../src/services/csl-engine.ts';
import { TypedEventBus } from '../src/kernel/event-bus.ts';
import { CopyHistoryBridge } from '../src/bridges/copy-history-bridge.ts';
import { syncItemRemarkToExtra } from '../src/services/item-remark-sync.ts';

const item = (id, fields = {}) => ({ id, key: 'K' + id, libraryID: 1, isRegularItem: () => true,
	getField: key => fields[key] || '' });
test('explicit identifiers override stale history and similar metadata in scoped searches', async () => {
	const history = new CitationHistoryStore();
	const engine = new CitationLookupEngine(history);
	const candidate = item(1, { title: 'Same full article title', archiveID: '2401.12345v1' });
	for (const query of ['arXiv:2401.12345v2', 'Same full article title DOI:10.1234/example']) {
		history.record({ text: query, itemID: 1, itemKey: 'K1', libraryID: 1, title: 'stale', style: 'apa' });
		assert.deepEqual(await engine.lookup(query, [candidate]), []);
		assert.deepEqual(await engine.lookup(query, []), []);
	}
	assert.equal((await engine.lookup('arXiv:2401.12345v1', [candidate]))[0]?.itemID, 1);
	assert.deepEqual(await engine.lookup('arXiv:2401.12345v2', [item(2, { archiveID: '2401.12345' })]), []);
});

test('batch copy includes all selected entries and clipboard failures do not record history', async t => {
	const bus = new TypedEventBus();
	const events = [];
	bus.on('citation:copied', event => events.push(event));
	const previous = globalThis.Zotero;
	t.after(() => { globalThis.Zotero = previous; });
	let writes = 0;
	globalThis.Zotero = { Utilities: { Internal: { copyTextToClipboard() { writes++; } } } };
	const items = Array.from({ length: 125 }, (_, i) => item(i + 1));
	const clipboard = new UnifiedClipboardService({ formatItems: async entries => {
		assert.equal(entries.length, 125);
		return { text: 'formatted references', html: '', styleID: 'apa' };
	} }, bus);
	assert.equal(await clipboard.copyItems(items, { source: 'preview' }), true);
	assert.equal(events[0].itemIDs.length, 125);
	assert.equal(clipboard.writePayload('<b>only HTML</b>', ''), false);
	assert.equal(writes, 1);
	globalThis.Zotero.Utilities.Internal.copyTextToClipboard = () => { throw Error('busy'); };
	assert.equal(clipboard.copyRendered(items, { text: 'text', html: '', styleID: 'apa' }, { source: 'preview' }), false);
	assert.equal(events.length, 1);
	const csl = new CslFormattingEngine({ get: () => '' });
	await assert.rejects(csl.formatItems(items), { previewCode: 'quickcopy-unavailable' });
});

test('ambiguous bibliography lines are never assigned by selection order', t => {
	const bus = new TypedEventBus();
	const history = new CitationHistoryStore();
	const previous = globalThis.Zotero;
	t.after(() => { globalThis.Zotero = previous; });
	globalThis.Zotero = { Items: { get: id => item(id) } };
	const bridge = new CopyHistoryBridge({ bus, prefs: { get: () => true } }, { history });
	bridge.start();
	bus.emit('citation:copied', { itemIDs: [2, 1], text: 'A line with no identifying metadata\nAnother ambiguous reference' });
	assert.equal(history.count, 0);
	bridge.stop();
});

test('failed Extra save allows a retry of the identical remark', async () => {
	let extra = 'existing';
	let calls = 0;
	const entry = { ...item(99), getField: () => extra, setField: (_, value) => { extra = value; },
		saveTx: async () => { if (++calls === 1) throw Error('disk full'); } };
	assert.equal(await syncItemRemarkToExtra(entry, 'retry'), false);
	assert.equal(extra, 'existing');
	assert.equal(await syncItemRemarkToExtra(entry, 'retry'), true);
	assert.equal(calls, 2);
});
