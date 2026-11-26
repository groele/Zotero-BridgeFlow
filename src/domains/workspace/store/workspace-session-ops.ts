import { isRegularValidItem } from '../../../services/item-resolution.ts';
import {
	hasLegacyReadingNotes,
	pickReadingNotesState,
	pickWorkspaceLayoutState,
} from './workspace-schema.ts';
import type { WorkspaceDiskCache } from './workspace-disk-cache.ts';
import type { ReadingProgressDiskCache } from './reading-progress-cache.ts';
import type { BriefNotesDiskCache } from './brief-notes-cache.ts';
import {
	MAX_MANUAL_SESSIONS,
	MAX_REMARK_LENGTH,
	MAX_ROLLING_SESSIONS,
	type VirtualMemberMeta,
	type WorkspaceSession,
	type WorkspaceState,
} from '../types.ts';

function assignSafeRecord<T>(target: Record<string, T>, source: Record<string, T>): void {
	for (const [k, val] of Object.entries(source)) {
		if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
		target[k] = val;
	}
}

export async function hydrateWorkspaceDiskCaches(store: {
	state: WorkspaceState;
	readOnlyGuard: boolean;
	legacyMigrationPending: boolean;
	flushLayoutToDisk(): Promise<boolean>;
	diskCache: WorkspaceDiskCache;
	readingCache: ReadingProgressDiskCache;
	notesCache: BriefNotesDiskCache;
	save(immediateDisk?: boolean): void;
}): Promise<boolean> {
	const [diskLayout, diskReading, diskNotes] = await Promise.all([
		store.diskCache.loadFromDisk(),
		store.readingCache.loadFromDisk(),
		store.notesCache.loadFromDisk(),
	]);
	const hadLegacy = hasLegacyReadingNotes(store.state) || hasLegacyReadingNotes(diskLayout);
	let layoutChanged = false;
	let readingChanged = false;
	let notesChanged = false;

	if (store.readOnlyGuard && diskLayout) {
		const memoryNotes = pickReadingNotesState(store.state);
		store.state = diskLayout;
		store.readingCache.mergeDurableState(store.state, memoryNotes);
		store.notesCache.mergeDurableState(store.state, memoryNotes);
		store.readOnlyGuard = false;
		layoutChanged = true;
	} else if (diskLayout && store.diskCache.mergeDurableState(store.state, diskLayout)) {
		layoutChanged = true;
	}
	if (diskReading && store.readingCache.mergeDurableState(store.state, diskReading)) readingChanged = true;
	if (diskNotes && store.notesCache.mergeDurableState(store.state, diskNotes)) notesChanged = true;

	if (hadLegacy) {
		const saved = await Promise.all([
			store.readingCache.flushNow(store.state),
			store.notesCache.flushNow(store.state),
		]);
		store.legacyMigrationPending = !saved.every(Boolean);
		store.save(true);
		if (!store.legacyMigrationPending) await store.flushLayoutToDisk();
		return true;
	}
	if (layoutChanged || store.diskCache.loadedFromLegacy) store.save(true);
	else if (!diskLayout && !store.readOnlyGuard) store.diskCache.scheduleSave(pickWorkspaceLayoutState(store.state), true);
	if (readingChanged || store.readingCache.loadedFromLegacy || (!diskReading && Object.keys(store.state.readingProgress).length)) {
		await store.readingCache.flushNow(store.state);
	}
	if (notesChanged || store.notesCache.loadedFromLegacy || (!diskNotes && Object.keys(store.state.remarks).length)) {
		await store.notesCache.flushNow(store.state);
	}
	return layoutChanged || readingChanged || notesChanged;
}

export function groupOfStateKey(state: WorkspaceState, key: string): string {
	return state.groups.find((g) => g.memberKeys.includes(key))?.id || '';
}

export function captureWorkspaceLayout(state: WorkspaceState, groupId?: string, template = false) {
	const inScope = (key: string) => !groupId || groupOfStateKey(state, key) === groupId;
	const scopedRecord = <T>(record: Record<string, T>): Record<string, T> =>
		template ? {} : Object.fromEntries(Object.entries(record).filter(([key]) => inScope(key)));
	return {
		groups: state.groups.filter((g) => !groupId || g.id === groupId).map((g) => ({ ...g, memberKeys: template ? [] : [...g.memberKeys] })),
		collapsed: state.collapsed.filter((id) => !groupId || id === groupId),
		pinnedKeys: template ? [] : state.pinnedKeys.filter(inScope),
		remarks: scopedRecord(state.remarks),
		remarkModes: scopedRecord(state.remarkModes),
		virtualMembers: scopedRecord(state.virtualMembers),
	};
}

export function applySessionLayoutToState(
	state: WorkspaceState,
	session: WorkspaceSession,
	merge: boolean,
): boolean {
	const hasNotes = Boolean(Object.keys(session.remarks).length || Object.keys(session.remarkModes).length);
	if (!merge) {
		state.groups = session.groups.map((g) => ({ ...g, memberKeys: [...g.memberKeys] }));
		state.pinnedKeys = [...session.pinnedKeys];
		state.collapsed = [...session.collapsed];
		state.virtualMembers = { ...session.virtualMembers };
		assignSafeRecord(state.remarks, session.remarks);
		assignSafeRecord(state.remarkModes, session.remarkModes);
		return hasNotes;
	}
	for (const sg of session.groups) {
		let existing = state.groups.find((g) => g.id === sg.id || g.name === sg.name);
		if (!existing) {
			existing = { id: sg.id, name: sg.name, color: sg.color, memberKeys: [] };
			state.groups.push(existing);
		}
		if (session.collapsed.includes(sg.id) && !state.collapsed.includes(existing.id)) state.collapsed.push(existing.id);
		for (const key of sg.memberKeys) {
			if (!groupOfStateKey(state, key)) existing.memberKeys.push(key);
		}
	}
	state.virtualMembers = { ...session.virtualMembers, ...state.virtualMembers };
	state.remarkModes = { ...session.remarkModes, ...state.remarkModes };
	state.pinnedKeys = [...new Set([...state.pinnedKeys, ...session.pinnedKeys])];
	state.remarks = { ...state.remarks, ...session.remarks };
	return hasNotes;
}

export function saveWorkspaceSessionRecord(
	state: WorkspaceState,
	name: string,
	options: { groupId?: string; openKeys?: string[]; isTemplate?: boolean; rolling?: boolean; kind?: WorkspaceSession['kind'] } = {},
): WorkspaceSession {
	const cleanName = name.trim() || new Date().toLocaleString();
	const captured = captureWorkspaceLayout(state, options.groupId, options.isTemplate);
	const openKeyList = options.isTemplate ? [] : options.groupId
		? [...new Set([...(options.openKeys || []), ...captured.groups.flatMap((g) => g.memberKeys)])]
		: [...new Set(options.openKeys || [])];
	const existingIdx = !options.rolling && !options.isTemplate && options.groupId
		? state.sessions.findIndex((s) => !s.isTemplate && (s.scopedGroupId === options.groupId || s.name === cleanName)) : -1;
	const prior = existingIdx >= 0 ? state.sessions[existingIdx] : null;
	const session: WorkspaceSession = {
		id: prior?.id || `ses-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
		name: cleanName,
		createdAt: Date.now(),
		scopedGroupId: options.groupId ?? prior?.scopedGroupId,
		isTemplate: Boolean(options.isTemplate),
		openKeys: openKeyList,
		kind: options.kind ?? (options.isTemplate ? 'template' : options.rolling ? 'rolling' : 'manual'),
		...captured,
		virtualMembers: options.isTemplate ? {} : { ...(prior?.virtualMembers || {}), ...captured.virtualMembers },
	};
	if (options.rolling) {
		const priorPreReplace = session.kind !== 'pre-replace'
			? state.rollingSessions.find((s) => s.kind === 'pre-replace')
			: undefined;
		state.rollingSessions.unshift(session);
		state.rollingSessions = state.rollingSessions.slice(0, MAX_ROLLING_SESSIONS);
		if (priorPreReplace && !state.rollingSessions.some((s) => s.kind === 'pre-replace') && state.rollingSessions.length >= MAX_ROLLING_SESSIONS) {
			state.rollingSessions[state.rollingSessions.length - 1] = priorPreReplace;
		}
	} else {
		if (existingIdx >= 0) state.sessions.splice(existingIdx, 1);
		state.sessions.unshift(session);
		state.sessions = state.sessions.slice(0, MAX_MANUAL_SESSIONS);
	}
	return session;
}

function childAttachmentIDs(item: any): number[] {
	return isRegularValidItem(item) ? item.getAttachments?.() || [] : [];
}

export function getNormalizedItemRemark(state: WorkspaceState, itemID: number): string {
	if (!Number.isInteger(itemID) || itemID <= 0) return '';
	const direct = state.remarks[`item:${itemID}`];
	if (direct) return direct;
	const hostItems = (globalThis as any).Zotero?.Items;
	const item = hostItems?.get?.(itemID);
	if (item && (item.isAttachment?.() || item.isNote?.()) && item.parentItemID) {
		const parentRemark = state.remarks[`item:${item.parentItemID}`];
		if (parentRemark) return parentRemark;
	}
	const attIDs: number[] = childAttachmentIDs(item);
	for (const attID of attIDs) {
		const childRemark = state.remarks[`item:${attID}`];
		if (childRemark) return childRemark;
	}
	for (const [k, vm] of Object.entries(state.virtualMembers)) {
		if (vm.parentItemID === itemID && state.remarks[k]) return state.remarks[k];
	}
	return '';
}

export function setNormalizedItemRemark(
	state: WorkspaceState,
	itemID: number,
	remark: string,
	maxLen = MAX_REMARK_LENGTH,
): boolean {
	if (!Number.isInteger(itemID) || itemID <= 0) return false;
	const clean = remark.trim().slice(0, maxLen);
	const hostItems = (globalThis as any).Zotero?.Items;
	const item = hostItems?.get?.(itemID);
	const canonicalID = item && (item.isAttachment?.() || item.isNote?.()) && Number(item.parentItemID) > 0
		? Number(item.parentItemID)
		: itemID;
	const canonicalKey = `item:${canonicalID}`;
	const relatedKeys = new Set<string>();
	if (canonicalID !== itemID) relatedKeys.add(`item:${itemID}`);
	const parentObj = canonicalID === itemID ? item : hostItems?.get?.(canonicalID);
	const attIDs: number[] = childAttachmentIDs(parentObj);
	for (const attID of attIDs) {
		if (Number(attID) > 0 && Number(attID) !== canonicalID) relatedKeys.add(`item:${attID}`);
	}
	for (const [k, vm] of Object.entries(state.virtualMembers)) {
		if (vm.parentItemID === canonicalID && k !== canonicalKey) relatedKeys.add(k);
	}
	let changed = false;
	if (clean) {
		if (state.remarks[canonicalKey] !== clean) {
			state.remarks[canonicalKey] = clean;
			changed = true;
		}
	} else if (canonicalKey in state.remarks) {
		delete state.remarks[canonicalKey];
		changed = true;
	}
	for (const rk of relatedKeys) {
		if (rk in state.remarks) {
			delete state.remarks[rk];
			changed = true;
		}
	}
	return changed;
}

export function mergeImportedWorkspaceState(
	current: WorkspaceState,
	imported: WorkspaceState,
): { state: WorkspaceState; hasReading: boolean; hasNotes: boolean } {
	const hasReading = Boolean(Object.keys(imported.readingProgress).length || Object.keys(imported.lastViewedAt).length);
	const hasNotes = Boolean(Object.keys(imported.remarks).length || Object.keys(imported.remarkModes).length);
	const state: WorkspaceState = {
		...imported,
		lastViewedAt: { ...current.lastViewedAt, ...imported.lastViewedAt },
		readingProgress: { ...current.readingProgress, ...imported.readingProgress },
		remarks: { ...current.remarks, ...imported.remarks },
		remarkModes: { ...current.remarkModes, ...imported.remarkModes },
	};
	return { state, hasReading, hasNotes };
}

export function saveVirtualMembersToState(state: WorkspaceState, metas: readonly VirtualMemberMeta[]): boolean {
	let changed = false;
	for (const meta of metas) {
		const prev = state.virtualMembers[meta.key];
		if (!prev || prev.title !== meta.title || prev.shortTitle !== meta.shortTitle || prev.filename !== meta.filename
			|| prev.source !== meta.source || prev.creatorYear !== meta.creatorYear || prev.collection !== meta.collection
			|| prev.parentItemID !== meta.parentItemID || prev.itemID !== meta.itemID || prev.type !== meta.type) {
			state.virtualMembers[meta.key] = meta;
			changed = true;
		}
	}
	return changed;
}
