import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { WordCitationCollectionManager } from './citation-collections.ts';
import type { WordSessionTracker } from './session-tracker.ts';

export class CitationColumnController {
	private columnID: string | false = false;

	private readonly kernel: PluginKernel;
	private readonly tracker: WordSessionTracker;
	private readonly collections?: WordCitationCollectionManager;

	constructor(kernel: PluginKernel, tracker: WordSessionTracker, collections?: WordCitationCollectionManager) {
		this.kernel = kernel;
		this.tracker = tracker;
		this.collections = collections;
	}

	register(): void {
		if (this.columnID) return;
		const manager = (globalThis as any).Zotero?.ItemTreeManager;
		if (!manager?.registerColumn) return;
		this.columnID = manager.registerColumn({
			dataKey: 'bridgeflowCitation',
			label: (globalThis as any).Zotero?.locale?.startsWith?.('zh') ? '引用' : 'Citation',
			enabledTreeIDs: ['main'],
			zoteroPersist: ['width', 'hidden', 'sortDirection'],
			pluginID: this.kernel.info.id,
			dataProvider: (item: any) => {
				const id = Number(item?.id || 0);
				if (!id) return '';
				const selectedSessionID = this.collections?.resolveSelectedCollectionSessionID();
				return this.tracker.getCitationDisplayForItem(id, selectedSessionID);
			},
		});
	}

	unregister(): void {
		if (!this.columnID) return;
		const id = this.columnID;
		this.columnID = false;
		try {
			(globalThis as any).Zotero?.ItemTreeManager?.unregisterColumn?.(id);
		} catch { /* ignore */ }
	}
}
