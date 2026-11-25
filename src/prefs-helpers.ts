import { tLocale } from './kernel/locale.ts';
import { UnifiedPrefService } from './kernel/pref-service.ts';
import { initAnnotationColorEditor, syncAnnotationColorInputs } from './prefs-color-editor.ts';
import {
	setStatusFeedback,
	setSubtreeDisabled,
	syncMenulistLabels,
	updatePreferenceDependencies,
} from './prefs-dependencies.ts';
import { clearPdfCoverCache } from './services/pdf-cover-service.ts';

export { setStatusFeedback, setSubtreeDisabled, syncMenulistLabels, updatePreferenceDependencies };

export function bindActionBtn(el: Element | null, handler: () => void): void {
	if (!el) return;
	let lastAt = 0;
	const run = () => {
		const now = Date.now();
		if (now - lastAt < 120) return;
		lastAt = now;
		handler();
	};
	el.addEventListener('command', run);
	el.addEventListener('click', run);
}

export function bindPreferenceActions(
	doc: Document,
	targetWin: Window | null,
	prefs: UnifiedPrefService,
	syncAll: () => void,
): void {
	const getApp = () => (globalThis as any).Zotero?.zoterobridgeflow;
	const getMainWin = () => (globalThis as any).Zotero?.getMainWindow?.() || targetWin;

	bindActionBtn(doc.getElementById('zbf-clear-cache'), () => {
		getApp()?.kernel?.bus?.emit('inspector:clear-cache', { target: 'all' });
		setStatusFeedback(doc, 'zbf-prefs-status-cache-cleared', '✓ 已清空全部引文与反查缓存');
	});

	const clearIgnoredReminders = () => {
		const app = getApp();
		app?.services?.reminders?.clearAll?.(true);
		app?.inspector?.wordCiteSection?.refreshAll?.();
		setStatusFeedback(doc, 'zbf-prefs-status-reminders-restored', '✓ 已恢复全部已忽略的文献信息提醒');
	};
	bindActionBtn(doc.getElementById('zbf-btn-restore-reminders'), clearIgnoredReminders);
	bindActionBtn(doc.getElementById('zbf-clear-ignored-reminders'), clearIgnoredReminders);

	bindActionBtn(doc.getElementById('zbf-clear-workspace-state'), () => {
		const app = getApp();
		if (app?.workspace?.store?.clearWorkspaceLayout) {
			app.workspace.store.clearWorkspaceLayout();
		} else {
			prefs.set('workspace.document', '');
		}
		app?.workspace?.refreshAllWindows?.();
		setStatusFeedback(doc, 'zbf-prefs-status-ws-cleared', '✓ 已清除工作区分组与会话（阅读时长与简记已完整保留）');
	});

	const exportJsonBackup = async (title: string, defaultName: string, json: string | undefined, statusId: string, okText: string) => {
		if (!json) return;
		try {
			const cu = (targetWin as any)?.ChromeUtils || (globalThis as any).ChromeUtils;
			if (cu?.importESModule && targetWin) {
				const mod = cu.importESModule('chrome://zotero/content/modules/filePicker.mjs');
				const picker = new mod.FilePicker();
				picker.init(targetWin, title, picker.modeSave ?? 1);
				picker.appendFilter(tLocale('JSON 文件', 'JSON Files', doc), '*.json');
				picker.defaultString = defaultName;
				const rv = await picker.show();
				if ((rv === picker.returnOK || rv === picker.returnReplace) && picker.file) {
					await (globalThis as any).Zotero?.File?.putContentsAsync?.(picker.file, json);
					setStatusFeedback(doc, statusId, okText);
				}
			}
		} catch { /* ignore */ }
	};

	bindActionBtn(doc.getElementById('zbf-btn-export-reading'), () => {
		void exportJsonBackup(
			tLocale('导出阅读时长与热力图备份 (JSON)', 'Export Reading Progress & Heatmap Backup (JSON)', doc),
			`BridgeFlow-ReadingProgress-${new Date().toISOString().slice(0, 10)}.json`,
			getApp()?.workspace?.store?.exportReadingJson?.(),
			'zbf-prefs-status-reading-exported',
			tLocale('✓ 已导出阅读时长与热力图 JSON 备份', '✓ Exported reading progress & heatmap JSON backup', doc),
		);
	});

	bindActionBtn(doc.getElementById('zbf-clear-reading-notes'), () => {
		if (targetWin?.confirm && !targetWin.confirm(tLocale(
			'确定要清空所有文献的累计阅读时长与热力图记录吗？（不影响工作区分组与条目简记 Note，此操作不可撤销）',
			'Clear all reading duration and heatmap records? (Workspace groups and brief notes are preserved; this cannot be undone.)',
			doc,
		))) {
			return;
		}
		const app = getApp();
		app?.workspace?.store?.clearReadingProgress?.();
		app?.workspace?.refreshAllWindows?.();
		app?.visualNotes?.refreshLibraryViews?.();
		setStatusFeedback(doc, 'zbf-prefs-status-reading-cleared', tLocale('✓ 已清空阅读时长与热力图缓存（简记已保留）', '✓ Cleared reading progress & heatmap cache', doc));
	});

	bindActionBtn(doc.getElementById('zbf-btn-export-brief-notes'), () => {
		void exportJsonBackup(
			tLocale('导出条目简记 (Note) 备份 (JSON)', 'Export Brief Notes Backup (JSON)', doc),
			`BridgeFlow-BriefNotes-${new Date().toISOString().slice(0, 10)}.json`,
			getApp()?.workspace?.store?.exportBriefNotesJson?.(),
			'zbf-prefs-status-notes-exported',
			tLocale('✓ 已导出独立简记 JSON 备份', '✓ Exported brief notes JSON backup', doc),
		);
	});

	bindActionBtn(doc.getElementById('zbf-clear-brief-notes'), async () => {
		if (targetWin?.confirm && !targetWin.confirm(tLocale(
			'确定要清空本地独立缓存 brief-notes.json 中的条目简记吗？（不影响工作区、阅读时长及已同步到 Zotero Extra 的内容）',
			'Clear all local brief notes in brief-notes.json? (Workspace, reading progress, and Zotero Extra remarks are untouched.)',
			doc,
		))) {
			return;
		}
		const app = getApp();
		const saved = await app?.workspace?.store?.clearBriefNotes?.();
		if (!saved) {
			setStatusFeedback(doc, 'zbf-prefs-status-notes-clear-failed', tLocale('未能完整清空本地简记缓存。', 'The local brief notes cache could not be fully cleared.', doc));
			return;
		}
		app?.workspace?.refreshAllWindows?.();
		app?.visualNotes?.refreshLibraryViews?.();
		setStatusFeedback(doc, 'zbf-prefs-status-notes-cleared', tLocale('✓ 已清空本地简记缓存文件', '✓ Cleared local brief notes cache file', doc));
	});

	bindActionBtn(doc.getElementById('zbf-btn-export-ratings'), () => {
		void exportJsonBackup(
			tLocale('导出文献星级评价备份 (JSON)', 'Export Star Ratings Backup (JSON)', doc),
			`BridgeFlow-ItemRatings-${new Date().toISOString().slice(0, 10)}.json`,
			getApp()?.services?.ratings?.exportJson?.(),
			'zbf-prefs-status-ratings-exported',
			tLocale('✓ 已导出星级评价 JSON 备份', '✓ Exported item ratings JSON backup', doc),
		);
	});

	bindActionBtn(doc.getElementById('zbf-clear-ratings-cache'), () => {
		if (targetWin?.confirm && !targetWin.confirm(tLocale(
			'确定要清空本地独立缓存 item-ratings.json 中的文献星级评价吗？（不影响工作区、简记及 Zotero 原生字段）',
			'Clear all local star ratings in item-ratings.json? (Workspace, brief notes, and Zotero fields are untouched.)',
			doc,
		))) {
			return;
		}
		const app = getApp();
		app?.services?.ratings?.clearAll?.(true);
		app?.visualNotes?.refreshLibraryViews?.();
		setStatusFeedback(doc, 'zbf-prefs-status-ratings-cleared', tLocale('✓ 已清空本地星级评价缓存文件', '✓ Cleared local item ratings cache file', doc));
	});

	bindActionBtn(doc.getElementById('zbf-clear-covers-cache'), () => {
		if (targetWin?.confirm && !targetWin.confirm(tLocale(
			'确定要清空画廊 PDF 首页封面缩略图缓存（covers/）吗？下次打开画廊时会自动重新生成，不影响原 PDF 文件。',
			'Clear Gallery PDF cover thumbnail cache (covers/)? Thumbnails regenerate automatically on next open without affecting PDFs.',
			doc,
		))) {
			return;
		}
		void clearPdfCoverCache().then((cleared) => {
			if (!cleared) {
				setStatusFeedback(doc, 'zbf-prefs-status-covers-clear-failed', tLocale('无法完全清理画廊 PDF 封面缩略图缓存。', 'PDF cover cache could not be fully cleared.', doc));
				return;
			}
			getApp()?.visualNotes?.galleryBoard?.refreshWindows?.();
			setStatusFeedback(doc, 'zbf-prefs-status-covers-cleared', tLocale('✓ 已清空画廊 PDF 封面缩略图缓存', '✓ Cleared Gallery PDF cover thumbnail cache', doc));
		});
	});

	bindActionBtn(doc.getElementById('zbf-reset-defaults'), () => {
		prefs.resetAllDefaults();
		syncAll();
		targetWin?.setTimeout?.(() => syncMenulistLabels(doc), 0);
		setStatusFeedback(doc, 'zbf-prefs-status-reset', '✓ 已恢复全部默认设置');
	});

	bindActionBtn(doc.getElementById('zbf-btn-ws-save-session'), () => {
		const app = getApp();
		const mw = getMainWin();
		const openKeys = app?.workspace?.tabs?.openKeys?.(mw) || [];
		app?.workspace?.store?.saveSession?.(`Snapshot ${new Date().toLocaleTimeString()}`, { openKeys });
		app?.workspace?.refreshAllWindows?.();
		setStatusFeedback(doc, 'zbf-prefs-status-ws-snapshot', '✓ 已保存当前工作区快照');
	});

	bindActionBtn(doc.getElementById('zbf-btn-ws-reset-width'), () => {
		prefs.set('workspace.verticalSidebarWidth', 276);
		prefs.set('workspace.verticalSidebarCollapsed', false);
		syncAll();
		getApp()?.workspace?.refreshAllWindows?.();
		setStatusFeedback(doc, 'zbf-prefs-status-saved', '✓ 设置已自动保存并实时生效');
	});

	bindActionBtn(doc.getElementById('zbf-btn-csl-refresh'), () => {
		void getApp()?.inspector?.refreshAllPreviews?.();
		setStatusFeedback(doc, 'zbf-prefs-status-csl-refreshed', '✓ 已刷新侧栏 CSL 预览与协同面板');
	});

	initAnnotationColorEditor(doc, prefs, () => setStatusFeedback(doc, 'zbf-prefs-status-saved', '✓ 设置已自动保存并实时生效'));

	bindActionBtn(doc.getElementById('zbf-btn-reset-ann-colors'), () => {
		prefs.set('inspector.annotations.colorLabels', '');
		prefs.set('inspector.annotations.enabledColors', '');
		syncAnnotationColorInputs(doc, '', '');
		syncAll();
		setStatusFeedback(doc, 'zbf-prefs-status-saved', '✓ 设置已自动保存并实时生效');
	});

	bindActionBtn(doc.getElementById('zbf-btn-open-matrix'), () => {
		const mw = getMainWin();
		const app = getApp();
		if (!mw || !app) return;
		mw.focus?.();
		if (app.visualNotes?.openCurrentMatrix) app.visualNotes.openCurrentMatrix(mw);
		else app.workspace?.tabs?.openGroupAnnotationMatrix?.(mw);
	});

	bindActionBtn(doc.getElementById('zbf-btn-open-collection-hub'), () => {
		const mw = getMainWin();
		const app = getApp();
		if (!mw || !app) return;
		mw.focus?.();
		app.visualNotes?.openCollectionHub?.(mw);
	});

	bindActionBtn(doc.getElementById('zbf-btn-open-gallery'), () => {
		const mw = getMainWin();
		const app = getApp();
		if (!mw || !app) return;
		mw.focus?.();
		app.visualNotes?.galleryBoard?.toggleWindowGallery?.(mw);
	});

	bindActionBtn(doc.getElementById('zbf-btn-pdf-reset-zoom'), () => {
		prefs.set('inspector.pdfPreview.defaultZoom', 100);
		prefs.set('inspector.pdfPreview.mode', 'section');
		syncAll();
		setStatusFeedback(doc, 'zbf-prefs-status-pdf-reset', '✓ 已恢复 PDF 默认缩放与分栏高度');
	});

	bindActionBtn(doc.getElementById('zbf-btn-default-cachedir'), () => {
		prefs.set('inspector.lookup.cacheDirectory', '');
		syncAll();
		setStatusFeedback(doc, 'zbf-prefs-status-saved', '✓ 设置已自动保存并实时生效');
	});

	bindActionBtn(doc.getElementById('zbf-btn-browse-cachedir'), async () => {
		try {
			const cu = (targetWin as any)?.ChromeUtils || (globalThis as any).ChromeUtils;
			if (cu?.importESModule && targetWin) {
				const mod = cu.importESModule('chrome://zotero/content/modules/filePicker.mjs');
				const picker = new mod.FilePicker();
				picker.init(targetWin, 'BridgeFlow Cache Directory', picker.modeGetFolder);
				if (await picker.show() === picker.returnOK && picker.file) {
					prefs.set('inspector.lookup.cacheDirectory', String(picker.file));
					syncAll();
					setStatusFeedback(doc, 'zbf-prefs-status-saved', '✓ 设置已自动保存并实时生效');
				}
			}
		} catch { /* ignore */ }
	});

	bindActionBtn(doc.getElementById('zbf-btn-word-resync'), () => {
		void getApp()?.wordCite?.resyncNow?.();
		setStatusFeedback(doc, 'zbf-prefs-status-word-resynced', '✓ 已触发 Word 引用状态同步');
	});

	bindActionBtn(doc.getElementById('zbf-btn-word-refresh'), () => {
		getApp()?.kernel?.bus?.emit('word:refresh-request', { win: getMainWin() || undefined });
		setStatusFeedback(doc, 'zbf-prefs-status-word-refreshed', '✓ 已向活动 Word 文档发送刷新指令');
	});

	bindActionBtn(doc.getElementById('zbf-btn-word-purge-cols'), () => {
		void getApp()?.wordCite?.collections?.purgeStaleCollections?.();
		setStatusFeedback(doc, 'zbf-prefs-status-word-purged', '✓ 已清理过期 Word 临时分类');
	});

	bindActionBtn(doc.getElementById('zbf-btn-word-clear-tags'), () => {
		void getApp()?.wordCite?.tagGovernance?.syncCitedItems?.(new Set());
		setStatusFeedback(doc, 'zbf-prefs-status-word-tags-cleared', '✓ 已清理全部插件托管引用标签');
	});
}
