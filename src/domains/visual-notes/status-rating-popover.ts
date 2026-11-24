import {
	captureBatchTargets,
	listAvailableStatuses,
	parseCustomStatusInput,
	setItemStatus,
	type StatusOption,
} from '../../services/item-status-rating.ts';
import { closeVisualColumnPopover } from './column-popovers.ts';

export const STATUS_RATING_STYLE_ID = 'zbf-status-rating-style';
export const STATUS_POPOVER_ID = 'zbf-status-popover';

const QUICK_STATUS_COLORS = ['#2563eb', '#0d9488', '#e11d48', '#d97706', '#7c3aed', '#16a34a'] as const;

const activePopoverClosers = new WeakMap<Document, { itemID: number; close: () => void }>();

export function closeStatusPickerPopover(doc: Document | null | undefined): void {
	if (!doc) return;
	const entry = activePopoverClosers.get(doc);
	if (entry) {
		activePopoverClosers.delete(doc);
		entry.close();
	} else {
		doc.getElementById(STATUS_POPOVER_ID)?.remove();
	}
}

export function isStatusPickerOpenFor(doc: Document | null | undefined, itemID: number): boolean {
	if (!doc) return false;
	return activePopoverClosers.get(doc)?.itemID === itemID && Boolean(doc.getElementById(STATUS_POPOVER_ID));
}

export const STATUS_RATING_CSS = `
@keyframes zbfPopIn { from { opacity: 0; transform: translateY(-4px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
.zbf-status-cell, .zbf-rating-cell { display: inline-flex; align-items: center; width: 100%; height: 100%; pointer-events: auto; user-select: none; overflow: hidden; }
.zbf-status-pill { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; padding: 1.5px 8px; border-radius: 6px; border: 1px solid transparent; font-size: 11px; font-weight: 600; line-height: 1.4; cursor: pointer; background: rgba(100,116,139,0.12); color: inherit; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: filter 0.14s ease, transform 0.12s ease, box-shadow 0.14s ease; }
.zbf-status-pill:hover { filter: brightness(0.95); box-shadow: 0 1px 4px rgba(15,23,42,0.10); }
.zbf-status-pill:active { transform: scale(0.96); }
.virtualized-table:focus-within .row.selected .zbf-status-pill { background: rgba(255,255,255,0.20) !important; border-color: rgba(255,255,255,0.42) !important; color: #ffffff !important; }
.zbf-status-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
.zbf-status-empty { display: inline-flex; align-items: center; padding: 1px 7px; border-radius: 6px; font-size: 11px; opacity: 0.78; color: light-dark(#475569,#cbd5e1); border: 1px dashed rgba(100,116,139,0.50); cursor: pointer; transition: opacity 0.14s ease, border-color 0.14s ease, background-color 0.14s ease; }
.row:hover .zbf-status-empty, .zbf-status-cell:hover .zbf-status-empty { opacity: 0.96; }
.zbf-status-empty:hover { opacity: 1 !important; border-style: solid; border-color: light-dark(rgba(79,70,229,0.45), rgba(129,140,248,0.55)); background: light-dark(rgba(79,70,229,0.07), rgba(129,140,248,0.14)); color: inherit; }
.virtualized-table:focus-within .row.selected .zbf-status-empty { color: rgba(255,255,255,0.90); border-color: rgba(255,255,255,0.48); }
.zbf-rating-stars { display: inline-flex; align-items: center; gap: 0.5px; cursor: pointer; font-size: 12px; line-height: 1; padding: 1.5px 2px; border-radius: 6px; transition: opacity 0.14s ease, background-color 0.14s ease; }
.zbf-rating-stars:hover { background: light-dark(rgba(245,158,11,0.08), rgba(251,191,36,0.12)); }
.zbf-rating-stars[data-unrated="true"] { opacity: 0.76; }
.row:hover .zbf-rating-stars[data-unrated="true"], .zbf-rating-cell:hover .zbf-rating-stars[data-unrated="true"] { opacity: 0.98; }
.zbf-rating-star { padding: 0 0.5px; color: light-dark(rgba(100,116,139,0.42), rgba(148,163,184,0.38)); transition: transform 0.14s cubic-bezier(0.34,1.56,0.64,1), color 0.12s ease, opacity 0.12s ease; }
.zbf-rating-star[data-lit="true"] { color: #f59e0b; }
.zbf-rating-stars[data-hover] .zbf-rating-star { color: light-dark(rgba(148,163,184,0.34), rgba(148,163,184,0.30)); }
.zbf-rating-stars[data-hover="1"] .zbf-rating-star:nth-child(-n+1),
.zbf-rating-stars[data-hover="2"] .zbf-rating-star:nth-child(-n+2),
.zbf-rating-stars[data-hover="3"] .zbf-rating-star:nth-child(-n+3),
.zbf-rating-stars[data-hover="4"] .zbf-rating-star:nth-child(-n+4),
.zbf-rating-stars[data-hover="5"] .zbf-rating-star:nth-child(-n+5) { color: #fbbf24; }
.zbf-rating-stars[data-clear-hint="true"] .zbf-rating-star[data-lit="true"] { opacity: 0.55; }
.zbf-rating-star:hover { transform: scale(1.24); }
.virtualized-table:focus-within .row.selected .zbf-rating-stars:hover { background: rgba(255,255,255,0.16); }
.virtualized-table:focus-within .row.selected .zbf-rating-star { color: rgba(255,255,255,0.40); }
.virtualized-table:focus-within .row.selected .zbf-rating-star[data-lit="true"] { color: #fde047; }
.virtualized-table:focus-within .row.selected .zbf-rating-stars[data-hover="1"] .zbf-rating-star:nth-child(-n+1),
.virtualized-table:focus-within .row.selected .zbf-rating-stars[data-hover="2"] .zbf-rating-star:nth-child(-n+2),
.virtualized-table:focus-within .row.selected .zbf-rating-stars[data-hover="3"] .zbf-rating-star:nth-child(-n+3),
.virtualized-table:focus-within .row.selected .zbf-rating-stars[data-hover="4"] .zbf-rating-star:nth-child(-n+4),
.virtualized-table:focus-within .row.selected .zbf-rating-stars[data-hover="5"] .zbf-rating-star:nth-child(-n+5) { color: #fef08a; }
.zbf-status-pop { position: fixed; z-index: 2147483645; width: 248px; padding: 8px; border-radius: 12px; background: light-dark(rgba(255,255,255,0.97), rgba(22,32,50,0.97)); backdrop-filter: blur(14px); color: light-dark(#0f172a, #e2e8f0); border: 1px solid light-dark(rgba(15,23,42,0.11), rgba(148,163,184,0.24)); box-shadow: 0 16px 40px rgba(15,23,42,0.19), 0 4px 12px rgba(15,23,42,0.08), inset 0 1px 0 light-dark(rgba(255,255,255,0.85), rgba(255,255,255,0.07)); font: 12px/1.4 system-ui, "Microsoft YaHei UI", sans-serif; display: flex; flex-direction: column; gap: 5px; transform-origin: top left; animation: zbfPopIn 0.15s cubic-bezier(0.22,1,0.36,1); }
.zbf-status-pop-batch { padding: 4px 8px; border-radius: 7px; font-size: 11px; font-weight: 600; background: light-dark(rgba(79,70,229,0.09), rgba(129,140,248,0.18)); color: light-dark(#4338ca, #c7d2fe); }
.zbf-status-pop-list { display: flex; flex-direction: column; gap: 2px; max-height: 224px; overflow-y: auto; }
.zbf-status-pop-item { display: flex; align-items: center; gap: 7px; width: 100%; padding: 5px 8px; border: 0; border-radius: 7px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; transition: background-color 0.14s ease, transform 0.14s cubic-bezier(0.22,1,0.36,1); }
.zbf-status-pop-item:hover, .zbf-status-pop-item[data-active="true"] { background: light-dark(rgba(79,70,229,0.09), rgba(129,140,248,0.18)); transform: translateX(2px); }
.zbf-status-pop-item[data-current="true"] { font-weight: 600; background: light-dark(rgba(79,70,229,0.12), rgba(129,140,248,0.22)); }
.zbf-status-pop-lbl { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-status-pop-meta { display: inline-flex; align-items: center; gap: 5px; flex: none; }
.zbf-status-pop-check { font-size: 11px; font-weight: 700; color: light-dark(#4f46e5, #818cf8); }
.zbf-status-pop-kbd { font-size: 10px; line-height: 1; padding: 2px 4.5px; border-radius: 4px; opacity: 0.55; border: 1px solid light-dark(rgba(15,23,42,0.16), rgba(148,163,184,0.28)); font-variant-numeric: tabular-nums; }
.zbf-status-pop-sep { height: 1px; margin: 2px 0; background: light-dark(rgba(15,23,42,0.08), rgba(148,163,184,0.18)); }
.zbf-status-pop-swatches { display: flex; align-items: center; gap: 5px; padding: 1px 2px; }
.zbf-status-pop-swatch { width: 15px; height: 15px; border-radius: 50%; border: 2px solid transparent; padding: 0; cursor: pointer; transition: transform 0.12s ease, border-color 0.12s ease; }
.zbf-status-pop-swatch:hover { transform: scale(1.18); }
.zbf-status-pop-swatch[data-picked="true"] { border-color: light-dark(#0f172a, #f8fafc); transform: scale(1.12); }
.zbf-status-pop-create { display: flex; align-items: center; gap: 5px; }
.zbf-status-pop-input { flex: 1 1 auto; min-width: 0; height: 27px; padding: 0 8px; border-radius: 6px; border: 1px solid light-dark(rgba(15,23,42,0.18), rgba(148,163,184,0.3)); background: light-dark(#f8fafc, #0f172a); color: inherit; font: inherit; transition: border-color 0.14s, box-shadow 0.14s; }
.zbf-status-pop-input:focus { outline: none; border-color: #4f46e5; box-shadow: 0 0 0 2px rgba(79,70,229,0.16); }
.zbf-status-pop-color { width: 22px; height: 22px; padding: 0; border: 0; border-radius: 5px; background: transparent; cursor: pointer; flex: none; }
.zbf-status-pop-add { height: 27px; padding: 0 9px; border-radius: 6px; border: 0; background: linear-gradient(135deg, #4f46e5, #2563eb); color: #fff; font: 600 12px/1 inherit; cursor: pointer; flex: none; transition: filter 0.14s, transform 0.12s; }
.zbf-status-pop-add:hover { filter: brightness(1.08); }
.zbf-status-pop-add:active { transform: scale(0.94); }
@media (prefers-reduced-motion: reduce) { .zbf-status-pop { animation: none !important; } .zbf-status-pop-item, .zbf-rating-star, .zbf-status-pill { transition: none !important; } }
`;

export function srHtmlEl<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K): HTMLElementTagNameMap[K] {
	return doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K];
}

export function ensureStatusRatingStyle(doc: Document): void {
	if (!doc) return;
	const existing = doc.getElementById(STATUS_RATING_STYLE_ID);
	if (existing) {
		if (existing.textContent !== STATUS_RATING_CSS) existing.textContent = STATUS_RATING_CSS;
		return;
	}
	const style = srHtmlEl(doc, 'style');
	style.id = STATUS_RATING_STYLE_ID;
	style.textContent = STATUS_RATING_CSS;
	(doc.head || doc.documentElement)?.appendChild(style);
}

export function openStatusPickerPopover(options: {
	win: Window;
	anchor: HTMLElement;
	clickedItem: any;
	current: StatusOption | null;
	zh: boolean;
	excludedTag: string;
	onApplied: () => void;
}): void {
	const { win, anchor, clickedItem, current, zh, excludedTag, onApplied } = options;
	const doc = win.document;
	if (!doc) return;
	const clickedID = Number(clickedItem?.id || 0);
	closeVisualColumnPopover(doc);
	if (clickedID > 0 && isStatusPickerOpenFor(doc, clickedID)) {
		closeStatusPickerPopover(doc);
		return;
	}
	closeStatusPickerPopover(doc);

	const viewRows = (win as any).ZoteroPane?.itemsView;
	const sampleItems: any[] = [];
	const rowCount = Math.min(Number(viewRows?.rowCount || 0), 300);
	for (let i = 0; i < rowCount; i++) {
		const ref = viewRows?.getRow?.(i)?.ref;
		if (ref) sampleItems.push(ref);
	}
	sampleItems.push(clickedItem);
	const statuses = listAvailableStatuses(sampleItems, zh, excludedTag);
	const selected = (win as any).ZoteroPane?.getSelectedItems?.() || [];
	const targets = captureBatchTargets(selected, clickedItem);

	const pop = srHtmlEl(doc, 'div');
	pop.id = STATUS_POPOVER_ID;
	pop.className = 'zbf-status-pop';
	if (targets.length > 1) {
		const banner = srHtmlEl(doc, 'div');
		banner.className = 'zbf-status-pop-batch';
		banner.textContent = zh
			? `批量应用至已选 ${targets.length} 篇文献`
			: `Applying to ${targets.length} selected items`;
		pop.appendChild(banner);
	}

	const list = srHtmlEl(doc, 'div');
	list.className = 'zbf-status-pop-list';

	let closed = false;
	const close = () => {
		if (closed) return;
		closed = true;
		if (activePopoverClosers.get(doc)?.close === close) activePopoverClosers.delete(doc);
		doc.removeEventListener('mousedown', onOutside, true);
		doc.removeEventListener('keydown', onKey, true);
		win.removeEventListener('resize', close);
		pop.remove();
	};
	activePopoverClosers.set(doc, { itemID: clickedID, close });

	const applyStatus = (tag: string | null, color?: string) => {
		close();
		void (async () => {
			try {
				for (const t of targets) {
					try { await setItemStatus(t, tag, { color, excludedTag }); } catch { /* isolate per-item failure */ }
				}
			} finally {
				onApplied();
			}
		})();
	};

	const optionButtons: { btn: HTMLButtonElement; run: () => void }[] = [];
	let activeIdx = -1;
	const setActiveIndex = (idx: number) => {
		if (!optionButtons.length) return;
		activeIdx = (idx + optionButtons.length) % optionButtons.length;
		optionButtons.forEach((entry, i) => {
			if (i === activeIdx) entry.btn.setAttribute('data-active', 'true');
			else entry.btn.removeAttribute('data-active');
		});
		optionButtons[activeIdx].btn.scrollIntoView?.({ block: 'nearest' });
	};

	statuses.forEach((opt, idx) => {
		const btn = srHtmlEl(doc, 'button');
		btn.type = 'button';
		btn.className = 'zbf-status-pop-item';
		const isCurrent = current?.tag.toLowerCase() === opt.tag.toLowerCase();
		if (isCurrent) btn.setAttribute('data-current', 'true');
		const dot = srHtmlEl(doc, 'span');
		dot.className = 'zbf-status-dot';
		dot.style.background = opt.color;
		const lbl = srHtmlEl(doc, 'span');
		lbl.className = 'zbf-status-pop-lbl';
		lbl.textContent = opt.label;
		const meta = srHtmlEl(doc, 'span');
		meta.className = 'zbf-status-pop-meta';
		if (isCurrent) {
			const chk = srHtmlEl(doc, 'span');
			chk.className = 'zbf-status-pop-check';
			chk.textContent = '✓';
			meta.appendChild(chk);
		}
		if (idx < 9) {
			const kbd = srHtmlEl(doc, 'span');
			kbd.className = 'zbf-status-pop-kbd';
			kbd.textContent = String(idx + 1);
			meta.appendChild(kbd);
		}
		btn.append(dot, lbl, meta);
		const run = () => applyStatus(opt.tag, opt.color);
		btn.addEventListener('click', run);
		optionButtons.push({ btn, run });
		list.appendChild(btn);
	});

	if (current || targets.length > 1) {
		const clearBtn = srHtmlEl(doc, 'button');
		clearBtn.type = 'button';
		clearBtn.className = 'zbf-status-pop-item';
		clearBtn.textContent = zh ? '✕ 清除状态' : '✕ Clear status';
		const run = () => applyStatus(null);
		clearBtn.addEventListener('click', run);
		optionButtons.push({ btn: clearBtn, run });
		list.appendChild(clearBtn);
	}

	const sep = srHtmlEl(doc, 'div');
	sep.className = 'zbf-status-pop-sep';
	const createRow = srHtmlEl(doc, 'div');
	createRow.className = 'zbf-status-pop-create';
	const nameInput = srHtmlEl(doc, 'input');
	nameInput.type = 'text';
	nameInput.className = 'zbf-status-pop-input';
	nameInput.placeholder = zh ? '新状态名（如 待复现）' : 'New status...';
	const colorInput = srHtmlEl(doc, 'input');
	colorInput.type = 'color';
	colorInput.className = 'zbf-status-pop-color';
	colorInput.value = '#0d9488';

	const swatchRow = srHtmlEl(doc, 'div');
	swatchRow.className = 'zbf-status-pop-swatches';
	const swatchBtns: HTMLButtonElement[] = [];
	const syncSwatches = (hex: string) => {
		swatchBtns.forEach((b) => {
			if (b.dataset.color === hex.toLowerCase()) b.setAttribute('data-picked', 'true');
			else b.removeAttribute('data-picked');
		});
	};
	for (const hex of QUICK_STATUS_COLORS) {
		const sw = srHtmlEl(doc, 'button');
		sw.type = 'button';
		sw.className = 'zbf-status-pop-swatch';
		sw.dataset.color = hex;
		sw.style.background = hex;
		sw.title = hex;
		sw.addEventListener('click', () => {
			colorInput.value = hex;
			syncSwatches(hex);
		});
		swatchBtns.push(sw);
		swatchRow.appendChild(sw);
	}
	syncSwatches(colorInput.value);
	colorInput.addEventListener('input', () => syncSwatches(colorInput.value));

	const addBtn = srHtmlEl(doc, 'button');
	addBtn.type = 'button';
	addBtn.className = 'zbf-status-pop-add';
	addBtn.textContent = '+';
	const submitCustom = () => {
		const parsed = parseCustomStatusInput(nameInput.value, colorInput.value, excludedTag);
		if (parsed) applyStatus(parsed.tag, parsed.color);
	};
	addBtn.addEventListener('click', submitCustom);
	nameInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submitCustom(); }
	});
	createRow.append(nameInput, colorInput, addBtn);
	pop.append(list, sep, swatchRow, createRow);
	(doc.body || doc.documentElement)?.appendChild(pop);

	const onOutside = (e: MouseEvent) => {
		const target = e.target as Node;
		if (!pop.contains(target) && !anchor.contains(target)) close();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === 'Escape') { e.preventDefault(); close(); return; }
		if (doc.activeElement === nameInput) return;
		if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(activeIdx + 1); return; }
		if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(activeIdx <= 0 ? optionButtons.length - 1 : activeIdx - 1); return; }
		if (e.key === 'Enter' && activeIdx >= 0 && optionButtons[activeIdx]) {
			e.preventDefault();
			optionButtons[activeIdx].run();
			return;
		}
		if ((e.key === 'Backspace' || e.key === 'Delete') && current) {
			e.preventDefault();
			applyStatus(null);
			return;
		}
		if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
			const idx = Number(e.key) - 1;
			if (idx < statuses.length) {
				e.preventDefault();
				applyStatus(statuses[idx].tag, statuses[idx].color);
			}
		}
	};

	const rect = anchor.getBoundingClientRect?.() || { left: 100, bottom: 100, top: 80 };
	const vw = win.innerWidth || 1200;
	const vh = win.innerHeight || 800;
	const pw = pop.offsetWidth || 248;
	const ph = pop.offsetHeight || 260;
	const left = Math.max(8, Math.min(rect.left, vw - pw - 8));
	const top = rect.bottom + ph + 8 > vh ? Math.max(8, rect.top - ph - 6) : rect.bottom + 4;
	pop.style.left = `${Math.round(left)}px`;
	pop.style.top = `${Math.round(top)}px`;

	doc.addEventListener('mousedown', onOutside, true);
	doc.addEventListener('keydown', onKey, true);
	win.addEventListener('resize', close);
}
