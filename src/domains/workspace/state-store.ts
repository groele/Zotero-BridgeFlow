import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import {
	GROUP_PALETTE, MAX_MANUAL_SESSIONS, MAX_REMARK_LENGTH, MAX_ROLLING_SESSIONS,
	type RemarkDisplayMode, type TabGroup, type TabReadingProgress, type VirtualMemberMeta, type WorkspaceSession, type WorkspaceState,
} from './types.ts';

function createEmptyState(): WorkspaceState {
	return {
		version: 1,
		groups: [],
		collapsed: [],
		pinnedKeys: [],
		sleepingKeys: [],
		remarks: {},
		remarkModes: {},
		lastViewedAt: {},
		readingProgress: {},
		virtualMembers: {},
		sessions: [],
		rollingSessions: [],
	};
}

export class WorkspaceStateStore {
	public state: WorkspaceState = createEmptyState();
	private readonly prefs: UnifiedPrefService;
	private readonly listeners = new Set<() => void>();

	constructor(prefs: UnifiedPrefService) {
		this.prefs = prefs;
		this.load();
	}

	load(): void {
		const raw = this.prefs.get('workspace.state');
		if (!raw) {
			this.state = createEmptyState();
			return;
		}
		try {
			const parsed = JSON.parse(raw);
			this.state = {
				...createEmptyState(),
				...parsed,
				groups: Array.isArray(parsed?.groups) ? parsed.groups : [],
				collapsed: Array.isArray(parsed?.collapsed) ? parsed.collapsed : [],
				pinnedKeys: Array.isArray(parsed?.pinnedKeys) ? parsed.pinnedKeys : [],
				sleepingKeys: Array.isArray(parsed?.sleepingKeys) ? parsed.sleepingKeys : [],
				remarks: parsed?.remarks && typeof parsed.remarks === 'object' ? parsed.remarks : {},
				remarkModes: parsed?.remarkModes && typeof parsed.remarkModes === 'object' ? parsed.remarkModes : {},
				lastViewedAt: parsed?.lastViewedAt && typeof parsed.lastViewedAt === 'object' ? parsed.lastViewedAt : {},
				readingProgress: parsed?.readingProgress && typeof parsed.readingProgress === 'object' ? parsed.readingProgress : {},
				virtualMembers: parsed?.virtualMembers && typeof parsed.virtualMembers === 'object' ? parsed.virtualMembers : {},
				sessions: Array.isArray(parsed?.sessions) ? parsed.sessions : [],
				rollingSessions: Array.isArray(parsed?.rollingSessions) ? parsed.rollingSessions : [],
			};
		} catch {
			this.state = createEmptyState();
		}
	}

	save(): void {
		try {
			this.prefs.set('workspace.state', JSON.stringify(this.state));
		} catch { /* ignore */ }
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

	restoreSessionLayout(session: WorkspaceSession, merge = false): void {
		if (!merge) {
			if (this.state.groups.length || this.state.pinnedKeys.length) {
				this.saveSession(`恢复前备份 · ${new Date().toLocaleTimeString()}`, { kind: 'pre-replace', rolling: true });
			}
			this.state.groups = session.groups.map((g) => ({ ...g, memberKeys: [...g.memberKeys] }));
			this.state.pinnedKeys = [...session.pinnedKeys];
			this.state.remarks = { ...this.state.remarks, ...session.remarks };
			this.save();
			return;
		}
		for (const sg of session.groups) {
			let existing = this.state.groups.find((g) => g.id === sg.id || g.name === sg.name);
			if (!existing) {
				existing = { id: sg.id, name: sg.name, color: sg.color, memberKeys: [] };
				this.state.groups.push(existing);
			}
			for (const key of sg.memberKeys) {
				if (!existing.memberKeys.includes(key)) existing.memberKeys.push(key);
			}
		}
		const pins = new Set([...this.state.pinnedKeys, ...session.pinnedKeys]);
		this.state.pinnedKeys = [...pins];
		this.state.remarks = { ...this.state.remarks, ...session.remarks };
		this.save();
	}

	collapseOtherGroups(activeGroupId: string): void {
		this.state.collapsed = this.state.groups
			.filter((g) => g.id !== activeGroupId)
			.map((g) => g.id);
		this.save();
	}

	setRemarkMode(key: string, mode: RemarkDisplayMode | ''): void {
		if (mode) this.state.remarkModes[key] = mode;
		else delete this.state.remarkModes[key];
		this.save();
	}

	updateSession(sessionId: string): boolean {
		const ses = this.state.sessions.find((s) => s.id === sessionId);
		if (!ses) return false;
		ses.createdAt = Date.now();
		ses.groups = this.state.groups.map((g) => ({ ...g, memberKeys: ses.isTemplate ? [] : [...g.memberKeys] }));
		ses.pinnedKeys = ses.isTemplate ? [] : [...this.state.pinnedKeys];
		ses.remarks = ses.isTemplate ? {} : { ...this.state.remarks };
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

	groupOfKey(key: string): string {
		const found = this.state.groups.find((g) => g.memberKeys.includes(key));
		return found ? found.id : '';
	}

	setCollapsed(groupId: string, collapsed: boolean): void {
		const set = new Set(this.state.collapsed);
		if (collapsed) set.add(groupId);
		else set.delete(groupId);
		this.state.collapsed = [...set];
		this.save();
	}

	setPinned(key: string, pinned: boolean): void {
		const set = new Set(this.state.pinnedKeys);
		if (pinned) {
			set.add(key);
			this.state.sleepingKeys = this.state.sleepingKeys.filter((k) => k !== key);
		} else {
			set.delete(key);
		}
		this.state.pinnedKeys = [...set];
		this.save();
	}

	isPinned(key: string): boolean {
		return this.state.pinnedKeys.includes(key);
	}

	setSleeping(key: string, sleeping: boolean): void {
		if (sleeping && this.isPinned(key)) return;
		const set = new Set(this.state.sleepingKeys);
		if (sleeping) set.add(key);
		else set.delete(key);
		this.state.sleepingKeys = [...set];
		this.save();
	}

	isSleeping(key: string): boolean {
		return this.state.sleepingKeys.includes(key);
	}

	setRemark(key: string, remark: string): void {
		const clean = remark.trim().slice(0, MAX_REMARK_LENGTH);
		if (clean) this.state.remarks[key] = clean;
		else delete this.state.remarks[key];
		this.save();
	}

	touchViewed(key: string, now = Date.now()): void {
		this.state.lastViewedAt[key] = now;
	}

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

	saveSession(name: string, options: { isTemplate?: boolean; rolling?: boolean; kind?: WorkspaceSession['kind'] } = {}): WorkspaceSession {
		const session: WorkspaceSession = {
			id: `ses-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
			name: name.trim() || new Date().toLocaleString(),
			createdAt: Date.now(),
			isTemplate: Boolean(options.isTemplate),
			kind: options.kind ?? (options.isTemplate ? 'template' : options.rolling ? 'rolling' : 'manual'),
			groups: this.state.groups.map((g) => ({
				...g,
				memberKeys: options.isTemplate ? [] : [...g.memberKeys],
			})),
			pinnedKeys: options.isTemplate ? [] : [...this.state.pinnedKeys],
			remarks: options.isTemplate ? {} : { ...this.state.remarks },
		};
		if (options.rolling) {
			this.state.rollingSessions.unshift(session);
			this.state.rollingSessions = this.state.rollingSessions.slice(0, MAX_ROLLING_SESSIONS);
		} else {
			this.state.sessions.unshift(session);
			this.state.sessions = this.state.sessions.slice(0, MAX_MANUAL_SESSIONS);
		}
		this.save();
		return session;
	}

	exportJson(): string {
		return JSON.stringify({ format: 'zotero-bridgeflow-workspace', version: 1, state: this.state }, null, 2);
	}

	importJson(jsonText: string): boolean {
		try {
			const parsed = JSON.parse(jsonText);
			const incoming = parsed?.state ?? parsed;
			if (!incoming || !Array.isArray(incoming.groups)) return false;
			this.state = { ...createEmptyState(), ...incoming };
			this.save();
			return true;
		} catch {
			return false;
		}
	}
}
