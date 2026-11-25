export const WORD_CITE_SCHEME_C_CSS = `
item-details:not([pinnedPane]:not([pinnedPane=""])) .zotero-view-item:has(> :nth-last-child(1 of [data-pane]:not([hidden])) .zbf-word-cite-wrap)::before { height: 0; }
.zbf-word-cite-wrap { box-sizing: border-box; display: grid; grid-template-columns: minmax(0, 1fr); gap: 7px; inline-size: 100%; max-inline-size: 100%; min-inline-size: 0; contain: inline-size; overflow: hidden; padding: 4px 2px 8px; font-size: 12px; color: light-dark(#262626, #e6e6e6); }
.zbf-word-cite-wrap [hidden] { display: none !important; }
.zbf-wc-card { box-sizing: border-box; background: light-dark(#ffffff, #242629); border: 1px solid light-dark(#dedede, #3a3d42); border-radius: 6px; padding: 8px 10px; min-width: 0; max-width: 100%; box-shadow: 0 1px 1px light-dark(rgba(0,0,0,0.02), rgba(0,0,0,0.16)); }
.zbf-wc-doc-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.zbf-wc-w { width: 22px; height: 22px; border-radius: 4px; background: light-dark(#f3f4f6, rgba(255,255,255,0.07)); border: 1px solid light-dark(#dcdcdc, #43474e); color: light-dark(#666666, #a3aab4); display: grid; place-items: center; font-size: 10.5px; font-weight: 600; flex: none; }
.zbf-wc-w.is-live { color: light-dark(#1d63b8, #6cb2ff); background: light-dark(#eef5fd, rgba(56,139,253,0.14)); border-color: light-dark(#c5dcf6, rgba(96,165,250,0.34)); }
.zbf-wc-doc-meta { min-width: 0; flex: 1 1 0; display: grid; gap: 1px; }
.zbf-wc-docname { font-size: 12px; font-weight: 600; line-height: 1.35; color: light-dark(#262626, #ececec); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-doc-sub { display: flex; align-items: center; gap: 5px; font-size: 10.5px; color: light-dark(#6e6e6e, #9ea4ad); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: light-dark(#a3a3a3, #666c75); }
.zbf-wc-dot.is-live { background: #1fa363; }
.zbf-wc-doc-switch { appearance: none; width: 24px; height: 24px; border: 1px solid light-dark(#e0e0e0, #42464d); background: light-dark(#fafafa, #2c2f34); color: light-dark(#595959, #b0b6bf); border-radius: 4px; padding: 0; font-size: 12px; line-height: 1; cursor: pointer; flex: none; display: inline-flex; align-items: center; justify-content: center; }
.zbf-wc-doc-switch:hover:not(:disabled) { background: light-dark(#f0f2f5, #363a40); border-color: light-dark(#c8cdd3, #545962); color: light-dark(#262626, #ffffff); }
.zbf-wc-doc-switch:disabled { opacity: 0.42; cursor: default; background: transparent; border-color: transparent; }
.zbf-wc-stat-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 8px; padding-top: 7px; border-top: 1px solid light-dark(#ebebeb, #33363c); text-align: center; }
.zbf-wc-stat-strip.is-solo { margin-top: 0; padding-top: 0; border-top: 0; }
.zbf-wc-stat-cell { border-inline-end: 1px solid light-dark(#ebebeb, #33363c); padding-inline: 4px; min-width: 0; }
.zbf-wc-stat-cell:last-child { border-inline-end: 0; }
.zbf-wc-stat-val { display: block; font-size: 12.5px; font-weight: 600; line-height: 1.25; font-variant-numeric: tabular-nums; color: light-dark(#262626, #ececec); }
.zbf-wc-stat-lbl { display: block; font-size: 10.5px; color: light-dark(#737373, #9ea4ad); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-stat-cell.is-warn .zbf-wc-stat-val, .zbf-wc-stat-cell.is-warn .zbf-wc-stat-lbl { color: light-dark(#a15c11, #f5b942); }
.zbf-wc-cite-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 10.5px; margin-bottom: 3px; min-width: 0; }
.zbf-wc-cite-kicker { color: light-dark(#737373, #9ea4ad); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-ord-badge { flex: none; font-size: 10.5px; font-weight: 600; font-variant-numeric: tabular-nums; color: light-dark(#737373, #9ea4ad); }
.zbf-wc-ord-badge.is-cited { color: light-dark(#1d63b8, #6cb2ff); background: light-dark(#eef5fd, rgba(56,139,253,0.16)); border: 1px solid light-dark(#cfe2f9, rgba(96,165,250,0.3)); padding: 0 5px; border-radius: 4px; }
.zbf-wc-cite-title { font-size: 12px; font-weight: 500; line-height: 1.42; color: light-dark(#222222, #ececec); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
.zbf-wc-cite-sub { font-size: 10.5px; color: light-dark(#6e6e6e, #9ea4ad); margin-top: 2px; margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-actions { display: grid; grid-template-columns: minmax(0, 1fr) 28px; gap: 6px; align-items: stretch; min-width: 0; margin-top: 7px; }
.zbf-wc-cite-sub:not([hidden]) + .zbf-wc-actions { margin-top: 0; }
.zbf-word-cite-action { box-sizing: border-box; height: 27px; min-width: 0; padding: 0 10px; border-radius: 5px; border: 1px solid light-dark(#9ec3ef, rgba(96,165,250,0.42)); background: light-dark(#edf5fe, rgba(56,139,253,0.16)); color: light-dark(#1759aa, #7cc0ff); font-size: 12px; font-weight: 600; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-flex; align-items: center; justify-content: center; transition: background-color 120ms ease, border-color 120ms ease; }
.zbf-word-cite-action:hover:not(:disabled) { background: light-dark(#dfeeff, rgba(56,139,253,0.25)); border-color: light-dark(#7ab0ec, rgba(96,165,250,0.58)); }
.zbf-word-cite-action:active:not(:disabled) { background: light-dark(#d2e5fc, rgba(56,139,253,0.32)); }
.zbf-word-cite-action:disabled { opacity: 0.48; cursor: default; }
.zbf-word-refresh-action { box-sizing: border-box; height: 27px; width: 28px; padding: 0; border-radius: 5px; border: 1px solid light-dark(#d0d5db, #464b53); background: light-dark(#fafafa, #2c2f34); color: light-dark(#4d555e, #d0d5dd); font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background-color 120ms ease, border-color 120ms ease; }
.zbf-word-refresh-action:hover:not(:disabled) { background: light-dark(#f0f2f5, #363a40); border-color: light-dark(#b8bfc7, #575d66); color: light-dark(#222222, #ffffff); }
.zbf-word-refresh-action:disabled { opacity: 0.45; cursor: default; }
.zbf-wc-synergy { display: flex; align-items: center; justify-content: flex-start; flex-wrap: wrap; gap: 8px; margin-top: 7px; padding-top: 6px; border-top: 1px solid light-dark(#ebebeb, #33363c); min-width: 0; }
.zbf-wc-link { min-width: 0; max-width: 100%; background: none; border: 0; padding: 1px 0; font-size: 11px; color: light-dark(#1d63b8, #6cb2ff); cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.zbf-wc-link:hover:not(:disabled) { text-decoration: underline; }
.zbf-wc-link:disabled { opacity: 0.45; cursor: default; }
.zbf-wc-col-link { flex: none; margin-inline-start: 0; }
.zbf-word-group-action:not([hidden]) ~ .zbf-wc-col-link { margin-inline-start: auto; }
.zbf-wc-acc { box-sizing: border-box; background: light-dark(#ffffff, #242629); border: 1px solid light-dark(#dedede, #3a3d42); border-radius: 6px; overflow: hidden; min-width: 0; max-width: 100%; }
.zbf-wc-acc-head { width: 100%; box-sizing: border-box; display: flex; align-items: center; gap: 6px; padding: 7px 10px; border: 0; background: light-dark(#fafafa, rgba(255,255,255,0.03)); color: light-dark(#262626, #e6e6e6); text-align: left; cursor: pointer; font-size: 11.5px; font-weight: 600; min-width: 0; }
.zbf-wc-acc-head:hover { background: light-dark(#f2f3f5, rgba(255,255,255,0.07)); }
.zbf-wc-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 17px; height: 17px; padding: 0 5px; border-radius: 999px; background: light-dark(#eaecef, rgba(255,255,255,0.13)); color: light-dark(#555555, #cfd5dd); font-size: 10px; font-weight: 600; flex: none; font-variant-numeric: tabular-nums; }
.zbf-wc-badge.is-warn { background: light-dark(#faecd4, rgba(245,158,11,0.22)); border: 1px solid light-dark(#ecd1a1, rgba(245,158,11,0.35)); color: light-dark(#94550f, #fbbf24); }
.zbf-wc-badge.is-ok { background: light-dark(#e8f6ee, rgba(34,197,94,0.18)); border: 1px solid light-dark(#bde5cd, rgba(34,197,94,0.32)); color: light-dark(#18794e, #4ade80); }
.zbf-wc-acc-title { min-width: 0; flex: 1 1 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-acc-sub { flex: none; font-size: 10.5px; font-weight: 400; color: light-dark(#737373, #9ea4ad); }
.zbf-wc-acc-arrow { flex: none; font-size: 10px; color: light-dark(#737373, #9ea4ad); transition: transform 120ms ease; }
.zbf-wc-acc.is-closed .zbf-wc-acc-arrow { transform: rotate(-90deg); }
.zbf-wc-acc-body { box-sizing: border-box; padding: 6px 10px 9px; border-top: 1px solid light-dark(#ebebeb, #33363c); display: grid; gap: 6px; min-width: 0; max-width: 100%; overflow: hidden; }
.zbf-wc-sec-btn { box-sizing: border-box; height: 25px; padding: 0 9px; border-radius: 4px; border: 1px solid light-dark(#cdd2d7, #484c54); background: light-dark(#fafafa, #2c2f34); color: light-dark(#262626, #e6e6e6); font-size: 11px; font-weight: 500; cursor: pointer; white-space: nowrap; }
.zbf-wc-sec-btn:hover:not(:disabled) { background: light-dark(#f0f2f5, #363a40); border-color: light-dark(#b8bfc7, #575d66); }
.zbf-wc-sec-btn:disabled { opacity: 0.45; cursor: default; }
.zbf-wc-doc-switch:focus-visible, .zbf-word-cite-action:focus-visible, .zbf-word-refresh-action:focus-visible, .zbf-wc-link:focus-visible, .zbf-wc-acc-head:focus-visible, .zbf-wc-sec-btn:focus-visible, .zbf-wc-rcp-btn:focus-visible, .zbf-wc-rem-row:focus-visible { outline: 2px solid var(--accent-blue, #2873c8); outline-offset: 1px; }
`;
