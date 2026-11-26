import type { PluginKernel } from '../../../kernel/plugin-kernel.ts';
import type { CitationSnapshotPayload } from '../../../kernel/types.ts';
import { locateItemInZoteroLibrary } from '../../../services/item-resolution.ts';
import type { ServiceContainer } from '../../../services/service-container.ts';
import { formatIgnoreReminderReceipt } from './word-cite-panel-model.ts';
import type { ReceiptAction, ReceiptState, WordCiteBodyState } from './word-cite-panel-ui.ts';
import type { ReminderItemRecord, ReminderUiState } from './word-cite-reminders-model.ts';

export interface WordCiteActionHost {
	kernel: PluginKernel;
	services: ServiceContainer;
	reminderState: ReminderUiState;
	hasPendingRequest: () => boolean;
	beginRequest: (kind: 'insert' | 'refresh' | 'recover', owner?: WordCiteBodyState) => string;
	setReceipt: (receipt: ReceiptState, owner?: WordCiteBodyState) => void;
	renderAllBodies: () => void;
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
		if (host.hasPendingRequest()) return;
		host.kernel.bus.emit('word:refresh-request', {
			requestId: host.beginRequest('refresh', st),
			sessionID: act.sessionID,
			win,
		});
		return;
	}
	if (act.kind === 'locate-recovered' && act.itemIDs?.length) {
		if (act.sessionID && host.kernel.prefs.get('wordCite.collections.enable')) {
			host.kernel.bus.emit('word:select-collection-request', { sessionID: act.sessionID, win });
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
	if (next) kernel.bus.emit('word:switch-session-request', { sessionID: next.sessionID });
}
