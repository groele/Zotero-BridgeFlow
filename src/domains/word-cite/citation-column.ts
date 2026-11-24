import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { WordCitationCollectionManager } from './citation-collections.ts';
import type { WordSessionTracker } from './session-tracker.ts';

export class CitationColumnController {
	private readonly registeredKeys = new Set<string>();
	private active = false;
	private cachedSessionID: string | null | undefined;
	private cachedSessionAt = 0;

	private readonly kernel: PluginKernel;
	private readonly tracker: WordSessionTracker;
	private readonly collections?: WordCitationCollectionManager;

	constructor(kernel: PluginKernel, tracker: WordSessionTracker, collections?: WordCitationCollectionManager) {
		this.kernel = kernel;
		this.tracker = tracker;
		this.collections = collections;
	}

	private resolvePreferredSessionID(): string | null | undefined {
		const now = Date.now();
		if (now - this.cachedSessionAt > 80) {
			this.cachedSessionAt = now;
			this.cachedSessionID = this.collections?.resolveSelectedCollectionSessionID();
		}
		return this.cachedSessionID;
	}

	register(): void {
		if (this.active) return;
		const manager = (globalThis as any).Zotero?.ItemTreeManager;
		const regFn = manager?.registerColumns || manager?.registerColumn;
		if (typeof regFn !== 'function') return;
		this.active = true;

		const descriptor = {
			dataKey: 'bridgeflowCitation',
			label: (globalThis as any).Zotero?.locale?.startsWith?.('zh') ? '引用' : 'Citation',
			enabledTreeIDs: ['main'],
			zoteroPersist: ['width', 'hidden', 'sortDirection'],
			pluginID: this.kernel.info.id,
			dataProvider: (item: any) => {
				const id = Number(item?.id || 0);
				if (!id) return '';
				const preferred = this.resolvePreferredSessionID();
				const direct = this.tracker.getCitationDisplayForItem(id, preferred);
				if (direct) return direct;
				const parentID = Number(item?.parentItemID || 0);
				return parentID > 0 ? this.tracker.getCitationDisplayForItem(parentID, preferred) : '';
			},
		};

		try {
			const res = regFn.call(manager, descriptor);
			const recordKey = (val: unknown) => {
				const list = Array.isArray(val) ? val : [val];
				for (const k of list) {
					if (typeof k === 'string' && k) this.registeredKeys.add(k);
				}
				if (!this.active && this.registeredKeys.size) {
					this.flushUnregister();
				}
			};
			if (res && typeof (res as Promise<unknown>).then === 'function') {
				void (res as Promise<unknown>).then(recordKey).catch(() => {});
			} else {
				recordKey(res);
			}
		} catch { /* ignore */ }
	}

	unregister(): void {
		this.active = false;
		this.flushUnregister();
	}

	private flushUnregister(): void {
		if (!this.registeredKeys.size) return;
		const keys = [...this.registeredKeys];
		this.registeredKeys.clear();
		const manager = (globalThis as any).Zotero?.ItemTreeManager;
		try {
			if (typeof manager?.unregisterColumns === 'function') {
				void Promise.resolve(manager.unregisterColumns(keys)).catch(() => {});
			} else if (typeof manager?.unregisterColumn === 'function') {
				for (const k of keys) {
					void Promise.resolve(manager.unregisterColumn(k)).catch(() => {});
				}
			}
		} catch { /* ignore */ }
	}
}
