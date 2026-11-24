import type { UnifiedPrefService } from './kernel/pref-service.ts';
import {
	DEFAULT_ANNOTATION_COLORS,
	normalizeHexColor,
	parseColorSemantics,
} from './services/annotation-utils.ts';

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

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

export function syncAnnotationColorInputs(doc: Document, rawJson: string): void {
	const grid = doc.getElementById('zbf-ann-color-grid');
	if (!grid) return;
	const trimmed = rawJson.trim();
	const pairs = parseSlotPairs(trimmed);
	const merged = parseColorSemantics(trimmed);
	const defaultEntries = Object.entries(DEFAULT_ANNOTATION_COLORS);
	const extraEntries = Object.entries(merged).filter(([hex]) => !(hex in DEFAULT_ANNOTATION_COLORS));
	const activeEl = (doc as { activeElement?: unknown }).activeElement;
	let idx = 0;
	let extraIdx = 0;
	grid.querySelectorAll('.zbf-color-label-item').forEach((row: Element) => {
		const swatch = row.querySelector?.('input[type="color"]') as HTMLInputElement | null;
		const input = row.querySelector?.('input[data-zbf-color]') as HTMLInputElement | null;
		const [defHex, defLabel] = defaultEntries[idx] || ['', ''];
		const pair = pairs?.[idx];
		idx += 1;
		if (!input) return;
		if (activeEl && (activeEl === input || activeEl === swatch)) return;
		let effectiveHex = defHex;
		if (pair) {
			effectiveHex = pair[0];
		} else if (trimmed) {
			const currentHex = normalizeHexColor(input.getAttribute('data-zbf-color')) || defHex;
			if (currentHex in merged) effectiveHex = currentHex;
			else if (!(defHex in merged) && extraEntries[extraIdx]) effectiveHex = extraEntries[extraIdx++][0];
		}
		const val = pair?.[1] || merged[effectiveHex] || defLabel;
		if (swatch) {
			swatch.value = effectiveHex;
			swatch.setAttribute('value', effectiveHex);
			swatch.title = `${effectiveHex}（点击自定义颜色）`;
		}
		input.setAttribute('data-zbf-color', effectiveHex);
		(row as HTMLElement).style?.setProperty?.('--zbf-pill-color', effectiveHex);
		input.value = val;
		input.setAttribute('value', val);
	});
}

export function initAnnotationColorEditor(
	doc: Document,
	prefs: UnifiedPrefService,
	onSaved: () => void,
): void {
	const grid = doc.getElementById('zbf-ann-color-grid');
	if (!grid || grid.childElementCount > 0) return;

	const rawStr = String(prefs.get('inspector.annotations.colorLabels') || '');
	const pairs = parseSlotPairs(rawStr);
	const merged = parseColorSemantics(rawStr);
	const extraEntries = Object.entries(merged).filter(([hex]) => !(hex in DEFAULT_ANNOTATION_COLORS));

	let idx = 0;
	let extraIdx = 0;
	for (const [defHex, defLabel] of Object.entries(DEFAULT_ANNOTATION_COLORS)) {
		const pair = pairs?.[idx];
		idx += 1;
		let hex = pair ? pair[0] : defHex;
		if (!pair && rawStr && extraEntries[extraIdx] && !rawStr.toLowerCase().includes(defHex)) {
			hex = extraEntries[extraIdx++][0];
		}
		const row = doc.createElementNS(XHTML_NS, 'div') as HTMLDivElement;
		row.className = 'zbf-color-label-item';
		row.style?.setProperty?.('--zbf-pill-color', hex);

		const swatch = doc.createElementNS(XHTML_NS, 'input') as HTMLInputElement;
		swatch.type = 'color';
		swatch.className = 'zbf-color-label-dot';
		swatch.value = hex;
		swatch.setAttribute('value', hex);
		swatch.title = `${hex}（点击自定义颜色）`;

		const input = doc.createElementNS(XHTML_NS, 'input') as HTMLInputElement;
		input.type = 'text';
		input.className = 'zbf-text-input zbf-color-label-input';
		input.setAttribute('data-zbf-default-color', defHex);
		input.setAttribute('data-zbf-color', hex);
		input.placeholder = defLabel;
		input.value = merged[hex] || defLabel;
		input.setAttribute('value', input.value);
		input.title = '点击编辑颜色语义标签';

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
			swatch.title = `${nextHex}（点击自定义颜色）`;
			row.style?.setProperty?.('--zbf-pill-color', nextHex);
			commit(true);
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
		row.addEventListener('click', (ev: Event) => {
			if (ev.target === row) input.focus();
		});

		row.append(swatch, input);
		grid.appendChild(row);
	}
}
