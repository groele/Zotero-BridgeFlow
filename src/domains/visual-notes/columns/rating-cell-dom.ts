import {
	captureBatchTargets,
	getItemRating,
	getItemStatus,
	setItemRating,
	type RatingStorageLocation,
} from '../../../services/item-status-rating.ts';
import { openStatusPickerPopover, srHtmlEl } from './status-rating-popover.ts';

function guardPrimaryTreePointer(el: HTMLElement): void {
	el.addEventListener('mousedown', (ev) => { if (ev.button === 0) ev.stopPropagation(); });
	el.addEventListener('mouseup', (ev) => { if (ev.button === 0) ev.stopPropagation(); });
	el.addEventListener('dblclick', (ev) => { ev.stopPropagation(); ev.preventDefault(); });
}

function bindInstantCellPress(el: HTMLElement, handler: (ev: MouseEvent) => void): void {
	let lastPointerDownAt = 0;
	el.addEventListener('mousedown', (ev) => {
		if (ev.button !== 0) return;
		ev.stopPropagation();
		lastPointerDownAt = Date.now();
		handler(ev);
	});
	el.addEventListener('click', (ev) => {
		ev.stopPropagation();
		if (Date.now() - lastPointerDownAt < 450) return;
		handler(ev);
	});
}

export function buildStatusColumnCell(opts: {
	win: Window | null;
	doc: Document;
	item: any;
	className?: string;
	zh: boolean;
	excludedTag: string;
	syncZoteroTagColor: boolean;
	onApplied: (targetIDs?: readonly number[]) => void;
}): HTMLElement {
	const { win, doc, item, className, zh, excludedTag, syncZoteroTagColor, onApplied } = opts;
	const span = srHtmlEl(doc, 'span');
	span.className = `cell ${className || ''} clickable zbf-status-cell`.trim();
	if (!item || (typeof item.isRegularItem === 'function' && !item.isRegularItem())) return span;

	const current = getItemStatus(item, excludedTag);
	const trigger = srHtmlEl(doc, 'span');
	if (current) {
		trigger.className = 'zbf-status-pill';
		trigger.style.borderColor = `${current.color}66`;
		trigger.style.background = `${current.color}22`;
		const dot = srHtmlEl(doc, 'span');
		dot.className = 'zbf-status-dot';
		dot.style.background = current.color;
		const txt = srHtmlEl(doc, 'span');
		txt.textContent = current.label;
		trigger.append(dot, txt);
		trigger.title = zh
			? `点击切换状态（当前：${current.tag} · 支持多选批量与数字键 1–9 快选）`
			: `Switch status (${current.tag} · supports multi-select & keys 1–9)`;
	} else {
		trigger.className = 'zbf-status-empty';
		trigger.textContent = zh ? '+ 状态' : '+ Status';
		trigger.title = zh
			? '点击设置阅读状态（支持多选批量与数字键 1–9 快选）'
			: 'Set reading status (supports multi-select & keys 1–9)';
	}
	guardPrimaryTreePointer(trigger);
	bindInstantCellPress(trigger, () => {
		if (!win) return;
		openStatusPickerPopover({
			win, anchor: trigger, clickedItem: item, current, zh,
			excludedTag, syncZoteroTagColor, onApplied,
		});
	});
	span.appendChild(trigger);
	return span;
}

export function buildRatingColumnCell(opts: {
	win: Window | null;
	doc: Document;
	item: any;
	className?: string;
	zh: boolean;
	storage: RatingStorageLocation;
	onApplied: (targetIDs?: readonly number[]) => void;
}): HTMLElement {
	const { win, doc, item, className, zh, storage, onApplied } = opts;
	const span = srHtmlEl(doc, 'span');
	span.className = `cell ${className || ''} clickable zbf-rating-cell`.trim();
	if (!item || (typeof item.isRegularItem === 'function' && !item.isRegularItem())) return span;

	let current = getItemRating(item, storage);
	const buildStrip = () => {
		const f = srHtmlEl(doc, 'span');
		f.className = 'zbf-sr-fit';
		const w = srHtmlEl(doc, 'span');
		w.className = 'zbf-rating-stars';
		w.setAttribute('role', 'radiogroup');
		for (let k = 1; k <= 5; k++) {
			const s = srHtmlEl(doc, 'span');
			s.className = 'zbf-rating-star';
			s.dataset.star = String(k);
			s.textContent = '⭐';
			w.appendChild(s);
		}
		f.appendChild(w);
		return f;
	};
	const proto = ((doc as any).__zbfRatingProto ??= buildStrip()) as HTMLSpanElement;
	const fit = typeof proto.cloneNode === 'function' ? (proto.cloneNode(true) as HTMLSpanElement) : buildStrip();
	const wrap = fit.firstElementChild as HTMLSpanElement;
	wrap.setAttribute('aria-label', zh ? '星级评价' : 'Star rating');
	guardPrimaryTreePointer(wrap);

	const starEls = Array.from(wrap.children) as HTMLSpanElement[];
	let titlesDirty = true;
	const syncVisual = (val: number) => {
		titlesDirty = true;
		if (val === 0) wrap.setAttribute('data-unrated', 'true');
		else wrap.removeAttribute('data-unrated');
		for (let idx = 0; idx < starEls.length; idx++) {
			const s = starEls[idx];
			if (idx + 1 <= val) s.setAttribute('data-lit', 'true');
			else s.removeAttribute('data-lit');
		}
	};
	const syncHoverTitles = () => {
		if (!titlesDirty) return;
		titlesDirty = false;
		for (let idx = 0; idx < starEls.length; idx++) {
			const k = idx + 1;
			starEls[idx].title = zh
				? (current === k ? `点击清除 ${k} 星评级` : `设为 ${k} 星（支持多选批量打分）`)
				: (current === k ? `Clear ${k}-star rating` : `Rate ${k} stars (multi-select aware)`);
		}
	};

	wrap.addEventListener('mouseover', (ev) => {
		syncHoverTitles();
		const k = Number((ev.target as HTMLElement | null)?.closest?.('[data-star]')?.getAttribute('data-star') || 0);
		if (k >= 1 && k <= 5) {
			wrap.setAttribute('data-hover', String(k));
			if (current === k) wrap.setAttribute('data-clear-hint', 'true');
			else wrap.removeAttribute('data-clear-hint');
		}
	});
	wrap.addEventListener('mouseleave', () => {
		wrap.removeAttribute('data-hover');
		wrap.removeAttribute('data-clear-hint');
	});
	bindInstantCellPress(wrap, (ev) => {
		const k = Number((ev.target as HTMLElement | null)?.closest?.('[data-star]')?.getAttribute('data-star') || 0);
		if (k < 1 || k > 5) return;
		const selected = (win as any)?.ZoteroPane?.getSelectedItems?.() || [];
		const targets = captureBatchTargets(selected, item);
		const targetIDs = targets.map((t) => Number(t?.id || 0)).filter((n) => n > 0);
		const prev = current;
		const next = current === k ? 0 : k;
		current = next;
		wrap.removeAttribute('data-hover');
		wrap.removeAttribute('data-clear-hint');
		syncVisual(next);
		void (async () => {
			let anySaved = false;
			try {
				for (const t of targets) {
					try { if (await setItemRating(t, next, storage)) anySaved = true; } catch { /* isolate per-item failure */ }
				}
			} finally {
				if (!anySaved) { current = prev; syncVisual(prev); }
				onApplied(targetIDs);
			}
		})();
	});
	syncVisual(current);
	fit.appendChild(wrap);
	span.appendChild(fit);
	return span;
}
