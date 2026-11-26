import type { TypedEventBus } from '../../../kernel/event-bus.ts';
import type { UnifiedPrefService } from '../../../kernel/pref-service.ts';
import type { UnifiedClipboardService } from '../../../services/clipboard-service.ts';
import { renderCollectionHubMarkdown, saveCollectionHubAsZoteroNote } from '../../../services/collection-notes.ts';
import { openAnnotationMatrixModal } from './annotation-matrix-modal.ts';
import { writeMatrixClipboard } from './annotation-matrix-ui.ts';
import { hubEl } from './collection-notes-ui.ts';

export function mountCollectionHubFooterActions(opts: {
	doc: Document;
	win: Window;
	container: HTMLElement;
	prefs: UnifiedPrefService;
	bus?: TypedEventBus;
	clipboard?: UnifiedClipboardService;
	statusEl: HTMLElement;
	zh: boolean;
	getPreferComment: () => boolean;
	computeCurrent: () => { scope: { scopeTitle: string; items: readonly any[]; libraryID?: number; collectionID?: number }; annData: any; notesData: any };
}): HTMLElement {
	const { doc, win, container, prefs, bus, clipboard, statusEl, zh, getPreferComment, computeCurrent } = opts;
	const actions = hubEl(doc, 'div');
	actions.className = 'zbf-matrix-actions';

	const flashBtn = (btn: HTMLButtonElement, tempText: string) => {
		const orig = btn.dataset.origLabel || btn.textContent || '';
		btn.dataset.origLabel = orig;
		btn.textContent = tempText;
		doc.defaultView?.setTimeout?.(() => {
			if (btn.isConnected) btn.textContent = orig;
		}, 1800);
	};
	const addBtn = (lbl: string, primary: boolean, fn: (btn: HTMLButtonElement) => void) => {
		const b = hubEl(doc, 'button');
		b.type = 'button';
		b.className = primary ? 'zbf-matrix-btn primary' : 'zbf-matrix-btn';
		b.textContent = lbl;
		b.addEventListener('click', () => fn(b));
		actions.appendChild(b);
	};

	addBtn(zh ? '打开文献对比矩阵' : 'Open Matrix View', false, () => {
		const { scope } = computeCurrent();
		const ids = scope.items.map((it) => Number(it.id)).filter((id) => id > 0);
		openAnnotationMatrixModal({
			win, title: scope.scopeTitle, itemIDs: ids,
			prefs, bus, clipboard, mountRoot: container,
		});
	});

	addBtn(zh ? '复制 Markdown 综述汇总' : 'Copy Markdown Synthesis', false, (btn) => {
		const { scope, annData, notesData } = computeCurrent();
		if (!annData.annotations.length && !notesData.totalBriefNotes && !notesData.totalChildNotes) {
			statusEl.textContent = zh ? '当前范围暂无可复制的笔记或标注' : 'Nothing to copy in current scope';
			flashBtn(btn, zh ? '暂无内容' : 'Empty');
			return;
		}
		const md = renderCollectionHubMarkdown(`${scope.scopeTitle} · 笔记与标注汇总`, notesData.entries, annData.annotations, getPreferComment());
		const ok = writeMatrixClipboard(md, clipboard);
		statusEl.textContent = ok ? (zh ? `✓ 已复制 Markdown 综述（${md.length} 字）` : `✓ Copied Markdown (${md.length} chars)`) : '✕ Copy failed';
		flashBtn(btn, ok ? (zh ? '✓ 已复制到剪贴板' : '✓ Copied!') : '✕ 失败');
	});

	let savingNote = false;
	addBtn(zh ? '保存为当前分类 Zotero 笔记' : 'Save as Zotero Note', true, (btn) => {
		if (savingNote) return;
		const { scope, annData, notesData } = computeCurrent();
		if (!annData.annotations.length && !notesData.totalBriefNotes && !notesData.totalChildNotes) {
			statusEl.textContent = zh ? '当前范围暂无可汇总的笔记或标注' : 'No notes or annotations to save';
			flashBtn(btn, zh ? '暂无可保存内容' : 'Nothing to save');
			return;
		}
		savingNote = true;
		statusEl.textContent = zh ? '正在生成 Zotero 汇总笔记…' : 'Saving Zotero note…';
		void saveCollectionHubAsZoteroNote({
			heading: `${scope.scopeTitle} · 笔记与标注汇总`, notes: notesData.entries, annotations: annData.annotations,
			preferCommentOverQuote: getPreferComment(), libraryID: scope.libraryID, collectionID: scope.collectionID,
		}).then(async (nid) => {
			if (!nid) { statusEl.textContent = '✕ Failed to save note'; return; }
			statusEl.textContent = zh ? `✓ 已生成并打开汇总笔记 (#${nid})` : `✓ Saved & opened Note (#${nid})`;
			flashBtn(btn, zh ? `✓ 已打开笔记 #${nid}` : `✓ Opened #${nid}`);
			const zNotes = (globalThis as any).Zotero?.Notes;
			if (typeof zNotes?.open === 'function') {
				try { await zNotes.open(nid, undefined, { openInWindow: false }); return; } catch { /* fallback below */ }
			}
			(win as any).Zotero_Tabs?.select?.('zotero-pane');
			await (win as any).ZoteroPane?.selectItem?.(nid);
		}).catch(() => {
			statusEl.textContent = zh ? '✕ 保存汇总笔记失败' : '✕ Failed to save note';
		}).finally(() => { savingNote = false; });
	});

	return actions;
}
