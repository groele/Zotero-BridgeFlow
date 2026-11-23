import type { WorkspaceGroupSummary } from '../../kernel/types.ts';

export interface WordCiteBodyState {
	root: HTMLElement;
	docBtn: HTMLButtonElement;
	docDot: HTMLSpanElement;
	docName: HTMLSpanElement;
	docSwap: HTMLSpanElement;
	statsEl: HTMLSpanElement;
	metaEl: HTMLElement;
	insertBtn: HTMLButtonElement;
	refreshBtn: HTMLButtonElement;
	synergyEl: HTMLElement;
	groupBtn: HTMLButtonElement;
	colBtn: HTMLButtonElement;
	receiptEl: HTMLElement;
	activeItem: any;
	lastItemIDs: number[];
	lastGroup: WorkspaceGroupSummary | null;
	setSectionSummary?: (s: string) => void;
}

export interface WordCiteViewModel {
	docName: string;
	docTitle: string;
	isMultiSession: boolean;
	hasWordSession: boolean;
	statsText: string;
	statsTitle: string;
	statsState: 'cited' | 'uncited' | 'none';
	metaText: string;
	metaTitle: string;
	insertLabel: string;
	insertDisabled: boolean;
	refreshDisabled: boolean;
	refreshTitle: string;
	groupButtonText: string;
	groupButtonTitle: string;
	showCollectionButton: boolean;
	colButtonText: string;
	colButtonTitle: string;
	receiptText: string;
	receiptTone: 'ok' | 'warn' | 'err' | 'none';
}

const STYLE_ID = 'zbf-word-cite-styles';

export function ensureWordCitePanelStyles(doc: Document): void {
	if (!doc || doc.getElementById(STYLE_ID)) return;
	const style = doc.createElement('style');
	style.id = STYLE_ID;
	style.textContent = `
.zbf-word-cite-wrap {
	display: flex;
	flex-direction: column;
	gap: 7px;
	padding: 6px 8px 8px;
	font-size: 12px;
}
.zbf-wc-row1 {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 6px;
	min-height: 22px;
}
.zbf-wc-doc {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	max-width: 56%;
	padding: 2px 7px;
	border-radius: 999px;
	border: 1px solid rgba(128, 128, 128, 0.24);
	background: var(--fill-quinary, rgba(128, 128, 128, 0.08));
	color: inherit;
	font-size: 11px;
	line-height: 1.4;
	cursor: default;
	appearance: none;
}
.zbf-wc-doc.is-multi {
	cursor: pointer;
	border-color: rgba(37, 99, 235, 0.35);
}
.zbf-wc-doc.is-multi:hover {
	background: rgba(37, 99, 235, 0.12);
}
.zbf-wc-dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	flex: none;
	background: #94a3b8;
}
.zbf-wc-dot.is-live {
	background: #16a34a;
}
.zbf-wc-docname {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.zbf-wc-swap {
	flex: none;
	opacity: 0.78;
	font-size: 10px;
}
.zbf-wc-stats {
	font-size: 11px;
	padding: 2px 7px;
	border-radius: 999px;
	white-space: nowrap;
	font-variant-numeric: tabular-nums;
	background: rgba(128, 128, 128, 0.1);
	color: inherit;
	opacity: 0.85;
}
.zbf-wc-stats.is-cited {
	background: rgba(22, 163, 74, 0.14);
	color: #15803d;
	font-weight: 600;
	opacity: 1;
}
.zbf-wc-meta {
	font-size: 12px;
	opacity: 0.88;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	padding-inline: 2px;
}
.zbf-wc-actions {
	display: flex;
	align-items: stretch;
	gap: 6px;
}
.zbf-word-cite-action {
	flex: 1 1 auto;
	min-width: 0;
	padding: 5px 10px;
	border-radius: 6px;
	border: 1px solid rgba(37, 99, 235, 0.42);
	background: rgba(37, 99, 235, 0.11);
	color: inherit;
	font-size: 12px;
	font-weight: 600;
	cursor: pointer;
	display: inline-flex;
	align-items: center;
	justify-content: center;
}
.zbf-word-cite-action:hover:not(:disabled) {
	background: rgba(37, 99, 235, 0.2);
}
.zbf-word-cite-action:disabled {
	opacity: 0.45;
	cursor: default;
}
.zbf-word-refresh-action {
	flex: none;
	width: 30px;
	border-radius: 6px;
	border: 1px solid rgba(128, 128, 128, 0.28);
	background: var(--fill-quinary, rgba(128, 128, 128, 0.08));
	color: inherit;
	font-size: 13px;
	cursor: pointer;
	display: inline-flex;
	align-items: center;
	justify-content: center;
}
.zbf-word-refresh-action:hover:not(:disabled) {
	background: var(--fill-quarternary, rgba(128, 128, 128, 0.16));
}
.zbf-wc-synergy {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding-top: 4px;
	border-top: 1px dashed rgba(128, 128, 128, 0.2);
}
.zbf-wc-link {
	background: none;
	border: none;
	padding: 1px 2px;
	font-size: 11px;
	color: #2563eb;
	cursor: pointer;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	text-align: left;
}
.zbf-wc-link:hover {
	text-decoration: underline;
}
.zbf-wc-col-link {
	flex: none;
	margin-inline-start: auto;
}
.zbf-wc-receipt {
	font-size: 11px;
	padding: 4px 7px;
	border-radius: 5px;
	line-height: 1.4;
}
.zbf-wc-receipt.is-ok {
	background: rgba(22, 163, 74, 0.12);
	color: #15803d;
}
.zbf-wc-receipt.is-warn {
	background: rgba(217, 119, 6, 0.12);
	color: #b45309;
}
.zbf-wc-receipt.is-err {
	background: rgba(220, 38, 38, 0.12);
	color: #b91c1c;
}
@media (prefers-color-scheme: dark) {
	.zbf-wc-stats.is-cited,
	.zbf-wc-receipt.is-ok {
		color: #4ade80;
	}
	.zbf-wc-receipt.is-warn {
		color: #fbbf24;
	}
	.zbf-wc-receipt.is-err {
		color: #f87171;
	}
	.zbf-wc-link {
		color: #60a5fa;
	}
}
`;
	(doc.head || doc.documentElement)?.appendChild(style);
}

export function createWordCiteBodyState(doc: Document, body: HTMLElement): WordCiteBodyState {
	ensureWordCitePanelStyles(doc);
	const el = <T extends keyof HTMLElementTagNameMap>(tag: T, cls: string): HTMLElementTagNameMap[T] => {
		const node = doc.createElement(tag);
		node.className = cls;
		return node;
	};

	const root = el('div', 'zbf-word-cite-wrap');
	const row1 = el('div', 'zbf-wc-row1');
	const docBtn = el('button', 'zbf-wc-doc');
	docBtn.type = 'button';
	const docDot = el('span', 'zbf-wc-dot');
	const docName = el('span', 'zbf-wc-docname');
	const docSwap = el('span', 'zbf-wc-swap');
	docSwap.textContent = '⇄';
	docSwap.hidden = true;
	docBtn.append(docDot, docName, docSwap);

	const statsEl = el('span', 'zbf-wc-stats');
	row1.append(docBtn, statsEl);

	const metaEl = el('div', 'zbf-wc-meta');
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

	const receiptEl = el('div', 'zbf-wc-receipt');
	receiptEl.hidden = true;

	root.append(row1, metaEl, actions, synergyEl, receiptEl);
	body.appendChild(root);

	return {
		root, docBtn, docDot, docName, docSwap, statsEl, metaEl,
		insertBtn, refreshBtn, synergyEl, groupBtn, colBtn, receiptEl,
		activeItem: null, lastItemIDs: [], lastGroup: null,
	};
}

export function renderWordCitePanel(st: WordCiteBodyState, vm: WordCiteViewModel): void {
	st.docBtn.classList.toggle('is-multi', vm.isMultiSession);
	st.docBtn.disabled = !vm.isMultiSession;
	st.docBtn.title = vm.docTitle;
	st.docDot.classList.toggle('is-live', vm.hasWordSession);
	st.docName.textContent = vm.docName;
	st.docSwap.hidden = !vm.isMultiSession;

	st.statsEl.textContent = vm.statsText;
	st.statsEl.title = vm.statsTitle;
	st.statsEl.classList.toggle('is-cited', vm.statsState === 'cited');
	st.statsEl.classList.toggle('is-uncited', vm.statsState !== 'cited');

	st.metaEl.textContent = vm.metaText;
	st.metaEl.title = vm.metaTitle;

	st.insertBtn.textContent = vm.insertLabel;
	st.insertBtn.disabled = vm.insertDisabled;
	st.refreshBtn.disabled = vm.refreshDisabled;
	st.refreshBtn.title = vm.refreshTitle;

	st.groupBtn.hidden = !vm.groupButtonText;
	st.groupBtn.textContent = vm.groupButtonText;
	st.groupBtn.title = vm.groupButtonTitle;
	st.colBtn.hidden = !vm.showCollectionButton;
	st.colBtn.textContent = vm.colButtonText;
	st.colBtn.title = vm.colButtonTitle;
	st.synergyEl.hidden = st.groupBtn.hidden && st.colBtn.hidden;

	st.receiptEl.hidden = vm.receiptTone === 'none' || !vm.receiptText;
	st.receiptEl.textContent = vm.receiptText;
	st.receiptEl.classList.remove('is-ok', 'is-warn', 'is-err');
	if (vm.receiptTone !== 'none') st.receiptEl.classList.add(`is-${vm.receiptTone}`);
}
