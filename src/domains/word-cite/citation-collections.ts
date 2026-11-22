import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { WordSessionRecord } from './session-tracker.ts';

const TEMP_COLLECTION_RELATION = 'http://zotero.org/relations/temporary-citation-collection';
const TEMP_COLLECTION_MARKER = 'BridgeFlow';

/**
 * Manages temporary Zotero collections reflecting each open Word manuscript's cited items.
 * Cleans up safely on shutdown, pref disable, or Word document close without touching user collections.
 */
export class WordCitationCollectionManager {
	private readonly sessionCollections = new Map<string, any>();
	private syncQueue: Promise<void> = Promise.resolve();
	private readonly kernel: PluginKernel;

	constructor(kernel: PluginKernel) {
		this.kernel = kernel;
	}

	async purgeStaleCollections(): Promise<void> {
		const ZoteroObj = (globalThis as any).Zotero;
		const colsApi = ZoteroObj?.Collections;
		const libraryID = ZoteroObj?.Libraries?.userLibraryID;
		if (typeof colsApi?.getByLibrary !== 'function' || !libraryID) return;

		const all: any[] = colsApi.getByLibrary(libraryID, true, true) || [];
		const activeKeys = new Set([...this.sessionCollections.values()].map((c) => c?.key).filter(Boolean));

		for (const col of all) {
			if (!col || activeKeys.has(col.key)) continue;
			try {
				await col.loadDataType?.('relations');
				const rels: string[] = col.getRelationsByPredicate?.(TEMP_COLLECTION_RELATION) || [];
				if (rels.includes(TEMP_COLLECTION_MARKER)) {
					await col.eraseTx?.();
				}
			} catch (err) {
				this.kernel.logger.error('word-cite:purge-collection', err);
			}
		}
	}

	sync(sessions: readonly WordSessionRecord[]): void {
		this.syncQueue = this.syncQueue
			.then(() => this.runSync(sessions))
			.catch((err) => this.kernel.logger.error('word-cite:collections', err));
	}

	async clearAll(): Promise<void> {
		await this.syncQueue;
		for (const col of this.sessionCollections.values()) {
			try {
				await col?.eraseTx?.();
			} catch (err) {
				this.kernel.logger.error('word-cite:erase-collection', err);
			}
		}
		this.sessionCollections.clear();
	}

	private async runSync(sessions: readonly WordSessionRecord[]): Promise<void> {
		const enabled = this.kernel.prefs.get('wordCite.collections.enable');
		const ZoteroObj = (globalThis as any).Zotero;
		if (!ZoteroObj?.Collection || !ZoteroObj?.Libraries?.userLibraryID) return;

		if (!enabled) {
			for (const [sid, col] of this.sessionCollections) {
				try { await col?.eraseTx?.(); } catch { /* ignore */ }
				this.sessionCollections.delete(sid);
			}
			return;
		}

		const activeIDs = new Set(sessions.map((s) => s.sessionID));
		for (const [sid, col] of this.sessionCollections) {
			if (!activeIDs.has(sid)) {
				try { await col?.eraseTx?.(); } catch { /* ignore */ }
				this.sessionCollections.delete(sid);
			}
		}

		for (const ses of sessions) {
			let col = this.sessionCollections.get(ses.sessionID);
			const colName = `📝 ${ses.displayName}`;
			if (!col || col.deleted) {
				col = new ZoteroObj.Collection();
				col.libraryID = ZoteroObj.Libraries.userLibraryID;
				col.name = colName;
				try {
					col.addRelation?.(TEMP_COLLECTION_RELATION, TEMP_COLLECTION_MARKER);
				} catch { /* ignore */ }
				await col.saveTx?.({ skipSelect: true });
				this.sessionCollections.set(ses.sessionID, col);
				this.refreshCollectionsView(ZoteroObj);
			} else if (col.name !== colName) {
				col.name = colName;
				await col.saveTx?.({ skipSelect: true });
				this.refreshCollectionsView(ZoteroObj);
			}

			const targetIDs = [...ses.itemCitations.keys()].filter((id) => Number.isSafeInteger(id) && id > 0);
			const existingRaw: any[] = col.getChildItems?.(true) || [];
			const existingIDs = existingRaw
				.map((x) => (typeof x === 'number' ? x : Number(x?.id || 0)))
				.filter((id) => id > 0);
			const targetSet = new Set(targetIDs);
			const currentSet = new Set(existingIDs);
			const toRemove = existingIDs.filter((id) => !targetSet.has(id));
			const toAdd = targetIDs.filter((id) => !currentSet.has(id));
			if (!toRemove.length && !toAdd.length) continue;

			if (typeof ZoteroObj.DB?.executeTransaction === 'function') {
				await ZoteroObj.DB.executeTransaction(async () => {
					if (toRemove.length) await col.removeItems?.(toRemove);
					if (toAdd.length) await col.addItems?.(toAdd);
				});
			} else {
				if (toRemove.length) await col.removeItems?.(toRemove);
				if (toAdd.length) await col.addItems?.(toAdd);
			}
		}
	}

	private refreshCollectionsView(zoteroObj: any): void {
		const wins: any[] = zoteroObj?.getMainWindows?.() || [];
		for (const win of wins) {
			try {
				win?.ZoteroPane?.collectionsView?.refresh?.();
			} catch { /* ignore */ }
		}
	}
}
