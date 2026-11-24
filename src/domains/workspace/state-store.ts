import {
	pickBriefNotesState,
	pickReadingNotesState,
	pickReadingProgressState,
	pickWorkspaceLayoutState,
	readBackup,
	readBriefNotesBackup,
	readReadingProgressBackup,
	readWorkspace,
} from './workspace-schema.ts';
import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import { tLocale } from '../../kernel/locale.ts';
import { WorkspaceDiskCache } from './workspace-disk-cache.ts';
import { ReadingProgressDiskCache } from './reading-progress-cache.ts';
import { BriefNotesDiskCache } from './brief-notes-cache.ts';
import { mergePageSeconds } from '../../services/reading-stats.ts';
import {
	applySessionLayoutToState,
	captureWorkspaceLayout,
	groupOfStateKey,
	hydrateWorkspaceDiskCaches,
	saveWorkspaceSessionRecord,
} from './workspace-session-ops.ts';
import {
	GROUP_PALETTE, MAX_MANUAL_SESSIONS, MAX_REMARK_LENGTH,
	type RemarkDisplayMode, type TabGroup, type TabReadingProgress, type VirtualMemberMeta, type WorkspaceSession, type WorkspaceState,
} from './types.ts';

type StoreChange = 'data' | 'session';

const createEmptyState = (): WorkspaceState => ({
	version: 2, groups: [], collapsed: [], pinnedKeys: [], sleepingKeys: [],
	remarks: {}, remarkModes: {}, lastViewedAt: {}, readingProgress: {},
	virtualMembers: {}, sessions: [], rollingSessions: [],
});

export class WorkspaceStateStore {
	public state: WorkspaceState = createEmptyState();
	public readonly diskCache: WorkspaceDiskCache;
	public readonly readingCache: ReadingProgressDiskCache;
	public readonly notesCache: BriefNotesDiskCache;
	public readOnlyGuard = false;
	private readonly prefs: UnifiedPrefService;
	private readonly listeners = new Set<(change: StoreChange) => void>();

	constructor(prefs: UnifiedPrefService) {
		this.prefs = prefs;
		const customDir = prefs.get('inspector.lookup.cacheDirectory');
		this.diskCache = new WorkspaceDiskCache(customDir);
		this.readingCache = new ReadingProgressDiskCache(customDir);
		this.notesCache = new BriefNotesDiskCache(customDir);
		this.load();
	}

	load(): void {
		const prevProgress = pickReadingProgressState(this.state);
		const prevNotes = pickBriefNotesState(this.state);
		const raw = this.prefs.get('workspace.document');
		if (!raw) {
			this.state = { ...createEmptyState(), ...prevProgress, ...prevNotes };
			this.readOnlyGuard = false;
			return;
		}
		try {
			this.state = readWorkspace(raw);
			this.readingCache.mergeDurableState(this.state, prevProgress);
			this.notesCache.mergeDurableState(this.state, prevNotes);
			this.readOnlyGuard = false;
		} catch {
			// Fail-closed: preserve previous memory/disk state if pref JSON is corrupted
			this.readOnlyGuard = true;
		}
	}

	async initDiskCache(): Promise<boolean> {
		return hydrateWorkspaceDiskCaches(this);
	}

	save(immediateDisk = false, change: StoreChange = 'data'): void {
		if (!this.readOnlyGuard) {
			const layoutOnly = pickWorkspaceLayoutState(this.state);
			const serialized = JSON.stringify(layoutOnly);
			try { this.prefs.set('workspace.document', serialized); } catch { /* ignore */ }
			this.diskCache.scheduleSave(layoutOnly, immediateDisk, serialized);
		}
		this.emitChange(change);
	}

	saveReadingProgress(immediateDisk = false): void {
		this.readingCache.scheduleSave(this.state, immediateDisk);
		this.emitChange();
	}

	saveBriefNotes(immediateDisk = false): void {
		this.notesCache.scheduleSave(this.state, immediateDisk);
		this.emitChange();
	}

	private emitChange(change: StoreChange = 'data'): void {
		for (const fn of this.listeners) {
			try { fn(change); } catch { /* ignore */ }
		}
	}

	onChange(listener: (change: StoreChange) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	clearWorkspaceLayout(): void {
		const notes = pickReadingNotesState(this.state);
		this.state = { ...createEmptyState(), ...notes };
		this.readOnlyGuard = false;
		this.save(true);
	}

	clearReadingProgress(): void {
		this.state.lastViewedAt = {};
		this.state.readingProgress = {};
		this.saveReadingProgress(true);
	}

	clearBriefNotes(): void {
		this.state.remarks = {};
		this.state.remarkModes = {};
		this.saveBriefNotes(true);
	}

	createGroup(name: string, color?: string): TabGroup {
		const trimmed = name.trim() || tLocale('新分组', 'New Group');
		const id = `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
		const chosen = color || GROUP_PALETTE[this.state.groups.length % GROUP_PALETTE.length];
		const group: TabGroup = { id, name: trimmed, color: chosen, memberKeys: [] };
		this.state.groups.push(group);
		this.save();
		return group;
	}

	assignKeyRelative(key: string, groupId: string | null, anchorKey: string, after: boolean): void {
		for (const g of this.state.groups) g.memberKeys = g.memberKeys.filter((k) => k !== key);
		if (groupId) {
			const target = this.state.groups.find((g) => g.id === groupId);
			if (target) {
				const idx = target.memberKeys.indexOf(anchorKey);
				if (idx >= 0) target.memberKeys.splice(after ? idx + 1 : idx, 0, key);
				else target.memberKeys.push(key);
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
		if (!merge && (openKeys.length || this.state.groups.length || this.state.pinnedKeys.length)) {
			const time = new Date().toLocaleTimeString();
			this.saveSession(tLocale(`恢复前备份 · ${time}`, `Pre-restore Backup · ${time}`), { kind: 'pre-replace', rolling: true, openKeys });
		}
		const hasNotes = applySessionLayoutToState(this.state, session, merge);
		this.save();
		if (hasNotes) this.saveBriefNotes();
	}

	collapseOtherGroups(activeGroupId: string): void {
		this.state.collapsed = this.state.groups.filter((g) => g.id !== activeGroupId).map((g) => g.id);
		this.save();
	}

	setRemarkMode(key: string, mode: RemarkDisplayMode | ''): void {
		if (mode) this.state.remarkModes[key] = mode;
		else delete this.state.remarkModes[key];
		this.saveBriefNotes();
	}

	groupOfKey(key: string): string { return groupOfStateKey(this.state, key); }

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
		Object.assign(ses, captureWorkspaceLayout(this.state, ses.scopedGroupId, ses.isTemplate));
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
		for (const g of this.state.groups) g.memberKeys = g.memberKeys.filter((k) => k !== key);
		if (groupId) {
			const target = this.state.groups.find((g) => g.id === groupId);
			if (target && !target.memberKeys.includes(key)) target.memberKeys.push(key);
		}
		this.save();
	}

	setPinned(key: string, pinned: boolean): void {
		const set = new Set(this.state.pinnedKeys);
		if (pinned) { set.add(key); this.state.sleepingKeys = this.state.sleepingKeys.filter((k) => k !== key); }
		else set.delete(key);
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
		this.saveBriefNotes();
	}

	touchViewed(key: string, now = Date.now()): void { this.state.lastViewedAt[key] = now; }

	updateReadingProgress(key: string, deltaSeconds: number, lastPage?: number, totalPages?: number): TabReadingProgress {
		const prev = this.state.readingProgress[key] ?? { readSeconds: 0 };
		const pageSeconds = mergePageSeconds(prev.pageSeconds, lastPage, deltaSeconds);
		return (this.state.readingProgress[key] = {
			readSeconds: Math.max(0, (prev.readSeconds || 0) + Math.max(0, deltaSeconds)),
			...(lastPage && lastPage > 0 ? { lastPage } : prev.lastPage ? { lastPage: prev.lastPage } : {}),
			...(totalPages && totalPages > 0 ? { totalPages } : prev.totalPages ? { totalPages: prev.totalPages } : {}),
			...(pageSeconds ? { pageSeconds } : {}),
		});
	}

	saveVirtualMember(meta: VirtualMemberMeta): void { this.state.virtualMembers[meta.key] = meta; this.save(); }

	removeVirtualMember(key: string): void {
		if (!(key in this.state.virtualMembers)) return;
		delete this.state.virtualMembers[key];
		this.save();
	}

	saveSession(name: string, options: { groupId?: string; openKeys?: string[]; isTemplate?: boolean; rolling?: boolean; kind?: WorkspaceSession['kind'] } = {}): WorkspaceSession {
		const session = saveWorkspaceSessionRecord(this.state, name, options);
		this.save(true, 'session');
		return session;
	}

	exportJson(): string { return JSON.stringify({ format: 'zotero-bridgeflow-workspace', version: 2, state: this.state }, null, 2); }
	exportReadingJson(): string { return JSON.stringify({ format: 'zotero-bridgeflow-reading-progress', version: 1, state: pickReadingProgressState(this.state) }, null, 2); }
	exportBriefNotesJson(): string { return JSON.stringify({ format: 'zotero-bridgeflow-brief-notes', version: 1, state: pickBriefNotesState(this.state) }, null, 2); }

	importJson(jsonText: string): boolean {
		try {
			this.state = readBackup(jsonText);
			this.readOnlyGuard = false;
			this.save(true);
			void this.readingCache.flushNow(this.state);
			void this.notesCache.flushNow(this.state);
			return true;
		} catch { return false; }
	}

	importReadingJson(jsonText: string): boolean {
		try {
			this.readingCache.mergeDurableState(this.state, readReadingProgressBackup(jsonText));
			this.saveReadingProgress(true);
			return true;
		} catch { return false; }
	}

	importBriefNotesJson(jsonText: string): boolean {
		try {
			this.notesCache.mergeDurableState(this.state, readBriefNotesBackup(jsonText));
			this.saveBriefNotes(true);
			return true;
		} catch { return false; }
	}
}
