import { formatReadingDuration, type TabReadingProgress } from '../../../services/reading-stats.ts';

export const VISUAL_COL_STYLE_ID = 'zbf-visual-col-style';
export const VISUAL_COL_POPOVER_ID = 'zbf-visual-col-popover';

const activeVisualPopClosers = new WeakMap<Document, { key: string; close: () => void }>();

export function vcEl<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K): HTMLElementTagNameMap[K] {
	return doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K];
}

export function closeVisualColumnPopover(doc: Document | null | undefined): void {
	if (!doc) return;
	const entry = activeVisualPopClosers.get(doc);
	if (entry) {
		activeVisualPopClosers.delete(doc);
		entry.close();
	} else {
		doc.getElementById(VISUAL_COL_POPOVER_ID)?.remove();
	}
}

export function isVisualColumnPopoverOpenFor(doc: Document | null | undefined, key: string): boolean {
	if (!doc) return false;
	return activeVisualPopClosers.get(doc)?.key === key && Boolean(doc.getElementById(VISUAL_COL_POPOVER_ID));
}

export const VISUAL_COLUMN_CSS = `
@keyframes zbfVcPopIn { from { opacity: 0; transform: translateY(-4px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
.zbf-read-cell, .zbf-ann-cell { display: flex; align-items: center; height: 100%; min-width: 0; pointer-events: auto; user-select: none; overflow: hidden; }
.zbf-cell-fit { display: flex; align-items: center; width: 100%; height: 100%; min-width: 0; container-type: inline-size; container-name: zbf-cell; }
.zbf-read-chip { display: grid; grid-template-columns: minmax(0, 1fr); align-items: center; row-gap: 2px; width: 100%; min-width: 0; box-sizing: border-box; padding: 1.5px 4px; border-radius: 6px; cursor: pointer; font-variant-numeric: tabular-nums; transition: background-color 0.14s ease, transform 0.12s ease; }
.zbf-read-chip:hover { background: light-dark(rgba(13,148,136,0.10), rgba(45,212,191,0.16)); }
.zbf-read-chip:active { transform: scale(0.985); }
.zbf-read-dur { font-size: 11.5px; font-weight: 600; color: inherit; white-space: nowrap; }
.zbf-read-page { display: none; font-size: 10.5px; opacity: 0.74; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.zbf-read-pct { display: none; font-size: 10.5px; font-weight: 600; opacity: 0.62; white-space: nowrap; }
.zbf-read-bar { display: block; width: 100%; min-width: 24px; height: 3px; border-radius: 999px; background: light-dark(rgba(15,23,42,0.11), rgba(148,163,184,0.22)); overflow: hidden; }
.zbf-read-bar-fill { display: block; height: 100%; border-radius: 999px; transition: width 0.2s ease; }
@container zbf-cell (min-width: 96px) {
  .zbf-read-chip { grid-template-columns: auto minmax(0, 1fr); column-gap: 6px; }
  .zbf-read-page { display: inline; justify-self: end; text-align: right; }
  .zbf-read-bar { grid-column: 1 / -1; grid-row: 2; }
}
@container zbf-cell (min-width: 164px) {
  .zbf-read-chip { grid-template-columns: auto minmax(36px, 1fr) auto; column-gap: 8px; row-gap: 0; padding: 3px 4px; }
  .zbf-read-dur { grid-column: 1; grid-row: 1; }
  .zbf-read-bar { grid-column: 2; grid-row: 1; height: 4px; }
  .zbf-read-page { grid-column: 3; grid-row: 1; }
}
@container zbf-cell (min-width: 210px) {
  .zbf-read-chip[data-has-pct="1"] { grid-template-columns: auto minmax(44px, 1fr) auto auto; }
  .zbf-read-chip[data-has-pct="1"] .zbf-read-pct { display: inline; grid-column: 4; grid-row: 1; }
}
.virtualized-table:focus-within .row.selected .zbf-read-chip:hover { background: rgba(255,255,255,0.18); }
.virtualized-table:focus-within .row.selected .zbf-read-bar { background: rgba(255,255,255,0.28); }
.virtualized-table:focus-within .row.selected .zbf-read-bar-fill { background: rgba(255,255,255,0.92) !important; }
.zbf-ann-chip { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; box-sizing: border-box; padding: 2px 6px; border-radius: 6px; cursor: pointer; background: light-dark(rgba(15,23,42,0.045), rgba(148,163,184,0.12)); transition: background-color 0.14s ease, transform 0.12s ease; }
.zbf-ann-chip:hover { background: light-dark(rgba(79,70,229,0.10), rgba(129,140,248,0.20)); }
.zbf-ann-chip:active { transform: scale(0.985); }
.zbf-ann-total { font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; flex: none; }
.zbf-ann-stack { display: inline-flex; align-items: center; flex: 1 1 28px; min-width: 24px; max-width: 96px; height: 6px; border-radius: 999px; overflow: hidden; gap: 1px; background: light-dark(rgba(15,23,42,0.08), rgba(255,255,255,0.14)); }
.zbf-ann-seg { display: block; height: 100%; min-width: 3px; }
.zbf-ann-dots { display: none; align-items: center; gap: 6px; margin-inline-start: auto; min-width: 0; overflow: hidden; font-size: 10.5px; font-variant-numeric: tabular-nums; opacity: 0.88; }
.zbf-ann-dot-item { display: inline-flex; align-items: center; gap: 2.5px; white-space: nowrap; }
.zbf-ann-dot-lbl { display: none; font-weight: 500; opacity: 0.85; max-width: 56px; overflow: hidden; text-overflow: ellipsis; }
.zbf-ann-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; flex: none; }
@container zbf-cell (min-width: 96px) {
  .zbf-ann-dots { display: inline-flex; }
}
@container zbf-cell (min-width: 180px) {
  .zbf-ann-dot-lbl { display: inline; }
}
.virtualized-table:focus-within .row.selected .zbf-ann-chip { background: rgba(255,255,255,0.18); }
.virtualized-table:focus-within .row.selected .zbf-ann-chip:hover { background: rgba(255,255,255,0.28); }
.zbf-vc-pop { position: fixed; z-index: 2147483645; width: 312px; max-width: calc(100vw - 16px); padding: 11px 12px; border-radius: 13px; background: light-dark(rgba(255,255,255,0.97), rgba(20,29,46,0.97)); backdrop-filter: blur(14px); color: light-dark(#0f172a, #e2e8f0); border: 1px solid light-dark(rgba(15,23,42,0.11), rgba(148,163,184,0.24)); box-shadow: 0 18px 42px rgba(15,23,42,0.20), 0 4px 12px rgba(15,23,42,0.08), inset 0 1px 0 light-dark(rgba(255,255,255,0.85), rgba(255,255,255,0.07)); font: 12px/1.45 system-ui, "Microsoft YaHei UI", sans-serif; display: flex; flex-direction: column; gap: 9px; transform-origin: top left; animation: zbfVcPopIn 0.15s cubic-bezier(0.22,1,0.36,1); }
.zbf-vc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.zbf-vc-title { font-size: 12.5px; font-weight: 700; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.zbf-vc-badge { flex: none; padding: 1.5px 7px; border-radius: 999px; font-size: 10.5px; font-weight: 600; background: light-dark(rgba(13,148,136,0.12), rgba(45,212,191,0.18)); color: light-dark(#0f766e, #5eead4); white-space: nowrap; }
.zbf-vc-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.zbf-vc-metric { padding: 6px 7px; border-radius: 8px; background: light-dark(#f8fafc, rgba(30,41,59,0.72)); border: 1px solid light-dark(rgba(15,23,42,0.06), rgba(148,163,184,0.14)); }
.zbf-vc-metric-k { font-size: 10.5px; opacity: 0.68; }
.zbf-vc-metric-v { font-size: 12.5px; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 1px; }
.zbf-vc-heatbars { display: flex; align-items: flex-end; gap: 3px; height: 42px; padding: 5px 6px 4px; border-radius: 8px; background: light-dark(#f8fafc, rgba(15,23,42,0.55)); border: 1px solid light-dark(rgba(15,23,42,0.06), rgba(148,163,184,0.14)); }
.zbf-vc-hbar { flex: 1 1 0; min-width: 4px; border: 0; padding: 0; border-radius: 3px 3px 1px 1px; cursor: pointer; transition: transform 0.12s ease, filter 0.12s ease; }
.zbf-vc-hbar:hover { transform: scaleY(1.12); filter: brightness(1.08); }
.zbf-vc-hint { font-size: 11px; opacity: 0.72; }
.zbf-vc-dist-list { display: flex; flex-direction: column; gap: 5px; }
.zbf-vc-dist-row { display: grid; grid-template-columns: 76px minmax(0, 1fr) 24px; align-items: center; gap: 7px; font-size: 11.5px; }
.zbf-vc-dist-lbl { display: inline-flex; align-items: center; gap: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.zbf-vc-dist-track { height: 7px; border-radius: 999px; background: light-dark(rgba(15,23,42,0.07), rgba(148,163,184,0.16)); overflow: hidden; }
.zbf-vc-dist-fill { height: 100%; border-radius: 999px; }
.zbf-vc-dist-cnt { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; opacity: 0.8; }
.zbf-vc-snippets { display: flex; flex-direction: column; gap: 5px; max-height: 210px; overflow-y: auto; padding-right: 2px; }
.zbf-vc-snippet { flex: none; height: auto !important; min-height: 0; white-space: normal; display: flex; align-items: flex-start; gap: 6px; width: 100%; padding: 6px 8px; border-radius: 7px; border: 1px solid light-dark(rgba(15,23,42,0.07), rgba(148,163,184,0.14)); background: light-dark(#f8fafc, rgba(30,41,59,0.55)); color: inherit; font: inherit; text-align: left; cursor: pointer; transition: border-color 0.14s, background-color 0.14s, transform 0.12s; }
.zbf-vc-snippet:hover { border-color: light-dark(rgba(79,70,229,0.45), rgba(129,140,248,0.55)); background: light-dark(rgba(79,70,229,0.06), rgba(129,140,248,0.16)); transform: translateX(2px); }
.zbf-vc-snippet-txt { flex: 1 1 auto; min-width: 0; font-size: 11.5px; line-height: 1.42; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
.zbf-vc-snippet-pg { flex: none; font-size: 10.5px; opacity: 0.65; font-variant-numeric: tabular-nums; }
.zbf-vc-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding-top: 2px; border-top: 1px solid light-dark(rgba(15,23,42,0.07), rgba(148,163,184,0.16)); }
.zbf-vc-btn { flex: 1 1 auto; height: 27px; padding: 0 9px; border-radius: 7px; border: 1px solid light-dark(rgba(15,23,42,0.12), rgba(148,163,184,0.26)); background: light-dark(#ffffff, rgba(30,41,59,0.85)); color: inherit; font-family: inherit; font-size: 11.5px; font-weight: 600; line-height: 1; cursor: pointer; white-space: nowrap; transition: background-color 0.14s, border-color 0.14s, transform 0.12s; }
.zbf-vc-btn:hover { border-color: light-dark(rgba(79,70,229,0.45), rgba(129,140,248,0.55)); background: light-dark(rgba(79,70,229,0.07), rgba(129,140,248,0.18)); }
.zbf-vc-btn:active { transform: scale(0.97); }
.zbf-vc-btn-primary { border: 0; background: linear-gradient(135deg, #0d9488, #2563eb); color: #ffffff; }
.zbf-vc-btn-primary:hover { filter: brightness(1.06); background: linear-gradient(135deg, #0d9488, #2563eb); }
@media (prefers-reduced-motion: reduce) { .zbf-vc-pop { animation: none !important; } .zbf-read-chip, .zbf-ann-chip, .zbf-vc-hbar, .zbf-vc-snippet, .zbf-vc-btn { transition: none !important; } }
`;

const styledVisualDocs = new WeakMap<Document, HTMLElement>();

export function ensureVisualColumnStyles(doc: Document): void {
	if (!doc) return;
	const tracked = styledVisualDocs.get(doc);
	if (tracked && tracked.parentNode) return;
	const existing = doc.getElementById(VISUAL_COL_STYLE_ID);
	if (existing) {
		if (existing.textContent !== VISUAL_COLUMN_CSS) existing.textContent = VISUAL_COLUMN_CSS;
		styledVisualDocs.set(doc, existing);
		return;
	}
	const style = vcEl(doc, 'style');
	style.id = VISUAL_COL_STYLE_ID;
	style.textContent = VISUAL_COLUMN_CSS;
	(doc.head || doc.documentElement)?.appendChild(style);
	styledVisualDocs.set(doc, style);
}

export function formatSubMinuteDuration(seconds?: number): string {
	const total = Math.max(0, Math.floor(Number(seconds) || 0));
	if (total <= 0) return '';
	if (total < 60) return `${total}s`;
	return formatReadingDuration(total);
}

export function findPeakReadingPage(progress?: TabReadingProgress): { page: number; seconds: number } | null {
	const map = progress?.pageSeconds;
	if (!map) return null;
	let bestPage = 0;
	let bestSec = 0;
	for (const [k, v] of Object.entries(map)) {
		const page = Number(k);
		const sec = Number(v);
		if (Number.isFinite(page) && page > 0 && Number.isFinite(sec) && sec > bestSec) {
			bestPage = page;
			bestSec = sec;
		}
	}
	return bestPage > 0 ? { page: bestPage, seconds: bestSec } : null;
}

export async function openItemPdfAtPage(item: any, pageNumber?: number, annotationID?: number): Promise<boolean> {
	const zotero = (globalThis as any).Zotero;
	const readerApi = zotero?.Reader;
	if (!readerApi?.open || !item) return false;

	let parentItem = item;
	if (typeof parentItem.isRegularItem !== 'function' && parentItem.id && zotero?.Items) {
		parentItem = zotero.Items.get?.(parentItem.id) || (await zotero.Items.getAsync?.(parentItem.id).catch(() => null)) || item;
	}

	let att: any = null;
	if (parentItem?.isPDFAttachment?.() || parentItem?.isFileAttachment?.()) {
		att = parentItem;
	} else {
		try {
			const best = await parentItem?.getBestAttachment?.();
			if (best && !best.deleted && (best.isPDFAttachment?.() || best.isFileAttachment?.())) {
				att = best;
			}
		} catch { /* fallback below */ }
		if (!att && typeof parentItem?.getAttachments === 'function') {
			for (const aid of parentItem.getAttachments() || []) {
				const cand = zotero?.Items?.get?.(aid) || (await zotero?.Items?.getAsync?.(aid).catch(() => null));
				if (cand && !cand.deleted && (cand.isPDFAttachment?.() || cand.isFileAttachment?.())) {
					att = cand;
					break;
				}
			}
		}
	}
	if (!att?.id) return false;

	const location: Record<string, unknown> = {};
	if (annotationID && annotationID > 0) {
		const ann = zotero?.Items?.get?.(annotationID) || (await zotero?.Items?.getAsync?.(annotationID).catch(() => null));
		if (ann?.key) location.annotationID = ann.key;
		try {
			const pos = typeof ann?.annotationPosition === 'string' ? JSON.parse(ann.annotationPosition) : ann?.annotationPosition;
			if (Number.isInteger(pos?.pageIndex) && pos.pageIndex >= 0) location.pageIndex = pos.pageIndex;
		} catch { /* ignore malformed position */ }
	}
	if (location.pageIndex === undefined && typeof pageNumber === 'number' && Number.isFinite(pageNumber) && pageNumber >= 1) {
		location.pageIndex = Math.max(0, Math.floor(pageNumber) - 1);
	}
	const locArg = Object.keys(location).length ? location : undefined;

	try {
		const opened = await readerApi.open(att.id, locArg, { openInWindow: false });
		const instance = opened || readerApi._readers?.find?.((r: any) => Number(r?.itemID) === Number(att.id) && !r?._isTabClosed);
		if (instance) {
			if (instance.tabID) {
				const targetWin = instance._window || zotero?.getMainWindow?.();
				targetWin?.Zotero_Tabs?.select?.(instance.tabID, true);
			}
			if (locArg) {
				await Promise.resolve(instance._initPromise ?? instance._waitForReader?.()).catch(() => {});
				try { await instance.navigate?.(locArg); } catch { /* ignore */ }
			}
		}
		return true;
	} catch {
		try {
			await readerApi.open(att.id, undefined, { openInWindow: false });
			return true;
		} catch {
			return false;
		}
	}
}

export function mountAnchoredPopover(win: Window, anchor: HTMLElement, pop: HTMLElement, key: string): () => void {
	const doc = win.document;
	closeVisualColumnPopover(doc);
	let closed = false;
	const close = () => {
		if (closed) return;
		closed = true;
		if (activeVisualPopClosers.get(doc)?.close === close) activeVisualPopClosers.delete(doc);
		doc.removeEventListener('mousedown', onOutside, true);
		doc.removeEventListener('keydown', onKey, true);
		win.removeEventListener('resize', close);
		pop.remove();
	};
	const onOutside = (e: MouseEvent) => {
		const target = e.target as Node;
		if (!pop.contains(target) && !anchor.contains(target)) close();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === 'Escape') { e.preventDefault(); close(); }
	};
	activeVisualPopClosers.set(doc, { key, close });
	(doc.body || doc.documentElement)?.appendChild(pop);

	const rect = anchor.getBoundingClientRect?.() || { left: 100, bottom: 100, top: 80 };
	const vw = win.innerWidth || 1200;
	const vh = win.innerHeight || 800;
	const pw = pop.offsetWidth || 312;
	const ph = pop.offsetHeight || 240;
	const left = Math.max(8, Math.min(rect.left, vw - pw - 8));
	const top = rect.bottom + ph + 8 > vh ? Math.max(8, rect.top - ph - 6) : rect.bottom + 5;
	pop.style.left = `${Math.round(left)}px`;
	pop.style.top = `${Math.round(top)}px`;

	doc.addEventListener('mousedown', onOutside, true);
	doc.addEventListener('keydown', onKey, true);
	win.addEventListener('resize', close);
	return close;
}
