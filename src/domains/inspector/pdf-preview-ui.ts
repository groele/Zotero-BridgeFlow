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
	selfBtn: HTMLButtonElement;
	selectEl: HTMLSelectElement;
}

export interface CompareState {
	mode: CompareMode;
	pickedAttachmentID: number | null;
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
	body: HTMLElement, root: HTMLElement, savedSection?: Element | null, savedCollapsible?: Element | null,
): SectionOwner | null {
	if (!body.contains(root)) body.replaceChildren(root);
	let owner = (body.closest?.('collapsible-section') ||
		(body.parentElement?.localName === 'collapsible-section' ? body.parentElement : null)) as SectionOwner | null;
	if (!owner) {
		const doc = body.ownerDocument;
		let hostSection = (body.closest?.('item-pane-custom-section') || savedSection || null) as any;
		if ((!hostSection || hostSection.isConnected === false) && doc?.querySelectorAll) {
			const candidates = Array.from(doc.querySelectorAll('item-pane-custom-section[data-pane*="bridgeflow-pdf-preview"]')) as any[];
			hostSection = candidates.find((c) => c._body === body) || candidates.find((c) => !c.querySelector('[data-type="body"]')) || hostSection;
		}
		const liveCollapsible = (hostSection?.querySelector?.('collapsible-section') ||
			(savedCollapsible?.isConnected ? savedCollapsible : null)) as SectionOwner | null;
		if (liveCollapsible) {
			const existingBody = liveCollapsible.querySelector?.('[data-type="body"]') as HTMLElement | null;
			if (!existingBody) liveCollapsible.append(body);
			else if (existingBody !== body) { existingBody.replaceWith(body); if (hostSection) hostSection._body = body; }
			owner = liveCollapsible;
		}
	}
	if (!owner) return null;
	owner.removeAttribute?.('empty');
	if ('empty' in owner) owner.empty = false;
	if (!owner.hasAttribute?.('data-zbf-pdf-ready')) {
		owner.setAttribute?.('data-zbf-pdf-ready', 'true');
		owner.open = true;
	}
	(owner as HTMLElement).style?.setProperty?.('--open-height', 'auto');
	return owner;
}

export function applyPreviewLayoutMode(
	body: HTMLElement, root: HTMLElement, savedSection: Element | null, fullActive: boolean,
): void {
	root.setAttribute('data-layout-mode', fullActive ? 'full' : 'section');
	const hostSection = (body.closest?.('item-pane-custom-section') || savedSection) as HTMLElement | null;
	const stack = hostSection?.parentElement as HTMLElement | null;
	if (!hostSection) return;
	if (fullActive) {
		hostSection.setAttribute('data-ztf-pdf-full-section', 'true');
		stack?.setAttribute('data-ztf-pdf-full-stack', 'true');
		for (const child of Array.from(stack?.parentElement?.children || [])) {
			const tag = (child.localName || child.tagName || '').toLowerCase();
			if (child !== stack && tag !== 'item-pane-sidenav' && !child.querySelector?.('item-pane-sidenav')) {
				child.setAttribute('data-ztf-pdf-full-hidden', 'true');
			}
		}
	} else {
		hostSection.removeAttribute('data-ztf-pdf-full-section');
		stack?.removeAttribute('data-ztf-pdf-full-stack');
		body.ownerDocument?.querySelectorAll?.('[data-ztf-pdf-full-hidden]').forEach((el: Element) => el.removeAttribute('data-ztf-pdf-full-hidden'));
	}
}

export function bindPreviewSidenavClick(
	doc: Document, signal: AbortSignal, isFullMode: () => boolean, onFullModeChange: (active: boolean) => void,
): void {
	if (typeof doc.addEventListener !== 'function') return;
	doc.addEventListener('click', (event: Event) => {
		if ((event as MouseEvent).button !== 0) return;
		const btn = (event.target as Element | null)?.closest?.('item-pane-sidenav .btn[data-pane]') as HTMLElement | null;
		const paneID = btn?.getAttribute?.('data-pane') || '';
		if (!btn || btn.hasAttribute?.('disabled')) return;
		if (!paneID.includes('bridgeflow-pdf-preview')) { onFullModeChange(false); return; }
		if (isFullMode()) onFullModeChange(true);
		const sidenav = btn.closest?.('item-pane-sidenav') as (Element & { container?: any }) | null;
		const container = sidenav?.container;
		const section = (container?.getEnabledPane?.(paneID) || doc.querySelector?.(`item-pane-custom-section[data-pane="${paneID}"]`)) as HTMLElement | null;
		const collapsible = section?.querySelector?.('collapsible-section') as SectionOwner | null;
		if (collapsible) {
			collapsible.removeAttribute?.('empty');
			collapsible.open = true;
			(collapsible as HTMLElement).style?.setProperty?.('--open-height', 'auto');
		}
		if (container?.scrollToPane) void container.scrollToPane(paneID, 'smooth');
	}, { capture: true, signal });
}

export function createCompareBar(
	doc: Document, signal: AbortSignal, getState: () => CompareState,
	onChange: (nextMode: CompareMode, nextPickedID: number | null) => void,
): CompareBarUI {
	const bar = createXhtmlEl(doc, 'div');
	bar.className = 'ztf-pdf-compare-bar';
	bar.style.display = 'none';
	const selfBtn = createXhtmlEl(doc, 'button');
	selfBtn.type = 'button';
	selfBtn.className = 'ztf-pdf-btn ztf-pdf-compare-btn';
	selfBtn.textContent = '自身';
	selfBtn.setAttribute('data-l10n-id', 'zbf-pdf-compare-self');
	const selectEl = createXhtmlEl(doc, 'select');
	selectEl.className = 'ztf-pdf-compare-select';
	selectEl.setAttribute('data-l10n-id', 'zbf-pdf-compare-select');
	selfBtn.addEventListener('click', () => {
		const cur = getState();
		onChange(cur.mode === 'self' ? 'sibling' : 'self', null);
	}, { signal });
	selectEl.addEventListener('change', () => {
		const val = Number(selectEl.value || 0);
		if (!val) return;
		const cur = getState();
		onChange(val === cur.currentAttachmentID ? 'self' : 'sibling', val);
	}, { signal });
	bar.append(selfBtn, selectEl);
	return { bar, selfBtn, selectEl };
}

export function syncCompareBar(ui: CompareBarUI, st: CompareState, entries: readonly PdfAttachmentEntry[], activeAttachmentID: number): void {
	const visible = st.tabType === 'reader' && entries.length > 1;
	ui.bar.style.display = visible ? 'flex' : 'none';
	if (!visible) return;
	const isSelf = st.mode === 'self' || (st.currentAttachmentID > 0 && activeAttachmentID === st.currentAttachmentID);
	if (isSelf) ui.selfBtn.setAttribute('data-active', 'true');
	else ui.selfBtn.removeAttribute('data-active');
	const doc = ui.bar.ownerDocument;
	if (!doc) return;
	ui.selectEl.textContent = '';
	entries.forEach((entry, idx) => {
		const opt = createXhtmlEl(doc, 'option');
		opt.value = String(entry.id);
		const isCurrent = st.currentAttachmentID > 0 && entry.id === st.currentAttachmentID;
		opt.textContent = isCurrent ? `● ${idx + 1}. ${entry.title}` : `${idx + 1}. ${entry.title}`;
		ui.selectEl.append(opt);
	});
	if (activeAttachmentID) ui.selectEl.value = String(activeAttachmentID);
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
