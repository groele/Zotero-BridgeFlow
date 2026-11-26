import { createWorkspaceElement } from '../workspace-elements.ts';
import type { UnifiedPrefService } from '../../../kernel/pref-service.ts';
import type { WorkspaceStateStore } from '../store/state-store.ts';
import type { WorkspaceTabController } from '../tabs/tab-controller.ts';
import type { TrackedTab } from '../types.ts';
import { createWorkspaceIcon, type WorkspaceIconName } from '../workspace-icons.ts';
import type { WorkspacePopover } from './workspace-popover.ts';

interface ToolbarActionItem {
	id: string;
	label: string;
	title?: string;
	icon: WorkspaceIconName;
	iconOnly?: boolean;
	count?: number;
	status?: 'attention';
	pressed?: boolean;
	popup?: 'dialog' | 'menu';
	run: (button: HTMLButtonElement) => void;
}

export class WorkspaceToolbarActions {
	private readonly win: Window;
	private readonly doc: Document;
	private readonly prefs: UnifiedPrefService;
	private readonly store: WorkspaceStateStore;
	private readonly tabs: WorkspaceTabController;
	private readonly popover: WorkspacePopover;
	private readonly onToggleSpotlight: (anchor?: HTMLElement) => void;
	private readonly onRefresh: () => void;
	private readonly buttons = new Map<string, HTMLButtonElement>();
	private hostEl: HTMLElement | null = null;

	constructor(
		win: Window,
		prefs: UnifiedPrefService,
		store: WorkspaceStateStore,
		tabs: WorkspaceTabController,
		popover: WorkspacePopover,
		onToggleSpotlight: (anchor?: HTMLElement) => void,
		onRefresh: () => void,
	) {
		this.win = win;
		this.doc = win.document;
		this.prefs = prefs;
		this.store = store;
		this.tabs = tabs;
		this.popover = popover;
		this.onToggleSpotlight = onToggleSpotlight;
		this.onRefresh = onRefresh;
	}

	render(tracked?: readonly TrackedTab[]): void {
		const bar = this.doc.getElementById('zotero-tabs-toolbar')
			|| this.doc.querySelector('#tab-bar-container .tab-bar-inner-container');
		if (!bar) return;

		if (!this.hostEl || !this.hostEl.isConnected) {
			this.doc.getElementById('zbf-toolbar-actions')?.remove();
			const wrap = createWorkspaceElement(this.doc, 'div');
			wrap.id = 'zbf-toolbar-actions';
			bar.appendChild(wrap);
			this.hostEl = wrap;
		}

		const sidebarHealthy = this.prefs.get('workspace.enableVerticalSidebar')
			&& !this.prefs.get('workspace.verticalSidebarCollapsed')
			&& Boolean(this.doc.getElementById('zbf-sidebar')?.isConnected);
		const compactMode = this.prefs.get('workspace.enableHorizontalGroups')
			&& this.prefs.get('workspace.compactTopBar')
			&& sidebarHealthy;

		const actions: ToolbarActionItem[] = [];
		if (compactMode || (this.prefs.get('workspace.enableHorizontalGroups') && sidebarHealthy)) {
			actions.push({
				id: 'compact',
				icon: 'topbar',
				iconOnly: true,
				pressed: compactMode,
				label: '精简顶栏',
				title: compactMode
					? '恢复水平分组标签栏'
					: '收起水平文献标签以节省顶部空间（保留文库与侧栏）',
				run: () => {
					this.prefs.set('workspace.compactTopBar', !compactMode);
					this.onRefresh();
				},
			});
		}

		if (this.prefs.get('workspace.enableVerticalSidebar')) {
			const open = !this.prefs.get('workspace.verticalSidebarCollapsed');
			actions.push({
				id: 'sidebar',
				icon: 'sidebar',
				iconOnly: true,
				pressed: open,
				label: '标签侧栏',
				title: open ? '收起垂直标签侧边栏' : '展开垂直标签侧边栏',
				run: () => {
					this.prefs.set('workspace.verticalSidebarCollapsed', open);
					this.onRefresh();
				},
			});
		}

		if (this.prefs.get('workspace.enableSpotlight')) {
			const isMac = Boolean((globalThis as any).Zotero?.isMac);
			const shortcut = isMac ? '⌘P' : 'Ctrl+P';
			actions.push({
				id: 'search',
				icon: 'search',
				label: '快速查找',
				title: `查找标签、文献和操作（${shortcut}）`,
				run: (button) => this.onToggleSpotlight(button),
			});
		}

		if (this.prefs.get('workspace.enableSessions')) {
			const totalSaved = this.store.state.sessions.length + this.store.state.rollingSessions.length;
			actions.push({
				id: 'workspace',
				icon: 'workspace',
				popup: 'dialog',
				count: totalSaved,
				label: '工作区',
				title: `已保存的工作区与快照 (${totalSaved})`,
				run: (button) => this.popover.openHub(button),
			});
		}

		if (this.prefs.get('workspace.enableStaleSuggestions')) {
			const staleCount = this.tabs.findStaleTabs(this.win, Date.now(), tracked).length;
			if (staleCount > 0) {
				actions.push({
					id: 'stale',
					icon: 'clock',
					popup: 'menu',
					count: staleCount,
					status: 'attention',
					label: '建议关闭',
					title: `建议关闭 (${staleCount})`,
					run: (button) => this.popover.openStaleMenu(button),
				});
			}
		}

		this.syncButtons(this.hostEl, actions);
	}

	destroy(): void {
		this.buttons.clear();
		this.hostEl?.remove();
		this.hostEl = null;
	}

	private syncButtons(bar: HTMLElement, actions: readonly ToolbarActionItem[]): void {
		const ids = new Set(actions.map(({ id }) => id));
		for (const [id, button] of this.buttons) {
			if (!ids.has(id)) {
				button.remove();
				this.buttons.delete(id);
			}
		}
		bar.hidden = actions.length === 0;
		let next = bar.firstElementChild;
		for (const action of actions) {
			const { id, label, title, icon, count, pressed, popup } = action;
			let button = this.buttons.get(id);
			if (!button) {
				button = createWorkspaceElement(this.doc, 'button');
				button.type = 'button';
				button.className = 'zbf-tb-btn';
				button.setAttribute('data-action', id);
				const svg = createWorkspaceIcon(this.doc, icon, 16);
				const caption = createWorkspaceElement(this.doc, 'span');
				caption.className = 'zbf-tb-label';
				const badge = createWorkspaceElement(this.doc, 'span');
				badge.className = 'zbf-tb-count';
				badge.setAttribute('aria-hidden', 'true');
				button.append(svg, caption, badge);
				this.buttons.set(id, button);
			}
			const caption = button.children[1] as HTMLElement;
			const badge = button.children[2] as HTMLElement;
			if (caption.textContent !== label) caption.textContent = label;
			const number = count ? (count > 99 ? '99+' : String(count)) : '';
			if (badge.textContent !== number) badge.textContent = number;
			badge.hidden = !number;
			button.title = title ?? label;
			button.setAttribute('aria-label', title?.startsWith(label) ? title : title ? `${label} · ${title}` : label);
			if (popup) button.setAttribute('aria-haspopup', popup);
			else button.removeAttribute('aria-haspopup');
			if (pressed !== undefined) button.setAttribute('aria-pressed', String(pressed));
			else button.removeAttribute('aria-pressed');
			button.classList.toggle('zbf-tb-icon-only', Boolean(action.iconOnly));
			button.classList.toggle('zbf-tb-attention', action.status === 'attention');
			button.onclick = (e) => {
				e.stopPropagation();
				action.run(button!);
			};
			if (button !== next) bar.insertBefore(button, next);
			next = button.nextElementSibling;
		}
	}
}
