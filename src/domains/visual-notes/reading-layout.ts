export const READING_LAYOUT_CSS = `
@keyframes zbfCardEnter { from { opacity: 0.88; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

.zbf-notebook-backdrop, .zbf-notebook-dialog, .zbf-reading-layout, .zbf-reading-layout * { box-sizing: border-box; }
.zbf-notebook-dialog { padding: 0; gap: 0; min-width: 0; background: light-dark(#f2f4f8, #0c121d); font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei UI", sans-serif; }
.zbf-notebook-top { padding: 8px 16px; min-height: 44px; background: light-dark(linear-gradient(180deg, #ffffff 0%, #fcfdff 100%), linear-gradient(180deg, #141e32 0%, #111a2c 100%)); border-bottom: 1px solid light-dark(rgba(15,23,42,0.08), rgba(148,163,184,0.16)); }
.zbf-notebook-title { position: relative; padding-inline-start: 10px; font-size: 14.5px; font-weight: 650; letter-spacing: -0.01em; color: light-dark(#0f172a, #f8fafc); }
.zbf-notebook-title::before { content: ""; position: absolute; left: 0; top: 3px; bottom: 3px; width: 3.5px; border-radius: 3px; background: linear-gradient(180deg, #635bd9 0%, #169a99 100%); }
.zbf-notebook-toolbar { padding: 7px 16px; min-height: 40px; justify-content: flex-start; gap: 8px 12px; background: light-dark(#fafbfd, #101828); border-bottom: 1px solid light-dark(rgba(15,23,42,0.075), rgba(148,163,184,0.14)); }

.zbf-nb-search-wrap { position: relative; flex: 0 1 286px; min-width: 156px; display: inline-flex; align-items: center; }
.zbf-nb-search-icon { position: absolute; left: 9px; color: light-dark(#94a3b8, #64748b); pointer-events: none; display: inline-flex; transition: color 0.16s ease; }
.zbf-nb-search-wrap:focus-within .zbf-nb-search-icon { color: light-dark(#4f46e5, #818cf8); }
.zbf-notebook-search { width: 100%; height: 29px; padding: 0 26px 0 28px; border-radius: 8px; font-size: 12.5px; border: 1px solid light-dark(rgba(15,23,42,0.1), rgba(148,163,184,0.22)); background: light-dark(#ffffff, #0f172a); transition: border-color 0.16s, box-shadow 0.16s, background-color 0.16s; }
.zbf-notebook-search:focus { outline: none; border-color: #4f46e5; box-shadow: 0 0 0 3px light-dark(rgba(79,70,229,0.12), rgba(129,140,248,0.18)); }
.zbf-nb-search-clear { position: absolute; right: 5px; width: 18px; height: 18px; border: 0; border-radius: 50%; background: light-dark(rgba(15,23,42,0.08), rgba(255,255,255,0.12)); color: light-dark(#475569, #cbd5e1); font: 600 12px/1 system-ui; cursor: pointer; display: none; align-items: center; justify-content: center; transition: background-color 0.14s, transform 0.12s; }
.zbf-nb-search-clear:hover { background: light-dark(rgba(15,23,42,0.16), rgba(255,255,255,0.22)); }
.zbf-nb-search-clear:active { transform: scale(0.9); }

.zbf-notebook-chips { width: auto; flex: 0 1 auto; align-items: center; gap: 5px; }
.zbf-notebook-chips .zbf-matrix-chip { transition: background-color 0.16s ease, border-color 0.16s ease, color 0.16s ease, transform 0.12s ease, box-shadow 0.16s ease; }
.zbf-notebook-chips .zbf-matrix-chip:active { transform: scale(0.95); }
.zbf-notebook-chips .zbf-matrix-chip[data-active="true"] { background: linear-gradient(135deg, #4f46e5, #2563eb); border-color: transparent; box-shadow: 0 2px 6px rgba(79,70,229,0.28); }
.zbf-notebook-toggles { margin-inline-start: auto; gap: 14px; font-size: 12px; }
.zbf-notebook-foot { padding: 8px 16px; background: light-dark(#ffffff, #131c2e); border-top: 1px solid light-dark(rgba(15,23,42,0.08), rgba(148,163,184,0.16)); }
.zbf-notebook-foot .zbf-matrix-actions { flex-wrap: wrap; gap: 8px; }
.zbf-notebook-foot .zbf-matrix-btn { border-radius: 7px; padding: 6px 12px; transition: background-color 0.16s, border-color 0.16s, box-shadow 0.16s, transform 0.12s; }
.zbf-notebook-foot .zbf-matrix-btn:active { transform: scale(0.97); }
.zbf-notebook-foot .zbf-matrix-btn.primary { background: linear-gradient(135deg, #4f46e5 0%, #2563eb 100%); border-color: transparent; box-shadow: 0 2px 8px rgba(79,70,229,0.26); }
.zbf-notebook-foot .zbf-matrix-btn.primary:hover { filter: brightness(1.06); box-shadow: 0 4px 12px rgba(79,70,229,0.34); }

.zbf-notebook-scroll, .zbf-gal-feed-grid { container-type: inline-size; display: block; flex: 1 1 auto; min-height: 0; padding: 0; background: transparent; border: 0; border-radius: 0; overflow: hidden; }
.zbf-gal-feed-grid { height: 100%; }

.zbf-reading-layout { height: 100%; display: grid; grid-template-columns: clamp(220px, 21%, 292px) minmax(0, 1fr); overflow: hidden; color: light-dark(#1e293b, #e2e8f0); }
.zbf-reading-index { overflow-y: auto; padding: 10px 8px 14px; border-inline-end: 1px solid light-dark(rgba(15,23,42,0.08), rgba(148,163,184,0.15)); background: light-dark(#ffffff, #121a2a); }
.zbf-reading-index header { padding: 4px 10px 10px; color: light-dark(#64748b, #94a3b8); font-size: 11.5px; font-weight: 650; letter-spacing: 0.02em; line-height: 1.4; }
.zbf-reading-index button { appearance: none; display: block; width: 100%; height: auto; max-height: none; margin: 0 0 4px; padding: 8px 10px; text-align: start; white-space: normal; border: 1px solid transparent; border-inline-start: 3px solid transparent; border-radius: 8px; color: inherit; background: transparent; font: inherit; cursor: pointer; transition: background-color 0.16s ease, border-color 0.16s ease, transform 0.16s cubic-bezier(0.22,1,0.36,1); }
.zbf-reading-index button:hover { background: light-dark(#f1f5f9, #1e293b); transform: translateX(2px); }
.zbf-reading-index button[aria-current="true"] { background: light-dark(linear-gradient(90deg, rgba(79,70,229,0.1), rgba(37,99,235,0.05)), rgba(79,70,229,0.2)); border-color: light-dark(rgba(79,70,229,0.18), rgba(129,140,248,0.28)); border-inline-start-color: light-dark(#4f46e5, #818cf8); transform: none; }
.zbf-reading-all-btn { margin-bottom: 10px !important; padding-bottom: 9px !important; position: relative; }
.zbf-reading-all-btn::after { content: ""; position: absolute; left: 6px; right: 6px; bottom: -6px; height: 1px; background: light-dark(rgba(15,23,42,0.07), rgba(148,163,184,0.14)); }
.zbf-idx-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.zbf-reading-index button span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font: 550 12.6px/1.42 system-ui; color: light-dark(#0f172a, #f1f5f9); flex: 1 1 auto; }
.zbf-idx-badge { flex: none; font-style: normal; min-width: 20px; height: 18px; padding: 0 6px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; font: 600 11px/1 system-ui; font-variant-numeric: tabular-nums; background: light-dark(#f1f5f9, #1e293b); color: light-dark(#475569, #cbd5e1); transition: background-color 0.16s, color 0.16s; }
.zbf-reading-index button[aria-current="true"] .zbf-idx-badge { background: linear-gradient(135deg, #4f46e5, #2563eb); color: #ffffff; }
.zbf-reading-index button small { display: block; margin-top: 3px; font: 11.5px/1.35 system-ui; color: light-dark(#64748b, #94a3b8); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.zbf-reading-page { overflow-y: auto; min-width: 0; padding: 12px 14px 20px; background: light-dark(linear-gradient(180deg, #f3f5fa 0%, #eef2f8 100%), linear-gradient(180deg, #0c121d 0%, #090e17 100%)); }
.zbf-reading-grid { display: flex; align-items: flex-start; gap: 11px; width: 100%; }
.zbf-masonry-col { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 11px; }
.zbf-reading-single { width: 100%; max-width: 1240px; margin-inline: auto; }

.zbf-reading-page .zbf-notebook-card { width: 100%; max-width: none; padding: 12px 14px 13px; border-radius: 12px; background: light-dark(#ffffff, #151f31); border: 1px solid light-dark(rgba(15,23,42,0.08), rgba(148,163,184,0.16)); box-shadow: 0 1px 3px rgba(15,23,42,0.04); display: flex; flex-direction: column; gap: 9px; animation: zbfCardEnter 0.2s cubic-bezier(0.22,1,0.36,1); transition: box-shadow 0.2s cubic-bezier(0.22,1,0.36,1), border-color 0.18s ease, transform 0.2s cubic-bezier(0.22,1,0.36,1); }
.zbf-reading-page .zbf-notebook-card:hover { box-shadow: 0 8px 22px rgba(15,23,42,0.07), 0 2px 6px rgba(15,23,42,0.03); border-color: light-dark(rgba(79,70,229,0.22), rgba(129,140,248,0.3)); }
.zbf-reading-page .zbf-notebook-card-head { display: flex; flex-direction: row; align-items: flex-start; justify-content: space-between; gap: 10px; padding-bottom: 8px; border-bottom: 1px solid light-dark(rgba(15,23,42,0.07), rgba(148,163,184,0.14)); }
.zbf-reading-page .zbf-notebook-item-head-main { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 4px; }
.zbf-reading-page .zbf-notebook-item-btn { display: inline-flex; align-items: flex-start; gap: 7px; height: auto; max-height: none; white-space: normal; font: 650 14.5px/1.4 system-ui; color: light-dark(#0f172a, #f8fafc); overflow-wrap: anywhere; text-align: left; transition: color 0.14s ease; }
.zbf-reading-page[data-view-mode="single"] .zbf-notebook-item-btn { font-size: 17px; }
.zbf-reading-page .zbf-notebook-item-btn svg { flex: none; margin-top: 3px; color: light-dark(#635bd9, #818cf8); }
.zbf-reading-page .zbf-notebook-meta { font-size: 11.8px; color: light-dark(#64748b, #94a3b8); }
.zbf-reading-open-pill { flex: none; padding: 4px 10px; border-radius: 7px; border: 1px solid light-dark(rgba(15,23,42,0.1), rgba(148,163,184,0.22)); background: light-dark(#f8fafc, #1e293b); color: light-dark(#334155, #cbd5e1); font: 500 11.5px/1.2 system-ui; cursor: pointer; transition: background-color 0.16s, color 0.16s, border-color 0.16s, transform 0.12s; }
.zbf-reading-open-pill:hover { background: light-dark(#eef2ff, rgba(99,91,217,0.22)); color: light-dark(#4338ca, #a5b4fc); border-color: light-dark(rgba(79,70,229,0.32), rgba(129,140,248,0.42)); }
.zbf-reading-open-pill:active { transform: scale(0.95); }

.zbf-notebook-ann-grid { display: flex; flex-direction: column; gap: 9px; }
.zbf-reading-page[data-view-mode="single"] .zbf-notebook-ann-grid[data-multi="true"] { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 12px; align-items: start; }

.zbf-reading-page .zbf-notebook-ann-row { cursor: auto; padding: 10px 12px; border-radius: 9px; border: 1px solid light-dark(rgba(15,23,42,0.07), rgba(148,163,184,0.14)); border-inline-start: 3.5px solid #3b82f6; background: light-dark(#f9fafd, rgba(255,255,255,0.03)); display: flex; flex-direction: column; gap: 7px; transition: border-color 0.16s ease, background-color 0.16s ease, box-shadow 0.16s ease; }
.zbf-reading-page .zbf-notebook-ann-row:hover { background: light-dark(#f5f7ff, rgba(99,102,241,0.08)); border-color: light-dark(rgba(79,70,229,0.2), rgba(129,140,248,0.28)); box-shadow: 0 2px 8px rgba(15,23,42,0.04); }

.zbf-reading-ref { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.zbf-reading-ref-left { display: inline-flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.zbf-ann-badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; font: 600 11.5px/1.25 system-ui; background: light-dark(rgba(15,23,42,0.055), rgba(255,255,255,0.08)); color: light-dark(#1e293b, #f1f5f9); }
.zbf-ann-badge-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.zbf-ann-page { font: 500 11.5px/1.2 ui-monospace, Consolas, monospace; color: light-dark(#64748b, #94a3b8); }
.zbf-reading-ref-actions { display: inline-flex; align-items: center; gap: 3px; opacity: 0.78; transition: opacity 0.16s ease; }
.zbf-notebook-ann-row:hover .zbf-reading-ref-actions { opacity: 1; }
.zbf-reading-ref button, .zbf-notebook-note-box button { padding: 3px 8px; border-radius: 6px; font: 500 11.5px/1.25 system-ui; color: light-dark(#4338ca, #a5b4fc); border: 1px solid transparent; background: transparent; cursor: pointer; transition: background-color 0.14s, border-color 0.14s, color 0.14s, transform 0.12s; }
.zbf-reading-ref button:hover, .zbf-notebook-note-box button:hover { background: light-dark(#eef2ff, rgba(99,102,241,0.18)); border-color: light-dark(rgba(79,70,229,0.22), rgba(129,140,248,0.32)); }
.zbf-reading-ref button:active, .zbf-notebook-note-box button:active { transform: scale(0.95); }
.zbf-reading-ref button[data-copied="true"] { background: light-dark(#dcfce7, rgba(34,197,94,0.2)); color: light-dark(#15803d, #86efac); border-color: light-dark(rgba(22,163,74,0.25), rgba(134,239,172,0.3)); }

.zbf-reading-page blockquote { margin: 0; font: 13.6px/1.66 system-ui; color: light-dark(#1e293b, #e2e8f0); overflow-wrap: anywhere; white-space: pre-line; user-select: text; }
.zbf-reading-comment { margin: 0; padding: 7px 10px; border-radius: 7px; background: light-dark(linear-gradient(135deg, #eef4ff 0%, #f3f0ff 100%), linear-gradient(135deg, rgba(59,130,246,0.13) 0%, rgba(99,102,241,0.12) 100%)); border: 1px solid light-dark(rgba(79,70,229,0.14), rgba(129,140,248,0.22)); font: 13px/1.6 system-ui; color: light-dark(#1e3a5f, #dbeafe); overflow-wrap: anywhere; white-space: pre-line; user-select: text; display: flex; flex-direction: column; gap: 3px; }
.zbf-reading-comment strong { display: inline-flex; align-self: flex-start; padding: 1px 6px; border-radius: 4px; background: light-dark(rgba(79,70,229,0.11), rgba(129,140,248,0.24)); color: light-dark(#4338ca, #c7d2fe); font: 600 10.8px/1.4 system-ui; }
.zbf-notebook-note-box { padding: 9px 11px; border-radius: 9px; background: light-dark(#f8fafc, rgba(255,255,255,0.035)); border: 1px solid light-dark(rgba(15,23,42,0.07), rgba(148,163,184,0.14)); transition: border-color 0.16s, background-color 0.16s; }
.zbf-notebook-note-box:hover { border-color: light-dark(rgba(79,70,229,0.2), rgba(129,140,248,0.26)); }
.zbf-notebook-note-box summary { cursor: pointer; font: 600 13.3px/1.5 system-ui; color: light-dark(#0f172a, #f1f5f9); overflow-wrap: anywhere; }
.zbf-notebook-note-box[open] p { margin: 8px 0 6px; font: 13.2px/1.64 system-ui; color: light-dark(#334155, #cbd5e1); animation: zbfCardEnter 0.16s ease; }
.zbf-notebook-brief-input { min-width: 0; height: 29px; }
.zbf-reading-select { display: none; }

@container (max-width: 680px) {
	.zbf-reading-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
	.zbf-reading-index { display: none; }
	.zbf-reading-select { display: block; width: 100%; max-width: 100%; margin: 0; height: 34px; padding: 0 10px; border: 0; border-bottom: 1px solid light-dark(rgba(15,23,42,0.08), rgba(148,163,184,0.16)); background: light-dark(#ffffff, #131c2e); color: inherit; font: 13px system-ui; }
	.zbf-reading-page { padding: 10px; }
}

@media (prefers-reduced-motion: reduce) {
	.zbf-reading-page .zbf-notebook-card, .zbf-notebook-note-box[open] p { animation: none !important; }
	.zbf-reading-index button, .zbf-reading-page .zbf-notebook-card, .zbf-notebook-ann-row, .zbf-reading-open-pill { transition: none !important; }
}
`;
