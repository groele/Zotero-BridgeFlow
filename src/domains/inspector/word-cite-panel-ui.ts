import type { WorkspaceGroupSummary } from '../../kernel/types.ts';
import {
	buildOrphanBannerModel,
	formatRecoverReceipt,
	isOrphanRecoverable,
	OrphanSelectionState,
	type OrphanCardViewModel,
	type ReceiptAction,
	type ReceiptState,
} from './word-cite-orphan-model.ts';
import {
	createOrphanAccordionDom,
	ORPHAN_AND_RECEIPT_CSS,
	renderOrphanCardDom,
	renderReceiptDom,
	type OrphanAccordionDomRefs,
	type OrphanDomCallbacks,
} from './word-cite-orphan-ui.ts';
import {
	assembleWordCiteViewModel,
	buildCurrentCiteDisplay,
	buildWordCiteSectionSummary,
	buildWordStatStrip,
	formatIgnoreReminderReceipt,
	formatInsertReceipt,
	formatPendingReceipt,
	formatRefreshReceipt,
	type CurrentCiteCardDisplay,
	type WordCiteViewModel,
	type WordStatStripModel,
} from './word-cite-panel-model.ts';
import {
	createReminderCardDom,
	REMINDERS_CARD_CSS,
	renderReminderCardDom,
	type ReminderCardDomRefs,
	type ReminderDomCallbacks,
} from './word-cite-reminders-ui.ts';
import { WORD_CITE_SCHEME_C_CSS } from './word-cite-styles.ts';

export {
	assembleWordCiteViewModel,
	buildCurrentCiteDisplay,
	buildOrphanBannerModel,
	buildWordCiteSectionSummary,
	buildWordStatStrip,
	formatIgnoreReminderReceipt,
	formatInsertReceipt,
	formatPendingReceipt,
	formatRecoverReceipt,
	formatRefreshReceipt,
	isOrphanRecoverable,
	OrphanSelectionState,
};
export type {
	CurrentCiteCardDisplay,
	OrphanCardViewModel,
	OrphanDomCallbacks,
	ReceiptAction,
	ReceiptState,
	WordCiteViewModel,
	WordStatStripModel,
};

export interface WordCiteBodyState {
	root: HTMLElement;
	docCard: HTMLElement;
	docRow: HTMLElement;
	wBadge: HTMLSpanElement;
	docNameEl: HTMLElement;
	docDot: HTMLSpanElement;
	docStatusEl: HTMLSpanElement;
	docSwitchBtn: HTMLButtonElement;
	statStrip: HTMLElement;
	citedValEl: HTMLElement;
	citedLblEl: HTMLSpanElement;
	inTextValEl: HTMLElement;
	inTextLblEl: HTMLSpanElement;
	orphanCell: HTMLElement;
	orphanValEl: HTMLElement;
	orphanLblEl: HTMLSpanElement;
	citeCard: HTMLElement;
	citeKickerEl: HTMLSpanElement;
	ordBadgeEl: HTMLSpanElement;
	citeTitleEl: HTMLElement;
	citeSubEl: HTMLElement;
	insertBtn: HTMLButtonElement;
	refreshBtn: HTMLButtonElement;
	synergyEl: HTMLElement;
	groupBtn: HTMLButtonElement;
	colBtn: HTMLButtonElement;
	receiptEl: HTMLElement;
	orphanRefs: OrphanAccordionDomRefs;
	reminderRefs: ReminderCardDomRefs;
	activeItem: any;
	lastItemIDs: number[];
	lastGroup: WorkspaceGroupSummary | null;
	setSectionSummary?: (s: string) => void;
}

const STYLE_ID = 'zbf-word-cite-styles';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

function createXhtmlEl<T extends keyof HTMLElementTagNameMap>(doc: Document, tag: T): HTMLElementTagNameMap[T] {
	return typeof doc.createElementNS === 'function'
		? (doc.createElementNS(XHTML_NS, tag) as HTMLElementTagNameMap[T])
		: doc.createElement(tag);
}

export function ensureWordCitePanelStyles(doc: Document): void {
	if (!doc?.getElementById) return;
	let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
	if (!style) {
		style = createXhtmlEl(doc, 'style');
		style.id = STYLE_ID;
		(doc.head || doc.documentElement)?.appendChild(style);
	}
	const css = `${WORD_CITE_SCHEME_C_CSS}\n${ORPHAN_AND_RECEIPT_CSS}\n${REMINDERS_CARD_CSS}`;
	if (style.textContent !== css) style.textContent = css;
}

export function createWordCiteBodyState(
	doc: Document,
	body: HTMLElement,
	reminderHeadCb: Pick<ReminderDomCallbacks, 'onToggleAccordion' | 'onSelectFilter'>,
	signal: AbortSignal,
): WordCiteBodyState {
	ensureWordCitePanelStyles(doc);
	const el = <T extends keyof HTMLElementTagNameMap>(tag: T, cls: string): HTMLElementTagNameMap[T] => {
		const node = createXhtmlEl(doc, tag);
		node.className = cls;
		return node;
	};

	const root = el('div', 'zbf-word-cite-wrap');

	const docCard = el('div', 'zbf-wc-card zbf-wc-doc-card');
	const docRow = el('div', 'zbf-wc-doc-row');
	const wBadge = el('span', 'zbf-wc-w');
	wBadge.textContent = 'W';
	const docMeta = el('div', 'zbf-wc-doc-meta');
	const docNameEl = el('strong', 'zbf-wc-docname');
	const docSub = el('span', 'zbf-wc-doc-sub');
	const docDot = el('span', 'zbf-wc-dot');
	const docStatusEl = el('span', 'zbf-wc-doc-status');
	docSub.append(docDot, docStatusEl);
	docMeta.append(docNameEl, docSub);
	const docSwitchBtn = el('button', 'zbf-wc-doc-switch');
	docSwitchBtn.type = 'button';
	docSwitchBtn.textContent = '⇄';
	docRow.append(wBadge, docMeta, docSwitchBtn);

	const statStrip = el('div', 'zbf-wc-stat-strip');
	const mkCell = () => {
		const cell = el('div', 'zbf-wc-stat-cell');
		const val = el('b', 'zbf-wc-stat-val');
		const lbl = el('span', 'zbf-wc-stat-lbl');
		cell.append(val, lbl);
		return { cell, val, lbl };
	};
	const c1 = mkCell();
	const c2 = mkCell();
	const c3 = mkCell();
	statStrip.append(c1.cell, c2.cell, c3.cell);
	docCard.append(docRow, statStrip);

	const citeCard = el('div', 'zbf-wc-card zbf-wc-cite-card');
	const citeHead = el('div', 'zbf-wc-cite-head');
	const citeKickerEl = el('span', 'zbf-wc-cite-kicker');
	const ordBadgeEl = el('span', 'zbf-wc-ord-badge');
	citeHead.append(citeKickerEl, ordBadgeEl);
	const citeTitleEl = el('div', 'zbf-wc-cite-title');
	const citeSubEl = el('div', 'zbf-wc-cite-sub');

	const actions = el('div', 'zbf-wc-actions');
	const insertBtn = el('button', 'zbf-word-cite-action');
	insertBtn.type = 'button';
	const refreshBtn = el('button', 'zbf-word-refresh-action');
	refreshBtn.type = 'button';
	refreshBtn.textContent = '↻';
	actions.append(insertBtn, refreshBtn);

	const synergyEl = el('div', 'zbf-wc-synergy');
	const groupBtn = el('button', 'zbf-wc-link zbf-word-group-action');
	groupBtn.type = 'button';
	const colBtn = el('button', 'zbf-wc-link zbf-wc-col-link zbf-word-col-action');
	colBtn.type = 'button';
	synergyEl.append(groupBtn, colBtn);
	citeCard.append(citeHead, citeTitleEl, citeSubEl, actions, synergyEl);

	const receiptEl = el('div', 'zbf-wc-receipt');
	receiptEl.hidden = true;
	receiptEl.setAttribute('role', 'status');

	const orphanRefs = createOrphanAccordionDom(doc);
	const reminderRefs = createReminderCardDom(doc, reminderHeadCb, signal);

	root.append(docCard, citeCard, receiptEl, orphanRefs.box, reminderRefs.root);
	body.appendChild(root);

	return {
		root, docCard, docRow, wBadge, docNameEl, docDot, docStatusEl, docSwitchBtn,
		statStrip, citedValEl: c1.val, citedLblEl: c1.lbl, inTextValEl: c2.val, inTextLblEl: c2.lbl,
		orphanCell: c3.cell, orphanValEl: c3.val, orphanLblEl: c3.lbl,
		citeCard, citeKickerEl, ordBadgeEl, citeTitleEl, citeSubEl,
		insertBtn, refreshBtn, synergyEl, groupBtn, colBtn,
		receiptEl, orphanRefs, reminderRefs,
		activeItem: null, lastItemIDs: [], lastGroup: null,
	};
}

export function renderWordCitePanel(
	st: WordCiteBodyState,
	vm: WordCiteViewModel,
	orphanCb: OrphanDomCallbacks,
	reminderCb: Pick<ReminderDomCallbacks, 'onLocateItem' | 'onIgnoreItem' | 'onRestoreItem'>,
): void {
	const doc = st.root.ownerDocument!;

	st.docRow.hidden = !vm.showDocSwitcher;
	st.wBadge.classList.toggle('is-live', vm.hasWordSession);
	st.docDot.classList.toggle('is-live', vm.hasWordSession);
	st.docNameEl.textContent = vm.docName;
	st.docNameEl.title = vm.docSwitchTitle;
	st.docStatusEl.textContent = vm.docStatusText;
	st.docSwitchBtn.hidden = !vm.isMultiSession && !vm.hasWordSession;
	st.docSwitchBtn.disabled = !vm.isMultiSession;
	st.docSwitchBtn.title = vm.docSwitchTitle;

	st.statStrip.hidden = !vm.showSummaryCounts;
	st.statStrip.classList.toggle('is-solo', !vm.showDocSwitcher);
	st.statStrip.title = vm.statStrip.tooltip;
	st.citedValEl.textContent = vm.statStrip.citedValue;
	st.citedLblEl.textContent = vm.statStrip.citedLabel;
	st.inTextValEl.textContent = vm.statStrip.inTextValue;
	st.inTextLblEl.textContent = vm.statStrip.inTextLabel;
	st.orphanValEl.textContent = vm.statStrip.orphanValue;
	st.orphanLblEl.textContent = vm.statStrip.orphanLabel;
	st.orphanCell.classList.toggle('is-warn', vm.statStrip.orphanWarn);
	st.docCard.hidden = !vm.showDocSwitcher && !vm.showSummaryCounts;

	st.citeKickerEl.textContent = vm.currentCite.kicker;
	st.ordBadgeEl.hidden = !vm.currentCite.badgeText;
	st.ordBadgeEl.textContent = vm.currentCite.badgeText;
	st.ordBadgeEl.classList.toggle('is-cited', vm.currentCite.badgeCited);
	st.citeTitleEl.textContent = vm.currentCite.title;
	st.citeTitleEl.title = vm.currentCite.tooltip;
	st.citeSubEl.hidden = !vm.currentCite.submeta;
	st.citeSubEl.textContent = vm.currentCite.submeta;

	st.insertBtn.textContent = vm.insertLabel;
	st.insertBtn.disabled = vm.insertDisabled;
	st.refreshBtn.disabled = vm.refreshDisabled;
	st.refreshBtn.title = vm.refreshTitle;

	st.groupBtn.hidden = !vm.groupButtonText;
	st.groupBtn.disabled = vm.refreshDisabled;
	st.groupBtn.textContent = vm.groupButtonText;
	st.groupBtn.title = vm.groupButtonTitle;
	st.colBtn.hidden = !vm.showCollectionButton;
	st.colBtn.textContent = vm.colButtonText;
	st.colBtn.title = vm.colButtonTitle;
	st.synergyEl.hidden = st.groupBtn.hidden && st.colBtn.hidden;

	renderReceiptDom(doc, st.receiptEl, vm.receipt, orphanCb);
	renderOrphanCardDom(doc, st.orphanRefs, vm.orphanCard, vm.orphanDisabled, orphanCb);
	renderReminderCardDom(doc, st.reminderRefs, vm.reminders, vm.zh, reminderCb);
}
