import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import { getCachedPrimaryItemFields, normalizeToRegularItem, stripItemTitleMarkup } from '../../services/item-resolution.ts';
import { disambiguateSameParentTabs, resolvePrimaryCollectionName } from './tab-actions-helpers.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import type { TrackedTab, VirtualMemberMeta } from './types.ts';

interface NativeTab {
	id: string;
	type: string;
	title?: string;
	data?: { itemID?: number };
}

const MAX_COLLECTION_CACHE = 400;
const collectionNameCache = new Map<number, { stamp: string; name: string }>();

export function invalidateTabProjectionCache(): void {
	collectionNameCache.clear();
}

function resolveCachedCollectionName(display: any): string {
	const id = Number(display?.id || 0);
	const stamp = String(display?.dateModified || display?.version || '');
	if (id > 0 && stamp) {
		const hit = collectionNameCache.get(id);
		if (hit && hit.stamp === stamp) return hit.name;
	}
	const name = resolvePrimaryCollectionName(display);
	if (id > 0 && stamp) {
		if (collectionNameCache.size >= MAX_COLLECTION_CACHE) collectionNameCache.clear();
		collectionNameCache.set(id, { stamp, name });
	}
	return name;
}

function describe(key: string, itemID: number, type: string, fallbackTitle: string): VirtualMemberMeta {
	const item = itemID ? (globalThis as any).Zotero?.Items?.get?.(itemID) : null;
	const display = normalizeToRegularItem(item) || item;
	const fields = getCachedPrimaryItemFields(display, fallbackTitle || key);
	const title = fields.title || stripItemTitleMarkup(fallbackTitle) || key;
	return {
		key, itemID, parentItemID: Number(display?.id || itemID), type, title,
		shortTitle: fields.shortTitle || title,
		filename: String(item?.attachmentFilename || ''),
		source: fields.source,
		creatorYear: fields.creatorYear,
		collection: resolveCachedCollectionName(display),
	};
}

// Membership is durable. A member becomes virtual whenever its reader is absent
// from this window, irrespective of which UI closed it or when Zotero notifies us.
export function projectWorkspaceTabs(win: Window, store: WorkspaceStateStore, prefs: UnifiedPrefService): TrackedTab[] {
	const native: NativeTab[] = (win as Window & { Zotero_Tabs?: { _tabs?: NativeTab[] } }).Zotero_Tabs?._tabs ?? [];
	const live = new Set<string>();
	const rows: TrackedTab[] = [];
	const groups = new Map<string, string>();
	for (const group of store.state.groups) for (const key of group.memberKeys) groups.set(key, group.id);
	const showPins = prefs.get('workspace.enablePinnedTabs');

	function append(meta: VirtualMemberMeta, tab?: NativeTab): void {
		const { key, itemID, title } = meta;
		rows.push({
			...meta, key, itemID, title, tabID: tab?.id || '', virtual: !tab,
			parentItemID: meta.parentItemID || itemID, shortTitle: meta.shortTitle || title,
			filename: meta.filename || '', source: meta.source || '', creatorYear: meta.creatorYear || '',
			collection: meta.collection || '', groupId: groups.get(key) || '',
			pinned: Boolean(tab && showPins && store.isPinned(key)),
			sleeping: Boolean(tab && (tab.type.endsWith('-unloaded') || store.isSleeping(key))),
			remark: store.state.remarks[key] || (meta.parentItemID ? store.state.remarks[`item:${meta.parentItemID}`] : '') || '',
			lastViewedAt: store.state.lastViewedAt[key] || 0,
		});
	}
	for (const tab of native) {
		if (tab.type === 'library') continue;
		const itemID = Number(tab.data?.itemID || 0);
		const key = itemID > 0 ? `item:${itemID}` : `tab:${tab.id}`;
		live.add(key);
		append(describe(key, itemID, tab.type, tab.title || ''), tab);
	}
	if (prefs.get('workspace.enableVirtualMembers')) {
		for (const key of groups.keys()) {
			if (live.has(key)) continue;
			const match = /^item:(\d+)$/.exec(key);
			if (!match) continue;
			const cached = store.state.virtualMembers[key];
			const meta = cached
				? { ...cached, title: stripItemTitleMarkup(cached.title), shortTitle: stripItemTitleMarkup(cached.shortTitle || cached.title) }
				: describe(key, Number(match[1]), 'reader', '');
			append(meta);
		}
	}
	return disambiguateSameParentTabs(rows);
}
