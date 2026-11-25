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
	--zbf-wc-card: light-dark(#fafafa, #2d2f34);
	--zbf-wc-card-hi: light-dark(#ffffff, #34373e);
	--zbf-wc-well: light-dark(#ebebee, #1f2023);
	--zbf-wc-well-soft: light-dark(rgba(0, 0, 0, 0.042), rgba(255, 255, 255, 0.06));
	--zbf-wc-line: light-dark(rgba(0, 0, 0, 0.08), rgba(255, 255, 255, 0.095));
	--zbf-wc-line-strong: light-dark(rgba(0, 0, 0, 0.13), rgba(255, 255, 255, 0.15));
	--zbf-wc-blue: light-dark(#255fb3, #316dca);
	--zbf-wc-blue-hover: light-dark(#1f529d, #3977d6);
	--zbf-wc-blue-active: light-dark(#1a4687, #2b60b5);
	--zbf-wc-pill-bg: light-dark(rgba(37, 95, 179, 0.10), rgba(75, 148, 255, 0.16));
	--zbf-wc-pill-fg: light-dark(#1f57a8, #7ec0ff);
	--zbf-wc-warn-bg: light-dark(rgba(217, 119, 6, 0.12), rgba(245, 158, 11, 0.18));
	--zbf-wc-warn-bd: light-dark(rgba(217, 119, 6, 0.25), rgba(245, 158, 11, 0.34));
	--zbf-wc-warn-fg: light-dark(#944f08, #fbbf24);
	--zbf-wc-ok-bg: light-dark(rgba(22, 128, 67, 0.11), rgba(34, 197, 94, 0.18));
	--zbf-wc-ok-fg: light-dark(#16794b, #4ade80);
	box-sizing: border-box; display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px;
	inline-size: 100%; max-inline-size: 100%; min-inline-size: 0; contain: inline-size; overflow: hidden;
	padding: 3px 5px 6px 3px; background: transparent;
	font: 12px/1.4 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei UI", sans-serif;
	color: var(--zbf-wc-fg);
}
.zbf-word-cite-wrap [hidden] { display: none !important; }
.zbf-wc-main-view { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; min-width: 0; }
.zbf-wc-svg { width: 12px; height: 12px; flex: none; display: block; pointer-events: none; }

/* Distinct Soft Native Cards (Concept A) */
.zbf-wc-card {
	box-sizing: border-box; background: var(--zbf-wc-card);
	border: 1px solid var(--zbf-wc-line); border-radius: 6px;
	padding: 6px 8px; min-width: 0; max-width: 100%;
}

/* 1. Document Card */
.zbf-wc-doc-row { display: flex; align-items: center; gap: 7px; min-width: 0; }
.zbf-wc-w {
	width: 20px; height: 22px; border-radius: 4px; flex: none;
	background: var(--zbf-wc-well-soft); color: var(--zbf-wc-fg-muted);
	display: grid; place-items: center; font-size: 10px; font-weight: 700;
}
.zbf-wc-w.is-live { background: var(--zbf-wc-pill-bg); color: var(--zbf-wc-pill-fg); }
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
	appearance: none; height: 21px; padding: 0 6px; gap: 3px; border-radius: 4px;
	border: 1px solid var(--zbf-wc-line); background: var(--zbf-wc-card-hi);
	color: var(--zbf-wc-fg-sec); font: 500 10px/1 inherit; font-variant-numeric: tabular-nums;
	cursor: pointer; flex: none; display: inline-flex; align-items: center; justify-content: center;
	transition: border-color 120ms ease, color 120ms ease;
}
.zbf-wc-doc-switch .zbf-wc-svg { width: 11px; height: 11px; }
.zbf-wc-doc-switch:hover:not(:disabled) { border-color: var(--zbf-wc-blue); color: var(--zbf-wc-pill-fg); }

/* 2. Three Independent Stat Tiles */
.zbf-wc-stat-strip {
	display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; min-width: 0;
}
.zbf-wc-stat-cell {
	box-sizing: border-box; padding: 5px 7px; border-radius: 6px;
	background: var(--zbf-wc-card); border: 1px solid var(--zbf-wc-line);
	text-align: left; min-width: 0; transition: border-color 120ms ease, background-color 120ms ease;
}
.zbf-wc-stat-cell.is-interactive { cursor: pointer; }
.zbf-wc-stat-cell.is-interactive:hover { background: var(--zbf-wc-card-hi); border-color: var(--zbf-wc-line-strong); }
.zbf-wc-stat-val {
	display: block; font-size: 14px; font-weight: 600; line-height: 1.12;
	font-variant-numeric: tabular-nums; color: var(--zbf-wc-fg);
}
.zbf-wc-stat-lbl {
	display: block; font-size: 9.5px; color: var(--zbf-wc-fg-muted); margin-top: 2px;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.zbf-wc-stat-cell.is-warn { border-color: var(--zbf-wc-warn-bd); background: var(--zbf-wc-warn-bg); }
.zbf-wc-stat-cell.is-warn .zbf-wc-stat-val,
.zbf-wc-stat-cell.is-warn .zbf-wc-stat-lbl { color: var(--zbf-wc-warn-fg); }

/* 3. Selected Item Card */
.zbf-wc-cite-kicker {
	display: block; font-size: 9.5px; color: var(--zbf-wc-fg-muted); margin-bottom: 2px;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.zbf-wc-cite-title-row {
	font-size: 11.5px; font-weight: 500; line-height: 1.38; color: var(--zbf-wc-fg);
	display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word;
}
.zbf-wc-ord-badge {
	display: inline-block; margin-inline-end: 4px; padding: 0.5px 5px; border-radius: 3.5px;
	font-size: 10px; font-weight: 500; font-variant-numeric: tabular-nums; vertical-align: baseline;
	background: var(--zbf-wc-well-soft); color: var(--zbf-wc-fg-muted);
}
.zbf-wc-ord-badge.is-cited {
	background: var(--zbf-wc-pill-bg); color: var(--zbf-wc-pill-fg); font-weight: 600;
}
.zbf-wc-cite-sub {
	font-size: 10px; color: var(--zbf-wc-fg-muted); margin-top: 2.5px;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.zbf-wc-synergy {
	display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;
	margin-top: 5px; padding-top: 4px; border-top: 1px solid var(--zbf-wc-line); min-width: 0;
}
.zbf-wc-link {
	appearance: none; min-width: 0; max-width: 100%; background: transparent; border: 0; padding: 1px 0;
	font: 400 10.5px/1.3 inherit; color: var(--zbf-wc-pill-fg); cursor: pointer;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;
}
.zbf-wc-link:hover:not(:disabled) { text-decoration: underline; }
.zbf-wc-link:disabled { opacity: 0.45; cursor: default; }

/* 4. Standalone Action Bar (Academic Deep Blue Primary Button + Square Refresh) */
.zbf-wc-actions {
	display: grid; grid-template-columns: minmax(0, 1fr) 28px; gap: 5px; align-items: stretch; min-width: 0;
}
.zbf-word-cite-action {
	appearance: none; box-sizing: border-box; height: 28px; min-width: 0; padding: 0 10px; gap: 5.5px;
	border-radius: 6px; border: 1px solid var(--zbf-wc-blue);
	background: var(--zbf-wc-blue); color: #ffffff;
	font: 500 11.5px/1 inherit; cursor: pointer;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	display: inline-flex; align-items: center; justify-content: center;
	transition: background-color 120ms ease, border-color 120ms ease, opacity 120ms ease;
}
.zbf-word-cite-action::before {
	content: ""; width: 12px; height: 12px; flex: none; background-color: currentColor;
	mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 14' fill='none'%3E%3Cpath d='M3 4.2h8M3 7h5.2M9.5 6.8v4.4M7.3 9h4.4' stroke='%23000' stroke-width='1.45' stroke-linecap='round'/%3E%3C/svg%3E") center / contain no-repeat;
}
.zbf-word-cite-action:hover:not(:disabled) { background: var(--zbf-wc-blue-hover); border-color: var(--zbf-wc-blue-hover); }
.zbf-word-cite-action:active:not(:disabled) { background: var(--zbf-wc-blue-active); }
.zbf-word-cite-action:disabled { opacity: 0.48; cursor: default; }
.zbf-word-refresh-action {
	appearance: none; box-sizing: border-box; height: 28px; width: 28px; padding: 0; border-radius: 6px;
	border: 1px solid var(--zbf-wc-line); background: var(--zbf-wc-card);
	color: var(--zbf-wc-fg-sec); cursor: pointer;
	display: inline-flex; align-items: center; justify-content: center;
	transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}
.zbf-word-refresh-action .zbf-wc-svg { width: 12.5px; height: 12.5px; }
.zbf-word-refresh-action:hover:not(:disabled) {
	background: var(--zbf-wc-card-hi); border-color: var(--zbf-wc-line-strong); color: var(--zbf-wc-fg);
}
.zbf-word-refresh-action:disabled { opacity: 0.45; cursor: default; }

/* Orphan Recovery Accordion (when broken citations exist) */
.zbf-wc-acc {
	box-sizing: border-box; background: var(--zbf-wc-card);
	border: 1px solid var(--zbf-wc-warn-bd); border-radius: 6px;
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
.zbf-wc-doc-switch:focus-visible, .zbf-word-cite-action:focus-visible, .zbf-word-refresh-action:focus-visible, .zbf-wc-link:focus-visible, .zbf-wc-col-inline:focus-visible, .zbf-wc-acc-head:focus-visible, .zbf-wc-rem-entry:focus-visible, .zbf-wc-sub-back:focus-visible, .zbf-wc-sec-btn:focus-visible, .zbf-wc-rcp-btn:focus-visible, .zbf-wc-rem-row:focus-visible { outline: 2px solid var(--accent-blue, #255fb3); outline-offset: 1px; }
`;
