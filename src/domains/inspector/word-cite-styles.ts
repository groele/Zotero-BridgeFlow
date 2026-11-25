const SVG_NS = 'http://www.w3.org/2000/svg';

export type WordCiteIconName = 'refresh' | 'switch' | 'chevron';

const ICON_PATHS: Readonly<Record<WordCiteIconName, { viewBox: string; paths: readonly string[] }>> = {
	refresh: {
		viewBox: '0 0 14 14',
		paths: [
			'M11.4 7a4.4 4.4 0 1 1-1.12-2.95',
			'M11.5 2.1v2.2H9.3',
		],
	},
	switch: {
		viewBox: '0 0 14 14',
		paths: [
			'M2.5 4.7h8.5M8.8 2.5L11 4.7 8.8 7',
			'M11.5 9.3H3M5.2 7L3 9.3l2.2 2.2',
		],
	},
	chevron: {
		viewBox: '0 0 12 12',
		paths: ['M2.6 4.5L6 7.9 9.4 4.5'],
	},
};

export function createWordCiteSvgIcon(doc: Document, name: WordCiteIconName, cls = 'zbf-wc-svg'): Element {
	const spec = ICON_PATHS[name];
	const svg = typeof doc.createElementNS === 'function'
		? doc.createElementNS(SVG_NS, 'svg')
		: doc.createElement('span');
	svg.setAttribute('class', cls);
	svg.setAttribute('viewBox', spec.viewBox);
	svg.setAttribute('fill', 'none');
	svg.setAttribute('aria-hidden', 'true');
	for (const d of spec.paths) {
		const path = typeof doc.createElementNS === 'function'
			? doc.createElementNS(SVG_NS, 'path')
			: doc.createElement('span');
		path.setAttribute('d', d);
		path.setAttribute('stroke', 'currentColor');
		path.setAttribute('stroke-width', '1.4');
		path.setAttribute('stroke-linecap', 'round');
		path.setAttribute('stroke-linejoin', 'round');
		svg.appendChild(path);
	}
	return svg;
}

export const WORD_CITE_SCHEME_C_CSS = `
item-details:not([pinnedPane]:not([pinnedPane=""])) .zotero-view-item:has(> :nth-last-child(1 of [data-pane]:not([hidden])) .zbf-word-cite-wrap)::before { height: 0; }
.zbf-word-cite-wrap {
	--zbf-wc-fg: var(--fill-primary, light-dark(#1f2328, #e6e8ec));
	--zbf-wc-fg-sec: light-dark(#57606a, #a0a8b4);
	--zbf-wc-fg-muted: light-dark(#6e7781, #858d99);
	--zbf-wc-card: light-dark(#ffffff, #2d3036);
	--zbf-wc-card-hi: light-dark(#ffffff, #343841);
	--zbf-wc-well: light-dark(#ebebee, #1f2023);
	--zbf-wc-well-soft: light-dark(rgba(0, 0, 0, 0.045), rgba(255, 255, 255, 0.065));
	--zbf-wc-line: light-dark(rgba(0, 0, 0, 0.085), rgba(255, 255, 255, 0.1));
	--zbf-wc-line-strong: light-dark(rgba(0, 0, 0, 0.15), rgba(255, 255, 255, 0.18));
	--zbf-wc-blue: light-dark(#2d64bd, #5b9cf5);
	--zbf-wc-pill-bg: light-dark(rgba(45, 100, 189, 0.10), rgba(91, 156, 245, 0.16));
	--zbf-wc-pill-fg: light-dark(#2a5fb5, #84bcff);
	--zbf-wc-warn-bg: light-dark(#fdf3e1, rgba(245, 158, 11, 0.16));
	--zbf-wc-warn-bd: light-dark(#edd09a, rgba(245, 158, 11, 0.32));
	--zbf-wc-warn-fg: light-dark(#944f08, #fbbf24);
	--zbf-wc-ok-bg: light-dark(#eef8f2, rgba(34, 197, 94, 0.16));
	--zbf-wc-ok-fg: light-dark(#18794e, #4ade80);
	box-sizing: border-box; display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px;
	inline-size: 100%; max-inline-size: 100%; min-inline-size: 0; contain: inline-size; overflow: hidden;
	padding: 3px 5px 6px 3px; background: transparent;
	font: 12px/1.4 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei UI", sans-serif;
	color: var(--zbf-wc-fg);
}
.zbf-word-cite-wrap [hidden] { display: none !important; }
.zbf-wc-main-view { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; min-width: 0; }
.zbf-wc-svg { width: 12px; height: 12px; flex: none; display: block; pointer-events: none; }

.zbf-wc-card {
	box-sizing: border-box; background: var(--zbf-wc-card);
	border: 1px solid var(--zbf-wc-line); border-radius: 7px;
	padding: 6px 8px; min-width: 0; max-width: 100%;
}

/* 1. Document Card (Harmonized with B4 Cornflower Blue) */
.zbf-wc-doc-card {
	background: linear-gradient(135deg, light-dark(#eef4fe, rgba(58, 118, 210, 0.2)) 0%, light-dark(#fafcff, rgba(45, 95, 184, 0.06)) 100%);
	border-color: light-dark(#ccdef9, rgba(96, 165, 250, 0.28));
}
.zbf-wc-doc-row { display: flex; align-items: center; gap: 7px; min-width: 0; }
.zbf-wc-w {
	width: 21px; height: 22px; border-radius: 5px; flex: none;
	background: var(--zbf-wc-well-soft); color: var(--zbf-wc-fg-muted);
	display: grid; place-items: center; font-size: 10.5px; font-weight: 700;
}
.zbf-wc-w.is-live {
	background: linear-gradient(135deg, light-dark(#3a76d2, #4280de) 0%, light-dark(#2d5fb8, #3164bd) 100%);
	color: #ffffff;
}
.zbf-wc-doc-meta { min-width: 0; flex: 1 1 0; display: grid; gap: 1px; }
.zbf-wc-docname {
	font-size: 11.5px; font-weight: 500; line-height: 1.32; color: var(--zbf-wc-fg);
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.zbf-wc-doc-sub {
	display: flex; align-items: center; gap: 4px; font-size: 9.5px; color: var(--zbf-wc-fg-muted);
	min-width: 0; overflow: hidden; white-space: nowrap;
}
.zbf-wc-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: light-dark(#adb5bd, #636b75); }
.zbf-wc-dot.is-live { background: #1fa363; }
.zbf-wc-doc-status { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-inline-sep { opacity: 0.55; flex: none; }
.zbf-wc-col-inline {
	appearance: none; border: 0; background: transparent; padding: 0 2px; border-radius: 3px;
	font: inherit; color: var(--zbf-wc-pill-fg); cursor: pointer;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
}
.zbf-wc-col-inline:hover { text-decoration: underline; background: var(--zbf-wc-pill-bg); }
.zbf-wc-doc-switch {
	appearance: none; height: 21px; padding: 0 6px; gap: 3px; border-radius: 5px;
	border: 1px solid light-dark(#ccdef9, rgba(96, 165, 250, 0.28));
	background: light-dark(rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0.08));
	color: var(--zbf-wc-fg-sec); font: 500 10px/1 inherit; font-variant-numeric: tabular-nums;
	cursor: pointer; flex: none; display: inline-flex; align-items: center; justify-content: center;
	transition: border-color 120ms ease, color 120ms ease;
}
.zbf-wc-doc-switch .zbf-wc-svg { width: 11px; height: 11px; }
.zbf-wc-doc-switch:hover:not(:disabled) { border-color: var(--zbf-wc-blue); color: var(--zbf-wc-pill-fg); }

/* 2. Three Color-Tinted Stat Tiles (Clean, Balanced Contrast) */
.zbf-wc-stat-strip {
	display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; min-width: 0;
}
.zbf-wc-stat-cell {
	box-sizing: border-box; padding: 5px 7px; border-radius: 7px;
	background: var(--zbf-wc-card); border: 1px solid var(--zbf-wc-line);
	text-align: left; min-width: 0; transition: filter 120ms ease, border-color 120ms ease;
}
.zbf-wc-stat-cell:nth-child(1) {
	background: light-dark(#eff4fd, rgba(58, 118, 210, 0.14));
	border-color: light-dark(#d0e0f8, rgba(96, 165, 250, 0.25));
}
.zbf-wc-stat-cell:nth-child(1) .zbf-wc-stat-val { color: light-dark(#2457a8, #8cc2ff); }
.zbf-wc-stat-cell:nth-child(2) {
	background: light-dark(#f2f2fd, rgba(129, 140, 248, 0.13));
	border-color: light-dark(#d8dbf8, rgba(129, 140, 248, 0.25));
}
.zbf-wc-stat-cell:nth-child(2) .zbf-wc-stat-val { color: light-dark(#434aa6, #a5b4fc); }
.zbf-wc-stat-cell:nth-child(3) {
	background: light-dark(#eef8f2, rgba(34, 197, 94, 0.12));
	border-color: light-dark(#c8e8d5, rgba(34, 197, 94, 0.25));
}
.zbf-wc-stat-cell:nth-child(3) .zbf-wc-stat-val { color: light-dark(#18794e, #4ade80); }
.zbf-wc-stat-cell.is-interactive { cursor: pointer; }
.zbf-wc-stat-cell.is-interactive:hover { filter: brightness(0.98); }
.zbf-wc-stat-val {
	display: block; font-size: 13.5px; font-weight: 600; line-height: 1.12;
	font-variant-numeric: tabular-nums; color: var(--zbf-wc-fg);
}
.zbf-wc-stat-lbl {
	display: block; font-size: 9.5px; color: var(--zbf-wc-fg-muted); margin-top: 2px;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.zbf-wc-stat-cell:nth-child(3).is-warn,
.zbf-wc-stat-cell.is-warn { border-color: var(--zbf-wc-warn-bd); background: var(--zbf-wc-warn-bg); }
.zbf-wc-stat-cell.is-warn .zbf-wc-stat-val,
.zbf-wc-stat-cell.is-warn .zbf-wc-stat-lbl { color: var(--zbf-wc-warn-fg); }

/* 3. Selected Item Card (Zotero Coral Spine & Soft Rose Tint) */
.zbf-wc-cite-card {
	background: linear-gradient(135deg, light-dark(#fff9fa, rgba(244, 63, 94, 0.11)) 0%, light-dark(#ffffff, #2d3036) 100%);
	border-color: light-dark(#ecd2d5, rgba(244, 63, 94, 0.28));
	border-inline-start: 3px solid light-dark(#c9323f, #f45b69);
}
.zbf-wc-cite-kicker {
	display: block; font-size: 9.5px; color: var(--zbf-wc-fg-muted); margin-bottom: 2px;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.zbf-wc-cite-title-row {
	font-size: 11.5px; font-weight: 500; line-height: 1.38; color: var(--zbf-wc-fg);
	display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word;
}
.zbf-wc-ord-badge {
	display: inline-block; margin-inline-end: 4px; padding: 0.5px 5px; border-radius: 4px;
	font-size: 10px; font-weight: 500; font-variant-numeric: tabular-nums; vertical-align: baseline;
	background: var(--zbf-wc-well-soft); color: var(--zbf-wc-fg-muted);
}
.zbf-wc-ord-badge.is-cited {
	background: light-dark(#fdedef, rgba(244, 63, 94, 0.18));
	color: light-dark(#b4232f, #fda4af); font-weight: 600;
}
.zbf-wc-cite-sub {
	font-size: 10px; color: var(--zbf-wc-fg-muted); margin-top: 2.5px;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.zbf-wc-synergy {
	display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;
	margin-top: 5px; padding-top: 4px; border-top: 1px solid light-dark(rgba(201, 50, 63, 0.1), rgba(255, 255, 255, 0.08)); min-width: 0;
}
.zbf-wc-link {
	appearance: none; min-width: 0; max-width: 100%; background: transparent; border: 0; padding: 1px 0;
	font: 400 10.5px/1.3 inherit; color: var(--zbf-wc-pill-fg); cursor: pointer;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;
}
.zbf-wc-link:hover:not(:disabled) { text-decoration: underline; }
.zbf-wc-link:disabled { opacity: 0.45; cursor: default; }

/* 4. Standalone Action Bar (B4: Borderless Cornflower Blue Soft-Glow CTA + Matching Refresh) */
.zbf-wc-actions {
	display: grid; grid-template-columns: minmax(0, 1fr) 29px; gap: 6px; align-items: stretch; min-width: 0;
}
.zbf-word-cite-action {
	appearance: none; box-sizing: border-box; height: 29px; min-width: 0; padding: 0 10px; gap: 6px;
	border: 0; border-radius: 7px;
	background: linear-gradient(135deg, light-dark(#3a76d2, #4280de) 0%, light-dark(#2d5fb8, #3164bd) 100%);
	box-shadow: 0 2px 6px light-dark(rgba(45, 95, 184, 0.24), rgba(0, 0, 0, 0.34));
	color: #ffffff; font: 500 11.5px/1 inherit; cursor: pointer;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	display: inline-flex; align-items: center; justify-content: center;
	transition: filter 130ms ease, box-shadow 130ms ease, transform 80ms ease, opacity 120ms ease;
}
.zbf-word-cite-action::before {
	content: ""; width: 12px; height: 12px; flex: none; background-color: currentColor;
	mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 14' fill='none'%3E%3Cpath d='M3 4.2h8M3 7h5.2M9.5 6.8v4.4M7.3 9h4.4' stroke='%23000' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E") center / contain no-repeat;
}
.zbf-word-cite-action:hover:not(:disabled) {
	filter: brightness(1.07);
	box-shadow: 0 3px 8px light-dark(rgba(45, 95, 184, 0.32), rgba(0, 0, 0, 0.44));
}
.zbf-word-cite-action:active:not(:disabled) { filter: brightness(0.96); box-shadow: 0 1px 3px rgba(45, 95, 184, 0.2); }
.zbf-word-cite-action:disabled {
	background: var(--zbf-wc-well); color: var(--zbf-wc-fg-muted);
	box-shadow: none; cursor: default; opacity: 0.72;
}
.zbf-word-refresh-action {
	appearance: none; box-sizing: border-box; height: 29px; width: 29px; padding: 0; border-radius: 7px;
	border: 1px solid light-dark(#d4dce7, #444954); background: light-dark(#ffffff, #31353e);
	box-shadow: 0 1px 2px light-dark(rgba(20, 40, 70, 0.05), rgba(0, 0, 0, 0.2));
	color: var(--zbf-wc-fg-sec); cursor: pointer;
	display: inline-flex; align-items: center; justify-content: center;
	transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}
.zbf-word-refresh-action .zbf-wc-svg { width: 12.5px; height: 12.5px; }
.zbf-word-refresh-action:hover:not(:disabled) {
	background: light-dark(#f4f7fc, #3a3f4a); border-color: light-dark(#9ec0ec, #5d6473); color: var(--zbf-wc-pill-fg);
}
.zbf-word-refresh-action:disabled { opacity: 0.45; cursor: default; box-shadow: none; }

/* Orphan Recovery Accordion */
.zbf-wc-acc {
	box-sizing: border-box; background: var(--zbf-wc-card);
	border: 1px solid var(--zbf-wc-warn-bd); border-radius: 7px;
	overflow: hidden; min-width: 0; max-width: 100%;
}
.zbf-wc-acc-head {
	appearance: none; width: 100%; box-sizing: border-box; display: flex; align-items: center; gap: 6px;
	padding: 6px 9px; border: 0; background: var(--zbf-wc-warn-bg); color: var(--zbf-wc-fg);
	text-align: left; cursor: pointer; font: 500 11px/1.35 inherit; min-width: 0;
}
.zbf-wc-badge {
	display: inline-flex; align-items: center; justify-content: center;
	min-width: 15px; height: 15px; padding: 0 4px; border-radius: 999px;
	background: var(--zbf-wc-well-soft); color: var(--zbf-wc-fg-sec);
	font-size: 9.5px; font-weight: 700; flex: none; font-variant-numeric: tabular-nums;
}
.zbf-wc-badge.is-warn { background: rgba(217, 119, 6, 0.2); color: var(--zbf-wc-warn-fg); }
.zbf-wc-badge.is-ok { background: var(--zbf-wc-ok-bg); color: var(--zbf-wc-ok-fg); }
.zbf-wc-acc-title { min-width: 0; flex: 1 1 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-acc-arrow { flex: none; color: var(--zbf-wc-fg-muted); display: inline-flex; align-items: center; justify-content: center; transition: transform 140ms ease; }
.zbf-wc-acc.is-closed .zbf-wc-acc-arrow { transform: rotate(-90deg); }
.zbf-wc-acc-body {
	box-sizing: border-box; padding: 6px 8px 8px; border-top: 1px solid var(--zbf-wc-line);
	display: grid; gap: 6px; min-width: 0; max-width: 100%; overflow: hidden;
}
.zbf-wc-sec-btn {
	appearance: none; box-sizing: border-box; height: 24px; padding: 0 9px; border-radius: 5px;
	border: 1px solid var(--zbf-wc-warn-bd); background: var(--zbf-wc-warn-bg);
	color: var(--zbf-wc-warn-fg); font: 500 10.5px/1 inherit; cursor: pointer; white-space: nowrap;
}
.zbf-wc-sec-btn:hover:not(:disabled) { filter: brightness(0.97); }
.zbf-wc-sec-btn:disabled { opacity: 0.45; cursor: default; }
.zbf-wc-doc-switch:focus-visible, .zbf-word-cite-action:focus-visible, .zbf-word-refresh-action:focus-visible, .zbf-wc-link:focus-visible, .zbf-wc-col-inline:focus-visible, .zbf-wc-acc-head:focus-visible, .zbf-wc-rem-entry:focus-visible, .zbf-wc-sec-btn:focus-visible, .zbf-wc-rcp-btn:focus-visible, .zbf-wc-rem-row:focus-visible { outline: 2px solid var(--accent-blue, #3a76d2); outline-offset: 1px; }
`;
