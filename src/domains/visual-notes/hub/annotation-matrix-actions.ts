import type { TypedEventBus } from '../../../kernel/event-bus.ts';
import type { UnifiedPrefService } from '../../../kernel/pref-service.ts';
import type { UnifiedClipboardService } from '../../../services/clipboard-service.ts';
import {
	renderMatrixCsv,
	renderMatrixMarkdown,
	saveMatrixAsZoteroNote,
	type AnnotationMatrix,
} from '../../../services/annotation-matrix.ts';
import { matrixEl as el, writeMatrixClipboard } from './annotation-matrix-ui.ts';

export function mountAnnotationMatrixFooterActions(opts: {
	doc: Document;
	win: Window;
	title: string;
	libraryID?: number;
	prefs: UnifiedPrefService;
	bus?: TypedEventBus;
	clipboard?: UnifiedClipboardService;
	statusEl: HTMLElement;
	selectedIDs: ReadonlySet<number>;
	getCurrentMatrix: () => AnnotationMatrix;
	flushFilterIfPending: () => void;
}): HTMLElement {
	const { doc, win, title, libraryID, prefs, bus, clipboard, statusEl, selectedIDs, getCurrentMatrix, flushFilterIfPending } = opts;
	const hostItems = (globalThis as any).Zotero?.Items;
	const actions = el(doc, 'div');
	actions.className = 'zbf-matrix-actions';

	const mkBtn = (label: string, primary: boolean, onClick: () => void) => {
		const b = el(doc, 'button') as HTMLButtonElement;
		b.type = 'button';
		b.className = primary ? 'zbf-matrix-btn primary' : 'zbf-matrix-btn';
		b.textContent = label;
		b.addEventListener('click', () => {
			flushFilterIfPending();
			onClick();
		});
		actions.appendChild(b);
	};

	mkBtn('存为 Zotero 笔记', true, () => {
		void saveMatrixAsZoteroNote(getCurrentMatrix(), `文献对比矩阵 · ${title}`, libraryID).then(async (id) => {
			statusEl.textContent = id ? `✓ 已生成并打开笔记 (#${id})` : '✕ 生成笔记失败';
			if (id) {
				try { await (globalThis as any).Zotero?.Notes?.open?.(id, undefined, { openInWindow: false }); } catch { /* ignore */ }
			}
		});
	});
	mkBtn('复制 Markdown', false, () => {
		statusEl.textContent = writeMatrixClipboard(renderMatrixMarkdown(getCurrentMatrix(), title), clipboard)
			? '✓ 已复制 Markdown 表格'
			: '✕ 复制失败';
	});
	mkBtn('复制 CSV', false, () => {
		statusEl.textContent = writeMatrixClipboard(renderMatrixCsv(getCurrentMatrix()), clipboard)
			? '✓ 已复制 CSV'
			: '✕ 复制失败';
	});
	if (clipboard) {
		mkBtn('复制勾选 CSL 引文', false, () => {
			const targets = getCurrentMatrix().rows.filter((r) => selectedIDs.has(r.itemID)).map((r) => hostItems?.get?.(r.itemID)).filter(Boolean);
			if (!targets.length) { statusEl.textContent = '请先勾选至少一篇文献'; return; }
			void clipboard.copyItems(targets, { source: 'tab-menu' }).then((ok) => {
				statusEl.textContent = ok ? `✓ 已复制 ${targets.length} 篇 CSL 引文并记入反查历史` : '✕ 复制引文失败';
			});
		});
	}
	if (bus && prefs.get('modules.wordCite.enable')) {
		mkBtn('合并插入 Word', false, () => {
			const ids = getCurrentMatrix().rows.filter((r) => selectedIDs.has(r.itemID)).map((r) => r.itemID);
			if (!ids.length) { statusEl.textContent = '请先勾选至少一篇文献'; return; }
			bus.emit('word:insert-items-request', { itemIDs: ids, win });
			statusEl.textContent = `✓ 已发送 ${ids.length} 篇文献到 Word`;
		});
	}

	return actions;
}
