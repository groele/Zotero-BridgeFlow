import { tLocale } from '../../../kernel/locale.ts';
import { GROUP_PALETTE, type TabGroup, type WorkspaceState } from '../types.ts';

export function createGroupInState(state: WorkspaceState, name: string, color?: string): TabGroup {
	const trimmed = name.trim() || tLocale('新分组', 'New Group');
	const id = `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
	const chosen = color || GROUP_PALETTE[state.groups.length % GROUP_PALETTE.length];
	const group: TabGroup = { id, name: trimmed, color: chosen, memberKeys: [] };
	state.groups.push(group);
	return group;
}

export function assignKeyRelativeInState(
	state: WorkspaceState,
	key: string,
	groupId: string | null,
	anchorKey: string,
	after: boolean,
): void {
	for (const g of state.groups) g.memberKeys = g.memberKeys.filter((k) => k !== key);
	if (!groupId) return;
	const target = state.groups.find((g) => g.id === groupId);
	if (!target) return;
	const idx = target.memberKeys.indexOf(anchorKey);
	if (idx >= 0) target.memberKeys.splice(after ? idx + 1 : idx, 0, key);
	else target.memberKeys.push(key);
}

export function renameGroupInState(state: WorkspaceState, groupId: string, name: string): boolean {
	const group = state.groups.find((g) => g.id === groupId);
	const trimmed = name.trim();
	if (!group || !trimmed) return false;
	group.name = trimmed;
	return true;
}

export function setGroupColorInState(state: WorkspaceState, groupId: string, color: string): boolean {
	const group = state.groups.find((g) => g.id === groupId);
	const trimmed = color.trim();
	if (!group || !/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return false;
	group.color = trimmed;
	return true;
}

export function removeGroupInState(state: WorkspaceState, groupId: string): boolean {
	const idx = state.groups.findIndex((g) => g.id === groupId);
	if (idx < 0) return false;
	state.groups.splice(idx, 1);
	state.collapsed = state.collapsed.filter((id) => id !== groupId);
	return true;
}

export function assignToGroupInState(state: WorkspaceState, key: string, groupId: string | null): void {
	for (const g of state.groups) g.memberKeys = g.memberKeys.filter((k) => k !== key);
	if (!groupId) return;
	const target = state.groups.find((g) => g.id === groupId);
	if (target && !target.memberKeys.includes(key)) target.memberKeys.push(key);
}

export function setCollapsedInState(state: WorkspaceState, groupId: string, collapsed: boolean): void {
	const set = new Set(state.collapsed);
	if (collapsed) set.add(groupId);
	else set.delete(groupId);
	state.collapsed = [...set];
}

export function setPinnedInState(state: WorkspaceState, key: string, pinned: boolean): void {
	const set = new Set(state.pinnedKeys);
	if (pinned) {
		set.add(key);
		state.sleepingKeys = state.sleepingKeys.filter((k) => k !== key);
	} else {
		set.delete(key);
	}
	state.pinnedKeys = [...set];
}

export function setSleepingInState(state: WorkspaceState, key: string, sleeping: boolean): void {
	if (sleeping && state.pinnedKeys.includes(key)) return;
	const set = new Set(state.sleepingKeys);
	if (sleeping) set.add(key);
	else set.delete(key);
	state.sleepingKeys = [...set];
}
