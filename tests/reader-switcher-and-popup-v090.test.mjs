import test from 'node:test';
import assert from 'node:assert/strict';
import { PluginKernel } from '../src/kernel/plugin-kernel.ts';
import { WorkspaceStateStore } from '../src/domains/workspace/store/state-store.ts';
import { ReaderAttachmentSwitcher } from '../src/domains/workspace/reader/reader-attachment-switcher.ts';
import {
	openSiblingAttachmentMenu,
	READER_ATT_BACKDROP_ID,
	READER_ATT_MENU_ID,
	resolveSiblingAttachments,
} from '../src/domains/workspace/reader/reader-attachment-switcher-ui.ts';
import {
	clearSelectionPopupDoc,
	decorateSelectionPopupDoc,
	ReaderPopupLabelsController,
} from '../src/domains/visual-notes/reader/annotation-popup-labels.ts';
import { parseColorSemantics } from '../src/services/annotation-utils.ts';

function makeRichReaderDoc({ innerWidth = 1024, rectLeft = 200, rectRight = 290, menuWidth = 260 } = {}) {
	const listeners = new Map();
	const makeEl = (tag) => {
		const attrs = new Map();
		const elListeners = new Map();
		const classSet = new Set();
		const el = {
			tagName: tag.toUpperCase(),
			id: '',
			className: '',
			type: '',
			hidden: false,
			textContent: '',
			title: '',
			style: {},
			children: [],
			parentNode: null,
			get parentElement() { return this.parentNode; },
			get childElementCount() { return this.children.length; },
			get offsetWidth() { return this.id === READER_ATT_MENU_ID ? menuWidth : 90; },
			isConnected: true,
			defaultView: null,
			classList: {
				contains: (c) => classSet.has(c) || el.className.split(/\s+/).includes(c),
				add: (c) => classSet.add(c),
				remove: (c) => classSet.delete(c),
			},
			setAttribute(k, v) {
				attrs.set(k, String(v));
				if (k === 'id') this.id = String(v);
				if (k === 'class') this.className = String(v);
			},
			getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
			removeAttribute(k) { attrs.delete(k); },
			hasAttribute(k) { return attrs.has(k); },
			appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
			append(...args) { for (const c of args) this.appendChild(c); },
			remove() {
				if (this.parentNode?.children) {
					const idx = this.parentNode.children.indexOf(this);
					if (idx >= 0) this.parentNode.children.splice(idx, 1);
				}
				this.parentNode = null;
				this.isConnected = false;
			},
			addEventListener(type, fn) {
				if (!elListeners.has(type)) elListeners.set(type, []);
				elListeners.get(type).push(fn);
			},
			removeEventListener(type, fn) {
				const arr = elListeners.get(type);
				if (!arr) return;
				const idx = arr.indexOf(fn);
				if (idx >= 0) arr.splice(idx, 1);
			},
			dispatch(type, ev = {}) {
				for (const fn of [...(elListeners.get(type) || [])]) {
					fn({ preventDefault() {}, stopPropagation() {}, target: this, ...ev });
				}
			},
			contains(node) {
				if (node === this) return true;
				return this.children.some((c) => c.contains?.(node));
			},
			getBoundingClientRect: () => ({ left: rectLeft, bottom: 40, right: rectRight }),
			querySelectorAll: (sel) => findAll(el, (n) => matchesSel(n, sel)),
			querySelector: (sel) => findAll(el, (n) => matchesSel(n, sel))[0] || null,
		};
		return el;
	};
	const matchesSel = (node, sel) => {
		if (sel.startsWith('.')) {
			const cls = sel.slice(1);
			return node.className.split(/\s+/).includes(cls) || node.classList.contains(cls);
		}
		if (sel.startsWith('#')) return node.id === sel.slice(1);
		return false;
	};
	const findAll = (root, pred, acc = []) => {
		if (!root) return acc;
		if (pred(root)) acc.push(root);
		for (const c of root.children || []) findAll(c, pred, acc);
		return acc;
	};
	const head = makeEl('head');
	const body = makeEl('body');
	const customSections = makeEl('div');
	customSections.className = 'custom-sections';
	body.appendChild(customSections);
	const doc = {
		head,
		body,
		documentElement: body,
		defaultView: { closed: false, innerWidth, addEventListener() {}, removeEventListener() {} },
		createElementNS: (_ns, tag) => makeEl(tag),
		getElementById: (id) => findAll(head, (n) => n.id === id)[0] || findAll(body, (n) => n.id === id)[0] || null,
		querySelector: (sel) => {
			if (sel === '.toolbar .custom-sections') return customSections;
			return findAll(body, (n) => matchesSel(n, sel))[0] || null;
		},
		querySelectorAll: (sel) => findAll(body, (n) => matchesSel(n, sel)),
		addEventListener(type, fn) { listeners.set(type, fn); },
		removeEventListener(type) { listeners.delete(type); },
	};
	head.defaultView = doc.defaultView;
	body.defaultView = doc.defaultView;
	return { doc, body, customSections };
}

test('v0.9.0 ReaderAttachmentSwitcher strips HTML title markup, hides empty .section wrapper, and closes via backdrop', async () => {
	const prevZotero = globalThis.Zotero;
	try {
		const { doc, customSections } = makeRichReaderDoc({ innerWidth: 900, rectLeft: 760, rectRight: 860, menuWidth: 260 });
		const attachments = [21];
		const items = new Map([
			[20, { id: 20, getAttachments: () => attachments }],
			[21, { id: 21, parentItemID: 20, attachmentContentType: 'application/pdf', attachmentFilename: 'res2.pdf', getField: () => '2D ReS<sub>2</sub> Photodetector' }],
			[22, { id: 22, parentItemID: 20, attachmentContentType: 'text/html', attachmentFilename: 'snap.html', getField: () => 'Snapshot' }],
		]);
		const openedCalls = [];
		const closedTabs = [];
		const tabs = [{ id: 'tab-21', type: 'reader', data: { itemID: 21 } }];
		const mainWin = {
			document: { addEventListener() {}, removeEventListener() {} },
			Zotero_Tabs: { _tabs: tabs, selectedID: 'tab-21', select() {}, close: (id) => closedTabs.push(id) },
		};
		globalThis.Zotero = {
			locale: 'zh-CN',
			Items: { get: (id) => items.get(Number(id)) },
			Reader: {
				_readers: [],
				registerEventListener: () => {},
				unregisterEventListener: () => {},
				open: async (id, _loc, opts) => { openedCalls.push({ id, opts }); },
			},
			Notifier: { registerObserver: () => 1, unregisterObserver: () => {} },
			Prefs: { get: () => undefined, set: () => {}, clear: () => {}, registerObserver: () => Symbol('o'), unregisterObserver: () => {} },
			getMainWindows: () => [mainWin],
			getMainWindow: () => mainWin,
		};

		const resolvedOne = resolveSiblingAttachments(21);
		assert.equal(resolvedOne.items[0].title, '2D ReS2 Photodetector', 'should strip inline <sub> HTML tags from attachment titles');

		const kernel = new PluginKernel({ id: 'bridgeflow@groele', version: '0.9.0', rootURI: 'chrome://bf/' });
		kernel.notifier.start();
		const store = new WorkspaceStateStore(kernel.prefs);
		const switcher = new ReaderAttachmentSwitcher(kernel, store);
		switcher.start();

		const reader = { itemID: 21, tabID: 'tab-21', _iframeWindow: { document: doc } };
		// Simulate React CustomSections wrapping appended element in <div class="section">
		switcher.mountReaderToolbar(reader, doc, (el) => {
			const sec = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
			sec.className = 'section';
			sec.appendChild(el);
			customSections.appendChild(sec);
		});
		const sec = customSections.children[0];
		assert.equal(sec.hidden, true, 'single-attachment .section wrapper must stay hidden so toolbar has zero gap');

		attachments.push(22);
		switcher.syncPref();
		assert.equal(sec.hidden, false, '.section wrapper becomes visible when 2nd sibling exists');

		const btn = doc.querySelector('.zbf-reader-att-btn');
		btn.dispatch('click');
		const backdrop = doc.getElementById(READER_ATT_BACKDROP_ID);
		const menu = doc.getElementById(READER_ATT_MENU_ID);
		assert.ok(backdrop, 'opening menu must mount transparent backdrop to catch clicks onto inner PDF iframe');
		assert.ok(menu, 'menu should be mounted');
		const leftNum = parseInt(menu.style.left, 10);
		assert.ok(leftNum <= 900 - 260 - 8 && leftNum >= 8, `menu left (${leftNum}) should right-align away from viewport edge`);

		// Clicking backdrop closes menu and cleans backdrop
		backdrop.dispatch('pointerdown');
		assert.equal(doc.getElementById(READER_ATT_MENU_ID), null);
		assert.equal(doc.getElementById(READER_ATT_BACKDROP_ID), null);

		// Middle-click (auxclick button=1) opens sibling in background without closing current tab
		btn.dispatch('click');
		const rows = doc.querySelectorAll('.zbf-reader-att-item');
		rows[1].dispatch('auxclick', { button: 1 });
		await new Promise((r) => setTimeout(r, 20));
		assert.equal(openedCalls.length, 1);
		assert.equal(openedCalls[0].opts.openInBackground, true);
		assert.deepEqual(closedTabs, []);

		// Alt+click switches and closes current tab
		btn.dispatch('click');
		doc.querySelectorAll('.zbf-reader-att-item')[1].dispatch('click', { altKey: true });
		await new Promise((r) => setTimeout(r, 20));
		assert.equal(openedCalls.length, 2);
		assert.equal(openedCalls[1].opts.openInBackground, false);
		assert.deepEqual(closedTabs, ['tab-21']);

		switcher.stop();
		kernel.notifier.stop();
	} finally {
		globalThis.Zotero = prevZotero;
	}
});

test('v0.9.0 ReaderPopupLabelsController hides foreign color-button labels to prevent overlap and cleans up cleanly', () => {
	const makePopupBtn = (hex) => {
		const attrs = new Map();
		const children = [];
		const path = { getAttribute: (k) => (k === 'fill' ? hex : null) };
		const foreignSpan = { className: 'other-plugin-label', textContent: 'Method', remove() {} };
		const svg = { tagName: 'svg', querySelector: () => path };
		children.push(svg, foreignSpan);
		return {
			className: 'toolbar-button color-button',
			children,
			style: {},
			parentElement: null,
			querySelector(sel) {
				if (sel.includes('fill')) return path;
				if (sel === '.zbf-popup-color-name') return children.find((c) => c.className === 'zbf-popup-color-name') || null;
				return null;
			},
			appendChild(node) { children.push(node); },
			setAttribute(k, v) { attrs.set(k, String(v)); },
			getAttribute(k) { return attrs.get(k) ?? null; },
			removeAttribute(k) { attrs.delete(k); },
		};
	};
	const btnRed = makePopupBtn('#ff6666');
	const btnBlue = makePopupBtn('#2ea8e5');
	const group = { children: [btnRed, btnBlue] };
	btnRed.parentElement = group;
	btnBlue.parentElement = group;
	const headChildren = [];
	const readerDoc = {
		head: { appendChild(el) { headChildren.push(el); } },
		body: { appendChild() {} },
		getElementById: (id) => headChildren.find((n) => n.id === id) || null,
		createElementNS: (_ns, tag) => ({
			tagName: tag, id: '', className: '', textContent: '',
			remove() { const i = headChildren.indexOf(this); if (i >= 0) headChildren.splice(i, 1); },
		}),
		querySelectorAll: (sel) => {
			if (sel.includes('.color-button')) return [btnRed, btnBlue];
			if (sel === '.zbf-popup-color-name') return [btnRed, btnBlue].flatMap((b) => b.children.filter((c) => c.className === 'zbf-popup-color-name'));
			return [];
		},
	};
	const kernel = new PluginKernel({ id: 'bridgeflow@groele', version: '0.9.0', rootURI: 'chrome://bf/' });
	const ctrl = new ReaderPopupLabelsController(kernel);
	ctrl.start();
	ctrl.attachReaderDoc(readerDoc);

	const styleEl = readerDoc.getElementById('zbf-reader-color-labels-style');
	assert.ok(styleEl);
	assert.ok(styleEl.textContent.includes('> :not(svg):not(.zbf-popup-color-name)'), 'must suppress foreign label nodes in color-button');
	assert.equal(decorateSelectionPopupDoc(readerDoc, parseColorSemantics('')), 2);
	assert.equal(btnRed.querySelector('.zbf-popup-color-name')?.textContent, 'Method');
	assert.equal(btnBlue.querySelector('.zbf-popup-color-name')?.textContent, 'Finding');

	clearSelectionPopupDoc(readerDoc);
	assert.equal(readerDoc.getElementById('zbf-reader-color-labels-style'), null);
	ctrl.stop();
});
