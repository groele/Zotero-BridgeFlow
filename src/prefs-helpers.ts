import { UnifiedPrefService } from './kernel/pref-service.ts';

export function setSubtreeDisabled(el: Element | null, disabled: boolean): void {
	if (!el) return;
	el.setAttribute('data-disabled', disabled ? 'true' : 'false');
	el.querySelectorAll('checkbox, menulist, input, button').forEach((ctrl: Element) => {
		try { (ctrl as any).disabled = disabled; } catch { /* ignore */ }
		if (disabled) ctrl.setAttribute('disabled', 'true');
		else ctrl.removeAttribute('disabled');
	});
}

export function syncMenulistLabels(doc: Document): void {
	doc.querySelectorAll('#zotero-prefpane-zotero-bridgeflow menulist').forEach((ml: Element) => {
		const hostMl = ml as any;
		const val = String(hostMl.value ?? ml.getAttribute('value') ?? '');
		const items = Array.from(ml.querySelectorAll('menuitem')) as Element[];
		const matched = items.find((it) => it.getAttribute('value') === val) || hostMl.selectedItem || items[0];
		if (matched) {
			try { hostMl.selectedItem = matched; } catch { /* ignore */ }
			const lbl = matched.getAttribute('label') || (matched.textContent || '').trim();
			if (lbl) ml.setAttribute('label', lbl);
		}
	});
}

export function setStatusFeedback(doc: Document, l10nId: string, fallbackText: string): void {
	const statusEl = doc.getElementById('zbf-prefs-status');
	if (!statusEl) return;
	statusEl.setAttribute('data-l10n-id', l10nId);
	statusEl.textContent = fallbackText;
}

export function updatePreferenceDependencies(doc: Document, prefs: UnifiedPrefService): void {
	prefs.invalidate();
	const wsOn = Boolean(prefs.get('modules.workspace.enable'));
	const insOn = Boolean(prefs.get('modules.inspector.enable'));
	const wcOn = Boolean(prefs.get('modules.wordCite.enable'));
	const vSideOn = wsOn && Boolean(prefs.get('workspace.enableVerticalSidebar'));

	setSubtreeDisabled(doc.getElementById('zbf-group-workspace'), !wsOn);
	setSubtreeDisabled(doc.getElementById('zbf-group-sidebar'), !wsOn);
	setSubtreeDisabled(doc.getElementById('zbf-group-inspector'), !insOn);
	setSubtreeDisabled(doc.getElementById('zbf-group-pdf'), !insOn);
	setSubtreeDisabled(doc.getElementById('zbf-group-wordcite'), !wcOn);

	setSubtreeDisabled(doc.getElementById('zbf-sub-hcompact'), !wsOn || !prefs.get('workspace.enableHorizontalGroups'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-compactTop'), !vSideOn || !prefs.get('workspace.enableHorizontalGroups'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-vsidebar-cfg'), !vSideOn);
	setSubtreeDisabled(doc.getElementById('zbf-sub-vsidebar-typo'), !vSideOn);
	setSubtreeDisabled(doc.getElementById('zbf-sub-pinnedIcon'), !wsOn || !prefs.get('workspace.enablePinnedTabs'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-multicol'), !wsOn || prefs.get('workspace.newTabMode') !== 'collection');
	setSubtreeDisabled(doc.getElementById('zbf-sub-rolling'), !wsOn || !prefs.get('workspace.enableSessions'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-sleep-cfg'), !wsOn || !prefs.get('workspace.enableTabSleep'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-stale-days'), !wsOn || !prefs.get('workspace.enableStaleSuggestions'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-remark-mode'), !wsOn || !prefs.get('workspace.enableTabRemarks'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-tabmenu'), !wsOn || !prefs.get('workspace.enableTabContextMenu'));

	const cslOn = insOn && Boolean(prefs.get('inspector.cslPreview.enable'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-csl'), !cslOn);
	setSubtreeDisabled(doc.getElementById('zbf-sub-csl-layout'), !cslOn);
	const lookupOn = insOn && Boolean(prefs.get('inspector.lookup.enable'));
	const historyOn = lookupOn && Boolean(prefs.get('inspector.lookup.historyEnable'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-lookup-history'), !lookupOn);
	setSubtreeDisabled(doc.getElementById('zbf-sub-lookup-quota'), !historyOn);
	setSubtreeDisabled(doc.getElementById('zbf-sub-pdf-preview'), !insOn || !prefs.get('inspector.pdfPreview.enable'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-pdf-folder'), !insOn || !prefs.get('inspector.pdfFolder.enable'));

	const wordPanelCard = doc.getElementById('zbf-sub-word-panel-card');
	setSubtreeDisabled(wordPanelCard, !wcOn || !insOn);
	setSubtreeDisabled(doc.getElementById('zbf-sub-word-panel'), !wcOn || !insOn || !prefs.get('inspector.wordCite.enable'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-wc-tag-text'), !wcOn || !prefs.get('wordCite.citationTags.enable'));

	syncMenulistLabels(doc);
}

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

	bindActionBtn(doc.getElementById('zbf-clear-workspace-state'), () => {
		prefs.set('workspace.document', '');
		const app = getApp();
		app?.workspace?.store?.load?.();
		app?.workspace?.refreshAllWindows?.();
		setStatusFeedback(doc, 'zbf-prefs-status-ws-cleared', '✓ 已清除工作区分组与会话数据');
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

	bindActionBtn(doc.getElementById('zbf-btn-ws-open-spotlight'), () => {
		getApp()?.kernel?.bus?.emit('inspector:lookup-clipboard', { win: getMainWin() || undefined });
		setStatusFeedback(doc, 'zbf-prefs-status-spotlight', '✓ 已在主窗口唤起 Spotlight 面板');
	});

	bindActionBtn(doc.getElementById('zbf-btn-csl-refresh'), () => {
		void getApp()?.inspector?.refreshAllPreviews?.();
		setStatusFeedback(doc, 'zbf-prefs-status-csl-refreshed', '✓ 已刷新侧栏 CSL 预览与协同面板');
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
