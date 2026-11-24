import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../kernel/types.ts';
import {
	patchCollectionsViewForWindow,
	reorderViewCollections,
	TEMP_COLLECTION_KEYS_PREF,
	TEMP_COLLECTION_MARKER,
	TEMP_COLLECTION_RELATION,
} from './collection-tree-order.ts';
import type { WordSessionRecord } from './session-tracker.ts';

/**
 * Manages temporary Zotero collections reflecting each open Word manuscript's cited items.
 * Cleans up safely on shutdown, pref disable, or Word document close without touching user collections.
 * Never calls destructive `collectionsView.refresh()` which breaks Zotero 10 tree selection.
 */
export class WordCitationCollectionManager {
	private readonly sessionCollections = new Map<string, any>();
	private readonly trackedCollectionKeys = new Set<string>();
	private readonly windowDisposers = new Map<Window, Disposable>();
	private syncQueue: Promise<void> = Promise.resolve();
	private readonly kernel: PluginKernel;

	constructor(kernel: PluginKernel) {
		this.kernel = kernel;
		this.loadPersistedKeys();
	}

	private loadPersistedKeys(): void {
		try {
			const raw = String((globalThis as any).Zotero?.Prefs?.get?.(TEMP_COLLECTION_KEYS_PREF, true) || '');
			if (!raw) return;
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				for (const k of parsed) {
					if (typeof k === 'string' && k) this.trackedCollectionKeys.add(k);
				}
			}
		} catch { /* ignore */ }
	}

	private savePersistedKeys(): void {
		try {
			(globalThis as any).Zotero?.Prefs?.set?.(
				TEMP_COLLECTION_KEYS_PREF,
				JSON.stringify([...this.trackedCollectionKeys]),
				true,
			);
		} catch { /* ignore */ }
	}

	private getActiveKeySet(): Set<string> {
		const keys = new Set<string>(this.trackedCollectionKeys);
		for (const col of this.sessionCollections.values()) {
			if (col?.key) keys.add(String(col.key));
		}
		return keys;
	}

	private getActiveNameSet(): Set<string> {
		const names = new Set<string>();
		for (const col of this.sessionCollections.values()) {
			const name = String(col?.name || '');
			if (name) names.add(name);
		}
		return names;
	}

	attachWindow(win: Window): void {
		if (!win || this.windowDisposers.has(win)) return;
		const iconURI = this.kernel.info.rootURI ? `${this.kernel.info.rootURI}assets/word.svg` : undefined;
		const tryPatch = (attempt = 0): void => {
			if ((win as any).closed || this.windowDisposers.has(win)) return;
			const cv = (win as any)?.ZoteroPane?.collectionsView;
			if (!cv) {
				if (attempt < 120) {
					const schedule = typeof win.setTimeout === 'function' ? win.setTimeout.bind(win) : setTimeout;
					schedule(() => tryPatch(attempt + 1), 50);
				}
				return;
			}
			const dispose = patchCollectionsViewForWindow(
				win,
				this.kernel.runtime,
				() => this.getActiveKeySet(),
				iconURI,
				() => this.getActiveNameSet(),
			);
			this.windowDisposers.set(win, dispose);
			reorderViewCollections(cv, this.getActiveKeySet(), this.getActiveNameSet());
			cv.tree?.invalidate?.();
		};
		tryPatch();
	}

	detachWindow(win: Window): void {
		const dispose = this.windowDisposers.get(win);
		if (!dispose) return;
		this.windowDisposers.delete(win);
		dispose();
	}

	getSessionIdByCollectionKey(collectionKey: string): string | null {
		if (!collectionKey) return null;
		for (const [sid, col] of this.sessionCollections.entries()) {
			if (col?.key === collectionKey) return sid;
		}
		return null;
	}

	getSessionCollection(sessionID: string): { id?: number; name?: string } | null {
		return this.sessionCollections.get(sessionID) ?? null;
	}

	selectSessionCollection(win?: Window | null, sessionID?: string | null): boolean {
		const targetID = sessionID || this.sessionCollections.keys().next().value;
		const col = targetID ? this.sessionCollections.get(targetID) : null;
		if (!col?.id) return false;
		const targetWin: any = (win as any)?.ZoteroPane ? win : (globalThis as any).Zotero?.getMainWindow?.();
		const tabs = targetWin?.Zotero_Tabs;
		if (tabs?.selectedID && tabs.selectedID !== 'zotero-pane' && typeof tabs.select === 'function') {
			try { tabs.select('zotero-pane'); } catch { /* ignore */ }
		}
		const pane = targetWin?.ZoteroPane;
		const cv = pane?.collectionsView;
		if (typeof cv?.selectCollection === 'function') {
			void Promise.resolve(cv.selectCollection(col.id)).catch(() => {});
			return true;
		}
		if (typeof pane?.selectCollection === 'function') {
			void Promise.resolve(pane.selectCollection(col.id)).catch(() => {});
			return true;
		}
		return false;
	}

	resolveSelectedCollectionSessionID(win?: Window | null): string | null {
		const targetWin = (win as any)?.ZoteroPane ? win : (globalThis as any).Zotero?.getMainWindow?.();
		const pane = (targetWin as any)?.ZoteroPane;
		let selected: any[] = [];
		try {
			const getSelected = pane?.getSelectedCollections || pane?.collectionsView?.getSelectedCollections;
			if (typeof getSelected === 'function') {
				selected = getSelected.call(pane?.getSelectedCollections ? pane : pane?.collectionsView) || [];
			}
		} catch { /* ignore */ }
		for (const col of selected) {
			const sid = this.getSessionIdByCollectionKey(String(col?.key || ''));
			if (sid) return sid;
		}
		return null;
	}

	private async eraseOwnedLeaf(col: any): Promise<void> {
		if (!col || typeof col.hasChildCollections !== 'function' || col.hasChildCollections(true)) return;
		if (!col._isBridgeFlowCollection) {
			await col.loadDataType?.('relations');
			const markers = col.getRelationsByPredicate?.(TEMP_COLLECTION_RELATION);
			if (!Array.isArray(markers) || !markers.includes(TEMP_COLLECTION_MARKER)) return;
		}
		await col.eraseTx();
	}

	async purgeStaleCollections(): Promise<void> {
		const host = (globalThis as any).Zotero;
		const api = host?.Collections;
		const libraryID = host?.Libraries?.userLibraryID;
		if (!libraryID || typeof api?.getByLibraryAndKey !== 'function') return;
		for (const key of [...this.trackedCollectionKeys]) {
			try {
				if (this.getSessionIdByCollectionKey(key)) continue;
				const col = api.getByLibraryAndKey(libraryID, key);
				await this.eraseOwnedLeaf(col);
				this.trackedCollectionKeys.delete(key);
			} catch (err) {
				this.kernel.logger.error('word-cite:purge-collection', err);
			}
		}
		this.savePersistedKeys();
	}

	sync(sessions: readonly WordSessionRecord[]): void {
		this.syncQueue = this.syncQueue
			.then(() => this.runSync(sessions))
			.catch((err) => this.kernel.logger.error('word-cite:collections', err));
	}

	async clearAll(): Promise<void> {
		await this.syncQueue;
		for (const dispose of this.windowDisposers.values()) {
			try { dispose(); } catch { /* ignore */ }
		}
		this.windowDisposers.clear();
		for (const col of this.sessionCollections.values()) {
			try {
				await this.eraseOwnedLeaf(col);
				if (col?.key) this.trackedCollectionKeys.delete(col.key);
			} catch (err) {
				this.kernel.logger.error('word-cite:erase-collection', err);
			}
		}
		this.sessionCollections.clear();
		this.savePersistedKeys();
	}

	private async runSync(sessions: readonly WordSessionRecord[]): Promise<void> {
		const enabled = this.kernel.prefs.get('wordCite.collections.enable');
		const ZoteroObj = (globalThis as any).Zotero;
		if (!ZoteroObj?.Collection || !ZoteroObj?.Libraries?.userLibraryID) return;

		if (!enabled) {
			for (const [sid, col] of this.sessionCollections) {
				try {
					await this.eraseOwnedLeaf(col);
					if (col?.key) this.trackedCollectionKeys.delete(col.key);
				} catch { /* ignore */ }
				this.sessionCollections.delete(sid);
			}
			this.savePersistedKeys();
			return;
		}

		const activeIDs = new Set(sessions.map((s) => s.sessionID));
		for (const [sid, col] of this.sessionCollections) {
			if (!activeIDs.has(sid)) {
				try {
					await this.eraseOwnedLeaf(col);
					if (col?.key) this.trackedCollectionKeys.delete(col.key);
				} catch { /* ignore */ }
				this.sessionCollections.delete(sid);
				this.savePersistedKeys();
			}
		}

		const userLibID = ZoteroObj.Libraries.userLibraryID;
		const hostItems = ZoteroObj.Items;

		for (const ses of sessions) {
			let col = this.sessionCollections.get(ses.sessionID);
			const colName = ses.displayName;
			if (!col || col.deleted) {
				col = new ZoteroObj.Collection();
				col._isBridgeFlowCollection = true;
				col.libraryID = userLibID;
				col.name = colName;
				try {
					col.addRelation?.(TEMP_COLLECTION_RELATION, TEMP_COLLECTION_MARKER);
				} catch { /* ignore */ }
				if (col.key) this.trackedCollectionKeys.add(String(col.key));
				await col.saveTx?.({ skipSelect: true });
				if (col.key) {
					this.trackedCollectionKeys.add(String(col.key));
					this.savePersistedKeys();
				}
				this.sessionCollections.set(ses.sessionID, col);
				this.repositionAllViews(ZoteroObj);
			} else if (col.name !== colName) {
				const prevName = col.name;
				col.name = colName;
				try {
					await col.saveTx?.({ skipSelect: true });
					this.repositionAllViews(ZoteroObj);
				} catch {
					col.name = prevName;
				}
			}

			const targetIDs = [...ses.itemCitations.keys()].filter((id) => {
				if (!Number.isSafeInteger(id) || id <= 0) return false;
				if (typeof hostItems?.get !== 'function') return true;
				const item = hostItems.get(id);
				if (!item) return false;
				const inTrash = typeof item.inTrash === 'function' ? item.inTrash() === true : item.inTrash === true;
				if (item.deleted === true || inTrash) return false;
				if (item.libraryID != null && col.libraryID != null && item.libraryID !== col.libraryID) return false;
				return typeof item.isTopLevelItem !== 'function' || item.isTopLevelItem();
			});

			const existingRaw: any[] = col.getChildItems?.(true) || [];
			const existingIDs = existingRaw
				.map((x) => (typeof x === 'number' ? x : Number(x?.id || 0)))
				.filter((id) => Number.isSafeInteger(id) && id > 0);
			const targetSet = new Set(targetIDs);
			const currentSet = new Set(existingIDs);
			const toRemove = existingIDs.filter((id) => !targetSet.has(id));
			const toAdd = targetIDs.filter((id) => !currentSet.has(id));
			if (!toRemove.length && !toAdd.length) continue;

			try {
				if (typeof ZoteroObj.DB?.executeTransaction === 'function') {
					await ZoteroObj.DB.executeTransaction(async () => {
						if (toRemove.length) await col.removeItems?.(toRemove);
						if (toAdd.length) await col.addItems?.(toAdd);
					});
				} else {
					if (toRemove.length) await col.removeItems?.(toRemove);
					if (toAdd.length) await col.addItems?.(toAdd);
				}
			} catch (err) {
				this.kernel.logger.error('word-cite:collection-sync', err);
			}
		}
	}

	private repositionAllViews(zoteroObj: any): void {
		const wins: any[] = zoteroObj?.getMainWindows?.() || [];
		const mainWin = zoteroObj?.getMainWindow?.();
		if (mainWin && !wins.includes(mainWin)) wins.push(mainWin);
		const activeKeys = this.getActiveKeySet();
		const activeNames = this.getActiveNameSet();
		for (const win of wins) {
			try {
				if (!this.windowDisposers.has(win)) this.attachWindow(win);
				const cv = win?.ZoteroPane?.collectionsView;
				if (cv) {
					reorderViewCollections(cv, activeKeys, activeNames);
					cv.tree?.invalidate?.();
				}
			} catch { /* ignore */ }
		}
	}
}
