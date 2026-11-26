import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeRuntime } from '../src/kernel/native-runtime.ts';
import {
	formatCapabilitiesSummary,
	patchCollectionsViewHooks,
	patchItemsViewRenderCell,
	probeHostCapabilities,
	ReaderTabAdapter,
	showAttachmentInReaderTab,
} from '../src/services/host/index.ts';

function makeFullHostWindow() {
	return {
		document: {
			getElementById: () => null,
		},
		Zotero_Tabs: {
			_tabs: [{ id: 'zotero-pane', type: 'library', data: {} }],
			select: () => {},
			close: () => {},
		},
		ZoteroContextPane: {
			context: {
				_getItemContext: () => null,
			},
		},
		ZoteroPane: {
			itemsView: {
				_renderCell: () => ({}),
			},
			collectionsView: {
				_getIcon: () => ({}),
				_expandRow: async () => 0,
				_addSortedRow: async () => 0,
			},
		},
	};
}

test('probeHostCapabilities detects full Zotero 10 host and formats healthy summary', () => {
	const prevZotero = globalThis.Zotero;
	try {
		const win = makeFullHostWindow();
		globalThis.Zotero = {
			version: '10.0.1',
			getMainWindow: () => win,
			Reader: {
				open: async () => ({}),
				registerEventListener: () => {},
			},
			Integration: {
				execCommand: async () => {},
			},
		};

		const snap = probeHostCapabilities();
		assert.equal(snap.hostVersion, '10.0.1');
		assert.equal(typeof snap.checkedAt, 'number');
		assert.deepEqual(snap.degradedIds, []);
		for (const status of Object.values(snap.capabilities)) {
			assert.equal(status.available, true);
			assert.equal(status.degradedReason, undefined);
		}

		const summary = formatCapabilitiesSummary(snap);
		assert.match(summary, /Zotero 10\.0\.1/);
		assert.match(summary, /7\/7/);
		assert.match(summary, /all OK/);
	} finally {
		globalThis.Zotero = prevZotero;
	}
});

test('probeHostCapabilities reports partially degraded host and never throws on broken getters', () => {
	const prevZotero = globalThis.Zotero;
	try {
		const partialWin = {
			document: {},
			Zotero_Tabs: {
				_tabs: [],
			},
			ZoteroContextPane: {},
			ZoteroPane: {
				itemsView: {},
				collectionsView: {
					_getIcon: () => ({}),
					// _expandRow & _addSortedRow missing
				},
			},
		};
		globalThis.Zotero = {
			version: '12.0-beta',
			getMainWindow: () => partialWin,
			Reader: {
				open: async () => ({}),
				// registerEventListener missing
			},
			Integration: {
				getSession: () => null,
			},
		};

		const snap = probeHostCapabilities(partialWin);
		assert.equal(snap.hostVersion, '12.0-beta');
		assert.equal(snap.capabilities.wordIntegrationHook.available, true, 'getSession alone satisfies wordIntegrationHook');
		assert.equal(snap.capabilities.readerInPlaceSwap.available, false);
		assert.match(snap.capabilities.readerInPlaceSwap.degradedReason || '', /document\.getElementById/);
		assert.equal(snap.capabilities.readerToolbarEvent.available, false);
		assert.equal(snap.capabilities.tabsCollection.available, false);
		assert.equal(snap.capabilities.contextPane.available, false);
		assert.equal(snap.capabilities.itemsViewCellHook.available, false);
		assert.equal(snap.capabilities.collectionsViewTreeHook.available, false);
		assert.match(snap.capabilities.collectionsViewTreeHook.degradedReason || '', /_expandRow/);
		assert.match(snap.capabilities.collectionsViewTreeHook.degradedReason || '', /_addSortedRow/);
		assert.deepEqual(snap.degradedIds, [
			'readerInPlaceSwap',
			'readerToolbarEvent',
			'tabsCollection',
			'contextPane',
			'itemsViewCellHook',
			'collectionsViewTreeHook',
		]);

		const summary = formatCapabilitiesSummary(snap);
		assert.match(summary, /1\/7/);
		assert.match(summary, /degraded:/);
		assert.match(summary, /itemsViewCellHook/);

		// Throwing host getters must never crash probeHostCapabilities
		const hostileWin = {
			get ZoteroPane() { throw new Error('dead object'); },
			get Zotero_Tabs() { throw new Error('dead object'); },
		};
		globalThis.Zotero = undefined;
		const emptySnap = probeHostCapabilities(hostileWin);
		assert.equal(emptySnap.hostVersion, 'unknown');
		assert.equal(emptySnap.degradedIds.length, 7);
	} finally {
		globalThis.Zotero = prevZotero;
	}
});

test('patchItemsViewRenderCell mounts, invokes with this-binding, restores on dispose, and returns null when missing', () => {
	const runtime = new NativeRuntime();
	assert.equal(patchItemsViewRenderCell(runtime, null, (orig) => orig), null);
	assert.equal(patchItemsViewRenderCell(runtime, {}, (orig) => orig), null);
	assert.equal(runtime.pendingPatchCount, 0);

	const itemsView = {
		prefix: 'row',
		_renderCell(index, col) {
			return `${this.prefix}:${index}:${col}`;
		},
	};
	const originalRef = itemsView._renderCell;

	const dispose = patchItemsViewRenderCell(runtime, itemsView, (orig) => function (...args) {
		return `[${orig.apply(this, args)}]`;
	});
	assert.equal(typeof dispose, 'function');
	assert.equal(runtime.pendingPatchCount, 1);
	assert.equal(itemsView._renderCell(3, 'title'), '[row:3:title]');

	dispose();
	dispose(); // idempotent
	assert.equal(runtime.pendingPatchCount, 0);
	assert.equal(itemsView._renderCell, originalRef);
	assert.equal(itemsView._renderCell(3, 'title'), 'row:3:title');
});

test('patchCollectionsViewHooks supports full and partial hooks and restores cleanly on dispose', async () => {
	const runtime = new NativeRuntime();
	const noopDispose = patchCollectionsViewHooks(runtime, null, { getIcon: (orig) => orig });
	assert.doesNotThrow(() => noopDispose());

	const fullView = {
		tag: 'cv',
		_getIcon(idx) { return `${this.tag}:icon:${idx}`; },
		async _expandRow(rows, idx) { return rows.length + idx; },
		async _addSortedRow(type, id) { return `${type}:${id}`; },
	};
	const origGetIcon = fullView._getIcon;
	const origExpand = fullView._expandRow;
	const origAdd = fullView._addSortedRow;

	const disposeFull = patchCollectionsViewHooks(runtime, fullView, {
		getIcon: (orig) => function (...args) { return `wrapped(${orig.apply(this, args)})`; },
		expandRow: (orig) => async function (...args) { return (await orig.apply(this, args)) + 10; },
		addSortedRow: (orig) => async function (...args) { return `sorted:${await orig.apply(this, args)}`; },
	});
	assert.equal(runtime.pendingPatchCount, 3);
	assert.equal(fullView._getIcon(1), 'wrapped(cv:icon:1)');
	assert.equal(await fullView._expandRow(['a', 'b'], 1), 13);
	assert.equal(await fullView._addSortedRow('collection', 42), 'sorted:collection:42');

	disposeFull();
	disposeFull(); // idempotent
	assert.equal(runtime.pendingPatchCount, 0);
	assert.equal(fullView._getIcon, origGetIcon);
	assert.equal(fullView._expandRow, origExpand);
	assert.equal(fullView._addSortedRow, origAdd);

	// Partial host surface (only _getIcon present) + partial hook registration
	const partialView = {
		_getIcon: (idx) => `base:${idx}`,
	};
	const disposePartial = patchCollectionsViewHooks(runtime, partialView, {
		getIcon: (orig) => function (...args) { return `custom:${orig.apply(this, args)}`; },
		expandRow: (orig) => orig,
		addSortedRow: (orig) => orig,
	});
	assert.equal(runtime.pendingPatchCount, 1);
	assert.equal(partialView._getIcon(2), 'custom:base:2');
	disposePartial();
	assert.equal(runtime.pendingPatchCount, 0);
	assert.equal(partialView._getIcon(2), 'base:2');
});

test('ReaderTabAdapter degrades cleanly when host ignores tabID or rejects tabID option, while preserving corrupt-PDF rollback', async () => {
	const prevZotero = globalThis.Zotero;
	try {
		// 1. Host ignores tabID and opens a new tab instead
		const events = [];
		const tabs = [{ id: 'tab-1', type: 'reader', data: { itemID: 101 } }];
		const win = {
			document: { getElementById: () => null },
			Zotero_Tabs: {
				_tabs: tabs,
				selectedID: 'tab-1',
				select(id, silent) {
					events.push(`select:${id}:${Boolean(silent)}`);
					this.selectedID = id;
				},
				close(id) {
					events.push(`close:${id}`);
					const idx = tabs.findIndex((t) => t.id === id);
					if (idx >= 0) tabs.splice(idx, 1);
				},
			},
		};
		globalThis.Zotero = {
			getMainWindow: () => win,
			Reader: {
				open: async (itemID, _loc, opts) => {
					events.push(`open:${itemID}:tabID=${opts?.tabID ?? 'none'}`);
					const newTab = { id: 'tab-new-2', type: 'reader', data: { itemID } };
					tabs.push(newTab);
					return {
						tabID: 'tab-new-2',
						_window: win,
						_initPromise: Promise.resolve(),
						_waitForReader: async () => {},
					};
				},
				getByTabID: () => null,
			},
		};

		assert.equal(ReaderTabAdapter.canSwapInPlace(win), true);
		let committed = 0;
		const ok = await ReaderTabAdapter.showAttachmentInReaderTab(win, 102, 'tab-1', undefined, () => { committed++; });
		assert.equal(ok, true);
		assert.equal(committed, 1);
		assert.deepEqual(events, ['open:102:tabID=tab-1', 'select:tab-new-2:true', 'close:tab-1']);
		assert.deepEqual(tabs.map((t) => t.id), ['tab-new-2']);

		// 2. Host throws synchronously/asynchronously when tabID option is passed -> retries once without tabID
		events.length = 0;
		let openAttempts = 0;
		globalThis.Zotero.Reader.open = async (itemID, _loc, opts) => {
			openAttempts++;
			events.push(`open:${itemID}:tabID=${opts?.tabID ?? 'none'}`);
			if (opts?.tabID) {
				throw new TypeError('tabID option unsupported in future Zotero');
			}
			const newTab = { id: 'tab-fallback-3', type: 'reader', data: { itemID } };
			tabs.push(newTab);
			return {
				tabID: 'tab-fallback-3',
				_window: win,
				_initPromise: Promise.resolve(),
				_waitForReader: async () => {},
			};
		};
		committed = 0;
		const okRetry = await showAttachmentInReaderTab(win, 103, 'tab-new-2', undefined, () => { committed++; });
		assert.equal(okRetry, true);
		assert.equal(openAttempts, 2);
		assert.equal(committed, 1);
		assert.deepEqual(events, [
			'open:103:tabID=tab-new-2',
			'open:103:tabID=none',
			'select:tab-fallback-3:true',
			'close:tab-new-2',
		]);

		// 3. Corrupt PDF (_initPromise rejects AFTER returning same tabID) must NOT retry without tabID
		events.length = 0;
		openAttempts = 0;
		let uninitCalled = 0;
		globalThis.Zotero.Reader.open = async (itemID, _loc, opts) => {
			openAttempts++;
			events.push(`open:${itemID}:tabID=${opts?.tabID ?? 'none'}`);
			return {
				tabID: opts.tabID,
				_window: win,
				_initPromise: Promise.reject(new Error('corrupt PDF')),
				uninit() { uninitCalled++; },
			};
		};
		const okCorrupt = await showAttachmentInReaderTab(win, 104, 'tab-fallback-3');
		assert.equal(okCorrupt, false);
		assert.equal(openAttempts, 1, 'corrupt PDF init rejection must NOT retry without tabID');
		assert.equal(uninitCalled, 1);
		assert.deepEqual(tabs.map((t) => t.id), ['tab-fallback-3']);
	} finally {
		globalThis.Zotero = prevZotero;
	}
});
