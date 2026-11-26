import {
	createReaderHtmlEl,
	createReaderSvgIcon,
	READER_ATT_BACKDROP_ID,
	READER_ATT_BTN_CLASS,
	READER_ATT_MENU_ID,
	READER_ATT_STYLE_ID,
	READER_ATT_SWITCHER_CSS,
	resolveSiblingAttachments,
	type SiblingAttachmentEntry,
} from './reader-attachment-switcher-styles.ts';

export {
	READER_ATT_BACKDROP_ID,
	READER_ATT_BTN_CLASS,
	READER_ATT_MENU_ID,
	READER_ATT_STYLE_ID,
	READER_ATT_SWITCHER_CSS,
	resolveSiblingAttachments,
	type SiblingAttachmentEntry,
};

export interface AttachmentMenuOptions {
	doc: Document;
	hostWin?: Window | null;
	readerFrame?: Element | null;
	anchorBtn: HTMLButtonElement;
	items: readonly SiblingAttachmentEntry[];
	currentAttID: number;
	openAttIDs: ReadonlySet<number>;
	zh: boolean;
	useFilename?: boolean;
	onSelect: (entry: SiblingAttachmentEntry) => void;
	onClose: () => void;
}

export function ensureSwitcherStyleSheet(doc: Document): void {
	const head = doc.head || doc.documentElement;
	if (!head) return;
	const existing = doc.getElementById?.(READER_ATT_STYLE_ID);
	if (existing) {
		if (existing.textContent !== READER_ATT_SWITCHER_CSS) existing.textContent = READER_ATT_SWITCHER_CSS;
		return;
	}
	const style = createReaderHtmlEl(doc, 'style');
	style.id = READER_ATT_STYLE_ID;
	style.textContent = READER_ATT_SWITCHER_CSS;
	head.appendChild(style);
}

export function buildSwitcherButtonDom(doc: Document): {
	wrap: HTMLDivElement;
	btn: HTMLButtonElement;
	labelEl: HTMLSpanElement;
} {
	const wrap = createReaderHtmlEl(doc, 'div');
	wrap.className = READER_ATT_BTN_CLASS;
	wrap.hidden = true;
	const btn = createReaderHtmlEl(doc, 'button');
	btn.type = 'button';
	btn.className = 'zbf-reader-att-btn';
	btn.setAttribute('aria-haspopup', 'menu');
	btn.setAttribute('aria-expanded', 'false');
	const labelEl = createReaderHtmlEl(doc, 'span');
	btn.appendChild(labelEl);
	btn.appendChild(createReaderSvgIcon(doc, 'zbf-reader-att-chev', '0 0 12 12', 'M3 4.5L6 7.5L9 4.5'));
	wrap.appendChild(btn);
	return { wrap, btn, labelEl };
}

export function createSectionWrapper(doc: Document, wrap: HTMLDivElement): HTMLDivElement {
	const sec = createReaderHtmlEl(doc, 'div');
	sec.className = 'section';
	sec.hidden = true;
	sec.appendChild(wrap);
	return sec;
}

export function openSiblingAttachmentMenu(opts: AttachmentMenuOptions): () => void {
	const { doc, hostWin, anchorBtn, items, currentAttID, openAttIDs, zh, onSelect, onClose } = opts;
	doc.getElementById(READER_ATT_MENU_ID)?.remove();
	doc.getElementById(READER_ATT_BACKDROP_ID)?.remove();

	const backdrop = createReaderHtmlEl(doc, 'div');
	backdrop.id = READER_ATT_BACKDROP_ID;
	backdrop.setAttribute('aria-hidden', 'true');

	const menu = createReaderHtmlEl(doc, 'div');
	menu.id = READER_ATT_MENU_ID;
	menu.setAttribute('role', 'menu');
	const rowEls: HTMLButtonElement[] = [];
	let focusIdx = Math.max(0, items.findIndex((i) => i.id === currentAttID));

	const updateFocus = (nextIdx: number) => {
		focusIdx = ((nextIdx % rowEls.length) + rowEls.length) % rowEls.length;
		rowEls.forEach((btn, i) => {
			if (i === focusIdx) { btn.setAttribute('data-focused', 'true'); btn.focus?.(); }
			else btn.removeAttribute('data-focused');
		});
	};

	const hint = zh ? '在当前标签页内切换' : 'Switch in the current tab';

	items.forEach((entry, idx) => {
		const row = createReaderHtmlEl(doc, 'button');
		row.type = 'button';
		row.className = 'zbf-reader-att-item';
		row.setAttribute('role', 'menuitemradio');
		const active = entry.id === currentAttID;
		row.setAttribute('aria-checked', active ? 'true' : 'false');
		if (active) row.setAttribute('data-active', 'true');
		const namePart = entry.filename && entry.filename !== entry.title ? `${entry.title}\n${entry.filename}` : entry.title;
		row.title = active ? namePart : `${namePart}\n${hint}`;

		const checkSlot = createReaderHtmlEl(doc, 'span');
		checkSlot.className = 'zbf-reader-att-check';
		if (active) checkSlot.appendChild(createReaderSvgIcon(doc, '', '0 0 14 14', 'M2.5 7.2L5.6 10.3L11.5 3.8'));
		row.appendChild(checkSlot);

		const titleEl = createReaderHtmlEl(doc, 'span');
		titleEl.className = 'zbf-reader-att-title';
		titleEl.textContent = opts.useFilename && entry.filename ? entry.filename : entry.title;
		row.appendChild(titleEl);

		if (openAttIDs.has(entry.id) && !active) {
			const dot = createReaderHtmlEl(doc, 'span');
			dot.className = 'zbf-reader-att-open-dot';
			dot.title = zh ? '已在另一标签页打开' : 'Already open in another tab';
			row.appendChild(dot);
		}
		if (entry.kind !== 'snapshot' || entry.title.toLowerCase() !== 'snapshot') {
			const badge = createReaderHtmlEl(doc, 'span');
			badge.className = 'zbf-reader-att-badge';
			badge.textContent = entry.kindLabel;
			row.appendChild(badge);
		}
		row.addEventListener('click', (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			close();
			onSelect(entry);
		});
		row.addEventListener('mouseenter', () => {
			focusIdx = idx;
			rowEls.forEach((b, i) => {
				if (i === idx) b.setAttribute('data-focused', 'true');
				else b.removeAttribute('data-focused');
			});
		});
		rowEls.push(row);
		menu.appendChild(row);
	});

	const mountHost = doc.body || doc.documentElement;
	mountHost?.appendChild(backdrop);
	mountHost?.appendChild(menu);

	const rect = anchorBtn.getBoundingClientRect?.() ?? { left: 12, bottom: 40, right: 120 };
	const vw = Number(doc.defaultView?.innerWidth || 960);
	const mw = Math.min(Number(menu.offsetWidth || 240), Math.max(160, vw - 16));
	const prefersRightAlign = rect.left + mw > vw - 8;
	const rawLeft = prefersRightAlign ? (Number(rect.right || rect.left + 80) - mw) : rect.left;
	const left = Math.max(8, Math.min(rawLeft, vw - mw - 8));
	menu.style.left = `${Math.round(left)}px`;
	menu.style.top = `${Math.round((rect.bottom || 38) + 4)}px`;
	anchorBtn.setAttribute('aria-expanded', 'true');

	let closed = false;
	let pointerInMenu = false;
	let pointerTimer: ReturnType<typeof setTimeout> | null = null;
	const markMenuPointer = () => {
		pointerInMenu = true;
		if (pointerTimer !== null) clearTimeout(pointerTimer);
		pointerTimer = setTimeout(() => { pointerInMenu = false; pointerTimer = null; }, 400);
	};
	const onBackdropDown = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); close(); };
	const onDocPointer = (ev: Event) => {
		const target = ev.target as Node | null;
		if (target && (menu.contains(target) || anchorBtn.contains(target))) return;
		close();
	};
	const onHostPointer = (ev: Event) => {
		const target = ev.target as Element | null;
		if (target && (
			menu.contains(target) || anchorBtn.contains(target) || ev.composedPath?.().includes(menu)
			|| target === opts.readerFrame
			|| opts.readerFrame?.contains?.(target)
			|| target.localName === 'browser'
			|| target.classList?.contains?.('reader')
		)) {
			return;
		}
		close();
	};
	const onWinBlur = () => {
		if (pointerInMenu) return;
		close();
	};
	const onKey = (ev: KeyboardEvent) => {
		if (ev.key === 'Escape') { ev.preventDefault(); close(); anchorBtn.focus?.(); }
		else if (ev.key === 'ArrowDown' && rowEls.length) { ev.preventDefault(); updateFocus(focusIdx + 1); }
		else if (ev.key === 'ArrowUp' && rowEls.length) { ev.preventDefault(); updateFocus(focusIdx - 1); }
		else if (ev.key === 'Enter' && rowEls[focusIdx]) { ev.preventDefault(); const e = items[focusIdx]; close(); onSelect(e); }
	};
	const hostDoc = hostWin?.document && hostWin.document !== doc ? hostWin.document : null;
	const close = () => {
		if (closed) return;
		closed = true;
		if (pointerTimer !== null) { clearTimeout(pointerTimer); pointerTimer = null; }
		menu.removeEventListener('pointerdown', markMenuPointer, true);
		backdrop.removeEventListener('pointerdown', onBackdropDown, true);
		doc.removeEventListener('pointerdown', onDocPointer, true);
		doc.removeEventListener('keydown', onKey, true);
		doc.defaultView?.removeEventListener('blur', onWinBlur);
		hostDoc?.removeEventListener('pointerdown', onHostPointer, true);
		anchorBtn.setAttribute('aria-expanded', 'false');
		backdrop.remove();
		menu.remove();
		onClose();
	};
	menu.addEventListener('pointerdown', markMenuPointer, true);
	backdrop.addEventListener('pointerdown', onBackdropDown, true);
	doc.addEventListener('pointerdown', onDocPointer, true);
	doc.addEventListener('keydown', onKey, true);
	doc.defaultView?.addEventListener('blur', onWinBlur);
	hostDoc?.addEventListener('pointerdown', onHostPointer, true);
	return close;
}
