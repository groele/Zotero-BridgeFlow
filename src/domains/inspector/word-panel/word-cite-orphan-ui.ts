import type { OrphanCardViewModel, ReceiptAction, ReceiptState } from './word-cite-orphan-model.ts';
import { createWordCiteSvgIcon } from './word-cite-styles.ts';

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

export interface OrphanDomCallbacks {
	onToggleAccordion(): void;
	onToggleItem(key: string): void;
	onToggleExpand(): void;
	onReceiptAction(action: ReceiptAction): void;
	onDismissReceipt(): void;
}

export interface OrphanAccordionDomRefs {
	readonly box: HTMLElement;
	readonly accHeadBtn: HTMLButtonElement;
	readonly badgeEl: HTMLSpanElement;
	readonly titleEl: HTMLSpanElement;
	readonly arrowEl: HTMLSpanElement;
	readonly bodyEl: HTMLElement;
	readonly chipsRow: HTMLElement;
	readonly chipsEl: HTMLElement;
	readonly toggleBtn: HTMLButtonElement;
	readonly listEl: HTMLElement;
	readonly footEl: HTMLElement;
	readonly footHintEl: HTMLSpanElement;
	readonly actionBtn: HTMLButtonElement;
}

function createEl<T extends keyof HTMLElementTagNameMap>(doc: Document, tag: T, cls?: string): HTMLElementTagNameMap[T] {
	const node = (typeof doc.createElementNS === 'function'
		? doc.createElementNS(XHTML_NS, tag)
		: doc.createElement(tag)) as HTMLElementTagNameMap[T];
	if (cls) node.className = cls;
	return node;
}

function clearChildren(el: HTMLElement): void {
	if (typeof el.replaceChildren === 'function') {
		el.replaceChildren();
		return;
	}
	if (Array.isArray((el as unknown as { children?: unknown[] }).children)) {
		(el as unknown as { children: unknown[] }).children.length = 0;
	}
	el.textContent = '';
}

export const ORPHAN_AND_RECEIPT_CSS = `
.zbf-wc-orphan-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-width: 0; }
.zbf-wc-orphan-chips { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.zbf-wc-orphan-chip, .zbf-wc-orphan-tag, .zbf-wc-rcp-chip { display: inline-flex; align-items: center; padding: 1px 6px; border-radius: 999px; font-size: 10px; line-height: 1.4; white-space: nowrap; font-weight: 500; }
.zbf-wc-orphan-chip.is-trash, .zbf-wc-orphan-tag.is-trash { background: light-dark(rgba(24,121,78,0.12), rgba(34,197,94,0.18)); color: light-dark(#18794e, #4ade80); }
.zbf-wc-orphan-chip.is-rebuild, .zbf-wc-orphan-tag.is-rebuild { background: light-dark(rgba(40,115,200,0.11), rgba(59,130,246,0.2)); color: light-dark(#2873c8, #60a5fa); }
.zbf-wc-orphan-chip.is-unrec, .zbf-wc-orphan-tag.is-unrec { background: light-dark(#eef1f4, rgba(255,255,255,0.1)); color: var(--fill-secondary, light-dark(#64717d, #9ca3af)); }
.zbf-wc-orphan-toggle { flex: none; background: none; border: 0; padding: 1px 4px; border-radius: 4px; font-size: 10px; color: light-dark(#2873c8, #60a5fa); cursor: pointer; }
.zbf-wc-orphan-toggle:hover { text-decoration: underline; }
.zbf-wc-orphan-list { box-sizing: border-box; display: grid; gap: 0; max-height: 184px; overflow-x: hidden; overflow-y: auto; min-width: 0; max-width: 100%; }
.zbf-wc-orphan-row { box-sizing: border-box; display: flex; align-items: flex-start; gap: 7px; padding: 6px 0; border-bottom: 1px solid var(--zbf-wc-divider, light-dark(rgba(0,0,0,0.06), rgba(255,255,255,0.07))); cursor: pointer; min-width: 0; max-width: 100%; }
.zbf-wc-orphan-row:last-child { border-bottom: 0; }
.zbf-wc-orphan-row.is-disabled { opacity: 0.6; cursor: default; }
.zbf-wc-orphan-chk { margin: 2px 0 0; flex: none; cursor: inherit; accent-color: #2d6cdf; }
.zbf-wc-orphan-ord { flex: none; font-family: var(--zbf-num-font, inherit); font-size: 10.5px; font-weight: 600; color: light-dark(#9a5209, #fbbf24); font-variant-numeric: tabular-nums; line-height: 1.4; }
.zbf-wc-orphan-main { flex: 1 1 0; min-width: 0; display: grid; gap: 2px; }
.zbf-wc-orphan-item-title { font-size: 11.5px; font-weight: 500; line-height: 1.38; color: var(--zbf-wc-fg, light-dark(#1f2328, #e6e8eb)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-orphan-item-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; font-size: 10px; color: var(--zbf-wc-fg-muted, light-dark(#6e7781, #8b949e)); min-width: 0; }
.zbf-wc-orphan-author { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px; }
.zbf-wc-orphan-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 6px; border-top: 1px solid var(--zbf-wc-divider, light-dark(rgba(0,0,0,0.06), rgba(255,255,255,0.07))); }
.zbf-wc-orphan-hint { font-size: 10px; color: var(--zbf-wc-fg-muted, light-dark(#6e7781, #8b949e)); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-receipt { margin: 0; display: grid; gap: 5px; font-size: 11px; padding: 6px 9px; border-radius: 6px; line-height: 1.4; border: 1px solid transparent; }
.zbf-wc-receipt.is-ok { background: light-dark(rgba(24, 121, 78, 0.08), rgba(24, 121, 78, 0.16)); border-color: light-dark(rgba(24, 121, 78, 0.2), rgba(34, 197, 94, 0.3)); color: light-dark(#18794e, #4ade80); }
.zbf-wc-receipt.is-warn { background: light-dark(rgba(217, 119, 6, 0.09), rgba(245, 158, 11, 0.16)); border-color: light-dark(rgba(217, 119, 6, 0.22), rgba(245, 158, 11, 0.32)); color: light-dark(#9a5209, #fbbf24); }
.zbf-wc-receipt.is-err { background: light-dark(rgba(220, 38, 38, 0.08), rgba(220, 38, 38, 0.16)); border-color: light-dark(rgba(220, 38, 38, 0.2), rgba(248, 113, 113, 0.32)); color: light-dark(#b91c1c, #f87171); }
.zbf-wc-rcp-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-width: 0; font-weight: 600; }
.zbf-wc-rcp-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-rcp-close { flex: none; background: none; border: 0; padding: 0 3px; font-size: 13px; line-height: 1; color: inherit; opacity: 0.7; cursor: pointer; border-radius: 4px; }
.zbf-wc-rcp-close:hover { opacity: 1; background: color-mix(in srgb, currentColor 14%, transparent); }
.zbf-wc-rcp-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.zbf-wc-rcp-chip.is-ok { background: light-dark(rgba(24,121,78,0.14), rgba(34,197,94,0.2)); color: light-dark(#18794e, #4ade80); }
.zbf-wc-rcp-chip.is-info { background: light-dark(rgba(40,115,200,0.12), rgba(59,130,246,0.22)); color: light-dark(#2873c8, #60a5fa); }
.zbf-wc-rcp-chip.is-warn { background: light-dark(rgba(154,91,19,0.14), rgba(245,158,11,0.22)); color: light-dark(#9a5b13, #fbbf24); }
.zbf-wc-rcp-foot { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; min-width: 0; padding-top: 3px; border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent); }
.zbf-wc-rcp-note { font-size: 10px; opacity: 0.85; min-width: 0; flex: 1 1 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-rcp-actions { display: inline-flex; align-items: center; gap: 5px; margin-inline-start: auto; }
.zbf-wc-rcp-btn { background: light-dark(rgba(255,255,255,0.82), rgba(255,255,255,0.08)); border: 1px solid currentColor; border-radius: 4px; padding: 2px 7px; font-size: 10.5px; font-weight: 600; color: inherit; cursor: pointer; white-space: nowrap; }
.zbf-wc-rcp-btn:hover { background: light-dark(#ffffff, rgba(255,255,255,0.16)); }
`;

export function createOrphanAccordionDom(doc: Document): OrphanAccordionDomRefs {
	const box = createEl(doc, 'section', 'zbf-wc-acc zbf-wc-orphan-box');
	box.hidden = true;
	const accHeadBtn = createEl(doc, 'button', 'zbf-wc-acc-head');
	accHeadBtn.type = 'button';
	const badgeEl = createEl(doc, 'span', 'zbf-wc-badge is-warn');
	const titleEl = createEl(doc, 'span', 'zbf-wc-acc-title');
	const arrowEl = createEl(doc, 'span', 'zbf-wc-acc-arrow');
	arrowEl.appendChild(createWordCiteSvgIcon(doc, 'chevron'));
	accHeadBtn.append(badgeEl, titleEl, arrowEl);

	const bodyEl = createEl(doc, 'div', 'zbf-wc-acc-body');
	const chipsRow = createEl(doc, 'div', 'zbf-wc-orphan-top');
	const chipsEl = createEl(doc, 'div', 'zbf-wc-orphan-chips');
	const toggleBtn = createEl(doc, 'button', 'zbf-wc-orphan-toggle');
	toggleBtn.type = 'button';
	chipsRow.append(chipsEl, toggleBtn);

	const listEl = createEl(doc, 'div', 'zbf-wc-orphan-list');
	const footEl = createEl(doc, 'div', 'zbf-wc-orphan-foot');
	const footHintEl = createEl(doc, 'span', 'zbf-wc-orphan-hint');
	const actionBtn = createEl(doc, 'button', 'zbf-wc-sec-btn zbf-wc-orphan-btn');
	actionBtn.type = 'button';
	footEl.append(footHintEl, actionBtn);

	bodyEl.append(chipsRow, listEl, footEl);
	box.append(accHeadBtn, bodyEl);
	return {
		box, accHeadBtn, badgeEl, titleEl, arrowEl, bodyEl,
		chipsRow, chipsEl, toggleBtn, listEl, footEl, footHintEl, actionBtn,
	};
}

export function renderOrphanCardDom(
	doc: Document,
	refs: OrphanAccordionDomRefs,
	model: OrphanCardViewModel,
	disabled: boolean,
	cb: Pick<OrphanDomCallbacks, 'onToggleItem'>,
): void {
	refs.box.hidden = !model.visible;
	if (!model.visible) return;

	refs.box.classList.toggle('is-closed', !model.accordionOpen);
	refs.accHeadBtn.setAttribute('aria-expanded', String(model.accordionOpen));
	refs.accHeadBtn.title = model.listText;
	refs.badgeEl.textContent = model.countBadge;
	refs.titleEl.textContent = model.shortTitle;
	refs.bodyEl.hidden = !model.accordionOpen;
	if (!model.accordionOpen) return;

	clearChildren(refs.chipsEl);
	for (const chip of model.summaryChips) {
		const pill = createEl(doc, 'span', `zbf-wc-orphan-chip is-${chip.variant}`);
		pill.textContent = chip.text;
		refs.chipsEl.appendChild(pill);
	}
	refs.toggleBtn.hidden = !model.showToggle;
	refs.toggleBtn.textContent = model.toggleLabel;
	refs.chipsRow.hidden = model.summaryChips.length === 0 && !model.showToggle;

	clearChildren(refs.listEl);
	for (const rowVm of model.rows) {
		const row = createEl(doc, 'div', `zbf-wc-orphan-row${rowVm.recoverable ? '' : ' is-disabled'}`);
		row.title = rowVm.tooltip;

		const chk = createEl(doc, 'input', 'zbf-wc-orphan-chk');
		chk.type = 'checkbox';
		chk.checked = rowVm.checked;
		chk.disabled = disabled || !rowVm.recoverable;

		const ord = createEl(doc, 'span', 'zbf-wc-orphan-ord');
		ord.textContent = `[${rowVm.ordinal}]`;

		const main = createEl(doc, 'div', 'zbf-wc-orphan-main');
		const t = createEl(doc, 'div', 'zbf-wc-orphan-item-title');
		t.textContent = rowVm.title;
		const meta = createEl(doc, 'div', 'zbf-wc-orphan-item-meta');
		if (rowVm.authorYear) {
			const ay = createEl(doc, 'span', 'zbf-wc-orphan-author');
			ay.textContent = rowVm.authorYear;
			meta.appendChild(ay);
		}
		const tag = createEl(doc, 'span', `zbf-wc-orphan-tag is-${rowVm.tagVariant}`);
		tag.textContent = rowVm.tagText;
		meta.appendChild(tag);
		main.append(t, meta);

		row.append(chk, ord, main);
		if (rowVm.recoverable && !disabled) {
			row.addEventListener('click', (ev: Event) => {
				if (ev.target !== chk) ev.preventDefault?.();
				cb.onToggleItem(rowVm.key);
			});
		}
		refs.listEl.appendChild(row);
	}

	refs.footHintEl.textContent = model.footHint;
	refs.actionBtn.textContent = model.buttonLabel;
	refs.actionBtn.title = model.buttonTooltip;
	refs.actionBtn.disabled = disabled || model.buttonDisabled;
}

export function renderReceiptDom(
	doc: Document,
	receiptEl: HTMLElement,
	receipt: ReceiptState,
	cb: Pick<OrphanDomCallbacks, 'onReceiptAction' | 'onDismissReceipt'>,
): void {
	const visible = receipt.tone !== 'none' && Boolean(receipt.text);
	receiptEl.hidden = !visible;
	receiptEl.classList.remove('is-ok', 'is-warn', 'is-err');
	clearChildren(receiptEl);
	if (!visible) return;
	receiptEl.classList.add(`is-${receipt.tone}`);

	const isStructured = Boolean(receipt.headline || receipt.chips?.length || receipt.actions?.length);
	if (!isStructured) {
		receiptEl.textContent = receipt.text;
		return;
	}

	const head = createEl(doc, 'div', 'zbf-wc-rcp-head');
	const title = createEl(doc, 'span', 'zbf-wc-rcp-title');
	title.textContent = receipt.headline || receipt.text;
	title.title = receipt.text;
	const closeBtn = createEl(doc, 'button', 'zbf-wc-rcp-close');
	closeBtn.type = 'button';
	closeBtn.textContent = '×';
	closeBtn.title = '关闭提示 / Dismiss';
	closeBtn.addEventListener('click', () => cb.onDismissReceipt());
	head.append(title, closeBtn);
	receiptEl.appendChild(head);

	if (receipt.chips?.length) {
		const chipsWrap = createEl(doc, 'div', 'zbf-wc-rcp-chips');
		for (const c of receipt.chips) {
			const chipEl = createEl(doc, 'span', `zbf-wc-rcp-chip is-${c.variant}`);
			chipEl.textContent = c.text;
			chipsWrap.appendChild(chipEl);
		}
		receiptEl.appendChild(chipsWrap);
	}

	if (receipt.subnote || receipt.actions?.length) {
		const foot = createEl(doc, 'div', 'zbf-wc-rcp-foot');
		if (receipt.subnote) {
			const note = createEl(doc, 'span', 'zbf-wc-rcp-note');
			note.textContent = receipt.subnote;
			note.title = receipt.subnote;
			foot.appendChild(note);
		}
		if (receipt.actions?.length) {
			const acts = createEl(doc, 'div', 'zbf-wc-rcp-actions');
			for (const act of receipt.actions) {
				const btn = createEl(doc, 'button', 'zbf-wc-rcp-btn');
				btn.type = 'button';
				btn.textContent = act.label;
				btn.title = act.title;
				btn.addEventListener('click', () => cb.onReceiptAction(act));
				acts.appendChild(btn);
			}
			foot.appendChild(acts);
		}
		receiptEl.appendChild(foot);
	}
}
