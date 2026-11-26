import { DisposableStack } from '../../kernel/disposable.ts';
import type { WordCitePort } from '../../kernel/domain-ports.ts';
import { tLocale } from '../../kernel/locale.ts';
import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type {
	CitationBadgeInfo,
	CitationSessionSummary,
	CitationSnapshotPayload,
	WordInsertResultPayload,
	WordRecoverOrphansResultPayload,
	WordRefreshResultPayload,
} from '../../kernel/types.ts';
import { deduplicateRegularItems, normalizeToRegularItem } from '../../services/item-resolution.ts';
import type { Win32BridgeService } from '../../services/win32-bridge.ts';
import type { WordCitationCollectionManager } from './governance/citation-collections.ts';
import type { DragCiteController } from './ipc/drag-cite-controller.ts';
import { recoverOrphanCitations } from './orphan/orphan-recovery.ts';
import { extractDocumentBaseName, type WordSessionTracker } from './ipc/session-tracker.ts';
import { refreshActiveWordDocument } from './ipc/word-inserter.ts';
import type { WordIntegrationPoller } from './ipc/word-poller.ts';

export interface WordCiteBusHost {
	kernel: PluginKernel;
	tracker: WordSessionTracker;
	collections: WordCitationCollectionManager;
	poller: WordIntegrationPoller;
	dragCite: DragCiteController;
	win32: Win32BridgeService;
	isActive: () => boolean;
	isRecovering: () => boolean;
	setRecovering: (v: boolean) => void;
	resyncNow: () => Promise<boolean>;
}

export function canSafelyAutoRefreshSession(
	tracker: WordSessionTracker,
	win32: Win32BridgeService,
	targetSessionID: string,
): boolean {
	if (tracker.getActiveSession()?.sessionID !== targetSessionID) return false;
	const all = tracker.getAllSessions();
	if (all.length <= 1) return true;
	const docExtRe = /\.(?:docx|docm|doc|dotx|dotm|rtf|odt)$/i;
	const matchTitle = (rawTitle: string) => {
		const title = extractDocumentBaseName(`window-title:${rawTitle}`).toLowerCase();
		if (!title || title === 'untitled word document') return [];
		const titleStem = title.replace(docExtRe, '');
		return all.filter((ses) => {
			const base = extractDocumentBaseName(ses.documentPath).toLowerCase();
			const stem = base.replace(docExtRe, '');
			return title === base || title === stem || titleStem === stem;
		});
	};
	const fgRaw = win32.probeForegroundWordTitle().trim();
	if (fgRaw) {
		const matches = matchTitle(fgRaw);
		return matches.length === 1 && matches[0].sessionID === targetSessionID;
	}
	const visible = win32.probeWordWindowTitles().visibleTitles;
	if (visible.length === 1) {
		const matches = matchTitle(visible[0]);
		return matches.length === 1 && matches[0].sessionID === targetSessionID;
	}
	return false;
}

export function showSpotlightRecoverToast(docName: string, res: WordRecoverOrphansResultPayload): void {
	try {
		const PW = (globalThis as any).Zotero?.ProgressWindow;
		if (typeof PW !== 'function') return;
		const total = res.restoredCount + res.importedCount + (res.existingCount ?? 0);
		const pw = new PW();
		pw.changeHeadline(tLocale('Zotero BridgeFlow · 缺失引文找回', 'Zotero BridgeFlow · Citation Recovery'));
		pw.addDescription(total > 0
			? tLocale(
				`「${docName}」已成功找回 ${total} 篇引文${res.refreshed ? '，已执行 Word 刷新' : '（请在目标 Word 文档核对并刷新引文）'}。`,
				`Recovered ${total} citation(s) for "${docName}"${res.refreshed ? ' and refreshed Word' : ''}.`,
			)
			: tLocale('未能自动恢复缺失引文（缺少内嵌备份元数据）。', 'No orphan citations could be recovered.'));
		pw.show();
		pw.startCloseTimer(4500);
	} catch { /* headless safe */ }
}

function receiptDocumentName(session: ReturnType<WordSessionTracker['getSession']> | null): string {
	// A foreground title is a discovery hint and may refer to another Word window.
	const path = session?.documentPath || '';
	return session && /^(?:[a-z]:[\\/]|\\\\|\/|https?:\/\/)/i.test(path) ? session.displayName : '';
}

export function buildWordCitationSnapshot(tracker: WordSessionTracker): CitationSnapshotPayload {
	const native = (tracker as { buildSnapshot?: () => CitationSnapshotPayload | null }).buildSnapshot?.();
	if (native) return native;
	const active = tracker.getActiveSession();
	const sessions: CitationSessionSummary[] = [];
	let activeByItemID = new Map<number, CitationBadgeInfo>();
	const citedItemIDs: number[] = [];

	for (const ses of tracker.getAllSessions()) {
		const map = new Map<number, CitationBadgeInfo>();
		for (const [itemID, info] of ses.itemCitations.entries()) {
			map.set(itemID, {
				itemID,
				ordinal: info.ordinal,
				occurrences: info.occurrences ?? 1,
				shortText: info.shortText,
				documentName: ses.displayName,
				sessionID: ses.sessionID,
			});
			if (ses.sessionID === active?.sessionID) citedItemIDs.push(itemID);
		}
		if (ses.sessionID === active?.sessionID) activeByItemID = map;
		sessions.push({
			sessionID: ses.sessionID,
			documentName: ses.displayName,
			totalCitedCount: map.size,
			byItemID: map,
			orphans: ses.orphans,
		});
	}

	return {
		activeSessionID: active?.sessionID ?? null,
		activeDocumentName: active?.displayName ?? '',
		byItemID: activeByItemID,
		citedItemIDs,
		totalCitedCount: activeByItemID.size,
		sessions,
		orphans: active?.orphans ?? [],
	};
}

export async function executeWordInsertItems(
	host: WordCiteBusHost,
	itemIDs: readonly number[],
	requestId?: string,
): Promise<WordInsertResultPayload> {
	const { kernel, tracker, dragCite } = host;
	if (!host.isActive()) return { requestId, status: 'unavailable', documentName: '', itemCount: 0 };
	let itemCount = 0;
	let documentName = '';
	let status: Awaited<ReturnType<DragCiteController['insertItems']>> = 'unavailable';
	try {
		const hostItems = (globalThis as any).Zotero?.Items;
		const ids = [...new Set(itemIDs)];
		const loaded = hostItems?.getAsync ? await hostItems.getAsync(ids) : ids.map((id) => hostItems?.get?.(id));
		const byID = new Map((Array.isArray(loaded) ? loaded : [loaded]).filter(Boolean).map((item) => [item.id, item]));
		const regular = ids.map((id) => normalizeToRegularItem(byID.get(id)));
		if (!host.isActive() || !regular.length || regular.some((item) => !item)) {
			return { requestId, status: 'invalid-selection', documentName, itemCount };
		}
		const { items } = deduplicateRegularItems(regular);
		itemCount = items.length;
		status = await dragCite.insertItems(items, (sessionID) => {
			documentName = receiptDocumentName(tracker.getSession(sessionID));
		});
	} catch (err) {
		kernel.logger.error('word-cite:insert-request', err);
	}
	return { requestId, status, documentName, itemCount };
}

export async function executeWordRefresh(
	host: WordCiteBusHost,
	sessionID?: string,
	requestId?: string,
): Promise<WordRefreshResultPayload> {
	const { kernel, tracker, poller } = host;
	if (!host.isActive()) return { requestId, ok: false, documentName: '' };
	const session = sessionID ? tracker.getSession(sessionID) : tracker.getActiveSession();
	const docName = receiptDocumentName(session);
	const ok = (!sessionID || !!session) && await refreshActiveWordDocument(kernel, sessionID);
	if (ok) void poller.notifyCommittedSession().catch((err) => kernel.logger.error('word-cite:poll', err));
	return { requestId, ok, documentName: docName };
}

export function executeWordSwitchSession(host: WordCiteBusHost, sessionID: string): void {
	if (!host.isActive()) return;
	if (host.tracker.setActiveSession(sessionID)) host.poller.scheduleItemsViewRefresh();
	else host.tracker.emitCurrentSnapshot();
}

export function executeWordSelectCollection(host: WordCiteBusHost, sessionID?: string, win?: Window): void {
	if (!host.isActive()) return;
	host.collections.selectSessionCollection(win, sessionID || host.tracker.getActiveSession()?.sessionID || null);
}

export async function executeWordRecoverOrphans(
	host: WordCiteBusHost,
	opts: { sessionID?: string; keys?: readonly string[]; requestId?: string; source?: 'panel' | 'spotlight' },
): Promise<WordRecoverOrphansResultPayload> {
	const { kernel, tracker, collections, win32 } = host;
	const { sessionID, keys, requestId, source } = opts;
	if (!host.isActive()) return { requestId, restoredCount: 0, importedCount: 0, skippedCount: 0 };
	if (host.isRecovering()) {
		return {
			requestId, restoredCount: 0, importedCount: 0, skippedCount: 0,
			error: tLocale('正在执行缺失引文恢复，请稍候重试。', 'Citation recovery is already in progress.'),
		};
	}
	const targetSession = sessionID ? tracker.getSession(sessionID) : tracker.getActiveSession();
	if (!targetSession || !targetSession.orphans.length) {
		return { requestId, restoredCount: 0, importedCount: 0, skippedCount: 0 };
	}
	host.setRecovering(true);
	try {
		const col = collections.getSessionCollection(targetSession.sessionID);
		const result = await recoverOrphanCitations(targetSession.orphans, {
			targetCollectionID: typeof col?.id === 'number' ? col.id : undefined,
			collectionName: col?.name ? String(col.name) : undefined,
			keys,
		});
		const changed = result.restoredCount > 0 || result.importedCount > 0
			|| (result.existingCount ?? 0) > 0 || (result.relinkedCount ?? 0) > 0;
		let refreshed = false;
		if (changed) {
			if (kernel.prefs.get('wordCite.orphans.autoRefreshWord') && canSafelyAutoRefreshSession(tracker, win32, targetSession.sessionID)) {
				refreshed = await refreshActiveWordDocument(kernel, targetSession.sessionID).catch((err) => {
					kernel.logger.error('word-cite:recover-refresh', err);
					return false;
				});
			}
			await host.resyncNow().catch((err) => kernel.logger.error('word-cite:recover-resync', err));
		}
		const payload: WordRecoverOrphansResultPayload = {
			...result, sessionID: targetSession.sessionID, ...(refreshed ? { refreshed: true } : {}), requestId,
		};
		if (source === 'spotlight') showSpotlightRecoverToast(targetSession.displayName, payload);
		return payload;
	} catch (err) {
		kernel.logger.error('word-cite:recover-orphans', err);
		return {
			requestId, sessionID: targetSession.sessionID, restoredCount: 0, importedCount: 0,
			skippedCount: targetSession.orphans.length,
			error: tLocale('恢复未完成，请重新检查文库和缺失引文后重试。', 'Recovery did not complete. Recheck the library and remaining citations before retrying.'),
		};
	} finally {
		host.setRecovering(false);
	}
}

export function createWordCitePort(
	host: WordCiteBusHost,
	citeCurrentSelection: (win?: Window) => Promise<void>,
): WordCitePort {
	return {
		getSnapshot: () => (host.isActive() ? buildWordCitationSnapshot(host.tracker) : null),
		citeCurrentSelection: (win) => citeCurrentSelection(win),
		insertItems: (itemIDs, _win, requestId) => executeWordInsertItems(host, itemIDs, requestId),
		refreshActiveDocument: (sessionID, requestId) => executeWordRefresh(host, sessionID, requestId),
		switchSession: (sessionID) => executeWordSwitchSession(host, sessionID),
		selectCollection: (sessionID, win) => executeWordSelectCollection(host, sessionID, win),
		recoverOrphans: (opts) => executeWordRecoverOrphans(host, opts),
	};
}

export function registerWordCiteBusHandlers(host: WordCiteBusHost, disposables: DisposableStack): void {
	const { kernel, tracker } = host;

	disposables.add(
		kernel.bus.on('word:insert-items-request', async ({ itemIDs, requestId }) => {
			if (!host.isActive()) return;
			kernel.bus.emit('word:insert-result', await executeWordInsertItems(host, itemIDs, requestId));
		}),
	);

	disposables.add(
		kernel.bus.on('word:refresh-request', async ({ requestId, sessionID }) => {
			if (!host.isActive()) return;
			kernel.bus.emit('word:refresh-result', await executeWordRefresh(host, sessionID, requestId));
		}),
	);

	disposables.add(kernel.bus.on('word:snapshot-query', () => { if (host.isActive()) tracker.emitCurrentSnapshot(); }));

	disposables.add(
		kernel.bus.on('word:switch-session-request', ({ sessionID }) => {
			executeWordSwitchSession(host, sessionID);
		}),
	);

	disposables.add(
		kernel.bus.on('word:select-collection-request', ({ sessionID, win }) => {
			executeWordSelectCollection(host, sessionID, win);
		}),
	);

	disposables.add(
		kernel.bus.on('word:recover-orphans-request', async ({ sessionID, keys, requestId, source }) => {
			if (!host.isActive()) return;
			kernel.bus.emit('word:recover-orphans-result', await executeWordRecoverOrphans(host, { sessionID, keys, requestId, source }));
		}),
	);
}
