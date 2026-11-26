import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { PluginKernel } from '../src/kernel/plugin-kernel.ts';

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function makePrefsDom() {
	const makeEl = (id = '', attrsInit = {}) => {
		const attrs = new Map(Object.entries(attrsInit));
		const listeners = new Map();
		const children = [];
		const classes = new Set();
		const el = {
			id,
			type: attrs.get('type') || '',
			value: attrs.get('value') || '',
			checked: false,
			disabled: false,
			hidden: false,
			tabIndex: 0,
			textContent: '',
			title: '',
			placeholder: '',
			isConnected: true,
			children,
			get childElementCount() { return children.length; },
			classList: {
				add: (c) => classes.add(c),
				remove: (c) => classes.delete(c),
				toggle: (c, force) => {
					const next = force === undefined ? !classes.has(c) : Boolean(force);
					if (next) classes.add(c);
					else classes.delete(c);
					return next;
				},
				contains: (c) => classes.has(c),
			},
			style: { setProperty() {} },
			setAttribute(k, v) { attrs.set(k, String(v)); },
			getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
			removeAttribute(k) { attrs.delete(k); },
			hasAttribute(k) { return attrs.has(k); },
			append(...nodes) { children.push(...nodes); },
			appendChild(node) { children.push(node); return node; },
			querySelectorAll(sel) {
				if (sel.startsWith('#')) return [];
				if (sel === 'input[data-zbf-color]') return children.filter((c) => c.hasAttribute?.('data-zbf-color'));
				if (sel === '.zbf-color-label-item') return children;
				if (sel === 'checkbox[preference]') return [chkWorkspace];
				return [];
			},
			querySelector() { return null; },
			addEventListener(type, fn) {
				if (!listeners.has(type)) listeners.set(type, []);
				listeners.get(type).push(fn);
			},
			dispatch(type) {
				for (const fn of listeners.get(type) || []) fn({ preventDefault() {}, stopPropagation() {}, target: el });
			},
		};
		return el;
	};

	const pane = makeEl('zotero-prefpane-zotero-bridgeflow');
	const badge = makeEl('zbf-version-badge');
	const status = makeEl('zbf-prefs-status');
	const colorGrid = makeEl('zbf-ann-color-grid');
	const clearCoversBtn = makeEl('zbf-clear-covers-cache');
	const chkWorkspace = makeEl('', { preference: 'extensions.zotero.bridgeflow.modules.workspace.enable' });
	const byId = new Map([
		['zotero-prefpane-zotero-bridgeflow', pane],
		['zbf-version-badge', badge],
		['zbf-prefs-status', status],
		['zbf-ann-color-grid', colorGrid],
		['zbf-clear-covers-cache', clearCoversBtn],
	]);
	const doc = {
		defaultView: null,
		documentElement: pane,
		getElementById: (id) => byId.get(id) || null,
		querySelector: () => null,
		querySelectorAll: () => [],
		addEventListener() {},
		createElementNS: (_ns, tag) => makeEl('', { tag }),
	};
	const win = {
		document: doc,
		closed: false,
		confirm: () => true,
		addEventListener() {},
		setTimeout(fn) { fn(); return 1; },
	};
	doc.defaultView = win;
	return { doc, win, pane, badge, chkWorkspace, clearCoversBtn };
}

test('lossless build keeps unmangled identifiers, compacts inline CSS, and deduplicates prefs bundle', () => {
	const mainJs = fs.readFileSync(path.join(root, 'zoterobridgeflow.js'), 'utf8');
	const prefsJs = fs.readFileSync(path.join(root, 'zoterobridgeflow_prefs.js'), 'utf8');

	// Unmangled identifiers & header preserved for stack trace / audit readability
	assert.match(mainJs, /\bBridgeFlowApp=class\b/, 'Expected unmangled BridgeFlowApp class');
	assert.match(mainJs, /\bWorkspaceDomainModule=class\b/, 'Expected unmangled WorkspaceDomainModule');
	assert.match(mainJs, /\bReaderAttachmentSwitcher=class\b/, 'Expected unmangled ReaderAttachmentSwitcher');

	// Inline CSS compacted without bloated multiline indentation
	assert.ok(mainJs.includes('#zbf-inline{display:flex;'), 'Expected minified inline CSS rule in main bundle');
	assert.ok(mainJs.includes('.zbf-reader-att-btn{display:inline-flex;'), 'Expected minified reader switcher CSS in main bundle');
	assert.ok(!mainJs.includes('#zbf-inline {\n  display: flex;'), 'Expected multiline indentation removed from inline CSS');

	// Prefs bundle no longer embeds duplicated kernel/cover-queue runtime modules
	assert.ok(prefsJs.length < 45000, `Expected deduplicated prefs bundle < 45KB, got ${prefsJs.length} B`);
	assert.ok(!prefsJs.includes('requestGalleryPdfCover'), 'Prefs bundle must not duplicate pdf-cover-service/queue');
	assert.ok(!prefsJs.includes('cacheMaxEntries'), 'Prefs bundle must not duplicate full PREF_SCHEMA table');

	// Execute actual bundled zoterobridgeflow_prefs.js against PluginKernel + mocked ServiceContainer
	const mem = createMemoryPrefs({ 'modules.workspace.enable': true });
	const kernel = new PluginKernel({ prefAdapter: mem.adapter });
	kernel.info.rootURI = 'resource://zbf-test/';
	kernel.createScopedPrefs = () => kernel.prefs;
	let coverCleared = 0;

	const { doc, win, badge, chkWorkspace, clearCoversBtn } = makePrefsDom();
	const sandbox = {
		console,
		Promise,
		Set,
		Map,
		Date,
		Math,
		JSON,
		Object,
		Array,
		String,
		Number,
		Boolean,
		document: doc,
		window: win,
		Zotero: {
			zoterobridgeflow: {
				kernel,
				services: {
					clearPdfCoverCache: async () => { coverCleared++; return true; },
				},
			},
		},
	};
	sandbox.globalThis = sandbox;
	win.Zotero = sandbox.Zotero;

	vm.runInNewContext(prefsJs, sandbox, { filename: 'zoterobridgeflow_prefs.js' });
	assert.ok(sandbox.BridgeFlowPreferences, 'Expected BridgeFlowPreferences exposed on globalThis');
	assert.equal(chkWorkspace.checked, true);
	assert.match(badge.textContent, /^v\d+\.\d+\.\d+$/);

	clearCoversBtn.dispatch('click');
	assert.equal(coverCleared, 1, 'Expected prefs action to delegate clearPdfCoverCache through shared services');
	kernel.shutdown();
});
