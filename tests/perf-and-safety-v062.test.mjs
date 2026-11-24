import assert from 'node:assert/strict';
import test from 'node:test';
import { UnifiedPrefService } from '../src/kernel/pref-service.ts';
import { CitationTagGovernance } from '../src/domains/word-cite/tag-governance.ts';
import { recoverOrphanCitations } from '../src/domains/word-cite/orphan-recovery.ts';
import { clearExtraRemarkCache, readItemRemarkWithFallback } from '../src/domains/visual-notes/data-source.ts';
import { clearGalleryCardCache, extractGalleryCards, filterAndSortGalleryCards } from '../src/domains/visual-notes/gallery-board-helpers.ts';
import { createHubScopeMemo, resolveAffectedVisualItemIDs } from '../src/domains/visual-notes/hub-cache.ts';
import { DurableCacheFile } from '../src/services/durable-cache-file.ts';
import { CitationHistoryStore } from '../src/services/citation-history-store.ts';
import { escapeHtmlText, sanitizeCitationHtml } from '../src/services/html-sanitizer.ts';
import { ItemRatingsDiskCache } from '../src/services/item-ratings-cache.ts';
import { clearPdfCoverCache, getCachedPdfCoverSync, invalidatePdfCover, requestGalleryPdfCover } from '../src/services/pdf-cover-service.ts';

test('Persistence fail-closed: locked history/ratings files are never overwritten, corrupt files are quarantined', async () => {
	const prevIO = globalThis.IOUtils;
	const prevZot = globalThis.Zotero;
	try {
		const files = new Map();
		const copies = [];
		let lockHistory = true;
		let lockRatings = true;

		globalThis.Zotero = { DataDirectory: { dir: '/safe-io-test' } };
		globalThis.IOUtils = {
			async makeDirectory() {},
			async exists(p) { return files.has(p); },
			async readUTF8(p) {
				if (lockHistory && p.endsWith('citation-history.json')) throw new Error('EBUSY locked');
				if (lockRatings && p.endsWith('item-ratings.json')) throw new Error('EBUSY locked');
				return files.get(p) ?? '';
			},
			async writeUTF8(p, content) { files.set(p, String(content)); },
			async copy(src, dst) { copies.push([src, dst]); files.set(dst, files.get(src)); },
		};

		const hist = new CitationHistoryStore();
		files.set(hist.getFilePath(), JSON.stringify({
			version: 1,
			records: [{ text: 'Existing Paper 2024', itemID: 101, libraryID: 1, itemKey: 'K101', title: 'Existing', style: 'apa' }],
		}));
		await hist.init();
		hist.record({ text: 'New Paper 2025', itemID: 202, libraryID: 1, itemKey: 'K202', title: 'New', style: 'apa' });
		const blockedSave = await hist.retrySave();
		assert.equal(blockedSave, false);
		assert.match(files.get(hist.getFilePath()), /Existing Paper 2024/, 'locked history file must not be overwritten');

		// Once unlocked, retrySave merges existing disk records with new in-memory records
		lockHistory = false;
		const recoveredSave = await hist.retrySave();
		assert.equal(recoveredSave, true);
		assert.match(files.get(hist.getFilePath()), /Existing Paper 2024/);
		assert.match(files.get(hist.getFilePath()), /New Paper 2025/);

		// Locked ratings file must not be wiped on init()
		const ratings = new ItemRatingsDiskCache();
		files.set(ratings.getFilePath(), JSON.stringify({ format: 'zotero-bridgeflow-item-ratings', version: 1, ratings: { '1:ABC': 5 } }));
		await ratings.init();
		assert.match(files.get(ratings.getFilePath()), /"1:ABC":5/);

		// Corrupt file is copied to .corrupt-* quarantine
		lockRatings = false;
		const ratingsCorrupt = new ItemRatingsDiskCache('/corrupt-dir');
		files.set(ratingsCorrupt.getFilePath(), '{bad-json');
		await ratingsCorrupt.init();
		assert.ok(copies.some(([, dst]) => dst.includes('.corrupt-')));
	} finally {
		globalThis.IOUtils = prevIO;
		globalThis.Zotero = prevZot;
	}
});

test('Orphan citation recovery deduplicates by DOI and preserves writable group library ownership', async () => {
	const prevZot = globalThis.Zotero;
	try {
		const createdItems = [];
		class MockSearch {
			constructor() { this.libraryID = 1; this.conditions = []; }
			addCondition(field, op, val) { this.conditions.push([field, op, val]); }
			async search() {
				const doiCond = this.conditions.find((c) => c[0] === 'DOI');
				if (doiCond?.[2] === '10.1038/existing-doi') return [9001];
				return [];
			}
		}
		class MockItem {
			constructor(type) { this.itemType = type; this.libraryID = 1; this.fields = {}; }
			setField(k, v) { this.fields[k] = v; }
			setCreators() {}
			addToCollection() {}
			async saveTx() { createdItems.push(this); return 9999; }
		}
		globalThis.Zotero = {
			Libraries: { userLibraryID: 1, get: (id) => ({ libraryID: id, editable: true }) },
			Groups: { getLibraryIDFromGroupID: (gid) => (gid === 77 ? 3 : null) },
			Search: MockSearch,
			Item: MockItem,
			Items: {
				get: (id) => (id === 9001 ? { id: 9001, libraryID: 1, deleted: false, isRegularItem: () => true } : null),
			},
		};

		const res = await recoverOrphanCitations([
			{
				key: 'dup-1',
				kind: 'missing',
				ordinal: 1,
				shortText: '[1]',
				title: 'Duplicate Paper',
				itemData: { type: 'article-journal', title: 'Duplicate Paper', DOI: 'https://doi.org/10.1038/EXISTING-DOI' },
			},
			{
				key: 'grp-2',
				kind: 'missing',
				ordinal: 2,
				shortText: '[2]',
				title: 'Group Paper',
				uris: ['http://zotero.org/groups/77/items/ABCDEF12'],
				itemData: { type: 'article-journal', title: 'Group Paper', DOI: '10.1021/new-group-doi' },
			},
		]);

		assert.equal(res.existingCount, 1);
		assert.equal(res.importedCount, 1);
		assert.equal(createdItems.length, 1);
		assert.equal(createdItems[0].libraryID, 3, 'group orphan must be imported into its writable group library');
	} finally {
		globalThis.Zotero = prevZot;
	}
});

test('sanitizeCitationHtml strips scripts, event handlers, and unsafe schemes while keeping formatting', () => {
	class MiniNode {
		constructor(nodeType, localName = '', textContent = '') {
			this.nodeType = nodeType;
			this.localName = localName;
			this.textContent = textContent;
			this.attrs = new Map();
			this.childNodes = [];
		}
		getAttribute(k) { return this.attrs.get(k) ?? null; }
	}
	const fakeDoc = {
		defaultView: {
			DOMParser: class {
				parseFromString() {
					const i = new MiniNode(1, 'i');
					i.attrs.set('onclick', 'alert(1)');
					i.attrs.set('class', 'csl-italics');
					i.childNodes.push(new MiniNode(3, '', 'Nature'));
					const badScript = new MiniNode(1, 'script');
					badScript.childNodes.push(new MiniNode(3, '', 'evil()'));
					const badLink = new MiniNode(1, 'a');
					badLink.attrs.set('href', 'javascript:evil()');
					badLink.childNodes.push(new MiniNode(3, '', 'Click'));
					const goodLink = new MiniNode(1, 'a');
					goodLink.attrs.set('href', 'https://doi.org/10.1038/test');
					goodLink.childNodes.push(new MiniNode(3, '', 'DOI'));
					return { body: { childNodes: [i, badScript, badLink, goodLink] } };
				}
			},
		},
	};
	const clean = sanitizeCitationHtml(fakeDoc, 'ignored-by-mock');
	assert.equal(clean, '<i class="csl-italics">Nature</i><a>Click</a><a href="https://doi.org/10.1038/test" rel="noreferrer">DOI</a>');
	assert.equal(escapeHtmlText('<b>&</b>'), '&lt;b&gt;&amp;&lt;/b&gt;');
});

test('CitationTagGovernance batches multi-item tag updates into a single Zotero.DB.executeTransaction', async () => {
	const prevZot = globalThis.Zotero;
	try {
		let txCount = 0;
		let itemSaveCalls = 0;
		const items = new Map();
		for (let id = 1; id <= 12; id++) {
			const tags = new Set();
			items.set(id, {
				id,
				libraryID: 1,
				deleted: false,
				isRegularItem: () => true,
				hasTag: (t) => tags.has(t),
				addTag: (t) => tags.add(t),
				removeTag: (t) => tags.delete(t),
				save: async (opts) => {
					assert.equal(opts?.skipDateModifiedUpdate, true);
					itemSaveCalls++;
				},
			});
		}
		globalThis.Zotero = {
			Libraries: { get: () => ({ editable: true }) },
			DB: {
				executeTransaction: async (fn) => {
					txCount++;
					return fn();
				},
			},
			Items: { get: (id) => items.get(id) },
		};
		const prefs = new UnifiedPrefService({
			adapter: {
				get: (k) => (k.endsWith('citationTags.enable') ? true : k.endsWith('citationTags.text') ? '/Citations' : undefined),
				set: () => {},
			},
		});
		const gov = new CitationTagGovernance(prefs);
		const res = await gov.syncCitedItems(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
		assert.equal(res.added, 10);
		assert.equal(itemSaveCalls, 10);
		assert.equal(txCount, 1, 'all 10 item saves must run inside a single DB transaction');
	} finally {
		globalThis.Zotero = prevZot;
	}
});

test('Performance caches: Gallery static card cache, O(1) stat cover hit without SHA-256, negative Extra cache & Hub scope memo', async () => {
	const prevZot = globalThis.Zotero;
	const prevIO = globalThis.IOUtils;
	const prevPath = globalThis.PathUtils;
	clearGalleryCardCache();
	clearExtraRemarkCache();
	try {
		let fieldReads = 0;
		let extraReads = 0;
		let sha256Calls = 0;
		let annReads = 0;

		const rows = Array.from({ length: 120 }, (_, idx) => {
			const id = idx + 1;
			return {
				id,
				version: 10,
				dateModified: '2026-11-24 10:00:00',
				firstCreator: 'Lin et al.',
				itemType: 'journalArticle',
				isRegularItem: () => true,
				getField(f) {
					if (f === 'extra') { extraReads++; return ''; }
					fieldReads++;
					if (f === 'title') return `Paper Title ${id}`;
					if (f === 'year') return '2025';
					if (f === 'publicationTitle') return 'Nature Materials';
					return '';
				},
				getTags: () => [{ tag: '/精读' }, { tag: '2D-MoS2' }],
				getAttachments: () => [5000 + id],
				getNotes: () => [],
			};
		});

		const attMap = new Map(rows.map((r) => [5000 + r.id, {
			id: 5000 + r.id,
			key: `ATT${r.id}`,
			libraryID: 1,
			parentItemID: r.id,
			deleted: false,
			isPDFAttachment: () => true,
			isFileAttachment: () => true,
			getFilePathAsync: async () => `/pdfs/${r.id}.pdf`,
			getAnnotations: () => {
				annReads++;
				return [{ id: 9000 + r.id, annotationColor: '#ffd400', annotationText: `Finding ${r.id}`, annotationPageLabel: '2' }];
			},
		}]));
		const annParentObj = { id: 9001, parentItemID: 5001 };

		globalThis.PathUtils = { join: (...p) => p.join('/') };
		globalThis.IOUtils = {
			stat: async () => ({ type: 'regular', lastModified: 1700000000, size: 123456 }),
			computeHexDigest: async () => { sha256Calls++; return 'deadbeef'; },
			readUTF8: async () => JSON.stringify({
				version: 2,
				revision: 'stamp:[1700000000,123456]',
				stamp: '[1700000000,123456]',
				url: 'data:image/jpeg;base64,' + 'A'.repeat(64),
			}),
			remove: async () => {},
		};
		globalThis.Zotero = {
			locale: 'zh-CN',
			DataDirectory: { dir: '/perf-cache' },
			Items: {
				get: (id) => attMap.get(id) || (id === 9001 ? annParentObj : rows.find((r) => r.id === id)),
			},
		};
		await clearPdfCoverCache();

		const fakeWin = {
			ZoteroPane: {
				itemsView: { rowCount: rows.length, getRow: (i) => ({ ref: rows[i] }) },
			},
		};

		// 1. First extract populates caches; second extract (e.g. switching Gallery <-> Kanban or sorting) makes 0 field/extra reads
		const first = extractGalleryCards(fakeWin, {
			zh: true,
			excludedStatusTag: '/Citations',
			ratingStorage: 'cache',
			getBriefNote: (it) => readItemRemarkWithFallback(it),
			getReadProgress: () => undefined,
		});
		assert.equal(first.cards.length, 120);
		assert.equal(fieldReads, 0, 'opening the gallery must not hydrate offscreen metadata');
		filterAndSortGalleryCards(first.cards, '', 'dateModified');
		assert.equal(fieldReads, 0, 'default sort uses lightweight rows');
		for (const card of first.cards) assert.ok(card.searchLower);
		assert.ok(fieldReads > 0 && extraReads > 0);

		const beforeSecondFields = fieldReads;
		const beforeSecondExtra = extraReads;
		const second = extractGalleryCards(fakeWin, {
			zh: true,
			excludedStatusTag: '/Citations',
			ratingStorage: 'cache',
			getBriefNote: (it) => readItemRemarkWithFallback(it),
			getReadProgress: () => undefined,
		});
		const matched = filterAndSortGalleryCards(second.cards, 'mos2', 'year');
		assert.equal(matched.length, 120);
		assert.equal(fieldReads, beforeSecondFields, 'cached card extraction must do zero Zotero getField calls');
		assert.equal(extraReads, beforeSecondExtra, 'negative Extra remark cache must do zero getField("extra") calls');

		// 2. Disk cover hit resolves via O(1) stat stamp without SHA-256 hashing the PDF
		const coverUrl = await requestGalleryPdfCover({ attID: 5001, doc: {} });
		assert.ok(coverUrl?.startsWith('data:image/jpeg;base64,'));
		assert.equal(getCachedPdfCoverSync(5001), coverUrl);
		assert.equal(getCachedPdfCoverSync(5001, 240), null, 'a cover at one resolution must not satisfy a different resolution');
		assert.ok(await requestGalleryPdfCover({ attID: 5001, doc: {}, width: 240 }));
		assert.ok(getCachedPdfCoverSync(5001, 240));
		invalidatePdfCover(5001);
		assert.equal(getCachedPdfCoverSync(5001), null);
		assert.equal(getCachedPdfCoverSync(5001, 240), null);
		assert.equal(sha256Calls, 0, 'disk cover cache hit must never SHA-256 hash PDF files');

		// 3. Hub scope memo scans Zotero annotations once across repeated filter/color/toggle interactions
		const memo = createHubScopeMemo({
			win: fakeWin,
			zh: true,
			getColorJson: () => '',
			getBriefNote: (it) => readItemRemarkWithFallback(it),
		});
		memo.compute('collection', '', '', false);
		const afterFirstHubScan = annReads;
		memo.compute('collection', 'Finding 10', 'Context', true);
		memo.compute('collection', 'Finding 20', '', false);
		assert.equal(annReads, afterFirstHubScan, 'Hub filter interactions must reuse memoized annotations');

		// 4. Child annotation ID walks up to owning regular item ID for targeted cache invalidation
		const affected = resolveAffectedVisualItemIDs([9001]);
		assert.equal(affected.has(9001), true);
		assert.equal(affected.has(5001), true);
		assert.equal(affected.has(1), true);
	} finally {
		clearGalleryCardCache();
		clearExtraRemarkCache();
		globalThis.Zotero = prevZot;
		globalThis.IOUtils = prevIO;
		globalThis.PathUtils = prevPath;
	}
});

test('Categorized caches retain locked files and migrate legacy data without changing the source', async () => {
	const oldIO = globalThis.IOUtils;
	const oldHost = globalThis.Zotero;
	const files = new Map();
	globalThis.Zotero = { DataDirectory: { dir: '/cache-migration' } };
	let locked = false;
	let failBackup = false;
	globalThis.IOUtils = {
		exists: async path => files.has(path),
		readUTF8: async path => {
			if (locked && path.endsWith('/reading-progress.json')) throw Error('locked');
			return files.get(path);
		},
		writeUTF8: async (path, text) => {
			if (failBackup && path.endsWith('.bak.json')) throw Error('disk full');
			files.set(path, text);
		},
		copy: async (from, to) => { files.set(to, files.get(from)); },
	};
	try {
		const progress = new DurableCacheFile('reading', 'reading-progress');
		const legacy = '/cache-migration/bridgeflow-cache/reading-progress.json';
		files.set(legacy, '{"n":1}');
		assert.deepEqual(await progress.load(text => JSON.parse(text)), { n: 1 });
		assert.equal(progress.needsMigration, true);
		assert.equal(await progress.write(() => '{"n":1}'), true);
		assert.equal(files.get(legacy), '{"n":1}');
		failBackup = true;
		assert.equal(await progress.write(() => '{"n":2}'), false);
		assert.equal(files.get(progress.path), '{"n":1}');
		failBackup = false;
		assert.equal(await progress.write(() => '{"n":2}'), true);
		locked = true;
		assert.deepEqual(await progress.load(text => JSON.parse(text)), { n: 1 });
		assert.equal(await progress.write(() => '{"n":3}'), false);
		assert.equal(files.get(progress.path), '{"n":2}');
		locked = false;
		files.set(progress.path, '{broken');
		assert.deepEqual(await progress.load(text => JSON.parse(text)), { n: 1 });
		assert.equal(await progress.write(() => '{"n":1}'), true);
		assert.ok([...files.values()].includes('{broken'));
	} finally {
		globalThis.IOUtils = oldIO;
		globalThis.Zotero = oldHost;
	}
});

test('Citation history isolates identical text across libraries and clears the recovery backup', async () => {
	const oldIO = globalThis.IOUtils;
	const oldHost = globalThis.Zotero;
	const files = new Map();
	const history = new CitationHistoryStore();
	globalThis.Zotero = { DataDirectory: { dir: '/citation-cache' } };
	globalThis.IOUtils = {
		exists: async path => files.has(path),
		readUTF8: async path => files.get(path),
		writeUTF8: async (path, text) => files.set(path, text),
	};
	history.configure({ customDir: '/citation-cache/custom' });
	try {
		await history.init();
		for (const id of [1, 2]) {
			history.record({ text: 'Quantum paper 2025', itemID: id, libraryID: id, itemKey: 'TEST', title: '', style: 'apa' });
		}
		assert.equal(history.lookupExact('Quantum paper 2025', 1)?.itemID, 1);
		assert.equal(history.lookupExact('Quantum paper 2025', 2)?.itemID, 2);
		assert.deepEqual((await history.searchFuzzyAsync('Quantum paper', 5, 1)).map(hit => hit.itemID), [1]);
		assert.equal(await history.retrySave(), true);
		history.clear();
		assert.equal(await history.retrySave(), true);
		assert.deepEqual(JSON.parse(files.get(history.getBackupFilePath())).records, []);
	} finally {
		history.dispose();
		globalThis.IOUtils = oldIO;
		globalThis.Zotero = oldHost;
	}
});
