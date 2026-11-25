import { createWorkspaceElement } from './workspace-elements.ts';
import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import { addPopupSeparator, createFloatingPopup } from './popup-menu-helpers.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import type { WorkspaceTabController } from './tab-controller.ts';
import {
	exportWorkspaceJson,
	importWorkspaceJsonInteractive,
	renderPublicationSuggestionsSection,
	renderSessionSection,
} from './workspace-hub-helpers.ts';

export class WorkspacePopover {
	private readonly win: Window;
	private readonly doc: Document;
	private readonly prefs: UnifiedPrefService;
	private readonly store: WorkspaceStateStore;
	private readonly tabs: WorkspaceTabController;
	private readonly onRefresh: () => void;
	private activeBackdrop: HTMLElement | null = null;
	private activePopup: HTMLElement | null = null;
	private boundOutside: ((e: Event) => void) | null = null;

	constructor(
		win: Window,
		prefs: UnifiedPrefService,
		store: WorkspaceStateStore,
		tabs: WorkspaceTabController,
		onRefresh: () => void,
	) {
		this.win = win;
		this.doc = win.document;
		this.prefs = prefs;
		this.store = store;
		this.tabs = tabs;
		this.onRefresh = onRefresh;
	}

	openHub(anchor?: HTMLElement): void {
		this.close();
		const host = this.doc.documentElement || this.doc.body;
		if (!host) return;

		const backdrop = createWorkspaceElement(this.doc, 'div');
		backdrop.id = 'zbf-hub-backdrop';
		backdrop.addEventListener('mousedown', (e) => {
			if (e.target === backdrop) this.close();
		});

		const modal = createWorkspaceElement(this.doc, 'div');
		modal.className = 'zbf-hub-box';
		modal.addEventListener('keydown', (e) => {
			if ((e as KeyboardEvent).key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				this.close();
			}
		});

		const header = createWorkspaceElement(this.doc, 'div');
		header.className = 'zbf-hub-head';
		const title = createWorkspaceElement(this.doc, 'div');
		title.className = 'zbf-hub-title';
		title.textContent = '工作区与会话快照中心';
		const closeBtn = createWorkspaceElement(this.doc, 'button');
		closeBtn.type = 'button';
		closeBtn.className = 'zbf-hub-close';
		closeBtn.textContent = '✕';
		closeBtn.addEventListener('click', () => this.close());
		header.append(title, closeBtn);

		const nameInput = createWorkspaceElement(this.doc, 'input') as HTMLInputElement;
		nameInput.type = 'text';
		nameInput.className = 'zbf-hub-input';
		nameInput.placeholder = '输入工作区快照或模板名称（如：论文修改轮次）...';
		nameInput.addEventListener('keydown', (e) => {
			const ke = e as KeyboardEvent;
			if (!ke.isComposing && ke.key === 'Enter') {
				e.preventDefault();
				saveBtn.click();
			}
		});

		const statusEl = createWorkspaceElement(this.doc, 'div');
		statusEl.className = 'zbf-hub-status';

		const actions = createWorkspaceElement(this.doc, 'div');
		actions.className = 'zbf-hub-actions';

		const saveBtn = createWorkspaceElement(this.doc, 'button');
		saveBtn.type = 'button';
		saveBtn.className = 'zbf-hub-btn primary';
		saveBtn.textContent = '保存当前快照';
		saveBtn.addEventListener('click', () => {
			const name = nameInput.value.trim() || `快照 ${new Date().toLocaleTimeString()}`;
			this.store.saveSession(name, { isTemplate: false, openKeys: this.tabs.openKeys(this.win) });
			nameInput.value = '';
			statusEl.textContent = `已保存工作区快照「${name}」`;
			renderLists();
			this.onRefresh();
		});

		const tplBtn = createWorkspaceElement(this.doc, 'button');
		tplBtn.type = 'button';
		tplBtn.className = 'zbf-hub-btn';
		tplBtn.textContent = '存为分组模板';
		tplBtn.addEventListener('click', () => {
			const name = nameInput.value.trim() || `模板 ${new Date().toLocaleTimeString()}`;
			this.store.saveSession(name, { isTemplate: true });
			nameInput.value = '';
			statusEl.textContent = `已保存结构模板「${name}」`;
			renderLists();
			this.onRefresh();
		});

		const exportBtn = createWorkspaceElement(this.doc, 'button');
		exportBtn.type = 'button';
		exportBtn.className = 'zbf-hub-btn';
		exportBtn.textContent = '导出 JSON';
		exportBtn.addEventListener('click', async () => {
			const msg = await exportWorkspaceJson(this.win, this.store);
			if (msg) statusEl.textContent = msg;
		});

		const importBtn = createWorkspaceElement(this.doc, 'button');
		importBtn.type = 'button';
		importBtn.className = 'zbf-hub-btn';
		importBtn.textContent = '导入 JSON';
		importBtn.addEventListener('click', async () => {
			await importWorkspaceJsonInteractive(
				this.win,
				this.store,
				() => {
					statusEl.textContent = '已导入工作区状态';
					renderLists();
					this.onRefresh();
				},
				() => {
					statusEl.textContent = '导入失败：JSON 格式无效或版本不兼容';
				},
			);
		});

		actions.append(saveBtn, tplBtn, exportBtn, importBtn);

		const listsWrap = createWorkspaceElement(this.doc, 'div');
		listsWrap.className = 'zbf-hub-lists';

		const renderLists = () => {
			listsWrap.textContent = '';
			const suggestions = renderPublicationSuggestionsSection(
				this.doc,
				this.store,
				this.tabs.getPublicationSuggestions(this.win),
				() => {
					statusEl.textContent = '已按期刊 / 会议自动建立文献分组';
					renderLists();
					this.onRefresh();
				},
			);
			if (suggestions) listsWrap.appendChild(suggestions);

			const handlers = {
				win: this.win,
				store: this.store,
				tabs: this.tabs,
				onRestore: (ses: any, merge: boolean) => {
					this.close();
					void this.tabs.restoreSession(this.win, ses, merge).then(() => this.onRefresh());
				},
				onChanged: () => {
					renderLists();
					this.onRefresh();
				},
			};

			listsWrap.appendChild(renderSessionSection(
				this.doc,
				'已保存快照与模板',
				this.store.state.sessions,
				'暂无已保存的快照或模板，可在上方输入名称保存。',
				{ ...handlers, isRolling: false },
			));
			listsWrap.appendChild(renderSessionSection(
				this.doc,
				'自动滚动快照',
				this.store.state.rollingSessions,
				'暂无自动滚动快照。',
				{ ...handlers, isRolling: true },
			));
		};

		renderLists();
		modal.append(header, nameInput, actions, statusEl, listsWrap);
		backdrop.appendChild(modal);
		host.appendChild(backdrop);
		this.positionHubNearAnchor(modal, anchor);
		this.activeBackdrop = backdrop;
		this.win.setTimeout(() => nameInput.focus(), 10);
	}

	private positionHubNearAnchor(modal: HTMLElement, explicitAnchor?: HTMLElement): void {
		const target = explicitAnchor
			|| (this.doc.querySelector('#zbf-toolbar-actions [data-action="workspace"]') as HTMLElement | null)
			|| (this.doc.getElementById('zbf-toolbar-actions') as HTMLElement | null);
		const winW = this.win.innerWidth || 1200;
		const winH = this.win.innerHeight || 800;
		const boxW = Math.min(520, winW - 24);
		modal.style.width = `${boxW}px`;
		modal.style.position = 'fixed';
		modal.style.maxHeight = `${Math.max(260, winH - 72)}px`;

		if (target && typeof target.getBoundingClientRect === 'function') {
			const rect = target.getBoundingClientRect();
			if (rect.width > 0 || rect.height > 0) {
				const top = Math.max(8, Math.min(Math.round(rect.bottom + 6), winH - 220));
				const left = rect.left > winW * 0.45
					? Math.max(12, Math.min(Math.round(rect.right - boxW), winW - boxW - 12))
					: Math.max(12, Math.min(Math.round(rect.left), winW - boxW - 12));
				modal.style.top = `${top}px`;
				modal.style.left = `${left}px`;
				return;
			}
		}
		modal.style.top = '44px';
		modal.style.left = `${Math.max(12, Math.round(winW - boxW - 16))}px`;
	}

	openStaleMenu(anchor: HTMLElement, event?: MouseEvent): void {
		this.close();
		const pop = createFloatingPopup(this.doc, anchor, event, 280);
		if (!pop) return;

		const days = this.prefs.get('workspace.staleSuggestDays');
		const stale = this.tabs.findStaleTabs(this.win);
		const title = createWorkspaceElement(this.doc, 'div');
		title.className = 'zbf-popup-header';
		title.textContent = `建议清理的标签页（超过 ${days} 天未查看：${stale.length} 篇）`;
		pop.appendChild(title);

		if (!stale.length) {
			const empty = createWorkspaceElement(this.doc, 'div');
			empty.className = 'zbf-popup-empty';
			empty.textContent = '当前没有长期未查看的陈旧标签页。';
			pop.appendChild(empty);
		} else {
			for (const tab of stale.slice(0, 12)) {
				const row = createWorkspaceElement(this.doc, 'div');
				row.className = 'zbf-stale-row';

				const label = createWorkspaceElement(this.doc, 'span');
				label.className = 'zbf-stale-title';
				label.textContent = this.tabs.getDisplayTitle(tab);
				label.addEventListener('click', () => {
					this.close();
					this.tabs.selectTab(this.win, tab.tabID);
					this.onRefresh();
				});

				const sleepBtn = createWorkspaceElement(this.doc, 'button');
				sleepBtn.type = 'button';
				sleepBtn.className = 'zbf-mini-btn';
				sleepBtn.textContent = '休眠';
				sleepBtn.addEventListener('click', () => {
					this.tabs.sleepTab(this.win, tab.tabID);
					this.close();
					this.onRefresh();
				});

				const closeBtn = createWorkspaceElement(this.doc, 'button');
				closeBtn.type = 'button';
				closeBtn.className = 'zbf-mini-btn danger';
				closeBtn.textContent = '关闭';
				closeBtn.addEventListener('click', () => {
					void this.tabs.closeTabs(this.win, [tab.tabID], { preserveVirtual: true });
					this.close();
					this.onRefresh();
				});

				row.append(label, sleepBtn, closeBtn);
				pop.appendChild(row);
			}

			addPopupSeparator(this.doc, pop);
			const footer = createWorkspaceElement(this.doc, 'div');
			footer.className = 'zbf-stale-footer';

			const sleepAll = createWorkspaceElement(this.doc, 'button');
			sleepAll.type = 'button';
			sleepAll.className = 'zbf-mini-btn';
			sleepAll.textContent = '全部休眠';
			sleepAll.addEventListener('click', () => {
				for (const t of stale) this.tabs.sleepTab(this.win, t.tabID);
				this.close();
				this.onRefresh();
			});

			const closeAll = createWorkspaceElement(this.doc, 'button');
			closeAll.type = 'button';
			closeAll.className = 'zbf-mini-btn danger';
			closeAll.textContent = '全部关闭';
			closeAll.addEventListener('click', () => {
				void this.tabs.closeTabs(this.win, stale.map((t) => t.tabID), { preserveVirtual: true, protectPinned: true });
				this.close();
				this.onRefresh();
			});

			footer.append(sleepAll, closeAll);
			pop.appendChild(footer);
		}

		this.activePopup = pop;
		this.boundOutside = (e: Event) => {
			if (!pop.contains(e.target as Node)) this.close();
		};
		this.win.setTimeout(() => {
			if (this.boundOutside) this.doc.addEventListener('mousedown', this.boundOutside, true);
		}, 15);
	}

	close(): void {
		this.activeBackdrop?.remove();
		this.activeBackdrop = null;
		this.activePopup?.remove();
		this.activePopup = null;
		if (this.boundOutside) {
			this.doc.removeEventListener('mousedown', this.boundOutside, true);
			this.boundOutside = null;
		}
	}

	destroy(): void {
		this.close();
	}
}
