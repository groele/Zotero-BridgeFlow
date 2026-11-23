export const WORKSPACE_CSS = `
:root {
  --zbf-surface: var(--material-sidepane, light-dark(#f7f8fa, #242528));
  --zbf-card: var(--material-background, light-dark(#ffffff, #2b2c30));
  --zbf-border: var(--material-border, light-dark(rgba(0,0,0,0.09), rgba(255,255,255,0.1)));
  --zbf-text: var(--fill-primary, light-dark(#1f2328, #e6edf3));
  --zbf-muted: var(--fill-secondary, light-dark(#6e7781, #9198a1));
  --zbf-hover: light-dark(rgba(0,0,0,0.05), rgba(255,255,255,0.07));
  --zbf-accent: var(--accent-blue, light-dark(#245ac7, #6ea8fe));
  --zbf-accent-soft: color-mix(in srgb, var(--zbf-accent) 13%, transparent);
}

#tab-bar-container[data-zbf-inline]:not([hidden]) { flex: 1 1 0%; min-width: 0; overflow: hidden; }
#tab-bar-container[data-zbf-inline] > div { min-width: 0; flex: 1 1 0%; }
#tab-bar-container[data-zbf-inline] .tab-bar-inner-container { --zbf-tab-height: 28px; min-width: 0; min-height: var(--tab-min-height, 36px); align-items: center; }
#tab-bar-container[data-zbf-inline] ~ #zotero-tabs-toolbar { flex: 0 0 auto; -moz-window-dragging: no-drag; }
#tab-bar-container[data-zbf-inline] .pinned-tabs { display: block !important; flex: 0 1 auto; min-width: 0; max-width: 42%; padding: 0; -moz-window-dragging: no-drag; }
#tab-bar-container[data-zbf-inline] .pinned-tabs .tabs { padding: 4px 1px; position: static; overflow: visible; }
#tab-bar-container[data-zbf-inline] .pinned-tabs .tab { flex: 0 1 200px; min-width: 0; max-width: 200px; height: var(--zbf-tab-height); -moz-window-dragging: no-drag; }
#tab-bar-container[data-zbf-inline] .tabs-wrapper,
#tab-bar-container[data-zbf-inline] .scroll-start-arrow,
#tab-bar-container[data-zbf-inline] .scroll-end-arrow { display: none !important; }

#zbf-inline, #zbf-inline *, .zbf-pinned-strip, .zbf-pinned-strip *, #zbf-toolbar-actions, #zbf-toolbar-actions *, #zbf-hub-backdrop, #zbf-hub-backdrop *, #zbf-spotlight-backdrop, #zbf-spotlight-backdrop * {
  -moz-window-dragging: no-drag;
}

#zbf-inline {
  display: flex; align-items: center; flex: 1 1 0%; min-width: 0; min-height: var(--tab-min-height, 36px);
  overflow-x: auto; overflow-y: hidden; scrollbar-width: none; gap: 6px; padding: 0 6px; box-sizing: border-box;
  font: 12px system-ui, "Microsoft YaHei UI", sans-serif; color: var(--zbf-text);
}
#zbf-inline[hidden], .zbf-pinned-strip[hidden], .zbf-hheading[hidden], .zbf-hsection-body[hidden] { display: none !important; }

.zbf-pinned-strip {
  display: flex; align-items: center; gap: 4px; max-width: 35%; min-width: 0; min-height: var(--tab-min-height, 36px);
  padding-inline: 4px; border-inline-end: 1px solid var(--zbf-border);
  overflow-x: auto; overflow-y: hidden; scrollbar-width: none; flex: 0 1 auto;
}
.zbf-pinned-chip {
  display: inline-flex; align-items: center; gap: 4px; height: 28px; max-width: 116px; padding: 0 9px;
  border: 0; border-radius: 6px; background: color-mix(in srgb, #f59e0b 12%, transparent);
  color: var(--zbf-text); font: 12px system-ui, "Microsoft YaHei UI", sans-serif; cursor: pointer; flex: none;
}
.zbf-pinned-chip.icon-only { max-width: 28px; padding: 0 7px; }
.zbf-pinned-chip.selected { background: var(--zbf-card); box-shadow: 0 0 0 1px var(--zbf-border); font-weight: 600; }
.zbf-pinned-chip > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-pinned-more {
  height: 28px; padding: 0 7px; border-radius: 6px; border: 1px solid var(--zbf-border);
  background: var(--zbf-card); color: var(--zbf-muted); font: 600 11px system-ui, sans-serif; cursor: pointer; flex: none;
}

.zbf-hsection { position: relative; display: inline-flex; align-items: center; flex: none; height: 28px; gap: 4px; }
.zbf-hsection-body { display: contents; }
.zbf-hsection[data-grouped="true"]::after {
  content: ""; position: absolute; left: 2px; right: 2px; bottom: -3px; height: 2px; border-radius: 1px;
  background: color-mix(in srgb, var(--zbf-gcolor, var(--zbf-accent)) 72%, transparent); pointer-events: none;
}
.zbf-hheading {
  display: inline-flex; align-items: center; gap: 5px; max-width: 180px; height: 28px; padding: 0 9px;
  border: 0; border-radius: 6px; background: transparent; color: var(--zbf-text);
  font: 600 12px/1 system-ui, "Microsoft YaHei UI", sans-serif; cursor: pointer; white-space: nowrap; flex: none;
  overflow: hidden; text-overflow: ellipsis;
}
.zbf-hheading:hover { background: var(--zbf-hover); }
.zbf-htab {
  display: inline-flex; align-items: center; gap: 4px; height: 28px; max-width: 185px; padding-inline: 10px 6px;
  border: 0; border-radius: 6px; background: transparent; color: var(--zbf-muted);
  font: 12px system-ui, "Microsoft YaHei UI", sans-serif; cursor: pointer; flex: none; transition: background .12s, color .12s;
}
.zbf-htab:hover { background: var(--zbf-hover); color: var(--zbf-text); }
.zbf-htab.selected { background: var(--zbf-card); color: var(--zbf-text); box-shadow: 0 0 0 1px var(--zbf-border), 0 1px 2px rgba(0,0,0,0.06); font-weight: 600; }
.zbf-htab.sleeping { opacity: 0.65; }
.zbf-htab.virtual { opacity: 0.62; box-shadow: inset 0 0 0 1px var(--zbf-border); }
.zbf-htab[data-zbf-drop="stack"] { outline: 2px solid var(--zbf-accent); outline-offset: -2px; }
.zbf-htab.zbf-chip-collapsed { min-width: 30px; max-width: 36px; padding-inline: 8px; justify-content: center; background: color-mix(in srgb, currentColor 5%, transparent); }
.zbf-htab.zbf-chip-collapsed .zbf-htab-close { display: none; }
.zbf-htab-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-tb-icon { flex: none; display: inline-block; vertical-align: middle; pointer-events: none; }
.zbf-htab-close {
  appearance: none; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; min-width: 0; margin: 0; padding: 0; box-sizing: border-box;
  border: 0; border-radius: 4px; background: transparent; color: var(--zbf-muted); cursor: pointer; opacity: 0; flex: none;
}
.zbf-htab:hover .zbf-htab-close, .zbf-htab.selected .zbf-htab-close { opacity: 1; }
.zbf-htab-close:hover { background: var(--zbf-hover); color: var(--zbf-text); }
.zbf-add-group {
  appearance: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; min-width: 0; margin: 0; padding: 0; box-sizing: border-box;
  border: 0; border-radius: 6px; background: transparent; color: var(--zbf-muted); cursor: pointer; flex: none;
}
.zbf-add-group:hover { background: var(--zbf-hover); color: var(--zbf-text); }
.zbf-inline-edit {
  height: 28px; min-width: 84px; max-width: 180px; padding: 0 8px; box-sizing: border-box;
  border: 1.5px solid var(--zbf-accent); border-radius: 6px; background: var(--zbf-card); color: var(--zbf-text);
  font: 12px system-ui, "Microsoft YaHei UI", sans-serif; outline: none;
}

#zbf-toolbar-actions {
  display: inline-flex; align-items: center; gap: 2px; flex: 0 0 auto;
  margin-inline: 4px 6px; padding-inline-start: 5px; border-inline-start: 1px solid var(--zbf-border);
}
#zbf-toolbar-actions[hidden], .zbf-tb-count[hidden], .zbf-tb-icon-only .zbf-tb-label { display: none !important; }
#zbf-toolbar-actions .zbf-tb-btn {
  appearance: none; position: relative; display: inline-flex; align-items: center; justify-content: center;
  flex: none; gap: 4px; height: 28px; min-width: 28px; margin: 0; box-sizing: border-box; padding: 0 6px;
  border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--zbf-text);
  font: 12px/1 system-ui, "Microsoft YaHei UI", sans-serif; cursor: pointer; white-space: nowrap;
}
#zbf-toolbar-actions .zbf-tb-btn:hover { background: var(--zbf-hover); }
#zbf-toolbar-actions .zbf-tb-btn:active { background: color-mix(in srgb, var(--zbf-text) 11%, transparent); }
#zbf-toolbar-actions .zbf-tb-btn:focus-visible { outline: 1px solid currentColor; outline-offset: -2px; }
.zbf-tb-btn > svg { flex: none; color: var(--zbf-muted); }
.zbf-tb-btn[aria-pressed="true"] > svg, .zbf-tb-btn:hover > svg { color: var(--zbf-text); }
.zbf-tb-btn[aria-pressed="true"]::after {
  content: ""; position: absolute; inset-inline: 8px; bottom: 2px;
  height: 1px; background: currentColor; opacity: .65; pointer-events: none;
}
.zbf-tb-count {
  min-width: 13px; padding: 1px 3px; box-sizing: border-box; border: 1px solid var(--zbf-border);
  border-radius: 4px; color: var(--zbf-muted); text-align: center;
  font-size: 10px; font-variant-numeric: tabular-nums; line-height: 1;
}
.zbf-tb-attention .zbf-tb-count { color: var(--zbf-text); font-weight: 600; }
@media (max-width: 820px) {
  #zbf-toolbar-actions .zbf-tb-btn:not([data-action="workspace"]) .zbf-tb-label { display: none; }
  #zbf-toolbar-actions .zbf-tb-btn { padding-inline: 4px; }
}
@media (max-width: 620px) {
  #zbf-toolbar-actions .zbf-tb-label { display: none; }
}

#zbf-sidebar {
  position: relative; z-index: 3; display: flex; flex-direction: column; width: 276px; min-width: 200px; max-width: 440px; min-height: 0;
  background: var(--zbf-surface); color: var(--zbf-text); border-right: 1px solid light-dark(rgba(0,0,0,0.14), rgba(255,255,255,0.14));
  box-shadow: inset -1px 0 0 var(--zbf-border); font: 13px system-ui, "Microsoft YaHei UI", sans-serif; flex-shrink: 0; overflow: hidden;
}
#zbf-sidebar[hidden], #zbf-sidebar[data-collapsed="true"] { display: none !important; }
.zbf-sb-splitter { position: absolute; top: 0; right: 0; bottom: 0; width: 5px; cursor: col-resize; z-index: 10; transition: background .14s ease; }
.zbf-sb-splitter::after { content: ""; position: absolute; top: 0; right: 0; bottom: 0; width: 1px; background: light-dark(rgba(0,0,0,0.14), rgba(255,255,255,0.14)); pointer-events: none; }
.zbf-sb-splitter:hover, .zbf-sb-splitter.active { background: color-mix(in srgb, var(--zbf-accent) 42%, transparent); }
.zbf-sb-splitter:hover::after, .zbf-sb-splitter.active::after { width: 2px; background: var(--zbf-accent); }
.zbf-sb-header { display: flex; align-items: center; justify-content: space-between; gap: 6px; height: 34px; padding: 0 8px 0 10px; border-bottom: 1px solid var(--zbf-border); }
.zbf-sb-title { display: inline-flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 600; font-size: 12px; color: var(--zbf-text); }
.zbf-sb-title > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-sb-actions { display: inline-flex; align-items: center; gap: 2px; flex: none; }
.zbf-sb-icon-btn {
  appearance: none; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; min-width: 0; margin: 0;
  padding: 0; box-sizing: border-box; border: 0; border-radius: 5px; background: transparent; color: var(--zbf-muted); cursor: pointer; flex: none;
}
.zbf-sb-icon-btn:hover { background: var(--zbf-hover); color: var(--zbf-text); }
.zbf-sb-actions > button[data-batch-toggle] {
  appearance: none; min-height: 22px; height: 22px; padding: 0 6px; margin: 0 2px 0 0; border: 1px solid var(--zbf-border); border-radius: 4px;
  color: var(--zbf-text); background: var(--zbf-card); font: 11px/1 system-ui, sans-serif; cursor: pointer; white-space: nowrap;
}
.zbf-sb-actions > button[aria-pressed="true"] { background: var(--zbf-accent-soft); color: var(--zbf-accent); }
.zbf-sb-search-wrap { padding: 8px 8px 4px; }
.zbf-sb-search {
  width: 100%; box-sizing: border-box; height: 26px; padding: 0 8px; border-radius: 5px;
  border: 1px solid var(--zbf-border); background: var(--zbf-card); color: var(--zbf-text); font: 12px system-ui, sans-serif; outline: none;
}
.zbf-sb-search:focus { border-color: var(--zbf-accent); }
.zbf-sb-views { display: flex; gap: 2px; padding: 0 8px; border-bottom: 1px solid var(--zbf-border); }
.zbf-sb-view-btn {
  flex: 1; border: 0; border-bottom: 2px solid transparent; background: transparent;
  color: var(--zbf-muted); padding: 6px 2px; font: 500 11px system-ui, sans-serif; cursor: pointer;
}
.zbf-sb-view-btn.active { color: var(--zbf-accent); border-bottom-color: var(--zbf-accent); font-weight: 600; }

.zbf-batch-controls {
  display: flex; align-items: center; flex-wrap: wrap; gap: 4px 6px; padding: 5px 8px;
  border-bottom: 1px solid var(--zbf-border); font-size: 11px;
}
.zbf-batch-controls[hidden] { display: none !important; }
.zbf-batch-controls button, .zbf-batch-controls select {
  box-sizing: border-box; min-height: 22px; min-width: 0; max-width: 100%; padding-inline: 5px;
  border: 1px solid var(--zbf-border); border-radius: 4px; color: var(--zbf-text); background: var(--zbf-card);
  font: 11px system-ui, sans-serif; cursor: pointer;
}
.zbf-batch-controls :disabled { opacity: .5; cursor: default; }
.zbf-batch-target { display: flex; align-items: center; flex: none; cursor: pointer; }
.zbf-batch-check { margin: 0; accent-color: var(--zbf-accent); }

.zbf-sb-list { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 6px 10px; display: flex; flex-direction: column; gap: 4px; }
.zbf-sb-group-head-row { display: flex; align-items: center; gap: 2px; }
.zbf-sb-group-head {
  display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 5px; flex: none; min-width: 0; min-height: 26px; box-sizing: border-box; margin: 0;
  border: 0; background: transparent; text-align: start; font: 600 11px system-ui, sans-serif; color: var(--zbf-muted); cursor: pointer;
}
.zbf-sb-group-head-row > .zbf-sb-group-head { flex: 1 1 auto; }
.zbf-sb-list > * { flex-shrink: 0; }
div.zbf-sb-group-head { cursor: default; }
button.zbf-sb-group-head:hover { background: var(--zbf-hover); color: var(--zbf-text); }
.zbf-sb-group-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.zbf-sb-col-group-btn { border: 0; background: transparent; color: var(--zbf-muted); cursor: pointer; padding: 2px 5px; border-radius: 4px; font-size: 12px; flex: none; }
.zbf-sb-col-group-btn:hover { background: var(--zbf-hover); color: var(--zbf-accent); }

.zbf-vtab-row {
  display: flex; align-items: center; gap: 7px; box-sizing: border-box; padding: 4px 8px; border-radius: 5px; cursor: pointer; border-left: 2px solid transparent;
}
.zbf-vtab-row:hover { background: var(--zbf-hover); }
.zbf-vtab-row.selected { background: var(--zbf-accent-soft); border-left-color: var(--zbf-accent); font-weight: 600; }
.zbf-vtab-row.sleeping { opacity: 0.65; }
.zbf-vtab-row.virtual { opacity: 0.62; }
.zbf-vtab-row[data-zbf-drop="join"] { outline: 2px solid var(--zbf-accent); outline-offset: -2px; }
.zbf-vtab-row[data-zbf-drop="before"] { box-shadow: inset 0 2px 0 0 var(--zbf-accent); }
.zbf-vtab-row[data-zbf-drop="after"] { box-shadow: inset 0 -2px 0 0 var(--zbf-accent); }
.zbf-vtab-main { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 1px; }
.zbf-vtab-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-vtab-sub { font-size: 11px; color: var(--zbf-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-vtab-progress { height: 2px; border-radius: 1px; background: var(--zbf-border); overflow: hidden; margin-top: 2px; }
.zbf-vtab-progress-fill { display: block; height: 100%; background: var(--zbf-accent); border-radius: 1px; }
.zbf-vtab-right { display: inline-flex; align-items: center; gap: 3px; flex: none; }
.zbf-cite-badge { font-size: 11px; font-weight: 600; padding: 1px 5px; border-radius: 4px; background: #0D9488; color: #fff; }
.zbf-row-btn {
  appearance: none; display: none; align-items: center; justify-content: center; width: 22px; height: 22px; min-width: 0; margin: 0; padding: 0; box-sizing: border-box;
  border: 0; border-radius: 4px; background: transparent; color: var(--zbf-muted); cursor: pointer; flex: none;
}
.zbf-vtab-row:hover .zbf-row-btn, .zbf-vtab-row.selected .zbf-row-btn { display: inline-flex; }
.zbf-row-btn:hover { background: var(--zbf-hover); color: var(--zbf-accent); }

.zbf-sb-status {
  padding: 6px 8px; border-top: 1px solid var(--zbf-border); font-size: 11px; color: var(--zbf-muted);
  display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap;
}
.zbf-sb-budget-warn {
  border: 1px solid color-mix(in srgb, #dc2626 40%, transparent); background: color-mix(in srgb, #dc2626 10%, transparent);
  color: light-dark(#b91c1c, #fca5a5); border-radius: 4px; padding: 2px 6px; font: 11px system-ui, sans-serif; cursor: pointer;
}
.zbf-sb-empty { padding: 24px 12px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--zbf-muted); font-size: 12px; }
.zbf-sb-empty-btn {
  border: 1px solid var(--zbf-border); background: var(--zbf-card); color: var(--zbf-text);
  border-radius: 6px; padding: 5px 12px; font: 12px system-ui, sans-serif; cursor: pointer;
}
.zbf-sb-empty-btn:hover { background: var(--zbf-hover); }

.zbf-hover-card {
  position: fixed; z-index: 2147483647; width: 316px; padding: 10px 12px; border-radius: 8px;
  border: 1px solid var(--zbf-border); background: var(--zbf-card); color: var(--zbf-text);
  box-shadow: 0 8px 24px rgba(0,0,0,0.16); pointer-events: none; font: 12px/1.5 system-ui, sans-serif;
}
.zbf-hc-title { font-weight: 600; margin-bottom: 3px; line-height: 1.4; overflow-wrap: anywhere; }
.zbf-hc-meta { font-size: 11px; color: var(--zbf-muted); overflow-wrap: anywhere; }
.zbf-hc-note { margin-top: 5px; padding: 4px 7px; border-radius: 5px; background: var(--zbf-accent-soft); color: var(--zbf-accent); font-size: 11px; }

#zbf-spotlight-backdrop {
  position: fixed; inset: 0; z-index: 2147483647; background: transparent;
}
#zbf-spotlight-panel {
  position: fixed; width: 480px; max-width: calc(100vw - 24px); padding: 10px 12px 12px; box-sizing: border-box;
  border-radius: 10px; background: var(--zbf-card); color: var(--zbf-text);
  border: 1px solid var(--zbf-border); box-shadow: 0 14px 38px rgba(0, 0, 0, 0.24), 0 2px 8px rgba(0, 0, 0, 0.08);
  font: 13px/1.4 system-ui, "Microsoft YaHei UI", sans-serif; display: flex; flex-direction: column; gap: 6px;
}
.zbf-spot-input-wrap {
  display: flex; align-items: center; gap: 8px; padding: 4px 6px 8px; border-bottom: 1px solid var(--zbf-border); color: var(--zbf-muted);
}
#zbf-spotlight-input {
  appearance: none; -moz-appearance: none; flex: 1; width: 100%; box-sizing: border-box; padding: 0; border: 0;
  background: transparent; color: var(--zbf-text); font: 13.5px/1.4 system-ui, sans-serif; outline: none;
}
#zbf-spotlight-list { max-height: 440px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding-right: 2px; }
.zbf-spot-sec-head {
  display: flex; align-items: center; justify-content: space-between; padding: 7px 8px 3px; margin-top: 2px;
  color: var(--zbf-muted); font-size: 11.5px; font-weight: 600; cursor: pointer; user-select: none;
}
.zbf-spot-sec-head:hover { color: var(--zbf-accent); }
.zbf-spot-sec-arrow { font-size: 11px; opacity: 0.75; }
.zbf-spot-row {
  display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border-radius: 7px;
  border: 1px solid transparent; background: transparent; color: var(--zbf-text); cursor: pointer;
}
.zbf-spot-row.active, .zbf-spot-row:hover { background: var(--zbf-accent-soft); border-color: color-mix(in srgb, var(--zbf-accent) 32%, transparent); }
.zbf-spot-row-top { display: flex; align-items: center; gap: 7px; min-width: 0; }
.zbf-spot-row-top > svg { flex: none; color: var(--zbf-muted); opacity: 0.85; }
.zbf-spot-main { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--zbf-text); }
.zbf-spot-row.active .zbf-spot-main { font-weight: 600; }
.zbf-spot-sub { padding-left: 21px; font-size: 11.5px; color: var(--zbf-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-spot-badge { font-size: 11px; padding: 1px 6px; border-radius: 4px; background: var(--zbf-accent-soft); color: var(--zbf-accent); font-weight: 600; flex: none; }
.zbf-spotlight-empty { padding: 14px; text-align: center; font-size: 12px; color: var(--zbf-muted); }

#zbf-hub-backdrop { position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: flex-start; justify-content: center; padding-top: 68px; background: transparent; }
.zbf-hub-box {
  width: 520px; max-width: calc(100vw - 24px); max-height: calc(100vh - 72px); overflow-y: auto; padding: 14px 16px; box-sizing: border-box;
  border-radius: 10px; background: var(--zbf-card); color: var(--zbf-text); border: 1px solid var(--zbf-border);
  box-shadow: 0 14px 38px rgba(0, 0, 0, 0.24), 0 2px 8px rgba(0, 0, 0, 0.08); font: 13px/1.5 system-ui, "Microsoft YaHei UI", sans-serif; display: flex; flex-direction: column; gap: 10px;
}
.zbf-hub-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.zbf-hub-title { font-size: 14px; font-weight: 600; }
.zbf-hub-input { width: 100%; box-sizing: border-box; height: 28px; padding: 0 9px; border: 1px solid var(--zbf-border); border-radius: 6px; background: var(--zbf-card); color: var(--zbf-text); font: 12px system-ui, sans-serif; outline: none; }
.zbf-hub-input:focus { border-color: var(--zbf-accent); }
.zbf-hub-actions { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.zbf-hub-card { display: flex; flex-direction: column; gap: 6px; padding: 9px 11px; border-radius: 8px; border: 1px solid var(--zbf-border); background: var(--zbf-surface); }
.zbf-hub-card-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; }
.zbf-hub-card-info { min-width: 0; flex: 1; }
.zbf-hub-card-name { font-weight: 600; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-hub-card-meta { font-size: 11px; color: var(--zbf-muted); }
.zbf-hub-card-actions { display: inline-flex; gap: 5px; flex: none; flex-wrap: wrap; }
.zbf-hub-items { display: flex; flex-direction: column; gap: 2px; padding-top: 5px; border-top: 1px dashed var(--zbf-border); }
.zbf-hub-item-row { appearance: none; display: flex; align-items: center; width: 100%; padding: 3px 6px; border: 0; border-radius: 4px; background: transparent; color: var(--zbf-text); font: 11.5px/1.35 system-ui, sans-serif; text-align: left; cursor: pointer; }
.zbf-hub-item-row:hover { background: var(--zbf-hover); color: var(--zbf-accent); }
.zbf-hub-item-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%; }
.zbf-hub-section { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.zbf-hub-section-title { font-size: 12px; font-weight: 600; color: var(--zbf-muted); }
.zbf-hub-empty, .zbf-hub-status { font-size: 12px; color: var(--zbf-muted); }
.zbf-hub-lists { display: flex; flex-direction: column; gap: 10px; }
.zbf-hub-close { border: 0; background: transparent; color: var(--zbf-muted); cursor: pointer; font-size: 14px; padding: 2px 6px; border-radius: 4px; }
.zbf-hub-close:hover { background: var(--zbf-hover); color: var(--zbf-text); }
.zbf-hub-btn { height: 25px; padding: 0 9px; border: 1px solid var(--zbf-border); border-radius: 5px; background: var(--zbf-card); color: var(--zbf-text); font: 11.5px system-ui, sans-serif; cursor: pointer; }
.zbf-hub-btn:hover:not(:disabled) { background: var(--zbf-hover); }
.zbf-hub-btn.primary { background: var(--zbf-accent); border-color: var(--zbf-accent); color: #fff; font-weight: 600; }

.zbf-popup-menu {
  position: fixed; z-index: 2147483647; display: flex; flex-direction: column; gap: 2px; padding: 6px;
  border-radius: 10px; border: 1px solid var(--zbf-border); background: var(--zbf-card); color: var(--zbf-text);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.22), 0 2px 6px rgba(0, 0, 0, 0.08); font: 12.5px/1.4 system-ui, "Microsoft YaHei UI", sans-serif;
}
.zbf-popup-item {
  appearance: none; display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; min-height: 29px; text-align: left; padding: 5px 10px; border: 0; border-radius: 6px;
  background: transparent; color: var(--zbf-text); font: inherit; cursor: pointer; transition: background .12s, color .12s;
}
.zbf-popup-item-main { display: inline-flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto; }
.zbf-popup-item-main > svg { flex: none; color: var(--zbf-muted); opacity: 0.9; transition: color .12s; }
.zbf-popup-item-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-popup-item-badge { flex: none; padding: 1px 6px; border-radius: 999px; background: var(--zbf-accent-soft); color: var(--zbf-accent); font: 600 11px/1.3 system-ui, sans-serif; }
.zbf-popup-color-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; box-shadow: 0 0 0 1px rgba(0,0,0,0.14); }
.zbf-popup-item:hover:not(:disabled) { background: var(--zbf-accent-soft); color: var(--zbf-accent); }
.zbf-popup-item:hover:not(:disabled) .zbf-popup-item-main > svg { color: var(--zbf-accent); opacity: 1; }
.zbf-popup-item:disabled { opacity: 0.42; cursor: default; }
.zbf-popup-item.danger { color: light-dark(#c62828, #f87171); }
.zbf-popup-item.danger .zbf-popup-item-main > svg { color: light-dark(#d32f2f, #f87171); }
.zbf-popup-item.danger:hover:not(:disabled) { background: color-mix(in srgb, #dc2626 11%, transparent); color: light-dark(#b71c1c, #fca5a5); }
.zbf-popup-submenu-wrap { display: flex; flex-direction: column; }
.zbf-popup-submenu-arrow { font-size: 11px; color: var(--zbf-muted); flex: none; }
.zbf-popup-submenu-body { display: flex; flex-direction: column; gap: 1px; margin: 2px 0 3px 16px; padding-left: 8px; border-left: 1.5px solid var(--zbf-border); }
.zbf-popup-submenu-body[hidden] { display: none !important; }
.zbf-popup-sep { height: 1px; margin: 4px 5px; background: var(--zbf-border); }
.zbf-popup-header { padding: 4px 9px 2px; font-weight: 600; font-size: 11px; color: var(--zbf-muted); }
.zbf-popup-empty { padding: 10px 8px; font-size: 11.5px; color: var(--zbf-muted); }
.zbf-color-row { display: flex; align-items: center; gap: 5px; padding: 4px 8px; }
.zbf-color-swatch { appearance: none; width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid rgba(0,0,0,0.12); cursor: pointer; padding: 0; transition: transform .12s; }
.zbf-color-swatch:hover { transform: scale(1.15); }
.zbf-color-swatch.active { border-color: var(--zbf-text); box-shadow: 0 0 0 1.5px var(--zbf-card), 0 0 0 3px var(--zbf-accent); }
.zbf-stale-row { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 5px; }
.zbf-stale-row:hover { background: var(--zbf-hover); }
.zbf-stale-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.zbf-stale-footer { display: flex; justify-content: flex-end; gap: 6px; padding: 4px 6px; }
.zbf-mini-btn { padding: 2px 7px; border-radius: 4px; border: 1px solid var(--zbf-border); background: var(--zbf-surface); color: var(--zbf-text); font: 11px system-ui, sans-serif; cursor: pointer; flex: none; }
.zbf-mini-btn.danger { color: light-dark(#c62828, #f87171); }
`;
