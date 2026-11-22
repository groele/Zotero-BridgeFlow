import type { WorkspaceStateStore } from './state-store.ts';
import type { WorkspaceTabController } from './tab-controller.ts';
import type { WorkspaceSession } from './types.ts';

export class WorkspacePopoverController {
	private panel: any = null;
	private listEl: HTMLElement | null = null;
	private nameInput: HTMLInputElement | null = null;
	private readonly win: Window;
	private readonly doc: Document;
	private readonly store: WorkspaceStateStore;
	private readonly tabs: WorkspaceTabController;
	private readonly onRefresh: () => void;

	constructor(
		win: Window,
		doc: Document,
		store: WorkspaceStateStore,
		tabs: WorkspaceTabController,
		onRefresh: () => void,
	) {
		this.win = win;
		this.doc = doc;
		this.store = store;
		this.tabs = tabs;
		this.onRefresh = onRefresh;
	}

	toggle(anchor: Element): void {
		this.ensureMounted();
		if (!this.panel) return;
		if (this.panel.state === 'open') {
			this.close();
			return;
		}
		this.render();
		try {
			this.panel.openPopup(anchor, 'bottomleft topleft', 0, 4, false, false);
		} catch { /* ignore */ }
	}

	close(): void {
		try { this.panel?.hidePopup?.(); } catch { /* ignore */ }
	}

	dispose(): void {
		this.close();
		this.panel?.remove?.();
		this.panel = null;
		this.listEl = null;
		this.nameInput = null;
	}

	private ensureMounted(): void {
		if (this.panel) return;
		const popupset = this.doc?.getElementById?.('mainPopupSet') || this.doc?.querySelector?.('popupset');
		if (!popupset) return;
		const xul = (this.doc as any).createXULElement
			? (this.doc as any).createXULElement('panel')
			: this.doc.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', 'panel');
		xul.id = 'zbf-workspace-panel';
		xul.setAttribute('orient', 'vertical');

		const box = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
		box.className = 'zbf-spot-box';
		box.style.width = '360px';

		const row = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
		row.style.cssText = 'display:flex;gap:6px;';
		const input = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'input') as HTMLInputElement;
		input.type = 'text';
		input.className = 'zbf-spot-input';
		input.placeholder = 'Workspace snapshot name...';

		const saveBtn = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
		saveBtn.type = 'button';
		saveBtn.className = 'zbf-tb-btn';
		saveBtn.textContent = 'Save';
		saveBtn.addEventListener('click', () => {
			this.store.saveSession(input.value || `Workspace ${new Date().toLocaleTimeString()}`);
			input.value = '';
			this.render();
			this.onRefresh();
		});
		row.append(input, saveBtn);

		const list = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
		list.className = 'zbf-spot-results';

		box.append(row, list);
		xul.append(box);
		popupset.append(xul);

		this.panel = xul;
		this.nameInput = input;
		this.listEl = list;
	}

	private render(): void {
		if (!this.listEl) return;
		this.listEl.textContent = '';
		const all: Array<{ session: WorkspaceSession; kind: string }> = [
			...this.store.state.sessions.map((s) => ({ session: s, kind: 'Saved' })),
			...this.store.state.rollingSessions.map((s) => ({ session: s, kind: 'Auto' })),
		];
		if (!all.length) {
			const empty = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
			empty.style.cssText = 'padding:10px;opacity:0.65;text-align:center;';
			empty.textContent = 'No workspace snapshots yet';
			this.listEl.append(empty);
			return;
		}
		for (const { session, kind } of all) {
			const item = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
			item.className = 'zbf-spot-row';
			const title = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'span') as HTMLElement;
			title.textContent = `${session.name} (${session.groups.length} groups)`;
			const right = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'span') as HTMLElement;
			right.style.cssText = 'display:inline-flex;gap:4px;align-items:center;';
			const badge = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'span') as HTMLElement;
			badge.className = 'zbf-spot-badge';
			badge.textContent = kind;
			const restoreBtn = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
			restoreBtn.type = 'button';
			restoreBtn.className = 'zbf-tb-btn';
			restoreBtn.textContent = 'Restore';
			restoreBtn.addEventListener('click', () => {
				void this.restoreSession(session);
			});
			right.append(badge, restoreBtn);
			item.append(title, right);
			this.listEl.append(item);
		}
	}

	private async restoreSession(session: WorkspaceSession): Promise<void> {
		this.store.restoreSessionLayout(session);
		for (const group of session.groups) {
			for (const key of group.memberKeys) {
				const idMatch = key.match(/^item:(\d+)$/);
				if (idMatch) {
					await this.tabs.focusOrOpenItem(this.win, {
						itemID: Number(idMatch[1]),
						attachmentID: Number(idMatch[1]),
						preferExistingTab: true,
					});
				}
			}
		}
		this.close();
		this.onRefresh();
	}
}
