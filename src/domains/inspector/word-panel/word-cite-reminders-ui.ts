import type { ReminderItemRecord, ReminderSectionViewModel } from './word-cite-reminders-model.ts';
import { createWordCiteSvgIcon } from './word-cite-styles.ts';

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
/* 5. In-place Collapsible Reminder Card (Concept A Visuals, Zero Extra Sub-page) */
.zbf-wc-rem-card {
	box-sizing: border-box; border-radius: 8px;
	border: 1px solid var(--zbf-wc-line); background: var(--zbf-wc-card);
	box-shadow: 0 1px 2px light-dark(rgba(18, 32, 54, 0.03), rgba(0, 0, 0, 0.16));
	overflow: hidden; min-width: 0; max-width: 100%;
	transition: border-color 120ms ease, background-color 120ms ease;
}
.zbf-wc-rem-card.is-warn.is-closed {
	background: var(--zbf-wc-warn-bg); border-color: var(--zbf-wc-warn-bd);
}
.zbf-wc-rem-card.is-warn:not(.is-closed) {
	border-color: var(--zbf-wc-warn-bd);
}
.zbf-wc-rem-entry {
	appearance: none; box-sizing: border-box; width: 100%;
	display: flex; align-items: center; gap: 6.5px; padding: 7px 9px;
	border: 0; background: transparent; color: var(--zbf-wc-fg);
	text-align: left; cursor: pointer; font-family: inherit; font-size: 11px; font-weight: 550; line-height: 1.35; min-width: 0;
	transition: background-color 120ms ease;
}
.zbf-wc-rem-entry:hover { background: light-dark(rgba(0, 0, 0, 0.025), rgba(255, 255, 255, 0.04)); }
.zbf-wc-rem-card.is-warn .zbf-wc-rem-entry {
	background: var(--zbf-wc-warn-bg); color: var(--zbf-wc-warn-fg);
}
.zbf-wc-rem-card.is-warn .zbf-wc-rem-entry:hover { filter: brightness(0.98); }
.zbf-wc-rem-card.is-warn .zbf-wc-rem-entry-title { font-weight: 500; color: var(--zbf-wc-warn-fg); }
.zbf-wc-rem-card.is-warn .zbf-wc-rem-entry-act,
.zbf-wc-rem-card.is-warn .zbf-wc-rem-arrow { color: var(--zbf-wc-warn-fg); }
.zbf-wc-rem-entry-title { min-width: 0; flex: 1 1 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-rem-entry-act { flex: none; font-size: 10px; color: var(--zbf-wc-fg-muted); white-space: nowrap; }
.zbf-wc-rem-arrow {
	flex: none; color: var(--zbf-wc-fg-muted); display: inline-flex; align-items: center; justify-content: center;
	transition: transform 140ms ease;
}
.zbf-wc-rem-arrow .zbf-wc-svg { width: 11px; height: 11px; }
.zbf-wc-rem-card.is-closed .zbf-wc-rem-arrow { transform: rotate(-90deg); }

.zbf-wc-rem-body {
	box-sizing: border-box; padding: 7px 8px 8px;
	border-top: 1px solid var(--zbf-wc-line);
	display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px;
	min-width: 0; max-width: 100%; overflow: hidden;
}
.zbf-wc-rem-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-width: 0; }
.zbf-wc-rem-filters {
	display: inline-flex; align-items: center; gap: 2px; padding: 2px;
	border-radius: 5px; background: var(--zbf-wc-well); flex: none;
}
.zbf-wc-rem-filter {
	appearance: none; border: 0; border-radius: 3.5px; background: transparent;
	color: var(--zbf-wc-fg-muted); padding: 1.5px 7px; font-family: var(--zbf-num-font, inherit); font-size: 10px; line-height: 1.3; font-weight: 500;
	font-variant-numeric: tabular-nums; cursor: pointer; transition: background-color 120ms ease, color 120ms ease;
}
.zbf-wc-rem-filter:hover { color: var(--zbf-wc-fg); }
.zbf-wc-rem-filter.is-active {
	background: var(--zbf-wc-card-hi);
	box-shadow: 0 1px 2px light-dark(rgba(0, 0, 0, 0.06), rgba(0, 0, 0, 0.22));
	color: var(--zbf-wc-fg); font-weight: 580;
}
.zbf-wc-rem-hint {
	font-size: 10px; line-height: 1.35; color: var(--zbf-wc-fg-muted);
	min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.zbf-wc-rem-list {
	box-sizing: border-box; display: grid; gap: 5px; max-height: 215px;
	overflow-x: hidden; overflow-y: auto; min-width: 0; max-width: 100%;
}
.zbf-wc-rem-row {
	box-sizing: border-box; display: grid; gap: 4.5px; padding: 6px 7px;
	border-radius: 5px; background: var(--zbf-wc-card-hi); border: 1px solid var(--zbf-wc-line);
	min-width: 0; max-width: 100%; transition: background-color 120ms ease, border-color 120ms ease;
}
.zbf-wc-rem-row.is-clickable { cursor: pointer; }
.zbf-wc-rem-row.is-clickable:hover {
	border-color: light-dark(rgba(37, 95, 179, 0.36), rgba(105, 170, 255, 0.44));
}
.zbf-wc-rem-top { display: flex; align-items: center; gap: 5px; min-width: 0; }
.zbf-wc-rem-type {
	flex: none; padding: 0.5px 4.5px; border-radius: 3px;
	background: var(--zbf-wc-well-soft); color: var(--zbf-wc-fg-sec); font-size: 9.5px; line-height: 1.35;
}
.zbf-wc-rem-title {
	flex: 1 1 0; min-width: 0; font-size: 11px; font-weight: 500; line-height: 1.36;
	color: var(--zbf-wc-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.zbf-wc-field-tags { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.zbf-wc-field-tag {
	padding: 1px 5px; border-radius: 3.5px; font-size: 9.5px; line-height: 1.35;
	background: var(--zbf-wc-warn-bg); border: 1px solid var(--zbf-wc-warn-bd); color: var(--zbf-wc-warn-fg);
}
.zbf-wc-field-tag.is-soft {
	background: var(--zbf-wc-well-soft); border-color: var(--zbf-wc-line); color: var(--zbf-wc-fg-muted);
}
.zbf-wc-rem-foot { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 9.5px; min-width: 0; }
.zbf-wc-rem-src { color: var(--zbf-wc-fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.zbf-wc-rem-act {
	flex: none; appearance: none; height: 20px; padding: 0 7px; border-radius: 4px;
	border: 1px solid var(--zbf-wc-line); background: var(--zbf-wc-card);
	color: var(--zbf-wc-fg-sec); font-family: inherit; font-size: 9.5px; font-weight: 400; line-height: 1; cursor: pointer;
	transition: border-color 120ms ease, color 120ms ease, background-color 120ms ease;
}
.zbf-wc-rem-act:hover { color: var(--zbf-wc-fg); background: var(--zbf-wc-card-hi); border-color: var(--zbf-wc-line-strong); }
.zbf-wc-rem-empty {
	padding: 10px 8px; text-align: center; font-size: 10.5px; color: var(--zbf-wc-fg-muted);
	background: var(--zbf-wc-well-soft); border-radius: 5px;
}
.zbf-wc-rem-empty.is-ok { background: var(--zbf-wc-ok-bg); color: var(--zbf-wc-ok-fg); }
`;

export function createReminderCardDom(
	doc: Document,
	cb: Pick<ReminderDomCallbacks, 'onToggleAccordion' | 'onSelectFilter'>,
	signal: AbortSignal,
): ReminderCardDomRefs {
	const root = createEl(doc, 'section', 'zbf-wc-rem-card is-closed');
	root.hidden = true;

	const headBtn = createEl(doc, 'button', 'zbf-wc-rem-entry');
	headBtn.type = 'button';
	headBtn.setAttribute('aria-expanded', 'false');
	const badgeEl = createEl(doc, 'span', 'zbf-wc-badge');
	const titleEl = createEl(doc, 'span', 'zbf-wc-rem-entry-title');
	const subHintEl = createEl(doc, 'span', 'zbf-wc-rem-entry-act');
	const arrowEl = createEl(doc, 'span', 'zbf-wc-rem-arrow');
	arrowEl.appendChild(createWordCiteSvgIcon(doc, 'chevron'));
	headBtn.append(badgeEl, titleEl, subHintEl, arrowEl);
	headBtn.addEventListener('click', () => cb.onToggleAccordion(), { signal });

	const bodyEl = createEl(doc, 'div', 'zbf-wc-rem-body');
	bodyEl.hidden = true;

	const toolbar = createEl(doc, 'div', 'zbf-wc-rem-toolbar');
	const filterBar = createEl(doc, 'div', 'zbf-wc-rem-filters');
	const activeFilterBtn = createEl(doc, 'button', 'zbf-wc-rem-filter is-active');
	activeFilterBtn.type = 'button';
	activeFilterBtn.addEventListener('click', () => cb.onSelectFilter('active'), { signal });
	const ignoredFilterBtn = createEl(doc, 'button', 'zbf-wc-rem-filter');
	ignoredFilterBtn.type = 'button';
	ignoredFilterBtn.addEventListener('click', () => cb.onSelectFilter('ignored'), { signal });
	filterBar.append(activeFilterBtn, ignoredFilterBtn);
	const hintEl = createEl(doc, 'span', 'zbf-wc-rem-hint');
	toolbar.append(filterBar, hintEl);

	const listEl = createEl(doc, 'div', 'zbf-wc-rem-list');
	bodyEl.append(toolbar, listEl);

	root.append(headBtn, bodyEl);
	return {
		root, headBtn, badgeEl, titleEl, subHintEl, arrowEl,
		bodyEl, filterBar, activeFilterBtn, ignoredFilterBtn, hintEl, listEl,
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
	refs.root.classList.toggle('is-warn', model.headerBadgeTone === 'warn');
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
	refs.hintEl.textContent = zh ? '点击条目定位' : 'Click to locate';
	refs.hintEl.title = model.scopeHint;

	clearChildren(refs.listEl);
	if (model.rows.length === 0) {
		const isCleanOk = model.filter === 'active' && model.ignoredCount === 0 && model.checkedCount > 0;
		const empty = createEl(doc, 'div', `zbf-wc-rem-empty${isCleanOk ? ' is-ok' : ''}`);
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
		actBtn.textContent = rec.ignored ? (zh ? '恢复' : 'Restore') : (zh ? '忽略' : 'Ignore');
		actBtn.title = rec.ignored
			? (zh ? '恢复该条文献的信息完整性提醒' : 'Restore metadata reminder for this item')
			: (zh ? '忽略该条提醒（不修改条目与 Word 引文）' : 'Ignore this reminder without modifying item or Word citation');
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
