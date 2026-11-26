import { formatReadingProgress as sharedFormatReadingProgress } from '../../../services/reading-stats.ts';
import type { WorkspaceStateStore } from '../store/state-store.ts';

export interface ReadingTrackOptions {
	overrideKey?: string;
	overrideLastPage?: number;
	overrideTotalPages?: number;
	idleCutoffMs?: number;
	lastActivityAt?: number;
	now?: number;
	onPageChanged?: (page: number) => void;
}

export function readReaderPageMetrics(tabID: string): { page: number; total: number } {
	const reader: any = (globalThis as any).Zotero?.Reader?.getByTabID?.(tabID);
	const internalReader = reader?._internalReader;
	const viewStats = internalReader?._state?.primaryViewStats || reader?.state?.primaryViewStats;
	const viewState = internalReader?._state?.primaryViewState || reader?.state?.primaryViewState;
	const pdfApp = internalReader?._primaryView?._iframeWindow?.PDFViewerApplication
		|| reader?._iframeWindow?.PDFViewerApplication;
	const rawPageIndex = viewStats?.pageIndex ?? viewState?.pageIndex ?? reader?.state?.pageIndex;
	const page = Number(pdfApp?.page || (rawPageIndex != null ? Number(rawPageIndex) + 1 : 0)) || 0;
	const total = Number(
		viewStats?.pagesCount
		|| pdfApp?.pagesCount
		|| pdfApp?.pdfDocument?.numPages
		|| internalReader?._primaryView?._pagesCount
		|| internalReader?._pdfDocument?.numPages
		|| reader?.pagesCount
		|| 0,
	) || 0;
	return { page, total };
}

export function trackActiveReaderProgress(
	win: Window,
	store: WorkspaceStateStore,
	tracked: readonly { tabID: string; key: string; type: string; virtual: boolean }[],
	elapsedSeconds: number,
	options: ReadingTrackOptions = {},
): boolean {
	const doc = win.document as Document | undefined;
	if (typeof doc?.hasFocus === 'function' && !doc.hasFocus()) return false;
	const now = options.now ?? Date.now();
	const idleExpired = Boolean(
		options.idleCutoffMs && options.idleCutoffMs > 0
		&& options.lastActivityAt && (now - options.lastActivityAt) > options.idleCutoffMs,
	);

	if (options.overrideKey) {
		if (idleExpired || options.overrideKey.startsWith('tab:')) return false;
		const prevText = sharedFormatReadingProgress(store.state.readingProgress[options.overrideKey]).text;
		store.touchViewed(options.overrideKey, now);
		const next = store.updateReadingProgress(
			options.overrideKey,
			elapsedSeconds,
			options.overrideLastPage,
			options.overrideTotalPages,
		);
		return elapsedSeconds > 0 || sharedFormatReadingProgress(next).text !== prevText;
	}

	const selectedID = String((win as any).Zotero_Tabs?.selectedID || '');
	if (!selectedID || selectedID === 'zotero-pane') return false;
	const current = tracked.find((t) => !t.virtual && t.tabID === selectedID);
	if (!current || current.key.startsWith('tab:') || !current.type.startsWith('reader')) return false;

	const prevProg = store.state.readingProgress[current.key];
	const prevText = sharedFormatReadingProgress(prevProg).text;
	const { page, total } = readReaderPageMetrics(selectedID);
	const pageFlipped = page > 0 && prevProg?.lastPage !== page;
	if (pageFlipped) options.onPageChanged?.(page);
	if (idleExpired && !pageFlipped) return false;

	store.touchViewed(current.key, now);
	const next = store.updateReadingProgress(current.key, elapsedSeconds, page, total);
	return elapsedSeconds > 0 || sharedFormatReadingProgress(next).text !== prevText;
}
