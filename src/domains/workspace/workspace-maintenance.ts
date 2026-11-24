import { tLocale } from '../../kernel/locale.ts';
import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import type { WorkspaceTabController } from './tab-controller.ts';

export interface ReaderSnapshot {
	tabID: string;
	key: string;
	page: number;
	total: number;
}

export interface ReadingSyncContext {
	windows: Iterable<Window>;
	tabs: WorkspaceTabController;
	store: WorkspaceStateStore;
	kernel: PluginKernel;
	lastReaderByWin: WeakMap<Window, ReaderSnapshot>;
	lastReadingTickAt: number;
	lastActivityAt: number;
	readingDirty: boolean;
	onScheduleRefresh: () => void;
}

export function flushWorkspaceReadingProgress(
	ctx: ReadingSyncContext,
	minElapsed = 1,
	usePreviousReader = false,
): { lastReadingTickAt: number; lastActivityAt: number; readingDirty: boolean } {
	const now = Date.now();
	const elapsed = Math.min(30, Math.floor((now - ctx.lastReadingTickAt) / 1000));
	if (elapsed < minElapsed) {
		return { lastReadingTickAt: ctx.lastReadingTickAt, lastActivityAt: ctx.lastActivityAt, readingDirty: ctx.readingDirty };
	}

	let nextActivityAt = ctx.lastActivityAt;
	let nextDirty = ctx.readingDirty;
	let updated = false;

	for (const win of ctx.windows) {
		if ((win as any).closed) continue;
		const prev = usePreviousReader ? ctx.lastReaderByWin.get(win) : undefined;
		const didUpdate = prev
			? ctx.tabs.trackReadingProgress(win, Math.max(1, elapsed), {
				overrideKey: prev.key, overrideLastPage: prev.page, overrideTotalPages: prev.total,
				idleCutoffMs: 180_000, lastActivityAt: nextActivityAt, now,
			})
			: ctx.tabs.trackReadingProgress(win, Math.max(1, elapsed), {
				idleCutoffMs: 180_000, lastActivityAt: nextActivityAt, now,
				onPageChanged: () => { nextActivityAt = now; },
			});
		if (didUpdate) { nextDirty = true; updated = true; }
		const snap = ctx.tabs.resolveActiveReaderSnapshot(win);
		if (snap) ctx.lastReaderByWin.set(win, snap);
		else ctx.lastReaderByWin.delete(win);
	}

	if (updated) {
		ctx.store.readingCache.scheduleSave(ctx.store.state);
		ctx.kernel.bus.emit('visual-notes:reading-updated', {});
		if (ctx.kernel.prefs.get('workspace.verticalTabSubtitleMode') === 'lastViewed') {
			ctx.onScheduleRefresh();
		}
	}

	return { lastReadingTickAt: now, lastActivityAt: nextActivityAt, readingDirty: nextDirty };
}

export function runWorkspaceMaintenance(ctx: {
	windows: Iterable<Window>;
	tabs: WorkspaceTabController;
	store: WorkspaceStateStore;
	kernel: PluginKernel;
	readingDirty: boolean;
	lastRollingAt: number;
	refreshAllWindows: () => void;
}): { readingDirty: boolean; lastRollingAt: number } {
	let changed = false;
	let readingDirty = ctx.readingDirty;
	let lastRollingAt = ctx.lastRollingAt;

	for (const win of ctx.windows) {
		if (ctx.tabs.sleepIdleTabs(win) > 0) changed = true;
	}
	if (readingDirty) {
		readingDirty = false;
		void ctx.store.readingCache.flushNow(ctx.store.state);
	}
	if (ctx.kernel.prefs.get('workspace.enableRollingSnapshots') && Date.now() - lastRollingAt > 900_000) {
		const openKeys = [...new Set([...ctx.windows].flatMap((win) => ctx.tabs.openKeys(win)))];
		if (openKeys.length || ctx.store.state.groups.length > 0 || ctx.store.state.pinnedKeys.length > 0) {
			const time = new Date().toLocaleTimeString();
			ctx.store.saveSession(tLocale(`自动滚动快照 ${time}`, `Auto Snapshot ${time}`), { rolling: true, openKeys });
			lastRollingAt = Date.now();
		}
	}
	if (changed) ctx.refreshAllWindows();
	return { readingDirty, lastRollingAt };
}
