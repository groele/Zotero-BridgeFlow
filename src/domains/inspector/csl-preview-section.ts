import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../kernel/types.ts';
import { deduplicateRegularItems } from '../../services/item-resolution.ts';
import type { ServiceContainer } from '../../services/service-container.ts';

interface PreviewPaneState {
	body: HTMLElement;
	items: any[];
	generation: number;
	setEnabled?: (enabled: boolean) => void;
}

const CSL_CSS = `
.zbf-csl-root { display:flex; flex-direction:column; gap:8px; padding:4px 0; font:12px/1.5 system-ui,sans-serif; color:var(--fill-primary,currentColor); }
.zbf-csl-block { border:1px solid color-mix(in srgb,currentColor 14%,transparent); border-radius:6px; padding:8px; background:color-mix(in srgb,currentColor 2%,transparent); }
.zbf-csl-head { display:flex; align-items:center; justify-content:space-between; gap:6px; margin-bottom:4px; font-size:11px; opacity:0.78; font-weight:600; }
.zbf-csl-text { user-select:text; overflow-wrap:anywhere; }
.zbf-csl-copy-btn { padding:2px 8px; border-radius:4px; border:1px solid color-mix(in srgb,currentColor 20%,transparent); background:transparent; color:inherit; font:inherit; cursor:pointer; }
.zbf-csl-copy-btn:hover { background:color-mix(in srgb,currentColor 8%,transparent); }
`;

export class CslPreviewSectionController {
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
		this.unregisterFn = this.services.itemPanes.register({
			paneID: 'bridgeflow-csl-preview',
			pluginID: this.kernel.info.id,
			header: { l10nID: 'zbf-pane-csl-preview-header', icon },
			sidenav: { l10nID: 'zbf-pane-csl-preview-sidenav', icon, orderable: true },
			onInit: ({ body, item, setEnabled }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void }) => {
				const doc = body.ownerDocument;
				doc?.defaultView?.MozXULElement?.insertFTLIfNeeded?.('zotero-bridgeflow.ftl');
				this.ensureStyle(doc);
				const st: PreviewPaneState = { body, items: [], generation: 0, setEnabled };
				this.states.set(body, st);
				this.updateItems(st, item, setEnabled);
			},
			onDestroy: ({ body }: { body: HTMLElement }) => {
				this.states.delete(body);
			},
			onItemChange: ({ body, item, setEnabled }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void }) => {
				const st = this.states.get(body);
				if (!st) return false;
				return this.updateItems(st, item, setEnabled);
			},
			onRender: ({ body, item, setEnabled }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void }) => {
				const st = this.states.get(body);
				if (!st) return;
				this.updateItems(st, item, setEnabled);
				void this.renderState(body);
			},
			onAsyncRender: async ({ body }: { body: HTMLElement }) => {
				await this.renderState(body);
			},
			onToggle: ({ body }: { body: HTMLElement }) => {
				void this.renderState(body);
			},
		});
	}

	async renderState(body: HTMLElement): Promise<void> {
		const st = this.states.get(body);
		if (!st) return;
		const gen = ++st.generation;
		const doc = body.ownerDocument;
		if (!doc) return;

		if (!st.items.length) {
			body.textContent = '';
			return;
		}

		const mode = this.kernel.prefs.get('inspector.cslPreview.whatToShow');
		const wantCite = mode === 'zpboth' || mode === 'zpcite';
		const wantBib = mode === 'zpboth' || mode === 'zpbib';

		const [citeRes, bibRes] = await Promise.all([
			wantCite ? this.services.csl.formatItems(st.items, { asCitation: true }) : Promise.resolve(null),
			wantBib ? this.services.csl.formatItems(st.items, { asCitation: false }) : Promise.resolve(null),
		]);
		if (gen !== st.generation) return;

		body.textContent = '';
		const root = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
		root.className = 'zbf-csl-root';
		const fontSize = `${this.kernel.prefs.get('inspector.cslPreview.fontsize')}em`;
		const lineHeight = String(this.kernel.prefs.get('inspector.cslPreview.spacing'));

		if (citeRes?.text) {
			root.append(this.buildBlock(doc, 'In-Text', citeRes.text, fontSize, lineHeight, true, st.items));
		}
		if (bibRes?.text) {
			root.append(this.buildBlock(doc, 'Bibliography', bibRes.text, fontSize, lineHeight, false, st.items));
		}
		body.append(root);
	}

	async refreshAll(): Promise<void> {
		for (const body of this.states.keys()) {
			await this.renderState(body);
		}
	}

	unregister(): void {
		this.unregisterFn?.();
		this.unregisterFn = null;
		this.states.clear();
	}

	private updateItems(st: PreviewPaneState, item: any, setEnabled?: (v: boolean) => void): boolean {
		const maxItems = this.kernel.prefs.get('inspector.cslPreview.maxPreviewItems');
		const selected = item ? [item] : ((globalThis as any).Zotero?.getMainWindow?.()?.ZoteroPane?.getSelectedItems?.() || []);
		const { items } = deduplicateRegularItems(selected, maxItems);
		st.items = items;
		const enabled = items.length > 0;
		(setEnabled || st.setEnabled)?.(enabled);
		return enabled;
	}

	private ensureStyle(doc: Document | null): void {
		if (!doc || doc.getElementById('zbf-csl-preview-style')) return;
		const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style') as HTMLStyleElement;
		style.id = 'zbf-csl-preview-style';
		style.textContent = CSL_CSS;
		doc.documentElement?.append(style);
	}

	private buildBlock(
		doc: Document,
		label: string,
		text: string,
		fontSize: string,
		lineHeight: string,
		asCitation: boolean,
		items: any[],
	): HTMLElement {
		const wrap = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
		wrap.className = 'zbf-csl-block';

		const head = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
		head.className = 'zbf-csl-head';
		const title = doc.createElementNS('http://www.w3.org/1999/xhtml', 'span') as HTMLElement;
		title.textContent = label;

		const copyBtn = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
		copyBtn.type = 'button';
		copyBtn.className = 'zbf-csl-copy-btn';
		copyBtn.textContent = `Copy`;
		copyBtn.addEventListener('click', async () => {
			const ok = await this.services.clipboard.copyItems(items, { asCitation, source: 'preview' });
			if (ok) {
				copyBtn.textContent = 'Copied ✓';
				setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
			}
		});
		head.append(title, copyBtn);

		const content = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
		content.className = 'zbf-csl-text';
		content.style.fontSize = fontSize;
		content.style.lineHeight = lineHeight;
		content.textContent = text;

		wrap.append(head, content);
		return wrap;
	}
}
