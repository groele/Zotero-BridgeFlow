import { PREF_PREFIX, PREF_SCHEMA, type PrefKey } from './kernel/pref-schema.ts';
import { tLocale } from './kernel/locale.ts';
import { UnifiedPrefService } from './kernel/pref-service.ts';
import {
	bindPreferenceActions,
	setStatusFeedback,
	syncMenulistLabels,
	updatePreferenceDependencies,
} from './prefs-helpers.ts';
import { syncAnnotationColorInputs } from './prefs-color-editor.ts';

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
		const frag = typeof doc.createDocumentFragment === 'function' ? doc.createDocumentFragment() : null;
		const sink = frag || popup;
		const autoItem = createXul('menuitem');
		autoItem.setAttribute('value', '');
		autoItem.setAttribute('data-l10n-id', 'zbf-opt-style-quickcopy');
		autoItem.setAttribute('label', tLocale('跟随 Zotero 快速复制（Quick Copy）默认样式', 'Follow Zotero Quick Copy default style', doc));
		sink.appendChild(autoItem);
		const selectedStyle = String(prefs.get('inspector.cslPreview.citationstyle') || '');
		for (const style of (hostStyles.getVisible?.() || []) as Array<{ styleID: string; title: string }>) {
			if (!style?.styleID) continue;
			const item = createXul('menuitem');
			item.setAttribute('value', style.styleID);
			item.setAttribute('label', style.title || style.styleID);
			sink.appendChild(item);
		}
		if (frag) popup.appendChild(frag);
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

		const versionEl = doc.getElementById('zbf-version-badge');
		if (versionEl) {
			versionEl.setAttribute('data-l10n-args', JSON.stringify({ version: __BRIDGEFLOW_VERSION__ }));
			versionEl.textContent = `v${__BRIDGEFLOW_VERSION__}`;
		}
		const brandIcon = doc.querySelector('.zbf-brand-icon') as HTMLImageElement | null;
		const rootURI = String((doc.defaultView as any)?.Zotero?.zoterobridgeflow?.kernel?.info?.rootURI || (globalThis as any).Zotero?.zoterobridgeflow?.kernel?.info?.rootURI || '');
		if (brandIcon && rootURI) brandIcon.src = `${rootURI}assets/bridgeflow.svg`;

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
				const heatColorHex = doc.getElementById('zbf-heatmap-color-hex');
				if (heatColorHex) heatColorHex.textContent = String(prefs.get('workspace.readingHeatmap.color') || '#0d9488');
				const heatRange = doc.getElementById('zbf-range-heatmap-opacity') as HTMLInputElement | null;
				if (heatRange) {
					const op = String(prefs.get('workspace.readingHeatmap.opacity') || 42);
					heatRange.value = op;
					heatRange.setAttribute('value', op);
				}
				syncAnnotationColorInputs(
					doc,
					String(prefs.get('inspector.annotations.colorLabels') || ''),
					String(prefs.get('inspector.annotations.enabledColors') || ''),
				);
				updatePreferenceDependencies(doc, prefs);
			} catch { cleanup(); }
		};

		for (const cb of checkboxes) {
			const key = extractPrefKey(cb);
			if (!key) continue;
			cb.addEventListener('command', () => {
				const next = Boolean((cb as any).checked ?? cb.hasAttribute('checked'));
				prefs.set(key, next as never);
				updatePreferenceDependencies(doc, prefs);
				setStatusFeedback(doc, 'zbf-prefs-status-saved', tLocale('✓ 设置已自动保存并实时生效', '✓ Settings saved and applied', doc));
			});
		}

		for (const ml of menulists) {
			const key = extractPrefKey(ml);
			if (!key) continue;
			const onSelect = () => {
				const hostMl = ml as any;
				const val = String(hostMl.selectedItem?.getAttribute?.('value') ?? hostMl.value ?? '');
				prefs.set(key, val as never);
				updatePreferenceDependencies(doc, prefs);
				setStatusFeedback(doc, 'zbf-prefs-status-saved', tLocale('✓ 设置已自动保存并实时生效', '✓ Settings saved and applied', doc));
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
				updatePreferenceDependencies(doc, prefs);
				setStatusFeedback(doc, 'zbf-prefs-status-saved', tLocale('✓ 设置已自动保存并实时生效', '✓ Settings saved and applied', doc));
			};
			if (key === 'workspace.readingHeatmap.color') {
				input.addEventListener('input', () => {
					const val = input.value.trim();
					prefs.set(key, val as never);
					const hexEl = doc.getElementById('zbf-heatmap-color-hex');
					if (hexEl) hexEl.textContent = val;
					setStatusFeedback(doc, 'zbf-prefs-status-saved', tLocale('✓ 设置已自动保存并实时生效', '✓ Settings saved and applied', doc));
				});
			} else if (key === 'workspace.readingHeatmap.opacity') {
				input.addEventListener('input', () => {
					const range = doc.getElementById('zbf-range-heatmap-opacity') as HTMLInputElement | null;
					const n = Number(input.value);
					if (Number.isFinite(n) && range) range.value = String(n);
				});
			}
			input.addEventListener('change', commitInput);
			input.addEventListener('keydown', (ev: KeyboardEvent) => { if (ev.key === 'Enter') commitInput(); });
		}

		const heatOpacityRange = doc.getElementById('zbf-range-heatmap-opacity') as HTMLInputElement | null;
		const heatOpacityNum = doc.getElementById('zbf-num-heatmap-opacity') as HTMLInputElement | null;
		if (heatOpacityRange) {
			const syncRange = () => {
				const next = String(prefs.set('workspace.readingHeatmap.opacity', Number(heatOpacityRange.value) as never));
				if (heatOpacityNum) {
					heatOpacityNum.value = next;
					heatOpacityNum.setAttribute('value', next);
				}
				setStatusFeedback(doc, 'zbf-prefs-status-saved', tLocale('✓ 设置已自动保存并实时生效', '✓ Settings saved and applied', doc));
			};
			heatOpacityRange.addEventListener('input', syncRange);
			heatOpacityRange.addEventListener('change', syncRange);
		}

		bindPreferenceActions(doc, targetWin, prefs, syncAll);
		syncAnnotationColorInputs(
			doc,
			String(prefs.get('inspector.annotations.colorLabels') || ''),
			String(prefs.get('inspector.annotations.enabledColors') || ''),
		);
		let stylesRequested = false;
		const ensureStyles = () => {
			if (stylesRequested) return;
			stylesRequested = true;
			void populateCslStyles(doc, prefs);
		};
		const tabs = Array.from(pane.querySelectorAll('[role="tab"]')) as HTMLButtonElement[];
		const panels = Array.from(pane.querySelectorAll('[role="tabpanel"]')) as HTMLElement[];
		const selectTab = (tabId: string, focusTab = false) => {
			for (const tab of tabs) {
				const active = tab.getAttribute('data-zbf-tab') === tabId;
				tab.setAttribute('aria-selected', String(active));
				tab.tabIndex = active ? 0 : -1;
				tab.classList.toggle('is-active', active);
				if (active && focusTab) tab.focus();
			}
			for (const panel of panels) {
				panel.hidden = panel.getAttribute('data-zbf-panel') !== tabId;
			}
			if (tabId === 'inspector') ensureStyles();
		};
		tabs.forEach((tab, idx) => {
			tab.addEventListener('click', () => selectTab(tab.getAttribute('data-zbf-tab') || 'overview'));
			tab.addEventListener('keydown', (ev: KeyboardEvent) => {
				if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
				ev.preventDefault();
				const next = ev.key === 'Home' ? 0
					: ev.key === 'End' ? tabs.length - 1
					: (idx + (ev.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
				selectTab(tabs[next]?.getAttribute('data-zbf-tab') || 'overview', true);
			});
		});
		pane.querySelectorAll('[data-zbf-jump]').forEach((btn) => {
			btn.addEventListener('click', () => {
				const target = btn.getAttribute('data-zbf-jump');
				if (target) selectTab(target);
			});
		});
		pane.querySelectorAll('[data-zbf-enable-mod]').forEach((btn) => {
			const modKey = btn.getAttribute('data-zbf-enable-mod') as PrefKey | null;
			if (!modKey || !(modKey in PREF_SCHEMA)) return;
			const enableMod = () => {
				prefs.set(modKey, true as never);
				syncAll();
				setStatusFeedback(doc, 'zbf-prefs-status-saved', tLocale('✓ 设置已自动保存并实时生效', '✓ Settings saved and applied', doc));
			};
			btn.addEventListener('command', enableMod);
			btn.addEventListener('click', enableMod);
		});
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
