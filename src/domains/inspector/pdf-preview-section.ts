import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../kernel/types.ts';
import {
	normalizeToRegularItemAsync, resolvePdfAttachments, type ResolvedPdfAttachment,
} from '../../services/item-resolution.ts';
import type { ServiceContainer } from '../../services/service-container.ts';

export class PdfPreviewSectionController {
	private unregisterFn: Disposable | null = null;

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
			header: { l10nID: 'zbf-pane-pdf-preview-title', icon },
			sidenav: { l10nID: 'zbf-pane-pdf-preview-title', icon: sidenavIcon, orderable: true },
			onItemChange: ({ item }: { item?: any }) => Boolean(item),
			onAsyncRender: async ({ body, item }: { body: HTMLElement; item?: any }) => {
				await this.renderCompareList(body, item);
			},
		});
	}

	async resolveSameItemPdfs(item: any): Promise<ResolvedPdfAttachment[]> {
		const owner = await normalizeToRegularItemAsync(item);
		return resolvePdfAttachments(owner || item);
	}

	private async renderCompareList(body: HTMLElement, item: any): Promise<void> {
		const doc = body.ownerDocument;
		if (!doc) return;
		body.textContent = '';
		const pdfs = await this.resolveSameItemPdfs(item);
		if (!pdfs.length) return;

		for (const pdf of pdfs) {
			const btn = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
			btn.type = 'button';
			btn.className = 'zbf-pdf-entry';
			btn.textContent = pdf.filename || pdf.title;
			btn.addEventListener('click', () => {
				this.kernel.bus.emit('workspace:open-item-request', {
					itemID: pdf.id,
					attachmentID: pdf.id,
					preferExistingTab: true,
					assignToActiveGroup: true,
				});
			});
			body.append(btn);
		}
	}

	unregister(): void {
		this.unregisterFn?.();
		this.unregisterFn = null;
	}
}
