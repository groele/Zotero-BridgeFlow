import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../kernel/types.ts';
import type { ServiceContainer } from '../../services/service-container.ts';
import type { CitationLookupEngine, LookupCandidate } from './citation-lookup-engine.ts';

const LOOKUP_CSS = `
.zbf-lookup-root { display:flex; flex-direction:column; gap:6px; padding:4px 0; font:12px/1.45 system-ui,sans-serif; }
.zbf-lookup-input { width:100%; box-sizing:border-box; padding:5px 8px; border-radius:5px; border:1px solid color-mix(in srgb,currentColor 20%,transparent); background:var(--material-background,transparent); color:inherit; font:inherit; }
.zbf-lookup-actions { display:flex; gap:6px; }
.zbf-lookup-btn { padding:4px 8px; border-radius:5px; border:1px solid color-mix(in srgb,currentColor 20%,transparent); background:transparent; color:inherit; font:inherit; cursor:pointer; }
.zbf-lookup-btn:hover { background:color-mix(in srgb,currentColor 8%,transparent); }
.zbf-lookup-status { font-size:11px; opacity:0.75; }
.zbf-lookup-results { display:flex; flex-direction:column; gap:4px; }
.zbf-lookup-hit { text-align:left; padding:5px 8px; border-radius:5px; border:1px solid color-mix(in srgb,currentColor 14%,transparent); background:color-mix(in srgb,currentColor 3%,transparent); color:inherit; font:inherit; cursor:pointer; }
.zbf-lookup-hit:hover { border-color:var(--accent-blue,#2563EB); background:color-mix(in srgb,var(--accent-blue,#2563EB) 10%,transparent); }
`;

export class CitationLookupSectionController {
	private unregisterFn: Disposable | null = null;
	private readonly kernel: PluginKernel;
	private readonly services: ServiceContainer;
	private readonly engine: CitationLookupEngine;

	constructor(kernel: PluginKernel, services: ServiceContainer, engine: CitationLookupEngine) {
		this.kernel = kernel;
		this.services = services;
		this.engine = engine;
	}

	register(): void {
		if (this.unregisterFn) return;
		const icon = `${this.kernel.info.rootURI}assets/lookup.svg`;
		this.unregisterFn = this.services.itemPanes.register({
			paneID: 'bridgeflow-citation-lookup',
			pluginID: this.kernel.info.id,
			header: { l10nID: 'zbf-pane-lookup-header', icon },
			sidenav: { l10nID: 'zbf-pane-lookup-sidenav', icon, orderable: true },
			onInit: ({ body, setEnabled }: { body: HTMLElement; setEnabled?: (v: boolean) => void }) => {
				setEnabled?.(true);
				this.mountUI(body);
			},
			onItemChange: ({ setEnabled }: { setEnabled?: (v: boolean) => void }) => {
				setEnabled?.(true);
				return true;
			},
			onRender: ({ setEnabled }: { setEnabled?: (v: boolean) => void }) => {
				setEnabled?.(true);
			},
		});
	}

	unregister(): void {
		this.unregisterFn?.();
		this.unregisterFn = null;
	}

	private mountUI(body: HTMLElement): void {
		const doc = body.ownerDocument;
		if (!doc) return;
		doc.defaultView?.MozXULElement?.insertFTLIfNeeded?.('zotero-bridgeflow.ftl');
		if (!doc.getElementById('zbf-lookup-style')) {
			const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style') as HTMLStyleElement;
			style.id = 'zbf-lookup-style';
			style.textContent = LOOKUP_CSS;
			doc.documentElement?.append(style);
		}

		body.textContent = '';
		const root = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
		root.className = 'zbf-lookup-root';

		const input = doc.createElementNS('http://www.w3.org/1999/xhtml', 'input') as HTMLInputElement;
		input.type = 'text';
		input.className = 'zbf-lookup-input';
		input.placeholder = 'DOI / Compact citation...';

		const actions = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
		actions.className = 'zbf-lookup-actions';

		const searchBtn = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
		searchBtn.type = 'button';
		searchBtn.className = 'zbf-lookup-btn';
		searchBtn.textContent = 'Lookup';

		const clipBtn = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
		clipBtn.type = 'button';
		clipBtn.className = 'zbf-lookup-btn';
		clipBtn.textContent = 'Clipboard';
		actions.append(searchBtn, clipBtn);

		const status = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
		status.className = 'zbf-lookup-status';
		status.textContent = `History cache: ${this.services.history.count}`;

		const list = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
		list.className = 'zbf-lookup-results';

		const runLookup = async (query: string): Promise<void> => {
			status.textContent = 'Searching...';
			const hits = await this.engine.lookup(query);
			status.textContent = hits.length ? `Matched ${hits.length} item(s)` : 'No matching item found';
			this.renderHits(doc, list, hits);
		};

		input.addEventListener('keydown', (ev: KeyboardEvent) => {
			if (ev.key === 'Enter') void runLookup(input.value);
		});
		searchBtn.addEventListener('click', () => { void runLookup(input.value); });
		clipBtn.addEventListener('click', () => {
			const clip = this.readClipboardText();
			if (clip) {
				input.value = clip;
				void runLookup(clip);
			} else {
				status.textContent = 'Clipboard is empty';
			}
		});

		root.append(input, actions, status, list);
		body.append(root);
	}

	private readClipboardText(): string {
		try {
			const text = (globalThis as any).Zotero?.Utilities?.Internal?.getClipboardText?.();
			return String(text || '').trim();
		} catch {
			return '';
		}
	}

	private renderHits(doc: Document, container: HTMLElement, hits: readonly LookupCandidate[]): void {
		container.textContent = '';
		for (const hit of hits) {
			const row = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
			row.type = 'button';
			row.className = 'zbf-lookup-hit';
			row.textContent = `${hit.title} (${hit.score}% · ${hit.source})`;
			row.addEventListener('click', () => {
				this.kernel.bus.emit('workspace:open-item-request', {
					itemID: hit.itemID,
					preferExistingTab: this.kernel.prefs.get('fusion.lookupJumpExistingTab'),
					assignToActiveGroup: true,
				});
			});
			container.append(row);
		}
	}
}
