import type { PluginKernel } from '../kernel/plugin-kernel.ts';
import { CitationHistoryStore } from './citation-history-store.ts';
import { UnifiedClipboardService } from './clipboard-service.ts';
import { CslFormattingEngine } from './csl-engine.ts';
import { invalidateResolvedItemCache } from './item-resolution.ts';
import { ItemRatingsDiskCache, setActiveRatingsCache } from './item-ratings-cache.ts';
import { MetadataRemindersDiskCache } from './metadata-reminders-cache.ts';
import { ItemPanePositionCoordinator } from './pane-positioner.ts';
import { ItemPaneRegistryService } from './item-pane-registry.ts';
import { sweepBridgeFlowCacheDirectory } from './cache-hygiene.ts';
import { configurePdfCoverCacheDirectory } from './pdf-cover-service.ts';
import { Win32BridgeService } from './win32-bridge.ts';

export class ServiceContainer {
	public readonly csl: CslFormattingEngine;
	public readonly clipboard: UnifiedClipboardService;
	public readonly history: CitationHistoryStore;
	public readonly ratings: ItemRatingsDiskCache;
	public readonly reminders: MetadataRemindersDiskCache;
	public readonly itemPanes: ItemPaneRegistryService;
	public readonly panePositions: ItemPanePositionCoordinator;
	public readonly win32: Win32BridgeService;

	private readonly kernel: PluginKernel;
	private cacheRootApplied = false;

	constructor(kernel: PluginKernel) {
		this.kernel = kernel;
		this.csl = new CslFormattingEngine(kernel.prefs);
		this.clipboard = new UnifiedClipboardService(this.csl, kernel.bus);
		this.history = new CitationHistoryStore();
		this.ratings = new ItemRatingsDiskCache();
		setActiveRatingsCache(this.ratings);
		this.reminders = new MetadataRemindersDiskCache();
		this.itemPanes = new ItemPaneRegistryService();
		this.panePositions = new ItemPanePositionCoordinator();
		this.win32 = new Win32BridgeService();
	}

	async init(): Promise<void> {
		this.syncHistoryConfig();
		await Promise.all([this.history.init(), this.ratings.init(), this.reminders.init()]);
		void sweepBridgeFlowCacheDirectory(this.kernel.prefs.get('inspector.lookup.cacheDirectory'));

		this.kernel.disposables.add(
			this.kernel.notifier.subscribe(['item'], (ev) => {
				const ids = ev.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0);
				if (ids.length) {
					this.csl.invalidateItems(ids);
					invalidateResolvedItemCache(ids);
				}
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
		const customDir = this.kernel.prefs.get('inspector.lookup.cacheDirectory');
		this.history.configure({
			customDir,
			maxEntries: this.kernel.prefs.get('inspector.lookup.cacheMaxEntries'),
			ttlDays: this.kernel.prefs.get('inspector.lookup.cacheTtlDays'),
		});
		// The cache root is resolved once per startup (the settings text says "takes effect after restart").
		if (!this.cacheRootApplied) {
			this.cacheRootApplied = true;
			this.ratings.configure(customDir);
			this.reminders.configure(customDir);
			configurePdfCoverCacheDirectory(customDir);
		}
	}

	dispose(): void {
		this.panePositions.dispose();
		this.itemPanes.unregisterAll();
		this.history.dispose();
		this.ratings.dispose();
		this.reminders.dispose();
		this.csl.clearCache();
		this.win32.dispose();
	}
}
