import { getCachedPrimaryItemFields } from '../../services/item-resolution.ts';
import type { CitationSnapshotPayload, WordInsertResultPayload, WordRefreshResultPayload, WorkspaceGroupSummary } from '../../kernel/types.ts';
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
	ORPHAN_AND_RECEIPT_CSS,
	renderOrphanCardDom,
	renderReceiptDom,
	type OrphanDomCallbacks,
} from './word-cite-orphan-ui.ts';

export { buildOrphanBannerModel, formatRecoverReceipt, isOrphanRecoverable, OrphanSelectionState };
export type { OrphanCardViewModel, OrphanDomCallbacks, ReceiptAction, ReceiptState };

export function formatInsertReceipt(res: WordInsertResultPayload, zh: boolean): ReceiptState {
	const doc = res.documentName ? (zh ? `「${res.documentName}」` : `"${res.documentName}"`) : 'Word';
	if (res.status === 'inserted') return { tone: 'ok', text: zh ? `✓ 已插入 ${res.itemCount} 篇引文到 ${doc}` : `✓ Inserted ${res.itemCount} citation(s) into ${doc}` };
	if (res.status === 'busy') return { tone: 'warn', text: zh ? '⌛ Word 正在处理引文，请稍候再试' : '⌛ Word is busy updating citations, try again' };
	if (res.status === 'non-word') return { tone: 'warn', text: zh ? '⚠ 当前激活文档不是受支持的 Word 文档' : '⚠ Active document is not a supported Word document' };
	if (res.status === 'cancelled') return { tone: 'warn', text: zh ? 'ⓘ 已取消插入引文' : 'ⓘ Citation insertion cancelled' };
	return { tone: 'err', text: zh ? '✕ 插入失败：请先打开 Word 并确认插件连接正常' : '✕ Unable to insert: verify Word is open and connected' };
}

export function formatRefreshReceipt(res: WordRefreshResultPayload, zh: boolean): ReceiptState {
	const doc = res.documentName ? (zh ? `「${res.documentName}」` : `"${res.documentName}"`) : 'Word';
	if (res.ok) return { tone: 'ok', text: zh ? `↻ 已刷新 ${doc}，并同步序号` : `↻ Refreshed ${doc} citations` };
	return { tone: 'warn', text: zh ? '⚠ 未检测到可刷新的活动 Word 文档' : '⚠ No active Word document to refresh' };
}

export function formatPendingReceipt(kind: 'insert' | 'refresh' | 'recover', zh: boolean): ReceiptState {
	const text = kind === 'insert' ? (zh ? '正在插入 Word 引文…' : 'Inserting Word citations…')
		: kind === 'recover' ? (zh ? '正在单事务还原/重建引文并重连 Word…' : 'Recovering & relinking citations…')
		: (zh ? '正在刷新 Word 引文…' : 'Refreshing Word citations…');
	return { tone: 'warn', text };
}

export function buildWordCiteSectionSummary(zh: boolean, snap: CitationSnapshotPayload | null, ids: readonly number[]): string {
	if (!snap?.activeSessionID) return '';
	const total = snap.totalCitedCount;
	const orphanSuffix = snap.orphans?.length
		? (zh ? ` · ⚠ ${snap.orphans.length} 缺失` : ` · ⚠ ${snap.orphans.length} missing`)
		: '';
	if (ids.length > 1) return (zh ? `已选 ${ids.length} 篇 · 共引 ${total} 篇` : `${ids.length} selected · ${total} cited`) + orphanSuffix;
	const badge = ids.length === 1 ? snap.byItemID.get(ids[0]) : undefined;
	if (badge) return (zh ? `序号 [${badge.ordinal}] · 共引 ${total} 篇` : `[${badge.ordinal}] · ${total} cited`) + orphanSuffix;
	return (zh ? `未引用 · 共引 ${total} 篇` : `Uncited · ${total} cited`) + orphanSuffix;
}

export function buildWordCiteStats(zh: boolean, snap: CitationSnapshotPayload | null, ids: readonly number[]): { text: string; title: string; state: 'cited' | 'uncited' | 'warn' | 'none' } {
	if (!snap?.activeSessionID) {
		return { text: zh ? '请先打开 Word' : 'Open Word first', title: zh ? '暂未检测到活动 Word 文档会话' : 'No active Word session detected', state: 'none' };
	}
	const total = snap.totalCitedCount;
	const orphanCount = snap.orphans?.length ?? 0;
	const orphanShort = orphanCount > 0 ? (zh ? ` · ⚠${orphanCount}` : ` · ⚠${orphanCount}`) : '';
	const orphanTip = orphanCount > 0 ? (zh ? `；另有 ${orphanCount} 篇缺失引文待找回` : `; ${orphanCount} broken citation(s)`) : '';
	if (ids.length === 1) {
		const b = snap.byItemID.get(ids[0]);
		if (b) {
			const occ = b.occurrences ?? 1;
			return {
				text: (zh ? `序号 [${b.ordinal}] / 共 ${total} 篇` : `[${b.ordinal}] / ${total} cited`) + orphanShort,
				title: (zh ? `在「${snap.activeDocumentName}」中出现 ${occ} 次${b.shortText ? ` · ${b.shortText}` : ''}` : `Cited ${occ} time(s) in "${snap.activeDocumentName}"`) + orphanTip,
				state: 'cited',
			};
		}
		return {
			text: (zh ? `未引 / 共 ${total} 篇` : `Uncited / ${total}`) + orphanShort,
			title: (zh ? `尚未在「${snap.activeDocumentName}」中引用 (当前共引 ${total} 篇)` : `Not yet cited in "${snap.activeDocumentName}" (${total} total)`) + orphanTip,
			state: orphanCount > 0 ? 'warn' : 'uncited',
		};
	}
	if (ids.length > 1) {
		const cited = ids.map((id) => snap.byItemID.get(id)).filter((b): b is NonNullable<typeof b> => Boolean(b)).sort((a, b) => a.ordinal - b.ordinal);
		if (cited.length) {
			const list = `[${cited.slice(0, 3).map((b) => b.ordinal).join(', ')}${cited.length > 3 ? '…' : ''}]`;
			return {
				text: (zh ? `已引 ${list} / 共 ${total} 篇` : `${cited.length}/${ids.length} cited · ${total} total`) + orphanShort,
				title: (zh ? `所选 ${ids.length} 篇中有 ${cited.length} 篇已引用` : `${cited.length} of ${ids.length} selected items cited`) + orphanTip,
				state: 'cited',
			};
		}
		return {
			text: (zh ? `未引 (${ids.length} 篇) / 共 ${total} 篇` : `0/${ids.length} cited · ${total} total`) + orphanShort,
			title: (zh ? '当前选中文献均尚未在 Word 中引用' : 'None of the selected items are cited yet') + orphanTip,
			state: orphanCount > 0 ? 'warn' : 'uncited',
		};
	}
	return { text: (zh ? `共引 ${total} 篇` : `${total} cited`) + orphanShort, title: snap.activeDocumentName + orphanTip, state: orphanCount > 0 ? 'warn' : 'uncited' };
}

export function buildWordCiteMetaText(zh: boolean, items: readonly any[]): string {
	if (!items.length) return zh ? '请选择文献条目以插入 Word 引文' : 'Select an item to insert a Word citation';
	const info = getCachedPrimaryItemFields(items[0]);
	const first = [info.creatorYear, info.title].filter(Boolean).join(' · ') || info.title;
	if (items.length === 1) return first;
	return zh ? `已选 ${items.length} 篇：${first}` : `${items.length} items: ${first}`;
}

export interface WordCiteBodyState {
	root: HTMLElement;
	row1: HTMLElement;
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
	orphanBox: HTMLElement;
	orphanHead: HTMLElement;
	orphanTitle: HTMLElement;
	orphanToggleBtn: HTMLButtonElement;
	orphanChips: HTMLElement;
	orphanList: HTMLElement;
	orphanBtn: HTMLButtonElement;
	receiptEl: HTMLElement;
	activeItem: any;
	lastItemIDs: number[];
	lastGroup: WorkspaceGroupSummary | null;
	setSectionSummary?: (s: string) => void;
}

export interface WordCiteViewModel {
	showDocSwitcher: boolean;
	showSummaryCounts: boolean;
	docName: string;
	docTitle: string;
	isMultiSession: boolean;
	hasWordSession: boolean;
	statsText: string;
	statsTitle: string;
	statsState: 'cited' | 'uncited' | 'warn' | 'none';
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
	orphanCard: OrphanCardViewModel;
	orphanDisabled: boolean;
	receipt: ReceiptState;
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
	const css = `
item-details:not([pinnedPane]:not([pinnedPane=""])) .zotero-view-item:has(> :nth-last-child(1 of [data-pane]:not([hidden])) .zbf-word-cite-wrap)::before { height: 0; }
.zbf-word-cite-wrap { box-sizing: border-box; display: grid; grid-template-columns: minmax(0, 1fr); gap: 7px; inline-size: 100%; max-inline-size: 100%; min-inline-size: 0; contain: inline-size; overflow: hidden; padding: 6px 2px 8px; font-size: 12px; }
.zbf-word-cite-wrap [hidden] { display: none !important; }
.zbf-wc-row1 { order: 0; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; min-width: 0; max-width: 100%; min-height: 22px; }
.zbf-wc-doc { box-sizing: border-box; display: inline-flex; align-items: center; gap: 5px; min-width: 0; max-width: 100%; flex: 0 1 auto; padding: 2px 7px; border-radius: 999px; border: 1px solid rgba(128,128,128,0.24); background: var(--fill-quinary, rgba(128,128,128,0.08)); color: inherit; font-size: 11px; line-height: 1.4; cursor: default; appearance: none; }
.zbf-wc-doc.is-multi { cursor: pointer; border-color: rgba(37,99,235,0.35); }
.zbf-wc-doc.is-multi:hover { background: rgba(37,99,235,0.12); }
.zbf-wc-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: #94a3b8; }
.zbf-wc-dot.is-live { background: #16a34a; }
.zbf-wc-docname { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-swap { flex: none; opacity: 0.78; font-size: 10px; }
.zbf-wc-stats { box-sizing: border-box; font-size: 11px; padding: 2px 7px; border-radius: 999px; max-width: 100%; min-width: 0; flex: 0 1 auto; margin-inline-start: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; background: rgba(128,128,128,0.1); color: inherit; opacity: 0.85; }
.zbf-wc-stats.is-cited { background: rgba(22,163,74,0.14); color: #15803d; font-weight: 600; opacity: 1; }
.zbf-wc-stats.is-warn { background: rgba(217,119,6,0.14); color: #b45309; font-weight: 600; opacity: 1; }
.zbf-wc-meta { order: 3; min-width: 0; max-width: 100%; font-size: 12px; opacity: 0.88; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-inline: 2px; }
.zbf-wc-actions { order: 4; display: flex; align-items: stretch; gap: 6px; min-width: 0; max-width: 100%; }
.zbf-word-cite-action { box-sizing: border-box; flex: 1 1 0; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 5px 8px; border-radius: 6px; border: 1px solid rgba(37,99,235,0.42); background: rgba(37,99,235,0.11); color: inherit; font-size: 12px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.zbf-word-cite-action:hover:not(:disabled) { background: rgba(37,99,235,0.2); }
.zbf-word-cite-action:disabled { opacity: 0.45; cursor: default; }
.zbf-word-refresh-action { box-sizing: border-box; flex: 0 0 30px; width: 30px; border-radius: 6px; border: 1px solid rgba(128,128,128,0.28); background: var(--fill-quinary, rgba(128,128,128,0.08)); color: inherit; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.zbf-word-refresh-action:hover:not(:disabled) { background: var(--fill-quarternary, rgba(128,128,128,0.16)); }
.zbf-wc-synergy { order: 5; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; min-width: 0; max-width: 100%; padding-top: 4px; border-top: 1px dashed rgba(128,128,128,0.2); }
.zbf-wc-link { min-width: 0; max-width: 100%; background: none; border: none; padding: 1px 2px; font-size: 11px; color: #2563eb; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.zbf-wc-link:hover { text-decoration: underline; }
.zbf-wc-doc.is-multi:focus-visible, .zbf-word-cite-action:focus-visible, .zbf-word-refresh-action:focus-visible, .zbf-wc-link:focus-visible, .zbf-wc-orphan-btn:focus-visible, .zbf-wc-rcp-btn:focus-visible { outline: 2px solid var(--accent-blue, #2563eb); outline-offset: 1px; }
.zbf-wc-col-link { flex: none; margin-inline-start: auto; }
${ORPHAN_AND_RECEIPT_CSS}
@media (prefers-color-scheme: dark) {
	.zbf-wc-stats.is-cited, .zbf-wc-receipt.is-ok { color: #4ade80; }
	.zbf-wc-stats.is-warn, .zbf-wc-receipt.is-warn { color: #fbbf24; }
	.zbf-wc-receipt.is-err { color: #f87171; }
	.zbf-wc-link { color: #60a5fa; }
}`;
	if (style.textContent !== css) style.textContent = css;
}

export function createWordCiteBodyState(doc: Document, body: HTMLElement): WordCiteBodyState {
	ensureWordCitePanelStyles(doc);
	const el = <T extends keyof HTMLElementTagNameMap>(tag: T, cls: string): HTMLElementTagNameMap[T] => {
		const node = createXhtmlEl(doc, tag);
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

	const orphanBox = el('div', 'zbf-wc-orphan-box');
	orphanBox.hidden = true;
	const orphanHead = el('div', 'zbf-wc-orphan-head');
	const orphanTitle = el('div', 'zbf-wc-orphan-title');
	const orphanToggleBtn = el('button', 'zbf-wc-orphan-toggle');
	orphanToggleBtn.type = 'button';
	orphanHead.append(orphanTitle, orphanToggleBtn);
	const orphanChips = el('div', 'zbf-wc-orphan-chips');
	const orphanList = el('div', 'zbf-wc-orphan-list');
	const orphanBtn = el('button', 'zbf-wc-orphan-btn');
	orphanBtn.type = 'button';
	orphanBox.append(orphanHead, orphanChips, orphanList, orphanBtn);

	const receiptEl = el('div', 'zbf-wc-receipt');
	receiptEl.hidden = true;
	receiptEl.setAttribute('role', 'status');

	// Keep exact child indices [row1, metaEl, actions, synergyEl, receiptEl, orphanBox]; CSS Grid `order` places orphanBox & receiptEl under row1.
	root.append(row1, metaEl, actions, synergyEl, receiptEl, orphanBox);
	body.appendChild(root);

	return {
		root, row1, docBtn, docDot, docName, docSwap, statsEl, metaEl,
		insertBtn, refreshBtn, synergyEl, groupBtn, colBtn,
		orphanBox, orphanHead, orphanTitle, orphanToggleBtn, orphanChips, orphanList, orphanBtn,
		receiptEl, activeItem: null, lastItemIDs: [], lastGroup: null,
	};
}

export function renderWordCitePanel(st: WordCiteBodyState, vm: WordCiteViewModel, cb: OrphanDomCallbacks): void {
	const doc = st.root.ownerDocument!;
	st.docBtn.hidden = !vm.showDocSwitcher;
	st.docBtn.classList.toggle('is-multi', vm.isMultiSession);
	st.docBtn.disabled = !vm.isMultiSession;
	st.docBtn.title = vm.docTitle;
	st.docDot.classList.toggle('is-live', vm.hasWordSession);
	st.docName.textContent = vm.docName;
	st.docSwap.hidden = !vm.isMultiSession;

	st.statsEl.hidden = !vm.showSummaryCounts;
	st.statsEl.textContent = vm.statsText;
	st.statsEl.title = vm.statsTitle;
	st.statsEl.classList.toggle('is-cited', vm.statsState === 'cited');
	st.statsEl.classList.toggle('is-warn', vm.statsState === 'warn');
	st.statsEl.classList.toggle('is-uncited', vm.statsState === 'uncited' || vm.statsState === 'none');
	st.row1.hidden = !vm.showDocSwitcher && !vm.showSummaryCounts;

	st.metaEl.textContent = vm.metaText;
	st.metaEl.title = vm.metaTitle;

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

	renderOrphanCardDom(
		doc, st.orphanBox, st.orphanHead, st.orphanTitle, st.orphanToggleBtn,
		st.orphanChips, st.orphanList, st.orphanBtn, vm.orphanCard, vm.orphanDisabled, cb,
	);
	renderReceiptDom(doc, st.receiptEl, vm.receipt, cb);
}
