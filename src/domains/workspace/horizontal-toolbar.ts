import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import type { WorkspaceTabController } from './tab-controller.ts';
import { createWorkspaceIcon, type WorkspaceIconName } from './workspace-icons.ts';
import type { WorkspacePopover } from './workspace-popover.ts';

export class WorkspaceToolbarActions {
	private readonly win: Window;
	private readonly doc: Document;
	private readonly prefs: UnifiedPrefService;
	private readonly tabs: WorkspaceTabController;
	private readonly popover: WorkspacePopover;
	private readonly onToggleSpotlight: () => void;
	private readonly onRefresh: () => void;
	private hostEl: HTMLElement | null = null;

	constructor(
		win: Window,
		prefs: UnifiedPrefService,
		tabs: WorkspaceTabController,
		popover: WorkspacePopover,
		onToggleSpotlight: () => void,
		onRefresh: () => void,
	) {
		this.win = win;
		this.doc = win.document;
		this.prefs = prefs;
		this.tabs = tabs;
		this.popover = popover;
		this.onToggleSpotlight = onToggleSpotlight;
		this.onRefresh = onRefresh;
	}

	render(): void {
		const bar = this.doc.getElementById('zotero-tabs-toolbar');
		if (!bar) return;

		if (!this.hostEl || !this.hostEl.isConnected) {
			this.doc.getElementById('zbf-toolbar-actions')?.remove();
			const wrap = this.doc.createElement('div');
			wrap.id = 'zbf-toolbar-actions';
			bar.prepend(wrap);
			this.hostEl = wrap;
		}
		this.hostEl.textContent = '';

		const compact = this.prefs.get('workspace.compactTopBar');
		const sidebarOn = this.prefs.get('workspace.enableVerticalSidebar') && !this.prefs.get('workspace.verticalSidebarCollapsed');
		const showStale = this.prefs.get('workspace.enableStaleSuggestions');
		const staleCount = showStale ? this.tabs.findStaleTabs(this.win).length : 0;

		this.addBtn('topbar', compact ? '展开横版分栏' : '切换为精简顶栏', () => {
			this.prefs.set('workspace.compactTopBar', !compact);
			this.onRefresh();
		}, { pressed: compact });

		this.addBtn('sidebar', '展开/收起左侧竖版文献工作区', () => {
			const cur = this.prefs.get('workspace.enableVerticalSidebar') && !this.prefs.get('workspace.verticalSidebarCollapsed');
			if (!this.prefs.get('workspace.enableVerticalSidebar')) {
				this.prefs.set('workspace.enableVerticalSidebar', true);
				this.prefs.set('workspace.verticalSidebarCollapsed', false);
			} else {
				this.prefs.set('workspace.verticalSidebarCollapsed', cur);
			}
			this.onRefresh();
		}, { pressed: sidebarOn });

		this.addBtn('folder', '按所属 Zotero 集合自动分组当前标签页', () => {
			this.tabs.autoGroupByCollection(this.win);
			this.onRefresh();
		});

		if (this.prefs.get('workspace.enableSessions')) {
			this.addBtn('bridge', '打开工作区快照、模板与 JSON 备份中心', (btn) => {
				this.popover.openHub(btn);
			});
		}

		if (this.prefs.get('workspace.enableSpotlight')) {
			this.addBtn('search', '打开快速查找与命令面板 (Ctrl+P)', () => {
				this.onToggleSpotlight();
			});
		}

		if (this.prefs.get('workspace.enableTabSleep')) {
			this.addBtn('sleep', '休眠所有后台非固定标签页以释放内存', () => {
				this.tabs.sleepInactiveTabs(this.win);
				this.onRefresh();
			});
		}

		if (showStale && staleCount > 0) {
			this.addBtn('clock', `查看超过阈值天数的陈旧标签页（${staleCount} 篇）`, (btn, ev) => {
				this.popover.openStaleMenu(btn, ev);
			}, { count: staleCount, attention: true });
		}
	}

	destroy(): void {
		this.hostEl?.remove();
		this.hostEl = null;
	}

	private addBtn(
		icon: WorkspaceIconName,
		tooltip: string,
		onClick: (btn: HTMLButtonElement, ev: MouseEvent) => void,
		opts: { pressed?: boolean; count?: number; attention?: boolean } = {},
	): void {
		if (!this.hostEl) return;
		const btn = this.doc.createElement('button');
		btn.type = 'button';
		btn.className = `zbf-tb-btn${opts.attention ? ' attention' : ''}`;
		btn.title = tooltip;
		btn.setAttribute('aria-label', tooltip);
		if (opts.pressed !== undefined) btn.setAttribute('aria-pressed', String(opts.pressed));
		btn.appendChild(createWorkspaceIcon(this.doc, icon, 15));

		if (opts.count !== undefined && opts.count > 0) {
			const badge = this.doc.createElement('span');
			badge.className = 'zbf-tb-count';
			badge.textContent = opts.count > 99 ? '99+' : String(opts.count);
			btn.appendChild(badge);
		}
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			onClick(btn, e as MouseEvent);
		});
		this.hostEl.appendChild(btn);
	}
}
