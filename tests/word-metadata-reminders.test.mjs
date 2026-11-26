import test from 'node:test';
import assert from 'node:assert/strict';

import { BridgeFlowApp } from '../src/index.ts';
import { inspectItemMetadataFields } from '../src/domains/inspector/word-panel/word-cite-reminders-model.ts';
import { REMINDERS_CARD_CSS } from '../src/domains/inspector/word-panel/word-cite-reminders-ui.ts';
import { WORD_CITE_SCHEME_C_CSS } from '../src/domains/inspector/word-panel/word-cite-styles.ts';
import { sweepBridgeFlowCacheDirectory } from '../src/services/cache-hygiene.ts';
import { MetadataRemindersDiskCache } from '../src/services/metadata-reminders-cache.ts';

function createMemoryPrefs(initial = {}) {
	const store = new Map(Object.entries(initial));
	return {
		get(key) { return store.get(key); },
		set(key, val) { store.set(key, val); },
		registerObserver() { return 1; },
		unregisterObserver() {},
	};
}

function makeItem(id, {
	key = `K${id}`,
	itemType = 'journalArticle',
	itemTypeID = 0,
	fields = {},
	creators = [{ lastName: 'Zhang' }],
} = {}) {
	return {
		id,
		key,
		libraryID: 1,
		deleted: false,
		...(itemType ? { itemType } : {}),
		...(itemTypeID ? { itemTypeID } : {}),
		fields: { ...fields },
		creators: [...creators],
		isRegularItem: () => true,
		isTrashed: () => false,
		getField(name) { return String(this.fields[name] || ''); },
		getCreators() { return this.creators; },
	};
}

function createMockElement(tag, ownerDocument) {
	const classes = new Set();
	const attrs = new Map();
	const listeners = new Map();
	const children = [];
	const el = {
		localName: tag,
		ownerDocument,
		parentElement: null,
		children,
		hidden: false,
		disabled: false,
		open: false,
		tabIndex: -1,
		textContent: '',
		title: '',
		type: '',
		set className(val) {
			classes.clear();
			for (const c of String(val || '').split(/\s+/).filter(Boolean)) classes.add(c);
		},
		get className() { return [...classes].join(' '); },
		classList: {
			add(...names) { for (const n of names) classes.add(n); },
			remove(...names) { for (const n of names) classes.delete(n); },
			toggle(name, force) {
				const next = force === undefined ? !classes.has(name) : Boolean(force);
				if (next) classes.add(name); else classes.delete(name);
				return next;
			},
			contains(name) { return classes.has(name); },
		},
		setAttribute(k, v) { attrs.set(k, String(v)); },
		getAttribute(k) { return attrs.get(k) ?? null; },
		append(...nodes) {
			for (const n of nodes) {
				if (!n || typeof n === 'string') continue;
				n.parentElement = el;
				children.push(n);
			}
		},
		appendChild(n) { el.append(n); return n; },
		addEventListener(evt, fn, opts) {
			if (!listeners.has(evt)) listeners.set(evt, new Set());
			listeners.get(evt).add(fn);
			opts?.signal?.addEventListener?.('abort', () => listeners.get(evt)?.delete(fn));
		},
		dispatchEvent(evt) {
			evt.target = evt.target || el;
			for (const fn of [...(listeners.get(evt.type) || [])]) fn(evt);
			if (el.parentElement) el.parentElement.dispatchEvent(evt);
			return true;
		},
		click() { el.dispatchEvent({ type: 'click', target: el, preventDefault() {}, stopPropagation() {} }); },
		closest(selector) {
			let cur = el;
			while (cur) {
				if (cur.localName === selector) return cur;
				cur = cur.parentElement;
			}
			return null;
		},
	};
	return el;
}

function createMockDocument(win) {
	const byId = new Map();
	const doc = {
		defaultView: win,
		head: null,
		documentElement: null,
		createElementNS(_ns, tag) { return doc.createElement(tag); },
		createElement(tag) {
			const node = createMockElement(tag, doc);
			let _id = '';
			Object.defineProperty(node, 'id', {
				get: () => _id,
				set: (v) => { _id = String(v); byId.set(_id, node); },
			});
			return node;
		},
		getElementById(id) { return byId.get(id) || null; },
		addEventListener() {},
		dispatchEvent() {},
	};
	doc.head = doc.createElement('head');
	doc.documentElement = doc.createElement('html');
	return doc;
}

test('inspectItemMetadataFields & CSS guards: granular switches, itemTypeID lookup, Online First vs cited pagination, and crisp Zotero borders', () => {
	const prevZotero = globalThis.Zotero;
	globalThis.Zotero = {
		ItemTypes: { getName: (id) => (id === 21 ? 'journalArticle' : '') },
	};
	try {
		// Real Zotero.Item often exposes numeric itemTypeID rather than plain string itemType
		const viaTypeID = makeItem(10, {
			itemType: '',
			itemTypeID: 21,
			fields: { title: 'TypeID Resolved Paper', date: '2024', volume: '12', pages: '100' },
		});
		assert.deepEqual(inspectItemMetadataFields(viaTypeID, true), [
			{ kind: 'missing', text: '缺少期刊名' },
			{ kind: 'suggested', text: 'DOI 建议补全' },
		]);

		// Turning off venue & suggested switches suppresses venue error & suggested badges
		assert.equal(inspectItemMetadataFields(viaTypeID, true, { checkVenue: false, showSuggested: false }), null);

		// Online First paper with DOI: not flagged while browsing uncited, flagged when cited in Word or strictOnlineFirst=true
		const onlineFirst = makeItem(4, {
			itemType: 'journalArticle',
			fields: {
				title: 'Atomically resolved exciton emission from single defects in MoS2',
				date: '2026',
				publicationTitle: 'Nature Nanotechnology',
				DOI: '10.1038/s41565-026-00001-x',
			},
		});
		assert.equal(inspectItemMetadataFields(onlineFirst, true, {}, { isCitedInWord: false }), null);
		assert.deepEqual(inspectItemMetadataFields(onlineFirst, true, {}, { isCitedInWord: true }), [
			{ kind: 'missing', text: '缺少卷期页码' },
		]);
		assert.deepEqual(inspectItemMetadataFields(onlineFirst, true, { strictOnlineFirst: true }, { isCitedInWord: false }), [
			{ kind: 'missing', text: '缺少卷期页码' },
		]);

		// CSS regression guards: B4 borderless cornflower-blue CTA (#3a76d2/#2d5fb8) + harmonized palette + 18px coordinated stats
		assert.equal(/background\s*:\s*var\(--fill-primary/.test(WORD_CITE_SCHEME_C_CSS), false);
		assert.equal(/var\(--material-border/.test(WORD_CITE_SCHEME_C_CSS), false);
		assert.equal(/#3a76d2/.test(WORD_CITE_SCHEME_C_CSS) && /#c9323f/.test(WORD_CITE_SCHEME_C_CSS) && /#eff4fd/.test(WORD_CITE_SCHEME_C_CSS), true);
		assert.equal(/font-size:\s*18px;\s*font-weight:\s*500/.test(WORD_CITE_SCHEME_C_CSS), true);
		assert.equal(/--zbf-w-b1/.test(WORD_CITE_SCHEME_C_CSS), true);
		assert.equal(/overflow-x\s*:\s*hidden/.test(REMINDERS_CARD_CSS), true);
	} finally {
		globalThis.Zotero = prevZotero;
	}
});

test('Scheme C Word Citation Workspace: always-visible reminder card, async item hydration, scope/autoExpand switches & persistence', async () => {
	const prevZotero = globalThis.Zotero;
	const prevIOUtils = globalThis.IOUtils;

	const diskFiles = new Map();
	globalThis.IOUtils = {
		async makeDirectory() {},
		async exists(p) { return diskFiles.has(p); },
		async readUTF8(p) {
			if (!diskFiles.has(p)) {
				const err = new Error('NotFound');
				err.name = 'NotFoundError';
				throw err;
			}
			return diskFiles.get(p);
		},
		async writeUTF8(p, content) {
			diskFiles.set(p, content);
		},
	};

	const itemA = makeItem(301, {
		key: 'ITEM_A',
		itemType: 'journalArticle',
		creators: [],
		fields: { title: 'Interlayer sliding ferroelectricity in bilayer ReS2', date: '2024', publicationTitle: 'Physical Review B', volume: '109', pages: '125401' },
	});
	// itemLazy (302) starts unloaded from synchronous Zotero.Items.get() and loads via getAsync()
	const itemLazy = makeItem(302, {
		key: 'ITEM_LAZY',
		itemType: 'journalArticle',
		fields: { title: 'Unloaded Collection Citation', date: '2023' },
	});
	const itemClean = makeItem(303, {
		key: 'ITEM_CLEAN',
		itemType: 'journalArticle',
		fields: { title: 'Complete Paper', date: '2022', publicationTitle: 'Nature', volume: '600', pages: '100', DOI: '10.1038/clean' },
	});

	const syncLoaded = new Map([[301, itemA], [303, itemClean]]);
	const dbAll = new Map([[301, itemA], [302, itemLazy], [303, itemClean]]);
	const selectedCalls = [];
	const sections = [];

	globalThis.Zotero = {
		locale: 'zh-CN',
		DataDirectory: { dir: 'D:\\MockZoteroData' },
		Items: {
			get: (id) => syncLoaded.get(Number(id)) || null,
			getAsync: async (ids) => {
				const list = Array.isArray(ids) ? ids : [ids];
				for (const rawId of list) {
					const found = dbAll.get(Number(rawId));
					if (found) syncLoaded.set(Number(rawId), found);
				}
				return Array.isArray(ids) ? list.map((i) => syncLoaded.get(Number(i))) : syncLoaded.get(Number(ids));
			},
		},
		ItemPaneManager: {
			registerSection(desc) { sections.push(desc); return `sec-${sections.length}`; },
			unregisterSection() {},
		},
	};

	const app = new BridgeFlowApp({
		prefAdapter: createMemoryPrefs({
			'inspector.wordCite.enable': true,
			'inspector.wordCite.showMetadataReminders': true,
			'modules.wordCite.enable': true,
		}),
	});
	app.init({ id: 'bridgeflow@groele', version: '0.6.10', rootURI: 'chrome://test/' });
	await app.services.init();

	try {
		app.inspector.wordCiteSection.register();
		const registered = sections.find((s) => s.paneID === 'bridgeflow-word-cite');
		assert.ok(registered);

		const win = {
			ZoteroPane: {
				getSelectedItems: () => [itemClean],
				selectItem: async (id) => { selectedCalls.push(id); return true; },
			},
		};
		const doc = createMockDocument(win);
		const body = doc.createElement('div');
		registered.onInit({ doc, body, item: itemClean });

		const wrap = body.children[0];
		const [mainView, receiptEl] = wrap.children;
		const [docCard, statStrip, citeCard, actionsEl, orphanBox, reminderBox] = mainView.children;
		const [docRow] = docCard.children;
		const [wBadge, docMeta] = docRow.children;
		const [docNameEl] = docMeta.children;
		const [citedCell, inTextCell, orphanCell] = statStrip.children;
		const [citeHeadEl, citeTitleRow] = citeCard.children;
		const [remHeadBtn, remBodyEl] = reminderBox.children;
		const [toolbar, listEl] = remBodyEl.children;
		const [filterBar] = toolbar.children;

		// Before Word connects: amber card (no .is-live), Fluent SVG Word icon, unified '—' tiles, governance cards below actionsEl
		assert.equal(docCard.classList.contains('is-live'), false);
		assert.equal(statStrip.classList.contains('is-live'), false);
		assert.equal(wBadge.children[0].localName, 'svg');
		assert.equal(wBadge.children[0].children.length, 7);
		assert.equal(citedCell.children[0].textContent, '—');
		assert.equal(inTextCell.children[0].textContent, '—');
		assert.equal(orphanCell.children[0].textContent, '—');
		assert.equal(mainView.children.indexOf(actionsEl) < mainView.children.indexOf(orphanBox), true);
		assert.equal(mainView.children.indexOf(orphanBox) < mainView.children.indexOf(reminderBox), true);

		// Even BEFORE Word connects and when selected item is 100% complete, reminder card stays visible with green ✓!
		assert.equal(reminderBox.hidden, false, 'Reminder card must remain visible in UI even with 0 missing items');
		assert.equal(remBodyEl.hidden, true, 'In-place accordion body starts collapsed');
		assert.equal(remHeadBtn.children[0].textContent, '✓');
		assert.match(remHeadBtn.children[1].textContent, /当前所选文献著录完整/);

		// Emit Word snapshot including unloaded item 302
		app.kernel.bus.emit('citation:snapshot-updated', {
			activeSessionID: 'sess-1',
			activeDocumentName: 'Manuscript.docx',
			totalCitedCount: 3,
			citedItemIDs: [301, 302, 303],
			byItemID: new Map([
				[303, { itemID: 303, ordinal: 5, occurrences: 2, shortText: '[5]', documentName: 'Manuscript.docx', sessionID: 'sess-1' }],
				[301, { itemID: 301, ordinal: 24, occurrences: 3, shortText: '[24]', documentName: 'Manuscript.docx', sessionID: 'sess-1' }],
				[302, { itemID: 302, ordinal: 31, occurrences: 1, shortText: '[31]', documentName: 'Manuscript.docx', sessionID: 'sess-1' }],
			]),
			orphans: [
				{ key: 'orph-1', kind: 'missing', ordinal: 12, shortText: '[12]', title: 'Broken Ref', itemData: { title: 'Broken Ref', DOI: '10.1000/b' } },
			],
		});

		// Live session updates: .is-live classes, split docStem/docExt, [5] badge & frequency pill
		assert.equal(docCard.classList.contains('is-live'), true);
		assert.equal(statStrip.classList.contains('is-live'), true);
		assert.equal(docNameEl.children[0].textContent, 'Manuscript');
		assert.equal(docNameEl.children[1].textContent, '.docx');
		assert.equal(citeTitleRow.children[0].textContent, '[5]');
		assert.equal(citeHeadEl.children[1].textContent, '文内已引 2 处');
		assert.match(actionsEl.children[0].textContent, /\[5\]/);

		// Uncited item keeps clean title (hidden ordinal badge), concise '尚未引用', and clean insert label
		const itemUncited = makeItem(399, { key: 'UNCITED', fields: { title: 'Uncited Paper' } });
		win.ZoteroPane.getSelectedItems = () => [itemUncited];
		registered.onItemChange({ body, item: itemUncited });
		assert.equal(citeTitleRow.children[0].hidden, true);
		assert.equal(citeHeadEl.children[1].textContent, '尚未引用');
		assert.equal(actionsEl.children[0].textContent, '插入到 Word 光标处');
		win.ZoteroPane.getSelectedItems = () => [itemClean];
		registered.onItemChange({ body, item: itemClean });

		// Wait for async hydration of item 302
		await new Promise((r) => setTimeout(r, 15));
		assert.equal(remHeadBtn.children[0].textContent, '!');
		assert.equal(remHeadBtn.children[1].textContent, '2 篇引用文献信息待补全');
		assert.equal(remHeadBtn.children[2].textContent, '查看');

		// In-place toggle expand / collapse without hiding mainView
		remHeadBtn.click();
		assert.equal(mainView.hidden, false, 'Main view remains visible when reminder accordion expands');
		assert.equal(remBodyEl.hidden, false);
		remHeadBtn.click();
		assert.equal(remBodyEl.hidden, true);

		// Test reminderAutoExpand switch dynamically expanding in-place
		app.kernel.prefs.set('inspector.wordCite.reminderAutoExpand', true);
		app.inspector.wordCiteSection.refreshAll();
		assert.equal(remBodyEl.hidden, false);

		// Test reminderScope = 'selectionOnly' -> only checks itemClean (complete) -> shows ✓
		app.kernel.prefs.set('inspector.wordCite.reminderScope', 'selectionOnly');
		app.inspector.wordCiteSection.refreshAll();
		assert.equal(remHeadBtn.children[0].textContent, '✓');
		app.kernel.prefs.set('inspector.wordCite.reminderScope', 'both');
		app.inspector.wordCiteSection.refreshAll();
		assert.equal(remHeadBtn.children[1].textContent, '2 篇引用文献信息待补全');

		// Test showOrphanRecovery = false hides orphan card
		app.kernel.prefs.set('inspector.wordCite.showOrphanRecovery', false);
		app.inspector.wordCiteSection.refreshAll();
		assert.equal(orphanBox.hidden, true);
		app.kernel.prefs.set('inspector.wordCite.showOrphanRecovery', true);
		app.inspector.wordCiteSection.refreshAll();
		assert.equal(orphanBox.hidden, false);

		// Locate & Ignore/Undo/Restore workflow directly inside expanded accordion
		listEl.children[0].click();
		await new Promise((r) => setTimeout(r, 10));
		assert.deepEqual(selectedCalls, [301]);
		assert.match(receiptEl.textContent, /已定位到文献条目/);

		listEl.children[0].children[2].children[1].click();
		await app.services.reminders.flushNow();
		assert.equal(remHeadBtn.children[1].textContent, '1 篇引用文献信息待补全');
		const undoBtn = receiptEl.children[1].children[1].children[0];
		undoBtn.click();
		assert.equal(remHeadBtn.children[1].textContent, '2 篇引用文献信息待补全');

		listEl.children[0].children[2].children[1].click();
		await app.services.reminders.flushNow();
		const reloadCache = new MetadataRemindersDiskCache();
		await reloadCache.init();
		assert.equal(reloadCache.isIgnored(itemA), true);

		filterBar.children[1].click();
		assert.equal(listEl.children.length, 1);
		listEl.children[0].children[2].children[1].click();
		filterBar.children[0].click();
		assert.equal(listEl.children.length, 2);

		// Master switch showMetadataReminders = false hides the card completely
		app.kernel.prefs.set('inspector.wordCite.showMetadataReminders', false);
		app.inspector.wordCiteSection.refreshAll();
		assert.equal(reminderBox.hidden, true);
	} finally {
		app.inspector.wordCiteSection.unregister();
		app.services.dispose();
		globalThis.Zotero = prevZotero;
		globalThis.IOUtils = prevIOUtils;
	}
});

test('sweepBridgeFlowCacheDirectory removes migrated legacy root files & cover-*.txt while preserving unmigrated files', async () => {
	const prevZotero = globalThis.Zotero;
	const prevIO = globalThis.IOUtils;
	const prevPath = globalThis.PathUtils;
	const files = new Map([
		['D:/CacheTest/bridgeflow-cache/citations/citation-history.json', '{\n  "version": 1,\n  "records": []\n}\n'],
		['D:/CacheTest/bridgeflow-cache/citation-history.json', '{"version":1,"records":[]}'],
		['D:/CacheTest/bridgeflow-cache/citation-history.bak.json', '{"records":[{"text":"keep my citation"}]}'],
		['D:/CacheTest/bridgeflow-cache/citations/citation-history.bak.json', '{"records":[]}'],
		['D:/CacheTest/bridgeflow-cache/shared.tmp', 'other application'],
		['D:/CacheTest/bridgeflow-cache/ratings/item-ratings.json.tmp', 'old temporary file'],
		['D:/CacheTest/bridgeflow-cache/brief-notes.json', '{"format":"zotero-bridgeflow-brief-notes","version":1,"state":{"remarks":{"1":"keep"},"remarkModes":{}}}'],
		['D:/CacheTest/bridgeflow-cache/covers/cover-13586.txt', 'legacy-base64'],
		['D:/CacheTest/bridgeflow-cache/covers/1-VALID-480.json', '{\n  "version": 2\n}\n'],
	]);
	globalThis.Zotero = { DataDirectory: { dir: 'D:/CacheTest' } };
	globalThis.PathUtils = { join: (...parts) => parts.join('/') };
	globalThis.IOUtils = {
		exists: async (p) => files.has(p),
		readUTF8: async (p) => files.get(p),
		writeUTF8: async (p, txt) => { files.set(p, txt); },
		remove: async (p) => { files.delete(p); },
		stat: async (p) => ({ type: 'regular', size: (files.get(p) || '').length, lastModified: Date.now() - 7200_000 }),
		getChildren: async (dir) => [...files.keys()].filter((k) => k.startsWith(dir + '/') && !k.slice(dir.length + 1).includes('/')),
	};
	try {
		const removed = await sweepBridgeFlowCacheDirectory();
		await new Promise((r) => setTimeout(r, 20));
		assert.ok(removed >= 1);
		assert.equal(files.has('D:/CacheTest/bridgeflow-cache/citation-history.json'), false);
		assert.equal(files.has('D:/CacheTest/bridgeflow-cache/citation-history.bak.json'), true);
		assert.equal(files.has('D:/CacheTest/bridgeflow-cache/shared.tmp'), true);
		assert.equal(files.has('D:/CacheTest/bridgeflow-cache/ratings/item-ratings.json.tmp'), false);
		assert.equal(files.has('D:/CacheTest/bridgeflow-cache/brief-notes.json'), true);
		assert.equal(files.has('D:/CacheTest/bridgeflow-cache/covers/cover-13586.txt'), false);
		assert.equal(files.has('D:/CacheTest/bridgeflow-cache/covers/1-VALID-480.json'), true);
	} finally {
		globalThis.Zotero = prevZotero;
		globalThis.IOUtils = prevIO;
		globalThis.PathUtils = prevPath;
	}
});
