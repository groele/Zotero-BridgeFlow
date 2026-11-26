import { createWorkspaceElement } from '../workspace-elements.ts';
import { openTextPromptModal } from '../tabs/popup-menu-helpers.ts';
import type { WorkspaceStateStore } from '../store/state-store.ts';
import type { WorkspaceTabController } from '../tabs/tab-controller.ts';
import type { PublicationGroupSuggestion } from '../tabs/tab-actions-helpers.ts';
import type { WorkspaceSession } from '../types.ts';

export async function exportWorkspaceJson(win: Window, store: WorkspaceStateStore): Promise<string> {
	const json = store.exportJson();
	const ZoteroObj = (globalThis as any).Zotero;
	try {
		const { FilePicker } = (globalThis as any).ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
		const fp = new FilePicker();
		if (fp?.init) {
			fp.init(win, '导出工作区备份 (JSON)', fp.modeSave ?? 1);
			fp.appendFilter('JSON 文件', '*.json');
			fp.defaultString = `BridgeFlow-Workspace-${new Date().toISOString().slice(0, 10)}.json`;
			const rv = await fp.show();
			if ((rv === fp.returnOK || rv === fp.returnReplace) && fp.file) {
				await ZoteroObj.File.putContentsAsync(fp.file, json);
				return '已导出工作区 JSON 文件';
			}
			return '';
		}
	} catch { /* fall back to clipboard */ }

	try {
		await win.navigator.clipboard.writeText(json);
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
	onInvalid?: () => void,
): Promise<void> {
	const ZoteroObj = (globalThis as any).Zotero;
	try {
		const { FilePicker } = (globalThis as any).ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
		const fp = new FilePicker();
		if (fp?.init) {
			fp.init(win, '导入工作区备份 (JSON)', fp.modeOpen ?? 0);
			fp.appendFilter('JSON 文件', '*.json');
			const rv = await fp.show();
			if (rv === fp.returnOK && fp.file) {
				const content = await ZoteroObj.File.getContentsAsync(fp.file);
				if (content && store.importAnyJson(String(content))) onImported();
				else if (content) onInvalid?.();
				return;
			}
			return;
		}
	} catch { /* fall back to paste dialog */ }

	openTextPromptModal(win, '导入工作区 JSON', '请在此粘贴工作区 / 阅读进度 / 简注 JSON 内容...', '', (raw) => {
		if (raw && store.importAnyJson(raw)) onImported();
		else if (raw?.trim()) onInvalid?.();
	});
}

export function renderPublicationSuggestionsSection(
	doc: Document,
	store: WorkspaceStateStore,
	suggestions: readonly PublicationGroupSuggestion[],
	onApplied: () => void,
): HTMLElement | null {
	if (!suggestions.length) return null;
	const wrap = createWorkspaceElement(doc, 'div');
	wrap.className = 'zbf-hub-section';

	const heading = createWorkspaceElement(doc, 'div');
	heading.className = 'zbf-hub-section-title';
	heading.textContent = `期刊 / 会议智能分组建议 (${suggestions.length})`;
	wrap.appendChild(heading);

	for (const sug of suggestions.slice(0, 5)) {
		const card = createWorkspaceElement(doc, 'div');
		card.className = 'zbf-hub-card';

		const topRow = createWorkspaceElement(doc, 'div');
		topRow.className = 'zbf-hub-card-top';
		const info = createWorkspaceElement(doc, 'div');
		info.className = 'zbf-hub-card-info';
		const nameEl = createWorkspaceElement(doc, 'div');
		nameEl.className = 'zbf-hub-card-name';
		nameEl.textContent = `📚 ${sug.venue}`;
		const metaEl = createWorkspaceElement(doc, 'div');
		metaEl.className = 'zbf-hub-card-meta';
		metaEl.textContent = `${sug.keys.length} 篇同源未分组文献`;
		info.append(nameEl, metaEl);

		const applyBtn = createWorkspaceElement(doc, 'button');
		applyBtn.type = 'button';
		applyBtn.className = 'zbf-hub-btn primary';
		applyBtn.textContent = '一键归组';
		applyBtn.addEventListener('click', () => {
			const group = store.state.groups.find((g) => g.name === sug.venue) ?? store.createGroup(sug.venue);
			for (const k of sug.keys) store.assignToGroup(k, group.id);
			onApplied();
		});
		topRow.append(info, applyBtn);
		card.appendChild(topRow);
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
	const wrap = createWorkspaceElement(doc, 'div');
	wrap.className = 'zbf-hub-section';

	const heading = createWorkspaceElement(doc, 'div');
	heading.className = 'zbf-hub-section-title';
	heading.textContent = `${titleText} (${sessions.length})`;
	wrap.appendChild(heading);

	if (!sessions.length) {
		const empty = createWorkspaceElement(doc, 'div');
		empty.className = 'zbf-hub-empty';
		empty.textContent = emptyText;
		wrap.appendChild(empty);
		return wrap;
	}

	const { win, store, isRolling, onRestore, onChanged } = handlers;
	for (const session of sessions) {
		const card = createWorkspaceElement(doc, 'div');
		card.className = 'zbf-hub-card';

		const topRow = createWorkspaceElement(doc, 'div');
		topRow.className = 'zbf-hub-card-top';

		const info = createWorkspaceElement(doc, 'div');
		info.className = 'zbf-hub-card-info';
		const icon = session.isTemplate ? '📐 ' : session.kind === 'pre-replace' ? '↩ ' : isRolling ? '🕒 ' : '💾 ';
		const nameEl = createWorkspaceElement(doc, 'div');
		nameEl.className = 'zbf-hub-card-name';
		nameEl.textContent = `${icon}${session.name}`;

		const itemKeys = [...new Set([
			...session.openKeys,
			...session.groups.flatMap((g) => g.memberKeys),
			...Object.keys(session.virtualMembers),
		])].filter((k) => k.startsWith('item:'));

		const metaEl = createWorkspaceElement(doc, 'div');
		metaEl.className = 'zbf-hub-card-meta';
		const dt = new Date(session.createdAt || Date.now()).toLocaleString();
		metaEl.textContent = `${itemKeys.length} 篇文献 · ${session.groups.length} 个分组 · ${dt}`;
		info.append(nameEl, metaEl);

		const btns = createWorkspaceElement(doc, 'div');
		btns.className = 'zbf-hub-card-actions';

		const mergeBtn = createWorkspaceElement(doc, 'button');
		mergeBtn.type = 'button';
		mergeBtn.className = 'zbf-hub-btn primary';
		mergeBtn.textContent = '重新打开';
		mergeBtn.title = '保留当前已打开文献与分组，重新打开该快照保存的分组与全部文献条目';
		mergeBtn.addEventListener('click', () => onRestore(session, true));

		const replaceBtn = createWorkspaceElement(doc, 'button');
		replaceBtn.type = 'button';
		replaceBtn.className = 'zbf-hub-btn';
		replaceBtn.textContent = '替换布局';
		replaceBtn.title = '自动先保存恢复前备份，再替换为该快照布局';
		replaceBtn.addEventListener('click', () => onRestore(session, false));
		btns.append(mergeBtn, replaceBtn);

		if (isRolling) {
			const promoteBtn = createWorkspaceElement(doc, 'button');
			promoteBtn.type = 'button';
			promoteBtn.className = 'zbf-hub-btn';
			promoteBtn.textContent = '转存';
			promoteBtn.addEventListener('click', () => {
				if (store.promoteRollingSession(session.id)) onChanged();
			});
			btns.appendChild(promoteBtn);
		} else if (session.kind !== 'pre-replace') {
			const updateBtn = createWorkspaceElement(doc, 'button');
			updateBtn.type = 'button';
			updateBtn.className = 'zbf-hub-btn';
			updateBtn.textContent = '更新';
			updateBtn.addEventListener('click', () => {
				if (store.updateSession(session.id, handlers.tabs.openKeys(win))) onChanged();
			});
			const renameBtn = createWorkspaceElement(doc, 'button');
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

		const delBtn = createWorkspaceElement(doc, 'button');
		delBtn.type = 'button';
		delBtn.className = 'zbf-hub-btn';
		delBtn.textContent = '删除';
		delBtn.addEventListener('click', () => {
			if (store.deleteSession(session.id)) onChanged();
		});
		btns.appendChild(delBtn);

		topRow.append(info, btns);
		card.appendChild(topRow);

		if (itemKeys.length && !session.isTemplate) {
			const itemsBox = createWorkspaceElement(doc, 'div');
			itemsBox.className = 'zbf-hub-items';
			for (const key of itemKeys.slice(0, 12)) {
				const meta = session.virtualMembers[key] || store.state.virtualMembers[key];
				const rawID = Number(meta?.itemID || key.replace(/^item:/, '') || 0);
				const zotItem = rawID > 0 ? (globalThis as any).Zotero?.Items?.get?.(rawID) : null;
				const rawTitleStr = meta?.title || zotItem?.getField?.('title') || `文献条目 #${rawID}`;
				const titleStr = String(rawTitleStr).replace(/<[^>]*>/g, '');
				const subStr = [meta?.creatorYear, meta?.source].filter(Boolean).join(' · ');

				const row = createWorkspaceElement(doc, 'button');
				row.type = 'button';
				row.className = 'zbf-hub-item-row';
				row.title = '点击单独打开此篇文献';
				const label = createWorkspaceElement(doc, 'span');
				label.className = 'zbf-hub-item-title';
				label.textContent = `📄 ${titleStr}${subStr ? ` (${subStr})` : ''}`;
				row.appendChild(label);
				row.addEventListener('click', () => {
					if (rawID > 0) {
						const grpId = session.groups.find((g) => g.memberKeys.includes(key))?.id;
						void handlers.tabs.openVirtualOrItem(win, rawID, grpId, false);
					}
				});
				itemsBox.appendChild(row);
			}
			card.appendChild(itemsBox);
		}
		wrap.appendChild(card);
	}

	return wrap;
}
