import type { UnifiedPrefService } from '../../../kernel/pref-service.ts';
import { isHostTabBusy } from '../../../services/host/index.ts';
import type { WorkspaceStateStore } from '../store/state-store.ts';
import { buildVirtualMetaFromTracked, type ClosedTabRecord } from './tab-actions-helpers.ts';
import type { TabCloseOptions, TrackedTab } from '../types.ts';

export function isTabBusy(win: Window, id: string): boolean {
	return isHostTabBusy(win, id);
}

export async function closeWorkspaceTabs(
	win: Window, tabIDs: readonly string[], options: TabCloseOptions, tracked: readonly TrackedTab[],
	store: WorkspaceStateStore, prefs: UnifiedPrefService, closedStack: ClosedTabRecord[],
): Promise<number> {
	const tabsApi = (win as any).Zotero_Tabs;
	if (!tabsApi?.close || !tabIDs.length) return 0;
	const selectedID = String(tabsApi.selectedID || '');
	const trackedByID = new Map(tracked.map((t) => [t.tabID, t]));
	const toClose: string[] = [];

	for (const id of new Set(tabIDs)) {
		const t = trackedByID.get(id);
		if (!t || t.virtual) continue;
		if (options.protectPinned && t.pinned) continue;
		if (options.protectSelected && id === selectedID) continue;
		if (options.protectMedia !== false && isTabBusy(win, id)) continue;
		toClose.push(id);
	}
	if (!toClose.length) return 0;
	await tabsApi.close(toClose.length === 1 ? toClose[0] : toClose);
	for (const id of toClose) {
		const t = trackedByID.get(id)!;
		if (t.groupId && !store.state.virtualMembers[t.key] && (options.preserveVirtual ?? true) && prefs.get('workspace.enableVirtualMembers')) {
			store.saveVirtualMember(buildVirtualMetaFromTracked(t));
		}
		if (t.itemID > 0) {
			closedStack.push({ key: t.key, itemID: t.itemID, groupId: t.groupId, title: t.title, closedAt: Date.now() });
			if (closedStack.length > 20) closedStack.shift();
		}
		if (options.preserveVirtual === false && t.groupId) {
			store.removeVirtualMember(t.key);
			store.assignToGroup(t.key, null);
		}
		if (t.pinned) store.setPinned(t.key, false);
		if (t.sleeping) store.setSleeping(t.key, false);
	}
	return toClose.length;
}
