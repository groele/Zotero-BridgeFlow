import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../kernel/types.ts';
import { sanitizeCitationHtml } from '../../services/html-sanitizer.ts';
import { deduplicateRegularItems } from '../../services/item-resolution.ts';
import { normalizePanePosition } from '../../services/pane-positioner.ts';
import type { ServiceContainer } from '../../services/service-container.ts';
import { CLIPBOARD_ICON_SVG, ensureViewFlowStyles, SUCCESS_ICON_SVG } from './inspector-styles.ts';

interface PreviewBlockContent {
	html: string;
	text: string;
	styleID: string;
}

interface PreviewPaneState {
	body: HTMLElement;
	doc: Document;
	items: any[];
	omitted: number;
	generation: number;
	failed: boolean;
	lastHTML: string;
	payload: Partial<Record<'bibliography' | 'citation', PreviewBlockContent>> | null;
	copyFeedback: Map<HTMLElement, ReturnType<typeof setTimeout>[]>;
	feedbackTimers: Set<ReturnType<typeof setTimeout>>;
	setEnabled?: (enabled: boolean) => void;
}

const ERROR_L10N: Record<string, [string, string]> = {
	'no-style': ['zbf-preview-no-style', 'QuickCopy 未选择参考文献样式，请在 Zotero 或 BridgeFlow 设置中配置样式。'],
	'style-missing': ['zbf-preview-style-missing', '所选引用样式尚未安装，请在 Zotero 中安装或切换其他样式。'],
	'quickcopy-unavailable': ['zbf-preview-quickcopy-unavailable', 'QuickCopy 无法格式化当前条目，请检查引用样式后重试。'],
};

function escapeHTML(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export class CslPreviewSectionController {
	public sectionID: string | false = false;
	private readonly states = new Map<HTMLElement, PreviewPaneState>();
	private unregisterFn: Disposable | null = null;
	private readonly kernel: PluginKernel;
	private readonly services: ServiceContainer;

	constructor(kernel: PluginKernel, services: ServiceContainer) {
		this.kernel = kernel;
		this.services = services;
	}

	register(): void {
		if (this.unregisterFn) return;
		const icon = `${this.kernel.info.rootURI}assets/view.svg`;
		const reg = this.services.itemPanes.register({
			paneID: 'bridgeflow-csl-preview',
			pluginID: this.kernel.info.id,
			header: { l10nID: 'zbf-pane-csl-preview-header', icon },
			sidenav: { l10nID: 'zbf-pane-csl-preview-sidenav', icon, orderable: true },
			onInit: ({ body, item, setEnabled }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void }) => {
				const doc = body.ownerDocument;
				if (!doc) return;
				doc.defaultView?.MozXULElement?.insertFTLIfNeeded?.('zotero-bridgeflow.ftl');
				ensureViewFlowStyles(doc);
				body.classList.add('zotero-preview-root');
				const st: PreviewPaneState = {
					body,
					doc,
					items: [],
					omitted: 0,
					generation: 0,
					failed: false,
					lastHTML: '',
					payload: null,
					copyFeedback: new Map(),
					feedbackTimers: new Set(),
					setEnabled,
				};
				this.states.set(body, st);
				this.bindBodyEvents(st);
				this.updateItems(st, item, setEnabled);
				this.services.panePositions.observeAndQueue(body);
			},
			onDestroy: ({ body }: { body: HTMLElement }) => {
				const st = this.states.get(body);
				if (st) this.clearTimers(st);
				this.states.delete(body);
			},
			onItemChange: ({ body, item, setEnabled }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void }) => {
				const st = this.states.get(body);
				if (!st) return false;
				st.failed = false;
				this.services.panePositions.observeAndQueue(body);
				return this.updateItems(st, item, setEnabled);
			},
			onRender: ({ body, item, setEnabled }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void }) => {
				const st = this.states.get(body);
				if (!st) return;
				this.updateItems(st, item, setEnabled);
				this.services.panePositions.observeAndQueue(body);
				void this.renderState(body);
			},
			onAsyncRender: async ({ body }: { body: HTMLElement }) => {
				await this.renderState(body);
			},
			onToggle: ({ body }: { body: HTMLElement }) => {
				void this.renderState(body);
			},
		});
		this.sectionID = reg.sectionID;
		this.unregisterFn = reg.dispose;
		if (this.sectionID) {
			this.services.panePositions.setTarget('csl-preview', {
				sectionID: this.sectionID,
				getPosition: () => normalizePanePosition(this.kernel.prefs.get('inspector.cslPreview.position'), 'zotero-item-pane-header'),
			});
		}
	}

	async renderState(body: HTMLElement): Promise<void> {
		const st = this.states.get(body);
		if (!st) return;
		const gen = ++st.generation;
		if (!st.items.length) {
			st.payload = null;
			this.renderMessage(st, 'zbf-preview-select-items', '请选择一个或多个条目以预览引用。');
			return;
		}
		if (!st.payload && !st.lastHTML) {
			this.renderMessage(st, 'zbf-preview-loading', '正在生成预览…');
		}

		try {
			const mode = String(this.kernel.prefs.get('inspector.cslPreview.whatToShow') || 'zpboth');
			const wantBib = mode !== 'zpcite' && mode !== 'zpintext';
			const wantCite = mode !== 'zpbib';

			const [bibRes, citeRes] = await Promise.all([
				wantBib ? this.services.csl.formatItems(st.items, { asCitation: false }) : Promise.resolve(null),
				wantCite ? this.services.csl.formatItems(st.items, { asCitation: true }) : Promise.resolve(null),
			]);
			if (gen !== st.generation || st.body.isConnected === false) return;

			const payload: Partial<Record<'bibliography' | 'citation', PreviewBlockContent>> = {};
			if (bibRes && (bibRes.html || bibRes.text)) payload.bibliography = bibRes;
			if (citeRes && (citeRes.html || citeRes.text)) payload.citation = citeRes;
			st.payload = payload;
			st.failed = false;
			this.renderPayload(st, payload);
		} catch (error) {
			if (gen !== st.generation || st.body.isConnected === false) return;
			st.payload = null;
			st.failed = true;
			const code = (error as { previewCode?: string })?.previewCode || '';
			const [id, fallback] = ERROR_L10N[code] || ['zbf-preview-unavailable', '预览不可用，请检查引用样式后重试。'];
			const detail = code ? '' : (error instanceof Error ? error.message : String(error || ''));
			this.renderMessage(st, id, fallback, true, detail);
		}
	}

	async refreshAll(): Promise<void> {
		for (const body of this.states.keys()) {
			await this.renderState(body);
		}
	}

	unregister(): void {
		this.services.panePositions.setTarget('csl-preview', null);
		this.sectionID = false;
		this.unregisterFn?.();
		this.unregisterFn = null;
		for (const st of this.states.values()) this.clearTimers(st);
		this.states.clear();
	}

	private updateItems(st: PreviewPaneState, item: any, setEnabled?: (v: boolean) => void): boolean {
		const maxItems = this.kernel.prefs.get('inspector.cslPreview.maxPreviewItems');
		const selected = item ? [item] : ((globalThis as any).Zotero?.getMainWindow?.()?.ZoteroPane?.getSelectedItems?.() || []);
		const { items } = deduplicateRegularItems(selected, maxItems);
		st.items = items;
		st.omitted = Math.max(0, deduplicateRegularItems(selected, 10_000).items.length - items.length);
		const enabled = items.length > 0;
		(setEnabled || st.setEnabled)?.(enabled);
		return enabled;
	}

	private bindBodyEvents(st: PreviewPaneState): void {
		const triggerCopy = (button: HTMLElement | null) => {
			if (!button || !st.payload) return;
			const asCitation = button.getAttribute('data-copy-citation') === 'true';
			const content = st.payload[asCitation ? 'citation' : 'bibliography'];
			if (!content) return;
			const ok = this.services.clipboard.copyRendered(st.items, content, { asCitation, source: 'preview' });
			if (ok) {
				st.body.querySelector?.('.zotero-preview-copy-status')?.remove();
				this.showCopyFeedback(st, button);
			} else {
				this.renderCopyError(st);
			}
		};

		st.body.addEventListener('click', (ev: Event) => {
			const target = ev.target as Element | null;
			const retryBtn = target?.closest?.('.zotero-preview-retry') as HTMLElement | null;
			if (retryBtn) {
				st.failed = false;
				void this.renderState(st.body);
				return;
			}
			const copyBtn = target?.closest?.('.zotero-preview-copy') as HTMLElement | null;
			if (copyBtn) triggerCopy(copyBtn);
		});

		st.body.addEventListener('keydown', (ev: Event) => {
			const keyEv = ev as KeyboardEvent;
			if (keyEv.key !== 'Enter' && keyEv.key !== ' ') return;
			const copyBtn = (ev.target as Element | null)?.closest?.('.zotero-preview-copy') as HTMLElement | null;
			if (!copyBtn) return;
			keyEv.preventDefault?.();
			triggerCopy(copyBtn);
		});
	}

	private renderPayload(st: PreviewPaneState, payload: Partial<Record<'bibliography' | 'citation', PreviewBlockContent>>): void {
		const blocks = Object.entries(payload).map(([kind, content]) => {
			if (!content) return '';
			const fallbackLabel = kind === 'citation' ? '复制正文引用' : '复制参考文献';
			return (
				`<section class="zotero-preview-block"><div class="zotero-preview-block-row">` +
				`<div class="zotero-preview-block-body">${sanitizeCitationHtml(st.doc, content.html) || escapeHTML(content.text)}</div>` +
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
			this.renderMessage(st, 'zbf-preview-select-items', '请选择一个或多个条目以预览引用。');
			return;
		}
		const fontSize = String(this.kernel.prefs.get('inspector.cslPreview.fontsize') || '1');
		const spacing = String(this.kernel.prefs.get('inspector.cslPreview.spacing') || '1.5');
		st.body.style.setProperty('--zotero-preview-font-size', `${fontSize}em`);
		st.body.style.setProperty('--zotero-preview-line-height', spacing);

		const wrapped = `<div class="zotero-preview-content">${html}</div>`;
		if (st.lastHTML !== wrapped) {
			this.setHTML(st, wrapped);
			st.lastHTML = wrapped;
		}
	}

	private renderMessage(st: PreviewPaneState, id: string, fallback: string, error = false, detail = ''): void {
		const cleanDetail = error ? detail.trim().slice(0, 240) : '';
		const detailHtml = cleanDetail ? `<div class="zotero-preview-message-detail">${escapeHTML(cleanDetail)}</div>` : '';
		const html =
			`<div class="zotero-preview-message${error ? ' zotero-preview-message-error' : ''}" role="status" data-l10n-id="${id}">${escapeHTML(fallback)}</div>` +
			detailHtml +
			(error ? '<button type="button" class="zotero-preview-retry" data-preview-retry="" data-l10n-id="zbf-preview-retry">重新生成预览</button>' : '');
		if (st.lastHTML === html) return;
		this.setHTML(st, html);
		st.lastHTML = html;
	}

	private renderCopyError(st: PreviewPaneState): void {
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

	private showCopyFeedback(st: PreviewPaneState, button: HTMLElement): void {
		for (const timer of st.copyFeedback.get(button) || []) {
			clearTimeout(timer);
			st.feedbackTimers.delete(timer);
		}
		button.classList.add('zotero-preview-copy-success');
		this.replaceButtonSvg(st.doc, button, SUCCESS_ICON_SVG);
		const scaleTimer = setTimeout(() => {
			st.feedbackTimers.delete(scaleTimer);
			button.classList.remove('zotero-preview-copy-success');
		}, 300);
		const iconTimer = setTimeout(() => {
			st.feedbackTimers.delete(iconTimer);
			st.copyFeedback.delete(button);
			this.replaceButtonSvg(st.doc, button, CLIPBOARD_ICON_SVG);
		}, 1000);
		st.feedbackTimers.add(scaleTimer);
		st.feedbackTimers.add(iconTimer);
		st.copyFeedback.set(button, [scaleTimer, iconTimer]);
	}

	private replaceButtonSvg(doc: Document, button: HTMLElement, svgMarkup: string): void {
		const Parser = doc.defaultView?.DOMParser || globalThis.DOMParser;
		if (!Parser) return;
		const parsed = new Parser().parseFromString(svgMarkup, 'text/html');
		if (parsed?.body?.firstChild) {
			button.replaceChildren(doc.importNode(parsed.body.firstChild, true));
		}
	}

	private setHTML(st: PreviewPaneState, html: string): void {
		if (st.body.isConnected === false) return;
		this.clearTimers(st);
		const Parser = st.doc.defaultView?.DOMParser || globalThis.DOMParser;
		if (!Parser) {
			st.body.textContent = html.replace(/<[^>]*>/g, '');
			return;
		}
		const parsed = new Parser().parseFromString(html, 'text/html');
		if (!parsed?.body) return;
		st.body.replaceChildren(
			...(Array.from(parsed.body.childNodes) as Node[]).map((node) => st.doc.importNode(node, true)),
		);
	}

	private clearTimers(st: PreviewPaneState): void {
		for (const timer of st.feedbackTimers) clearTimeout(timer);
		st.feedbackTimers.clear();
		st.copyFeedback.clear();
	}
}
