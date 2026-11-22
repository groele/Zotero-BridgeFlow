import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../kernel/types.ts';
import { normalizeToRegularItemAsync, resolvePdfAttachments } from '../../services/item-resolution.ts';
import type { ServiceContainer } from '../../services/service-container.ts';

export class PdfFolderSectionController {
	private unregisterFn: Disposable | null = null;

	private readonly kernel: PluginKernel;
	private readonly services: ServiceContainer;

	constructor(kernel: PluginKernel, services: ServiceContainer) {
		this.kernel = kernel;
		this.services = services;
	}

	register(): void {
		if (this.unregisterFn) return;
		const icon = `${this.kernel.info.rootURI}assets/pdf-folder.svg`;
		this.unregisterFn = this.services.itemPanes.register({
			paneID: 'bridgeflow-pdf-folder',
			pluginID: this.kernel.info.id,
			header: { l10nID: 'zbf-pane-pdf-folder-title', icon },
			sidenav: { l10nID: 'zbf-pane-pdf-folder-title', icon, orderable: true },
			onItemChange: ({ item }: { item?: any }) => Boolean(item),
			onToggle: ({ item }: { item?: any }) => {
				if (item) void this.revealAttachmentFolder(item);
			},
		});
	}

	async revealAttachmentFolder(item: any): Promise<boolean> {
		const owner = await normalizeToRegularItemAsync(item);
		const pdfs = await resolvePdfAttachments(owner || item);
		const first = pdfs[0]?.item;
		if (!first) return false;
		try {
			const filePath = typeof first.getFilePathAsync === 'function'
				? await first.getFilePathAsync()
				: first.getFilePath?.();
			if (!filePath) return false;
			const zFile = (globalThis as any).Zotero?.File;
			const mode = this.kernel.prefs.get('inspector.pdfFolder.openMode');
			if (mode === 'folder' && typeof zFile?.pathToFile === 'function') {
				const f = zFile.pathToFile(filePath);
				f?.parent?.launch?.();
				return true;
			}
			const win = (globalThis as any).Zotero?.getMainWindow?.();
			win?.ZoteroPane?.showAttachmentInFilesystem?.(first.id);
			return true;
		} catch {
			return false;
		}
	}

	unregister(): void {
		this.unregisterFn?.();
		this.unregisterFn = null;
	}
}
