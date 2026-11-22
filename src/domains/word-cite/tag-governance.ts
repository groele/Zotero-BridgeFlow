import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import { isItemWritable } from '../../services/item-resolution.ts';

/**
 * Ownership-tracked automatic citation tag manager.
 * Guarantees:
 * 1. Never touches read-only group library items or trashed items (Fail-Closed).
 * 2. Only removes tags that were added by BridgeFlow; manual user tags are untouched.
 * 3. Uses multi-document union semantics so closing 1 Word doc keeps tags cited in another.
 */
export class CitationTagGovernance {
	private readonly managedItemIDs = new Set<number>();
	private activeTagText: string;

	private readonly prefs: UnifiedPrefService;

	constructor(prefs: UnifiedPrefService) {
		this.prefs = prefs;
		this.activeTagText = this.sanitizeTagText(prefs.get('wordCite.citationTags.text'));
	}

	get managedCount(): number {
		return this.managedItemIDs.size;
	}

	sanitizeTagText(raw: string): string {
		const clean = String(raw || '').replace(/[\r\n\x00-\x1f]/g, '').trim().slice(0, 200);
		return clean || '/Citations';
	}

	async syncCitedItems(
		citedUnion: ReadonlySet<number>,
		resolveItem: (id: number) => any = (id) => (globalThis as any).Zotero?.Items?.get?.(id),
	): Promise<{ added: number; removed: number }> {
		const enabled = this.prefs.get('wordCite.citationTags.enable');
		const nextTag = this.sanitizeTagText(this.prefs.get('wordCite.citationTags.text'));
		let added = 0;
		let removed = 0;

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
					await item.saveTx?.();
				}
			}
		}

		// If disabled, strip only plugin-owned tags
		if (!enabled) {
			for (const id of [...this.managedItemIDs]) {
				const item = resolveItem(id);
				if (isItemWritable(item) && item.hasTag?.(this.activeTagText)) {
					item.removeTag?.(this.activeTagText);
					await item.saveTx?.();
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
				await item.saveTx?.();
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
				await item.saveTx?.();
				removed++;
			}
			this.managedItemIDs.delete(id);
		}

		return { added, removed };
	}
}
