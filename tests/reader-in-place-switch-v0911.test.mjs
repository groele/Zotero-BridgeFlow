import test from 'node:test';
import assert from 'node:assert/strict';
import { showAttachmentInReaderTab } from '../src/services/reader-tab-navigation.ts';
import { PluginKernel } from '../src/kernel/plugin-kernel.ts';
import { WorkspaceStateStore } from '../src/domains/workspace/store/state-store.ts';
import { ReaderAttachmentSwitcher } from '../src/domains/workspace/reader/reader-attachment-switcher.ts';

function makeDomNode(tag, id = '', className = '') {
	const attrs = new Map();
	if (id) attrs.set('id', id);
	if (className) attrs.set('class', className);
	const node = {
		tagName: tag.toUpperCase(),
		localName: tag.toLowerCase(),
		id,
		className,
		textContent: '',
		children: [],
		parentNode: null,
		isConnected: true,
		setAttribute(k, v) {
			attrs.set(k, String(v));
			if (k === 'id') this.id = String(v);
			if (k === 'class') this.className = String(v);
		},
		getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
		removeAttribute(k) { attrs.delete(k); },
		appendChild(child) {
			child.parentNode = this;
			child.isConnected = true;
			this.children.push(child);
			return child;
		},
		remove() {
			if (this.parentNode?.children) {
				const idx = this.parentNode.children.indexOf(this);
				if (idx >= 0) this.parentNode.children.splice(idx, 1);
			}
			this.parentNode = null;
			this.isConnected = false;
		},
		querySelectorAll(sel) {
			const cls = sel.startsWith('.') ? sel.slice(1) : '';
			const out = [];
			const walk = (n) => {
				for (const c of n.children || []) {
					if (!cls || c.className.split(/\s+/).includes(cls)) out.push(c);
					walk(c);
				}
			};
			walk(this);
			return out;
		},
	};
	return node;
}

function createHostHarness() {
	const root = makeDomNode('window', 'main-window');
	const tabContainer = makeDomNode('tab-content', 'tab-1');
	root.appendChild(tabContainer);

	const oldIframe = makeDomNode('browser', '', 'reader');
	const oldPopupset = makeDomNode('popupset');
	tabContainer.appendChild(oldIframe);
	tabContainer.appendChild(oldPopupset);

	const events = [];
	const items = new Map([
		[100, { id: 100, getAttachments: () => [101, 102] }],
		[101, { id: 101, parentID: 100, parentItemID: 100, attachmentContentType: 'application/pdf', attachmentFilename: 'main.pdf', getField: () => 'Main Paper' }],
		[102, { id: 102, parentID: 100, parentItemID: 100, attachmentContentType: 'application/pdf', attachmentFilename: 'si.pdf', getField: () => 'Supporting Info' }],
		[200, { id: 200, getAttachments: () => [201] }],
		[201, { id: 201, parentID: 200, parentItemID: 200, attachmentContentType: 'application/pdf', attachmentFilename: 'other.pdf', getField: () => 'Other Paper' }],
	]);

	let tabCloseCalls = 0;
	let oldReaderClosed = 0;
	let oldReaderUninit = 0;
	const oldReader = {
		itemID: 101,
		tabID: 'tab-1',
		_iframe: oldIframe,
		_popupset: oldPopupset,
		_iframeWindow: {},
		_internalReader: { setContextPaneOpen() { throw new Error('dead object'); } },
		_isTabClosed: false,
		_readAloudPlaying: true,
		pausedReadAloud: false,
		toggleReadAloudPaused(paused) { this.pausedReadAloud = paused; },
		_handleTabClose() { this._isTabClosed = true; oldReaderClosed++; },
		uninit() { oldReaderUninit++; },
		setBottomPlaceholderHeight() { throw new Error('dead object'); },
		setContextPaneOpen() { throw new Error('dead object'); },
		_updateLayout() { throw new Error('dead object'); },
	};

	const tabRow = {
		id: 'tab-1',
		type: 'reader',
		title: 'Main Paper',
		data: { itemID: 101, icon: 'attachment-pdf', secondViewState: { page: 2 } },
		audioStatus: { active: true, paused: false },
		onClose() { tabCloseCalls++; oldReader._handleTabClose(); },
	};
	const nativeTabs = [tabRow];

	const itemContexts = new Map([
		['tab-1', { tabID: 'tab-1', parentID: 100, item: { id: 100 } }],
	]);
	const contextOps = [];
	const doc = {
		documentElement: root,
		createElementNS: (_ns, tag) => makeDomNode(tag),
		getElementById: (id) => (id === 'tab-1' ? tabContainer : null),
	};
	const owner = {
		document: doc,
		Zotero_Tabs: {
			_tabs: nativeTabs,
			selectedID: 'tab-1',
			add() { events.push('tabs.add'); throw new Error('tabs.add MUST NOT be called during in-place switch'); },
			close(id) { events.push(`tabs.close:${id}`); },
			select(id) { events.push(`tabs.select:${id}`); },
			rename: async (id) => {
				events.push(`tabs.rename:${id}`);
				const row = nativeTabs.find((t) => t.id === id);
				if (row) row.title = items.get(row.data.itemID)?.getField?.('title') || '';
			},
			_update() { events.push('tabs._update'); },
		},
		ZoteroContextPane: {
			update() { events.push('contextPane.update'); },
			context: {
				_getItemContext: (id) => itemContexts.get(id) || null,
				_removeItemContext: (id) => { contextOps.push(`remove:${id}`); itemContexts.delete(id); },
				_addItemContext: async (id, itemID) => {
					contextOps.push(`add:${id}:${itemID}`);
					const it = items.get(itemID);
					itemContexts.set(id, { tabID: id, parentID: it.parentID, item: { id: it.parentID || itemID } });
				},
			},
		},
	};
	oldReader._window = owner;

	const readers = [oldReader];
	let nextInitController = null;
	const createdReaders = [];

	const zotero = {
		Items: { get: (id) => items.get(Number(id)) || null },
		Session: { debounceSave() { events.push('session.save'); } },
		Notifier: {
			trigger(action, type, ids, extra, sync) {
				events.push(`notifier:${action}:${type}:${ids.join(',')}:${Boolean(sync)}`);
			},
		},
		logError(err) { events.push(`error:${err?.message || err}`); },
		getMainWindow: () => owner,
		getMainWindows: () => [owner],
		Reader: {
			_readers: readers,
			getByTabID: (id) => readers.find((r) => r.tabID === id) || null,
			open: async (itemID, _location, opts) => {
				events.push(`reader.open:${itemID}:tabID=${opts?.tabID || ''}:bg=${Boolean(opts?.openInBackground)}`);
				assert.equal(opts?.tabID, 'tab-1', 'Reader.open must reuse current tabID');
				assert.equal(opts?.openInWindow, false);
				assert.equal(opts?.allowDuplicate, true);

				const prev = tabRow.onClose;
				const newIframe = makeDomNode('browser', '', 'reader');
				const newPopupset = makeDomNode('popupset');
				tabContainer.appendChild(newIframe);
				tabContainer.appendChild(newPopupset);

				let resolveInit;
				let rejectInit;
				const initPromise = new Promise((res, rej) => { resolveInit = res; rejectInit = rej; });
				const newReader = {
					itemID,
					tabID: opts.tabID,
					_window: owner,
					_iframe: newIframe,
					_popupset: newPopupset,
					_iframeWindow: {},
					_initPromise: initPromise,
					_internalReader: { _primaryView: { initializedPromise: Promise.resolve() } },
					_isTabClosed: false,
					focused: 0,
					layoutUpdated: 0,
					uninitCalls: 0,
					docShellUpdated: 0,
					_waitForReader: async () => {},
					_handleTabClose() { this._isTabClosed = true; },
					uninit() { this.uninitCalls++; },
					_updateLayout() { this.layoutUpdated++; },
					_updateDocShellActivity() { this.docShellUpdated++; },
					focus() { this.focused++; },
				};
				tabRow.onClose = () => {
					prev?.call(tabRow);
					newReader._handleTabClose();
				};
				readers.push(newReader);
				createdReaders.push(newReader);
				if (nextInitController) {
					nextInitController({ resolveInit, rejectInit, newReader, newIframe });
				} else {
					resolveInit();
				}
				return newReader;
			},
		},
	};

	return {
		root, tabContainer, oldIframe, oldPopupset, oldReader, tabRow, nativeTabs,
		owner, zotero, readers, events, contextOps, createdReaders,
		getOldStats: () => ({ tabCloseCalls, oldReaderClosed, oldReaderUninit }),
		setNextInitController: (fn) => { nextInitController = fn; },
	};
}

test('v0.9.11 showAttachmentInReaderTab swaps reader in-place with zero new tab/window creation and clean old-reader disposal', async () => {
	const prevZotero = globalThis.Zotero;
	const h = createHostHarness();
	globalThis.Zotero = h.zotero;
	try {
		let releaseNewReader;
		h.setNextInitController(({ resolveInit }) => {
			releaseNewReader = resolveInit;
		});

		const pending = showAttachmentInReaderTab(h.owner, 102, 'tab-1');
		await new Promise((r) => setTimeout(r, 10));

		// While the replacement reader is loading:
		// 1. No new tab created, old iframe stays marked as kept, staging <style> hides incoming reader cleanly.
		assert.equal(h.nativeTabs.length, 1);
		assert.equal(h.oldIframe.getAttribute('data-zbf-swap-keep'), '1');
		assert.equal(h.tabContainer.children.filter((c) => c.className === 'reader').length, 2);
		const stagingStyles = h.root.children.filter((c) => c.localName === 'style');
		assert.equal(stagingStyles.length, 1, 'staging style should conceal preparing browser in-place');
		assert.match(stagingStyles[0].textContent, /visibility:hidden/);

		releaseNewReader();
		const ok = await pending;
		assert.equal(ok, true);

		// After commit:
		assert.equal(h.nativeTabs.length, 1, 'tab count must stay strictly 1');
		assert.equal(h.tabRow.id, 'tab-1');
		assert.equal(h.tabRow.data.itemID, 102);
		assert.equal(h.tabRow.data.icon, undefined, 'icon cache cleared so tab icon refreshes');
		assert.equal(h.tabRow.data.secondViewState, undefined, 'stale split-view state cleared');
		assert.equal(h.tabRow.audioStatus, undefined);
		assert.equal(h.tabRow.title, 'Supporting Info');
		assert.equal(h.readers.length, 1, 'old ReaderTab removed from Zotero.Reader._readers');
		assert.equal(h.zotero.Reader.getByTabID('tab-1').itemID, 102);
		assert.equal(h.oldIframe.isConnected, false, 'old browser element removed');
		assert.equal(h.oldPopupset.isConnected, false, 'old popupset removed');
		assert.equal(h.tabContainer.children.filter((c) => c.className === 'reader').length, 1);
		assert.equal(h.root.children.filter((c) => c.localName === 'style').length, 0, 'staging style cleaned up');
		assert.equal(h.oldReader.pausedReadAloud, true, 'active read-aloud paused before disposal');
		assert.equal(h.getOldStats().oldReaderClosed, 1);
		assert.equal(h.getOldStats().oldReaderUninit, 1);
		assert.equal(h.createdReaders[0].focused, 1);
		assert.equal(h.createdReaders[0].layoutUpdated, 1);
		assert.ok(!h.events.some((e) => e.startsWith('tabs.add') || e.startsWith('tabs.close')), 'must never call tabs.add or tabs.close');
		assert.ok(h.events.includes('notifier:select:tab:tab-1:true'), 'must notify observers of in-place content swap');
		assert.ok(h.events.includes('session.save'));
		assert.deepEqual(h.contextOps, [], 'same parent item reuses existing context pane seamlessly');

		// Residual listeners on tab-content calling oldReader methods must not throw dead-object errors.
		await h.oldReader.setBottomPlaceholderHeight(10);
		await h.oldReader.setContextPaneOpen(true);
		h.oldReader._updateLayout();

		// Closing the tab later invokes only the new reader's close handler (no leaked old onClose chain).
		const beforeClose = h.getOldStats().tabCloseCalls;
		h.tabRow.onClose();
		assert.equal(h.getOldStats().tabCloseCalls, beforeClose, 'old onClose closure must not be retained');
		assert.equal(h.createdReaders[0]._isTabClosed, true);
	} finally {
		globalThis.Zotero = prevZotero;
	}
});

test('v0.9.11 showAttachmentInReaderTab rebuilds context pane for different parent item and rolls back cleanly on load error', async () => {
	const prevZotero = globalThis.Zotero;
	const h = createHostHarness();
	globalThis.Zotero = h.zotero;
	try {
		// 1. Failing load rolls back without harming the current reader or tab.
		let failedIframe = null;
		h.setNextInitController(({ rejectInit, newIframe }) => {
			failedIframe = newIframe;
			rejectInit(new Error('corrupt PDF'));
		});
		const failed = await showAttachmentInReaderTab(h.owner, 102, 'tab-1');
		assert.equal(failed, false);
		assert.equal(h.tabRow.data.itemID, 101, 'tab itemID preserved on failure');
		assert.equal(h.readers.length, 1);
		assert.equal(h.readers[0], h.oldReader);
		assert.equal(h.oldIframe.isConnected, true);
		assert.equal(h.oldIframe.getAttribute('data-zbf-swap-keep'), null);
		assert.equal(h.createdReaders[0].uninitCalls, 1, 'failed replacement reader disposed');
		assert.equal(h.createdReaders[0]._iframe, null, 'failed replacement reader cleared iframe reference');
		assert.equal(failedIframe.isConnected, false, 'failed replacement iframe removed from DOM');

		// 2. Switching to an attachment under a different parent refreshes context pane item details.
		h.setNextInitController(null);
		const ok = await showAttachmentInReaderTab(h.owner, 201, 'tab-1');
		assert.equal(ok, true);
		assert.equal(h.tabRow.data.itemID, 201);
		assert.deepEqual(h.contextOps, ['remove:tab-1', 'add:tab-1:201']);
	} finally {
		globalThis.Zotero = prevZotero;
	}
});

test('v0.9.11 ReaderAttachmentSwitcher hands off group position and pin state atomically before tab select refresh', async () => {
	const prevZotero = globalThis.Zotero;
	const h = createHostHarness();
	globalThis.Zotero = h.zotero;
	try {
		const mem = new Map();
		const kernel = new PluginKernel({
			prefAdapter: { get: (k) => mem.get(k), set: (k, v) => mem.set(k, v), clear: (k) => mem.delete(k) },
		});
		const store = new WorkspaceStateStore(kernel.prefs);
		const grp = store.createGroup('Reading');
		store.assignToGroup('item:999', grp.id);
		store.assignToGroup('item:101', grp.id);
		store.assignToGroup('item:888', grp.id);
		store.setPinned('item:101', true);

		let groupSnapshotAtNotify = null;
		const origTrigger = h.zotero.Notifier.trigger;
		h.zotero.Notifier.trigger = (action, type, ids, extra, sync) => {
			if (action === 'select' && type === 'tab') {
				groupSnapshotAtNotify = [...grp.memberKeys];
			}
			origTrigger(action, type, ids, extra, sync);
		};

		const switcher = new ReaderAttachmentSwitcher(kernel, store);
		const ok = await switcher.switchToAttachment(h.oldReader, 100, {
			id: 102,
			title: 'Supporting Info',
			filename: 'si.pdf',
			kind: 'pdf',
			kindLabel: 'PDF',
			readerCapable: true,
		});
		assert.equal(ok, true);
		assert.deepEqual(groupSnapshotAtNotify, ['item:999', 'item:102', 'item:888'], 'group order must already be updated when tab select refresh fires');
		assert.equal(store.isPinned('item:102'), true);
		assert.equal(store.isPinned('item:101'), false);
		kernel.shutdown();
	} finally {
		globalThis.Zotero = prevZotero;
	}
});
