import type { PluginKernel } from '../../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../../kernel/types.ts';
import { resolveBestFileAttachment, revealItemAttachmentInFilesystem } from '../../../services/item-resolution.ts';
import { normalizePanePosition } from '../../../services/pane-positioner.ts';
import type { ServiceContainer } from '../../../services/service-container.ts';
import { resolveAllPdfAttachments, type PdfAttachmentEntry } from './pdf-renderer.ts';

export function displayAttachmentName(raw: string): string {
	return raw.replace(/(?:%[a-f\d]{2})+/gi, (encoded) => {
		try { return decodeURIComponent(encoded); } catch { return encoded; }
	});
}

interface FolderPaneState {
	body: HTMLElement;
	controller: AbortController;
	refreshRevision: number;
	refreshPending?: boolean;
	lastEnabled?: boolean;
	lastAttKey?: string;
	lastRefreshedAt?: number;
	item: any | null;
	selectedAttachment: any | null;
	entries: PdfAttachmentEntry[];
	selectEl: HTMLSelectElement;
	btn: HTMLButtonElement;
	meta: HTMLDivElement;
	setSectionSummary?: (summary: string) => void;
}

type ItemPaneSidenav = Element & { container?: { item?: any } };
const FOLDER_ICON = 'item-pane-sidenav .btn[data-l10n-id="zbf-pane-pdf-folder-sidenav"]';

function folderActionTarget(event: Event): Element | undefined {
	return event.composedPath?.().find((node): node is Element =>
		(node as Element).matches?.(FOLDER_ICON) === true,
	);
}

export class PdfFolderSectionController {
	private unregisterFn: Disposable | null = null;
	private readonly states = new Map<HTMLElement, FolderPaneState>();
	private readonly listeners = new Map<Document, AbortController>();
	private readonly openingFolders = new WeakSet<Window>();

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
			onInit: ({ doc, body, item, setEnabled, setSectionSummary }: { doc?: Document; body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void; setSectionSummary?: (s: string) => void }) => {
				this.initBody(doc || body.ownerDocument!, body, item, setEnabled, setSectionSummary);
				this.services.panePositions.observeAndQueue(body);
			},
			onDestroy: ({ doc, body }: { doc?: Document; body: HTMLElement }) => {
				this.onDestroy(doc || body.ownerDocument, body);
			},
			onItemChange: ({ body, item, setEnabled, setSectionSummary }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void; setSectionSummary?: (s: string) => void }) => {
				this.updateState(body, item, setEnabled, setSectionSummary);
				this.services.panePositions.observeAndQueue(body);
				return this.kernel.prefs.get('inspector.pdfFolder.enable') && Boolean(item);
			},
			onRender: ({ body, item, setEnabled, setSectionSummary }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void; setSectionSummary?: (s: string) => void }) => {
				this.updateState(body, item, setEnabled, setSectionSummary);
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
		return revealItemAttachmentInFilesystem(item, {
			openMode: this.kernel.prefs.get('inspector.pdfFolder.openMode'),
			win: fallbackWin,
		});
	}

	unregister(): void {
		this.services.panePositions.setTarget('pdf-folder', null);
		for (const state of this.states.values()) state.controller.abort();
		for (const controller of this.listeners.values()) controller.abort();
		this.listeners.clear();
		this.unregisterFn?.();
		this.unregisterFn = null;
		this.states.clear();
	}

	private initBody(doc: Document | null, body: HTMLElement, item?: any, setEnabled?: (v: boolean) => void, setSectionSummary?: (s: string) => void): void {
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

		const selectEl = doc.createElementNS('http://www.w3.org/1999/xhtml', 'select') as HTMLSelectElement;
		selectEl.className = 'ztf-pdf-folder-select';
		selectEl.style.cssText = 'display:none;min-inline-size:0;inline-size:100%;block-size:22px;padding:0 6px;border-radius:4px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:transparent;color:inherit;font:500 11px/1.2 system-ui,sans-serif;cursor:pointer;';

		const meta = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLDivElement;
		meta.style.cssText = 'display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere;';

		const btn = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
		btn.type = 'button';
		btn.className = 'ztf-pdf-folder-action';
		btn.setAttribute('data-l10n-id', 'zbf-pdf-folder-open');
		btn.textContent = '打开文件夹并选中 PDF';
		btn.style.cssText = 'justify-self:start;min-inline-size:0;max-inline-size:100%;box-sizing:border-box;padding:5px 10px;border-radius:5px;border:1px solid color-mix(in srgb,currentColor 20%,transparent);background:transparent;color:inherit;font:inherit;white-space:normal;overflow-wrap:anywhere;text-align:start;cursor:pointer;';
		btn.disabled = true;

		this.states.get(body)?.controller.abort();
		const panelController = new win.AbortController();
		const st: FolderPaneState = { body, controller: panelController, refreshRevision: 0, item: null, selectedAttachment: null, entries: [], selectEl, btn, meta, setSectionSummary };
		btn.addEventListener('click', () => {
			if (!btn.disabled) this.openFolder(st.selectedAttachment, win);
		}, { signal: panelController.signal });
		selectEl.addEventListener('change', () => {
			const hit = st.entries.find((e) => String(e.id) === selectEl.value);
			if (hit) {
				st.selectedAttachment = hit.attachment;
				st.meta.textContent = displayAttachmentName(String(hit.attachment?.attachmentFilename || hit.title || '附件文件'));
				st.meta.title = st.meta.textContent;
				st.setSectionSummary?.(st.entries.length > 1 ? `${st.entries.length} · ${st.meta.textContent}` : st.meta.textContent);
				try {
					const CustomEv = (win as any)?.CustomEvent || CustomEvent;
					doc.dispatchEvent?.(new CustomEv('zbf:pdf-folder-attachment-selected', {
						detail: { attachmentID: hit.id, owner: body.closest?.('item-details') || null },
					}));
				} catch { /* ignore */ }
			}
		}, { signal: panelController.signal });
		doc.addEventListener('zbf:pdf-attachment-selected', ((ev: CustomEvent) => {
			const owner = body.closest?.('item-details') || null;
			if (ev?.detail?.owner && owner && ev.detail.owner !== owner) return;
			const attID = Number(ev?.detail?.attachmentID || 0);
			if (!attID || !st.entries.length) return;
			const hit = st.entries.find((e) => e.id === attID);
			if (hit && st.selectedAttachment !== hit.attachment) {
				st.selectedAttachment = hit.attachment;
				st.selectEl.value = String(hit.id);
				st.meta.textContent = displayAttachmentName(String(hit.attachment?.attachmentFilename || hit.title || '附件文件'));
				st.meta.title = st.meta.textContent;
			}
		}) as EventListener, { signal: panelController.signal });

		wrap.append(selectEl, meta, btn);
		body.append(wrap);
		this.states.set(body, st);
		this.updateState(body, item, setEnabled, setSectionSummary);
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
			const activated = target && (!event.isTrusted || (event.detail === 0 ? keyed : pressed) === target);
			keyed = pressed = undefined;
			if (!activated || event.button !== 0 || event.detail > 1) return;
			if (!this.kernel.prefs.get('inspector.pdfFolder.enable')) return;

			const sidenav = target.closest('item-pane-sidenav') as ItemPaneSidenav | null;
			const item = sidenav?.container?.item ?? (win as any).ZoteroPane?.getSelectedItems?.()?.[0];
			const state = [...this.states.values()].find((s) => s.body.ownerDocument === doc && s.item === item);
			this.openFolder(state?.selectedAttachment ?? item, win);
		}, options);
	}

	private openFolder(item: any, win: Window): void {
		if (!item || this.openingFolders.has(win) || !this.kernel.prefs.get('inspector.pdfFolder.enable')) return;
		this.openingFolders.add(win);
		void this.revealAttachmentFolder(item, win)
			.then((ok) => {
				if (ok) return;
				const zh = Boolean((globalThis as any).Zotero?.locale?.startsWith?.('zh'));
				for (const st of this.states.values()) {
					if (st.body.ownerDocument === win.document && (st.selectedAttachment === item || st.item === item)) {
						st.meta.textContent = zh ? '未找到本地附件文件（可能尚未下载或已被移动）' : 'Local attachment file not found (may not be synced locally)';
						st.meta.title = st.meta.textContent;
					}
				}
			})
			.catch((error) => this.kernel.logger.error('pdf-folder', error))
			.finally(() => this.openingFolders.delete(win));
	}

	private onDestroy(doc: Document | null, body: HTMLElement): void {
		this.states.get(body)?.controller.abort();
		this.states.delete(body);
		if (!doc || [...this.states.keys()].some((other) => other.ownerDocument === doc)) return;
		this.listeners.get(doc)?.abort();
		this.listeners.delete(doc);
	}

	private updateState(body: HTMLElement, item: any, setEnabled?: (v: boolean) => void, setSectionSummary?: (s: string) => void): void {
		const enabled = this.kernel.prefs.get('inspector.pdfFolder.enable') && Boolean(item);
		setEnabled?.(enabled);
		const st = this.states.get(body);
		if (!st) return;
		if (setSectionSummary) st.setSectionSummary = setSectionSummary;
		if (!enabled) st.setSectionSummary?.('');
		const targetItem = enabled ? item : null;
		const attKey = targetItem ? String((targetItem.parentItem?.getAttachments?.() || targetItem.getAttachments?.() || []).join(',')) : '';
		const now = Date.now();
		if (
			st.lastEnabled === enabled &&
			st.item === targetItem &&
			st.lastAttKey === attKey &&
			(st.refreshPending || !targetItem || (st.lastRefreshedAt && now - st.lastRefreshedAt < 1500))
		) {
			st.btn.disabled = !st.selectedAttachment;
			return;
		}
		const previousID = st.item === item ? st.selectedAttachment?.id : null;
		st.lastEnabled = enabled;
		st.lastAttKey = attKey;
		st.item = targetItem;
		st.refreshPending = true;
		const revision = ++st.refreshRevision;
		st.btn.disabled = true;
		void Promise.resolve().then(() => {
			if (this.states.get(body) === st && revision === st.refreshRevision) {
				st.refreshPending = false;
				st.lastRefreshedAt = Date.now();
				void this.refreshMeta(st, revision, previousID);
			}
		});
	}

	private async refreshMeta(st: FolderPaneState, revision: number, previousID: unknown): Promise<void> {
		const item = st.item;
		st.btn.disabled = true;
		st.btn.style.opacity = '0.5';
		st.selectEl.style.display = 'none';
		st.selectEl.textContent = '';
		st.entries = [];
		st.selectedAttachment = null;
		st.meta.textContent = '';
		st.meta.removeAttribute('title');
		st.meta.removeAttribute('data-l10n-id');
		if (!item) return;
		const entries = await resolveAllPdfAttachments(item).catch(() => []);
		const att = entries[0]?.attachment || await this.resolveFileAttachment(item).catch(() => null);
		if (this.states.get(st.body) !== st || st.refreshRevision !== revision) return;
		if (!att) {
			st.meta.setAttribute('data-l10n-id', 'zbf-pdf-folder-unavailable');
			st.meta.textContent = '当前条目没有文件附件';
			return;
		}
		st.entries = entries;
		const doc = st.body.ownerDocument;
		if (doc && entries.length > 1) {
			entries.forEach((entry, idx) => {
				const opt = doc.createElementNS('http://www.w3.org/1999/xhtml', 'option') as HTMLOptionElement;
				opt.value = String(entry.id);
				const compact = displayAttachmentName(entry.shortLabel || entry.title);
				opt.textContent = `${idx + 1}. ${compact}`;
				opt.title = `${idx + 1}. ${displayAttachmentName(entry.fullTitle || entry.title)}`;
				st.selectEl.append(opt);
			});
			const directID = Number(item?.id) || 0;
			const initial = entries.find((e) => e.id === previousID) || entries.find((e) => e.id === directID) || entries[0];
			const initIdx = Math.max(0, entries.findIndex((e) => e.id === initial.id));
			st.selectedAttachment = initial.attachment;
			st.selectEl.value = String(initial.id);
			st.selectEl.title = `${initIdx + 1}. ${displayAttachmentName(initial.fullTitle || initial.title)}`;
			st.selectEl.style.display = 'block';
		} else {
			st.selectedAttachment = att;
		}
		const activeAtt = st.selectedAttachment || att;
		st.meta.textContent = displayAttachmentName(String(activeAtt.attachmentFilename || activeAtt.getField?.('title') || '附件文件'));
		st.meta.title = st.meta.textContent;
		st.setSectionSummary?.(st.entries.length > 1 ? `${st.entries.length} · ${st.meta.textContent}` : st.meta.textContent);
		st.btn.disabled = false;
		st.btn.style.opacity = '1';
	}

	private async resolveFileAttachment(item: any): Promise<any | null> {
		return resolveBestFileAttachment(item);
	}
}
