import { tLocale } from '../../kernel/locale.ts';
import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { WorkspaceStateStore } from './store/state-store.ts';
import type { WorkspaceTabController } from './tabs/tab-controller.ts';

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
	if (!ctx.kernel.prefs.get('workspace.enableReadingTracker')) {
		return { lastReadingTickAt: now, lastActivityAt: ctx.lastActivityAt, readingDirty: ctx.readingDirty };
	}
	const elapsed = Math.min(30, Math.floor((now - ctx.lastReadingTickAt) / 1000));
	if (elapsed < minElapsed) {
		return { lastReadingTickAt: ctx.lastReadingTickAt, lastActivityAt: ctx.lastActivityAt, readingDirty: ctx.readingDirty };
	}

	const idleCutoffMs = Math.max(30, Number(ctx.kernel.prefs.get('workspace.readingIdleTimeoutSec') || 180)) * 1000;
	let nextActivityAt = ctx.lastActivityAt;
	let nextDirty = ctx.readingDirty;
	let updated = false;

	for (const win of ctx.windows) {
		if ((win as any).closed) continue;
		const prev = usePreviousReader ? ctx.lastReaderByWin.get(win) : undefined;
		const didUpdate = prev
			? ctx.tabs.trackReadingProgress(win, Math.max(1, elapsed), {
				overrideKey: prev.key, overrideLastPage: prev.page, overrideTotalPages: prev.total,
				idleCutoffMs, lastActivityAt: nextActivityAt, now,
			})
			: ctx.tabs.trackReadingProgress(win, Math.max(1, elapsed), {
				idleCutoffMs, lastActivityAt: nextActivityAt, now,
				onPageChanged: () => { nextActivityAt = now; },
			});
		if (didUpdate) { nextDirty = true; updated = true; }
		const snap = ctx.tabs.resolveActiveReaderSnapshot(win);
		if (snap) ctx.lastReaderByWin.set(win, snap);
		else ctx.lastReaderByWin.delete(win);
	}

	if (updated) {
		ctx.store.saveReadingProgress();
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
	const intervalMs = Math.max(3, Number(ctx.kernel.prefs.get('workspace.rollingSnapshotIntervalMin') || 15)) * 60_000;
	if (ctx.kernel.prefs.get('workspace.enableRollingSnapshots') && Date.now() - lastRollingAt > intervalMs) {
		const openKeys = [...new Set([...ctx.windows].flatMap((win) => ctx.tabs.openKeys(win)))];
		if (openKeys.length || ctx.store.state.groups.some((g) => g.memberKeys.length > 0)) {
			const time = new Date().toLocaleTimeString();
			ctx.store.saveSession(tLocale(`自动滚动快照 ${time}`, `Auto Snapshot ${time}`), { rolling: true, openKeys });
			lastRollingAt = Date.now();
		}
	}
	if (changed) ctx.refreshAllWindows();
	return { readingDirty, lastRollingAt };
}
