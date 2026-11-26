import test from 'node:test';
import assert from 'node:assert/strict';

import { TypedEventBus } from '../src/kernel/event-bus.ts';
import { computeReaderNeighbors, ReaderNeighborPublisher } from '../src/domains/workspace/reader/reader-neighbors.ts';
import { RemarkColumnController } from '../src/domains/visual-notes/columns/library-columns.ts';
import { InfoBriefNoteController } from '../src/domains/visual-notes/reader/info-brief-note.ts';
import { WorkspaceStateStore } from '../src/domains/workspace/store/state-store.ts';
import { readRemarkFromExtra, syncItemRemarkToExtra, upsertRemarkInExtra } from '../src/services/item-remark-sync.ts';
import { createCompareBar, syncCompareBar } from '../src/domains/inspector/pdf/pdf-preview-ui.ts';
import { attachNeighborCompareButtons, syncNeighborCompareButtons } from '../src/domains/inspector/pdf/pdf-compare-helpers.ts';
import { UnifiedPrefService } from '../src/kernel/pref-service.ts';
import { BridgeFlowApp } from '../src/index.ts';

function createMemoryPrefs(initial = {}) {
	const map = new Map(Object.entries(initial));
	const observers = new Map();
	let nextId = 1;
	const adapter = {
		get(key) { return map.get(key); },
		set(key, val) {
			map.set(key, val);
			for (const [prefix, list] of observers.entries()) {
				if (key.startsWith(prefix)) for (const fn of list) fn(key);
			}
		},
		clear(key) { map.delete(key); },
		registerObserver(prefix, fn) {
			const id = nextId++;
			if (!observers.has(prefix)) observers.set(prefix, new Set());
			observers.get(prefix).add(fn);
			return `${prefix}:${id}`;
		},
		unregisterObserver(token) {
			const [prefix] = String(token).split(':');
			observers.get(prefix)?.delete(token);
		},
	};
	return { adapter, prefs: new UnifiedPrefService(adapter) };
}

function createFakeDoc() {
	const makeEl = (tag) => {
		const attrs = new Map();
		const children = [];
		const listeners = new Map();
		return {
			tagName: tag.toUpperCase(),
			style: {},
			children,
			options: [],
			value: '',
			selectedIndex: 0,
			textContent: '',
			title: '',
			className: '',
			ownerDocument: null,
			setAttribute(k, v) { attrs.set(k, String(v)); },
			getAttribute(k) { return attrs.get(k) ?? null; },
			removeAttribute(k) { attrs.delete(k); },
			hasAttribute(k) { return attrs.has(k); },
			append(...nodes) {
				for (const n of nodes) {
					n.ownerDocument = doc;
					children.push(n);
					if (tag === 'select' && n.tagName === 'OPTION') this.options.push(n);
				}
			},
			addEventListener(type, fn) {
				if (!listeners.has(type)) listeners.set(type, []);
				listeners.get(type).push(fn);
			},
			click() {
				for (const fn of listeners.get('click') || []) fn({ target: this });
			},
		};
	};
	const doc = {
		createElementNS(_ns, tag) {
			const el = makeEl(tag);
			el.ownerDocument = doc;
			return el;
		},
	};
	return doc;
}

test('Phase 1.1: computeReaderNeighbors & ReaderNeighborPublisher detect adjacent reader tabs', () => {
	const tracked = [
		{ tabID: 'tab-1', key: 'item:10', type: 'reader', itemID: 10, parentItemID: 100, title: 'Paper A', shortTitle: 'Paper A', filename: '', source: '', creatorYear: '', collection: '', groupId: '', pinned: false, sleeping: false, virtual: false, remark: '', lastViewedAt: 0 },
		{ tabID: 'tab-v', key: 'item:11', type: 'reader', itemID: 11, parentItemID: 101, title: 'Virtual', shortTitle: 'Virtual', filename: '', source: '', creatorYear: '', collection: '', groupId: '', pinned: false, sleeping: false, virtual: true, remark: '', lastViewedAt: 0 },
		{ tabID: 'tab-2', key: 'item:12', type: 'reader', itemID: 12, parentItemID: 102, title: 'Paper B', shortTitle: 'Paper B', filename: '', source: '', creatorYear: '', collection: '', groupId: '', pinned: false, sleeping: false, virtual: false, remark: '', lastViewedAt: 0 },
		{ tabID: 'tab-3', key: 'item:13', type: 'reader', itemID: 13, parentItemID: 103, title: 'Paper C', shortTitle: 'Paper C', filename: '', source: '', creatorYear: '', collection: '', groupId: '', pinned: false, sleeping: false, virtual: false, remark: '', lastViewedAt: 0 },
	];
	const win = { Zotero_Tabs: { selectedID: 'tab-2' } };
	const res = computeReaderNeighbors(win, tracked);
	assert.equal(res.activeTabID, 'tab-2');
	assert.equal(res.left?.tabID, 'tab-1');
	assert.equal(res.left?.itemID, 10);
	assert.equal(res.right?.tabID, 'tab-3');
	assert.equal(res.right?.itemID, 13);

	const bus = new TypedEventBus();
	const events = [];
	bus.on('workspace:reader-neighbors-updated', (p) => events.push(p));
	const pub = new ReaderNeighborPublisher(bus);
	pub.publish(win, tracked);
	pub.publish(win, tracked); // deduplicated
	assert.equal(events.length, 1);
	win.Zotero_Tabs.selectedID = 'tab-1';
	pub.publish(win, tracked);
	assert.equal(events.length, 2);
	assert.equal(events[1].left, undefined);
	assert.equal(events[1].right?.tabID, 'tab-2');
});

test('Phase 1.1: single-PDF reader mode keeps compare bar visible with Self and Neighbor buttons', () => {
	const doc = createFakeDoc();
	const ac = new AbortController();
	const st = { mode: 'sibling', pickedAttachmentID: null, currentAttachmentID: 10, tabType: 'reader' };
	const ui = createCompareBar(doc, ac.signal, () => st, () => {});
	const neighborCtrl = attachNeighborCompareButtons(doc, ui.bar, ac.signal, () => {});

	const entries = [{ id: 10, title: 'Main.pdf', shortLabel: 'Main.pdf', fullTitle: 'Main.pdf', attachment: {} }];
	syncCompareBar(ui, st, entries, 10);
	syncNeighborCompareButtons(neighborCtrl, ui.bar, 'reader', entries.length, {
		activeTabID: 'tab-2',
		left: { tabID: 'tab-1', itemID: 9, parentItemID: 90, title: 'Left Paper' },
	});

	assert.equal(ui.bar.style.display, 'flex');
	assert.equal(ui.selfBtn.style.display, 'inline-flex');
	assert.equal(ui.selectEl.style.display, 'none');
	assert.equal(neighborCtrl.leftBtn.style.display, 'inline-flex');
	assert.equal(neighborCtrl.rightBtn.style.display, 'none');
});

test('Phase 1.2: remark syncs safely with Extra field and RemarkColumnController displays brief notes', async () => {
	const originalExtra = 'DOI: 10.1000/xyz\nCitation Key: smith2024';
	const updated = upsertRemarkInExtra(originalExtra, '核心实验基线');
	assert.equal(readRemarkFromExtra(updated), '核心实验基线');
	assert.match(updated, /DOI: 10\.1000\/xyz/);
	assert.match(updated, /Citation Key: smith2024/);
	assert.equal(upsertRemarkInExtra(updated, ''), originalExtra);

	let savedCount = 0;
	const item = {
		id: 501,
		deleted: false,
		isRegularItem: () => true,
		getField: (f) => (f === 'extra' ? item._extra : ''),
		setField: (f, v) => { if (f === 'extra') item._extra = v; },
		saveTx: async () => { savedCount++; },
		getAttachments: () => [601],
		_extra: originalExtra,
	};
	globalThis.Zotero = { Items: { get: (id) => (id === 501 ? item : null) }, locale: 'zh-CN' };

	assert.equal(await syncItemRemarkToExtra(501, '重要对比文献'), true);
	assert.equal(savedCount, 1);
	assert.equal(readRemarkFromExtra(item._extra), '重要对比文献');

	const { prefs } = createMemoryPrefs({ 'workspace.syncRemarkToExtra': true, 'workspace.remarkColumn.enable': true });
	const store = new WorkspaceStateStore(prefs);
	const col = new RemarkColumnController({ prefs, info: { id: 'bridgeflow@test' } }, store);
	assert.equal(col.getDisplayForItem(item), '重要对比文献');
	store.setRemark('item:601', '覆盖标签简记');
	assert.equal(col.getDisplayForItem(item), '覆盖标签简记');

	// InfoBriefNoteController registers native Info Row & writes back to Extra + store
	let registeredRow = null;
	let refreshedRowID = '';
	globalThis.Zotero.ItemPaneManager = {
		registerInfoRow(opts) { registeredRow = opts; return opts.rowID; },
		unregisterInfoRow() {},
		refreshInfoRow(id) { refreshedRowID = id; },
	};
	const infoNote = new InfoBriefNoteController({ prefs, info: { id: 'bridgeflow@test' } }, () => {});
	infoNote.setDataSource({
		getReadingProgress: () => undefined,
		getRemark: (id) => store.state.remarks[`item:${id}`] || '',
		setRemark: (id, val) => store.setRemark(`item:${id}`, val),
	});
	assert.equal(infoNote.register(), true);
	assert.equal(registeredRow.rowID, 'bridgeflow-brief-note');
	assert.equal(registeredRow.onGetData({ item }), '覆盖标签简记');
	registeredRow.onSetData({ item, value: '信息面板新简记' });
	assert.equal(store.state.remarks['item:501'], '信息面板新简记');
	assert.equal(refreshedRowID, 'bridgeflow-brief-note');
	await new Promise((r) => setTimeout(r, 10));
	assert.equal(readRemarkFromExtra(item._extra), '信息面板新简记');
	infoNote.unregister();
	delete globalThis.Zotero;
});
