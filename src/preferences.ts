import { PREF_PREFIX, PREF_SCHEMA, type PrefKey } from './kernel/pref-schema.ts';
import { UnifiedPrefService } from './kernel/pref-service.ts';

declare const document: Document | undefined;
declare const window: Window | undefined;

const initializedPanes = new WeakSet<Element>();

function resolveDoc(win?: Window): Document | null {
	return win?.document || (typeof document !== 'undefined' && document ? document : ((globalThis as any).document as Document | undefined) ?? null);
}

function resolveWin(doc?: Document | null, win?: Window): Window | null {
	return win || doc?.defaultView || (typeof window !== 'undefined' && window ? window : ((globalThis as any).window as Window | undefined) ?? null);
}

function extractPrefKey(el: Element): PrefKey | null {
	const direct = el.getAttribute('data-zbf-pref');
	if (direct && direct in PREF_SCHEMA) return direct as PrefKey;
	const full = el.getAttribute('preference') || el.getAttribute('data-preference') || '';
	const shortKey = full.startsWith(PREF_PREFIX) ? full.slice(PREF_PREFIX.length) : '';
	return shortKey in PREF_SCHEMA ? (shortKey as PrefKey) : null;
}

function setSubtreeDisabled(el: Element | null, disabled: boolean): void {
	if (!el) return;
	el.setAttribute('data-disabled', disabled ? 'true' : 'false');
	el.querySelectorAll('checkbox, menulist, input, button').forEach((ctrl: Element) => {
		try { (ctrl as any).disabled = disabled; } catch { /* ignore */ }
		if (disabled) ctrl.setAttribute('disabled', 'true');
		else ctrl.removeAttribute('disabled');
	});
}

function syncMenulistLabels(doc: Document): void {
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

function updateDependencies(doc: Document, prefs: UnifiedPrefService): void {
	prefs.invalidate();
	const wsOn = Boolean(prefs.get('modules.workspace.enable'));
	const insOn = Boolean(prefs.get('modules.inspector.enable'));
	const wcOn = Boolean(prefs.get('modules.wordCite.enable'));

	setSubtreeDisabled(doc.getElementById('zbf-group-workspace'), !wsOn);
	setSubtreeDisabled(doc.getElementById('zbf-group-sidebar'), !wsOn);
	setSubtreeDisabled(doc.getElementById('zbf-group-inspector'), !insOn);
	setSubtreeDisabled(doc.getElementById('zbf-group-pdf'), !insOn);
	setSubtreeDisabled(doc.getElementById('zbf-group-wordcite'), !wcOn);

	setSubtreeDisabled(doc.getElementById('zbf-sub-hcompact'), !wsOn || !prefs.get('workspace.enableHorizontalGroups'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-compactTop'), !wsOn || !prefs.get('workspace.enableHorizontalGroups') || !prefs.get('workspace.enableVerticalSidebar'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-batch'), !wsOn || !prefs.get('workspace.enableVerticalSidebar'));
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
	setSubtreeDisabled(doc.getElementById('zbf-sub-word-cite-pos'), !wcOn || !insOn || !prefs.get('wordCite.dragCite.enable') || !prefs.get('inspector.wordCite.enable'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-wc-tag-text'), !wcOn || !prefs.get('wordCite.citationTags.enable'));

	syncMenulistLabels(doc);
}

function setStatusFeedback(doc: Document, l10nId: string, fallbackText: string): void {
	const statusEl = doc.getElementById('zbf-prefs-status');
	if (!statusEl) return;
	statusEl.setAttribute('data-l10n-id', l10nId);
	statusEl.textContent = fallbackText;
}

function bindTabs(pane: Element): void {
	const tabBtns = Array.from(pane.querySelectorAll('.zbf-tab-btn')) as HTMLButtonElement[];
	const panels = Array.from(pane.querySelectorAll('.zbf-tabpanel')) as HTMLElement[];
	const activate = (tabID: string): void => {
		for (const btn of tabBtns) {
			const match = btn.getAttribute('data-zbf-tab') === tabID;
			btn.classList.toggle('active', match);
			btn.setAttribute('aria-selected', String(match));
		}
		for (const panel of panels) {
			const match = panel.getAttribute('data-zbf-panel') === tabID;
			panel.hidden = !match;
			if (match) panel.removeAttribute('hidden');
			else panel.setAttribute('hidden', 'hidden');
		}
	};
	tabBtns.forEach((btn, idx) => {
		btn.addEventListener('click', (ev) => { ev.preventDefault(); const id = btn.getAttribute('data-zbf-tab'); if (id) activate(id); });
		btn.addEventListener('keydown', (ev: KeyboardEvent) => {
			if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
			ev.preventDefault();
			const nextBtn = tabBtns[(idx + (ev.key === 'ArrowRight' ? 1 : tabBtns.length - 1)) % tabBtns.length];
			nextBtn?.focus?.();
			const id = nextBtn?.getAttribute('data-zbf-tab');
			if (id) activate(id);
		});
	});
}

function bindActionBtn(el: Element | null, handler: () => void): void {
	if (!el) return;
	let lastAt = 0;
	const run = () => { const now = Date.now(); if (now - lastAt < 120) return; lastAt = now; handler(); };
	el.addEventListener('command', run);
	el.addEventListener('click', run);
}

async function populateCslStyles(doc: Document, prefs: UnifiedPrefService): Promise<void> {
	const hostZotero = (doc.defaultView as any)?.Zotero || (globalThis as any).Zotero;
	const hostStyles = hostZotero?.Styles;
	if (!hostStyles) return;
	try {
		await hostStyles.init?.();
		if (!doc.defaultView || (doc.defaultView as any).closed) return;
		const menu = doc.getElementById('zbf-sel-csl-style') as any;
		const popup = menu?.querySelector?.('menupopup') as Element | null;
		if (!menu || !popup) return;
		const createXul = (tag: string): Element =>
			typeof (doc as any).createXULElement === 'function' ? (doc as any).createXULElement(tag) : doc.createElement(tag);
		popup.textContent = '';
		const autoItem = createXul('menuitem');
		autoItem.setAttribute('value', '');
		autoItem.setAttribute('data-l10n-id', 'zbf-opt-style-quickcopy');
		autoItem.setAttribute('label', '跟随 Zotero 快速复制（Quick Copy）默认样式');
		popup.appendChild(autoItem);
		const selectedStyle = String(prefs.get('inspector.cslPreview.citationstyle') || '');
		for (const style of (hostStyles.getVisible?.() || []) as Array<{ styleID: string; title: string }>) {
			if (!style?.styleID) continue;
			const item = createXul('menuitem');
			item.setAttribute('value', style.styleID);
			item.setAttribute('label', style.title || style.styleID);
			popup.appendChild(item);
		}
		menu.value = selectedStyle;
		menu.setAttribute('value', selectedStyle);
		syncMenulistLabels(doc);
	} catch { /* ignore in mock env */ }
}

const BridgeFlowPreferences = {
	init(win?: Window): boolean {
		const doc = resolveDoc(win);
		const targetWin = resolveWin(doc, win);
		const pane = doc?.getElementById('zotero-prefpane-zotero-bridgeflow') ?? null;
		if (!doc || !pane) return false;
		if (initializedPanes.has(pane)) return true;
		initializedPanes.add(pane);

		const prefs = new UnifiedPrefService();
		prefs.seedDefaults();
		bindTabs(pane);

		const versionEl = doc.getElementById('zbf-version-badge');
		if (versionEl) {
			versionEl.setAttribute('data-l10n-args', JSON.stringify({ version: __BRIDGEFLOW_VERSION__ }));
			versionEl.textContent = `v${__BRIDGEFLOW_VERSION__}`;
		}

		const checkboxes = Array.from(pane.querySelectorAll('checkbox[preference]')) as Element[];
		const menulists = Array.from(pane.querySelectorAll('menulist[preference]')) as Element[];
		const inputs = Array.from(pane.querySelectorAll('input[data-zbf-pref]')) as HTMLInputElement[];

		let disposed = false;
		const localObservers: Array<symbol | string | number> = [];
		const cleanup = (): void => {
			if (disposed) return;
			disposed = true;
			for (const id of localObservers.splice(0)) {
				try { (globalThis as any).Zotero?.Prefs?.unregisterObserver?.(id); } catch { /* ignore */ }
			}
			prefs.dispose();
		};

		const syncAll = (): void => {
			if (disposed) return;
			try {
				if (!doc.defaultView || (doc.defaultView as any).closed || !pane.isConnected) { cleanup(); return; }
				prefs.invalidate();
				for (const cb of checkboxes) {
					const key = extractPrefKey(cb);
					if (!key) continue;
					const checked = Boolean(prefs.get(key));
					try { (cb as any).checked = checked; } catch { /* ignore */ }
					if (checked) cb.setAttribute('checked', 'true');
					else cb.removeAttribute('checked');
				}
				for (const ml of menulists) {
					const key = extractPrefKey(ml);
					if (!key) continue;
					const val = String(prefs.get(key));
					try { (ml as any).value = val; } catch { /* ignore */ }
					ml.setAttribute('value', val);
				}
				for (const input of inputs) {
					const key = extractPrefKey(input);
					if (!key) continue;
					const val = prefs.get(key);
					const strVal = val == null || val === 'undefined' ? String(PREF_SCHEMA[key].defaultValue) : String(val);
					input.value = strVal;
					input.setAttribute('value', strVal);
				}
				const cacheDirInput = doc.getElementById('zbf-input-cachedir') as HTMLInputElement | null;
				const defaultDir = (globalThis as any).Zotero?.zoterobridgeflow?.services?.history?.getDirectoryPath?.() || '';
				if (cacheDirInput && defaultDir) cacheDirInput.placeholder = defaultDir;
				updateDependencies(doc, prefs);
			} catch { cleanup(); }
		};

		for (const cb of checkboxes) {
			const key = extractPrefKey(cb);
			if (!key) continue;
			const onToggle = () => {
				const next = Boolean((cb as any).checked ?? cb.hasAttribute('checked'));
				prefs.set(key, next as never);
				updateDependencies(doc, prefs);
				setStatusFeedback(doc, 'zbf-prefs-status-saved', '✓ 设置已自动保存并实时生效');
			};
			cb.addEventListener('command', onToggle);
		}

		for (const ml of menulists) {
			const key = extractPrefKey(ml);
			if (!key) continue;
			const onSelect = () => {
				const hostMl = ml as any;
				const val = String(hostMl.selectedItem?.getAttribute?.('value') ?? hostMl.value ?? '');
				prefs.set(key, val as never);
				updateDependencies(doc, prefs);
				setStatusFeedback(doc, 'zbf-prefs-status-saved', '✓ 设置已自动保存并实时生效');
			};
			ml.addEventListener('command', onSelect);
			ml.addEventListener('change', onSelect);
		}

		for (const input of inputs) {
			const key = extractPrefKey(input);
			if (!key) continue;
			const commitInput = () => {
				const raw = input.type === 'number' ? Number(input.value) : input.value.trim();
				input.value = String(prefs.set(key, raw as never));
				updateDependencies(doc, prefs);
				setStatusFeedback(doc, 'zbf-prefs-status-saved', '✓ 设置已自动保存并实时生效');
			};
			input.addEventListener('change', commitInput);
			input.addEventListener('keydown', (ev: KeyboardEvent) => { if (ev.key === 'Enter') commitInput(); });
		}

		bindActionBtn(doc.getElementById('zbf-clear-cache'), () => {
			const app = (globalThis as any).Zotero?.zoterobridgeflow;
			app?.kernel?.bus?.emit('inspector:clear-cache', { target: 'all' });
			setStatusFeedback(doc, 'zbf-prefs-status-cache-cleared', '✓ 已清空全部引文与反查缓存');
		});

		bindActionBtn(doc.getElementById('zbf-clear-workspace-state'), () => {
			prefs.set('workspace.document', '');
			const app = (globalThis as any).Zotero?.zoterobridgeflow;
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

		void populateCslStyles(doc, prefs);
		(doc as { l10n?: { ready?: Promise<unknown> } }).l10n?.ready?.then?.(() => { if (!disposed) syncMenulistLabels(doc); });

		if ((globalThis as any).Zotero?.Prefs?.registerObserver) {
			const keys = (Object.keys(PREF_SCHEMA) as PrefKey[]).filter((k) => k !== 'workspace.document');
			for (const k of keys) {
				localObservers.push((globalThis as any).Zotero.Prefs.registerObserver(PREF_PREFIX + k, () => syncAll(), true));
			}
			targetWin?.addEventListener?.('pagehide', cleanup, { once: true });
			targetWin?.addEventListener?.('unload', cleanup, { once: true });
		}

		syncAll();
		targetWin?.setTimeout?.(() => { if (!disposed) syncAll(); }, 30);
		targetWin?.setTimeout?.(() => { if (!disposed) syncAll(); }, 150);
		return true;
	},
};

(globalThis as any).BridgeFlowPreferences = BridgeFlowPreferences;

(() => {
	const doc = resolveDoc();
	const win = resolveWin(doc);
	if (!doc) return;
	// Zotero 10 loads pane scripts before inserting the fragment, then dispatches
	// a non-bubbling load event on the inserted pane element.
	doc.addEventListener('load', (ev: Event) => {
		const target = ev.target as Element | null;
		if (!target || target.id === 'zotero-prefpane-zotero-bridgeflow' || doc.getElementById('zotero-prefpane-zotero-bridgeflow')) {
			BridgeFlowPreferences.init(win || undefined);
		}
	}, true);

	if (!BridgeFlowPreferences.init(win || undefined)) {
		const Obs = (win as any)?.MutationObserver || (globalThis as any).MutationObserver;
		if (Obs && doc.documentElement) {
			const mo = new Obs(() => {
				if (BridgeFlowPreferences.init(win || undefined)) mo.disconnect();
			});
			mo.observe(doc.documentElement, { childList: true, subtree: true });
			win?.addEventListener?.('unload', () => mo.disconnect(), { once: true });
		}
	}
})();
