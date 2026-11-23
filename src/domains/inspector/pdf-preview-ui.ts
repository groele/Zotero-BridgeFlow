import type { CompareMode, PdfAttachmentEntry } from './pdf-renderer.ts';

type SectionOwner = Element & { open?: boolean; collapsible?: boolean; empty?: boolean };

const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const SVG_NS = 'http://www.w3.org/2000/svg';

const TOOL_SVG_PATHS: Record<string, string> = {
	prev: 'M10 3.5L5.5 8L10 12.5',
	next: 'M6 3.5L10.5 8L6 12.5',
	zoomOut: 'M3.8 8H12.2',
	zoomIn: 'M8 3.8V12.2M3.8 8H12.2',
	toggleMode: 'M2.5 5.5V2.5H5.5M10.5 2.5H13.5V5.5M13.5 10.5V13.5H10.5M5.5 13.5H2.5V10.5',
	openReader: 'M9.5 2.8H13.2V6.5M13 3L7.5 8.5M11.5 9.2V12.4C11.5 12.84 11.14 13.2 10.7 13.2H3.6C3.16 13.2 2.8 12.84 2.8 12.4V5.3C2.8 4.86 3.16 4.5 3.6 4.5H6.8',
};

const STATUS_FALLBACKS: Record<string, string> = {
	'zbf-pdf-preview-loading': '正在加载 PDF 预览…',
	'zbf-pdf-preview-unavailable': '当前条目无可用的 PDF 附件',
	'zbf-pdf-preview-missing-file': '找不到本地 PDF 文件，请先检查附件存储路径',
	'zbf-pdf-preview-error': '无法渲染此 PDF，请尝试在阅读器中打开',
};

export interface CompareBarUI {
	bar: HTMLDivElement;
	countLabel: HTMLSpanElement;
	prevAttBtn: HTMLButtonElement;
	swapBtn: HTMLButtonElement;
	selfBtn: HTMLButtonElement;
	selectEl: HTMLSelectElement;
	nextAttBtn: HTMLButtonElement;
}

export interface CompareState {
	mode: CompareMode;
	pickedAttachmentID: number | null;
	lastAttachmentID?: number | null;
	currentAttachmentID: number;
	tabType: string;
}

export function createXhtmlEl<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, css = ''): HTMLElementTagNameMap[K] {
	const node = doc.createElementNS(XHTML_NS, tag) as HTMLElementTagNameMap[K];
	if (css) node.style.cssText = css;
	return node;
}

export function createToolBtn(doc: Document, text: string, l10nId?: string, extraClass = '', iconKey?: string): HTMLButtonElement {
	const btn = createXhtmlEl(doc, 'button');
	btn.type = 'button';
	btn.className = extraClass ? `ztf-pdf-btn ${extraClass}` : 'ztf-pdf-btn';
	if (l10nId) btn.setAttribute('data-l10n-id', l10nId);
	const d = iconKey ? TOOL_SVG_PATHS[iconKey] : '';
	if (d && typeof doc.createElementNS === 'function') {
		const svg = doc.createElementNS(SVG_NS, 'svg') as unknown as SVGElement;
		for (const [k, v] of [['viewBox', '0 0 16 16'], ['width', '12'], ['height', '12'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '1.6'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['class', 'ztf-pdf-btn-svg']]) {
			svg.setAttribute(k, v);
		}
		const path = doc.createElementNS(SVG_NS, 'path');
		path.setAttribute('d', d);
		svg.append(path);
		btn.append(svg);
		if (text && iconKey === 'openReader') {
			const span = createXhtmlEl(doc, 'span');
			span.textContent = text;
			btn.append(span);
		}
	} else if (text) btn.textContent = text;
	return btn;
}

export function applyStatusMessage(statusEl: HTMLDivElement, l10nId: string): void {
	if (!l10nId) {
		statusEl.style.display = 'none';
		statusEl.removeAttribute('data-l10n-id');
		statusEl.textContent = '';
		return;
	}
	statusEl.style.display = 'block';
	statusEl.setAttribute('data-l10n-id', l10nId);
	statusEl.textContent = STATUS_FALLBACKS[l10nId] || l10nId;
}

export function ensureSectionConnected(
	body: HTMLElement, root: HTMLElement, _savedSection?: Element | null, savedCollapsible?: Element | null,
): SectionOwner | null {
	if (!body.contains(root)) body.replaceChildren(root);
	const owner = (body.closest?.('collapsible-section') ||
		(savedCollapsible?.contains(body) ? savedCollapsible : null)) as SectionOwner | null;
	if (!owner) return null;
	owner.removeAttribute?.('empty');
	(owner as HTMLElement).style?.setProperty?.('--open-height', 'auto');
	return owner;
}

export class PreviewFocus {
	private readonly owners = new WeakSet<Element>();

	isActive(body: HTMLElement): boolean {
		const owner = body.closest('item-details');
		return !!owner && this.owners.has(owner);
	}

	set(state: { body: HTMLElement; root: HTMLElement; customSection: Element | null; fullActive: boolean }, active: boolean): void {
		const owner = state.body.closest('item-details');
		if (owner) {
			if (active) this.owners.add(owner);
			else this.owners.delete(owner);
		}
		state.fullActive = active;
		applyPreviewLayoutMode(state.body, state.root, state.customSection, active);
	}
}

export function applyPreviewLayoutMode(
	body: HTMLElement, root: HTMLElement, savedSection: Element | null, fullActive: boolean,
): void {
	root.setAttribute('data-layout-mode', fullActive ? 'full' : 'section');
	const modeBtn = root.querySelector?.('.ztf-pdf-mode-btn') as HTMLButtonElement | null;
	if (modeBtn) {
		if (fullActive) {
			modeBtn.setAttribute('data-active', 'true');
			modeBtn.title = '退出全高独占模式，恢复侧边栏其他区块';
		} else {
			modeBtn.removeAttribute('data-active');
			modeBtn.title = '切换内嵌区块 / 占满侧边栏预览模式';
		}
	}
	const hostSection = (body.closest?.('item-pane-custom-section') || savedSection) as HTMLElement | null;
	const stack = hostSection?.parentElement as HTMLElement | null;
	if (!hostSection) return;
	if (fullActive) {
		hostSection.setAttribute('data-ztf-pdf-full-section', 'true');
		stack?.setAttribute('data-ztf-pdf-full-stack', 'true');

	} else {
		hostSection.removeAttribute('data-ztf-pdf-full-section');
		if (!stack?.querySelector('[data-ztf-pdf-full-section]')) stack?.removeAttribute('data-ztf-pdf-full-stack');

	}
}

export function bindPreviewSidenavClick(
	doc: Document, signal: AbortSignal, body: HTMLElement, onFullModeChange: (active: boolean) => void,
): void {
	doc.addEventListener('click', (event: Event) => {
		const mouse = event as MouseEvent;
		if (mouse.button !== 0 || mouse.detail > 1) return;
		const selector = 'item-pane-sidenav .btn[data-pane]';
		const btn = (event.composedPath?.().find(node => (node as Element)?.matches?.(selector))
			|| (event.target as Element | null)?.closest?.(selector)) as HTMLElement | undefined;
		if (!btn || btn.hasAttribute('disabled')) return;
		const container = (btn.closest('item-pane-sidenav') as (Element & { container?: Element }) | null)?.container;
		if (!container?.contains(body)) return;
		const section = body.closest('item-pane-custom-section');
		if (!section) return;
		const selected = btn.getAttribute('data-pane') === section.getAttribute('data-pane');
		if (selected) {
			const collapsible = body.closest('collapsible-section') as SectionOwner | null;
			if (collapsible && !collapsible.open) {
				collapsible.removeAttribute('empty');
				collapsible.open = true;
			}
		}
		// Zotero owns scrolling, sidebar expansion and double-click pinning.
		onFullModeChange(selected);
	}, { capture: true, signal });
}

export function createCompareBar(
	doc: Document, signal: AbortSignal, getState: () => CompareState,
	onChange: (nextMode: CompareMode, nextPickedID: number | null) => void,
): CompareBarUI {
	const bar = createXhtmlEl(doc, 'div');
	bar.className = 'ztf-pdf-compare-bar';
	bar.style.display = 'none';
	const countLabel = createXhtmlEl(doc, 'span');
	countLabel.className = 'ztf-pdf-compare-count';
	countLabel.textContent = 'PDF 1/1';
	const prevAttBtn = createToolBtn(doc, '‹', undefined, 'ztf-pdf-compare-nav ztf-pdf-prev-att', 'prev');
	prevAttBtn.title = '切换上一个 PDF 附件';
	const nextAttBtn = createToolBtn(doc, '›', undefined, 'ztf-pdf-compare-nav ztf-pdf-next-att', 'next');
	nextAttBtn.title = '切换下一个 PDF 附件';
	const swapBtn = createXhtmlEl(doc, 'button');
	swapBtn.type = 'button';
	swapBtn.className = 'ztf-pdf-btn ztf-pdf-compare-btn ztf-pdf-swap-att';
	swapBtn.textContent = '⇄';
	swapBtn.title = '对比闪切：在当前与上一份对比 PDF 之间一键切换';
	const selfBtn = createXhtmlEl(doc, 'button');
	selfBtn.type = 'button';
	selfBtn.className = 'ztf-pdf-btn ztf-pdf-compare-btn';
	selfBtn.textContent = '自身';
	selfBtn.setAttribute('data-l10n-id', 'zbf-pdf-compare-self');
	const selectEl = createXhtmlEl(doc, 'select');
	selectEl.className = 'ztf-pdf-compare-select';
	selectEl.setAttribute('data-l10n-id', 'zbf-pdf-compare-select');
	const switchAttachment = (val: number) => {
		if (!val) return;
		const cur = getState();
		const prevVal = Number(cur.pickedAttachmentID || selectEl.value || 0);
		if (prevVal && prevVal !== val) cur.lastAttachmentID = prevVal;
		selectEl.value = String(val);
		onChange(val === cur.currentAttachmentID ? 'self' : 'sibling', val);
	};
	const cycleAttachment = (delta: number) => {
		const opts = Array.from(selectEl.options || []) as HTMLOptionElement[];
		if (opts.length <= 1) return;
		const curIdx = Math.max(0, selectEl.selectedIndex);
		const nextIdx = (curIdx + delta + opts.length) % opts.length;
		switchAttachment(Number(opts[nextIdx]?.value || 0));
	};
	prevAttBtn.addEventListener('click', () => cycleAttachment(-1), { signal });
	nextAttBtn.addEventListener('click', () => cycleAttachment(1), { signal });
	swapBtn.addEventListener('click', () => {
		const opts = Array.from(selectEl.options || []) as HTMLOptionElement[];
		if (opts.length <= 1) return;
		const cur = getState();
		const curVal = Number(selectEl.value || 0);
		const lastVal = Number(cur.lastAttachmentID || 0);
		if (lastVal && lastVal !== curVal && opts.some((o) => Number(o.value) === lastVal)) {
			switchAttachment(lastVal);
		} else {
			cycleAttachment(1);
		}
	}, { signal });
	selfBtn.addEventListener('click', () => {
		const cur = getState();
		onChange(cur.mode === 'self' ? 'sibling' : 'self', null);
	}, { signal });
	selectEl.addEventListener('change', () => {
		switchAttachment(Number(selectEl.value || 0));
	}, { signal });
	bar.append(countLabel, prevAttBtn, selectEl, nextAttBtn, swapBtn, selfBtn);
	return { bar, countLabel, prevAttBtn, swapBtn, selfBtn, selectEl, nextAttBtn };
}

export function syncCompareBar(ui: CompareBarUI, st: CompareState, entries: readonly PdfAttachmentEntry[], activeAttachmentID: number): void {
	const visible = entries.length > 1;
	ui.bar.style.display = visible ? 'flex' : 'none';
	if (!visible) return;
	const showSelf = st.tabType === 'reader' && st.currentAttachmentID > 0;
	ui.selfBtn.style.display = showSelf ? 'inline-flex' : 'none';
	const isSelf = st.mode === 'self' || (st.currentAttachmentID > 0 && activeAttachmentID === st.currentAttachmentID);
	if (isSelf) ui.selfBtn.setAttribute('data-active', 'true');
	else ui.selfBtn.removeAttribute('data-active');
	const doc = ui.bar.ownerDocument;
	if (!doc) return;
	ui.selectEl.textContent = '';
	let activeIdx = 0;
	entries.forEach((entry, idx) => {
		if (entry.id === activeAttachmentID) activeIdx = idx;
		const opt = createXhtmlEl(doc, 'option');
		opt.value = String(entry.id);
		const isCurrent = st.currentAttachmentID > 0 && entry.id === st.currentAttachmentID;
		const compact = entry.shortLabel || entry.title;
		opt.textContent = isCurrent ? `● ${idx + 1}. ${compact}` : `${idx + 1}. ${compact}`;
		opt.title = `${idx + 1}. ${entry.fullTitle || entry.title}`;
		ui.selectEl.append(opt);
	});
	if (activeAttachmentID) ui.selectEl.value = String(activeAttachmentID);
	const activeEntry = entries[activeIdx];
	if (activeEntry) {
		ui.selectEl.title = `${activeIdx + 1}. ${activeEntry.fullTitle || activeEntry.title}`;
	}
	ui.countLabel.textContent = `PDF ${activeIdx + 1}/${entries.length}`;
}

export function openPageJumpInput(
	doc: Document, pageLabel: HTMLSpanElement, currentPage: number, numPages: number, onCommit: (page: number) => void,
): void {
	if (numPages <= 1) return;
	const input = createXhtmlEl(doc, 'input');
	input.type = 'number';
	input.className = 'ztf-pdf-page-input';
	input.min = '1';
	input.max = String(numPages);
	input.value = String(currentPage || 1);
	let closed = false;
	const finish = (commit: boolean) => {
		if (closed) return;
		closed = true;
		const target = Number(input.value);
		input.replaceWith?.(pageLabel);
		if (commit && Number.isFinite(target) && target >= 1) onCommit(Math.round(target));
	};
	input.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter') { e.preventDefault?.(); finish(true); }
		else if (e.key === 'Escape') { e.preventDefault?.(); finish(false); }
	});
	input.addEventListener('blur', () => finish(true));
	pageLabel.replaceWith?.(input);
	input.focus?.();
	input.select?.();
}

export function evictDistantPageCanvases(
	slots: Array<{ pageNumber: number; card: HTMLDivElement; canvas: HTMLCanvasElement; renderedZoom: number | null; rendering: boolean; lastHeight: number }>,
	currentPage: number, radius = 8,
): void {
	if (slots.length <= 14) return;
	for (const slot of slots) {
		if (slot.renderedZoom !== null && !slot.rendering && Math.abs(slot.pageNumber - currentPage) > radius) {
			slot.canvas.width = 0; slot.canvas.height = 0; slot.renderedZoom = null;
			slot.card.setAttribute('data-unrendered', 'true');
			if (slot.lastHeight > 0) slot.card.style.minBlockSize = `${slot.lastHeight}px`;
		}
	}
}
