import type { WorkspaceGroupSummary } from '../../kernel/types.ts';
import { normalizeToRegularItem } from '../../services/item-resolution.ts';
import type { WorkspaceStateStore } from './store/state-store.ts';
import type { WorkspaceTabController } from './tabs/tab-controller.ts';
import type { TrackedTab } from './types.ts';

export function buildWorkspaceGroupSummaries(
	windows: Iterable<Window>,
	tabs: WorkspaceTabController,
	store: WorkspaceStateStore,
	precomputedSnapshots?: ReadonlyArray<readonly TrackedTab[]>,
): WorkspaceGroupSummary[] {
	const tabParentByKey = new Map<string, number>();
	if (precomputedSnapshots) {
		for (const list of precomputedSnapshots) {
			for (const tab of list) {
				const pid = Number(tab.parentItemID || tab.itemID || 0);
				if (pid > 0) tabParentByKey.set(tab.key, pid);
			}
		}
	} else {
		for (const win of windows) {
			for (const tab of tabs.buildTrackedTabs(win)) {
				const pid = Number(tab.parentItemID || tab.itemID || 0);
				if (pid > 0) tabParentByKey.set(tab.key, pid);
			}
		}
	}
	const hostItems = (globalThis as any).Zotero?.Items;
	const resolveRegularId = (rawId: number): number => {
		if (!Number.isSafeInteger(rawId) || rawId <= 0) return 0;
		const zItem = hostItems?.get?.(rawId);
		if (!zItem) return rawId;
		const reg = normalizeToRegularItem(zItem);
		return Number(reg?.id || 0);
	};
	const groups: WorkspaceGroupSummary[] = [];
	for (const group of store.state.groups) {
		const seen = new Set<number>();
		for (const key of group.memberKeys) {
			let rawId = tabParentByKey.get(key) || 0;
			if (!rawId) {
				const vm = store.state.virtualMembers[key];
				if (vm) rawId = Number(vm.parentItemID || vm.itemID || 0);
			}
			if (!rawId) {
				const m = key.match(/^item:(\d+)/);
				if (m) rawId = Number(m[1]);
			}
			const resolved = resolveRegularId(rawId);
			if (resolved > 0) seen.add(resolved);
		}
		groups.push({ groupId: group.id, groupName: group.name, itemIDs: [...seen] });
	}
	return groups;
}
