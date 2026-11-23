import { readWorkspace, readBackup } from './workspace-schema.ts';
import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import { WorkspaceDiskCache } from './workspace-disk-cache.ts';
import {
	GROUP_PALETTE, MAX_MANUAL_SESSIONS, MAX_REMARK_LENGTH, MAX_ROLLING_SESSIONS,
	type RemarkDisplayMode, type TabGroup, type TabReadingProgress, type VirtualMemberMeta, type WorkspaceSession, type WorkspaceState,
} from './types.ts';

function createEmptyState(): WorkspaceState {
	return {
		version: 2, groups: [], collapsed: [], pinnedKeys: [], sleepingKeys: [],
		remarks: {}, remarkModes: {}, lastViewedAt: {}, readingProgress: {},
		virtualMembers: {}, sessions: [], rollingSessions: [],
	};
}

export class WorkspaceStateStore {
	public state: WorkspaceState = createEmptyState();
	public readonly diskCache = new WorkspaceDiskCache();
	public readOnlyGuard = false;
	private readonly prefs: UnifiedPrefService;
	private readonly listeners = new Set<() => void>();

	constructor(prefs: UnifiedPrefService) {
		this.prefs = prefs;
		this.load();
	}

	load(): void {
		const raw = this.prefs.get('workspace.document');
		if (!raw) {
			this.state = createEmptyState();
			this.readOnlyGuard = false;
			return;
		}
		try {
			this.state = readWorkspace(raw);
			this.readOnlyGuard = false;
		} catch {
			// Fail-closed: preserve previous memory/disk state if pref JSON is corrupted
			this.readOnlyGuard = true;
		}
	}

	async initDiskCache(): Promise<boolean> {
		const diskState = await this.diskCache.loadFromDisk();
		if (!diskState) {
			if (!this.readOnlyGuard) this.diskCache.scheduleSave(this.state, true);
			return false;
		}
		if (this.readOnlyGuard) {
			this.state = diskState;
			this.readOnlyGuard = false;
			this.save(true);
			return true;
		}
		if (this.diskCache.mergeDurableState(this.state, diskState)) {
			this.save(true);
			return true;
		}
		this.diskCache.scheduleSave(this.state, false);
		return false;
	}

	save(immediateDisk = false): void {
		if (!this.readOnlyGuard) {
			try { this.prefs.set('workspace.document', JSON.stringify(this.state)); } catch { /* ignore */ }
			this.diskCache.scheduleSave(this.state, immediateDisk);
		}
		for (const fn of this.listeners) {
			try { fn(); } catch { /* ignore */ }
		}
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	createGroup(name: string, color?: string): TabGroup {
		const trimmed = name.trim() || '新分组';
		const id = `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
		const chosen = color || GROUP_PALETTE[this.state.groups.length % GROUP_PALETTE.length];
		const group: TabGroup = { id, name: trimmed, color: chosen, memberKeys: [] };
		this.state.groups.push(group);
		this.save();
		return group;
	}

	assignKeyRelative(key: string, groupId: string | null, anchorKey: string, after: boolean): void {
		for (const g of this.state.groups) {
			g.memberKeys = g.memberKeys.filter((k) => k !== key);
		}
		if (groupId) {
			const target = this.state.groups.find((g) => g.id === groupId);
			if (target) {
				const idx = target.memberKeys.indexOf(anchorKey);
				if (idx >= 0) {
					target.memberKeys.splice(after ? idx + 1 : idx, 0, key);
				} else {
					target.memberKeys.push(key);
				}
			}
		}
		this.save();
	}

	deleteSession(sessionId: string): boolean {
		const before = this.state.sessions.length + this.state.rollingSessions.length;
		this.state.sessions = this.state.sessions.filter((s) => s.id !== sessionId);
		this.state.rollingSessions = this.state.rollingSessions.filter((s) => s.id !== sessionId);
		if (this.state.sessions.length + this.state.rollingSessions.length === before) return false;
		this.save();
		return true;
	}

	renameGroup(groupId: string, name: string): boolean {
		const group = this.state.groups.find((g) => g.id === groupId);
		const trimmed = name.trim();
		if (!group || !trimmed) return false;
		group.name = trimmed;
		this.save();
		return true;
	}

	setGroupColor(groupId: string, color: string): boolean {
		const group = this.state.groups.find((g) => g.id === groupId);
		if (!group || !color) return false;
		group.color = color;
		this.save();
		return true;
	}

	restoreSessionLayout(session: WorkspaceSession, merge = false, openKeys: string[] = []): void {
		if (!merge) {
			if (openKeys.length || this.state.groups.length || this.state.pinnedKeys.length) {
				this.saveSession(`恢复前备份 · ${new Date().toLocaleTimeString()}`, { kind: 'pre-replace', rolling: true, openKeys });
			}
			this.state.groups = session.groups.map((g) => ({ ...g, memberKeys: [...g.memberKeys] }));
			this.state.pinnedKeys = [...session.pinnedKeys];
			this.state.collapsed = [...session.collapsed];
			this.state.virtualMembers = { ...session.virtualMembers };
			this.state.remarks = { ...session.remarks };
			this.state.remarkModes = { ...session.remarkModes };
			this.save();
			return;
		}
		for (const sg of session.groups) {
			let existing = this.state.groups.find((g) => g.id === sg.id || g.name === sg.name);
			if (!existing) {
				existing = { id: sg.id, name: sg.name, color: sg.color, memberKeys: [] };
				this.state.groups.push(existing);
			}
			if (session.collapsed.includes(sg.id) && !this.state.collapsed.includes(existing.id)) this.state.collapsed.push(existing.id);
			for (const key of sg.memberKeys) {
				if (!this.groupOfKey(key)) existing.memberKeys.push(key);
			}
		}
		this.state.virtualMembers = { ...session.virtualMembers, ...this.state.virtualMembers };
		this.state.remarkModes = { ...session.remarkModes, ...this.state.remarkModes };
		const pins = new Set([...this.state.pinnedKeys, ...session.pinnedKeys]);
		this.state.pinnedKeys = [...pins];
		this.state.remarks = { ...this.state.remarks, ...session.remarks };
		this.save();
	}

	collapseOtherGroups(activeGroupId: string): void {
		this.state.collapsed = this.state.groups.filter((g) => g.id !== activeGroupId).map((g) => g.id);
		this.save();
	}

	setRemarkMode(key: string, mode: RemarkDisplayMode | ''): void {
		if (mode) this.state.remarkModes[key] = mode;
		else delete this.state.remarkModes[key];
		this.save();
	}

	groupOfKey(key: string): string {
		return this.state.groups.find((g) => g.memberKeys.includes(key))?.id || '';
	}

	setCollapsed(groupId: string, collapsed: boolean): void {
		const set = new Set(this.state.collapsed);
		if (collapsed) set.add(groupId);
		else set.delete(groupId);
		this.state.collapsed = [...set];
		this.save();
	}

	updateSession(sessionId: string, openKeys?: string[]): boolean {
		const ses = this.state.sessions.find((s) => s.id === sessionId);
		if (!ses) return false;
		ses.createdAt = Date.now();
		const inScope = (key: string) => !ses.scopedGroupId || this.groupOfKey(key) === ses.scopedGroupId;
		if (openKeys) ses.openKeys = ses.isTemplate ? [] : [...new Set(openKeys)].filter(inScope);
		Object.assign(ses, this.captureLayout(ses.scopedGroupId, ses.isTemplate));
		this.save();
		return true;
	}

	renameSession(sessionId: string, name: string): boolean {
		const trimmed = name.trim();
		const ses = this.state.sessions.find((s) => s.id === sessionId);
		if (!ses || !trimmed) return false;
		ses.name = trimmed;
		this.save();
		return true;
	}

	promoteRollingSession(sessionId: string): boolean {
		const idx = this.state.rollingSessions.findIndex((s) => s.id === sessionId);
		if (idx < 0) return false;
		const [item] = this.state.rollingSessions.splice(idx, 1);
		this.state.sessions.unshift({ ...item, kind: 'manual' });
		this.state.sessions = this.state.sessions.slice(0, MAX_MANUAL_SESSIONS);
		this.save();
		return true;
	}

	removeGroup(groupId: string): boolean {
		const idx = this.state.groups.findIndex((g) => g.id === groupId);
		if (idx < 0) return false;
		this.state.groups.splice(idx, 1);
		this.state.collapsed = this.state.collapsed.filter((id) => id !== groupId);
		this.save();
		return true;
	}

	assignToGroup(key: string, groupId: string | null): void {
		for (const g of this.state.groups) {
			g.memberKeys = g.memberKeys.filter((k) => k !== key);
		}
		if (groupId) {
			const target = this.state.groups.find((g) => g.id === groupId);
			if (target && !target.memberKeys.includes(key)) {
				target.memberKeys.push(key);
			}
		}
		this.save();
	}

	setPinned(key: string, pinned: boolean): void {
		const set = new Set(this.state.pinnedKeys);
		if (pinned) { set.add(key); this.state.sleepingKeys = this.state.sleepingKeys.filter((k) => k !== key); }
		else { set.delete(key); }
		this.state.pinnedKeys = [...set];
		this.save();
	}

	isPinned(key: string): boolean { return this.state.pinnedKeys.includes(key); }

	setSleeping(key: string, sleeping: boolean): void {
		if (sleeping && this.isPinned(key)) return;
		const set = new Set(this.state.sleepingKeys);
		if (sleeping) set.add(key);
		else set.delete(key);
		this.state.sleepingKeys = [...set];
		this.save();
	}

	isSleeping(key: string): boolean { return this.state.sleepingKeys.includes(key); }

	setRemark(key: string, remark: string): void {
		const clean = remark.trim().slice(0, MAX_REMARK_LENGTH);
		if (clean) this.state.remarks[key] = clean;
		else delete this.state.remarks[key];
		this.save();
	}

	touchViewed(key: string, now = Date.now()): void { this.state.lastViewedAt[key] = now; }

	updateReadingProgress(key: string, deltaSeconds: number, lastPage?: number, totalPages?: number): TabReadingProgress {
		const prev = this.state.readingProgress[key] ?? { readSeconds: 0 };
		const next: TabReadingProgress = {
			readSeconds: Math.max(0, (prev.readSeconds || 0) + Math.max(0, deltaSeconds)),
			...(lastPage && lastPage > 0 ? { lastPage } : prev.lastPage ? { lastPage: prev.lastPage } : {}),
			...(totalPages && totalPages > 0 ? { totalPages } : prev.totalPages ? { totalPages: prev.totalPages } : {}),
		};
		this.state.readingProgress[key] = next;
		return next;
	}

	saveVirtualMember(meta: VirtualMemberMeta): void {
		this.state.virtualMembers[meta.key] = meta;
		this.save();
	}

	removeVirtualMember(key: string): void {
		if (!(key in this.state.virtualMembers)) return;
		delete this.state.virtualMembers[key];
		this.save();
	}

	private captureLayout(groupId?: string, template = false) {
		const inScope = (key: string) => !groupId || this.groupOfKey(key) === groupId;
		const scopedRecord = <T>(record: Record<string, T>): Record<string, T> =>
			template ? {} : Object.fromEntries(Object.entries(record).filter(([key]) => inScope(key)));
		return {
			groups: this.state.groups.filter(g => !groupId || g.id === groupId)
				.map(g => ({ ...g, memberKeys: template ? [] : [...g.memberKeys] })),
			collapsed: this.state.collapsed.filter(id => !groupId || id === groupId),
			pinnedKeys: template ? [] : this.state.pinnedKeys.filter(inScope),
			remarks: scopedRecord(this.state.remarks),
			remarkModes: scopedRecord(this.state.remarkModes),
			virtualMembers: scopedRecord(this.state.virtualMembers),
		};
	}

	saveSession(name: string, options: { groupId?: string; openKeys?: string[]; isTemplate?: boolean; rolling?: boolean; kind?: WorkspaceSession['kind'] } = {}): WorkspaceSession {
		const cleanName = name.trim() || new Date().toLocaleString();
		const captured = this.captureLayout(options.groupId, options.isTemplate);
		const openKeyList = options.isTemplate
			? []
			: options.groupId
				? [...new Set([...(options.openKeys || []), ...captured.groups.flatMap((g) => g.memberKeys)])]
				: [...new Set(options.openKeys || [])];
		const existingIdx = !options.rolling && !options.isTemplate && options.groupId
			? this.state.sessions.findIndex((s) => !s.isTemplate && (s.scopedGroupId === options.groupId || s.name === cleanName))
			: -1;
		const prior = existingIdx >= 0 ? this.state.sessions[existingIdx] : null;
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
			this.state.rollingSessions.unshift(session);
			this.state.rollingSessions = this.state.rollingSessions.slice(0, MAX_ROLLING_SESSIONS);
		} else {
			if (existingIdx >= 0) this.state.sessions.splice(existingIdx, 1);
			this.state.sessions.unshift(session);
			this.state.sessions = this.state.sessions.slice(0, MAX_MANUAL_SESSIONS);
		}
		this.save(true);
		return session;
	}

	exportJson(): string {
		return JSON.stringify({ format: 'zotero-bridgeflow-workspace', version: 2, state: this.state }, null, 2);
	}

	importJson(jsonText: string): boolean {
		try {
			this.state = readBackup(jsonText);
			this.readOnlyGuard = false;
			this.save(true);
			return true;
		} catch {
			return false;
		}
	}
}
