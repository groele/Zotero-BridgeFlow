import { createWorkspaceElement } from './workspace-elements.ts';
import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import { buildSidebarTabRow, type SidebarRowDeps } from './sidebar-list-helpers.ts';
import type { WorkspaceTabController } from './tab-controller.ts';
import type { TrackedTab } from './types.ts';

export function renderSidebarEmptyBox(
	doc: Document,
	win: Window,
	hasAnyTabs: boolean,
	onClearSearch: () => void,
	onOpenHub: () => void,
): HTMLElement {
	const box = createWorkspaceElement(doc, 'div');
	box.className = 'zbf-sb-empty';
	const msg = createWorkspaceElement(doc, 'div');
	msg.textContent = hasAnyTabs ? '未找到匹配的文献标签页' : '当前没有打开的文献标签页';
	box.appendChild(msg);

	if (hasAnyTabs) {
		const clearBtn = createWorkspaceElement(doc, 'button');
		clearBtn.type = 'button';
		clearBtn.className = 'zbf-sb-empty-btn';
		clearBtn.textContent = '清除搜索条件';
		clearBtn.addEventListener('click', onClearSearch);
		box.appendChild(clearBtn);
	} else {
		const libBtn = createWorkspaceElement(doc, 'button');
		libBtn.type = 'button';
		libBtn.className = 'zbf-sb-empty-btn';
		libBtn.textContent = '返回「我的文库」';
		libBtn.addEventListener('click', () => (win as any).Zotero_Tabs?.select?.('zotero-pane'));
		const sesBtn = createWorkspaceElement(doc, 'button');
		sesBtn.type = 'button';
		sesBtn.className = 'zbf-sb-empty-btn';
		sesBtn.textContent = '恢复最近会话快照';
		sesBtn.addEventListener('click', onOpenHub);
		box.append(libBtn, sesBtn);
	}
	return box;
}

export function renderSidebarStatusBar(
	doc: Document,
	win: Window,
	statusEl: HTMLElement,
	prefs: UnifiedPrefService,
	tabs: WorkspaceTabController,
	allTracked: readonly TrackedTab[],
	onRefresh: () => void,
): void {
	statusEl.textContent = '';
	const active = allTracked.filter((t) => !t.virtual && !t.sleeping).length;
	const sleeping = allTracked.filter((t) => !t.virtual && t.sleeping).length;
	const virtual = allTracked.filter((t) => t.virtual).length;

	const counts = createWorkspaceElement(doc, 'span');
	counts.textContent = `活动 ${active} · 休眠 ${sleeping} · 虚拟 ${virtual}`;
	statusEl.appendChild(counts);

	const budget = prefs.get('workspace.activeReaderBudget');
	if (budget > 0 && active > budget && prefs.get('workspace.enableTabSleep')) {
		const warn = createWorkspaceElement(doc, 'button');
		warn.type = 'button';
		warn.className = 'zbf-sb-budget-warn';
		warn.textContent = `超出 ${budget} 篇上限 · 休眠后台`;
		warn.addEventListener('click', () => {
			tabs.sleepInactiveTabs(win);
			onRefresh();
		});
		statusEl.appendChild(warn);
	}
}

export function appendSidebarSectionHead(doc: Document, listEl: HTMLElement, title: string, color: string): void {
	const head = createWorkspaceElement(doc, 'div');
	head.className = 'zbf-sb-group-head';
	head.tabIndex = 0;
	head.setAttribute('data-zbf-nav', 'head');
	const dot = createWorkspaceElement(doc, 'span');
	dot.className = 'zbf-sb-group-dot';
	dot.style.background = color;
	const span = createWorkspaceElement(doc, 'span');
	span.textContent = title;
	head.append(dot, span);
	listEl.appendChild(head);
}

export function renderSidebarCollectionsList(
	listEl: HTMLElement,
	rowDeps: SidebarRowDeps,
	filtered: readonly TrackedTab[],
): void {
	const { doc, win, tabs, onRefresh } = rowDeps;
	const byCol = new Map<string, TrackedTab[]>();
	for (const tab of filtered) {
		const col = tab.collection || '未分类';
		const arr = byCol.get(col) || [];
		arr.push(tab);
		byCol.set(col, arr);
	}
	for (const [colName, colTabs] of byCol) {
		const rowHead = createWorkspaceElement(doc, 'div');
		rowHead.className = 'zbf-sb-group-head-row';
		const h = createWorkspaceElement(doc, 'div');
		h.className = 'zbf-sb-group-head';
		h.textContent = `📁 ${colName} (${colTabs.length})`;
		rowHead.appendChild(h);
		if (colName !== '未分类') {
			const toGrp = createWorkspaceElement(doc, 'button');
			toGrp.type = 'button';
			toGrp.className = 'zbf-sb-col-group-btn';
			toGrp.textContent = '+';
			toGrp.title = `将集合「${colName}」转为标签分组`;
			toGrp.addEventListener('click', () => {
				tabs.collectionToGroup(win, colName);
				onRefresh();
			});
			rowHead.appendChild(toGrp);
		}
		listEl.appendChild(rowHead);
		for (const tab of colTabs) listEl.appendChild(buildSidebarTabRow(rowDeps, tab));
	}
}

export function renderSidebarSavedSessionsSection(
	listEl: HTMLElement,
	rowDeps: SidebarRowDeps,
	searchTerm = '',
): void {
	const { doc, win, prefs, store, tabs, onRefresh } = rowDeps;
	if (!prefs.get('workspace.enableSessions')) return;
	const needle = searchTerm.trim().toLowerCase();
	const saved = store.state.sessions.filter((s) => !s.isTemplate);
	if (!saved.length) return;

	appendSidebarSectionHead(doc, listEl, `已保存的分组与快照 (${saved.length})`, '#0D9488');

	for (const ses of saved) {
		const itemKeys = [...new Set([
			...ses.openKeys,
			...ses.groups.flatMap((g) => g.memberKeys),
			...Object.keys(ses.virtualMembers),
		])].filter((k) => k.startsWith('item:'));

		const matchingKeys = needle
			? itemKeys.filter((k) => {
				const m = ses.virtualMembers[k] || store.state.virtualMembers[k];
				return `${ses.name} ${m?.title || ''} ${m?.creatorYear || ''} ${m?.source || ''}`.toLowerCase().includes(needle);
			})
			: itemKeys;
		if (needle && !matchingKeys.length && !ses.name.toLowerCase().includes(needle)) continue;

		const rowHead = createWorkspaceElement(doc, 'div');
		rowHead.className = 'zbf-sb-group-head-row';
		const h = createWorkspaceElement(doc, 'div');
		h.className = 'zbf-sb-group-head';
		h.textContent = `💾 ${ses.name} (${itemKeys.length} 篇)`;
		rowHead.appendChild(h);

		const openAllBtn = createWorkspaceElement(doc, 'button');
		openAllBtn.type = 'button';
		openAllBtn.className = 'zbf-sb-col-group-btn';
		openAllBtn.textContent = '重开';
		openAllBtn.title = `重新打开「${ses.name}」及其保存的 ${itemKeys.length} 篇文献`;
		openAllBtn.addEventListener('click', () => {
			void tabs.restoreSession(win, ses, true).then(() => onRefresh());
		});
		rowHead.appendChild(openAllBtn);
		listEl.appendChild(rowHead);

		for (const key of matchingKeys.slice(0, 15)) {
			const meta = ses.virtualMembers[key] || store.state.virtualMembers[key];
			const rawID = Number(meta?.itemID || key.replace(/^item:/, '') || 0);
			const zotItem = rawID > 0 ? (globalThis as any).Zotero?.Items?.get?.(rawID) : null;
			const rawTitleStr = meta?.title || zotItem?.getField?.('title') || `文献条目 #${rawID}`;
			const titleStr = String(rawTitleStr).replace(/<[^>]*>/g, '');
			const subStr = [meta?.creatorYear, meta?.source].filter(Boolean).join(' · ');

			const itemRow = createWorkspaceElement(doc, 'div');
			itemRow.className = 'zbf-vtab-row virtual';
			itemRow.title = `${titleStr}${subStr ? `\n${subStr}` : ''}\n点击重新打开此文献`;
			const main = createWorkspaceElement(doc, 'div');
			main.className = 'zbf-vtab-main';
			const tEl = createWorkspaceElement(doc, 'div');
			tEl.className = 'zbf-vtab-title';
			tEl.textContent = `📄 ${titleStr}`;
			main.appendChild(tEl);
			if (subStr) {
				const sEl = createWorkspaceElement(doc, 'div');
				sEl.className = 'zbf-vtab-sub';
				sEl.textContent = subStr;
				main.appendChild(sEl);
			}
			itemRow.appendChild(main);
			itemRow.addEventListener('click', () => {
				if (rawID > 0) {
					const grp = ses.groups[0];
					let targetGroupId: string | undefined;
					if (grp) {
						const existing = store.state.groups.find((g) => g.id === grp.id || g.name === grp.name)
							?? store.createGroup(grp.name, grp.color);
						targetGroupId = existing.id;
					}
					void tabs.openVirtualOrItem(win, rawID, targetGroupId, false).then(() => onRefresh());
				}
			});
			listEl.appendChild(itemRow);
		}
	}
}
