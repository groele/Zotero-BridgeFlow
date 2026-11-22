import { PREF_PREFIX, PREF_SCHEMA, type PrefKey } from './kernel/pref-schema.ts';
import { UnifiedPrefService } from './kernel/pref-service.ts';

function initPreferencesPane(): void {
	const doc = (globalThis as any).document as Document | undefined;
	if (!doc) return;
	const prefs = new UnifiedPrefService();

	const versionEl = doc.getElementById('zbf-version-badge');
	if (versionEl) {
		versionEl.setAttribute('data-l10n-args', JSON.stringify({ version: __BRIDGEFLOW_VERSION__ }));
	}

	// Bind all declarative [data-zbf-pref] controls
	const controls = Array.from(doc.querySelectorAll('[data-zbf-pref]')) as HTMLElement[];
	const syncAllFromPrefs = (): void => {
		for (const el of controls) {
			const key = el.getAttribute('data-zbf-pref') as PrefKey | null;
			if (!key || !(key in PREF_SCHEMA)) continue;
			const val = prefs.get(key);
			if (el instanceof HTMLInputElement && el.type === 'checkbox') {
				el.checked = Boolean(val);
			} else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
				el.value = String(val);
			}
		}
		updateDependencies(doc);
	};

	for (const el of controls) {
		const key = el.getAttribute('data-zbf-pref') as PrefKey | null;
		if (!key || !(key in PREF_SCHEMA)) continue;
		el.addEventListener('change', () => {
			if (el instanceof HTMLInputElement && el.type === 'checkbox') {
				prefs.set(key, el.checked as never);
			} else if (el instanceof HTMLInputElement && el.type === 'number') {
				const next = prefs.set(key, Number(el.value) as never);
				el.value = String(next);
			} else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
				const next = prefs.set(key, el.value as never);
				el.value = String(next);
			}
			updateDependencies(doc);
		});
	}

	const resetBtn = doc.getElementById('zbf-reset-defaults');
	resetBtn?.addEventListener('click', () => {
		prefs.resetAllDefaults();
		syncAllFromPrefs();
	});

	const clearCacheBtn = doc.getElementById('zbf-clear-cache');
	clearCacheBtn?.addEventListener('click', () => {
		const app = (globalThis as any).Zotero?.zoterobridgeflow;
		app?.kernel?.bus?.emit('inspector:clear-cache', { target: 'all' });
	});

	const prefKeys = Object.keys(PREF_SCHEMA) as PrefKey[];
	const stopObserving = prefs.observeKeys(prefKeys, () => syncAllFromPrefs());
	(globalThis as any).addEventListener?.('unload', () => {
		stopObserving();
		prefs.dispose();
	});

	syncAllFromPrefs();
}

function updateDependencies(doc: Document): void {
	const groups = Array.from(doc.querySelectorAll('[data-zbf-depends-on]')) as HTMLElement[];
	for (const group of groups) {
		const masterKey = group.getAttribute('data-zbf-depends-on');
		if (!masterKey) continue;
		const master = doc.querySelector(`[data-zbf-pref="${masterKey}"]`) as HTMLInputElement | null;
		const enabled = master ? master.checked && !master.disabled : true;
		group.classList.toggle('zbf-disabled', !enabled);
		const inputs = Array.from(group.querySelectorAll('input, select, button')) as Array<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>;
		for (const input of inputs) {
			input.disabled = !enabled;
		}
	}
	void PREF_PREFIX;
}

if (typeof (globalThis as any).document !== 'undefined') {
	if ((globalThis as any).document.readyState === 'loading') {
		(globalThis as any).document.addEventListener('DOMContentLoaded', initPreferencesPane, { once: true });
	} else {
		initPreferencesPane();
	}
}
