import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../kernel/types.ts';
import { normalizeToRegularItemAsync, resolvePdfAttachments } from '../../services/item-resolution.ts';
import { normalizePanePosition } from '../../services/pane-positioner.ts';
import type { ServiceContainer } from '../../services/service-container.ts';

interface FolderPaneState {
	body: HTMLElement;
	item: any | null;
	btn: HTMLButtonElement;
	meta: HTMLElement;
}

export class PdfFolderSectionController {
	private unregisterFn: Disposable | null = null;
	private readonly states = new Map<HTMLElement, FolderPaneState>();
	private readonly kernel: PluginKernel;
	private readonly services: ServiceContainer;

	constructor(kernel: PluginKernel, services: ServiceContainer) {
		this.kernel = kernel;
		this.services = services;
	}

	register(): void {
		if (this.unregisterFn) return;
		const icon = `${this.kernel.info.rootURI}assets/pdf-folder.svg`;
		const reg = this.services.itemPanes.register({
			paneID: 'bridgeflow-pdf-folder',
			pluginID: this.kernel.info.id,
			header: { l10nID: 'zbf-pane-pdf-folder-header', icon },
			sidenav: { l10nID: 'zbf-pane-pdf-folder-sidenav', icon, orderable: true },
			onInit: ({ body, item, setEnabled }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void }) => {
				this.initBody(body, item, setEnabled);
				this.services.panePositions.observeAndQueue(body);
			},
			onDestroy: ({ body }: { body: HTMLElement }) => {
				this.states.delete(body);
			},
			onItemChange: ({ body, item, setEnabled }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void }) => {
				this.updateState(body, item, setEnabled);
				this.services.panePositions.observeAndQueue(body);
				return Boolean(item);
			},
			onRender: ({ body, item, setEnabled }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void }) => {
				this.updateState(body, item, setEnabled);
				this.services.panePositions.observeAndQueue(body);
			},
			onToggle: ({ body, item }: { body: HTMLElement; item?: any }) => {
				const target = item ?? this.states.get(body)?.item;
				if (target) void this.revealAttachmentFolder(target);
			},
		});
		this.unregisterFn = reg.dispose;
		if (reg.sectionID) {
			this.services.panePositions.setTarget('pdf-folder', {
				sectionID: reg.sectionID,
				getPosition: () => normalizePanePosition(this.kernel.prefs.get('inspector.pdfFolder.position'), 'zotero-editpane-related'),
			});
		}
	}

	async revealAttachmentFolder(item: any): Promise<boolean> {
		if (!item) return false;
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
		this.services.panePositions.setTarget('pdf-folder', null);
		this.unregisterFn?.();
		this.unregisterFn = null;
		this.states.clear();
	}

	private initBody(body: HTMLElement, item?: any, setEnabled?: (v: boolean) => void): void {
		const doc = body.ownerDocument;
		if (!doc) return;
		doc.defaultView?.MozXULElement?.insertFTLIfNeeded?.('zotero-bridgeflow.ftl');
		body.textContent = '';

		const wrap = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
		wrap.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr);gap:6px;padding:4px 0;font:12px/1.4 system-ui,sans-serif;';

		const meta = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
		meta.style.cssText = 'opacity:0.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

		const btn = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
		btn.type = 'button';
		btn.setAttribute('data-l10n-id', 'zbf-pane-pdf-folder-header');
		btn.textContent = 'Open PDF Folder';
		btn.style.cssText = 'justify-self:start;padding:5px 10px;border-radius:5px;border:1px solid color-mix(in srgb,currentColor 20%,transparent);background:transparent;color:inherit;font:inherit;cursor:pointer;';

		btn.addEventListener('click', () => {
			const st = this.states.get(body);
			if (st?.item) void this.revealAttachmentFolder(st.item);
		});

		wrap.append(meta, btn);
		body.append(wrap);
		this.states.set(body, { body, item: item ?? null, btn, meta });
		this.updateState(body, item, setEnabled);
	}

	private updateState(body: HTMLElement, item: any, setEnabled?: (v: boolean) => void): void {
		const st = this.states.get(body);
		if (!st) return;
		st.item = item ?? null;
		const enabled = Boolean(item);
		st.btn.disabled = !enabled;
		st.meta.textContent = item ? String(item.getField?.('title') || item.attachmentFilename || '') : '';
		setEnabled?.(enabled);
	}
}
