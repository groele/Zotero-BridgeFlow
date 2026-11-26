import { isChineseLocale } from '../../../kernel/locale.ts';
import type { PluginKernel } from '../../../kernel/plugin-kernel.ts';
import type { CitationSnapshotPayload } from '../../../kernel/types.ts';
import { locateItemInZoteroLibrary } from '../../../services/item-resolution.ts';
import type { ServiceContainer } from '../../../services/service-container.ts';
import { formatIgnoreReminderReceipt, formatInsertReceipt, formatRefreshReceipt } from './word-cite-panel-model.ts';
import { formatRecoverReceipt, type ReceiptAction, type ReceiptState, type WordCiteBodyState } from './word-cite-panel-ui.ts';
import type { ReminderItemRecord, ReminderUiState } from './word-cite-reminders-model.ts';

export interface WordCiteActionHost {
	kernel: PluginKernel;
	services: ServiceContainer;
	reminderState: ReminderUiState;
	hasPendingRequest: () => boolean;
	beginRequest: (kind: 'insert' | 'refresh' | 'recover', owner?: WordCiteBodyState) => string;
	finishRequest: (requestId: string | undefined, nextReceipt: ReceiptState) => void;
	setReceipt: (receipt: ReceiptState, owner?: WordCiteBodyState) => void;
	renderAllBodies: () => void;
}

export function dispatchWordCiteInsert(
	host: WordCiteActionHost,
	itemIDs: readonly number[],
	requestId: string,
	win?: Window,
): void {
	const wordPort = host.kernel.ports.get('word-cite');
	if (wordPort) {
		const zh = isChineseLocale(win?.document);
		void wordPort.insertItems(itemIDs, win, requestId)
			.then((res) => host.finishRequest(res.requestId ?? requestId, formatInsertReceipt(res, zh)))
			.catch((err) => {
				host.kernel.logger.error('word-cite:port-insert', err);
				host.finishRequest(requestId, formatInsertReceipt({ requestId, status: 'unavailable', documentName: '', itemCount: itemIDs.length }, zh));
			});
		return;
	}
	host.kernel.bus.emit('word:insert-items-request', { itemIDs, win, requestId });
}

export function requestWordCiteRefresh(
	host: WordCiteActionHost,
	sessionID: string | undefined,
	owner: WordCiteBodyState,
	win?: Window,
): void {
	if (host.hasPendingRequest()) return;
	const requestId = host.beginRequest('refresh', owner);
	const wordPort = host.kernel.ports.get('word-cite');
	if (wordPort) {
		const zh = isChineseLocale(win?.document);
		void wordPort.refreshActiveDocument(sessionID, requestId)
			.then((res) => host.finishRequest(res.requestId ?? requestId, formatRefreshReceipt(res, zh)))
			.catch((err) => {
				host.kernel.logger.error('word-cite:port-refresh', err);
				host.finishRequest(requestId, formatRefreshReceipt({ requestId, ok: false, documentName: '' }, zh));
			});
		return;
	}
	host.kernel.bus.emit('word:refresh-request', { requestId, sessionID, win });
}

export function requestWordCiteRecoverOrphans(
	host: WordCiteActionHost,
	opts: { sessionID?: string; keys: readonly string[]; win?: Window },
	owner: WordCiteBodyState,
): void {
	if (!opts.keys.length || host.hasPendingRequest()) return;
	const requestId = host.beginRequest('recover', owner);
	const wordPort = host.kernel.ports.get('word-cite');
	if (wordPort) {
		const zh = isChineseLocale(opts.win?.document);
		void wordPort.recoverOrphans({
			sessionID: opts.sessionID,
			keys: opts.keys,
			requestId,
			source: 'panel',
			win: opts.win,
		})
			.then((res) => host.finishRequest(res.requestId ?? requestId, formatRecoverReceipt(res, zh)))
			.catch((err) => {
				host.kernel.logger.error('word-cite:port-recover', err);
				host.finishRequest(requestId, formatRecoverReceipt({
					requestId,
					restoredCount: 0,
					importedCount: 0,
					skippedCount: opts.keys.length,
					error: zh ? '恢复未完成，请重新检查文库和缺失引文后重试。' : 'Recovery did not complete. Recheck the library and remaining citations before retrying.',
				}, zh));
			});
		return;
	}
	host.kernel.bus.emit('word:recover-orphans-request', {
		sessionID: opts.sessionID,
		keys: opts.keys,
		source: 'panel',
		requestId,
		win: opts.win,
	});
}

export function selectWordCiteCollection(kernel: PluginKernel, sessionID?: string, win?: Window): void {
	const wordPort = kernel.ports.get('word-cite');
	if (wordPort) wordPort.selectCollection(sessionID, win);
	else kernel.bus.emit('word:select-collection-request', { sessionID, win });
}

export function handleWordCiteReceiptAction(
	host: WordCiteActionHost,
	act: ReceiptAction,
	st: WordCiteBodyState,
): void {
	const win = st.root.ownerDocument?.defaultView ?? undefined;
	if (act.kind === 'undo-ignore-reminder' && act.reminderKey) {
		host.services.reminders.setIgnored(act.reminderKey, false);
		host.setReceipt({ text: '', tone: 'none' });
		host.renderAllBodies();
		return;
	}
	if (act.kind === 'refresh-word') {
		requestWordCiteRefresh(host, act.sessionID, st, win);
		return;
	}
	if (act.kind === 'locate-recovered' && act.itemIDs?.length) {
		if (act.sessionID && host.kernel.prefs.get('wordCite.collections.enable')) {
			selectWordCiteCollection(host.kernel, act.sessionID, win);
		}
		const pane = (win as any)?.ZoteroPane;
		if (typeof pane?.selectItems === 'function') {
			setTimeout(() => { void Promise.resolve(pane.selectItems(act.itemIDs)).catch(() => {}); }, 80);
		} else {
			void locateItemInZoteroLibrary(act.itemIDs[0], { win: win ?? null, switchCollection: true });
		}
	}
}

export function handleWordCiteLocateReminder(
	host: WordCiteActionHost,
	itemID: number,
	st: WordCiteBodyState,
	zh: boolean,
): void {
	const win = st.root.ownerDocument?.defaultView ?? null;
	void locateItemInZoteroLibrary(itemID, { win, switchCollection: false }).then((ok) => {
		if (!ok) return locateItemInZoteroLibrary(itemID, { win, switchCollection: true });
		return true;
	});
	host.setReceipt(
		{
			tone: 'ok',
			text: zh ? '✓ 已定位到文献条目，可在「信息」页核对补全' : '✓ Located item; complete missing fields in Info pane',
			stickyUntil: Date.now() + 4_000,
		},
		st,
	);
	host.renderAllBodies();
}

export function handleWordCiteIgnoreReminder(
	host: WordCiteActionHost,
	rec: ReminderItemRecord,
	st: WordCiteBodyState,
	zh: boolean,
): void {
	const key = host.services.reminders.setIgnored(rec.item || rec.cacheKey, true);
	host.reminderState.lastUndoKey = key;
	host.setReceipt(formatIgnoreReminderReceipt(key, zh), st);
	host.renderAllBodies();
}

export function cycleWordCiteSession(kernel: PluginKernel, snapshot: CitationSnapshotPayload | null): void {
	const sessions = snapshot?.sessions || [];
	if (sessions.length < 2) return;
	const curIdx = sessions.findIndex((s) => s.sessionID === snapshot?.activeSessionID);
	const next = sessions[(curIdx + 1) % sessions.length];
	if (!next) return;
	const wordPort = kernel.ports.get('word-cite');
	if (wordPort) wordPort.switchSession(next.sessionID);
	else kernel.bus.emit('word:switch-session-request', { sessionID: next.sessionID });
}
