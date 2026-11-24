import type { OrphanCardViewModel, ReceiptAction, ReceiptState } from './word-cite-orphan-model.ts';

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

export interface OrphanDomCallbacks {
	onToggleItem(key: string): void;
	onToggleExpand(): void;
	onReceiptAction(action: ReceiptAction): void;
	onDismissReceipt(): void;
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
.zbf-wc-orphan-box { order: 1; display: grid; gap: 6px; padding: 8px 9px; border-radius: 8px; border: 1px solid rgba(217,119,6,0.36); background: linear-gradient(180deg, rgba(245,158,11,0.11), rgba(245,158,11,0.05)); font-size: 11.5px; }
.zbf-wc-orphan-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-width: 0; }
.zbf-wc-orphan-title { font-weight: 600; color: #b45309; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-orphan-toggle { flex: none; background: none; border: none; padding: 1px 4px; border-radius: 4px; font-size: 11px; color: #b45309; cursor: pointer; opacity: 0.88; }
.zbf-wc-orphan-toggle:hover { background: rgba(217,119,6,0.14); opacity: 1; }
.zbf-wc-orphan-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.zbf-wc-orphan-chip, .zbf-wc-orphan-tag, .zbf-wc-rcp-chip { display: inline-flex; align-items: center; padding: 1px 6px; border-radius: 999px; font-size: 10.5px; line-height: 1.45; white-space: nowrap; font-weight: 500; }
.zbf-wc-orphan-chip.is-trash, .zbf-wc-orphan-tag.is-trash { background: rgba(13,148,136,0.14); color: #0f766e; }
.zbf-wc-orphan-chip.is-rebuild, .zbf-wc-orphan-tag.is-rebuild { background: rgba(37,99,235,0.12); color: #1d4ed8; }
.zbf-wc-orphan-chip.is-unrec, .zbf-wc-orphan-tag.is-unrec { background: rgba(128,128,128,0.15); color: inherit; opacity: 0.75; }
.zbf-wc-orphan-list { display: grid; gap: 4px; max-height: 184px; overflow-y: auto; padding-right: 1px; }
.zbf-wc-orphan-row { display: flex; align-items: flex-start; gap: 6px; padding: 4px 6px; border-radius: 6px; background: var(--fill-primary, rgba(255,255,255,0.58)); border: 1px solid rgba(128,128,128,0.15); cursor: pointer; min-width: 0; }
.zbf-wc-orphan-row:hover { border-color: rgba(217,119,6,0.4); }
.zbf-wc-orphan-row.is-disabled { opacity: 0.62; cursor: default; }
.zbf-wc-orphan-chk { margin: 2px 0 0; flex: none; cursor: inherit; }
.zbf-wc-orphan-ord { flex: none; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; font-weight: 700; color: #b45309; font-variant-numeric: tabular-nums; line-height: 1.45; }
.zbf-wc-orphan-main { flex: 1 1 0; min-width: 0; display: grid; gap: 2px; }
.zbf-wc-orphan-item-title { font-size: 11.5px; font-weight: 500; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-orphan-item-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; font-size: 10.5px; opacity: 0.86; min-width: 0; }
.zbf-wc-orphan-author { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px; }
.zbf-wc-orphan-btn { box-sizing: border-box; width: 100%; padding: 5px 10px; border-radius: 6px; border: 1px solid rgba(217,119,6,0.5); background: rgba(217,119,6,0.17); color: #92400e; font-size: 11.5px; font-weight: 600; cursor: pointer; text-align: center; transition: background 120ms ease; }
.zbf-wc-orphan-btn:hover:not(:disabled) { background: rgba(217,119,6,0.26); }
.zbf-wc-orphan-btn:disabled { opacity: 0.48; cursor: default; }
.zbf-wc-receipt { order: 2; display: grid; gap: 5px; font-size: 11.5px; padding: 6px 8px; border-radius: 7px; line-height: 1.4; border: 1px solid transparent; }
.zbf-wc-receipt.is-ok { background: rgba(22,163,74,0.1); border-color: rgba(22,163,74,0.28); color: #15803d; }
.zbf-wc-receipt.is-warn { background: rgba(217,119,6,0.1); border-color: rgba(217,119,6,0.28); color: #b45309; }
.zbf-wc-receipt.is-err { background: rgba(220,38,38,0.1); border-color: rgba(220,38,38,0.28); color: #b91c1c; }
.zbf-wc-rcp-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-width: 0; font-weight: 600; }
.zbf-wc-rcp-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-rcp-close { flex: none; background: none; border: none; padding: 0 3px; font-size: 13px; line-height: 1; color: inherit; opacity: 0.65; cursor: pointer; border-radius: 4px; }
.zbf-wc-rcp-close:hover { opacity: 1; background: rgba(128,128,128,0.15); }
.zbf-wc-rcp-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.zbf-wc-rcp-chip.is-ok { background: rgba(22,163,74,0.15); color: #15803d; }
.zbf-wc-rcp-chip.is-info { background: rgba(37,99,235,0.12); color: #1d4ed8; }
.zbf-wc-rcp-chip.is-warn { background: rgba(217,119,6,0.15); color: #b45309; }
.zbf-wc-rcp-foot { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; min-width: 0; padding-top: 3px; border-top: 1px dashed rgba(128,128,128,0.2); }
.zbf-wc-rcp-note { font-size: 10.5px; opacity: 0.85; min-width: 0; flex: 1 1 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-rcp-actions { display: inline-flex; align-items: center; gap: 5px; margin-inline-start: auto; }
.zbf-wc-rcp-btn { background: rgba(255,255,255,0.65); border: 1px solid currentColor; border-radius: 5px; padding: 2px 7px; font-size: 11px; font-weight: 600; color: inherit; cursor: pointer; white-space: nowrap; }
.zbf-wc-rcp-btn:hover { background: rgba(255,255,255,0.9); }
@media (prefers-color-scheme: dark) {
	.zbf-wc-orphan-title, .zbf-wc-orphan-toggle, .zbf-wc-orphan-ord, .zbf-wc-orphan-btn, .zbf-wc-rcp-chip.is-warn, .zbf-wc-receipt.is-warn { color: #fbbf24; }
	.zbf-wc-receipt.is-ok { color: #4ade80; }
	.zbf-wc-receipt.is-err { color: #f87171; }
	.zbf-wc-orphan-row { background: rgba(24,24,27,0.45); }
	.zbf-wc-orphan-chip.is-trash, .zbf-wc-orphan-tag.is-trash { color: #5eead4; background: rgba(20,184,166,0.18); }
	.zbf-wc-orphan-chip.is-rebuild, .zbf-wc-orphan-tag.is-rebuild, .zbf-wc-rcp-chip.is-info { color: #93c5fd; background: rgba(59,130,246,0.2); }
	.zbf-wc-rcp-chip.is-ok { color: #4ade80; background: rgba(34,197,94,0.18); }
	.zbf-wc-rcp-btn { background: rgba(255,255,255,0.08); }
	.zbf-wc-rcp-btn:hover { background: rgba(255,255,255,0.16); }
}`;

export function renderOrphanCardDom(
	doc: Document,
	box: HTMLElement,
	headEl: HTMLElement,
	titleEl: HTMLElement,
	toggleBtn: HTMLButtonElement,
	chipsEl: HTMLElement,
	listEl: HTMLElement,
	actionBtn: HTMLButtonElement,
	model: OrphanCardViewModel,
	disabled: boolean,
	cb: Pick<OrphanDomCallbacks, 'onToggleItem'>,
): void {
	box.hidden = !model.visible;
	if (!model.visible) return;

	titleEl.textContent = model.title;
	titleEl.title = model.listText;
	toggleBtn.hidden = !model.showToggle;
	toggleBtn.textContent = model.toggleLabel;
	headEl.hidden = false;

	clearChildren(chipsEl);
	chipsEl.hidden = model.summaryChips.length === 0;
	for (const chip of model.summaryChips) {
		const pill = createEl(doc, 'span', `zbf-wc-orphan-chip is-${chip.variant}`);
		pill.textContent = chip.text;
		chipsEl.appendChild(pill);
	}

	clearChildren(listEl);
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
		listEl.appendChild(row);
	}

	actionBtn.textContent = model.buttonLabel;
	actionBtn.title = model.buttonTooltip;
	actionBtn.disabled = disabled || model.buttonDisabled;
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
