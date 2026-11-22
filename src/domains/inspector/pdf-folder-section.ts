import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../kernel/types.ts';
import { normalizeToRegularItemAsync, resolvePdfAttachments } from '../../services/item-resolution.ts';
import { normalizePanePosition } from '../../services/pane-positioner.ts';
import type { ServiceContainer } from '../../services/service-container.ts';

interface FolderPaneState {
	body: HTMLElement;
	item: any | null;
	btn: HTMLButtonElement;
	meta: HTMLDivElement;
}

type ItemPaneSidenav = Element & { container?: { item?: any } };
const FOLDER_ICON = 'item-pane-sidenav .btn[data-l10n-id="zbf-pane-pdf-folder-sidenav"]';
const FOLDER_ACTION = `${FOLDER_ICON}, button.ztf-pdf-folder-action`;
const RECENT_LAUNCH_INTERVAL_MS = 500;

function folderActionTarget(event: Event): Element | undefined {
	return event.composedPath?.().find((node): node is Element =>
		(node as Element).matches?.(FOLDER_ACTION) === true,
	);
}

export class PdfFolderSectionController {
	private unregisterFn: Disposable | null = null;
	private readonly states = new Map<HTMLElement, FolderPaneState>();
	private readonly listeners = new Map<Document, AbortController>();
	private readonly openingFolders = new WeakSet<Window>();
	private readonly lastLaunched = new Map<string, number>();
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
			onInit: ({ doc, body, item, setEnabled }: { doc?: Document; body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void }) => {
				this.initBody(doc || body.ownerDocument!, body, item, setEnabled);
				this.services.panePositions.observeAndQueue(body);
			},
			onDestroy: ({ doc, body }: { doc?: Document; body: HTMLElement }) => {
				this.onDestroy(doc || body.ownerDocument, body);
			},
			onItemChange: ({ body, item, setEnabled }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void }) => {
				this.updateState(body, item, setEnabled);
				this.services.panePositions.observeAndQueue(body);
				return this.kernel.prefs.get('inspector.pdfFolder.enable') && Boolean(item);
			},
			onRender: ({ body, item, setEnabled }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void }) => {
				this.updateState(body, item, setEnabled);
				this.services.panePositions.observeAndQueue(body);
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

	async revealAttachmentFolder(item: any, fallbackWin?: Window | null): Promise<boolean> {
		if (!item) return false;
		const att = await this.resolveFileAttachment(item);
		if (!att) return false;
		const zotero = (globalThis as any).Zotero;
		try {
			const filePath = (await att.getFilePathAsync?.().catch(() => null)) || att.getFilePath?.();
			const nsFile = filePath ? zotero?.File?.pathToFile?.(filePath) : null;
			const folder = nsFile?.parent?.path;
			const cacheKey = filePath || folder || String(att.id || '');
			if (cacheKey) {
				const now = Date.now();
				if (now - (this.lastLaunched.get(cacheKey) ?? 0) < RECENT_LAUNCH_INTERVAL_MS) return true;
				this.lastLaunched.set(cacheKey, now);
			}
			try {
				const openMode = this.kernel.prefs.get('inspector.pdfFolder.openMode');
				if (openMode === 'folder' && folder && zotero?.launchFile) {
					await zotero.launchFile(folder);
					return true;
				}
				if (nsFile && nsFile.exists?.() !== false && typeof nsFile.reveal === 'function') {
					await Promise.resolve(nsFile.reveal());
					return true;
				}
				const targetWin = (fallbackWin as any)?.ZoteroPane ? fallbackWin : zotero?.getMainWindow?.();
				if ((targetWin as any)?.ZoteroPane?.showAttachmentInFilesystem) {
					await (targetWin as any).ZoteroPane.showAttachmentInFilesystem(att.id);
					return true;
				}
				if (folder && zotero?.launchFile) {
					await zotero.launchFile(folder);
					return true;
				}
			} catch (err) {
				if (cacheKey) this.lastLaunched.delete(cacheKey);
				throw err;
			}
		} catch (error) {
			this.kernel.logger.error('inspector:pdf-folder', error);
		}
		return false;
	}

	unregister(): void {
		this.services.panePositions.setTarget('pdf-folder', null);
		this.lastLaunched.clear();
		for (const controller of this.listeners.values()) controller.abort();
		this.listeners.clear();
		this.unregisterFn?.();
		this.unregisterFn = null;
		this.states.clear();
	}

	private initBody(doc: Document | null, body: HTMLElement, item?: any, setEnabled?: (v: boolean) => void): void {
		const win = doc?.defaultView;
		if (!doc || !win) return;
		(win as any).MozXULElement?.insertFTLIfNeeded?.('zotero-bridgeflow.ftl');
		let controller = this.listeners.get(doc);
		if (!controller) {
			controller = new (win as Window & typeof globalThis).AbortController();
			this.listeners.set(doc, controller);
			this.bindFolderActions(doc, win, controller.signal);
		}

		body.textContent = '';
		const wrap = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLDivElement;
		wrap.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr);gap:6px;min-inline-size:0;contain:inline-size;padding:4px 0;font:12px/1.4 system-ui,sans-serif;';

		const meta = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLDivElement;
		meta.style.cssText = 'opacity:0.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

		const btn = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
		btn.type = 'button';
		btn.className = 'ztf-pdf-folder-action';
		btn.setAttribute('data-l10n-id', 'zbf-pdf-folder-open');
		btn.textContent = '打开文件夹并选中 PDF';
		btn.style.cssText = 'justify-self:start;min-inline-size:0;max-inline-size:100%;box-sizing:border-box;padding:5px 10px;border-radius:5px;border:1px solid color-mix(in srgb,currentColor 20%,transparent);background:transparent;color:inherit;font:inherit;white-space:normal;overflow-wrap:anywhere;text-align:start;cursor:pointer;';
		btn.disabled = true;

		wrap.append(meta, btn);
		body.append(wrap);
		this.states.set(body, { body, item: null, btn, meta });
		this.updateState(body, item, setEnabled);
	}

	private bindFolderActions(doc: Document, win: Window, signal: AbortSignal): void {
		const options = { capture: true, signal };
		let pressed: Element | undefined;
		let keyed: Element | undefined;
		doc.addEventListener('pointerdown', (event: PointerEvent) => {
			keyed = undefined;
			pressed = event.isTrusted && event.button === 0 ? folderActionTarget(event) : undefined;
		}, options);
		doc.addEventListener('pointercancel', () => { pressed = undefined; }, options);
		doc.addEventListener('keydown', (event: KeyboardEvent) => {
			pressed = undefined;
			keyed = event.isTrusted && !event.repeat && (event.key === 'Enter' || event.key === ' ')
				? folderActionTarget(event) : undefined;
		}, options);
		doc.addEventListener('click', (event: MouseEvent) => {
			const target = folderActionTarget(event);
			const activated = target && (event.detail === 0 ? keyed : pressed) === target;
			keyed = pressed = undefined;
			if (!activated || !event.isTrusted || event.button !== 0 || event.detail > 1) return;
			if (!this.kernel.prefs.get('inspector.pdfFolder.enable')) return;

			const sidenav = target.closest('item-pane-sidenav') as ItemPaneSidenav | null;
			const item = sidenav
				? (sidenav.container?.item
					?? [...this.states.values()].find((s) => s.body.ownerDocument === doc && s.item)?.item
					?? (win as any).ZoteroPane?.getSelectedItems?.()?.[0])
				: [...this.states.values()].find((state) => state.btn === target && !state.btn.disabled)?.item;
			if (item && !signal.aborted && !this.openingFolders.has(win)) {
				this.openingFolders.add(win);
				void this.revealAttachmentFolder(item, win).finally(() => this.openingFolders.delete(win));
			}
		}, options);
	}

	private onDestroy(doc: Document | null, body: HTMLElement): void {
		this.states.delete(body);
		if (!doc || [...this.states.keys()].some((other) => other.ownerDocument === doc)) return;
		this.listeners.get(doc)?.abort();
		this.listeners.delete(doc);
	}

	private updateState(body: HTMLElement, item: any, setEnabled?: (v: boolean) => void): void {
		const enabled = this.kernel.prefs.get('inspector.pdfFolder.enable') && Boolean(item);
		setEnabled?.(enabled);
		const st = this.states.get(body);
		if (!st) return;
		st.item = enabled ? item : null;
		void this.refreshMeta(st);
	}

	private async refreshMeta(st: FolderPaneState): Promise<void> {
		const item = st.item;
		st.btn.disabled = true;
		st.btn.style.opacity = '0.5';
		st.meta.textContent = '';
		st.meta.removeAttribute('title');
		st.meta.removeAttribute('data-l10n-id');
		if (!item) return;
		const att = await this.resolveFileAttachment(item).catch(() => null);
		if (this.states.get(st.body) !== st || st.item !== item) return;
		if (!att) {
			st.meta.setAttribute('data-l10n-id', 'zbf-pdf-folder-unavailable');
			st.meta.textContent = '当前条目没有文件附件';
			return;
		}
		st.meta.textContent = String(att.attachmentFilename || att.getField?.('title') || '附件文件');
		st.meta.title = st.meta.textContent;
		st.btn.disabled = false;
		st.btn.style.opacity = '1';
	}

	private async resolveFileAttachment(item: any): Promise<any | null> {
		if (!item) return null;
		if (item.isFileAttachment?.()) return item;
		const best = await item.getBestAttachment?.().catch(() => null);
		if (best?.isFileAttachment?.()) return best;
		const owner = await normalizeToRegularItemAsync(item);
		const pdfs = await resolvePdfAttachments(owner || item);
		return pdfs[0]?.item ?? null;
	}
}
