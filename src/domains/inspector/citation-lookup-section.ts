import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../kernel/types.ts';
import type { ServiceContainer } from '../../services/service-container.ts';
import type { CitationLookupEngine, LookupCandidate } from './citation-lookup-engine.ts';

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
		const icon = `${this.kernel.info.rootURI}assets/view.svg`;
		this.unregisterFn = this.services.itemPanes.register({
			paneID: 'bridgeflow-citation-lookup',
			pluginID: this.kernel.info.id,
			header: { l10nID: 'zbf-pane-lookup-title', icon },
			sidenav: { l10nID: 'zbf-pane-lookup-title', icon, orderable: true },
			onInit: ({ body }: { body: HTMLElement }) => this.mountUI(body),
			onItemChange: () => true,
		});
	}

	unregister(): void {
		this.unregisterFn?.();
		this.unregisterFn = null;
	}

	private mountUI(body: HTMLElement): void {
		const doc = body.ownerDocument;
		if (!doc) return;
		body.textContent = '';

		const input = doc.createElementNS('http://www.w3.org/1999/xhtml', 'input') as HTMLInputElement;
		input.type = 'text';
		input.className = 'zbf-lookup-input';
		input.placeholder = 'DOI / Compact citation...';

		const list = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
		list.className = 'zbf-lookup-results';

		const runLookup = async (query: string): Promise<void> => {
			const hits = await this.engine.lookup(query);
			this.renderHits(doc, list, hits);
		};

		input.addEventListener('keydown', (ev: KeyboardEvent) => {
			if (ev.key === 'Enter') void runLookup(input.value);
		});

		body.append(input, list);
	}

	private renderHits(doc: Document, container: HTMLElement, hits: readonly LookupCandidate[]): void {
		container.textContent = '';
		for (const hit of hits) {
			const row = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
			row.type = 'button';
			row.className = 'zbf-lookup-hit';
			row.textContent = `${hit.title} (${hit.score}%)`;
			row.addEventListener('click', () => {
				// Emit cross-domain request so LookupWorkspaceBridge jumps to existing tab or opens & groups
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
