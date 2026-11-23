import type { SpotlightItemResult } from '../../kernel/types.ts';
import { safeGetItemField } from '../../services/item-resolution.ts';
import type { WorkspaceTabController } from './tab-controller.ts';

interface LibraryEntry {
	id: number;
	key: string;
	title: string;
	hint: string;
	searchText: string;
}

export class SpotlightLibraryIndex {
	private entries: LibraryEntry[] = [];
	private loaded = false;
	private revision = 0;
	private loading: Promise<void> | null = null;
	private readonly tabs: WorkspaceTabController;

	constructor(tabs: WorkspaceTabController) {
		this.tabs = tabs;
	}

	warmUp(win?: Window): void {
		if (this.loaded || this.loading) return;
		const revision = this.revision;
		this.loading = this.build(revision, win).finally(() => {
			this.loading = null;
			if (revision !== this.revision && !win?.closed) this.warmUp(win);
		});
	}

	invalidate(): void {
		this.revision++;
		this.loaded = false;
	}

	query(needle: string, win: Window, openItemIDs: ReadonlySet<number>, limit = 15, minLen = 2): SpotlightItemResult[] {
		if (!needle || needle.length < minLen) return [];
		if (!this.loaded && !this.loading) this.warmUp(win);

		const out: SpotlightItemResult[] = [];
		for (const item of this.entries) {
			if (openItemIDs.has(item.id)) continue;
			if (!item.searchText.includes(needle)) continue;
			out.push({
				id: `lib:${item.key}`,
				category: 'tab',
				title: item.title,
				subtitle: item.hint || '文库文献（点击在阅读器中打开）',
				badge: '文库',
				action: async () => {
					await this.tabs.openVirtualOrItem(win, item.id);
				},
			});
			if (out.length >= limit) break;
		}
		return out;
	}

	private async build(revision: number, win?: Window): Promise<void> {
		const ZoteroObj = (globalThis as any).Zotero;
		const itemsApi = ZoteroObj?.Items;
		if (typeof itemsApi?.getAll !== 'function') return;

		const libsApi = ZoteroObj?.Libraries;
		const libs = libsApi?.getAll?.();
		const libIDs: number[] = Array.isArray(libs)
			? [...new Set(libs.map((l: any) => Number(l?.libraryID || 0)).filter((id) => id > 0))]
			: [Number(libsApi?.userLibraryID || 1)];

		const next: LibraryEntry[] = [];
		for (const libraryID of libIDs) {
			try {
				const items = await itemsApi.getAll(libraryID, true, false, false);
				if (revision !== this.revision) return;
				if (!Array.isArray(items)) continue;
				const libName = String(libsApi?.getName?.(libraryID) || '');
				for (let i = 0; i < items.length; i++) {
					if (i > 0 && i % 250 === 0 && win?.setTimeout) {
						await new Promise<void>((r) => win.setTimeout(r, 0));
						if (revision !== this.revision) return;
					}
					const item = items[i];
					if (!item?.isRegularItem?.() || item.deleted) continue;
					const rawTitle = safeGetItemField(item, 'title') || String(item.key || '');
					const title = rawTitle.replace(/<[^>]+>/g, '').trim();
					if (!title) continue;
					const author = String(item.firstCreator || '');
					const year = (safeGetItemField(item, 'year') || safeGetItemField(item, 'date')).slice(0, 4);
					const pub = safeGetItemField(item, 'publicationTitle') || safeGetItemField(item, 'proceedingsTitle');
					next.push({
						id: Number(item.id),
						key: `${libraryID}:${item.key}`,
						title,
						hint: [libName, author, year, pub].filter(Boolean).join(' · '),
						searchText: `${title} ${author} ${year} ${pub} ${libName}`.toLowerCase(),
					});
				}
			} catch { /* ignore individual library failure */ }
		}
		if (revision !== this.revision) return;
		this.entries = next;
		this.loaded = true;
	}
}
