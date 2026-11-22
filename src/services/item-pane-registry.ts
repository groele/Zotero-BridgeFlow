import type { Disposable } from '../kernel/types.ts';

export interface ItemPaneSectionSpec {
	readonly paneID: string;
	readonly pluginID: string;
	readonly header: { l10nID: string; icon: string };
	readonly sidenav: { l10nID: string; icon: string; orderable?: boolean };
	readonly onInit?: (props: any) => void;
	readonly onDestroy?: (props: { body: HTMLElement }) => void;
	readonly onItemChange?: (props: any) => boolean | void;
	readonly onRender?: (props: any) => void;
	readonly onAsyncRender?: (props: any) => Promise<void>;
	readonly onToggle?: (props: any) => void;
}

/**
 * Unified coordinator for all 4 BridgeFlow right-hand ItemPane sections:
 * 1. CSL Citation Preview
 * 2. Compact Citation Reverse Lookup
 * 3. Side-by-Side PDF Preview & Compare
 * 4. One-Click PDF Folder Jump
 */
export class ItemPaneRegistryService {
	private readonly registered = new Map<string, string>();

	register(spec: ItemPaneSectionSpec): { sectionID: string | false; dispose: Disposable } {
		if (this.registered.has(spec.paneID)) {
			const existing = this.registered.get(spec.paneID) || false;
			return { sectionID: existing, dispose: () => this.unregister(spec.paneID) };
		}
		const manager = (globalThis as any).Zotero?.ItemPaneManager;
		if (!manager?.registerSection) {
			return { sectionID: false, dispose: () => {} };
		}
		const sectionID = manager.registerSection(spec);
		if (sectionID) {
			this.registered.set(spec.paneID, String(sectionID));
		}
		return {
			sectionID: sectionID ? String(sectionID) : false,
			dispose: () => this.unregister(spec.paneID),
		};
	}

	unregister(paneID: string): void {
		const sectionID = this.registered.get(paneID);
		if (!sectionID) return;
		this.registered.delete(paneID);
		try {
			(globalThis as any).Zotero?.ItemPaneManager?.unregisterSection?.(sectionID);
		} catch { /* ignore */ }
	}

	isRegistered(paneID: string): boolean {
		return this.registered.has(paneID);
	}

	listRegistered(): readonly string[] {
		return [...this.registered.keys()];
	}

	unregisterAll(): void {
		for (const paneID of [...this.registered.keys()].reverse()) {
			this.unregister(paneID);
		}
	}
}
