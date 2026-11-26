import {
	pickBriefNotesState, pickReadingNotesState, pickReadingProgressState, pickWorkspaceLayoutState,
	readBackup, readBriefNotesBackup, readReadingProgressBackup, readWorkspace,
} from './workspace-schema.ts';
import type { UnifiedPrefService } from '../../../kernel/pref-service.ts';
import { tLocale } from '../../../kernel/locale.ts';
import { WorkspaceDiskCache } from './workspace-disk-cache.ts';
import { ReadingProgressDiskCache } from './reading-progress-cache.ts';
import { BriefNotesDiskCache } from './brief-notes-cache.ts';
import { mergePageSeconds } from '../../../services/reading-stats.ts';
import {
	applySessionLayoutToState, captureWorkspaceLayout, getNormalizedItemRemark, groupOfStateKey,
	hydrateWorkspaceDiskCaches, mergeImportedWorkspaceState, saveVirtualMembersToState,
	saveWorkspaceSessionRecord, setNormalizedItemRemark,
} from './workspace-session-ops.ts';
import {
	assignKeyRelativeInState, assignToGroupInState, createGroupInState,
	removeGroupInState, renameGroupInState, setCollapsedInState,
	setGroupColorInState, setPinnedInState, setSleepingInState,
} from './state-group-ops.ts';
import {
	MAX_MANUAL_SESSIONS, MAX_REMARK_LENGTH,
	type RemarkDisplayMode, type TabGroup, type TabReadingProgress, type VirtualMemberMeta, type WorkspaceSession, type WorkspaceState,
} from '../types.ts';

type StoreChange = 'layout' | 'notes' | 'session' | 'reading' | 'notes-local-clear' | 'import';

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
	legacyMigrationPending = false;
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

	async initDiskCache(): Promise<boolean> { return hydrateWorkspaceDiskCaches(this); }

	save(immediateDisk = false, change: StoreChange = 'layout'): void {
		if (!this.readOnlyGuard) {
			const layout = this.legacyMigrationPending ? this.state : pickWorkspaceLayoutState(this.state);
			const serialized = JSON.stringify(layout);
			try { this.prefs.set('workspace.document', serialized); } catch { /* ignore */ }
			if (!this.legacyMigrationPending) this.diskCache.scheduleSave(layout, immediateDisk, serialized);
		}
		this.emitChange(change);
	}

	flushLayoutToDisk(): Promise<boolean> {
		if (this.readOnlyGuard || this.legacyMigrationPending) return Promise.resolve(false);
		return this.diskCache.flushNow(pickWorkspaceLayoutState(this.state));
	}

	saveReadingProgress(immediateDisk = false): void {
		this.readingCache.scheduleSave(this.state, immediateDisk);
		this.emitChange('reading');
	}

	saveBriefNotes(immediateDisk = false): void {
		this.notesCache.scheduleSave(this.state, immediateDisk);
		this.emitChange('notes');
	}

	private emitChange(change: StoreChange = 'layout'): void {
		for (const fn of this.listeners) { try { fn(change); } catch { /* ignore */ } }
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
		void this.diskCache.flushNow(pickWorkspaceLayoutState(this.state), undefined, true);
	}

	clearReadingProgress(): void {
		this.state.lastViewedAt = {};
		this.state.readingProgress = {};
		void this.readingCache.flushNow(this.state, true);
		this.emitChange('reading');
	}

	clearBriefNotes(): Promise<boolean> {
		if (this.legacyMigrationPending) return Promise.resolve(false);
		this.state.remarks = {};
		this.state.remarkModes = {};
		const saved = this.notesCache.flushNow(this.state, true);
		this.emitChange('notes-local-clear');
		return saved;
	}

	createGroup(name: string, color?: string): TabGroup {
		const group = createGroupInState(this.state, name, color);
		this.save();
		return group;
	}

	assignKeyRelative(key: string, groupId: string | null, anchorKey: string, after: boolean): void {
		assignKeyRelativeInState(this.state, key, groupId, anchorKey, after);
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
		if (!renameGroupInState(this.state, groupId, name)) return false;
		this.save();
		return true;
	}

	setGroupColor(groupId: string, color: string): boolean {
		if (!setGroupColorInState(this.state, groupId, color)) return false;
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
		setCollapsedInState(this.state, groupId, collapsed);
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
		const trimmed = name.trim(), ses = this.state.sessions.find((s) => s.id === sessionId);
		if (!ses || !trimmed) return false;
		ses.name = trimmed; this.save(); return true;
	}

	promoteRollingSession(sessionId: string): boolean {
		const idx = this.state.rollingSessions.findIndex((s) => s.id === sessionId);
		if (idx < 0) return false;
		const [item] = this.state.rollingSessions.splice(idx, 1);
		this.state.sessions.unshift({ ...item, kind: 'manual' });
		this.state.sessions = this.state.sessions.slice(0, MAX_MANUAL_SESSIONS);
		this.save(); return true;
	}

	removeGroup(groupId: string): boolean {
		if (!removeGroupInState(this.state, groupId)) return false;
		this.save();
		return true;
	}

	assignToGroup(key: string, groupId: string | null): void {
		assignToGroupInState(this.state, key, groupId);
		this.save();
	}

	setPinned(key: string, pinned: boolean): void {
		setPinnedInState(this.state, key, pinned);
		this.save();
	}

	isPinned(key: string): boolean { return this.state.pinnedKeys.includes(key); }

	setSleeping(key: string, sleeping: boolean): void {
		if (sleeping && this.isPinned(key)) return;
		setSleepingInState(this.state, key, sleeping);
		this.save();
	}

	isSleeping(key: string): boolean { return this.state.sleepingKeys.includes(key); }

	getReadingProgress(itemID: number): TabReadingProgress | undefined {
		return this.state.readingProgress[`item:${itemID}`];
	}

	persistBriefNotes(): Promise<boolean> {
		return this.notesCache.flushNow(this.state);
	}

	getRemarksSnapshot(): Readonly<Record<string, string>> {
		return this.state.remarks;
	}

	resolveRemarkTargetItemID(key: string): number {
		const vm = this.state.virtualMembers[key];
		const match = /^item:(\d+)$/.exec(key);
		return Number(vm?.parentItemID || vm?.itemID || (match ? match[1] : 0));
	}

	getItemRemark(itemID: number): string { return getNormalizedItemRemark(this.state, itemID); }

	setItemRemark(itemID: number, remark: string, silent = false): void {
		if (!setNormalizedItemRemark(this.state, itemID, remark, MAX_REMARK_LENGTH)) return;
		if (!silent) this.saveBriefNotes();
	}

	notifyNotesChanged(): void { this.saveBriefNotes(); }

	setRemark(key: string, remark: string): void {
		const match = /^item:(\d+)$/.exec(key);
		if (match) { this.setItemRemark(Number(match[1]), remark); return; }
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

	saveVirtualMember(meta: VirtualMemberMeta): void {
		if (saveVirtualMembersToState(this.state, [meta])) this.save();
	}

	saveVirtualMembersBatch(metas: readonly VirtualMemberMeta[]): void {
		if (metas.length && saveVirtualMembersToState(this.state, metas)) this.save();
	}

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
			const { state, hasReading, hasNotes } = mergeImportedWorkspaceState(this.state, readBackup(jsonText));
			this.state = state;
			this.readOnlyGuard = false;
			this.save(true, 'import');
			if (hasReading) void this.readingCache.flushNow(this.state);
			if (hasNotes) void this.notesCache.flushNow(this.state);
			return true;
		} catch { return false; }
	}

	importAnyJson(jsonText: string): 'workspace' | 'reading' | 'notes' | null {
		if (this.importJson(jsonText)) return 'workspace';
		if (this.importReadingJson(jsonText)) return 'reading';
		if (this.importBriefNotesJson(jsonText)) return 'notes';
		return null;
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
