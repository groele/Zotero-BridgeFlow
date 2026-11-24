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
				if (!ev.text || !ev.itemIDs.length) return;

				if (ev.itemIDs.length === 1) {
					const itemID = ev.itemIDs[0];
					if (!Number.isSafeInteger(itemID) || itemID <= 0) return;
					const item = (globalThis as any).Zotero?.Items?.get?.(itemID);
					if (item?.deleted || item?.isTrashed?.()) return;
					this.services.history.record({
						text: ev.text,
						libraryID: Number(item?.libraryID || 1),
						itemKey: String(item?.key || ''),
						itemID,
						title: String(item?.getField?.('title') || item?.title || ev.text.slice(0, 80)),
						style: ev.styleID,
					});
					return;
				}

				const lines = ev.text.split(/\r?\n+/).map((l) => l.trim()).filter((l) => l.length >= 12);
				if (lines.length === ev.itemIDs.length) {
					for (let i = 0; i < ev.itemIDs.length; i++) {
						const itemID = ev.itemIDs[i];
						if (!Number.isSafeInteger(itemID) || itemID <= 0) continue;
						const item = (globalThis as any).Zotero?.Items?.get?.(itemID);
						if (item?.deleted || item?.isTrashed?.()) continue;
						this.services.history.record({
							text: lines[i],
							libraryID: Number(item?.libraryID || 1),
							itemKey: String(item?.key || ''),
							itemID,
							title: String(item?.getField?.('title') || item?.title || lines[i].slice(0, 80)),
							style: ev.styleID,
						});
					}
				}
			}),
		);
	}

	stop(): void {
		this.disposables.disposeAll();
	}
}
