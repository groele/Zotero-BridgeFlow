import type { PluginKernel } from '../kernel/plugin-kernel.ts';
import { CitationHistoryStore } from './citation-history-store.ts';
import { UnifiedClipboardService } from './clipboard-service.ts';
import { CslFormattingEngine } from './csl-engine.ts';
import { ItemPaneRegistryService } from './item-pane-registry.ts';
import { Win32BridgeService } from './win32-bridge.ts';

export class ServiceContainer {
	public readonly csl: CslFormattingEngine;
	public readonly clipboard: UnifiedClipboardService;
	public readonly history: CitationHistoryStore;
	public readonly itemPanes: ItemPaneRegistryService;
	public readonly win32: Win32BridgeService;

	private readonly kernel: PluginKernel;

	constructor(kernel: PluginKernel) {
		this.kernel = kernel;
		this.csl = new CslFormattingEngine(kernel.prefs);
		this.clipboard = new UnifiedClipboardService(this.csl, kernel.bus);
		this.history = new CitationHistoryStore();
		this.itemPanes = new ItemPaneRegistryService();
		this.win32 = new Win32BridgeService();
	}

	async init(): Promise<void> {
		this.syncHistoryConfig();
		await this.history.init();

		this.kernel.disposables.add(
			this.kernel.notifier.subscribe(['item'], (ev) => {
				const ids = ev.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0);
				if (ids.length) this.csl.invalidateItems(ids);
			}),
		);

		this.kernel.disposables.add(
			this.kernel.prefs.observeKeys(
				['inspector.lookup.cacheDirectory', 'inspector.lookup.cacheMaxEntries', 'inspector.lookup.cacheTtlDays'],
				() => this.syncHistoryConfig(),
			),
		);

		this.kernel.disposables.add(
			this.kernel.bus.on('inspector:clear-cache', ({ target }) => {
				if (target === 'memory' || target === 'all') this.csl.clearCache();
				if (target === 'disk' || target === 'all') this.history.clear();
			}),
		);
	}

	syncHistoryConfig(): void {
		this.history.configure({
			customDir: this.kernel.prefs.get('inspector.lookup.cacheDirectory'),
			maxEntries: this.kernel.prefs.get('inspector.lookup.cacheMaxEntries'),
			ttlDays: this.kernel.prefs.get('inspector.lookup.cacheTtlDays'),
		});
	}

	dispose(): void {
		this.itemPanes.unregisterAll();
		this.history.dispose();
		this.csl.clearCache();
		this.win32.dispose();
	}
}
