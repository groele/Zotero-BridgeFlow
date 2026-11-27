import test from 'node:test';
import assert from 'node:assert/strict';

import { WorkspaceTabContextMenu } from '../src/domains/workspace/tabs/tab-context-menu.ts';
import { resolveNativeTabFromElement, WorkspaceWindowUI } from '../src/domains/workspace/workspace-ui.ts';

function makeMockPrefs(overrides = {}) {
	const map = new Map(Object.entries({
		'workspace.enablePinnedTabs': true,
		'workspace.enableTabRemarks': true,
		'workspace.enableTabSleep': true,
		'workspace.enableCopyReference': true,
		'workspace.enableShowInFilesystem': true,
		'workspace.enableReloadTab': true,
		'workspace.enableVirtualMembers': true,
		'workspace.enableSessions': true,
		'workspace.enableAnnotationMatrix': true,
		'modules.wordCite.enable': true,
		'wordCite.tabContextMenu.enable': true,
		...overrides,
	}));
	return {
		get(key) {
			return map.get(key);
		},
	};
}

function makeMockElement(tag, doc) {
	const attrs = new Map();
	const listeners = new Map();
	const el = {
		tagName: tag.toUpperCase(),
		id: '',
		className: '',
		type: '',
		hidden: false,
		disabled: false,
		textContent: '',
		title: '',
		style: {},
		children: [],
		parentNode: null,
		isConnected: true,
		setAttribute(k, v) {
			attrs.set(k, String(v));
			if (k === 'id') el.id = String(v);
		},
		getAttribute(k) {
			return attrs.has(k) ? attrs.get(k) : null;
		},
		append(...nodes) {
			for (const n of nodes) {
				if (n && typeof n === 'object') {
					n.parentNode = el;
					el.children.push(n);
				}
			}
		},
		appendChild(n) {
			n.parentNode = el;
			el.children.push(n);
			return n;
		},
		remove() {
			el.isConnected = false;
			if (el.parentNode) {
				el.parentNode.children = el.parentNode.children.filter((c) => c !== el);
				el.parentNode = null;
			}
		},
		addEventListener(type, fn) {
			if (!listeners.has(type)) listeners.set(type, []);
			listeners.get(type).push(fn);
		},
		dispatchEvent(ev) {
			const list = listeners.get(ev.type) || [];
			for (const fn of list) fn(ev);
		},
		contains(node) {
			if (node === el) return true;
			return el.children.some((c) => c.contains?.(node));
		},
		closest() {
			return null;
		},
		querySelector() {
			return null;
		},
		getBoundingClientRect() {
			return { left: 10, top: 10, right: 120, bottom: 38, width: 110, height: 28 };
		},
		offsetWidth: 232,
		offsetHeight: 180,
		doc,
	};
	return el;
}

test('WorkspaceTabContextMenu uses native XUL menupopup via mainPopupSet and cleans up on popuphidden', () => {
	let popupSet = null;
	const docListeners = new Map();
	const doc = {
		documentElement: null,
		defaultView: null,
		createXULElement(tag) {
			const el = makeMockElement(tag, doc);
			if (tag === 'menupopup') {
				el.openAtCalls = [];
				el.hideCalls = 0;
				el.openPopupAtScreen = (x, y, isContext) => {
					el.openAtCalls.push({ x, y, isContext });
				};
				el.hidePopup = () => {
					el.hideCalls += 1;
				};
			}
			return el;
		},
		createElementNS(_ns, tag) {
			return makeMockElement(tag, doc);
		},
		getElementById(id) {
			return id === 'mainPopupSet' ? popupSet : null;
		},
		querySelector() {
			return null;
		},
		addEventListener(type, fn) {
			docListeners.set(type, fn);
		},
		removeEventListener(type) {
			docListeners.delete(type);
		},
	};
	popupSet = makeMockElement('popupset', doc);
	doc.documentElement = makeMockElement('window', doc);
	const win = {
		document: doc,
		innerWidth: 1280,
		innerHeight: 800,
		setTimeout(fn) {
			fn();
			return 1;
		},
		addEventListener() {},
		removeEventListener() {},
	};
	doc.defaultView = win;

	const store = {
		state: { groups: [{ id: 'g1', name: '综述', color: '#3977d5' }], remarkModes: {}, collapsed: [] },
		setPinned() {},
	};
	const tabs = {
		buildTrackedTabs: () => [],
	};
	const menu = new WorkspaceTabContextMenu(win, makeMockPrefs(), store, tabs, () => {});
	const anchor = makeMockElement('button', doc);
	const tab = {
		key: '1:ABC',
		tabID: 'tab-1',
		itemID: 101,
		parentItemID: 100,
		title: 'Paper Title',
		shortTitle: 'Paper',
		filename: 'paper.pdf',
		groupId: null,
		pinned: false,
		sleeping: false,
		virtual: false,
		remark: '',
		lastViewedAt: 0,
		creatorYear: '',
		source: '',
		collection: '',
	};

	menu.openTabMenu(anchor, tab, { screenX: 320, screenY: 140, clientX: 300, clientY: 100 });

	assert.equal(popupSet.children.length, 1);
	const popup = popupSet.children[0];
	assert.equal(popup.tagName, 'MENUPOPUP');
	assert.deepEqual(popup.openAtCalls, [{ x: 320, y: 140, isContext: true }]);
	assert.ok(popup.children.some((c) => c.tagName === 'MENUITEM' && c.getAttribute('label') === '固定标签（防误关）'));
	assert.ok(popup.children.some((c) => c.tagName === 'MENU' && c.getAttribute('label') === '加入分组'));
	assert.ok(popup.children.some((c) => c.tagName === 'MENUITEM' && c.getAttribute('label') === '插入引文到 Word 光标处'));

	popup.dispatchEvent({ type: 'popuphidden', target: popup });
	assert.equal(popupSet.children.length, 0);
});

test('WorkspaceTabContextMenu falls back to HTML popup when mainPopupSet is absent and closes on Escape', () => {
	const docListeners = new Map();
	const winListeners = new Map();
	const doc = {
		documentElement: null,
		defaultView: null,
		createElementNS(_ns, tag) {
			return makeMockElement(tag, doc);
		},
		getElementById() {
			return null;
		},
		querySelector() {
			return null;
		},
		addEventListener(type, fn) {
			docListeners.set(type, fn);
		},
		removeEventListener(type) {
			docListeners.delete(type);
		},
	};
	doc.documentElement = makeMockElement('div', doc);
	const win = {
		document: doc,
		innerWidth: 1280,
		innerHeight: 800,
		setTimeout(fn) {
			fn();
			return 1;
		},
		addEventListener(type, fn) {
			winListeners.set(type, fn);
		},
		removeEventListener(type) {
			winListeners.delete(type);
		},
	};
	doc.defaultView = win;

	const store = { state: { groups: [], remarkModes: {}, collapsed: [] } };
	const tabs = { buildTrackedTabs: () => [] };
	const menu = new WorkspaceTabContextMenu(win, makeMockPrefs(), store, tabs, () => {});
	const anchor = makeMockElement('button', doc);

	menu.openAddGroupMenu(anchor, { clientX: 200, clientY: 60 });
	assert.equal(doc.documentElement.children.length, 1);
	const pop = doc.documentElement.children[0];
	assert.equal(pop.className, 'zbf-popup-menu');

	const keydown = docListeners.get('keydown');
	assert.equal(typeof keydown, 'function');
	keydown({ key: 'Escape', preventDefault() {} });
	assert.equal(doc.documentElement.children.length, 0);
});

test('resolveNativeTabFromElement matches Zotero native tab elements by attr, id, index, and title', () => {
	const tracked = [
		{ key: 'lib', tabID: 'zotero-pane', itemID: 0, title: '我的文库', shortTitle: '我的文库', filename: '', virtual: false },
		{ key: '1:A', tabID: 'reader-a', itemID: 11, title: 'Symmetry breaking induced', shortTitle: 'Symmetry', filename: 'a.pdf', virtual: false },
		{ key: '1:B', tabID: 'reader-b', itemID: 12, title: 'Dynamic control of hetero', shortTitle: 'Dynamic', filename: 'b.pdf', virtual: false },
	];

	const tabA = {
		id: 'tab-reader-a',
		getAttribute: (k) => (k === 'data-tab-id' ? 'reader-a' : null),
		closest: () => null,
		querySelector: () => null,
	};
	const tabB = {
		id: 'tab-reader-b',
		getAttribute: () => null,
		closest: () => null,
		querySelector: () => null,
	};
	const tabByIndex = {
		id: '',
		getAttribute: () => null,
		closest: () => null,
		querySelector: () => null,
	};

	const win = {
		Zotero_Tabs: {
			_tabs: [
				{ id: 'zotero-pane', pinned: false },
				{ id: 'reader-a', pinned: false },
				{ id: 'reader-b', pinned: false },
			],
		},
		document: {
			querySelectorAll: () => [{}, {}, tabByIndex],
		},
	};

	assert.equal(resolveNativeTabFromElement(win, tabA, tracked)?.tabID, 'reader-a');
	assert.equal(resolveNativeTabFromElement(win, tabB, tracked)?.tabID, 'reader-b');
	assert.equal(resolveNativeTabFromElement(win, tabByIndex, tracked)?.tabID, 'reader-b');
});

test('WorkspaceWindowUI binds native tab contextmenu in capture phase and skips interception when top horizontal bar is disabled', () => {
	let capturedListener = null;
	let capturedOpts = null;
	const tabBarEl = {
		addEventListener(type, fn, opts) {
			if (type === 'contextmenu') {
				capturedListener = fn;
				capturedOpts = opts;
			}
		},
		toggleAttribute() {},
		removeAttribute() {},
	};
	const doc = {
		head: { appendChild() {} },
		documentElement: { appendChild() {} },
		getElementById: (id) => (id === 'tab-bar-container' ? tabBarEl : null),
		createElementNS: (_ns, tag) => makeMockElement(tag, doc),
		addEventListener() {},
		removeEventListener() {},
		querySelector: () => null,
		querySelectorAll: () => [],
	};
	const prefValues = {
		'workspace.enableHorizontalGroups': false,
		'workspace.enableTabContextMenu': true,
		'workspace.enableVerticalSidebar': false,
		'workspace.enableSpotlight': false,
	};
	const prefs = { get: (k) => prefValues[k] };
	const store = {
		state: { groups: [], remarkModes: {}, collapsed: [], pinned: [], sleeping: [], virtualMembers: {}, selectedKeys: [] },
		isCollapsed: () => false,
	};
	const trackedTab = { key: '1:A', tabID: 'reader-a', itemID: 11, title: 'Paper A', shortTitle: 'Paper A', filename: 'a.pdf', virtual: false };
	const tabs = { buildTrackedTabs: () => [trackedTab] };
	const win = {
		document: doc,
		AbortController: globalThis.AbortController,
		addEventListener() {},
		removeEventListener() {},
		setTimeout: () => 1,
		clearTimeout() {},
		Zotero_Tabs: { _tabs: [{ id: 'reader-a', type: 'reader', data: { itemID: 11 } }] },
	};
	doc.defaultView = win;

	const ui = new WorkspaceWindowUI(win, prefs, store, tabs, { query: () => [] });
	let openedCount = 0;
	ui.tabMenu.openTabMenu = () => { openedCount += 1; };

	assert.equal(typeof capturedListener, 'function');
	assert.equal(capturedOpts?.capture, true, 'must intercept in capture phase before native Zotero popup opens');

	const nativeTabEl = {
		id: 'tab-reader-a',
		getAttribute: (k) => (k === 'data-tab-id' ? 'reader-a' : null),
		closest: (sel) => (sel.includes('.tabs-wrapper .tab') ? nativeTabEl : null),
	};
	const makeContextEvent = () => {
		const calls = { prevent: 0, stop: 0, stopImm: 0 };
		return {
			ev: {
				target: nativeTabEl,
				preventDefault() { calls.prevent += 1; },
				stopPropagation() { calls.stop += 1; },
				stopImmediatePropagation() { calls.stopImm += 1; },
			},
			calls,
		};
	};

	// 1. Top horizontal bar disabled -> do NOT intercept native tab contextmenu
	const first = makeContextEvent();
	capturedListener(first.ev);
	assert.equal(openedCount, 0);
	assert.deepEqual(first.calls, { prevent: 0, stop: 0, stopImm: 0 });

	// 2. Top horizontal bar enabled -> suppress native menu completely and open BridgeFlow menu once
	prefValues['workspace.enableHorizontalGroups'] = true;
	const second = makeContextEvent();
	capturedListener(second.ev);
	assert.equal(openedCount, 1);
	assert.deepEqual(second.calls, { prevent: 1, stop: 1, stopImm: 1 });

	ui.destroy();
});
