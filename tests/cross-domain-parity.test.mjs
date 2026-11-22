import test from 'node:test';
import assert from 'node:assert/strict';
import { PluginKernel } from '../src/kernel/plugin-kernel.ts';
import {
	locateItemInZoteroLibrary,
	revealItemAttachmentInFilesystem,
} from '../src/services/item-resolution.ts';
import { CitationHistoryStore } from '../src/services/citation-history-store.ts';
import { Win32BridgeService } from '../src/services/win32-bridge.ts';
import {
	disambiguateDocumentNames,
	extractDocumentBaseName,
	WordSessionTracker,
} from '../src/domains/word-cite/session-tracker.ts';
import { WordCitationCollectionManager } from '../src/domains/word-cite/citation-collections.ts';
import { CitationTagGovernance } from '../src/domains/word-cite/tag-governance.ts';
import { WorkspaceStateStore } from '../src/domains/workspace/state-store.ts';
import { WorkspaceTabController } from '../src/domains/workspace/tab-controller.ts';
import { formatReadingProgress } from '../src/domains/workspace/tab-actions-helpers.ts';
import {
	pickCompareAttachment,
	resolveAllPdfAttachments,
	resolveSameItemPdfContext,
} from '../src/domains/inspector/pdf-renderer.ts';

function createMemoryPrefs(initial = {}) {
	const store = new Map(Object.entries(initial));
	return {
		get(key) { return store.get(key); },
		set(key, val) { store.set(key, val); },
		registerObserver() { return 1; },
		unregisterObserver() {},
	};
}

test('Cross-Domain Shared Services: revealItemAttachmentInFilesystem & locateItemInZoteroLibrary reuse', async () => {
	const revealedPaths = [];
	const launchedFolders = [];
	const selectedCols = [];
	const selectedItems = [];
	let ensuredRow = -1;

	const mockAttachment = {
		id: 901,
		deleted: false,
		isFileAttachment: () => true,
		getFilePathAsync: async () => 'D:\\Zotero\\storage\\ABC\\Sample.pdf',
	};
	const mockRegularItem = {
		id: 900,
		deleted: false,
		isRegularItem: () => true,
		getCollections: () => [42],
		getBestAttachment: async () => mockAttachment,
	};

	const mockWin = {
		Zotero_Tabs: { selectedID: 'reader-1', select(id) { this.selectedID = id; } },
		ZoteroPane: {
			collectionsView: {
				selectCollection: async (cid) => { selectedCols.push(cid); },
			},
			selectItem: async (id) => { selectedItems.push(id); return true; },
		},
		document: {
			getElementById: (id) => (id === 'zotero-items-tree' ? {
				selection: { currentIndex: 7 },
				ensureRowIsVisible(idx) { ensuredRow = idx; },
			} : null),
		},
	};

	globalThis.Zotero = {
		Items: {
			get: (id) => (id === 900 ? mockRegularItem : id === 901 ? mockAttachment : null),
		},
		File: {
			pathToFile: (p) => ({
				path: p,
				parent: { path: 'D:\\Zotero\\storage\\ABC' },
				exists: () => true,
				reveal: () => { revealedPaths.push(p); },
			}),
		},
		launchFile: async (folder) => { launchedFolders.push(folder); },
		getMainWindow: () => mockWin,
	};

	assert.equal(await revealItemAttachmentInFilesystem(mockRegularItem, { openMode: 'reveal', dedupMs: 0 }), true);
	assert.deepEqual(revealedPaths, ['D:\\Zotero\\storage\\ABC\\Sample.pdf']);

	assert.equal(await revealItemAttachmentInFilesystem(mockRegularItem, { openMode: 'folder', dedupMs: 0 }), true);
	assert.deepEqual(launchedFolders, ['D:\\Zotero\\storage\\ABC']);

	assert.equal(await locateItemInZoteroLibrary(900, { win: mockWin, switchCollection: true }), true);
	assert.equal(mockWin.Zotero_Tabs.selectedID, 'zotero-pane');
	assert.deepEqual(selectedCols, [42]);
	assert.deepEqual(selectedItems, [900]);
	assert.equal(ensuredRow, 7);

	delete globalThis.Zotero;
});

test('TabFlow Parity: reading progress tracking (duration + PDF page/total ratio)', () => {
	const kernel = new PluginKernel({ prefAdapter: createMemoryPrefs() });
	kernel.init({ id: 'bridgeflow@groele', version: '0.0.8', rootURI: 'chrome://test/' });
	const store = new WorkspaceStateStore(kernel.prefs);
	const tabs = new WorkspaceTabController(kernel.prefs, store, { copyItems: async () => true });

	const mockWin = {
		document: { hasFocus: () => true },
		Zotero_Tabs: {
			selectedID: 'tab-r1',
			_tabs: [{ id: 'tab-r1', type: 'reader', data: { itemID: 701 }, title: 'Deep PDF' }],
		},
	};
	globalThis.Zotero = {
		Items: {
			get: () => ({
				id: 701,
				deleted: false,
				isRegularItem: () => true,
				getField: (f) => (f === 'title' ? 'Deep PDF' : ''),
				getCollections: () => [],
			}),
		},
		Reader: {
			getByTabID: (id) => (id === 'tab-r1' ? {
				_iframeWindow: { PDFViewerApplication: { page: 5, pagesCount: 20 } },
			} : null),
		},
	};

	assert.equal(tabs.trackReadingProgress(mockWin, 125), true);
	const prog = formatReadingProgress(store.state.readingProgress['item:701']);
	assert.equal(prog.text, '2m · p.5/20');
	assert.equal(prog.ratio, 0.25);

	delete globalThis.Zotero;
});

test('CiteFlow & ViewFlow Parity: URL/SharePoint doc naming, selected Word collection priority, tree ordering & persisted tag cleanup', async () => {
	// 1. Rich Word document name extraction
	assert.equal(
		extractDocumentBaseName('file:///D:/Papers/%E8%AE%BA%E6%96%87%20Draft.docx'),
		'论文 Draft.docx',
	);
	assert.equal(
		extractDocumentBaseName('https://contoso.sharepoint.com/_layouts/15/WopiFrame.aspx?file=Nature_Manuscript.docx&action=default'),
		'Nature_Manuscript.docx',
	);
	assert.equal(
		extractDocumentBaseName('window-title:Thesis.docx [兼容模式] - Microsoft Word'),
		'Thesis.docx',
	);

	// 2. Multi-level parent path disambiguation
	const disamb = disambiguateDocumentNames([
		{ sessionID: 's1', path: 'D:\\ProjectA\\Draft\\Manuscript.docx' },
		{ sessionID: 's2', path: 'D:\\ProjectB\\Draft\\Manuscript.docx' },
	]);
	assert.equal(disamb.get('s1'), 'Manuscript.docx (ProjectA/Draft)');
	assert.equal(disamb.get('s2'), 'Manuscript.docx (ProjectB/Draft)');

	// 3. Selected Word collection session priority in Citation Column
	const prefBackend = createMemoryPrefs();
	const kernel = new PluginKernel({ prefAdapter: prefBackend });
	kernel.init({ id: 'bridgeflow@groele', version: '0.0.8', rootURI: 'chrome://test/' });
	const tracker = new WordSessionTracker(kernel.bus, new Win32BridgeService());
	tracker.syncSessions([
		{
			sessionID: 's1',
			documentPath: 'D:\\PaperA.docx',
			citations: [{ itemID: 100, ordinal: 1, shortText: 'Alpha, 2025' }],
		},
		{
			sessionID: 's2',
			documentPath: 'D:\\PaperB.docx',
			citations: [{ itemID: 100, ordinal: 9, shortText: 'Alpha in B, 2025' }],
		},
	]);
	// Default active session is s1 -> ordinal 1
	assert.equal(tracker.getCitationDisplayForItem(100), '[1] Alpha, 2025');
	// When user selects PaperB's Word temporary collection in the left collection tree -> ordinal 9
	assert.equal(tracker.getCitationDisplayForItem(100, 's2'), '[9] Alpha in B, 2025');

	// 4. Persisted managed tag IDs across restart & automatic startup cleanup
	const hostPrefs = new Map();
	const taggedItems = new Map([
		[100, {
			id: 100,
			deleted: false,
			isEditable: () => true,
			tags: new Set(),
			hasTag(t) { return this.tags.has(t); },
			addTag(t) { this.tags.add(t); },
			removeTag(t) { this.tags.delete(t); },
			saveTx: async () => {},
		}],
	]);
	globalThis.Zotero = {
		Prefs: {
			get: (k) => hostPrefs.get(k),
			set: (k, v) => hostPrefs.set(k, v),
		},
		Items: { get: (id) => taggedItems.get(id) },
	};

	const gov1 = new CitationTagGovernance(kernel.prefs);
	await gov1.syncCitedItems(new Set([100]));
	assert.equal(taggedItems.get(100).hasTag('/Citations'), true);

	// Simulate Zotero restart with new CitationTagGovernance instance and 0 cited items
	const gov2 = new CitationTagGovernance(kernel.prefs);
	assert.equal(gov2.managedCount, 1);
	await gov2.syncCitedItems(new Set());
	assert.equal(taggedItems.get(100).hasTag('/Citations'), false);

	// 5. ViewFlow CitationHistoryStore save failure status & retrySave recovery
	let shouldFailWrite = true;
	let statusEvents = 0;
	globalThis.IOUtils = {
		makeDirectory: async () => {},
		writeUTF8: async () => {
			if (shouldFailWrite) throw new Error('Disk full');
		},
	};
	const history = new CitationHistoryStore();
	history.onStatusChange(() => { statusEvents++; });
	assert.equal(await history.retrySave(), false);
	assert.equal(history.saveFailed, true);
	shouldFailWrite = false;
	assert.equal(await history.retrySave(), true);
	assert.equal(history.saveFailed, false);
	assert.ok(statusEvents >= 2);
	history.dispose();

	delete globalThis.IOUtils;
	delete globalThis.Zotero;
});

test('Multi-PDF discovery, selection, and comparison under a single parent item work for parent, child attachment, and reader views', async () => {
	const pdf1 = {
		id: 501,
		parentID: 500,
		isRegularItem: () => false,
		isAttachment: () => true,
		isPDFAttachment: () => true,
		attachmentFilename: 'Paper-Main.pdf',
		getField: (f) => (f === 'title' ? 'Full Text PDF' : ''),
	};
	const pdf2 = {
		id: 502,
		parentID: 500,
		isRegularItem: () => false,
		isAttachment: () => true,
		isPDFAttachment: () => true,
		attachmentFilename: 'Paper-Supplementary.pdf',
		getField: (f) => (f === 'title' ? 'Supporting Information' : ''),
	};
	const parentItem = {
		id: 500,
		isRegularItem: () => true,
		isAttachment: () => false,
		getBestAttachment: async () => pdf1,
		getAttachments: () => [501, 502],
	};
	pdf1.parentItem = parentItem;

	const itemMap = new Map([
		[500, parentItem],
		[501, pdf1],
		[502, pdf2],
	]);
	globalThis.Zotero = {
		Items: {
			get: (id) => itemMap.get(id),
			getAsync: async (ids) => (Array.isArray(ids) ? ids.map((i) => itemMap.get(i)) : itemMap.get(ids)),
		},
		Reader: {
			getByTabID: (tabID) => (tabID === 'reader-tab-1' ? { itemID: 501 } : null),
		},
	};

	// 1. Selecting parent item returns all 2 PDFs with disambiguated title + filename
	const fromParent = await resolveAllPdfAttachments(parentItem);
	assert.equal(fromParent.length, 2);
	assert.equal(fromParent[0].id, 501);
	assert.equal(fromParent[0].title, 'Full Text PDF (Paper-Main.pdf)');
	assert.equal(fromParent[1].id, 502);
	assert.equal(fromParent[1].title, 'Supporting Information (Paper-Supplementary.pdf)');

	// 2. Selecting child attachment #2 still ascends to parent item and returns all 2 sibling PDFs
	const fromChild = await resolveAllPdfAttachments(pdf2);
	assert.equal(fromChild.length, 2);
	assert.equal(fromChild[0].id, 501);
	assert.equal(fromChild[1].id, 502);

	// 3. In Library view, clicking child attachment #2 picks attachment #2 by default while listing both
	const ctxChild = await resolveSameItemPdfContext(pdf2);
	assert.equal(ctxChild.ownerID, 500);
	assert.equal(ctxChild.currentAttachmentID, 502);
	assert.equal(pickCompareAttachment(ctxChild, 'sibling', null, 'library')?.id, 502);
	assert.equal(pickCompareAttachment(ctxChild, 'sibling', 501, 'library')?.id, 501);

	// 4. In Reader view (reading pdf1 in reader-tab-1), Item Pane receives parentItem, detects active reader PDF 501, and defaults sidebar preview to sibling PDF 502 for comparison
	const mockWin = { Zotero_Tabs: { selectedID: 'reader-tab-1' } };
	const ctxReader = await resolveSameItemPdfContext(parentItem, mockWin);
	assert.equal(ctxReader.ownerID, 500);
	assert.equal(ctxReader.currentAttachmentID, 501);
	assert.equal(pickCompareAttachment(ctxReader, 'sibling', null, 'reader')?.id, 502);
	assert.equal(pickCompareAttachment(ctxReader, 'self', null, 'reader')?.id, 501);

	delete globalThis.Zotero;
});
