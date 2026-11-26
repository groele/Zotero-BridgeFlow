export { createWordCiteSvgIcon, type WordCiteIconName } from './word-cite-icons.ts';

export const WORD_CITE_SCHEME_C_CSS = `
item-details:not([pinnedPane]:not([pinnedPane=""])) .zotero-view-item:has(> :nth-last-child(1 of [data-pane]:not([hidden])) .zbf-word-cite-wrap)::before { height: 0; }
.zbf-word-cite-wrap {
	--zbf-num-font: "Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
	--zbf-wc-fg: var(--fill-primary, light-dark(#1a2230, #e8ecf2));
	--zbf-wc-fg-sec: light-dark(#4e5b6c, #a2acb9);
	--zbf-wc-fg-muted: light-dark(#6c7888, #848f9e);
	--zbf-wc-lbl: light-dark(#5a6677, #9ca7b8);
	--zbf-wc-card: light-dark(#ffffff, #2c3038);
	--zbf-wc-card-hi: light-dark(#ffffff, #343842);
	--zbf-wc-subtle: light-dark(#f7f9fc, #272a31);
	--zbf-wc-well: light-dark(#ebeef3, #1e2126);
	--zbf-wc-well-soft: light-dark(rgba(20, 34, 56, 0.055), rgba(255, 255, 255, 0.07));
	--zbf-wc-line: light-dark(rgba(20, 34, 56, 0.095), rgba(255, 255, 255, 0.1));
	--zbf-wc-line-strong: light-dark(rgba(20, 34, 56, 0.16), rgba(255, 255, 255, 0.18));
	--zbf-wc-blue: light-dark(#2563c4, #5b9cf5);
	--zbf-wc-pill-bg: light-dark(#eef4fe, rgba(76, 138, 230, 0.18));
	--zbf-wc-pill-fg: light-dark(#1d4fa3, #8cc0ff);
	--zbf-wc-warn-bg: light-dark(#fff4de, rgba(245, 158, 11, 0.17));
	--zbf-wc-warn-bd: light-dark(#e8be76, rgba(251, 191, 36, 0.35));
	--zbf-wc-warn-fg: light-dark(#a65108, #fcd34d);
	--zbf-wc-ok-bg: light-dark(#ebf8f1, rgba(34, 197, 94, 0.15));
	--zbf-wc-ok-fg: light-dark(#13794b, #4ade80);
	--zbf-w-b1: light-dark(#fbbf24, #fcd34d);
	--zbf-w-b2: light-dark(#f59e0b, #fbbf24);
	--zbf-w-b3: light-dark(#d97706, #f59e0b);
	--zbf-w-b4: light-dark(#b45309, #d97706);
	--zbf-w-shield: light-dark(#b45309, #d97706);
	--zbf-w-shadow: light-dark(rgba(120, 53, 15, 0.22), rgba(0, 0, 0, 0.36));
	box-sizing: border-box; display: grid; grid-template-columns: minmax(0, 1fr); gap: 7px;
	inline-size: 100%; max-inline-size: 100%; min-inline-size: 0; contain: inline-size; overflow: hidden;
	padding: 3px 5px 7px 3px; background: transparent;
	font: 12px/1.42 "Segoe UI Variable Text", system-ui, -apple-system, "Segoe UI", "Microsoft YaHei UI", sans-serif;
	color: var(--zbf-wc-fg);
}
.zbf-word-cite-wrap [hidden] { display: none !important; }
.zbf-wc-main-view { display: grid; grid-template-columns: minmax(0, 1fr); gap: 7px; min-width: 0; }
.zbf-wc-svg { width: 12px; height: 12px; flex: none; display: block; pointer-events: none; }
.zbf-wc-word-svg { width: 22px; height: 22px; flex: none; display: block; pointer-events: none; }

.zbf-wc-card {
	box-sizing: border-box; background: var(--zbf-wc-card);
	border: 1px solid var(--zbf-wc-line); border-radius: 8px;
	padding: 7px 9px; min-width: 0; max-width: 100%;
	box-shadow: 0 1px 2px light-dark(rgba(18, 32, 54, 0.035), rgba(0, 0, 0, 0.2));
}

/* 1. Document Card (Amber when disconnected, Cornflower Blue when live) */
.zbf-wc-doc-card {
	background: linear-gradient(135deg, var(--zbf-wc-warn-bg) 0%, color-mix(in srgb, var(--zbf-wc-warn-bg) 45%, var(--zbf-wc-card)) 100%);
	border-color: var(--zbf-wc-warn-bd);
	transition: background-color 150ms ease, border-color 150ms ease;
}
.zbf-wc-doc-card.is-live {
	--zbf-w-b1: #41a5ee;
	--zbf-w-b2: #2b7cd3;
	--zbf-w-b3: #185abd;
	--zbf-w-b4: #103f91;
	--zbf-w-shield: #185abd;
	--zbf-w-shadow: rgba(11, 37, 89, 0.26);
	background: linear-gradient(135deg, light-dark(#eef4fe, rgba(58, 118, 210, 0.2)) 0%, light-dark(#fafcff, rgba(44, 48, 56, 0.9)) 100%);
	border-color: light-dark(#ccdef9, rgba(96, 165, 250, 0.3));
}
.zbf-wc-doc-row { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 32px; }
.zbf-wc-w { width: 22px; height: 22px; flex: none; display: grid; place-items: center; }
.zbf-wc-doc-meta { min-width: 0; flex: 1 1 0; display: grid; gap: 1.5px; }
.zbf-wc-docname {
	display: flex; align-items: baseline; font-size: 12px; font-weight: 600; line-height: 1.3;
	color: var(--zbf-wc-warn-fg); min-width: 0; overflow: hidden; white-space: nowrap;
}
.zbf-wc-doc-card.is-live .zbf-wc-docname { color: var(--zbf-wc-fg); }
.zbf-wc-doc-stem { overflow: hidden; text-overflow: ellipsis; }
.zbf-wc-doc-ext { flex: none; font-size: 11px; font-weight: 450; color: var(--zbf-wc-fg-muted); }
.zbf-wc-doc-sub {
	display: flex; align-items: center; gap: 4.5px; font-size: 10.5px; font-weight: 500;
	color: var(--zbf-wc-warn-fg); min-width: 0; overflow: hidden; white-space: nowrap;
}
.zbf-wc-doc-card.is-live .zbf-wc-doc-sub { color: var(--zbf-wc-fg-sec); font-weight: 400; }
.zbf-wc-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: #d97706; }
.zbf-wc-dot.is-live { background: #1ea866; box-shadow: 0 0 0 2.5px var(--zbf-wc-ok-bg); }
.zbf-wc-doc-status { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-inline-sep { opacity: 0.48; flex: none; }
.zbf-wc-col-inline {
	appearance: none; border: 0; background: transparent; padding: 0 3px; border-radius: 4px;
	font-family: inherit; font-size: 10.5px; font-weight: 500; line-height: 1.3; color: var(--zbf-wc-pill-fg); cursor: pointer;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
}
.zbf-wc-col-inline:hover { text-decoration: underline; background: var(--zbf-wc-pill-bg); }
.zbf-wc-doc-switch {
	appearance: none; height: 22px; padding: 0 6px; gap: 3.5px; border-radius: 5.5px;
	border: 1px solid light-dark(#ccdef9, rgba(96, 165, 250, 0.28));
	background: light-dark(rgba(255, 255, 255, 0.88), rgba(255, 255, 255, 0.08));
	color: var(--zbf-wc-fg-sec); font-family: var(--zbf-num-font); font-size: 10px; font-weight: 550; line-height: 1;
	font-variant-numeric: tabular-nums; cursor: pointer; flex: none; display: inline-flex; align-items: center; justify-content: center;
	transition: border-color 120ms ease, color 120ms ease, background-color 120ms ease;
}
.zbf-wc-doc-switch .zbf-wc-svg { width: 11px; height: 11px; }
.zbf-wc-doc-switch:hover:not(:disabled) { border-color: var(--zbf-wc-blue); color: var(--zbf-wc-pill-fg); background: var(--zbf-wc-pill-bg); }

/* 2. Three Color-Tinted Stat Tiles (18px/650 Coordinated Numbers + Slate Labels) */
.zbf-wc-stat-strip {
	display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; min-width: 0;
}
.zbf-wc-stat-cell {
	box-sizing: border-box; padding: 7px 8px 6px; border-radius: 8px;
	background: var(--zbf-wc-subtle); border: 1px solid var(--zbf-wc-line);
	box-shadow: 0 1px 2px light-dark(rgba(18, 32, 54, 0.03), rgba(0, 0, 0, 0.16));
	text-align: left; min-width: 0; transition: filter 120ms ease, border-color 120ms ease, transform 120ms ease;
}
.zbf-wc-stat-val {
	display: block; font-family: var(--zbf-num-font); font-size: 18px; font-weight: 500; line-height: 1.15;
	letter-spacing: -0.015em; font-variant-numeric: tabular-nums;
	color: color-mix(in srgb, var(--zbf-wc-fg-muted) 70%, transparent);
}
.zbf-wc-stat-strip.is-live .zbf-wc-stat-val { font-weight: 650; }
.zbf-wc-stat-lbl {
	display: block; font-size: 10.5px; font-weight: 400; color: var(--zbf-wc-lbl); margin-top: 2px;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.zbf-wc-stat-strip.is-live .zbf-wc-stat-cell:nth-child(1) {
	background: linear-gradient(180deg, light-dark(#f5f9ff, rgba(59, 130, 246, 0.18)) 0%, light-dark(#eff4fd, rgba(59, 130, 246, 0.11)) 100%);
	border-color: light-dark(#d2e3fa, rgba(96, 165, 250, 0.3));
}
.zbf-wc-stat-strip.is-live .zbf-wc-stat-cell:nth-child(1) .zbf-wc-stat-val { color: light-dark(#2358b2, #7fb4fc); }
.zbf-wc-stat-strip.is-live .zbf-wc-stat-cell:nth-child(2) {
	background: linear-gradient(180deg, light-dark(#f7f7ff, rgba(129, 140, 248, 0.18)) 0%, light-dark(#f0f0fd, rgba(129, 140, 248, 0.11)) 100%);
	border-color: light-dark(#dadcf8, rgba(129, 140, 248, 0.3));
}
.zbf-wc-stat-strip.is-live .zbf-wc-stat-cell:nth-child(2) .zbf-wc-stat-val { color: light-dark(#4c4aa1, #adaaf8); }
.zbf-wc-stat-strip.is-live .zbf-wc-stat-cell:nth-child(3) {
	background: linear-gradient(180deg, light-dark(#f3fbf7, rgba(34, 197, 94, 0.16)) 0%, light-dark(#ebf7f0, rgba(34, 197, 94, 0.1)) 100%);
	border-color: light-dark(#c6e8d4, rgba(74, 222, 128, 0.28));
}
.zbf-wc-stat-strip.is-live .zbf-wc-stat-cell:nth-child(3) .zbf-wc-stat-val { color: light-dark(#19734b, #52d886); }
.zbf-wc-stat-cell.is-interactive { cursor: pointer; }
.zbf-wc-stat-cell.is-interactive:hover { filter: brightness(0.985); transform: translateY(-0.5px); }
.zbf-wc-stat-strip.is-live .zbf-wc-stat-cell[class*="zbf-wc-stat-cell"].is-warn,
.zbf-wc-stat-cell.is-warn { border-color: var(--zbf-wc-warn-bd); background: var(--zbf-wc-warn-bg); }
.zbf-wc-stat-strip.is-live .zbf-wc-stat-cell.is-warn .zbf-wc-stat-val { color: var(--zbf-wc-warn-fg); }
.zbf-wc-stat-strip.is-live .zbf-wc-stat-cell.is-warn .zbf-wc-stat-lbl { color: color-mix(in srgb, var(--zbf-wc-warn-fg) 85%, var(--zbf-wc-fg-sec)); }
.zbf-wc-stat-cell.is-warn .zbf-wc-stat-lbl::after { content: " ↘"; font-weight: 600; }

/* 3. Selected Item Card (Zotero Coral Spine + Soft Ordinal Badge + In-Text Freq Pill) */
.zbf-wc-cite-card {
	position: relative; padding: 8px 9px 8px 12px;
	background: linear-gradient(135deg, light-dark(#fff9fa, rgba(244, 63, 94, 0.11)) 0%, light-dark(#ffffff, #2c3038) 68%);
	border-color: light-dark(#ebd0d4, rgba(244, 63, 94, 0.28));
	overflow: hidden;
}
.zbf-wc-cite-card::before {
	content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3.5px;
	background: light-dark(#c9323f, #f06572); opacity: 0.72;
}
.zbf-wc-cite-card.is-live::before { opacity: 1; }
.zbf-wc-cite-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-height: 17px; margin-bottom: 3px; }
.zbf-wc-cite-kicker { font-size: 10.5px; font-weight: 550; color: var(--zbf-wc-fg-sec); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-cite-freq {
	flex: none; padding: 0.5px 6px; border-radius: 999px; font-family: var(--zbf-num-font);
	font-size: 10px; font-weight: 550; font-variant-numeric: tabular-nums;
	background: var(--zbf-wc-pill-bg); color: var(--zbf-wc-pill-fg);
}
.zbf-wc-cite-freq.is-uncited { background: var(--zbf-wc-well-soft); color: var(--zbf-wc-fg-sec); }
.zbf-wc-cite-title-row {
	font-size: 12px; font-weight: 580; line-height: 1.42; letter-spacing: -0.008em; color: var(--zbf-wc-fg);
	display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word;
}
.zbf-wc-ord-badge {
	display: inline-block; text-align: center; margin-inline-end: 5px;
	padding: 0.5px 5.5px; border-radius: 4.5px; font-family: var(--zbf-num-font); font-size: 11px; font-weight: 650;
	line-height: 1.3; font-variant-numeric: tabular-nums; vertical-align: baseline;
	background: var(--zbf-wc-well-soft); color: var(--zbf-wc-fg-muted);
}
.zbf-wc-ord-badge.is-cited { background: light-dark(#fdecef, rgba(244, 63, 94, 0.22)); color: light-dark(#b4232f, #fda4af); cursor: pointer; transition: filter 120ms ease; }
.zbf-wc-ord-badge.is-cited:hover { filter: brightness(0.95); }
.zbf-wc-cite-sub { font-size: 10.5px; color: var(--zbf-wc-fg-sec); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-synergy {
	display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;
	margin-top: 5px; padding-top: 4px; border-top: 1px solid light-dark(rgba(201, 50, 63, 0.1), rgba(255, 255, 255, 0.08)); min-width: 0;
}
.zbf-wc-link {
	appearance: none; min-width: 0; max-width: 100%; background: transparent; border: 0; padding: 1px 0;
	font-family: inherit; font-size: 10.5px; font-weight: 450; line-height: 1.3; color: var(--zbf-wc-pill-fg); cursor: pointer;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;
}
.zbf-wc-link:hover:not(:disabled) { text-decoration: underline; }
.zbf-wc-link:disabled { opacity: 0.45; cursor: default; }

/* 4. Standalone Action Bar */
.zbf-wc-actions { display: grid; grid-template-columns: minmax(0, 1fr) 31px; gap: 6px; align-items: stretch; min-width: 0; }
.zbf-word-cite-action {
	appearance: none; box-sizing: border-box; height: 31px; min-width: 0; padding: 0 10px; gap: 6px;
	border: 0; border-radius: 7px;
	background: linear-gradient(135deg, light-dark(#3a76d2, #4c8ae6) 0%, light-dark(#2d5fb8, #3772cb) 100%);
	box-shadow: 0 2px 6px light-dark(rgba(45, 95, 184, 0.24), rgba(0, 0, 0, 0.36)), inset 0 1px 0 rgba(255, 255, 255, 0.22);
	color: #ffffff; font-family: inherit; font-size: 11.5px; font-weight: 600; line-height: 1; cursor: pointer;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	display: inline-flex; align-items: center; justify-content: center;
	transition: filter 130ms ease, box-shadow 130ms ease, transform 80ms ease, opacity 120ms ease;
}
.zbf-word-cite-action::before {
	content: ""; width: 12px; height: 12px; flex: none; background-color: currentColor;
	mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 14' fill='none'%3E%3Cpath d='M3 4.2h8M3 7h5.2M9.5 6.8v4.4M7.3 9h4.4' stroke='%23000' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E") center / contain no-repeat;
}
.zbf-word-cite-action:hover:not(:disabled) {
	filter: brightness(1.06);
	box-shadow: 0 3px 9px light-dark(rgba(45, 95, 184, 0.32), rgba(0, 0, 0, 0.44)), inset 0 1px 0 rgba(255, 255, 255, 0.26);
}
.zbf-word-cite-action:active:not(:disabled) { transform: translateY(0.5px); filter: brightness(0.97); }
.zbf-word-cite-action:disabled { background: var(--zbf-wc-well); color: var(--zbf-wc-fg-muted); box-shadow: none; cursor: default; opacity: 0.75; }
.zbf-word-refresh-action {
	appearance: none; box-sizing: border-box; height: 31px; width: 31px; padding: 0; border-radius: 7px;
	border: 1px solid var(--zbf-wc-line-strong); background: var(--zbf-wc-card);
	box-shadow: 0 1px 2px light-dark(rgba(20, 40, 70, 0.05), rgba(0, 0, 0, 0.2));
	color: var(--zbf-wc-fg-sec); cursor: pointer;
	display: inline-flex; align-items: center; justify-content: center;
	transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}
.zbf-word-refresh-action .zbf-wc-svg { width: 13px; height: 13px; }
.zbf-word-refresh-action .zbf-wc-svg.is-spinning { animation: zbf-wc-spin 420ms cubic-bezier(0.22, 1, 0.36, 1); }
.zbf-word-refresh-action:hover:not(:disabled) { background: var(--zbf-wc-pill-bg); border-color: light-dark(#9ec0ec, #5d6473); color: var(--zbf-wc-pill-fg); }
.zbf-word-refresh-action:disabled { opacity: 0.45; cursor: default; box-shadow: none; }
@keyframes zbf-wc-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* 5. Governance Cards Below Actions: Orphan Recovery Accordion */
.zbf-wc-acc {
	box-sizing: border-box; background: var(--zbf-wc-card);
	border: 1px solid var(--zbf-wc-warn-bd); border-radius: 8px;
	overflow: hidden; min-width: 0; max-width: 100%;
	box-shadow: 0 1px 2px light-dark(rgba(18, 32, 54, 0.03), rgba(0, 0, 0, 0.16));
}
.zbf-wc-acc-head {
	appearance: none; width: 100%; box-sizing: border-box; display: flex; align-items: center; gap: 6px;
	padding: 6.5px 9px; border: 0; background: var(--zbf-wc-warn-bg); color: var(--zbf-wc-warn-fg);
	text-align: left; cursor: pointer; font-family: inherit; font-size: 11px; font-weight: 600; line-height: 1.35; min-width: 0;
}
.zbf-wc-badge {
	display: inline-flex; align-items: center; justify-content: center;
	min-width: 16px; height: 16px; padding: 0 4.5px; border-radius: 999px;
	background: var(--zbf-wc-well-soft); color: var(--zbf-wc-fg-sec);
	font-family: var(--zbf-num-font); font-size: 9.5px; font-weight: 650; flex: none; font-variant-numeric: tabular-nums;
}
.zbf-wc-badge.is-warn { background: rgba(217, 119, 6, 0.2); color: var(--zbf-wc-warn-fg); }
.zbf-wc-badge.is-ok { background: var(--zbf-wc-ok-bg); color: var(--zbf-wc-ok-fg); }
.zbf-wc-acc-title { min-width: 0; flex: 1 1 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-acc-arrow { flex: none; color: var(--zbf-wc-warn-fg); display: inline-flex; align-items: center; justify-content: center; transition: transform 140ms ease; }
.zbf-wc-acc.is-closed .zbf-wc-acc-arrow { transform: rotate(-90deg); }
.zbf-wc-acc-body {
	box-sizing: border-box; padding: 6px 8px 8px; border-top: 1px solid var(--zbf-wc-warn-bd);
	display: grid; gap: 6px; min-width: 0; max-width: 100%; overflow: hidden;
}
.zbf-wc-sec-btn {
	appearance: none; box-sizing: border-box; height: 24px; padding: 0 9px; border-radius: 5px;
	border: 1px solid var(--zbf-wc-warn-bd); background: var(--zbf-wc-warn-bg);
	color: var(--zbf-wc-warn-fg); font-family: inherit; font-size: 10.5px; font-weight: 600; line-height: 1; cursor: pointer; white-space: nowrap;
}
.zbf-wc-sec-btn:hover:not(:disabled) { filter: brightness(0.97); }
.zbf-wc-sec-btn:disabled { opacity: 0.45; cursor: default; }
.zbf-wc-doc-switch:focus-visible, .zbf-word-cite-action:focus-visible, .zbf-word-refresh-action:focus-visible, .zbf-wc-link:focus-visible, .zbf-wc-col-inline:focus-visible, .zbf-wc-acc-head:focus-visible, .zbf-wc-rem-entry:focus-visible, .zbf-wc-sec-btn:focus-visible, .zbf-wc-rcp-btn:focus-visible, .zbf-wc-rem-row:focus-visible { outline: 2px solid var(--accent-blue, #3a76d2); outline-offset: 1px; }
@media (prefers-reduced-motion: reduce) { .zbf-word-refresh-action .zbf-wc-svg.is-spinning { animation: none; } }
`;
