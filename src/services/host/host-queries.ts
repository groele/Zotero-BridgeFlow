export interface HostTabRecord {
	id: string;
	type: string;
	title?: string;
	pinned?: boolean;
	audioStatus?: { active?: boolean; paused?: boolean };
	data?: {
		itemID?: number;
		soundPlaying?: boolean;
		secondViewState?: unknown;
		[key: string]: unknown;
	};
	closedAt?: number;
}

export function getHostTabs(win?: Window | null): HostTabRecord[] {
	const raw = (win as any)?.Zotero_Tabs?._tabs;
	return Array.isArray(raw) ? raw : [];
}

export function findHostTab(win: Window | null | undefined, tabID: string): HostTabRecord | null {
	if (!tabID) return null;
	return getHostTabs(win).find((tab) => tab?.id === tabID) ?? null;
}

export function getHostRecentlyClosedTabs(win?: Window | null): HostTabRecord[] {
	const tabsApi = (win as any)?.Zotero_Tabs;
	const raw = tabsApi?._recentlyClosedTabs ?? tabsApi?._history;
	return Array.isArray(raw) ? raw : [];
}

export function getHostReaders(): any[] {
	const raw = (globalThis as any).Zotero?.Reader?._readers;
	return Array.isArray(raw) ? raw : [];
}

export function resolveReaderOwnerWindow(reader: any): Window | null {
	if (reader?._window && !reader._window.closed) return reader._window;
	const tabID = String(reader?.tabID || '');
	const wins: Window[] = (globalThis as any).Zotero?.getMainWindows?.() || [];
	if (tabID) {
		const matched = wins.find((w) => getHostTabs(w).some((t) => t?.id === tabID));
		if (matched) return matched;
	}
	return (globalThis as any).Zotero?.getMainWindow?.() || wins[0] || null;
}

export function getReaderDocument(reader: any): Document | null {
	return (reader?._iframeWindow?.document as Document | undefined) ?? null;
}

export function getReaderPrimaryWindow(reader: any): any {
	return reader?._internalReader?._primaryView?._iframeWindow ?? null;
}

export function getReaderPrimaryDocument(reader: any): Document | null {
	return (getReaderPrimaryWindow(reader)?.document as Document | undefined) ?? null;
}

export function isReaderClosedOrUninitialized(reader: any): boolean {
	return !reader || Boolean(reader._isTabClosed || reader._isUninitialized);
}

export function getEffectiveReaderTabID(reader: any): string {
	return String(reader?.tabID || reader?._zbfParkedTabID || '');
}

export function scanPendingReaders(
	pending: WeakSet<object> | Set<object>,
	isStillActive: () => boolean,
	isReadyDoc: (doc: Document) => boolean,
	onReady: (reader: any, doc: Document) => void,
): void {
	for (const reader of getHostReaders()) {
		if (isReaderClosedOrUninitialized(reader)) continue;
		const doc = getReaderDocument(reader);
		if (doc && isReadyDoc(doc)) {
			onReady(reader, doc);
		} else if (!pending.has(reader)) {
			pending.add(reader);
			const waitReady = reader._waitForReader?.() ?? reader._initPromise ?? Promise.resolve();
			void Promise.resolve(waitReady).then(() => {
				pending.delete(reader);
				if (!isStillActive() || reader._isTabClosed) return;
				const readyDoc = getReaderDocument(reader);
				if (readyDoc && isReadyDoc(readyDoc)) onReady(reader, readyDoc);
			}).catch(() => {
				pending.delete(reader);
			});
		}
	}
}

export function readReaderPageMetricsByTabID(tabID: string): { page: number; total: number; pageIndex: number | null } {
	if (!tabID) return { page: 0, total: 0, pageIndex: null };
	const reader: any = (globalThis as any).Zotero?.Reader?.getByTabID?.(tabID);
	if (!reader) return { page: 0, total: 0, pageIndex: null };
	const internalReader = reader._internalReader;
	const viewStats = internalReader?._state?.primaryViewStats || reader.state?.primaryViewStats;
	const viewState = internalReader?._state?.primaryViewState || reader.state?.primaryViewState;
	const pdfApp = internalReader?._primaryView?._iframeWindow?.PDFViewerApplication
		|| reader._iframeWindow?.PDFViewerApplication;
	const rawPageIndex = viewStats?.pageIndex ?? viewState?.pageIndex ?? reader.state?.pageIndex;
	const pageIndex = typeof pdfApp?.page === 'number' && pdfApp.page > 0
		? pdfApp.page - 1
		: (typeof rawPageIndex === 'number' && rawPageIndex >= 0 ? rawPageIndex : null);
	const page = Number(pdfApp?.page || (rawPageIndex != null ? Number(rawPageIndex) + 1 : 0)) || 0;
	const total = Number(
		viewStats?.pagesCount
		|| pdfApp?.pagesCount
		|| pdfApp?.pdfDocument?.numPages
		|| internalReader?._primaryView?._pagesCount
		|| internalReader?._pdfDocument?.numPages
		|| reader.pagesCount
		|| 0,
	) || 0;
	return { page, total, pageIndex };
}

export function isHostTabBusy(win: Window, tabID: string): boolean {
	const native = findHostTab(win, tabID);
	const reader = (globalThis as any).Zotero?.Reader?.getByTabID?.(tabID);
	return Boolean(
		(native?.audioStatus?.active && !native.audioStatus.paused)
		|| native?.data?.soundPlaying
		|| reader?.soundPlaying
		|| reader?._internalReader?.hasUnsavedChanges,
	);
}

export async function openAttachmentReaderTab(
	attID: number,
	locArg?: Record<string, unknown>,
): Promise<boolean> {
	const zotero = (globalThis as any).Zotero;
	const readerApi = zotero?.Reader;
	if (!attID || typeof readerApi?.open !== 'function') return false;
	try {
		const opened = await readerApi.open(attID, locArg, { openInWindow: false });
		const instance = opened || getHostReaders().find((r) => Number(r?.itemID) === Number(attID) && !r?._isTabClosed);
		if (instance) {
			if (instance.tabID) {
				const targetWin = resolveReaderOwnerWindow(instance);
				(targetWin as any)?.Zotero_Tabs?.select?.(instance.tabID, true);
			}
			if (locArg) {
				await Promise.resolve(instance._initPromise ?? instance._waitForReader?.()).catch(() => {});
				try { await instance.navigate?.(locArg); } catch { /* ignore */ }
			}
		}
		return true;
	} catch {
		try {
			await readerApi.open(attID, undefined, { openInWindow: false });
			return true;
		} catch {
			return false;
		}
	}
}

export function resolveActivePaneLibraryID(pane: any): number | undefined {
	const multi = pane?.getSelectedLibraryIDs?.()?.[0];
	if (typeof multi === 'number' && multi > 0) return multi;
	const rowLib = pane?.getCollectionTreeRow?.()?.ref?.libraryID;
	if (typeof rowLib === 'number' && rowLib > 0) return rowLib;
	return (globalThis as any).Zotero?.Libraries?.userLibraryID;
}
