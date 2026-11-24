const GALLERY_STYLE_ID = 'zbf-gallery-board-style';

export const GALLERY_BOARD_CSS = `
@keyframes zbfGalFadeIn { from { opacity: 0.9; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
@keyframes zbfCoverReveal { from { opacity: 0.25; transform: scale(1.015); } to { opacity: 1; transform: scale(1); } }

.zbf-items-tb-group { display: inline-flex; align-items: center; gap: 3px; margin-inline: 3px; }
.zbf-items-tb-icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 7px; background: transparent; color: light-dark(#475569, #cbd5e1); cursor: pointer; transition: background-color 0.16s cubic-bezier(0.22,1,0.36,1), color 0.16s ease, transform 0.14s cubic-bezier(0.22,1,0.36,1); }
.zbf-items-tb-icon:hover { background: light-dark(rgba(79,70,229,0.08), rgba(129,140,248,0.14)); color: light-dark(#0f172a, #f8fafc); }
.zbf-items-tb-icon:active { transform: scale(0.93); }
.zbf-items-tb-icon[aria-pressed="true"] { background: light-dark(linear-gradient(135deg, rgba(99,91,217,0.16), rgba(22,154,153,0.12)), rgba(129,140,248,0.22)); color: light-dark(#4f46e5, #a5b4fc); box-shadow: inset 0 0 0 1px light-dark(rgba(79,70,229,0.22), rgba(129,140,248,0.32)); }

#zotero-items-pane[data-zbf-gallery] { position:relative }
#zotero-items-pane[data-zbf-gallery] > :not(#zbf-gallery-panel) { visibility:hidden !important; pointer-events:none !important; }
#zotero-items-pane[data-zbf-gallery] > #zbf-gallery-panel { position:absolute; inset:0; z-index:20; width:auto; height:auto; animation: zbfGalFadeIn 0.18s cubic-bezier(0.22,1,0.36,1); }
.zbf-gallery-panel * { box-sizing:border-box }
.zbf-gallery-panel { container-type:inline-size; flex: 1 1 auto; width: 100%; height: 100%; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: light-dark(linear-gradient(180deg, #f8fafc 0%, #f3f6fb 100%), linear-gradient(180deg, #0d1320 0%, #0b101b 100%)); color: light-dark(#111827, #e2e8f0); font: 12.5px/1.45 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei UI", sans-serif; overflow: hidden; }

/* Minimal Single-Row Editorial Top Bar */
.zbf-gal-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 38px; padding: 5px 12px; border-bottom: 1px solid light-dark(rgba(15,23,42,0.075), rgba(148,163,184,0.14)); background: light-dark(rgba(255,255,255,0.92), rgba(17,24,39,0.92)); backdrop-filter: blur(8px); flex-wrap: wrap; flex: none; }
.zbf-gal-bar-left, .zbf-gal-bar-right { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.zbf-gal-tabs { display: inline-flex; align-items: center; gap: 16px; margin-right: 4px; }
.zbf-gal-tab { position: relative; border: 0; padding: 6px 2px; background: transparent; color: light-dark(#64748b, #94a3b8); font: 500 13px/1.2 system-ui; cursor: pointer; transition: color 0.16s ease; }
.zbf-gal-tab:hover { color: light-dark(#0f172a, #f1f5f9); }
.zbf-gal-tab::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; border-radius: 2px; background: linear-gradient(90deg, #635bd9, #169a99); transform: scaleX(0); opacity: 0; transition: transform 0.2s cubic-bezier(0.22,1,0.36,1), opacity 0.16s ease; }
.zbf-gal-tab[data-active="true"] { color: light-dark(#0f172a, #ffffff); font-weight: 650; }
.zbf-gal-tab[data-active="true"]::after { transform: scaleX(1); opacity: 1; }
.zbf-gal-count { font-size: 11.5px; padding: 1px 7px; border-radius: 999px; background: light-dark(rgba(15,23,42,0.05), rgba(255,255,255,0.08)); color: light-dark(#64748b, #94a3b8); font-variant-numeric: tabular-nums; }

.zbf-gal-search-box { position: relative; display: inline-flex; align-items: center; }
.zbf-gal-search-icon { position: absolute; left: 8px; color: light-dark(#94a3b8, #64748b); pointer-events: none; display: inline-flex; transition: color 0.15s ease; }
.zbf-gal-search-box:focus-within .zbf-gal-search-icon { color: light-dark(#4f46e5, #818cf8); }
.zbf-gal-search { width: clamp(96px,17cqi,164px); height: 28px; padding: 0 10px 0 27px; border-radius: 8px; border: 1px solid light-dark(rgba(15,23,42,0.07), rgba(148,163,184,0.16)); background: light-dark(#f1f5f9, #1e293b); color: inherit; font: 12px/1.2 system-ui; transition: width 0.2s cubic-bezier(0.22,1,0.36,1), background-color 0.16s, border-color 0.16s, box-shadow 0.16s; }
.zbf-gal-search:focus { outline: none; width: clamp(128px,21cqi,208px); background: light-dark(#ffffff, #0f172a); border-color: light-dark(rgba(79,70,229,0.5), rgba(129,140,248,0.55)); box-shadow: 0 0 0 3px light-dark(rgba(79,70,229,0.12), rgba(129,140,248,0.16)); }

.zbf-gal-select { height: 28px; padding: 0 8px; border-radius: 7px; border: 1px solid transparent; background: transparent; color: light-dark(#475569, #cbd5e1); font: 500 12px/1.2 system-ui; cursor: pointer; transition: background-color 0.15s, color 0.15s, border-color 0.15s; }
.zbf-gal-select:hover { background: light-dark(#f1f5f9, #1e293b); color: light-dark(#0f172a, #ffffff); }
.zbf-gal-select:focus { outline: none; border-color: light-dark(rgba(79,70,229,0.35), rgba(129,140,248,0.45)); }

.zbf-gal-seg { display: inline-flex; padding: 3px; border-radius: 9px; background: light-dark(#edf1f7, #1e293b); gap: 2px; }
.zbf-gal-seg-btn { display: inline-flex; align-items: center; gap: 5px; border: 0; border-radius: 6.5px; padding: 4px 10px; background: transparent; color: light-dark(#64748b, #94a3b8); font: 500 12px/1.2 system-ui; cursor: pointer; transition: background-color 0.18s cubic-bezier(0.22,1,0.36,1), color 0.16s, box-shadow 0.18s, transform 0.12s; }
.zbf-gal-seg-btn:hover { color: light-dark(#0f172a, #f8fafc); }
.zbf-gal-seg-btn:active { transform: scale(0.96); }
.zbf-gal-seg-btn[data-active="true"] { background: light-dark(#ffffff, #334155); color: light-dark(#0f172a, #ffffff); font-weight: 600; box-shadow: 0 1px 4px rgba(15,23,42,0.1); }

/* Viewport, Virtualized Masonry Grid & Soft Pastel Kanban Swimlanes */
.zbf-gal-viewport { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 12px 12px 18px; overflow-anchor: none; }
.zbf-gal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--zbf-card-width, 220px)), 1fr)); gap: 11px; align-items: start; align-content: start; animation: zbfGalFadeIn 0.2s cubic-bezier(0.22,1,0.36,1); }
.zbf-gal-masonry-col { display: flex; flex-direction: column; gap: 11px; min-width: 0; }
.zbf-gallery-panel[data-density="compact"] .zbf-gal-grid, .zbf-gallery-panel[data-density="compact"] .zbf-gal-masonry-col { gap: 8px; }
.zbf-gal-virtual-spacer { flex: none; pointer-events: none; width: 100%; }

.zbf-gal-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; min-height: 240px; padding: 36px 20px; text-align: center; color: light-dark(#64748b, #94a3b8); animation: zbfGalFadeIn 0.2s ease; }
.zbf-gal-empty p { margin: 0; font-size: 13.5px; font-weight: 500; }

.zbf-gal-board { display: flex; align-items: flex-start; gap: 13px; min-height: 100%; overflow-x: auto; padding-bottom: 10px; animation: zbfGalFadeIn 0.2s cubic-bezier(0.22,1,0.36,1); }
.zbf-gal-col { flex: 0 0 clamp(248px, calc(var(--zbf-card-width, 220px) + 56px), 440px); max-height: calc(100vh - 150px); display: flex; flex-direction: column; border-radius: 14px; background: var(--zbf-col-surface, rgba(100,116,139,0.045)); border: 1px solid light-dark(rgba(15,23,42,0.055), rgba(148,163,184,0.12)); overflow: hidden; transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s cubic-bezier(0.22,1,0.36,1), background-color 0.18s ease; }
.zbf-gallery-panel[data-density="compact"] .zbf-gal-col { flex: 0 0 clamp(220px, calc(var(--zbf-card-width, 220px) + 28px), 400px); }
.zbf-gal-col[data-drop-over="true"], .zbf-gal-col[data-col-drag-over="true"] { border-color: #4f46e5; box-shadow: 0 0 0 2.5px rgba(79,70,229,0.2), 0 8px 20px rgba(79,70,229,0.08); transform: scale(1.006); }
.zbf-gal-col-head { display: flex; align-items: center; gap: 8px; padding: 11px 12px 8px; flex: none; cursor: grab; user-select: none; }
.zbf-gal-col-head:active { cursor: grabbing; }
.zbf-gal-col-pill { display: inline-flex; align-items: center; padding: 2px 9px; border-radius: 6px; font-size: 12px; font-weight: 600; line-height: 1.4; max-width: 210px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-gal-col-count { font-size: 11.5px; font-weight: 600; color: light-dark(#64748b, #94a3b8); font-variant-numeric: tabular-nums; }
.zbf-gal-col-body { flex: 1 1 auto; overflow-y: auto; padding: 4px 10px 12px; display: flex; flex-direction: column; gap: 10px; }

/* Editorial Literature Card */
.zbf-gal-card { position: relative; display: flex; flex-direction: column; min-width: 0; gap: 6px; padding: 8px; border-radius: 9px; background: light-dark(#ffffff, #162032); border: 1px solid light-dark(rgba(15,23,42,0.08), rgba(148,163,184,0.14)); box-shadow: 0 1px 2px rgba(15,23,42,0.035); cursor: pointer; transition: transform 0.2s cubic-bezier(0.22,1,0.36,1), box-shadow 0.22s cubic-bezier(0.22,1,0.36,1), border-color 0.18s ease; }
.zbf-gallery-panel[data-density="compact"] .zbf-gal-card { padding: 6px; gap: 4px; border-radius: 7px; }
.zbf-gal-card:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(15,23,42,0.08), 0 2px 6px rgba(15,23,42,0.04); border-color: light-dark(rgba(79,70,229,0.28), rgba(129,140,248,0.36)); }
.zbf-gal-card:active { transform: translateY(0) scale(0.992); }
.zbf-gal-card[data-selected="true"] { border-color: light-dark(#4f46e5, #818cf8); box-shadow: 0 0 0 2px light-dark(rgba(79,70,229,0.18), rgba(129,140,248,0.28)), 0 4px 12px rgba(79,70,229,0.08); }
.zbf-gal-card:focus-visible { outline: 2px solid light-dark(#4f46e5, #818cf8); outline-offset: 2px; }

/* Card Top Cover (PDF First Page / Abstract Excerpt / Clean Fallback) */
.zbf-gal-cover { position: relative; width: 100%; box-sizing: border-box; aspect-ratio: var(--zbf-cover-aspect, 1.95); height: var(--zbf-cover-height, auto); border-radius: 6px; overflow: hidden; background: light-dark(linear-gradient(135deg, #f4f6fa 0%, #eef2f8 100%), linear-gradient(135deg, #0f172a 0%, #152035 100%)); border: 1px solid light-dark(rgba(15,23,42,0.055), rgba(148,163,184,0.12)); flex: none; display: flex; align-items: center; justify-content: center; }
.zbf-gal-cover-img { width: 100%; height: 100%; object-fit: cover; object-position: top center; background: #ffffff; display: block; animation: zbfCoverReveal 0.24s cubic-bezier(0.22,1,0.36,1); transition: transform 0.3s cubic-bezier(0.22,1,0.36,1); }
.zbf-gal-card:hover .zbf-gal-cover-img { transform: scale(1.018); }
.zbf-gal-cover-abstract { width: 100%; height: 100%; padding: 9px 11px 14px; box-sizing: border-box; font-size: 11px; line-height: 1.56; color: light-dark(#4b5563, #94a3b8); overflow: hidden; align-self: flex-start; mask-image: linear-gradient(to bottom, #000 calc(100% - 22px), transparent 100%); -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 22px), transparent 100%); transition: padding-top 0.16s ease; }
.zbf-gal-cover:has(.zbf-gal-rate-float[data-has-rating="true"]) .zbf-gal-cover-abstract { padding-top: 28px; }
.zbf-gal-cover-fallback { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: light-dark(#94a3b8, #64748b); font-size: 11.5px; }

/* Hover-Reveal Floating Star Rater */
.zbf-gal-rate-float { position: absolute; top: 6px; right: 6px; z-index: 2; display: inline-flex; align-items: center; gap: 1px; padding: 2px 6px; border-radius: 999px; background: light-dark(rgba(255,255,255,0.92), rgba(15,23,42,0.88)); backdrop-filter: blur(6px); border: 1px solid rgba(15,23,42,0.08); box-shadow: 0 2px 8px rgba(0,0,0,0.09); opacity: 0; transform: translateY(-2px); transition: opacity 0.18s ease, transform 0.18s cubic-bezier(0.22,1,0.36,1); }
.zbf-gal-rate-float[data-has-rating="true"], .zbf-gal-card:hover .zbf-gal-rate-float { opacity: 1; transform: translateY(0); }
.zbf-gal-star { display: inline-block; font-family: "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", system-ui, sans-serif; font-size: 11px; line-height: 1; filter: grayscale(1) opacity(0.28); padding: 0.5px; cursor: pointer; transition: transform 0.14s cubic-bezier(0.34,1.56,0.64,1), filter 0.12s, opacity 0.12s; }
.zbf-gal-star[data-lit="true"] { filter: none; opacity: 1; }
.zbf-gal-rate-float[data-hover] .zbf-gal-star { filter: grayscale(1) opacity(0.22); }
.zbf-gal-rate-float[data-hover="1"] .zbf-gal-star:nth-child(-n+1),
.zbf-gal-rate-float[data-hover="2"] .zbf-gal-star:nth-child(-n+2),
.zbf-gal-rate-float[data-hover="3"] .zbf-gal-star:nth-child(-n+3),
.zbf-gal-rate-float[data-hover="4"] .zbf-gal-star:nth-child(-n+4),
.zbf-gal-rate-float[data-hover="5"] .zbf-gal-star:nth-child(-n+5) { filter: drop-shadow(0 1px 2px rgba(245,158,11,0.38)); opacity: 1; }
.zbf-gal-rate-float[data-clear-hint="true"] .zbf-gal-star[data-lit="true"] { opacity: 0.72; }
.zbf-gal-star:hover { transform: scale(1.22); }

/* Card Body Typography & Icon Metadata Rows */
.zbf-gal-title-row { display: flex; align-items: flex-start; gap: 6px; color: light-dark(#111827, #f1f5f9); }
.zbf-gal-title-icon { margin-top: 2px; color: light-dark(#94a3b8, #64748b); display: inline-flex; flex: none; transition: color 0.16s ease; }
.zbf-gal-card:hover .zbf-gal-title-icon { color: light-dark(#635bd9, #818cf8); }
.zbf-gal-title { font-weight: 600; font-size: 13px; line-height: 1.42; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.zbf-gal-title sub, .zbf-gal-title sup { font-size: 0.74em; line-height: 0; }

.zbf-gal-meta-stack { display: flex; flex-direction: column; gap: 4px; }
.zbf-gal-meta-row { display: flex; align-items: center; gap: 6px; font-size: 11.8px; line-height: 1.35; color: light-dark(#64748b, #94a3b8); min-width: 0; }
.zbf-gal-meta-txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.zbf-gal-brief { font-size: 11.4px; line-height: 1.45; padding: 5px 8px; border-radius: 6px; background: light-dark(linear-gradient(90deg, #f0fdfa, #ecfdf5), rgba(20,184,166,0.12)); color: light-dark(#0f766e, #5eead4); border-left: 2.5px solid #14b8a6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.zbf-gal-tags-row { display: flex; align-items: center; gap: 5px; flex-wrap: nowrap; overflow: hidden; margin-top: auto; padding-top: 1px; }
.zbf-gal-tag-pill { display: inline-flex; align-items: center; max-width: 116px; padding: 1.5px 7px; border-radius: 5px; font-size: 11px; font-weight: 500; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 1 auto; transition: filter 0.14s ease; }
.zbf-gal-tag-pill:hover { filter: brightness(0.96); }
.zbf-gal-tag-more { display: inline-flex; align-items: center; padding: 1.5px 6px; border-radius: 5px; font-size: 10.5px; font-weight: 600; background: light-dark(#e0f2fe, rgba(56,189,248,0.18)); color: light-dark(#0369a1, #7dd3fc); flex: none; }

/* Inline Notes & Annotations Feed Cards inside Gallery */
.zbf-gal-feed-grid { display:block; height:100%; }
.zbf-gal-more { margin: 14px auto 4px; padding: 6px 18px; border-radius: 8px; border: 1px solid light-dark(rgba(15,23,42,0.12), rgba(148,163,184,0.24)); background: light-dark(#ffffff, #1e293b); color: inherit; font: 500 12px/1.2 system-ui; cursor: pointer; display: block; transition: background-color 0.16s, border-color 0.16s, transform 0.12s, box-shadow 0.16s; }
.zbf-gal-more:hover { background: light-dark(#f8fafc, #334155); border-color: light-dark(rgba(79,70,229,0.35), rgba(129,140,248,0.4)); box-shadow: 0 2px 8px rgba(15,23,42,0.06); }
.zbf-gal-more:active { transform: scale(0.97); }

@media (prefers-reduced-motion: reduce) {
  #zotero-items-pane[data-zbf-gallery] > #zbf-gallery-panel, .zbf-gal-grid, .zbf-gal-board, .zbf-gal-cover-img, .zbf-gal-empty { animation: none !important; }
  .zbf-gal-card, .zbf-gal-cover-img, .zbf-gal-col, .zbf-gal-tab::after, .zbf-gal-rate-float, .zbf-gal-star { transition: none !important; }
}
`;

export function galEl<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K): HTMLElementTagNameMap[K] {
	return doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K];
}

export function ensureGalleryStyles(doc: Document): void {
	if (!doc) return;
	const existing = doc.getElementById(GALLERY_STYLE_ID);
	if (existing) {
		if (existing.textContent !== GALLERY_BOARD_CSS) existing.textContent = GALLERY_BOARD_CSS;
		return;
	}
	const style = galEl(doc, 'style');
	style.id = GALLERY_STYLE_ID;
	style.textContent = GALLERY_BOARD_CSS;
	(doc.head || doc.documentElement)?.appendChild(style);
}
