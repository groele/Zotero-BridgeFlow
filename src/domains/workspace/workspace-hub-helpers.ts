import { openTextPromptModal } from './popup-menu-helpers.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import type { WorkspaceTabController } from './tab-controller.ts';
import type { PublicationGroupSuggestion } from './tab-actions-helpers.ts';
import type { WorkspaceSession } from './types.ts';

export async function exportWorkspaceJson(win: Window, store: WorkspaceStateStore): Promise<string> {
	const json = store.exportJson();
	const ZoteroObj = (globalThis as any).Zotero;
	try {
		const fp = ZoteroObj?.File?.FilePicker ? new ZoteroObj.File.FilePicker() : null;
		if (fp?.init) {
			fp.init(win, '导出工作区备份 (JSON)', fp.modeSave ?? 1);
			fp.appendFilter('JSON 文件', '*.json');
			fp.defaultString = `BridgeFlow-Workspace-${new Date().toISOString().slice(0, 10)}.json`;
			const rv = await fp.show();
			if (rv !== undefined && fp.file) {
				await ZoteroObj.File.putContentsAsync(fp.file, json);
				return '已导出工作区 JSON 文件';
			}
			return '';
		}
	} catch { /* fall back to clipboard */ }

	try {
		await win.navigator.clipboard?.writeText?.(json);
		return '已复制工作区 JSON 到剪贴板';
	} catch {
		openTextPromptModal(win, '工作区 JSON 备份（请全选复制）', '', json, () => { /* readonly */ });
		return '';
	}
}

export async function importWorkspaceJsonInteractive(
	win: Window,
	store: WorkspaceStateStore,
	onImported: () => void,
): Promise<void> {
	const ZoteroObj = (globalThis as any).Zotero;
	try {
		const fp = ZoteroObj?.File?.FilePicker ? new ZoteroObj.File.FilePicker() : null;
		if (fp?.init) {
			fp.init(win, '导入工作区备份 (JSON)', fp.modeOpen ?? 0);
			fp.appendFilter('JSON 文件', '*.json');
			const rv = await fp.show();
			if (rv !== undefined && fp.file) {
				const content = await ZoteroObj.File.getContentsAsync(fp.file);
				if (content && store.importJson(String(content))) onImported();
				return;
			}
			return;
		}
	} catch { /* fall back to paste dialog */ }

	openTextPromptModal(win, '导入工作区 JSON', '请在此粘贴工作区 JSON 内容...', '', (raw) => {
		if (raw && store.importJson(raw)) onImported();
	});
}

export function renderPublicationSuggestionsSection(
	doc: Document,
	store: WorkspaceStateStore,
	suggestions: readonly PublicationGroupSuggestion[],
	onApplied: () => void,
): HTMLElement | null {
	if (!suggestions.length) return null;
	const wrap = doc.createElement('div');
	wrap.className = 'zbf-hub-section';

	const heading = doc.createElement('div');
	heading.className = 'zbf-hub-section-title';
	heading.textContent = `期刊 / 会议智能分组建议 (${suggestions.length})`;
	wrap.appendChild(heading);

	for (const sug of suggestions.slice(0, 5)) {
		const card = doc.createElement('div');
		card.className = 'zbf-hub-card';

		const info = doc.createElement('div');
		info.className = 'zbf-hub-card-info';
		const nameEl = doc.createElement('div');
		nameEl.className = 'zbf-hub-card-name';
		nameEl.textContent = `📚 ${sug.venue}`;
		const metaEl = doc.createElement('div');
		metaEl.className = 'zbf-hub-card-meta';
		metaEl.textContent = `${sug.keys.length} 篇同源未分组文献`;
		info.append(nameEl, metaEl);

		const applyBtn = doc.createElement('button');
		applyBtn.type = 'button';
		applyBtn.className = 'zbf-hub-btn primary';
		applyBtn.textContent = '一键归组';
		applyBtn.addEventListener('click', () => {
			const group = store.state.groups.find((g) => g.name === sug.venue) ?? store.createGroup(sug.venue);
			for (const k of sug.keys) store.assignToGroup(k, group.id);
			onApplied();
		});
		card.append(info, applyBtn);
		wrap.appendChild(card);
	}
	return wrap;
}

export interface SessionSectionHandlers {
	win: Window;
	store: WorkspaceStateStore;
	tabs: WorkspaceTabController;
	isRolling?: boolean;
	onRestore: (session: WorkspaceSession, merge: boolean) => void;
	onChanged: () => void;
}

export function renderSessionSection(
	doc: Document,
	titleText: string,
	sessions: readonly WorkspaceSession[],
	emptyText: string,
	handlers: SessionSectionHandlers,
): HTMLElement {
	const wrap = doc.createElement('div');
	wrap.className = 'zbf-hub-section';

	const heading = doc.createElement('div');
	heading.className = 'zbf-hub-section-title';
	heading.textContent = `${titleText} (${sessions.length})`;
	wrap.appendChild(heading);

	if (!sessions.length) {
		const empty = doc.createElement('div');
		empty.className = 'zbf-hub-empty';
		empty.textContent = emptyText;
		wrap.appendChild(empty);
		return wrap;
	}

	const { win, store, isRolling, onRestore, onChanged } = handlers;
	for (const session of sessions) {
		const card = doc.createElement('div');
		card.className = 'zbf-hub-card';

		const info = doc.createElement('div');
		info.className = 'zbf-hub-card-info';
		const icon = session.isTemplate ? '📐 ' : session.kind === 'pre-replace' ? '↩ ' : isRolling ? '🕒 ' : '💾 ';
		const nameEl = doc.createElement('div');
		nameEl.className = 'zbf-hub-card-name';
		nameEl.textContent = `${icon}${session.name}`;

		const metaEl = doc.createElement('div');
		metaEl.className = 'zbf-hub-card-meta';
		const dt = new Date(session.createdAt || Date.now()).toLocaleString();
		metaEl.textContent = `${dt} · ${session.groups.length} 个分组 · ${session.pinnedKeys.length} 个固定`;
		info.append(nameEl, metaEl);

		const btns = doc.createElement('div');
		btns.className = 'zbf-hub-card-actions';

		const mergeBtn = doc.createElement('button');
		mergeBtn.type = 'button';
		mergeBtn.className = 'zbf-hub-btn primary';
		mergeBtn.textContent = '合并恢复';
		mergeBtn.title = '保留当前已打开文献与分组，合并会话布局并后台补开缺失文献';
		mergeBtn.addEventListener('click', () => onRestore(session, true));

		const replaceBtn = doc.createElement('button');
		replaceBtn.type = 'button';
		replaceBtn.className = 'zbf-hub-btn';
		replaceBtn.textContent = '替换';
		replaceBtn.title = '自动先保存恢复前备份，再替换为该快照布局';
		replaceBtn.addEventListener('click', () => onRestore(session, false));
		btns.append(mergeBtn, replaceBtn);

		if (isRolling) {
			const promoteBtn = doc.createElement('button');
			promoteBtn.type = 'button';
			promoteBtn.className = 'zbf-hub-btn';
			promoteBtn.textContent = '转存';
			promoteBtn.addEventListener('click', () => {
				if (store.promoteRollingSession(session.id)) onChanged();
			});
			btns.appendChild(promoteBtn);
		} else if (session.kind !== 'pre-replace') {
			const updateBtn = doc.createElement('button');
			updateBtn.type = 'button';
			updateBtn.className = 'zbf-hub-btn';
			updateBtn.textContent = '更新';
			updateBtn.addEventListener('click', () => {
				if (store.updateSession(session.id)) onChanged();
			});
			const renameBtn = doc.createElement('button');
			renameBtn.type = 'button';
			renameBtn.className = 'zbf-hub-btn';
			renameBtn.textContent = '重命名';
			renameBtn.addEventListener('click', () => {
				openTextPromptModal(win, '重命名快照', '输入新名称...', session.name, (val) => {
					if (store.renameSession(session.id, val)) onChanged();
				});
			});
			btns.append(updateBtn, renameBtn);
		}

		const delBtn = doc.createElement('button');
		delBtn.type = 'button';
		delBtn.className = 'zbf-hub-btn';
		delBtn.textContent = '删除';
		delBtn.addEventListener('click', () => {
			if (store.deleteSession(session.id)) onChanged();
		});
		btns.appendChild(delBtn);

		card.append(info, btns);
		wrap.appendChild(card);
	}

	return wrap;
}
