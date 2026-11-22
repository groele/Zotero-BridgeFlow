import { PREF_PREFIX, PREF_SCHEMA, type PrefKey } from './kernel/pref-schema.ts';
import { UnifiedPrefService } from './kernel/pref-service.ts';

function setSubtreeDisabled(el: Element | null, disabled: boolean): void {
	if (!el) return;
	el.setAttribute('data-disabled', disabled ? 'true' : 'false');
	el.querySelectorAll('checkbox, menulist, input, button').forEach((ctrl: Element) => {
		if (disabled) ctrl.setAttribute('disabled', 'true');
		else ctrl.removeAttribute('disabled');
	});
}

function syncMenulistLabels(doc: Document): void {
	doc.querySelectorAll('#zotero-prefpane-zotero-bridgeflow menulist').forEach((ml: Element) => {
		const selected = (ml as { selectedItem?: Element | null }).selectedItem;
		const lbl = selected?.getAttribute?.('label');
		if (lbl) ml.setAttribute('label', lbl);
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
	setSubtreeDisabled(doc.getElementById('zbf-sub-lookup-history'), !lookupOn);
	setSubtreeDisabled(doc.getElementById('zbf-sub-lookup-quota'), !lookupOn);
	setSubtreeDisabled(doc.getElementById('zbf-sub-pdf-preview'), !insOn || !prefs.get('inspector.pdfPreview.enable'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-pdf-folder'), !insOn || !prefs.get('inspector.pdfFolder.enable'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-wc-tag-text'), !wcOn || !prefs.get('wordCite.citationTags.enable'));

	syncMenulistLabels(doc);
}

function bindTabs(doc: Document): void {
	const tabBtns = Array.from(doc.querySelectorAll('.zbf-tab-btn')) as HTMLButtonElement[];
	const panels = Array.from(doc.querySelectorAll('.zbf-tabpanel')) as HTMLElement[];
	const activate = (tabID: string): void => {
		for (const btn of tabBtns) {
			const match = btn.getAttribute('data-zbf-tab') === tabID;
			btn.classList.toggle('active', match);
			btn.setAttribute('aria-selected', String(match));
		}
		for (const panel of panels) {
			panel.hidden = panel.getAttribute('data-zbf-panel') !== tabID;
		}
	};
	for (const btn of tabBtns) {
		btn.addEventListener('click', () => {
			const id = btn.getAttribute('data-zbf-tab');
			if (id) activate(id);
		});
	}
}

const BridgeFlowPreferences = {
	observerIDs: [] as symbol[],

	init(win?: Window): void {
		const doc = win?.document || (globalThis as any).document as Document | undefined;
		if (!doc) return;
		const pane = doc.getElementById('zotero-prefpane-zotero-bridgeflow');
		if (!pane) return;

		bindTabs(doc);

		const prefs = new UnifiedPrefService();
		const versionEl = doc.getElementById('zbf-version-badge');
		if (versionEl) {
			versionEl.setAttribute('data-l10n-args', JSON.stringify({ version: __BRIDGEFLOW_VERSION__ }));
			versionEl.textContent = `v${__BRIDGEFLOW_VERSION__}`;
		}

		const inputs = Array.from(pane.querySelectorAll('[data-zbf-pref]')) as HTMLInputElement[];
		const syncAll = (): void => {
			prefs.invalidate();
			for (const input of inputs) {
				const key = input.getAttribute('data-zbf-pref') as PrefKey | null;
				if (key && key in PREF_SCHEMA) {
					input.value = String(prefs.get(key));
				}
			}
			updateDependencies(doc, prefs);
		};

		for (const input of inputs) {
			const key = input.getAttribute('data-zbf-pref') as PrefKey | null;
			if (!key || !(key in PREF_SCHEMA)) continue;
			input.addEventListener('change', () => {
				const raw = input.type === 'number' ? Number(input.value) : input.value;
				const next = prefs.set(key, raw as never);
				input.value = String(next);
				updateDependencies(doc, prefs);
			});
		}

		pane.addEventListener('command', () => updateDependencies(doc, prefs));
		pane.addEventListener('change', () => updateDependencies(doc, prefs));

		doc.getElementById('zbf-reset-defaults')?.addEventListener('command', () => {
			prefs.resetAllDefaults();
			syncAll();
			(win || (globalThis as any).window)?.setTimeout?.(() => syncMenulistLabels(doc), 0);
		});

		doc.getElementById('zbf-clear-cache')?.addEventListener('command', () => {
			const app = (globalThis as any).Zotero?.zoterobridgeflow;
			app?.kernel?.bus?.emit('inspector:clear-cache', { target: 'all' });
		});

		(doc as { l10n?: { ready?: Promise<unknown> } }).l10n?.ready?.then?.(() => syncMenulistLabels(doc));

		if (!this.observerIDs.length && (globalThis as any).Zotero?.Prefs?.registerObserver) {
			const keys = Object.keys(PREF_SCHEMA) as PrefKey[];
			this.observerIDs = keys.map((k) =>
				(globalThis as any).Zotero.Prefs.registerObserver(PREF_PREFIX + k, () => syncAll(), true),
			);
			(win || (globalThis as any).window)?.addEventListener?.('unload', () => {
				for (const id of this.observerIDs) {
					try { (globalThis as any).Zotero.Prefs.unregisterObserver(id); } catch { /* ignore */ }
				}
				this.observerIDs = [];
				prefs.dispose();
			}, { once: true });
		}

		syncAll();
	},
};

(globalThis as any).BridgeFlowPreferences = BridgeFlowPreferences;
if (typeof (globalThis as any).document !== 'undefined') {
	const d = (globalThis as any).document as Document;
	if (d.readyState === 'loading') {
		d.addEventListener('DOMContentLoaded', () => BridgeFlowPreferences.init(), { once: true });
	} else {
		BridgeFlowPreferences.init();
	}
}
