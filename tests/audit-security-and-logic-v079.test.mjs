import assert from 'node:assert/strict';
import test from 'node:test';
import { CopyHistoryBridge } from '../src/bridges/copy-history-bridge.ts';
import { parseCompactCitation } from '../src/domains/inspector/citation-lookup-parser.ts';
import { StatusRatingColumnsController } from '../src/domains/visual-notes/status-rating-columns.ts';
import { isCitationCollectionRef, patchCollectionsViewForWindow } from '../src/domains/word-cite/collection-tree-order.ts';
import { DragCiteController } from '../src/domains/word-cite/drag-cite-controller.ts';
import { extractSessionCitationsWithOrphans } from '../src/domains/word-cite/orphan-extraction.ts';
import { clearRelinkedItemUris, isForeignUserItemUri, resolveItemIdFromUris } from '../src/domains/word-cite/orphan-identity.ts';
import { WorkspaceStateStore } from '../src/domains/workspace/state-store.ts';
import { PluginKernel } from '../src/kernel/plugin-kernel.ts';
import { UnifiedPrefService } from '../src/kernel/pref-service.ts';
import { normalizeHexColor } from '../src/services/annotation-utils.ts';
import { sanitizeCitationHtml } from '../src/services/html-sanitizer.ts';
import { isItemTrashedOrDeleted, isItemWritable } from '../src/services/item-resolution.ts';

test('parseCompactCitation resists semicolon ReDoS while preserving academic citation formats', () => {
	const adversarial = `${'Smith, J.; '.repeat(400)}123456`;
	const t0 = performance.now();
	const res = parseCompactCitation(adversarial);
	const elapsedMs = performance.now() - t0;
	assert.equal(res, null);
	assert.ok(elapsedMs < 150, `Expected linear runtime < 150ms, got ${elapsedMs.toFixed(2)}ms`);

	const semiComma = parseCompactCitation('Smith, J.; Doe, A., J. Am. Chem. Soc. 2022, 144 (3), 1200-1208');
	assert.equal(semiComma?.authorPrefix, 'Smith, J.; Doe, A.');
	assert.equal(semiComma?.journalText, 'J. Am. Chem. Soc.');
	assert.equal(semiComma?.year, 2022);
	assert.equal(semiComma?.volume, '144');
	assert.equal(semiComma?.pages, '1200-1208');

	const semiOnly = parseCompactCitation('Smith, J.; Doe, A.; Nature 2021, 590, 45-50');
	assert.equal(semiOnly?.authorPrefix, 'Smith, J.; Doe, A.');
	assert.equal(semiOnly?.journalText, 'Nature');
	assert.equal(semiOnly?.year, 2021);

	const gbt = parseCompactCitation('张三, 李四. 深度学习综述[J]. 计算机学报, 2023, 46 (2), 10-25');
	assert.equal(gbt?.authorPrefix, '张三, 李四');
	assert.equal(gbt?.journalText, '计算机学报');
	assert.equal(gbt?.year, 2023);
});

test('sanitizeCitationHtml enforces strict CSS property/value allowlist against UI spoofing and url() leaks', () => {
	const fakeDoc = {
		defaultView: {
			DOMParser: class {
				parseFromString(markup) {
					const span = {
						nodeType: 1,
						tagName: 'SPAN',
						localName: 'span',
						attributes: [{ name: 'style', value: markup }],
						childNodes: [{ nodeType: 3, textContent: 'Cited Title' }],
						getAttribute(k) { return k === 'style' ? this.attributes[0]?.value || '' : null; },
						setAttribute(k, v) { this.attributes = [{ name: k, value: v }]; },
						removeAttribute() { this.attributes = []; },
						get outerHTML() {
							const attr = this.attributes.length ? ` style="${this.attributes[0].value}"` : '';
							return `<span${attr}>Cited Title</span>`;
						},
					};
					return {
						body: {
							childNodes: [span],
							get innerHTML() { return span.outerHTML; },
						},
					};
				}
			},
		},
	};

	const malicious = sanitizeCitationHtml(
		fakeDoc,
		'position: fixed; inset: 0; z-index: 999999; background: url(https://evil.example/leak); font-style: italic; margin-left: 2em; text-indent: -2em',
	);
	assert.ok(!malicious.includes('position'));
	assert.ok(!malicious.includes('z-index'));
	assert.ok(!malicious.includes('url('));
	assert.ok(malicious.includes('font-style: italic'));
	assert.ok(malicious.includes('margin-left: 2em'));
	assert.ok(malicious.includes('text-indent: -2em'));
});

test('normalizeHexColor strictly rejects non-hex CSS payloads while normalizing 3-digit and 6-digit hex', () => {
	assert.equal(normalizeHexColor('url(https://evil.example/beacon)'), '');
	assert.equal(normalizeHexColor('red; position: fixed'), '');
	assert.equal(normalizeHexColor('#AbC'), '#aabbcc');
	assert.equal(normalizeHexColor('#2EA8E5'), '#2ea8e5');
});

test('UnifiedPrefService invalidates cached reads when external host pref observer fires and clamps layout bounds', () => {
	const backing = new Map();
	const observers = new Map();
	const adapter = {
		get(fullKey) { return backing.get(fullKey); },
		set(fullKey, value) { backing.set(fullKey, value); },
		clear(fullKey) { backing.delete(fullKey); },
		registerObserver(fullKey, cb) {
			const id = Symbol(fullKey);
			const set = observers.get(fullKey) || new Set();
			set.add(cb);
			observers.set(fullKey, set);
			return id;
		},
		unregisterObserver() {},
	};

	const prefs = new UnifiedPrefService({ adapter });
	assert.equal(prefs.get('workspace.verticalSidebarWidth'), 276);

	// Simulate external write from preferences window
	const fullKey = 'extensions.zotero.bridgeflow.workspace.verticalSidebarWidth';
	backing.set(fullKey, 340);
	for (const cb of observers.get(fullKey) || []) cb();
	assert.equal(prefs.get('workspace.verticalSidebarWidth'), 340);

	backing.set('extensions.zotero.bridgeflow.inspector.cslPreview.fontsize', '9999');
	for (const cb of observers.get('extensions.zotero.bridgeflow.inspector.cslPreview.fontsize') || []) cb();
	assert.equal(prefs.get('inspector.cslPreview.fontsize'), '3');
	backing.set('extensions.zotero.bridgeflow.workspace.readingHeatmap.color', 'url(https://bad)');
	for (const cb of observers.get('extensions.zotero.bridgeflow.workspace.readingHeatmap.color') || []) cb();
	assert.equal(prefs.get('workspace.readingHeatmap.color'), '#0d9488');
	prefs.dispose();
});

test('WorkspaceStateStore preserves live readingProgress & remarks on workspace layout import and supports importAnyJson', () => {
	const mem = new Map();
	const makeStore = () => new WorkspaceStateStore(new UnifiedPrefService({
		adapter: {
			get: (k) => mem.get(k),
			set: (k, v) => mem.set(k, v),
			clear: (k) => mem.delete(k),
		},
	}));

	const source = makeStore();
	const grp = source.createGroup('Group A', '#0D9488');
	assert.equal(source.setGroupColor(grp.id, 'url(https://evil)'), false);
	const exportedLayout = JSON.stringify({
		format: 'zotero-bridgeflow-workspace',
		version: 2,
		state: {
			...JSON.parse(source.exportJson()).state,
			remarks: {},
			readingProgress: {},
		},
	}, null, 2);

	const target = makeStore();
	target.updateReadingProgress('item:42', 180, 3, 12);
	target.setItemRemark(42, 'Keep this brief note');
	assert.equal(target.importJson(exportedLayout), true);
	assert.equal(target.state.readingProgress['item:42']?.readSeconds, 180);
	assert.equal(target.getItemRemark(42), 'Keep this brief note');

	const notesBackup = target.exportBriefNotesJson();
	const fresh = makeStore();
	assert.equal(fresh.importAnyJson(notesBackup), 'notes');
	assert.equal(fresh.getItemRemark(42), 'Keep this brief note');
});

test('CopyHistoryBridge matches alphabetical multi-item bibliography lines to their true itemID', () => {
	const prevZotero = globalThis.Zotero;
	const itemZ = {
		id: 101,
		key: 'KEYZ',
		libraryID: 1,
		firstCreator: 'Zhang',
		isRegularItem: () => true,
		getField(f) {
			if (f === 'title') return 'Zeta Catalytic Mechanism';
			if (f === 'DOI') return '10.1000/zeta.2024';
			if (f === 'year') return '2024';
			return '';
		},
	};
	const itemA = {
		id: 202,
		key: 'KEYA',
		libraryID: 1,
		firstCreator: 'Adams',
		isRegularItem: () => true,
		getField(f) {
			if (f === 'title') return 'Alpha Quantum Transport';
			if (f === 'DOI') return '10.1000/alpha.2021';
			if (f === 'year') return '2021';
			return '';
		},
	};
	try {
		globalThis.Zotero = {
			Items: {
				get: (id) => (id === 101 ? itemZ : id === 202 ? itemA : null),
			},
		};
		const kernel = new PluginKernel();
		const recorded = [];
		const services = { history: { record: (entry) => recorded.push(entry) } };
		const bridge = new CopyHistoryBridge(kernel, services);
		bridge.start();

		// Selected in [Z, A] order, but APA bibliography outputs [Adams, Zhang] alphabetically:
		kernel.bus.emit('citation:copied', {
			itemIDs: [101, 202],
			text: [
				'Adams, B. (2021). Alpha Quantum Transport. https://doi.org/10.1000/alpha.2021',
				'Zhang, Y. (2024). Zeta Catalytic Mechanism. https://doi.org/10.1000/zeta.2024',
			].join('\n'),
			html: '',
			styleID: 'http://www.zotero.org/styles/apa',
			asCitation: false,
			source: 'preview',
		});

		assert.equal(recorded.length, 2);
		const alphaHit = recorded.find((r) => r.text.includes('Adams'));
		const zetaHit = recorded.find((r) => r.text.includes('Zhang'));
		assert.equal(alphaHit?.itemID, 202);
		assert.equal(zetaHit?.itemID, 101);
		bridge.stop();
	} finally {
		globalThis.Zotero = prevZotero;
	}
});

test('isItemTrashedOrDeleted and isItemWritable enforce read-only group library and trash guards', () => {
	const prevZotero = globalThis.Zotero;
	try {
		globalThis.Zotero = {
			Libraries: {
				get: (libID) => (libID === 99 ? { editable: false } : { editable: true }),
			},
		};
		assert.equal(isItemTrashedOrDeleted({ id: 1, inTrash: true }), true);
		assert.equal(isItemTrashedOrDeleted({ id: 2, isTrashed: () => true }), true);
		assert.equal(isItemWritable({ id: 3, libraryID: 99, isRegularItem: () => true }), false);
		assert.equal(isItemWritable({ id: 4, libraryID: 1, isRegularItem: () => true }), true);
	} finally {
		globalThis.Zotero = prevZotero;
	}
});

test('StatusRatingColumnsController handles async Promise<string> from ItemTreeManager.registerColumn', async () => {
	const prevZotero = globalThis.Zotero;
	try {
		const unregistered = [];
		globalThis.Zotero = {
			locale: 'zh-CN',
			getMainWindows: () => [],
			ItemTreeManager: {
				registerColumn: async (desc) => `col:${desc.dataKey}`,
				unregisterColumn: async (key) => { unregistered.push(key); },
			},
		};
		const kernel = new PluginKernel();
		const ctrl = new StatusRatingColumnsController(kernel);
		ctrl.syncColumns();
		await new Promise((r) => setTimeout(r, 10));
		ctrl.unregisterAll();
		assert.deepEqual(unregistered.sort(), ['col:bridgeflowRating', 'col:bridgeflowStatus']);
	} finally {
		globalThis.Zotero = prevZotero;
	}
});

test('Orphan URI guards fail closed on foreign/query URIs and prevent numeric ID citeproc ordinal spoofing', () => {
	const prevZotero = globalThis.Zotero;
	clearRelinkedItemUris();
	try {
		const localItem = {
			id: 301,
			key: 'LOCAL301',
			libraryID: 1,
			deleted: false,
			isRegularItem: () => true,
			getField: (f) => (f === 'title' ? 'My Local Paper' : ''),
		};
		const fakeZotero = {
			Users: { getCurrentUserID: () => 888, getLocalUserKey: () => 'MYLOCAL' },
			Groups: { getLibraryIDFromGroupID: (gid) => (gid === 55 ? 2 : false) },
			URI: {
				getItemURI: (it) => `http://zotero.org/users/888/items/${it.key}`,
				getURIItemID: () => 301,
			},
			Items: {
				get: (id) => (id === 301 ? localItem : null),
			},
		};
		globalThis.Zotero = fakeZotero;

		assert.equal(isForeignUserItemUri('http://zotero.org/users/999/items/EVIL1234?bypass=1', fakeZotero), true);
		assert.equal(isForeignUserItemUri('http://zotero.org/groups/777/items/FOREIGNGRP', fakeZotero), true);
		assert.equal(isForeignUserItemUri('https://evil.example/users/888/items/ABCD', fakeZotero), true);
		assert.equal(isForeignUserItemUri('http://zotero.org/groups/55/items/OWNGRP', fakeZotero), false);
		assert.equal(resolveItemIdFromUris(['http://zotero.org/users/999/items/EVIL1234?bypass=1'], fakeZotero, fakeZotero.Items), 0);

		// Foreign citation with colliding numeric id=301 must NOT become valid local item 301 or steal its citeproc seq=7
		const extracted = extractSessionCitationsWithOrphans({
			sessionID: 'ses-1',
			style: { registry: { registry: { '301': { seq: 7 } } } },
			citationsByIndex: {
				0: {
					properties: { plainCitation: '[1]' },
					citationItems: [{
						id: 301,
						uris: ['http://zotero.org/users/999/items/FOREIGN301'],
						itemData: { id: 301, title: 'Coauthor Paper' },
					}],
				},
			},
		});
		assert.equal(extracted.citations.length, 0);
		assert.equal(extracted.orphans.length, 1);
		assert.equal(extracted.orphans[0].ordinal, 1);
		assert.equal(extracted.orphans[0].itemID, undefined);
	} finally {
		clearRelinkedItemUris();
		globalThis.Zotero = prevZotero;
	}
});

test('Collection tree order avoids hijacking user .docx collections and survives re-entrant _addSortedRow', async () => {
	assert.equal(isCitationCollectionRef({ key: 'USER1', name: 'Draft.docx' }, new Set(['WORD']), new Set(['Active.docx'])), false);
	assert.equal(isCitationCollectionRef({ key: 'WORD', name: 'Draft.docx' }, new Set(['WORD']), new Set()), true);

	const kernel = new PluginKernel();
	const citeRow = {
		type: 'collection',
		ref: { key: 'WORD', name: 'Manuscript.docx' },
		isCollection() { return true; },
	};
	let reentered = false;
	const cv = {
		_rows: [citeRow],
		tree: { invalidate() {} },
		async _addSortedRow() {
			if (!reentered) {
				reentered = true;
				await cv._addSortedRow('item', 2);
			}
			return 0;
		},
	};
	const fakeWin = { document: { createElementNS: () => ({}) }, ZoteroPane: { collectionsView: cv } };
	const dispose = patchCollectionsViewForWindow(fakeWin, kernel.runtime, () => new Set(['WORD']));
	await cv._addSortedRow('item', 1);
	assert.equal(citeRow.isCollection(), true);
	dispose();
});

test('DragCiteController does not hijack itemsView.onDragStart when native Win32 is unsupported (macOS/Linux)', () => {
	const prevZotero = globalThis.Zotero;
	try {
		globalThis.Zotero = { isMac: true, isWin: false };
		const kernel = new PluginKernel();
		let originalCalled = 0;
		const itemsView = {
			onDragStart() { originalCalled++; return true; },
		};
		const win = {
			closed: false,
			ZoteroPane: { itemsView },
			document: { addEventListener() {}, removeEventListener() {} },
		};
		const win32 = {
			supportsNativeWin32: () => false,
			probeCursorWordDropTarget: () => ({ status: 'unknown' }),
			clearLastDroppedWordTarget() {},
		};
		const ctrl = new DragCiteController(kernel, win32);
		ctrl.attachWindow(win);
		itemsView.onDragStart({});
		assert.equal(originalCalled, 1);
		assert.equal(Object.hasOwn(itemsView.onDragStart, '__bridgeflowPatched') || itemsView.onDragStart.length > 0, false);
		ctrl.disposeAll();
	} finally {
		globalThis.Zotero = prevZotero;
	}
});
