import type { UnifiedClipboardService } from '../../services/clipboard-service.ts';

const MATRIX_STYLE_ID = 'zbf-matrix-modal-style';

export const MATRIX_CSS = `
.zbf-matrix-backdrop { position: fixed; inset: 0; z-index: 2147483646; background: rgba(15,23,42,0.48); display: flex; align-items: center; justify-content: center; padding: 20px; }
.zbf-matrix-dialog { width: min(1040px, 94vw); max-height: 86vh; display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border-radius: 12px; background: light-dark(#ffffff, #1e293b); color: light-dark(#111827, #e2e8f0); border: 1px solid light-dark(rgba(15,23,42,0.14), rgba(148,163,184,0.24)); box-shadow: 0 20px 50px rgba(0,0,0,0.32); font: 12.5px/1.45 system-ui, "Microsoft YaHei UI", sans-serif; }
.zbf-matrix-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.zbf-matrix-title { font-size: 15px; font-weight: 600; }
.zbf-matrix-close { width: 26px; height: 26px; border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; font-size: 14px; display: inline-flex; align-items: center; justify-content: center; }
.zbf-matrix-close:hover { background: light-dark(rgba(15,23,42,0.08), rgba(255,255,255,0.1)); }
.zbf-matrix-controls { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.zbf-matrix-search-wrap { position: relative; flex: 1 1 230px; min-width: 180px; display: flex; align-items: center; }
.zbf-matrix-input { width: 100%; height: 29px; padding: 0 26px 0 9px; border-radius: 6px; border: 1px solid light-dark(rgba(15,23,42,0.18), rgba(148,163,184,0.32)); background: light-dark(#f8fafc, #0f172a); color: inherit; font: inherit; box-sizing: border-box; }
.zbf-matrix-input:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.16); }
.zbf-matrix-clear { position: absolute; right: 4px; width: 20px; height: 20px; border: 0; border-radius: 4px; background: transparent; color: inherit; opacity: 0.6; cursor: pointer; display: none; align-items: center; justify-content: center; }
.zbf-matrix-clear:hover { opacity: 1; background: rgba(128,128,128,0.16); }
.zbf-matrix-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; border: 1px solid light-dark(rgba(15,23,42,0.16), rgba(148,163,184,0.28)); background: transparent; color: inherit; cursor: pointer; font-size: 11.5px; transition: background-color 0.12s, border-color 0.12s; }
.zbf-matrix-chip:hover { background: light-dark(rgba(15,23,42,0.05), rgba(255,255,255,0.06)); }
.zbf-matrix-chip[data-active="true"] { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 600; }
.zbf-matrix-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; display: inline-block; border: 1px solid rgba(0,0,0,0.18); }
.zbf-matrix-empty { padding: 32px 16px; text-align: center; font-size: 13px; opacity: 0.72; }
.zbf-matrix-scroll { flex: 1 1 auto; overflow: auto; border: 1px solid light-dark(rgba(15,23,42,0.14), rgba(148,163,184,0.22)); border-radius: 8px; }
.zbf-matrix-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
.zbf-matrix-table th, .zbf-matrix-table td { border-bottom: 1px solid light-dark(rgba(15,23,42,0.1), rgba(148,163,184,0.16)); border-right: 1px solid light-dark(rgba(15,23,42,0.08), rgba(148,163,184,0.14)); padding: 7px 9px; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
.zbf-matrix-table th { position: sticky; top: 0; background: light-dark(#f8fafc, #0f172a); font-weight: 600; z-index: 1; }
.zbf-matrix-table tbody tr:hover td { background: light-dark(rgba(15,23,42,0.015), rgba(255,255,255,0.02)); }
.zbf-matrix-item-link { border: 0; padding: 0; background: transparent; color: light-dark(#2563eb, #60a5fa); font: inherit; font-weight: 600; text-align: left; cursor: pointer; }
.zbf-matrix-item-link:hover { text-decoration: underline; }
.zbf-matrix-ann { margin-bottom: 6px; padding: 4px 6px; border-radius: 4px; border-left: 3px solid transparent; background: light-dark(rgba(15,23,42,0.03), rgba(255,255,255,0.04)); cursor: pointer; transition: background-color 0.12s ease; }
.zbf-matrix-ann:hover { background: light-dark(rgba(37,99,235,0.09), rgba(96,165,250,0.15)); }
.zbf-matrix-ann:last-child { margin-bottom: 0; }
.zbf-matrix-mark { padding: 0 2px; border-radius: 2px; background: light-dark(#fef08a, rgba(250, 204, 21, 0.34)); color: inherit; font-weight: 600; }
.zbf-matrix-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.zbf-matrix-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.zbf-matrix-btn { padding: 5px 11px; border-radius: 6px; border: 1px solid light-dark(rgba(15,23,42,0.18), rgba(148,163,184,0.28)); background: light-dark(#f8fafc, #0f172a); color: inherit; font: 500 12px/1.2 inherit; cursor: pointer; }
.zbf-matrix-btn:hover { background: light-dark(#e2e8f0, #334155); }
.zbf-matrix-btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.zbf-matrix-btn.primary:hover { background: #1d4ed8; }
.zbf-matrix-status { font-size: 12px; opacity: 0.85; }
`;

export function matrixEl(doc: Document, tag: string): HTMLElement {
	return doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElement;
}

export function ensureMatrixStyles(doc: Document): void {
	if (!doc) return;
	const existing = doc.getElementById(MATRIX_STYLE_ID);
	if (existing) {
		if (existing.textContent !== MATRIX_CSS) existing.textContent = MATRIX_CSS;
		return;
	}
	const style = matrixEl(doc, 'style') as HTMLStyleElement;
	style.id = MATRIX_STYLE_ID;
	style.textContent = MATRIX_CSS;
	(doc.head || doc.documentElement)?.appendChild(style);
}

export function writeMatrixClipboard(text: string, clipboard?: UnifiedClipboardService): boolean {
	if (clipboard?.writePayload('', text, true)) return true;
	try {
		const cb = (globalThis as any).Zotero?.Utilities?.Internal?.copyTextToClipboard;
		if (typeof cb === 'function') { cb(text); return true; }
	} catch { /* ignore */ }
	return false;
}

export function extractQueryTerms(rawQuery: string): string[] {
	return String(rawQuery || '')
		.split(/(?:\|\||&&)/)
		.map((s) => s.trim().toLowerCase())
		.filter((s) => s.length >= 2);
}

export function renderHighlightedSnippet(doc: Document, container: HTMLElement, text: string, terms: readonly string[]): void {
	if (!terms.length || !doc.createTextNode) {
		container.textContent = text;
		return;
	}
	const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	const re = new RegExp(`(${escaped.join('|')})`, 'gi');
	let last = 0;
	for (const match of text.matchAll(re)) {
		const idx = match.index ?? 0;
		if (idx > last) container.appendChild(doc.createTextNode(text.slice(last, idx)));
		const mark = matrixEl(doc, 'mark');
		mark.className = 'zbf-matrix-mark';
		mark.textContent = match[0];
		container.appendChild(mark);
		last = idx + match[0].length;
	}
	if (last < text.length) container.appendChild(doc.createTextNode(text.slice(last)));
}
