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

#zbf-inline, #zbf-inline *, .zbf-pinned-strip, .zbf-pinned-strip *, #zbf-toolbar-actions, #zbf-toolbar-actions *, #zbf-hub-backdrop, #zbf-hub-backdrop * {
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
.zbf-htab-close {
  display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; padding: 0;
  border: 0; border-radius: 4px; background: transparent; color: var(--zbf-muted); cursor: pointer; opacity: 0; flex: none;
}
.zbf-htab:hover .zbf-htab-close, .zbf-htab.selected .zbf-htab-close { opacity: 1; }
.zbf-htab-close:hover { background: var(--zbf-hover); color: var(--zbf-text); }
.zbf-add-group {
  display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;
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
#zbf-toolbar-actions[hidden] { display: none !important; }
.zbf-tb-btn {
  appearance: none; position: relative; display: inline-flex; align-items: center; justify-content: center;
  flex: none; gap: 4px; height: 28px; min-width: 28px; box-sizing: border-box; padding: 0 6px;
  border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--zbf-text);
  font: 12px/1 system-ui, "Microsoft YaHei UI", sans-serif; cursor: pointer; white-space: nowrap;
}
.zbf-tb-btn:hover { background: var(--zbf-hover); }
.zbf-tb-btn[aria-pressed="true"]::after {
  content: ""; position: absolute; inset-inline: 8px; bottom: 2px; height: 1px; background: currentColor; opacity: .65;
}
.zbf-tb-count {
  min-width: 13px; padding: 1px 3px; border: 1px solid var(--zbf-border); border-radius: 4px;
  color: var(--zbf-muted); font-size: 10px; font-variant-numeric: tabular-nums; line-height: 1;
}
.zbf-tb-btn.attention .zbf-tb-count { color: var(--zbf-text); font-weight: 600; }

#zbf-sidebar {
  position: relative; z-index: 3; display: flex; flex-direction: column; width: 276px; min-width: 200px; max-width: 440px; min-height: 0;
  background: var(--zbf-surface); color: var(--zbf-text); border-inline-end: 1px solid var(--zbf-border);
  font: 13px system-ui, "Microsoft YaHei UI", sans-serif; flex-shrink: 0; overflow: hidden;
}
#zbf-sidebar[hidden], #zbf-sidebar[data-collapsed="true"] { display: none !important; }
.zbf-sb-splitter { position: absolute; top: 0; right: -3px; bottom: 0; width: 6px; cursor: col-resize; z-index: 5; }
.zbf-sb-splitter:hover { background: var(--zbf-accent); opacity: 0.4; }
.zbf-sb-header { display: flex; align-items: center; justify-content: space-between; height: 34px; padding: 0 8px 0 10px; border-bottom: 1px solid var(--zbf-border); }
.zbf-sb-title { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 12px; }
.zbf-sb-actions { display: inline-flex; align-items: center; gap: 2px; flex: none; }
.zbf-sb-icon-btn {
  display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px;
  padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--zbf-muted); cursor: pointer;
}
.zbf-sb-icon-btn:hover { background: var(--zbf-hover); color: var(--zbf-text); }
.zbf-sb-actions > button[data-batch-toggle] {
  min-height: 22px; padding-inline: 5px; border: 1px solid var(--zbf-border); border-radius: 4px;
  color: var(--zbf-text); background: var(--zbf-card); font: 11px system-ui, sans-serif; cursor: pointer;
}
.zbf-sb-actions > button[aria-pressed="true"] { background: var(--zbf-accent-soft); border-color: var(--zbf-accent); }
.zbf-sb-search-wrap { padding: 8px 8px 4px; }
.zbf-sb-search {
  width: 100%; box-sizing: border-box; height: 26px; padding: 0 8px; border-radius: 5px;
  border: 1px solid var(--zbf-border); background: var(--zbf-card); color: var(--zbf-text); font: 12px system-ui, sans-serif; outline: none;
}
.zbf-sb-search:focus { border-color: var(--zbf-accent); }
.zbf-sb-views { display: flex; gap: 2px; padding: 0 8px; border-bottom: 1px solid var(--zbf-border); }
.zbf-sb-view-btn {
  flex: 1; border: 0; border-bottom: 2px solid transparent; background: transparent;
  color: var(--zbf-muted); padding: 6px 2px; font: 500 11.5px system-ui, sans-serif; cursor: pointer;
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
  display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 5px; flex: 1; min-width: 0;
  border: 0; background: transparent; text-align: start; font: 600 11.5px system-ui, sans-serif; color: var(--zbf-muted); cursor: pointer;
}
.zbf-sb-group-head:hover { background: var(--zbf-hover); color: var(--zbf-text); }
.zbf-sb-group-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.zbf-sb-col-group-btn { border: 0; background: transparent; color: var(--zbf-muted); cursor: pointer; padding: 2px 6px; border-radius: 4px; font-size: 13px; flex: none; }
.zbf-sb-col-group-btn:hover { background: var(--zbf-hover); color: var(--zbf-accent); }

.zbf-vtab-row {
  display: flex; align-items: center; gap: 7px; padding: 4px 8px; border-radius: 5px; cursor: pointer; border-left: 2px solid transparent;
}
.zbf-vtab-row:hover { background: var(--zbf-hover); }
.zbf-vtab-row.selected { background: var(--zbf-accent-soft); border-left-color: var(--zbf-accent); font-weight: 600; }
.zbf-vtab-row.sleeping { opacity: 0.65; }
.zbf-vtab-row.virtual { opacity: 0.64; border: 1px dashed var(--zbf-border); }
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
  display: none; align-items: center; justify-content: center; width: 22px; height: 22px;
  border: 0; border-radius: 4px; background: transparent; color: var(--zbf-muted); cursor: pointer;
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

.zbf-hover-card {
  position: fixed; z-index: 2147483647; width: 310px; padding: 10px 12px; border-radius: 8px;
  border: 1px solid var(--zbf-border); background: var(--zbf-card); color: var(--zbf-text);
  box-shadow: 0 8px 24px rgba(0,0,0,0.18); pointer-events: none; font: 12px/1.5 system-ui, sans-serif;
}
.zbf-hc-title { font-weight: 600; margin-bottom: 4px; line-height: 1.4; overflow-wrap: anywhere; }
.zbf-hc-meta { font-size: 11px; color: var(--zbf-muted); overflow-wrap: anywhere; }
.zbf-hc-note { margin-top: 5px; padding: 4px 7px; border-radius: 5px; background: var(--zbf-accent-soft); color: var(--zbf-accent); font-size: 11px; }

.zbf-spot-box { width: 510px; max-width: 90vw; padding: 10px 12px 12px; background: var(--zbf-card); color: var(--zbf-text); display: flex; flex-direction: column; gap: 8px; font: 13px system-ui, "Microsoft YaHei UI", sans-serif; }
.zbf-spot-input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: none; border-bottom: 1px solid var(--zbf-border); background: transparent; color: var(--zbf-text); font: 13.5px system-ui, sans-serif; outline: none; }
.zbf-spot-input:focus { border-bottom-color: var(--zbf-accent); }
.zbf-spot-results { max-height: 420px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; }
.zbf-spot-row {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; border-radius: 6px;
  border: 1px solid transparent; background: transparent; color: inherit; text-align: left; font: inherit; cursor: pointer;
}
.zbf-spot-row.active, .zbf-spot-row:hover { background: var(--zbf-accent-soft); border-color: color-mix(in srgb, var(--zbf-accent) 32%, transparent); }
.zbf-spot-badge { font-size: 11px; padding: 1px 6px; border-radius: 4px; background: var(--zbf-accent-soft); color: var(--zbf-accent); font-weight: 600; flex: none; }

#zbf-hub-backdrop {
  position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: flex-start; justify-content: center;
  padding-top: 68px; background: light-dark(rgba(15, 23, 42, 0.28), rgba(0, 0, 0, 0.52));
}
.zbf-hub-box {
  width: 540px; max-width: calc(100vw - 32px); max-height: calc(100vh - 104px); overflow-y: auto; padding: 16px 18px;
  border-radius: 10px; background: var(--zbf-card); color: var(--zbf-text); border: 1px solid var(--zbf-border);
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.28); font: 13px/1.5 system-ui, "Microsoft YaHei UI", sans-serif; display: flex; flex-direction: column; gap: 10px;
}
.zbf-hub-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.zbf-hub-title { font-size: 14px; font-weight: 600; }
.zbf-hub-quickbar { display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: 8px; border: 1px solid var(--zbf-border); background: var(--zbf-surface); }
.zbf-hub-input { width: 100%; box-sizing: border-box; height: 28px; padding: 0 9px; border: 1px solid var(--zbf-border); border-radius: 6px; background: var(--zbf-card); color: var(--zbf-text); font: 12px system-ui, sans-serif; outline: none; }
.zbf-hub-actions { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.zbf-hub-card { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--zbf-border); background: var(--zbf-surface); }
.zbf-hub-card-info { min-width: 0; flex: 1; }
.zbf-hub-card-name { font-weight: 600; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-hub-card-meta { font-size: 11px; color: var(--zbf-muted); }
.zbf-hub-card-actions { display: inline-flex; gap: 6px; flex: none; }
.zbf-hub-section { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.zbf-hub-section-title { font-size: 12px; font-weight: 600; color: var(--zbf-muted); }
.zbf-hub-empty, .zbf-hub-status { font-size: 12px; color: var(--zbf-muted); }
.zbf-hub-lists { display: flex; flex-direction: column; gap: 10px; }
.zbf-hub-close { border: 0; background: transparent; color: var(--zbf-muted); cursor: pointer; font-size: 14px; padding: 2px 6px; border-radius: 4px; }
.zbf-hub-close:hover { background: var(--zbf-hover); color: var(--zbf-text); }
.zbf-hub-btn { height: 25px; padding: 0 9px; border: 1px solid var(--zbf-border); border-radius: 5px; background: var(--zbf-card); color: var(--zbf-text); font: 11.5px system-ui, sans-serif; cursor: pointer; }
.zbf-hub-btn:hover:not(:disabled) { background: var(--zbf-hover); }
.zbf-hub-btn.primary { background: var(--zbf-accent); border-color: var(--zbf-accent); color: #fff; font-weight: 600; }

#zbf-spotlight-backdrop {
  position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: flex-start; justify-content: center;
  padding-top: 72px; background: light-dark(rgba(15, 23, 42, 0.25), rgba(0, 0, 0, 0.48));
}
#zbf-spotlight-panel {
  width: 540px; max-width: calc(100vw - 32px); border-radius: 10px; background: var(--zbf-card); color: var(--zbf-text);
  border: 1px solid var(--zbf-border); box-shadow: 0 18px 46px rgba(0, 0, 0, 0.28); overflow: hidden;
  font: 13px system-ui, "Microsoft YaHei UI", sans-serif;
}
#zbf-spotlight-input {
  width: 100%; box-sizing: border-box; padding: 11px 14px; border: 0; border-bottom: 1px solid var(--zbf-border);
  background: transparent; color: var(--zbf-text); font: 13.5px system-ui, sans-serif; outline: none;
}
#zbf-spotlight-list { max-height: 400px; overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 2px; }
.zbf-spotlight-item {
  display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; padding: 7px 10px; border: 0; border-radius: 6px;
  background: transparent; color: inherit; font: inherit; cursor: pointer;
}
.zbf-spotlight-item.active, .zbf-spotlight-item:hover { background: var(--zbf-accent-soft); }
.zbf-spotlight-title { font-weight: 600; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-spotlight-sub, .zbf-spotlight-empty { font-size: 11px; color: var(--zbf-muted); padding: 2px 0; }
.zbf-spotlight-empty { padding: 14px; text-align: center; }

.zbf-popup-menu {
  position: fixed; z-index: 2147483647; display: flex; flex-direction: column; gap: 2px; padding: 5px;
  border-radius: 8px; border: 1px solid var(--zbf-border); background: var(--zbf-card); color: var(--zbf-text);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22); font: 12px system-ui, "Microsoft YaHei UI", sans-serif;
}
.zbf-popup-item {
  display: flex; align-items: center; width: 100%; text-align: left; padding: 6px 10px; border: 0; border-radius: 5px;
  background: transparent; color: var(--zbf-text); font: inherit; cursor: pointer;
}
.zbf-popup-item:hover { background: var(--zbf-hover); }
.zbf-popup-item.danger { color: light-dark(#c62828, #f87171); }
.zbf-popup-sep { height: 1px; margin: 3px 4px; background: var(--zbf-border); }
.zbf-popup-header { padding: 4px 8px; font-weight: 600; font-size: 11.5px; color: var(--zbf-muted); }
.zbf-popup-empty { padding: 10px 8px; font-size: 11.5px; color: var(--zbf-muted); }
.zbf-color-row { display: flex; align-items: center; gap: 6px; padding: 5px 8px; }
.zbf-color-swatch { width: 16px; height: 16px; border-radius: 50%; border: 1.5px solid transparent; cursor: pointer; padding: 0; }
.zbf-color-swatch.active { border-color: var(--zbf-text); transform: scale(1.1); }
.zbf-stale-row { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 5px; }
.zbf-stale-row:hover { background: var(--zbf-hover); }
.zbf-stale-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.zbf-stale-footer { display: flex; justify-content: flex-end; gap: 6px; padding: 4px 6px; }
.zbf-mini-btn {
  padding: 2px 7px; border-radius: 4px; border: 1px solid var(--zbf-border); background: var(--zbf-surface);
  color: var(--zbf-text); font: 11px system-ui, sans-serif; cursor: pointer; flex: none;
}
.zbf-mini-btn.danger { color: light-dark(#c62828, #f87171); }
`;
