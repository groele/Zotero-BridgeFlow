import { DurableCacheFile } from '../../services/durable-cache-file.ts';
import { readBackup, readWorkspace } from './workspace-schema.ts';
import type { WorkspaceSession, WorkspaceState } from './types.ts';

/**
 * Durable local disk persistence for Workspace state & saved snapshots:
 * - Writes `<ZoteroDataDir>/bridgeflow-cache/workspace/workspace-snapshots.json` + `.bak.json`.
 * - Debounced async I/O prevents main-thread stalls while guaranteeing crash durability.
 * - Merges disk snapshots on startup so reinstalling Zotero/plugin or resetting prefs never loses saved items.
 */
export class WorkspaceDiskCache {
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly file: DurableCacheFile;

	constructor(privateDirectory = '') { this.file = new DurableCacheFile('workspace', 'workspace-snapshots', privateDirectory); }
	get lastError(): string { return this.file.lastError; }
	get loadedFromLegacy(): boolean { return this.file.needsMigration; }
	getDirectoryPath(): string { return this.file.directory; }
	getFilePath(): string { return this.file.path; }
	getBackupFilePath(): string { return this.file.backup; }

	scheduleSave(state: WorkspaceState, immediate = false, serialized?: string): void {
		const ioUtils = (globalThis as any).IOUtils;
		if (!ioUtils?.writeUTF8) return;
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		if (immediate) {
			void this.flushNow(state, serialized);
			return;
		}
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			void this.flushNow(state, serialized);
		}, 320);
	}

	flushNow(state: WorkspaceState, _serialized?: string): Promise<boolean> {
		let cleanState = state;
		if (state && Array.isArray(state.groups)) {
			const activeGroupKeys = new Set(state.groups.flatMap((g) => g.memberKeys || []));
			const activeGroupIds = new Set(state.groups.map((g) => g.id));
			cleanState = {
				...state,
				...(Array.isArray(state.collapsed) ? { collapsed: state.collapsed.filter((id) => activeGroupIds.has(id)) } : {}),
				...(state.virtualMembers && typeof state.virtualMembers === 'object'
					? { virtualMembers: Object.fromEntries(Object.entries(state.virtualMembers).filter(([k]) => activeGroupKeys.has(k))) }
					: {}),
			};
		}
		return this.file.write(() => `${JSON.stringify({
			format: 'zotero-bridgeflow-workspace', version: 2, state: cleanState,
		}, null, 2)}\n`);
	}

	loadFromDisk(): Promise<WorkspaceState | null> {
		return this.file.load((text) => {
			try { return readBackup(text); } catch { return readWorkspace(text); }
		});
	}

	/**
	 * Merges durable disk state into memory state so saved sessions, virtual members,
	 * and groups survive preference resets or profile migrations.
	 */
	mergeDurableState(current: WorkspaceState, disk: WorkspaceState): boolean {
		let changed = false;

		const mergeSessions = (target: WorkspaceSession[], source: readonly WorkspaceSession[], max: number) => {
			const byIdOrName = new Map<string, WorkspaceSession>();
			for (const s of target) byIdOrName.set(s.id, s);
			for (const diskSes of source) {
				const match = target.find((s) => s.id === diskSes.id || (!s.isTemplate && !diskSes.isTemplate && s.name === diskSes.name));
				if (!match) {
					target.push(diskSes);
					changed = true;
				} else {
					const mergedVirtuals = { ...diskSes.virtualMembers, ...match.virtualMembers };
					if (Object.keys(mergedVirtuals).length > Object.keys(match.virtualMembers).length) {
						match.virtualMembers = mergedVirtuals;
						changed = true;
					}
					const mergedOpen = [...new Set([...match.openKeys, ...diskSes.openKeys])];
					if (mergedOpen.length > match.openKeys.length) {
						match.openKeys = mergedOpen;
						changed = true;
					}
				}
			}
			target.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
			if (target.length > max) target.length = max;
			void byIdOrName;
		};

		mergeSessions(current.sessions, disk.sessions, 30);
		mergeSessions(current.rollingSessions, disk.rollingSessions, 5);

		const diskGroupKeys = new Set([...current.groups, ...disk.groups].flatMap((g) => g.memberKeys));
		for (const [k, meta] of Object.entries(disk.virtualMembers)) {
			if (diskGroupKeys.has(k) && !current.virtualMembers[k]) {
				current.virtualMembers[k] = meta;
				changed = true;
			}
		}
		for (const [k, rem] of Object.entries(disk.remarks)) {
			if (!current.remarks[k]) {
				current.remarks[k] = rem;
				changed = true;
			}
		}
		for (const [k, viewedAt] of Object.entries(disk.lastViewedAt)) {
			if (viewedAt > (current.lastViewedAt[k] || 0)) {
				current.lastViewedAt[k] = viewedAt;
				changed = true;
			}
		}
		for (const [k, diskProg] of Object.entries(disk.readingProgress)) {
			const cur = current.readingProgress[k];
			if (!cur) {
				current.readingProgress[k] = {
					...diskProg,
					...(diskProg.pageSeconds ? { pageSeconds: { ...diskProg.pageSeconds } } : {}),
				};
				changed = true;
			} else {
				const mergedPages: Record<string, number> = { ...(cur.pageSeconds || {}) };
				let pagesChanged = false;
				for (const [p, sec] of Object.entries(diskProg.pageSeconds || {})) {
					if (sec > (mergedPages[p] || 0)) {
						mergedPages[p] = sec;
						pagesChanged = true;
					}
				}
				const nextRead = Math.max(cur.readSeconds, diskProg.readSeconds);
				const nextLast = cur.lastPage || diskProg.lastPage;
				const nextTotal = Math.max(cur.totalPages || 0, diskProg.totalPages || 0) || undefined;
				if (pagesChanged || nextRead > cur.readSeconds || nextLast !== cur.lastPage || nextTotal !== cur.totalPages) {
					current.readingProgress[k] = {
						readSeconds: nextRead,
						...(nextLast ? { lastPage: nextLast } : {}),
						...(nextTotal ? { totalPages: nextTotal } : {}),
						...(Object.keys(mergedPages).length ? { pageSeconds: mergedPages } : {}),
					};
					changed = true;
				}
			}
		}
		if (!current.groups.length && disk.groups.length) {
			current.groups = disk.groups.map((g) => ({ ...g, memberKeys: [...g.memberKeys] }));
			current.collapsed = [...disk.collapsed];
			changed = true;
		}
		return changed;
	}

	dispose(): void {
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
	}
}
