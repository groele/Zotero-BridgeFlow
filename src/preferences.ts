import { PREF_PREFIX, PREF_SCHEMA, type PrefKey } from './kernel/pref-schema.ts';
import { UnifiedPrefService } from './kernel/pref-service.ts';
import {
	bindPreferenceActions,
	setStatusFeedback,
	syncMenulistLabels,
	updatePreferenceDependencies,
} from './prefs-helpers.ts';

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
				setStatusFeedback(doc, 'zbf-prefs-status-saved', '✓ 设置已自动保存并实时生效');
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
				updatePreferenceDependencies(doc, prefs);
				setStatusFeedback(doc, 'zbf-prefs-status-saved', '✓ 设置已自动保存并实时生效');
			};
			input.addEventListener('change', commitInput);
			input.addEventListener('keydown', (ev: KeyboardEvent) => { if (ev.key === 'Enter') commitInput(); });
		}

		bindPreferenceActions(doc, targetWin, prefs, syncAll);
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
