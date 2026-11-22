import { openTextPromptModal } from './popup-menu-helpers.ts';
import type { WorkspaceStateStore } from './state-store.ts';
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
		openTextPromptModal(win, '工作区 JSON 备份（请全选复制）', '', json, () => { /* readonly copy fallback */ });
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
				if (content && store.importJson(String(content))) {
					onImported();
				}
				return;
			}
			return;
		}
	} catch { /* fall back to paste dialog */ }

	openTextPromptModal(win, '导入工作区 JSON', '请在此粘贴工作区 JSON 内容...', '', (raw) => {
		if (raw && store.importJson(raw)) {
			onImported();
		}
	});
}

export function renderSessionSection(
	doc: Document,
	titleText: string,
	sessions: readonly WorkspaceSession[],
	emptyText: string,
	onRestore: (session: WorkspaceSession) => void,
	onDelete: (sessionId: string) => void,
): HTMLElement {
	const wrap = doc.createElement('div');
	wrap.className = 'zbf-hub-section';

	const heading = doc.createElement('div');
	heading.className = 'zbf-hub-section-title';
	heading.textContent = titleText;
	wrap.appendChild(heading);

	if (!sessions.length) {
		const empty = doc.createElement('div');
		empty.className = 'zbf-hub-empty';
		empty.textContent = emptyText;
		wrap.appendChild(empty);
		return wrap;
	}

	for (const session of sessions) {
		const card = doc.createElement('div');
		card.className = 'zbf-hub-card';

		const info = doc.createElement('div');
		info.className = 'zbf-hub-card-info';
		const nameEl = doc.createElement('div');
		nameEl.className = 'zbf-hub-card-name';
		nameEl.textContent = session.isTemplate ? `[模板] ${session.name}` : session.name;

		const metaEl = doc.createElement('div');
		metaEl.className = 'zbf-hub-card-meta';
		const dt = new Date(session.createdAt || Date.now()).toLocaleString();
		metaEl.textContent = `${dt} · ${session.groups.length} 个分组 · ${session.pinnedKeys.length} 个固定`;
		info.append(nameEl, metaEl);

		const btns = doc.createElement('div');
		btns.className = 'zbf-hub-card-actions';

		const restoreBtn = doc.createElement('button');
		restoreBtn.type = 'button';
		restoreBtn.className = 'zbf-hub-btn primary';
		restoreBtn.textContent = '恢复';
		restoreBtn.addEventListener('click', () => onRestore(session));

		const delBtn = doc.createElement('button');
		delBtn.type = 'button';
		delBtn.className = 'zbf-hub-btn';
		delBtn.textContent = '删除';
		delBtn.addEventListener('click', () => onDelete(session.id));

		btns.append(restoreBtn, delBtn);
		card.append(info, btns);
		wrap.appendChild(card);
	}

	return wrap;
}
