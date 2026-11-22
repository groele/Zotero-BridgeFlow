import { DisposableStack } from '../../kernel/disposable.ts';
import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import type { CitationBadgeInfo } from '../../kernel/types.ts';
import type { SpotlightEngine } from './spotlight-engine.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import type { WorkspaceTabController } from './tab-controller.ts';

const WORKSPACE_CSS = `
.zbf-hgroup-bar { display:flex; align-items:center; gap:6px; padding:2px 8px; overflow-x:auto; font-size:12px; }
.zbf-group-pill { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:999px; color:#fff; cursor:pointer; white-space:nowrap; }
.zbf-vsidebar { display:flex; flex-direction:column; border-inline-end:1px solid color-mix(in srgb,currentColor 14%,transparent); overflow-y:auto; }
.zbf-vtab-row { display:flex; align-items:center; justify-content:space-between; gap:6px; padding:4px 8px; cursor:pointer; }
.zbf-vtab-row:hover { background:color-mix(in srgb,currentColor 8%,transparent); }
.zbf-cite-badge { font-size:11px; font-weight:600; padding:1px 5px; border-radius:4px; background:#0D9488; color:#fff; flex-shrink:0; }
`;

export class WorkspaceWindowUI {
	private readonly disposables = new DisposableStack();
	private badges: ReadonlyMap<number, CitationBadgeInfo> = new Map();
	private readonly win: Window;
	private readonly prefs: UnifiedPrefService;
	private readonly store: WorkspaceStateStore;
	private readonly tabs: WorkspaceTabController;
	private readonly spotlight: SpotlightEngine;
	private sidebarEl: HTMLElement | null = null;
	private hbarEl: HTMLElement | null = null;

	constructor(
		win: Window,
		prefs: UnifiedPrefService,
		store: WorkspaceStateStore,
		tabs: WorkspaceTabController,
		spotlight: SpotlightEngine,
	) {
		this.win = win;
		this.prefs = prefs;
		this.store = store;
		this.tabs = tabs;
		this.spotlight = spotlight;
	}

	mount(): void {
		const doc = this.win.document;
		if (!doc?.documentElement) return;

		const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style') as HTMLStyleElement;
		style.id = 'zbf-workspace-style';
		style.textContent = WORKSPACE_CSS;
		doc.documentElement.append(style);
		this.disposables.add(() => style.remove());

		const onKeyDown = (ev: KeyboardEvent): void => {
			if (!this.prefs.get('workspace.enableSpotlight')) return;
			if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'p') {
				ev.preventDefault();
				this.openSpotlightOverlay();
			}
		};
		this.win.addEventListener?.('keydown', onKeyDown as EventListener);
		this.disposables.add(() => this.win.removeEventListener?.('keydown', onKeyDown as EventListener));
		this.disposables.add(this.store.onChange(() => this.render()));

		this.render();
	}

	setCitationBadges(badges: ReadonlyMap<number, CitationBadgeInfo>): void {
		this.badges = badges;
		this.render();
	}

	render(): void {
		const doc = this.win.document;
		if (!doc) return;
		this.renderHorizontalBar(doc);
		this.renderVerticalSidebar(doc);
	}

	private renderHorizontalBar(doc: Document): void {
		const host = doc.getElementById('tab-bar-container');
		if (!host) return;
		if (!this.prefs.get('workspace.enableHorizontalGroups')) {
			this.hbarEl?.remove();
			this.hbarEl = null;
			return;
		}
		if (!this.hbarEl) {
			const bar = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
			bar.id = 'zbf-hgroup-bar';
			bar.className = 'zbf-hgroup-bar';
			host.append(bar);
			this.hbarEl = bar;
			this.disposables.add(() => { this.hbarEl?.remove(); this.hbarEl = null; });
		}
		this.hbarEl.textContent = '';
		for (const group of this.store.state.groups) {
			const pill = doc.createElementNS('http://www.w3.org/1999/xhtml', 'span') as HTMLElement;
			pill.className = 'zbf-group-pill';
			pill.style.backgroundColor = group.color;
			pill.textContent = `${group.name} (${group.memberKeys.length})`;
			pill.addEventListener('click', () => {
				const collapsed = this.store.state.collapsed.includes(group.id);
				this.store.setCollapsed(group.id, !collapsed);
			});
			this.hbarEl.append(pill);
		}
	}

	private renderVerticalSidebar(doc: Document): void {
		const host = doc.getElementById('zotero-pane-stack') || doc.getElementById('browser');
		if (!host) return;
		if (!this.prefs.get('workspace.enableVerticalSidebar') || this.prefs.get('workspace.verticalSidebarCollapsed')) {
			this.sidebarEl?.remove();
			this.sidebarEl = null;
			return;
		}
		if (!this.sidebarEl) {
			const el = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
			el.id = 'zbf-vertical-sidebar';
			el.className = 'zbf-vsidebar';
			host.prepend(el);
			this.sidebarEl = el;
			this.disposables.add(() => { this.sidebarEl?.remove(); this.sidebarEl = null; });
		}
		this.sidebarEl.style.width = `${this.prefs.get('workspace.verticalSidebarWidth')}px`;
		this.sidebarEl.textContent = '';

		const showBadges = this.prefs.get('fusion.sidebarCiteBadge');
		const tracked = this.tabs.buildTrackedTabs(this.win);
		for (const tab of tracked) {
			const row = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
			row.className = 'zbf-vtab-row';
			row.style.minHeight = `${this.prefs.get('workspace.verticalTabRowHeight')}px`;
			row.style.fontSize = `${this.prefs.get('workspace.verticalTabFontSize')}px`;

			const label = doc.createElementNS('http://www.w3.org/1999/xhtml', 'span') as HTMLElement;
			label.textContent = tab.remark ? `${tab.remark} · ${tab.title}` : tab.title;
			row.append(label);

			if (showBadges) {
				const badgeInfo = this.badges.get(tab.parentItemID) || this.badges.get(tab.itemID);
				if (badgeInfo) {
					const badge = doc.createElementNS('http://www.w3.org/1999/xhtml', 'span') as HTMLElement;
					badge.className = 'zbf-cite-badge';
					badge.textContent = `[${badgeInfo.ordinal}]`;
					badge.title = `${badgeInfo.documentName}: ${badgeInfo.shortText}`;
					row.append(badge);
				}
			}

			row.addEventListener('click', () => {
				if (tab.tabID) this.tabs.selectTab(this.win, tab.tabID);
				else void this.tabs.focusOrOpenItem(this.win, { itemID: tab.parentItemID, attachmentID: tab.itemID });
			});
			this.sidebarEl.append(row);
		}
	}

	private openSpotlightOverlay(): void {
		const results = this.spotlight.query('', this.win);
		if (results.length === 1) {
			void results[0].action();
		}
	}

	dispose(): void {
		this.disposables.disposeAll();
	}
}
