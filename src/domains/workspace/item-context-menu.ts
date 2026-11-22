import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import { openTextPromptModal } from './popup-menu-helpers.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import type { WorkspaceTabController } from './tab-controller.ts';

export class ItemContextMenuController {
	private itemMenuEl: Element | null = null;
	private entryEl: Element | null = null;
	private subPopup: Element | null = null;
	private readonly win: Window;
	private readonly doc: Document;
	private readonly prefs: UnifiedPrefService;
	private readonly store: WorkspaceStateStore;
	private readonly tabs: WorkspaceTabController;
	private readonly onRefresh: () => void;

	constructor(
		win: Window,
		doc: Document,
		prefs: UnifiedPrefService,
		store: WorkspaceStateStore,
		tabs: WorkspaceTabController,
		onRefresh: () => void,
	) {
		this.win = win;
		this.doc = doc;
		this.prefs = prefs;
		this.store = store;
		this.tabs = tabs;
		this.onRefresh = onRefresh;
	}

	attach(): void {
		const itemMenu = this.doc?.getElementById?.('zotero-itemmenu');
		if (!itemMenu || this.itemMenuEl) return;
		const menu = this.xul('menu');
		menu.id = 'zbf-item-open-group';
		menu.setAttribute('label', 'BridgeFlow：打开并分组');
		const sub = this.xul('menupopup');
		menu.append(sub);
		itemMenu.append(menu);
		itemMenu.addEventListener('popupshowing', this.onMenuShowing);
		sub.addEventListener('popupshowing', this.onSubShowing);
		this.itemMenuEl = itemMenu;
		this.entryEl = menu;
		this.subPopup = sub;
	}

	dispose(): void {
		this.itemMenuEl?.removeEventListener('popupshowing', this.onMenuShowing);
		this.subPopup?.removeEventListener('popupshowing', this.onSubShowing);
		this.entryEl?.remove();
		this.itemMenuEl = null;
		this.entryEl = null;
		this.subPopup = null;
	}

	private onMenuShowing = (): void => {
		const enabled = this.prefs.get('workspace.enableItemContextMenu');
		const selected = (this.win as any).ZoteroPane?.getSelectedItems?.() || [];
		if (this.entryEl) {
			(this.entryEl as HTMLElement).hidden = !enabled;
			if (!selected.length) this.entryEl.setAttribute('disabled', 'true');
			else this.entryEl.removeAttribute('disabled');
		}
	};

	private onSubShowing = (): void => {
		if (!this.subPopup) return;
		this.subPopup.textContent = '';
		const selected: any[] = (this.win as any).ZoteroPane?.getSelectedItems?.() || [];
		this.addItem(this.subPopup, '+ 打开到新分组…', () => {
			const fallback = String(selected[0]?.getField?.('title') || '新分组').slice(0, 30);
			openTextPromptModal(this.win, '打开到新分组', '输入分组名称...', fallback, (name) => {
				const g = this.store.createGroup(name || fallback);
				void this.openIntoGroup(selected, g.id);
			});
		});

		if (this.store.state.groups.length) this.subPopup.append(this.xul('menuseparator'));
		for (const g of this.store.state.groups) {
			this.addItem(this.subPopup, g.name, () => {
				void this.openIntoGroup(selected, g.id);
			});
		}
	};

	private async openIntoGroup(items: readonly any[], groupId: string): Promise<void> {
		for (const it of items) {
			const best = typeof it.getBestAttachment === 'function' ? await it.getBestAttachment().catch(() => null) : null;
			const targetID = Number(best?.id || it.id || 0);
			if (!targetID) continue;
			await this.tabs.focusOrOpenItem(this.win, { itemID: it.id, attachmentID: targetID, preferExistingTab: true });
			this.store.assignToGroup(`item:${targetID}`, groupId);
		}
		this.onRefresh();
	}

	private xul(tag: string): any {
		return (this.doc as any).createXULElement
			? (this.doc as any).createXULElement(tag)
			: this.doc.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', tag);
	}

	private addItem(popup: any, label: string, action: () => void): void {
		const mi = this.xul('menuitem');
		mi.setAttribute('label', label);
		mi.addEventListener('command', action);
		popup.append(mi);
	}
}
