import { DisposableStack } from '../kernel/disposable.ts';
import type { PluginKernel } from '../kernel/plugin-kernel.ts';
import type { BridgeModule } from '../kernel/types.ts';
import type { ServiceContainer } from '../services/service-container.ts';

/**
 * Bridge 1: All-Entry Copy -> Reverse Lookup History Loop.
 * Any citation copied from CSL Preview, Tab Context Menu, or Spotlight
 * is automatically indexed in the shared CitationHistoryStore.
 */
export class CopyHistoryBridge implements BridgeModule {
	public readonly id = 'copy-history-bridge';
	private readonly disposables = new DisposableStack();

	private readonly kernel: PluginKernel;
	private readonly services: ServiceContainer;

	constructor(kernel: PluginKernel, services: ServiceContainer) {
		this.kernel = kernel;
		this.services = services;
	}

	start(): void {
		this.disposables.reset();
		this.disposables.add(
			this.kernel.bus.on('citation:copied', (ev) => {
				if (!this.kernel.prefs.get('fusion.copyToLookupHistory')) return;
				if (!this.kernel.prefs.get('inspector.lookup.historyEnable')) return;
				if (!ev.text || ev.itemIDs.length !== 1) return;

				const itemID = ev.itemIDs[0];
				const item = (globalThis as any).Zotero?.Items?.get?.(itemID);
				this.services.history.record({
					text: ev.text,
					libraryID: Number(item?.libraryID || 1),
					itemKey: String(item?.key || ''),
					itemID,
					title: String(item?.getField?.('title') || item?.title || ev.text.slice(0, 80)),
					style: ev.styleID,
				});
			}),
		);
	}

	stop(): void {
		this.disposables.disposeAll();
	}
}
