import type { Disposable, SpotlightItemResult, SpotlightProvider } from '../../kernel/types.ts';
import type { WorkspaceTabController } from './tab-controller.ts';

/**
 * Extensible Spotlight engine (Ctrl+P / Cmd+P).
 * Combines built-in tab/remark/collection search with cross-domain SpotlightProviders.
 */
export class SpotlightEngine {
	private readonly providers = new Map<string, SpotlightProvider>();
	private readonly tabs: WorkspaceTabController;

	constructor(tabs: WorkspaceTabController) {
		this.tabs = tabs;
	}

	registerProvider(provider: SpotlightProvider): Disposable {
		this.providers.set(provider.id, provider);
		return () => {
			this.providers.delete(provider.id);
		};
	}

	query(rawTerm: string, win: Window): SpotlightItemResult[] {
		const term = rawTerm.trim().toLowerCase();
		const results: SpotlightItemResult[] = [];

		// 1. Built-in tab & remark matches
		const tracked = this.tabs.buildTrackedTabs(win);
		for (const tab of tracked) {
			const haystack = `${tab.title} ${tab.remark} ${tab.source} ${tab.collection}`.toLowerCase();
			if (term && !haystack.includes(term)) continue;
			results.push({
				id: `tab:${tab.key}`,
				category: 'tab',
				title: tab.remark ? `${tab.remark} · ${tab.title}` : tab.title,
				subtitle: [tab.source, tab.collection].filter(Boolean).join(' · ') || undefined,
				badge: tab.pinned ? 'PIN' : tab.sleeping ? 'SLEEP' : tab.virtual ? 'VIRTUAL' : undefined,
				action: () => {
					if (tab.tabID) this.tabs.selectTab(win, tab.tabID);
					else void this.tabs.focusOrOpenItem(win, { itemID: tab.parentItemID, attachmentID: tab.itemID });
				},
			});
		}

		// 2. External cross-domain providers sorted by priority descending
		const sortedProviders = [...this.providers.values()].sort((a, b) => b.priority - a.priority);
		for (const provider of sortedProviders) {
			try {
				const extra = provider.query(term, win);
				if (extra?.length) results.push(...extra);
			} catch { /* isolate provider error */ }
		}

		return results;
	}
}
