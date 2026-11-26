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
import { createWordCiteSvgIcon, WORD_CITE_SCHEME_C_CSS } from './word-cite-styles.ts';

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
	mainView: HTMLElement;
	docCard: HTMLElement;
	docRow: HTMLElement;
	wBadge: HTMLSpanElement;
	docNameEl: HTMLElement;
	docStemEl: HTMLSpanElement;
	docExtEl: HTMLSpanElement;
	docDot: HTMLSpanElement;
	docStatusEl: HTMLElement;
	colSepEl: HTMLSpanElement;
	colBtn: HTMLButtonElement;
	docSwitchBtn: HTMLButtonElement;
	docSwitchLbl: HTMLSpanElement;
	statStrip: HTMLElement;
	citedCell: HTMLElement;
	citedValEl: HTMLElement;
	citedLblEl: HTMLSpanElement;
	inTextValEl: HTMLElement;
	inTextLblEl: HTMLSpanElement;
	orphanCell: HTMLElement;
	orphanValEl: HTMLElement;
	orphanLblEl: HTMLSpanElement;
	citeCard: HTMLElement;
	citeKickerEl: HTMLSpanElement;
	citeFreqEl: HTMLSpanElement;
	ordBadgeEl: HTMLSpanElement;
	citeTitleEl: HTMLSpanElement;
	citeSubEl: HTMLElement;
	synergyEl: HTMLElement;
	groupBtn: HTMLButtonElement;
	actionsEl: HTMLElement;
	insertBtn: HTMLButtonElement;
	refreshBtn: HTMLButtonElement;
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
	const mainView = el('div', 'zbf-wc-main-view');

	// 1. Document Connection Card (Amber when disconnected, Cornflower Blue when live)
	const docCard = el('div', 'zbf-wc-card zbf-wc-doc-card');
	const docRow = el('div', 'zbf-wc-doc-row');
	const wBadge = el('span', 'zbf-wc-w');
	wBadge.appendChild(createWordCiteSvgIcon(doc, 'word', 'zbf-wc-word-svg'));
	const docMeta = el('div', 'zbf-wc-doc-meta');
	const docNameEl = el('strong', 'zbf-wc-docname');
	const docStemEl = el('span', 'zbf-wc-doc-stem');
	const docExtEl = el('span', 'zbf-wc-doc-ext');
	docNameEl.append(docStemEl, docExtEl);
	const docSub = el('div', 'zbf-wc-doc-sub');
	const docDot = el('span', 'zbf-wc-dot');
	const docStatusEl = el('span', 'zbf-wc-doc-status');
	const colSepEl = el('span', 'zbf-wc-inline-sep');
	colSepEl.textContent = '·';
	const colBtn = el('button', 'zbf-wc-col-inline zbf-word-col-action');
	colBtn.type = 'button';
	docSub.append(docDot, docStatusEl, colSepEl, colBtn);
	docMeta.append(docNameEl, docSub);
	const docSwitchBtn = el('button', 'zbf-wc-doc-switch');
	docSwitchBtn.type = 'button';
	const docSwitchLbl = el('span', 'zbf-wc-switch-lbl');
	docSwitchBtn.append(createWordCiteSvgIcon(doc, 'switch'), docSwitchLbl);
	docRow.append(wBadge, docMeta, docSwitchBtn);
	docCard.appendChild(docRow);

	// 2. Three Independent Stat Tiles (Coordinated 18px/650 Numbers + Slate Labels)
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

	// 3. Selected Item Card (Coral Spine + Ordinal Badge + In-Text Frequency Pill)
	const citeCard = el('div', 'zbf-wc-card zbf-wc-cite-card');
	const citeHeadEl = el('div', 'zbf-wc-cite-head');
	const citeKickerEl = el('span', 'zbf-wc-cite-kicker');
	const citeFreqEl = el('span', 'zbf-wc-cite-freq');
	citeHeadEl.append(citeKickerEl, citeFreqEl);
	const citeTitleRow = el('div', 'zbf-wc-cite-title-row');
	const ordBadgeEl = el('span', 'zbf-wc-ord-badge');
	const citeTitleEl = el('span', 'zbf-wc-cite-title');
	citeTitleRow.append(ordBadgeEl, citeTitleEl);
	const citeSubEl = el('div', 'zbf-wc-cite-sub');
	const synergyEl = el('div', 'zbf-wc-synergy');
	const groupBtn = el('button', 'zbf-wc-link zbf-word-group-action');
	groupBtn.type = 'button';
	synergyEl.appendChild(groupBtn);
	citeCard.append(citeHeadEl, citeTitleRow, citeSubEl, synergyEl);

	// 4. Standalone Action Bar
	const actionsEl = el('div', 'zbf-wc-actions');
	const insertBtn = el('button', 'zbf-word-cite-action');
	insertBtn.type = 'button';
	const refreshBtn = el('button', 'zbf-word-refresh-action');
	refreshBtn.type = 'button';
	const refreshIcon = createWordCiteSvgIcon(doc, 'refresh');
	refreshBtn.appendChild(refreshIcon);
	refreshBtn.addEventListener('click', () => {
		refreshIcon.classList?.remove?.('is-spinning');
		void (refreshIcon as unknown as { offsetWidth?: number }).offsetWidth;
		refreshIcon.classList?.add?.('is-spinning');
	}, { signal });
	actionsEl.append(insertBtn, refreshBtn);

	// 5. Governance Cards Below Action Bar (Orphan Recovery -> Metadata Reminders)
	const orphanRefs = createOrphanAccordionDom(doc);
	const reminderRefs = createReminderCardDom(doc, reminderHeadCb, signal);
	mainView.append(docCard, statStrip, citeCard, actionsEl, orphanRefs.box, reminderRefs.root);

	const receiptEl = el('div', 'zbf-wc-receipt');
	receiptEl.hidden = true;
	receiptEl.setAttribute('role', 'status');

	root.append(mainView, receiptEl);
	body.appendChild(root);

	return {
		root, mainView, docCard, docRow, wBadge, docNameEl, docStemEl, docExtEl, docDot, docStatusEl, colSepEl, colBtn, docSwitchBtn, docSwitchLbl,
		statStrip, citedCell: c1.cell, citedValEl: c1.val, citedLblEl: c1.lbl, inTextValEl: c2.val, inTextLblEl: c2.lbl,
		orphanCell: c3.cell, orphanValEl: c3.val, orphanLblEl: c3.lbl,
		citeCard, citeKickerEl, citeFreqEl, ordBadgeEl, citeTitleEl, citeSubEl, synergyEl, groupBtn,
		actionsEl, insertBtn, refreshBtn, receiptEl, orphanRefs, reminderRefs,
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
	st.docCard.hidden = !vm.showDocSwitcher;
	st.docCard.classList.toggle('is-live', vm.hasWordSession);
	st.wBadge.classList.toggle('is-live', vm.hasWordSession);
	st.docDot.classList.toggle('is-live', vm.hasWordSession);
	st.docStemEl.textContent = vm.docStem;
	st.docExtEl.textContent = vm.docExt;
	st.docNameEl.title = vm.docSwitchTitle;
	st.docStatusEl.textContent = vm.docStatusText;
	st.colSepEl.hidden = !vm.showCollectionButton;
	st.colBtn.hidden = !vm.showCollectionButton;
	st.colBtn.textContent = vm.colButtonText;
	st.colBtn.title = vm.colButtonTitle;
	st.docSwitchBtn.hidden = !vm.isMultiSession;
	st.docSwitchBtn.disabled = !vm.isMultiSession;
	st.docSwitchBtn.title = vm.docSwitchTitle;
	st.docSwitchLbl.textContent = vm.sessionBadgeText;

	st.statStrip.hidden = !vm.showSummaryCounts;
	st.statStrip.classList.toggle('is-live', vm.hasWordSession);
	st.statStrip.title = vm.statStrip.tooltip;
	st.citedValEl.textContent = vm.statStrip.citedValue;
	st.citedLblEl.textContent = vm.statStrip.citedLabel;
	st.citedCell.classList.toggle('is-interactive', vm.showCollectionButton);
	st.citedCell.title = vm.showCollectionButton ? vm.colButtonTitle : vm.statStrip.tooltip;
	st.citedCell.tabIndex = vm.showCollectionButton ? 0 : -1;
	if (vm.showCollectionButton) st.citedCell.setAttribute?.('role', 'button');
	else st.citedCell.removeAttribute?.('role');
	st.inTextValEl.textContent = vm.statStrip.inTextValue;
	st.inTextLblEl.textContent = vm.statStrip.inTextLabel;
	st.orphanValEl.textContent = vm.statStrip.orphanValue;
	st.orphanLblEl.textContent = vm.statStrip.orphanLabel;
	st.orphanCell.classList.toggle('is-warn', vm.statStrip.orphanWarn);
	const orphanInteractive = vm.statStrip.orphanWarn && vm.orphanCard.visible;
	st.orphanCell.classList.toggle('is-interactive', orphanInteractive);
	st.orphanCell.tabIndex = orphanInteractive ? 0 : -1;
	if (orphanInteractive) st.orphanCell.setAttribute?.('role', 'button');
	else st.orphanCell.removeAttribute?.('role');

	st.citeCard.classList.toggle('is-live', vm.hasWordSession);
	st.citeKickerEl.textContent = vm.currentCite.kicker;
	st.citeFreqEl.hidden = !vm.currentCite.freqText;
	st.citeFreqEl.textContent = vm.currentCite.freqText;
	st.citeFreqEl.classList.toggle('is-uncited', vm.currentCite.freqUncited);
	st.ordBadgeEl.hidden = !vm.currentCite.badgeText;
	st.ordBadgeEl.textContent = vm.currentCite.badgeText;
	st.ordBadgeEl.classList.toggle('is-cited', vm.currentCite.badgeCited);
	st.ordBadgeEl.tabIndex = vm.currentCite.badgeCited ? 0 : -1;
	if (vm.currentCite.badgeCited) {
		st.ordBadgeEl.setAttribute?.('role', 'button');
		st.ordBadgeEl.title = vm.zh ? `点击复制引文标号 ${vm.currentCite.badgeText}` : `Copy citation marker ${vm.currentCite.badgeText}`;
	} else {
		st.ordBadgeEl.removeAttribute?.('role');
		st.ordBadgeEl.removeAttribute?.('title');
	}
	st.citeTitleEl.textContent = vm.currentCite.title;
	st.citeTitleEl.title = vm.currentCite.tooltip;
	st.citeSubEl.hidden = !vm.currentCite.submeta;
	st.citeSubEl.textContent = vm.currentCite.submeta;

	st.groupBtn.hidden = !vm.groupButtonText;
	st.groupBtn.disabled = vm.refreshDisabled;
	st.groupBtn.textContent = vm.groupButtonText;
	st.groupBtn.title = vm.groupButtonTitle;
	st.synergyEl.hidden = st.groupBtn.hidden;

	st.insertBtn.textContent = vm.insertLabel;
	st.insertBtn.disabled = vm.insertDisabled;
	st.refreshBtn.disabled = vm.refreshDisabled;
	st.refreshBtn.title = vm.refreshTitle;
	st.refreshBtn.setAttribute('aria-label', vm.refreshTitle);

	renderReceiptDom(doc, st.receiptEl, vm.receipt, orphanCb);
	renderOrphanCardDom(doc, st.orphanRefs, vm.orphanCard, vm.orphanDisabled, orphanCb);
	renderReminderCardDom(doc, st.reminderRefs, vm.reminders, vm.zh, reminderCb);
}
