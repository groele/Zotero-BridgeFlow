import type { UnifiedPrefService } from '../../../kernel/pref-service.ts';
import { isItemWritable } from '../../../services/item-resolution.ts';

/**
 * Ownership-tracked automatic citation tag manager.
 * Guarantees:
 * 1. Never touches read-only group library items or trashed items (Fail-Closed).
 * 2. Only removes tags that were added by BridgeFlow; manual user tags are untouched.
 * 3. Uses multi-document union semantics so closing 1 Word doc keeps tags cited in another.
 */
const MANAGED_TAG_IDS_PREF = 'extensions.zotero.bridgeflow.wordCite.managedTagItemIDs';
const defaultResolveItem = (id: number): any => (globalThis as any).Zotero?.Items?.get?.(id);

export class CitationTagGovernance {
	private readonly managedItemIDs = new Set<number>();
	private activeTagText: string;
	private syncQueue: Promise<{ added: number; removed: number }> = Promise.resolve({ added: 0, removed: 0 });

	private readonly prefs: UnifiedPrefService;

	constructor(prefs: UnifiedPrefService) {
		this.prefs = prefs;
		this.activeTagText = this.sanitizeTagText(prefs.get('wordCite.citationTags.text'));
		this.loadPersistedIDs();
	}

	private loadPersistedIDs(): void {
		try {
			const raw = String((globalThis as any).Zotero?.Prefs?.get?.(MANAGED_TAG_IDS_PREF, true) || '');
			if (!raw) return;
			const parsed = JSON.parse(raw);
			const ids = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.ids) ? parsed.ids : []);
			if (parsed && !Array.isArray(parsed) && typeof parsed.tag === 'string' && parsed.tag.trim()) {
				this.activeTagText = this.sanitizeTagText(parsed.tag);
			}
			for (const id of ids) {
				const n = Number(id);
				if (Number.isSafeInteger(n) && n > 0) this.managedItemIDs.add(n);
			}
		} catch { /* ignore */ }
	}

	private savePersistedIDs(): void {
		try {
			const payload = JSON.stringify({ tag: this.activeTagText, ids: [...this.managedItemIDs] });
			(globalThis as any).Zotero?.Prefs?.set?.(MANAGED_TAG_IDS_PREF, payload, true);
		} catch { /* ignore */ }
	}

	get managedCount(): number {
		return this.managedItemIDs.size;
	}

	sanitizeTagText(raw: string): string {
		const clean = String(raw || '').replace(/[\r\n\x00-\x1f]/g, '').trim().slice(0, 200);
		return clean || '/Citations';
	}

	stripAllManagedTags(resolveItem: (id: number) => any = defaultResolveItem): Promise<{ added: number; removed: number }> {
		const run = this.syncQueue.then(() => this.performSync(new Set(), resolveItem, true));
		this.syncQueue = run.catch(() => ({ added: 0, removed: 0 }));
		return run;
	}

	syncCitedItems(
		citedUnion: ReadonlySet<number>,
		resolveItem: (id: number) => any = defaultResolveItem,
	): Promise<{ added: number; removed: number }> {
		const snapshotUnion = new Set(citedUnion);
		const run = this.syncQueue.then(() => this.performSync(snapshotUnion, resolveItem, false));
		this.syncQueue = run.catch(() => ({ added: 0, removed: 0 }));
		return run;
	}

	private async resolveWithAsyncFallback(id: number, resolveItem: (id: number) => any): Promise<any> {
		const syncHit = resolveItem(id);
		if (syncHit && typeof syncHit.then === 'function') return syncHit;
		if (syncHit) return syncHit;
		if (resolveItem === defaultResolveItem) {
			return (await (globalThis as any).Zotero?.Items?.getAsync?.(id).catch(() => null)) ?? null;
		}
		return null;
	}

	private async performSync(
		citedUnion: ReadonlySet<number>,
		resolveItem: (id: number) => any,
		forceDisable = false,
	): Promise<{ added: number; removed: number }> {
		const enabled = !forceDisable && this.prefs.get('wordCite.citationTags.enable');
		const nextTag = this.sanitizeTagText(this.prefs.get('wordCite.citationTags.text'));
		const userLibID = Number((globalThis as any).Zotero?.Libraries?.userLibraryID || 0);
		let added = 0;
		let removed = 0;
		const saveItemInTx = async (item: any): Promise<void> => {
			if (typeof (globalThis as any).Zotero?.DB?.executeTransaction === 'function' && typeof item?.save === 'function') {
				await item.save({ skipDateModifiedUpdate: true });
			} else {
				await item?.saveTx?.({ skipDateModifiedUpdate: true });
			}
		};
		const runBatch = async <T>(work: () => Promise<T>): Promise<T> => {
			const db = (globalThis as any).Zotero?.DB;
			return typeof db?.executeTransaction === 'function' ? db.executeTransaction(work) : work();
		};
		const stagedManaged = new Set(this.managedItemIDs);
		let stagedTag = this.activeTagText;
		const outcome = await runBatch(async () => {
			if (nextTag !== stagedTag) {
				const prevTag = stagedTag;
				stagedTag = nextTag;
				for (const id of [...stagedManaged]) {
					const item = await this.resolveWithAsyncFallback(id, resolveItem);
					if (!isItemWritable(item)) continue;
					if (item.hasTag?.(prevTag)) {
						item.removeTag?.(prevTag);
						if (enabled && citedUnion.has(id)) item.addTag?.(nextTag);
						await saveItemInTx(item);
					}
				}
			}

			if (!enabled) {
				for (const id of [...stagedManaged]) {
					const item = await this.resolveWithAsyncFallback(id, resolveItem);
					if (!item && resolveItem === defaultResolveItem && typeof (globalThis as any).Zotero?.Items?.getAsync !== 'function') {
						stagedManaged.delete(id);
						continue;
					}
					if (isItemWritable(item) && item.hasTag?.(stagedTag)) {
						item.removeTag?.(stagedTag);
						await saveItemInTx(item);
						removed++;
					}
					stagedManaged.delete(id);
				}
				return { added, removed };
			}

			for (const id of citedUnion) {
				const item = await this.resolveWithAsyncFallback(id, resolveItem);
				if (!isItemWritable(item)) continue;
				if (userLibID > 0 && item.libraryID != null && item.libraryID !== userLibID) continue;
				if (!item.hasTag?.(stagedTag)) {
					item.addTag?.(stagedTag);
					await saveItemInTx(item);
					stagedManaged.add(id);
					added++;
				}
			}

			for (const id of [...stagedManaged]) {
				if (citedUnion.has(id)) continue;
				const item = await this.resolveWithAsyncFallback(id, resolveItem);
				if (isItemWritable(item) && item.hasTag?.(stagedTag)) {
					item.removeTag?.(stagedTag);
					await saveItemInTx(item);
					removed++;
				}
				if (item || typeof (globalThis as any).Zotero?.Items?.getAsync === 'function' || resolveItem !== defaultResolveItem) {
					stagedManaged.delete(id);
				}
			}
			return { added, removed };
		});
		this.activeTagText = stagedTag;
		this.managedItemIDs.clear();
		for (const id of stagedManaged) this.managedItemIDs.add(id);
		this.savePersistedIDs();
		return outcome;
	}
}
