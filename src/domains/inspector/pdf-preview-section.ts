import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../kernel/types.ts';
import {
	normalizeToRegularItemAsync, resolvePdfAttachments, type ResolvedPdfAttachment,
} from '../../services/item-resolution.ts';
import type { ServiceContainer } from '../../services/service-container.ts';

interface PdfPaneState {
	body: HTMLElement;
	item: any | null;
	setEnabled?: (v: boolean) => void;
}

const PDF_CSS = `
.zbf-pdf-root { display:flex; flex-direction:column; gap:6px; padding:4px 0; font:12px/1.4 system-ui,sans-serif; }
.zbf-pdf-entry { display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; text-align:left; padding:6px 8px; border-radius:6px; border:1px solid color-mix(in srgb,currentColor 16%,transparent); background:color-mix(in srgb,currentColor 3%,transparent); color:inherit; font:inherit; cursor:pointer; }
.zbf-pdf-entry:hover { border-color:var(--accent-blue,#2563EB); background:color-mix(in srgb,var(--accent-blue,#2563EB) 10%,transparent); }
.zbf-pdf-badge { font-size:11px; opacity:0.75; flex-shrink:0; }
`;

export class PdfPreviewSectionController {
	private unregisterFn: Disposable | null = null;
	private readonly states = new Map<HTMLElement, PdfPaneState>();
	private readonly kernel: PluginKernel;
	private readonly services: ServiceContainer;

	constructor(kernel: PluginKernel, services: ServiceContainer) {
		this.kernel = kernel;
		this.services = services;
	}

	register(): void {
		if (this.unregisterFn) return;
		const icon = `${this.kernel.info.rootURI}assets/pdf-preview.svg`;
		const sidenavIcon = `${this.kernel.info.rootURI}assets/pdf-preview-sidenav.svg`;
		this.unregisterFn = this.services.itemPanes.register({
			paneID: 'bridgeflow-pdf-preview',
			pluginID: this.kernel.info.id,
			header: { l10nID: 'zbf-pane-pdf-preview-header', icon },
			sidenav: { l10nID: 'zbf-pane-pdf-preview-sidenav', icon: sidenavIcon, orderable: true },
			onInit: ({ body, item, setEnabled }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void }) => {
				const doc = body.ownerDocument;
				doc?.defaultView?.MozXULElement?.insertFTLIfNeeded?.('zotero-bridgeflow.ftl');
				if (doc && !doc.getElementById('zbf-pdf-preview-style')) {
					const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style') as HTMLStyleElement;
					style.id = 'zbf-pdf-preview-style';
					style.textContent = PDF_CSS;
					doc.documentElement?.append(style);
				}
				this.states.set(body, { body, item: item ?? null, setEnabled });
				setEnabled?.(Boolean(item));
			},
			onDestroy: ({ body }: { body: HTMLElement }) => {
				this.states.delete(body);
			},
			onItemChange: ({ body, item, setEnabled }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void }) => {
				const st = this.states.get(body);
				if (st) st.item = item ?? null;
				const active = Boolean(item);
				setEnabled?.(active);
				return active;
			},
			onRender: ({ body, item, setEnabled }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void }) => {
				const st = this.states.get(body);
				if (st && item !== undefined) st.item = item;
				setEnabled?.(Boolean(item ?? st?.item));
			},
			onAsyncRender: async ({ body, item, setEnabled }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void }) => {
				await this.renderCompareList(body, item ?? this.states.get(body)?.item, setEnabled);
			},
		});
	}

	async resolveSameItemPdfs(item: any): Promise<ResolvedPdfAttachment[]> {
		if (!item) return [];
		const owner = await normalizeToRegularItemAsync(item);
		return resolvePdfAttachments(owner || item);
	}

	private async renderCompareList(body: HTMLElement, item: any, setEnabled?: (v: boolean) => void): Promise<void> {
		const doc = body.ownerDocument;
		if (!doc) return;
		body.textContent = '';
		const pdfs = await this.resolveSameItemPdfs(item);
		setEnabled?.(pdfs.length > 0);
		if (!pdfs.length) return;

		const root = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
		root.className = 'zbf-pdf-root';
		for (const pdf of pdfs) {
			const btn = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
			btn.type = 'button';
			btn.className = 'zbf-pdf-entry';
			const name = doc.createElementNS('http://www.w3.org/1999/xhtml', 'span') as HTMLElement;
			name.textContent = pdf.filename || pdf.title;
			const badge = doc.createElementNS('http://www.w3.org/1999/xhtml', 'span') as HTMLElement;
			badge.className = 'zbf-pdf-badge';
			badge.textContent = 'Open / Focus';
			btn.append(name, badge);
			btn.addEventListener('click', () => {
				this.kernel.bus.emit('workspace:open-item-request', {
					itemID: pdf.id,
					attachmentID: pdf.id,
					preferExistingTab: true,
					assignToActiveGroup: true,
				});
			});
			root.append(btn);
		}
		body.append(root);
	}

	unregister(): void {
		this.unregisterFn?.();
		this.unregisterFn = null;
		this.states.clear();
	}
}
