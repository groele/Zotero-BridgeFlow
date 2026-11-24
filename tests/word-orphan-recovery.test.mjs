import test from 'node:test';
import assert from 'node:assert/strict';

import { PluginKernel } from '../src/kernel/plugin-kernel.ts';
import { ServiceContainer } from '../src/services/service-container.ts';
import { WordCiteDomainModule } from '../src/domains/word-cite/module.ts';
import { extractSessionCitationsWithOrphans } from '../src/domains/word-cite/orphan-extraction.ts';
import { buildOrphanBannerModel, formatRecoverReceipt } from '../src/domains/inspector/word-cite-panel-ui.ts';

function createItemStub(id, { title = `Paper ${id}`, inTrash = false, deleted = false } = {}) {
	return {
		id,
		deleted,
		inTrash: () => inTrash,
		getField: (f) => (f === 'title' ? title : ''),
		collections: [],
		addToCollection(cid) { this.collections.push(cid); },
		saveCount: 0,
		async saveTx() { this.saveCount += 1; },
	};
}

test('extractSessionCitationsWithOrphans preserves true document ordinals across trashed & missing items', () => {
	const prevZotero = globalThis.Zotero;
	const itemsById = new Map([
		[101, createItemStub(101, { title: 'Valid 1' })],
		[102, createItemStub(102, { title: 'Valid 2' })],
		[103, createItemStub(103, { title: 'Trashed 3', inTrash: true })],
		// 104 is completely deleted / missing from Zotero
		[105, createItemStub(105, { title: 'Valid 5' })],
	]);
	globalThis.Zotero = {
		Items: { get: (id) => itemsById.get(id) ?? null },
	};

	try {
		const session = {
			citationsByIndex: {
				0: {
					properties: { plainCitation: '1,2' },
					citationItems: [{ id: 101 }, { id: 102 }],
				},
				1: {
					properties: { plainCitation: '3,4' },
					citationItems: [
						{ id: 103 },
						{
							id: 104,
							uris: ['http://zotero.org/users/1/items/MISSING4'],
							itemData: {
								type: 'article-journal',
								title: 'Embedded Missing Study',
								author: [{ family: 'Zhang', given: 'Wei' }],
								issued: { 'date-parts': [[2025]] },
								DOI: '10.1000/missing.4',
							},
						},
					],
				},
				2: {
					properties: { plainCitation: '5' },
					citationItems: [{ id: 105 }],
				},
			},
			citationsByItemID: {
				101: [{ properties: { plainCitation: '1,2' } }],
				102: [{ properties: { plainCitation: '1,2' } }],
				103: [{ properties: { plainCitation: '3,4' } }],
				105: [{ properties: { plainCitation: '5' } }],
			},
		};

		const { citations, orphans } = extractSessionCitationsWithOrphans(session);
		const map = new Map(citations.map((c) => [c.itemID, c]));

		assert.equal(map.get(101)?.ordinal, 1);
		assert.equal(map.get(102)?.ordinal, 2);
		assert.equal(map.get(105)?.ordinal, 5, 'Valid item after 2 orphans must stay at ordinal 5, not shift to 3');
		assert.equal(map.has(103), false);
		assert.equal(map.has(104), false);

		assert.equal(orphans.length, 2);
		assert.equal(orphans[0].kind, 'trashed');
		assert.equal(orphans[0].ordinal, 3);
		assert.equal(orphans[0].title, 'Trashed 3');

		assert.equal(orphans[1].kind, 'missing');
		assert.equal(orphans[1].ordinal, 4);
		assert.equal(orphans[1].title, 'Embedded Missing Study');
		assert.equal(orphans[1].authorYear, 'Zhang, 2025');
	} finally {
		globalThis.Zotero = prevZotero;
	}
});

test('WordCiteDomainModule handles word:recover-orphans-request by restoring trashed items and reverse-importing missing items', async () => {
	const prevZotero = globalThis.Zotero;
	const trashedItem = createItemStub(203, { title: 'Trashed Paper', deleted: true, inTrash: true });
	const createdItems = [];

	class FakeZoteroItem {
		constructor(itemType) {
			this.itemType = itemType;
			this.fields = {};
			this.creators = [];
			this.collections = [];
		}
		setField(k, v) { this.fields[k] = v; }
		setCreators(c) { this.creators = c; }
		addToCollection(cid) { this.collections.push(cid); }
		async saveTx() { createdItems.push(this); }
	}

	globalThis.Zotero = {
		Item: FakeZoteroItem,
		Libraries: { userLibraryID: 1 },
		Items: {
			get: (id) => (id === 203 ? trashedItem : null),
			getAsync: async (id) => (id === 203 ? trashedItem : null),
		},
		Prefs: { get: () => '', set: () => {}, registerObserver: () => 0, unregisterObserver: () => {} },
	};

	const kernel = new PluginKernel({ id: 'bridgeflow@groele', version: '0.5.17', rootURI: 'chrome://bridgeflow/' });
	const services = new ServiceContainer(kernel);
	const mod = new WordCiteDomainModule(kernel, services);

	try {
		mod.start();
		mod.tracker.syncSessions([{
			sessionID: 's1',
			documentPath: 'Paper.docx',
			citations: [{ itemID: 201, ordinal: 1, shortText: '1', occurrences: 1 }],
			orphans: [
				{ key: 'id:203', kind: 'trashed', itemID: 203, ordinal: 2, shortText: '2', title: 'Trashed Paper' },
				{
					key: 'id:204',
					kind: 'missing',
					itemID: 204,
					ordinal: 3,
					shortText: '3',
					title: 'Imported Paper',
					itemData: {
						type: 'article-journal',
						title: 'Imported Paper',
						author: [{ family: 'Doe', given: 'Jane' }],
						issued: { 'date-parts': [[2024, 5]] },
						DOI: '10.1234/test',
						'container-title': 'Nature',
					},
				},
			],
		}]);

		const resultPromise = new Promise((resolve) => {
			kernel.bus.on('word:recover-orphans-result', (res) => resolve(res));
		});
		kernel.bus.emit('word:recover-orphans-request', { sessionID: 's1', requestId: 'rec-1' });
		const res = await resultPromise;

		assert.equal(res.requestId, 'rec-1');
		assert.equal(res.restoredCount, 1);
		assert.equal(res.importedCount, 1);
		assert.equal(trashedItem.deleted, false);
		assert.equal(trashedItem.saveCount, 1);

		assert.equal(createdItems.length, 1);
		assert.equal(createdItems[0].itemType, 'journalArticle');
		assert.equal(createdItems[0].fields.title, 'Imported Paper');
		assert.equal(createdItems[0].fields.DOI, '10.1234/test');
		assert.equal(createdItems[0].fields.publicationTitle, 'Nature');
		assert.equal(createdItems[0].fields.date, '2024-5');
		assert.equal(createdItems[0].creators[0].lastName, 'Doe');

		const banner = buildOrphanBannerModel(mod.tracker.getSession('s1')?.orphans, true);
		assert.match(banner.title, /2 篇/);
		assert.match(banner.buttonLabel, /一键还原并导入 \(2\)/);
		const receipt = formatRecoverReceipt(res, true);
		assert.equal(receipt.tone, 'ok');
		assert.match(receipt.text, /已从回收站还原 1 篇/);
		assert.match(receipt.text, /已反向导入 1 篇/);
	} finally {
		mod.stop();
		globalThis.Zotero = prevZotero;
	}
});
