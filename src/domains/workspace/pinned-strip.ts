import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import type { WorkspaceHoverCard } from './hover-card.ts';
import { addPopupButton, createFloatingPopup } from './popup-menu-helpers.ts';
import type { WorkspaceTabContextMenu } from './tab-context-menu.ts';
import type { WorkspaceTabController } from './tab-controller.ts';
import type { TrackedTab } from './types.ts';
import { createWorkspaceIcon } from './workspace-icons.ts';

export class HorizontalPinnedStrip {
	private readonly win: Window;
	private readonly doc: Document;
	private readonly prefs: UnifiedPrefService;
	private readonly tabs: WorkspaceTabController;
	private readonly menus: WorkspaceTabContextMenu;
	private readonly hover: WorkspaceHoverCard;
	private activeMorePopup: HTMLElement | null = null;
	private outsideHandler: ((e: Event) => void) | null = null;

	constructor(
		win: Window,
		prefs: UnifiedPrefService,
		tabs: WorkspaceTabController,
		menus: WorkspaceTabContextMenu,
		hover: WorkspaceHoverCard,
	) {
		this.win = win;
		this.doc = win.document;
		this.prefs = prefs;
		this.tabs = tabs;
		this.menus = menus;
		this.hover = hover;
	}

	render(container: HTMLElement, pinnedTabs: readonly TrackedTab[], selectedID: string): void {
		if (!this.prefs.get('workspace.enablePinnedTabs') || !pinnedTabs.length) return;

		const strip = this.doc.createElement('div');
		strip.className = 'zbf-pinned-strip';
		const maxVisible = 5;
		const iconOnly = this.prefs.get('workspace.pinnedIconOnly');
		const visible = pinnedTabs.slice(0, maxVisible);
		const overflow = pinnedTabs.slice(maxVisible);

		for (const tab of visible) {
			const chip = this.doc.createElement('button');
			chip.type = 'button';
			chip.className = `zbf-pinned-chip${iconOnly ? ' icon-only' : ''}${tab.tabID === selectedID ? ' selected' : ''}`;
			chip.title = tab.title;
			chip.appendChild(createWorkspaceIcon(this.doc, 'pin', 12));
			if (!iconOnly) {
				const span = this.doc.createElement('span');
				span.textContent = this.tabs.getDisplayTitle(tab);
				chip.appendChild(span);
			}
			chip.addEventListener('click', () => this.tabs.selectTab(this.win, tab.tabID));
			chip.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				this.menus.openTabMenu(chip, tab, e as MouseEvent);
			});
			this.hover.attach(chip, tab);
			strip.appendChild(chip);
		}

		if (overflow.length) {
			const moreBtn = this.doc.createElement('button');
			moreBtn.type = 'button';
			moreBtn.className = 'zbf-pinned-more';
			moreBtn.textContent = `+${overflow.length}`;
			moreBtn.title = `另外 ${overflow.length} 个已固定标签页`;
			moreBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.openOverflowPopup(moreBtn, overflow, e as MouseEvent);
			});
			strip.appendChild(moreBtn);
		}

		container.appendChild(strip);
	}

	destroy(): void {
		this.closePopup();
	}

	private openOverflowPopup(anchor: HTMLElement, overflow: readonly TrackedTab[], event: MouseEvent): void {
		this.closePopup();
		const pop = createFloatingPopup(this.doc, anchor, event, 230);
		if (!pop) return;
		const close = () => this.closePopup();
		for (const tab of overflow) {
			addPopupButton(this.doc, pop, `📌 ${this.tabs.getDisplayTitle(tab)}`, () => {
				this.tabs.selectTab(this.win, tab.tabID);
			}, close);
		}
		this.activeMorePopup = pop;
		this.outsideHandler = (e: Event) => {
			if (!pop.contains(e.target as Node)) this.closePopup();
		};
		this.win.setTimeout(() => {
			if (this.outsideHandler) this.doc.addEventListener('mousedown', this.outsideHandler, true);
		}, 15);
	}

	private closePopup(): void {
		this.activeMorePopup?.remove();
		this.activeMorePopup = null;
		if (this.outsideHandler) {
			this.doc.removeEventListener('mousedown', this.outsideHandler, true);
			this.outsideHandler = null;
		}
	}
}
