import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import { isItemWritable } from '../../services/item-resolution.ts';

/**
 * Ownership-tracked automatic citation tag manager.
 * Guarantees:
 * 1. Never touches read-only group library items or trashed items (Fail-Closed).
 * 2. Only removes tags that were added by BridgeFlow; manual user tags are untouched.
 * 3. Uses multi-document union semantics so closing 1 Word doc keeps tags cited in another.
 */
const MANAGED_TAG_IDS_PREF = 'extensions.zotero.bridgeflow.wordCite.managedTagItemIDs';

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
			if (Array.isArray(parsed)) {
				for (const id of parsed) {
					const n = Number(id);
					if (Number.isSafeInteger(n) && n > 0) this.managedItemIDs.add(n);
				}
			}
		} catch { /* ignore */ }
	}

	private savePersistedIDs(): void {
		try {
			(globalThis as any).Zotero?.Prefs?.set?.(MANAGED_TAG_IDS_PREF, JSON.stringify([...this.managedItemIDs]), true);
		} catch { /* ignore */ }
	}

	get managedCount(): number {
		return this.managedItemIDs.size;
	}

	sanitizeTagText(raw: string): string {
		const clean = String(raw || '').replace(/[\r\n\x00-\x1f]/g, '').trim().slice(0, 200);
		return clean || '/Citations';
	}

	syncCitedItems(
		citedUnion: ReadonlySet<number>,
		resolveItem: (id: number) => any = (id) => (globalThis as any).Zotero?.Items?.get?.(id),
	): Promise<{ added: number; removed: number }> {
		const snapshotUnion = new Set(citedUnion);
		const run = this.syncQueue.then(() => this.performSync(snapshotUnion, resolveItem));
		this.syncQueue = run.catch(() => ({ added: 0, removed: 0 }));
		return run;
	}

	private async performSync(
		citedUnion: ReadonlySet<number>,
		resolveItem: (id: number) => any,
	): Promise<{ added: number; removed: number }> {
		const enabled = this.prefs.get('wordCite.citationTags.enable');
		const nextTag = this.sanitizeTagText(this.prefs.get('wordCite.citationTags.text'));
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
		try {
			return await runBatch(async () => {
				// Handle tag rename migration first
				if (nextTag !== this.activeTagText) {
					const prevTag = this.activeTagText;
					this.activeTagText = nextTag;
					for (const id of [...this.managedItemIDs]) {
						const item = resolveItem(id);
						if (!isItemWritable(item)) continue;
						if (item.hasTag?.(prevTag)) {
							item.removeTag?.(prevTag);
							if (enabled && citedUnion.has(id)) item.addTag?.(nextTag);
							await saveItemInTx(item);
						}
					}
				}

				// If disabled, strip only plugin-owned tags
				if (!enabled) {
					for (const id of [...this.managedItemIDs]) {
						const item = resolveItem(id);
						if (isItemWritable(item) && item.hasTag?.(this.activeTagText)) {
							item.removeTag?.(this.activeTagText);
							await saveItemInTx(item);
							removed++;
						}
						this.managedItemIDs.delete(id);
					}
					return { added, removed };
				}

				// Add tag to newly cited writable items (skip if user already manually added it)
				for (const id of citedUnion) {
					const item = resolveItem(id);
					if (!isItemWritable(item)) continue;
					if (!item.hasTag?.(this.activeTagText)) {
						item.addTag?.(this.activeTagText);
						await saveItemInTx(item);
						this.managedItemIDs.add(id);
						added++;
					}
				}

				// Remove tag from uncited plugin-managed items
				for (const id of [...this.managedItemIDs]) {
					if (citedUnion.has(id)) continue;
					const item = resolveItem(id);
					if (isItemWritable(item) && item.hasTag?.(this.activeTagText)) {
						item.removeTag?.(this.activeTagText);
						await saveItemInTx(item);
						removed++;
					}
					this.managedItemIDs.delete(id);
				}
				return { added, removed };
			});
		} finally {
			this.savePersistedIDs();
		}
	}
}
