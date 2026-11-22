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
	const box = doc.createElement('div');
	box.className = 'zbf-sb-empty';
	const msg = doc.createElement('div');
	msg.textContent = hasAnyTabs ? '未找到匹配的文献标签页' : '当前没有打开的文献标签页';
	box.appendChild(msg);

	if (hasAnyTabs) {
		const clearBtn = doc.createElement('button');
		clearBtn.type = 'button';
		clearBtn.className = 'zbf-sb-empty-btn';
		clearBtn.textContent = '清除搜索条件';
		clearBtn.addEventListener('click', onClearSearch);
		box.appendChild(clearBtn);
	} else {
		const libBtn = doc.createElement('button');
		libBtn.type = 'button';
		libBtn.className = 'zbf-sb-empty-btn';
		libBtn.textContent = '返回「我的文库」';
		libBtn.addEventListener('click', () => (win as any).Zotero_Tabs?.select?.('zotero-pane'));
		const sesBtn = doc.createElement('button');
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

	const counts = doc.createElement('span');
	counts.textContent = `活动 ${active} · 休眠 ${sleeping} · 虚拟 ${virtual}`;
	statusEl.appendChild(counts);

	const budget = prefs.get('workspace.activeReaderBudget');
	if (budget > 0 && active > budget && prefs.get('workspace.enableTabSleep')) {
		const warn = doc.createElement('button');
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
	const head = doc.createElement('div');
	head.className = 'zbf-sb-group-head';
	head.tabIndex = 0;
	head.setAttribute('data-zbf-nav', 'head');
	const dot = doc.createElement('span');
	dot.className = 'zbf-sb-group-dot';
	dot.style.background = color;
	const span = doc.createElement('span');
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
		const rowHead = doc.createElement('div');
		rowHead.className = 'zbf-sb-group-head-row';
		const h = doc.createElement('div');
		h.className = 'zbf-sb-group-head';
		h.textContent = `📁 ${colName} (${colTabs.length})`;
		rowHead.appendChild(h);
		if (colName !== '未分类') {
			const toGrp = doc.createElement('button');
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
