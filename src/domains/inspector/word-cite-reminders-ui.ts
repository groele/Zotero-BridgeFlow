import type { ReminderItemRecord, ReminderSectionViewModel } from './word-cite-reminders-model.ts';

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

export interface ReminderDomCallbacks {
	onToggleAccordion(): void;
	onSelectFilter(filter: 'active' | 'ignored'): void;
	onLocateItem(itemID: number): void;
	onIgnoreItem(record: ReminderItemRecord): void;
	onRestoreItem(record: ReminderItemRecord): void;
}

export interface ReminderCardDomRefs {
	readonly root: HTMLElement;
	readonly headBtn: HTMLButtonElement;
	readonly badgeEl: HTMLSpanElement;
	readonly titleEl: HTMLSpanElement;
	readonly subHintEl: HTMLSpanElement;
	readonly arrowEl: HTMLSpanElement;
	readonly bodyEl: HTMLElement;
	readonly filterBar: HTMLElement;
	readonly activeFilterBtn: HTMLButtonElement;
	readonly ignoredFilterBtn: HTMLButtonElement;
	readonly hintEl: HTMLElement;
	readonly listEl: HTMLElement;
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

export const REMINDERS_CARD_CSS = `
.zbf-wc-rem-filters { display: flex; align-items: center; gap: 5px; padding-top: 1px; min-width: 0; }
.zbf-wc-rem-filter { appearance: none; border: 1px solid light-dark(#d6d9de, #454a52); border-radius: 999px; background: light-dark(#fafafa, rgba(255,255,255,0.03)); color: light-dark(#666666, #9ea4ad); padding: 2px 8px; font-size: 10px; cursor: pointer; }
.zbf-wc-rem-filter:hover { color: light-dark(#262626, #ececec); background: light-dark(#f0f2f5, rgba(255,255,255,0.08)); }
.zbf-wc-rem-filter.is-active { background: light-dark(#edf5fe, rgba(56,139,253,0.18)); border-color: light-dark(#accbf2, rgba(96,165,250,0.42)); color: light-dark(#1759aa, #7cc0ff); font-weight: 600; }
.zbf-wc-rem-hint { font-size: 10px; line-height: 1.42; color: light-dark(#737373, #9ea4ad); border-inline-start: 2px solid light-dark(#9ec3ef, rgba(96,165,250,0.45)); padding-inline-start: 6px; min-width: 0; }
.zbf-wc-rem-list { box-sizing: border-box; display: grid; gap: 0; max-height: 210px; overflow-x: hidden; overflow-y: auto; min-width: 0; max-width: 100%; }
.zbf-wc-rem-row { box-sizing: border-box; display: grid; gap: 4px; padding: 6px 4px; border-bottom: 1px solid light-dark(#eeeeee, #33363c); min-width: 0; max-width: 100%; }
.zbf-wc-rem-row:last-child { border-bottom: 0; }
.zbf-wc-rem-row.is-clickable { cursor: pointer; border-radius: 4px; }
.zbf-wc-rem-row.is-clickable:hover { background: light-dark(#f4f7fb, rgba(56,139,253,0.08)); }
.zbf-wc-rem-top { display: flex; align-items: flex-start; gap: 5px; min-width: 0; }
.zbf-wc-rem-type { flex: none; padding: 1px 4px; border-radius: 3px; background: light-dark(#f0f2f4, rgba(255,255,255,0.09)); border: 1px solid light-dark(#e3e6ea, rgba(255,255,255,0.12)); color: light-dark(#595959, #cbd5e1); font-size: 9.5px; line-height: 1.35; }
.zbf-wc-rem-title { flex: 1 1 0; min-width: 0; font-size: 11.5px; font-weight: 500; line-height: 1.38; color: light-dark(#262626, #ececec); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-field-tags { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.zbf-wc-field-tag { padding: 1px 5px; border-radius: 3px; font-size: 10px; line-height: 1.35; background: light-dark(#fff8eb, rgba(245,158,11,0.14)); border: 1px solid light-dark(#ead2a5, rgba(245,158,11,0.34)); color: light-dark(#94550f, #fbbf24); }
.zbf-wc-field-tag.is-soft { background: light-dark(#f4f5f7, rgba(255,255,255,0.06)); border-color: light-dark(#dfe2e6, #454a52); color: light-dark(#666666, #9ea4ad); }
.zbf-wc-rem-foot { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 10px; min-width: 0; }
.zbf-wc-rem-src { color: light-dark(#737373, #9ea4ad); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.zbf-wc-rem-act { flex: none; appearance: none; border: 1px solid light-dark(#d0d5db, #484c54); border-radius: 4px; background: light-dark(#fafafa, #2c2f34); color: light-dark(#4d555e, #d0d5dd); padding: 1px 7px; font-size: 10px; cursor: pointer; }
.zbf-wc-rem-act:hover { color: light-dark(#222222, #ffffff); background: light-dark(#f0f2f5, #363a40); border-color: light-dark(#b8bfc7, #575d66); }
.zbf-wc-rem-empty { padding: 12px 6px; text-align: center; font-size: 10.5px; color: light-dark(#737373, #9ea4ad); border: 1px dashed light-dark(#dcdcdc, #454a52); border-radius: 4px; }
`;

export function createReminderCardDom(doc: Document, cb: Pick<ReminderDomCallbacks, 'onToggleAccordion' | 'onSelectFilter'>, signal: AbortSignal): ReminderCardDomRefs {
	const root = createEl(doc, 'section', 'zbf-wc-acc zbf-wc-rem-acc is-closed');
	root.hidden = true;

	const headBtn = createEl(doc, 'button', 'zbf-wc-acc-head');
	headBtn.type = 'button';
	headBtn.setAttribute('aria-expanded', 'false');
	const badgeEl = createEl(doc, 'span', 'zbf-wc-badge');
	const titleEl = createEl(doc, 'span', 'zbf-wc-acc-title');
	const subHintEl = createEl(doc, 'span', 'zbf-wc-acc-sub');
	const arrowEl = createEl(doc, 'span', 'zbf-wc-acc-arrow');
	arrowEl.textContent = '⌄';
	headBtn.append(badgeEl, titleEl, subHintEl, arrowEl);
	headBtn.addEventListener('click', () => cb.onToggleAccordion(), { signal });

	const bodyEl = createEl(doc, 'div', 'zbf-wc-acc-body');
	bodyEl.hidden = true;

	const filterBar = createEl(doc, 'div', 'zbf-wc-rem-filters');
	const activeFilterBtn = createEl(doc, 'button', 'zbf-wc-rem-filter is-active');
	activeFilterBtn.type = 'button';
	activeFilterBtn.addEventListener('click', () => cb.onSelectFilter('active'), { signal });
	const ignoredFilterBtn = createEl(doc, 'button', 'zbf-wc-rem-filter');
	ignoredFilterBtn.type = 'button';
	ignoredFilterBtn.addEventListener('click', () => cb.onSelectFilter('ignored'), { signal });
	filterBar.append(activeFilterBtn, ignoredFilterBtn);

	const hintEl = createEl(doc, 'div', 'zbf-wc-rem-hint');
	const listEl = createEl(doc, 'div', 'zbf-wc-rem-list');
	bodyEl.append(filterBar, hintEl, listEl);

	root.append(headBtn, bodyEl);
	return {
		root, headBtn, badgeEl, titleEl, subHintEl, arrowEl, bodyEl,
		filterBar, activeFilterBtn, ignoredFilterBtn, hintEl, listEl,
	};
}

export function renderReminderCardDom(
	doc: Document,
	refs: ReminderCardDomRefs,
	model: ReminderSectionViewModel,
	zh: boolean,
	cb: Pick<ReminderDomCallbacks, 'onLocateItem' | 'onIgnoreItem' | 'onRestoreItem'>,
): void {
	refs.root.hidden = !model.visible;
	if (!model.visible) return;

	refs.root.classList.toggle('is-closed', !model.expanded);
	refs.headBtn.setAttribute('aria-expanded', String(model.expanded));
	refs.badgeEl.textContent = model.headerBadge;
	refs.badgeEl.classList.toggle('is-warn', model.headerBadgeTone === 'warn');
	refs.badgeEl.classList.toggle('is-ok', model.headerBadgeTone === 'ok');
	refs.titleEl.textContent = model.headerTitle;
	refs.subHintEl.hidden = !model.headerActionHint;
	refs.subHintEl.textContent = model.headerActionHint;
	refs.bodyEl.hidden = !model.expanded;
	if (!model.expanded) return;

	refs.activeFilterBtn.textContent = model.activeTabLabel;
	refs.activeFilterBtn.classList.toggle('is-active', model.filter === 'active');
	refs.ignoredFilterBtn.textContent = model.ignoredTabLabel;
	refs.ignoredFilterBtn.classList.toggle('is-active', model.filter === 'ignored');
	refs.hintEl.textContent = model.scopeHint;

	clearChildren(refs.listEl);
	if (model.rows.length === 0) {
		const empty = createEl(doc, 'div', 'zbf-wc-rem-empty');
		empty.textContent = model.emptyText;
		refs.listEl.appendChild(empty);
		return;
	}

	for (const rec of model.rows) {
		const clickable = !rec.ignored;
		const row = createEl(doc, 'div', `zbf-wc-rem-row${clickable ? ' is-clickable' : ''}`);
		if (clickable) {
			row.tabIndex = 0;
			row.title = zh
				? `点击定位到「${rec.title}」，在「信息」页核对补全`
				: `Click to locate "${rec.title}" and complete metadata in Info`;
		}

		const top = createEl(doc, 'div', 'zbf-wc-rem-top');
		const typeTag = createEl(doc, 'span', 'zbf-wc-rem-type');
		typeTag.textContent = rec.itemTypeLabel;
		const title = createEl(doc, 'span', 'zbf-wc-rem-title');
		title.textContent = rec.ordinal ? `[${rec.ordinal}] ${rec.title}` : rec.title;
		top.append(typeTag, title);

		const tags = createEl(doc, 'div', 'zbf-wc-field-tags');
		for (const f of rec.fields) {
			const pill = createEl(doc, 'span', `zbf-wc-field-tag${f.kind === 'suggested' ? ' is-soft' : ''}`);
			pill.textContent = f.text;
			tags.appendChild(pill);
		}

		const foot = createEl(doc, 'div', 'zbf-wc-rem-foot');
		const src = createEl(doc, 'span', 'zbf-wc-rem-src');
		src.textContent = rec.creatorYear ? `${rec.creatorYear} · ${rec.sourceLabel}` : rec.sourceLabel;
		const actBtn = createEl(doc, 'button', 'zbf-wc-rem-act');
		actBtn.type = 'button';
		actBtn.textContent = rec.ignored ? (zh ? '恢复提醒' : 'Restore') : (zh ? '忽略提醒' : 'Ignore');
		actBtn.addEventListener('click', (ev: Event) => {
			ev.stopPropagation?.();
			if (rec.ignored) cb.onRestoreItem(rec);
			else cb.onIgnoreItem(rec);
		});
		foot.append(src, actBtn);

		row.append(top, tags, foot);
		if (clickable) {
			row.addEventListener('click', (ev: Event) => {
				if ((ev.target as HTMLElement | null)?.closest?.('button')) return;
				cb.onLocateItem(rec.itemID);
			});
			row.addEventListener('keydown', (ev: KeyboardEvent) => {
				if (ev.target === row && (ev.key === 'Enter' || ev.key === ' ')) {
					ev.preventDefault?.();
					cb.onLocateItem(rec.itemID);
				}
			});
		}
		refs.listEl.appendChild(row);
	}
}
