import { sanitizeCitationHtml } from '../../../services/html-sanitizer.ts';
import { CLIPBOARD_ICON_SVG, SUCCESS_ICON_SVG } from './inspector-styles.ts';

export interface PreviewBlockContent {
	html: string;
	text: string;
	styleID: string;
}

export interface PreviewPaneState {
	body: HTMLElement;
	doc: Document;
	items: any[];
	itemsSig: string;
	omitted: number;
	generation: number;
	failed: boolean;
	lastHTML: string;
	renderedSig: string;
	lastChangeAt: number;
	inFlightSig: string;
	inFlight: Promise<void> | null;
	payload: Partial<Record<'bibliography' | 'citation', PreviewBlockContent>> | null;
	copyFeedback: Map<HTMLElement, ReturnType<typeof setTimeout>[]>;
	feedbackTimers: Set<ReturnType<typeof setTimeout>>;
	setEnabled?: (enabled: boolean) => void;
}

export const PREVIEW_ERROR_L10N: Record<string, [string, string]> = {
	'no-style': ['zbf-preview-no-style', 'QuickCopy 未选择参考文献样式，请在 Zotero 或 BridgeFlow 设置中配置样式。'],
	'style-missing': ['zbf-preview-style-missing', '所选引用样式尚未安装，请在 Zotero 中安装或切换其他样式。'],
	'quickcopy-unavailable': ['zbf-preview-quickcopy-unavailable', 'QuickCopy 无法格式化当前条目，请检查引用样式后重试。'],
};

export function escapePreviewHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function clearPreviewTimers(st: PreviewPaneState): void {
	for (const timer of st.feedbackTimers) clearTimeout(timer);
	st.feedbackTimers.clear();
	st.copyFeedback.clear();
}

export function setPreviewBodyHtml(st: PreviewPaneState, html: string): void {
	if (st.body.isConnected === false) return;
	clearPreviewTimers(st);
	const Parser = st.doc.defaultView?.DOMParser || globalThis.DOMParser;
	if (!Parser) { st.body.textContent = html.replace(/<[^>]*>/g, ''); return; }
	const parsed = new Parser().parseFromString(html, 'text/html');
	if (!parsed?.body) return;
	st.body.replaceChildren(...(Array.from(parsed.body.childNodes) as Node[]).map((n) => st.doc.importNode(n, true)));
}

export function renderPreviewMessage(
	st: PreviewPaneState,
	id: string,
	fallback: string,
	error = false,
	detail = '',
): void {
	const cleanDetail = error ? detail.trim().slice(0, 240) : '';
	const detailHtml = cleanDetail ? `<div class="zotero-preview-message-detail">${escapePreviewHtml(cleanDetail)}</div>` : '';
	const html =
		`<div class="zotero-preview-message${error ? ' zotero-preview-message-error' : ''}" role="status" data-l10n-id="${id}">${escapePreviewHtml(fallback)}</div>` +
		detailHtml +
		(error ? '<button type="button" class="zotero-preview-retry" data-preview-retry="" data-l10n-id="zbf-preview-retry">重新生成预览</button>' : '');
	if (st.lastHTML === html) return;
	setPreviewBodyHtml(st, html);
	st.lastHTML = html;
}

export function renderPreviewPayload(
	st: PreviewPaneState,
	payload: Partial<Record<'bibliography' | 'citation', PreviewBlockContent>>,
	fontSize: string,
	spacing: string,
): void {
	const blocks = Object.entries(payload).map(([kind, content]) => {
		if (!content) return '';
		const fallbackLabel = kind === 'citation' ? '复制正文引用' : '复制参考文献';
		return (
			`<section class="zotero-preview-block"><div class="zotero-preview-block-row">` +
			`<div class="zotero-preview-block-body">${sanitizeCitationHtml(st.doc, content.html) || escapePreviewHtml(content.text)}</div>` +
			`<div class="zotero-preview-block-toolbar">` +
			`<span class="zotero-preview-copy" role="button" tabindex="0" title="${fallbackLabel}" aria-label="${fallbackLabel}" data-l10n-id="zbf-preview-copy-${kind}" data-copy-citation="${kind === 'citation'}">${CLIPBOARD_ICON_SVG}</span>` +
			`</div></div></section>`
		);
	}).filter(Boolean);

	let html = blocks.join('<hr class="zotero-preview-separator"/>');
	if (st.omitted > 0) {
		html += `<div class="zotero-preview-message" data-l10n-id="zbf-preview-truncated" data-l10n-args='${JSON.stringify({ count: st.omitted })}'>另有 ${st.omitted} 个条目未显示。</div>`;
	}
	if (!html) {
		renderPreviewMessage(st, 'zbf-preview-select-items', '请选择一个或多个条目以预览引用。');
		return;
	}
	st.body.style.setProperty('--zotero-preview-font-size', `${fontSize}em`);
	st.body.style.setProperty('--zotero-preview-line-height', spacing);

	const wrapped = `<div class="zotero-preview-content">${html}</div>`;
	if (st.lastHTML !== wrapped) {
		setPreviewBodyHtml(st, wrapped);
		st.lastHTML = wrapped;
	}
}

export function renderPreviewCopyError(st: PreviewPaneState): void {
	let status = st.body.querySelector?.('.zotero-preview-copy-status') as HTMLElement | null;
	if (!status) {
		status = st.doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
		status.className = 'zotero-preview-copy-status zotero-preview-message';
		status.setAttribute('role', 'status');
		st.body.appendChild(status);
	}
	status.setAttribute('data-l10n-id', 'zbf-preview-copy-unavailable');
	status.textContent = '复制不可用，请尝试 Zotero 快捷键或重新选择条目。';
}

function replaceButtonSvg(doc: Document, button: HTMLElement, svgMarkup: string): void {
	const Parser = doc.defaultView?.DOMParser || globalThis.DOMParser;
	const parsed = Parser ? new Parser().parseFromString(svgMarkup, 'text/html') : null;
	if (parsed?.body?.firstChild) button.replaceChildren(doc.importNode(parsed.body.firstChild, true));
}

export function showPreviewCopyFeedback(st: PreviewPaneState, button: HTMLElement): void {
	for (const timer of st.feedbackTimers) clearTimeout(timer);
	button.classList.add('zotero-preview-copy-success');
	replaceButtonSvg(st.doc, button, SUCCESS_ICON_SVG);
	const scaleTimer = setTimeout(() => {
		st.feedbackTimers.delete(scaleTimer);
		button.classList.remove('zotero-preview-copy-success');
	}, 300);
	const iconTimer = setTimeout(() => {
		st.feedbackTimers.delete(iconTimer);
		st.copyFeedback.delete(button);
		replaceButtonSvg(st.doc, button, CLIPBOARD_ICON_SVG);
	}, 1000);
	st.feedbackTimers.add(scaleTimer);
	st.feedbackTimers.add(iconTimer);
	st.copyFeedback.set(button, [scaleTimer, iconTimer]);
}
