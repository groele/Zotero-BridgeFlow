import { tLocale } from './kernel/locale.ts';
import type { UnifiedPrefService } from './kernel/pref-service.ts';
import {
	ANNOTATION_COLOR_PRESETS,
	DEFAULT_ANNOTATION_COLORS,
	normalizeHexColor,
	parseColorSemantics,
	parseEnabledAnnotationColors,
	serializeEnabledAnnotationColors,
} from './services/annotation-utils.ts';

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

function detectColorPresetValue(enabled: ReadonlySet<string>): '3' | '5' | '8' | 'custom' {
	for (const key of ['3', '5', '8'] as const) {
		const list = ANNOTATION_COLOR_PRESETS[key];
		if (enabled.size === list.length && list.every((hex) => enabled.has(hex))) return key;
	}
	return 'custom';
}

function syncPresetMenulist(doc: Document, enabled: ReadonlySet<string>): void {
	const ml = doc.getElementById('zbf-sel-ann-color-count') as any;
	if (!ml) return;
	const val = detectColorPresetValue(enabled);
	try { ml.value = val; } catch { /* ignore */ }
	ml.setAttribute?.('value', val);
	const items = Array.from(ml.querySelectorAll?.('menuitem') || []) as Element[];
	const matched = items.find((it) => it.getAttribute('value') === val);
	if (matched) {
		try { ml.selectedItem = matched; } catch { /* ignore */ }
		const lbl = matched.getAttribute('label') || (matched.textContent || '').trim();
		if (lbl) ml.setAttribute?.('label', lbl);
	}
}

function parseSlotPairs(rawJson: string): Array<[string, string]> | null {
	const raw = rawJson.trim();
	if (!raw.startsWith('[')) return null;
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return null;
		const pairs: Array<[string, string]> = [];
		for (const item of parsed) {
			if (!Array.isArray(item) || item.length < 2) continue;
			const hex = normalizeHexColor(String(item[0] || ''));
			const lbl = String(item[1] || '').trim();
			if (hex && lbl) pairs.push([hex, lbl]);
		}
		return pairs.length ? pairs : null;
	} catch {
		return null;
	}
}

export function buildColorLabelsJsonFromInputs(inputs: Iterable<HTMLInputElement>): string {
	const entries: Array<[string, string, string]> = [];
	let colorChanged = false;
	const defaults = Object.keys(DEFAULT_ANNOTATION_COLORS);
	let i = 0;
	for (const input of inputs) {
		const hex = normalizeHexColor(input.getAttribute('data-zbf-color'));
		const defHex = normalizeHexColor(input.getAttribute('data-zbf-default-color')) || defaults[i] || '';
		i += 1;
		if (!hex) continue;
		const defLabel = DEFAULT_ANNOTATION_COLORS[defHex] || '';
		const val = input.value.trim() || defLabel;
		if (defHex && hex !== defHex) colorChanged = true;
		entries.push([hex, val, defLabel]);
	}
	if (colorChanged) {
		return JSON.stringify(entries.map(([hex, val]) => [hex, val]));
	}
	const custom: Record<string, string> = {};
	for (const [hex, val, defLabel] of entries) {
		if (val && val !== defLabel) custom[hex] = val;
	}
	return Object.keys(custom).length ? JSON.stringify(custom) : '';
}

export function syncAnnotationColorInputs(doc: Document, rawJson: string, rawEnabled?: string): void {
	const grid = doc.getElementById('zbf-ann-color-grid');
	if (!grid) return;
	const trimmed = rawJson.trim();
	const pairs = parseSlotPairs(trimmed);
	const merged = parseColorSemantics(trimmed);
	const enabled = parseEnabledAnnotationColors(rawEnabled);
	const defaultEntries = Object.entries(DEFAULT_ANNOTATION_COLORS);
	const extraEntries = Object.entries(merged).filter(([hex]) => !(hex in DEFAULT_ANNOTATION_COLORS));
	const activeEl = (doc as { activeElement?: unknown }).activeElement;
	let idx = 0;
	let extraIdx = 0;
	grid.querySelectorAll('.zbf-color-label-item').forEach((row: Element) => {
		const swatch = row.querySelector?.('input[type="color"]') as HTMLInputElement | null;
		const input = row.querySelector?.('input[data-zbf-color]') as HTMLInputElement | null;
		const toggle = row.querySelector?.('input[type="checkbox"]') as HTMLInputElement | null;
		const [defHex, defLabel] = defaultEntries[idx] || ['', ''];
		const pair = pairs?.[idx];
		idx += 1;
		if (!input) return;
		let effectiveHex = defHex;
		if (pair) {
			effectiveHex = pair[0];
		} else if (trimmed) {
			const currentHex = normalizeHexColor(input.getAttribute('data-zbf-color')) || defHex;
			if (currentHex in merged) effectiveHex = currentHex;
			else if (!(defHex in merged) && extraEntries[extraIdx]) effectiveHex = extraEntries[extraIdx++][0];
		}
		const isEnabled = enabled.has(effectiveHex);
		if (toggle) {
			toggle.checked = isEnabled;
			if (isEnabled) toggle.setAttribute('checked', 'true');
			else toggle.removeAttribute('checked');
		}
		(row as HTMLElement).classList?.toggle?.('is-muted', !isEnabled);
		if (activeEl && (activeEl === input || activeEl === swatch)) return;
		const val = pair?.[1] || merged[effectiveHex] || defLabel;
		if (swatch) {
			swatch.value = effectiveHex;
			swatch.setAttribute('value', effectiveHex);
			swatch.title = tLocale(`${effectiveHex}（点击自定义颜色）`, `${effectiveHex} (Click to customize color)`, doc);
		}
		input.setAttribute('data-zbf-color', effectiveHex);
		(row as HTMLElement).style?.setProperty?.('--zbf-pill-color', effectiveHex);
		input.value = val;
		input.setAttribute('value', val);
	});
	syncPresetMenulist(doc, enabled);
}

export function initAnnotationColorEditor(
	doc: Document,
	prefs: UnifiedPrefService,
	onSaved: () => void,
): void {
	const grid = doc.getElementById('zbf-ann-color-grid');
	if (!grid || grid.childElementCount > 0) return;

	const rawStr = String(prefs.get('inspector.annotations.colorLabels') || '');
	const rawEnabled = String(prefs.get('inspector.annotations.enabledColors') || '');
	const enabledSet = parseEnabledAnnotationColors(rawEnabled);
	const pairs = parseSlotPairs(rawStr);
	const merged = parseColorSemantics(rawStr);
	const extraEntries = Object.entries(merged).filter(([hex]) => !(hex in DEFAULT_ANNOTATION_COLORS));

	const commitEnabledFromGrid = () => {
		const activeHexes: string[] = [];
		grid.querySelectorAll('.zbf-color-label-item').forEach((item: Element) => {
			const cb = item.querySelector?.('input[type="checkbox"]') as HTMLInputElement | null;
			const inp = item.querySelector?.('input[data-zbf-color]') as HTMLInputElement | null;
			const hex = normalizeHexColor(inp?.getAttribute('data-zbf-color'));
			const on = Boolean(cb?.checked);
			(item as HTMLElement).classList?.toggle?.('is-muted', !on);
			if (on && hex) activeHexes.push(hex);
		});
		if (!activeHexes.length) return false;
		const serialized = serializeEnabledAnnotationColors(activeHexes);
		prefs.set('inspector.annotations.enabledColors', serialized);
		syncPresetMenulist(doc, new Set(activeHexes));
		onSaved();
		return true;
	};

	let idx = 0;
	let extraIdx = 0;
	for (const [defHex, defLabel] of Object.entries(DEFAULT_ANNOTATION_COLORS)) {
		const pair = pairs?.[idx];
		idx += 1;
		let hex = pair ? pair[0] : defHex;
		if (!pair && rawStr && extraEntries[extraIdx] && !rawStr.toLowerCase().includes(defHex)) {
			hex = extraEntries[extraIdx++][0];
		}
		const isEnabled = enabledSet.has(hex);
		const row = doc.createElementNS(XHTML_NS, 'div') as HTMLDivElement;
		row.className = isEnabled ? 'zbf-color-label-item' : 'zbf-color-label-item is-muted';
		row.style?.setProperty?.('--zbf-pill-color', hex);

		const swatch = doc.createElementNS(XHTML_NS, 'input') as HTMLInputElement;
		swatch.type = 'color';
		swatch.className = 'zbf-color-label-dot';
		swatch.value = hex;
		swatch.setAttribute('value', hex);
		swatch.title = tLocale(`${hex}（点击自定义颜色）`, `${hex} (Click to customize color)`, doc);

		const input = doc.createElementNS(XHTML_NS, 'input') as HTMLInputElement;
		input.type = 'text';
		input.className = 'zbf-text-input zbf-color-label-input';
		input.setAttribute('data-zbf-default-color', defHex);
		input.setAttribute('data-zbf-color', hex);
		input.placeholder = defLabel;
		input.value = merged[hex] || defLabel;
		input.setAttribute('value', input.value);
		input.title = tLocale('点击编辑颜色语义标签', 'Click to edit semantic color label', doc);

		const toggle = doc.createElementNS(XHTML_NS, 'input') as HTMLInputElement;
		toggle.type = 'checkbox';
		toggle.className = 'zbf-color-label-toggle';
		toggle.checked = isEnabled;
		if (isEnabled) toggle.setAttribute('checked', 'true');
		toggle.title = tLocale('在 PDF 选词弹窗中启用/隐藏此颜色', 'Show or hide this color in PDF selection popup', doc);

		const commit = (fallbackEmpty: boolean) => {
			if (fallbackEmpty && !input.value.trim()) input.value = defLabel;
			const allInputs = Array.from(grid.querySelectorAll('input[data-zbf-color]')) as HTMLInputElement[];
			const nextJson = buildColorLabelsJsonFromInputs(allInputs);
			prefs.set('inspector.annotations.colorLabels', nextJson);
			onSaved();
		};
		const applyColor = () => {
			const nextHex = normalizeHexColor(swatch.value) || defHex;
			input.setAttribute('data-zbf-color', nextHex);
			swatch.title = tLocale(`${nextHex}（点击自定义颜色）`, `${nextHex} (Click to customize color)`, doc);
			row.style?.setProperty?.('--zbf-pill-color', nextHex);
			commit(true);
			if (toggle.checked) commitEnabledFromGrid();
		};
		swatch.addEventListener('input', applyColor);
		swatch.addEventListener('change', applyColor);
		input.addEventListener('click', (ev: Event) => ev.stopPropagation());
		input.addEventListener('input', () => commit(false));
		input.addEventListener('change', () => commit(true));
		input.addEventListener('blur', () => {
			commit(true);
			try { input.setSelectionRange?.(0, 0); } catch { /* ignore */ }
			input.scrollLeft = 0;
		});
		input.addEventListener('keydown', (ev: KeyboardEvent) => { if (ev.key === 'Enter') { commit(true); input.blur?.(); } });
		toggle.addEventListener('click', (ev: Event) => ev.stopPropagation());
		toggle.addEventListener('change', () => {
			if (!commitEnabledFromGrid()) {
				toggle.checked = true;
				row.classList?.remove?.('is-muted');
			}
		});
		row.addEventListener('click', (ev: Event) => {
			if (ev.target === row) input.focus();
		});

		row.append(swatch, input, toggle);
		grid.appendChild(row);
	}

	const presetSel = doc.getElementById('zbf-sel-ann-color-count') as any;
	if (presetSel) {
		const onPreset = () => {
			const val = String(presetSel.selectedItem?.getAttribute?.('value') ?? presetSel.value ?? '') as '3' | '5' | '8' | 'custom';
			if (val !== '3' && val !== '5' && val !== '8') return;
			const presetColors = ANNOTATION_COLOR_PRESETS[val];
			const serialized = serializeEnabledAnnotationColors(presetColors);
			prefs.set('inspector.annotations.enabledColors', serialized);
			syncAnnotationColorInputs(doc, String(prefs.get('inspector.annotations.colorLabels') || ''), serialized);
			onSaved();
		};
		presetSel.addEventListener('command', onPreset);
		presetSel.addEventListener('change', onPreset);
		syncPresetMenulist(doc, enabledSet);
	}
}
