import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../kernel/types.ts';
import { deduplicateRegularItems } from '../../services/item-resolution.ts';
import type { ServiceContainer } from '../../services/service-container.ts';

interface PreviewPaneState {
	body: HTMLElement;
	items: any[];
	generation: number;
}

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
			header: { l10nID: 'zbf-pane-csl-preview-title', icon },
			sidenav: { l10nID: 'zbf-pane-csl-preview-title', icon, orderable: true },
			onInit: ({ body }: { body: HTMLElement }) => {
				this.states.set(body, { body, items: [], generation: 0 });
			},
			onDestroy: ({ body }: { body: HTMLElement }) => {
				this.states.delete(body);
			},
			onItemChange: ({ body, item }: { body: HTMLElement; item?: any }) => {
				const st = this.states.get(body);
				if (!st) return false;
				const maxItems = this.kernel.prefs.get('inspector.cslPreview.maxPreviewItems');
				const { items } = deduplicateRegularItems(item ? [item] : [], maxItems);
				st.items = items;
				return items.length > 0;
			},
			onAsyncRender: async ({ body }: { body: HTMLElement }) => {
				await this.renderState(body);
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
		const fontSize = `${this.kernel.prefs.get('inspector.cslPreview.fontsize')}em`;
		const lineHeight = String(this.kernel.prefs.get('inspector.cslPreview.spacing'));

		if (citeRes?.text) {
			body.append(this.buildBlock(doc, 'In-Text', citeRes.text, fontSize, lineHeight, true, st.items));
		}
		if (bibRes?.text) {
			body.append(this.buildBlock(doc, 'Bibliography', bibRes.text, fontSize, lineHeight, false, st.items));
		}
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
		wrap.style.fontSize = fontSize;
		wrap.style.lineHeight = lineHeight;

		const content = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
		content.className = 'zbf-csl-text';
		content.textContent = text;
		wrap.append(content);

		const copyBtn = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
		copyBtn.type = 'button';
		copyBtn.className = 'zbf-csl-copy-btn';
		copyBtn.textContent = `Copy ${label}`;
		copyBtn.addEventListener('click', () => {
			void this.services.clipboard.copyItems(items, { asCitation, source: 'preview' });
		});
		wrap.append(copyBtn);
		return wrap;
	}
}
