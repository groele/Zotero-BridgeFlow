import test from 'node:test';
import assert from 'node:assert/strict';
import { PluginKernel } from '../src/kernel/plugin-kernel.ts';
import { WorkspaceStateStore } from '../src/domains/workspace/store/state-store.ts';
import { ReaderAttachmentSwitcher } from '../src/domains/workspace/reader/reader-attachment-switcher.ts';
import {
	openSiblingAttachmentMenu,
	READER_ATT_MENU_ID,
	resolveSiblingAttachments,
} from '../src/domains/workspace/reader/reader-attachment-switcher-ui.ts';
import { WorkspaceHoverCard } from '../src/domains/workspace/sidebar/hover-card.ts';
import { updatePreferenceDependencies } from '../src/prefs/dependencies.ts';

function createMemoryPrefs(seed = {}) {
	const store = new Map(Object.entries(seed).map(([k, v]) => [`extensions.zotero.bridgeflow.${k}`, v]));
	return {
		adapter: {
			get: (k) => store.get(k),
			set: (k, v) => store.set(k, v),
			clear: (k) => store.delete(k),
		},
	};
}

function makeFakeElement(tag) {
	const attrs = new Map();
	const listeners = new Map();
	const classes = new Set();
	const el = {
		tagName: tag.toUpperCase(),
		localName: tag.toLowerCase(),
		id: '',
		className: '',
		type: '',
		title: '',
		hidden: false,
		textContent: '',
		style: { setProperty() {} },
		children: [],
		parentNode: null,
		isConnected: true,
		defaultView: null,
		classList: {
			contains: (c) => classes.has(c) || el.className.split(/\s+/).includes(c),
			add: (c) => classes.add(c),
			remove: (c) => classes.delete(c),
		},
		setAttribute(k, v) {
			attrs.set(k, String(v));
			if (k === 'id') this.id = String(v);
			if (k === 'class') this.className = String(v);
			if (k === 'title') this.title = String(v);
		},
		getAttribute(k) {
			if (k === 'title') return attrs.has('title') ? attrs.get('title') : (this.title || null);
			return attrs.has(k) ? attrs.get(k) : null;
		},
		removeAttribute(k) {
			attrs.delete(k);
			if (k === 'title') this.title = '';
		},
		hasAttribute(k) { return attrs.has(k); },
		appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
		append(...args) { for (const c of args) this.appendChild(c); },
		remove() {
			if (this.parentNode?.children) {
				const i = this.parentNode.children.indexOf(this);
				if (i >= 0) this.parentNode.children.splice(i, 1);
			}
			this.parentNode = null;
			this.isConnected = false;
		},
		contains(node) {
			if (node === this) return true;
			return this.children.some((c) => c.contains?.(node));
		},
		addEventListener(type, fn) {
			if (!listeners.has(type)) listeners.set(type, []);
			listeners.get(type).push(fn);
		},
		removeEventListener(type, fn) {
			const arr = listeners.get(type);
			if (!arr) return;
			const i = arr.indexOf(fn);
			if (i >= 0) arr.splice(i, 1);
		},
		dispatch(type, ev = {}) {
			for (const fn of [...(listeners.get(type) || [])]) {
				fn({ preventDefault() {}, stopPropagation() {}, target: this, ...ev });
			}
		},
		getBoundingClientRect: () => ({ left: 120, bottom: 38, right: 200 }),
		querySelectorAll: () => [],
		querySelector: () => null,
	};
	return el;
}

function makeFakeDoc() {
	const listeners = new Map();
	const body = makeFakeElement('body');
	const timers = [];
	const win = {
		innerWidth: 1024,
		innerHeight: 768,
		listeners: new Map(),
		setTimeout(fn, delay) { const id = timers.length + 1; timers.push({ fn, delay }); return id; },
		clearTimeout() {},
		addEventListener(type, fn) {
			if (!this.listeners.has(type)) this.listeners.set(type, []);
			this.listeners.get(type).push(fn);
		},
		removeEventListener(type, fn) {
			const arr = this.listeners.get(type);
			if (!arr) return;
			const i = arr.indexOf(fn);
			if (i >= 0) arr.splice(i, 1);
		},
		dispatch(type, ev = {}) {
			for (const fn of [...(this.listeners.get(type) || [])]) fn(ev);
		},
	};
	const findById = (node, id) => {
		if (node.id === id) return node;
		for (const c of node.children || []) {
			const hit = findById(c, id);
			if (hit) return hit;
		}
		return null;
	};
	const doc = {
		body,
		documentElement: body,
		defaultView: win,
		createElementNS: (_ns, tag) => { const e = makeFakeElement(tag); e.defaultView = win; return e; },
		getElementById: (id) => findById(body, id),
		addEventListener(type, fn) {
			if (!listeners.has(type)) listeners.set(type, []);
			listeners.get(type).push(fn);
		},
		removeEventListener(type, fn) {
			const arr = listeners.get(type);
			if (!arr) return;
			const i = arr.indexOf(fn);
			if (i >= 0) arr.splice(i, 1);
		},
		dispatch(type, ev = {}) {
			for (const fn of [...(listeners.get(type) || [])]) fn({ preventDefault() {}, stopPropagation() {}, ...ev });
		},
		timers,
	};
	return { doc, win, body };
}

test('v0.9.2 ReaderAttachmentSwitcher menu survives host <browser class="reader"> pointerdown & supports open modes and snapshot filter', async () => {
	const attPdf1 = {
		id: 101,
		deleted: false,
		parentItemID: 100,
		attachmentContentType: 'application/pdf',
		attachmentFilename: 'main.pdf',
		isPDFAttachment: () => true,
		getField: (f) => (f === 'title' ? 'Full Text PDF' : ''),
	};
	const attPdf2 = {
		id: 102,
		deleted: false,
		parentItemID: 100,
		attachmentContentType: 'application/pdf',
		attachmentFilename: 'si.pdf',
		isPDFAttachment: () => true,
		getField: (f) => (f === 'title' ? 'Supporting Information' : ''),
	};
	const attSnap = {
		id: 103,
		deleted: false,
		parentItemID: 100,
		attachmentContentType: 'text/html',
		attachmentLinkMode: 1,
		isSnapshotAttachment: () => true,
		getField: (f) => (f === 'title' ? 'Snapshot' : ''),
	};
	const parent = {
		id: 100,
		deleted: false,
		getAttachments: () => [101, 102, 103],
	};
	const openCalls = [];
	const closedTabIDs = [];
	const nativeTabs = [{ id: 'tab-101', type: 'reader', data: { itemID: 101 } }];
	const hostWin = makeFakeDoc();
	const readerFrame = makeFakeElement('browser');
	readerFrame.className = 'reader';
	hostWin.body.appendChild(readerFrame);

	const mainDoc = makeFakeDoc();
	const anchor = makeFakeElement('button');
	mainDoc.body.appendChild(anchor);

	// Test filtering out snapshots when includeSnapshots = false
	globalThis.Zotero = {
		Items: {
			get: (id) => ({ 100: parent, 101: attPdf1, 102: attPdf2, 103: attSnap }[id] || null),
		},
		Reader: {
			open: async (id, _loc, opts) => { openCalls.push({ id, opts }); return { tabID: opts?.tabID || ('opened-' + id) }; },
			getByTabID: () => null,
		},
		getMainWindows: () => [{ document: hostWin.doc, Zotero_Tabs: { _tabs: nativeTabs, close: (id) => closedTabIDs.push(id), select: () => {} } }],
	};

	const withSnap = resolveSiblingAttachments(101, true);
	assert.equal(withSnap.items.length, 3);
	const withoutSnap = resolveSiblingAttachments(101, false);
	assert.deepEqual(withoutSnap.items.map((x) => x.id), [101, 102]);

	// Open menu and verify host pointerdown on <browser class="reader"> + blur after menu pointerdown do NOT prematurely destroy menu!
	let selected = null;
	const closeFn = openSiblingAttachmentMenu({
		doc: mainDoc.doc,
		hostWin: { document: hostWin.doc },
		readerFrame,
		anchorBtn: anchor,
		items: withSnap.items,
		currentAttID: 101,
		openAttIDs: new Set([101]),
		zh: true,
		onSelect: (entry, ev) => { selected = { entry, ev }; },
		onClose: () => {},
	});

	// Simulate clicking inside reader iframe: hostDoc receives pointerdown on readerFrame first!
	hostWin.doc.dispatch('pointerdown', { target: readerFrame });
	const menu = mainDoc.doc.getElementById(READER_ATT_MENU_ID);
	assert.ok(menu, 'Menu MUST remain mounted when hostDoc receives pointerdown on reader <browser>');

	// Simulate pointerdown on menu item followed by iframe blur before click fires
	const secondRow = menu.children[1];
	menu.dispatch('pointerdown', { target: secondRow });
	mainDoc.win.dispatch('blur');
	assert.ok(mainDoc.doc.getElementById(READER_ATT_MENU_ID), 'Menu MUST survive blur while pointer is active inside menu');

	// Now click fires on row 2!
	secondRow.dispatch('click', {});
	assert.equal(selected?.entry?.id, 102, 'Clicking sibling row after host pointerdown MUST trigger onSelect');
	closeFn();

	// Verify replace-tab openMode closes current tab and preserves group
	const mem = createMemoryPrefs();
	const kernel = new PluginKernel({ prefAdapter: mem.adapter });
	const store = new WorkspaceStateStore(kernel.prefs);
	const grp = store.createGroup('My Group');
	store.assignToGroup('item:101', grp.id);
	const switcher = new ReaderAttachmentSwitcher(kernel, store);
	const readerObj = { itemID: 101, tabID: 'tab-101', _window: { Zotero_Tabs: { _tabs: nativeTabs, close: (id) => closedTabIDs.push(id), select: () => {} } } };
	const ok = await switcher.switchToAttachment(readerObj, 100, withSnap.items[1]);
	assert.equal(ok, true);
	assert.equal(openCalls[0]?.id, 102);
	assert.equal(openCalls[0]?.opts?.tabID, 'tab-101');
	assert.deepEqual(closedTabIDs, []);
	assert.equal(nativeTabs[0].data.itemID, 102);
	assert.equal(store.groupOfKey('item:102'), grp.id);
	assert.equal(store.groupOfKey('item:101'), '');
	kernel.shutdown();
	delete globalThis.Zotero;
});

test('v0.9.2 WorkspaceHoverCard prevents double tooltip via title removal and honors granular card switches', () => {
	const { doc, win } = makeFakeDoc();
	const mem = createMemoryPrefs({
		'workspace.enableHoverPreview': true,
		'workspace.hoverPreviewDelayMs': 420,
		'workspace.hoverPreviewShowMeta': false,
		'workspace.hoverPreviewShowRemark': false,
		'workspace.hoverPreviewShowReadingStats': false,
		'workspace.hoverPreviewShowHeatmap': false,
	});
	const kernel = new PluginKernel({ prefAdapter: mem.adapter });
	const store = new WorkspaceStateStore(kernel.prefs);
	store.updateReadingProgress('item:11', 240, 2, 10);
	const hover = new WorkspaceHoverCard(doc, kernel.prefs, store);
	const tab = {
		key: 'item:11', tabID: 't11', itemID: 11, parentItemID: 11, type: 'reader',
		title: '2D Material Photophysics', shortTitle: '', filename: 'a.pdf',
		source: 'Nature', creatorYear: 'Li, 2024', collection: ' Optics',
		remark: 'Check Fig 2', groupId: '', pinned: false, sleeping: false, virtual: false,
		lastViewedAt: Date.now() - 120_000,
	};

	const chip = makeFakeElement('div');
	chip.defaultView = win;
	hover.attach(chip, tab, tab.title);
	assert.equal(chip.getAttribute('title'), null, 'Native title must be stripped while hover preview is enabled');

	chip.dispatch('mouseenter');
	assert.equal(doc.timers[0]?.delay, 420, 'Hover delay must honor workspace.hoverPreviewDelayMs');
	hover.show(chip, tab);
	const card = doc.getElementById ? doc.body.children.find((c) => c.getAttribute?.('data-zbf-hover-card') === '1') : null;
	assert.ok(card);
	assert.equal(card.children.length, 1, 'Only title remains when Meta, Remark, ReadingStats, and Heatmap are all disabled');

	// Disabling hover preview restores native title on attach
	kernel.prefs.set('workspace.enableHoverPreview', false);
	const chipOff = makeFakeElement('div');
	chipOff.defaultView = win;
	hover.attach(chipOff, tab, tab.title);
	assert.equal(chipOff.getAttribute('title'), '2D Material Photophysics', 'Native title must be restored when hover preview is disabled');
	kernel.shutdown();
});

test('v0.9.2 updatePreferenceDependencies cascades disabled states across new granular workspace & lookup subgroups', () => {
	const mem = createMemoryPrefs({
		'modules.workspace.enable': true,
		'workspace.enableHorizontalGroups': true,
		'workspace.horizontalTabCompactMode': 'compact',
		'workspace.enableSessions': true,
		'workspace.enableRollingSnapshots': false,
		'workspace.enableReadingTracker': false,
		'workspace.enableHoverPreview': false,
		'workspace.enableReaderAttachmentSwitcher': false,
		'workspace.enableSpotlight': false,
	});
	const kernel = new PluginKernel({ prefAdapter: mem.adapter });
	const ids = [
		'zbf-sub-hcompact-threshold',
		'zbf-sub-rolling-interval',
		'zbf-sub-reading-tracker-cfg',
		'zbf-sub-hover-cfg',
		'zbf-sub-reader-switcher-cfg',
		'zbf-sub-spotlight-cfg',
	];
	const map = new Map(ids.map((id) => [id, makeFakeElement('div')]));
	const fakeDoc = {
		getElementById: (id) => map.get(id) || null,
		querySelectorAll: () => [],
	};
	updatePreferenceDependencies(fakeDoc, kernel.prefs);
	for (const id of ids) {
		assert.equal(map.get(id).getAttribute('data-disabled'), 'true', `Expected ${id} to be disabled`);
	}

	kernel.prefs.set('workspace.horizontalTabCompactMode', 'auto');
	kernel.prefs.set('workspace.enableRollingSnapshots', true);
	kernel.prefs.set('workspace.enableReadingTracker', true);
	kernel.prefs.set('workspace.enableHoverPreview', true);
	kernel.prefs.set('workspace.enableReaderAttachmentSwitcher', true);
	kernel.prefs.set('workspace.enableSpotlight', true);
	updatePreferenceDependencies(fakeDoc, kernel.prefs);
	for (const id of ids) {
		assert.equal(map.get(id).getAttribute('data-disabled'), 'false', `Expected ${id} to re-enable when parent activates`);
	}
	kernel.shutdown();
});
