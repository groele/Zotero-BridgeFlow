export const WORKSPACE_CSS = `
:root {
  --zbf-surface: var(--material-sidepane, light-dark(#f7f8fa, #242528));
  --zbf-card: var(--material-background, light-dark(#ffffff, #2b2c30));
  --zbf-border: var(--material-border, light-dark(rgba(0,0,0,0.09), rgba(255,255,255,0.1)));
  --zbf-text: var(--fill-primary, light-dark(#1f2328, #e6edf3));
  --zbf-muted: var(--fill-secondary, light-dark(#6e7781, #9198a1));
  --zbf-hover: light-dark(rgba(0,0,0,0.05), rgba(255,255,255,0.08));
  --zbf-accent: var(--accent-blue, light-dark(#245ac7, #6ea8fe));
}

#tab-bar-container[data-zbf-inline]:not([hidden]) { flex: 1 1 0%; min-width: 0; overflow: hidden; }
#tab-bar-container[data-zbf-inline] > div { min-width: 0; flex: 1 1 0%; }
#tab-bar-container[data-zbf-inline] .tab-bar-inner-container { min-width: 0; min-height: var(--tab-min-height, 36px); align-items: center; }
#tab-bar-container[data-zbf-inline] .tabs-wrapper,
#tab-bar-container[data-zbf-inline] .scroll-start-arrow,
#tab-bar-container[data-zbf-inline] .scroll-end-arrow { display: none !important; }

#zbf-inline, #zbf-inline *, .zbf-pinned-strip, .zbf-pinned-strip *, #zbf-toolbar-actions, #zbf-toolbar-actions * {
  -moz-window-dragging: no-drag;
}

#zbf-inline {
  display: flex; align-items: center; flex: 1 1 0%; min-width: 0; min-height: var(--tab-min-height, 36px);
  overflow-x: auto; overflow-y: hidden; scrollbar-width: none; gap: 6px; padding: 0 6px;
  font: 12px system-ui, "Microsoft YaHei UI", sans-serif; color: var(--zbf-text);
}
#zbf-inline[hidden], .zbf-pinned-strip[hidden] { display: none !important; }

.zbf-pinned-strip {
  display: flex; align-items: center; gap: 4px; max-width: 32%; min-width: 0;
  padding-inline: 4px; border-inline-end: 1px solid var(--zbf-border);
  overflow-x: auto; scrollbar-width: none; flex: 0 1 auto;
}
.zbf-pinned-chip {
  display: inline-flex; align-items: center; gap: 4px; height: 26px; max-width: 120px; padding: 0 8px;
  border: 0; border-radius: 6px; background: color-mix(in srgb, #f59e0b 14%, transparent);
  color: var(--zbf-text); font: 12px system-ui, sans-serif; cursor: pointer; flex: none;
}
.zbf-pinned-chip.icon-only { max-width: 28px; padding: 0 7px; }
.zbf-pinned-chip.selected { background: var(--zbf-card); box-shadow: 0 0 0 1px var(--zbf-border); font-weight: 600; }
.zbf-pinned-chip > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.zbf-hsection { position: relative; display: inline-flex; align-items: center; gap: 4px; height: 28px; flex: none; }
.zbf-hsection[data-grouped="true"]::after {
  content: ""; position: absolute; left: 2px; right: 2px; bottom: -3px; height: 2px; border-radius: 1px;
  background: var(--zbf-gcolor, var(--zbf-accent)); pointer-events: none;
}
.zbf-group-pill {
  display: inline-flex; align-items: center; gap: 4px; height: 24px; max-width: 160px; padding: 0 9px;
  border: 0; border-radius: 6px; color: #fff; font: 600 12px/1 system-ui, sans-serif;
  cursor: pointer; white-space: nowrap; flex: none; overflow: hidden; text-overflow: ellipsis;
}
.zbf-htab {
  display: inline-flex; align-items: center; gap: 5px; height: 26px; max-width: 175px; padding: 0 8px;
  border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--zbf-text);
  font: 12px system-ui, sans-serif; cursor: pointer; flex: none;
}
.zbf-htab:hover { background: var(--zbf-hover); }
.zbf-htab.selected { background: var(--zbf-card); border-color: var(--zbf-border); font-weight: 600; }
.zbf-htab.sleeping { opacity: 0.6; }
.zbf-htab.virtual { opacity: 0.68; border-style: dashed; border-color: var(--zbf-border); }
.zbf-htab-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 132px; }
.zbf-htab-close {
  display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px;
  border: 0; border-radius: 4px; background: transparent; color: var(--zbf-muted); cursor: pointer; opacity: 0;
}
.zbf-htab:hover .zbf-htab-close, .zbf-htab.selected .zbf-htab-close { opacity: 0.85; }
.zbf-htab-close:hover { background: var(--zbf-hover); color: var(--zbf-text); opacity: 1; }
.zbf-add-group {
  display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px;
  border: 1px dashed var(--zbf-border); border-radius: 6px; background: transparent; color: var(--zbf-muted); cursor: pointer; flex: none;
}
.zbf-add-group:hover { color: var(--zbf-text); background: var(--zbf-hover); }
.zbf-inline-edit {
  height: 24px; width: 120px; padding: 0 6px; border-radius: 5px;
  border: 1px solid var(--zbf-accent); background: var(--zbf-card); color: var(--zbf-text); font: 12px system-ui, sans-serif;
}

#zbf-toolbar-actions { display: inline-flex; align-items: center; gap: 4px; padding: 0 6px; flex: none; }
.zbf-tb-btn {
  display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 7px;
  border: 1px solid var(--zbf-border); border-radius: 6px;
  background: var(--zbf-card); color: var(--zbf-text);
  font: 500 12px/1 system-ui, "Microsoft YaHei UI", sans-serif; cursor: pointer;
}
.zbf-tb-btn:hover { background: var(--zbf-hover); border-color: var(--zbf-accent); }
.zbf-tb-btn[aria-pressed="true"] { background: color-mix(in srgb, var(--zbf-accent) 14%, transparent); border-color: var(--zbf-accent); }
.zbf-tb-icon { flex: none; display: inline-block; }

#zbf-sidebar {
  display: flex; flex-direction: column; width: 276px; min-width: 200px; max-width: 440px;
  background: var(--zbf-surface); color: var(--zbf-text); border-inline-end: 1px solid var(--zbf-border);
  font: 13px system-ui, "Microsoft YaHei UI", sans-serif; position: relative; flex: none;
}
#zbf-sidebar[data-collapsed="true"] { display: none; }
.zbf-sb-splitter {
  position: absolute; top: 0; right: -3px; bottom: 0; width: 6px; cursor: ew-resize; z-index: 5;
}
.zbf-sb-splitter:hover { background: color-mix(in srgb, var(--zbf-accent) 35%, transparent); }
.zbf-sb-header { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--zbf-border); }
.zbf-sb-title { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 13px; }
.zbf-sb-actions { display: inline-flex; align-items: center; gap: 3px; }
.zbf-sb-icon-btn {
  display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px;
  padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--zbf-text); cursor: pointer;
}
.zbf-sb-icon-btn:hover { background: var(--zbf-hover); }
.zbf-sb-search-wrap { padding: 6px 10px; }
.zbf-sb-search {
  width: 100%; box-sizing: border-box; padding: 5px 8px; border-radius: 6px;
  border: 1px solid var(--zbf-border); background: var(--zbf-card); color: var(--zbf-text); font: 12px system-ui, sans-serif;
}
.zbf-sb-views { display: flex; gap: 4px; padding: 0 10px 6px; border-bottom: 1px solid var(--zbf-border); }
.zbf-sb-view-btn {
  flex: 1; height: 24px; border: 0; border-radius: 5px; background: transparent;
  color: var(--zbf-muted); font: 500 12px/1 system-ui, sans-serif; cursor: pointer;
}
.zbf-sb-view-btn.active { background: var(--zbf-card); color: var(--zbf-text); box-shadow: 0 0 0 1px var(--zbf-border); font-weight: 600; }
.zbf-sb-list { flex: 1 1 auto; overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 3px; }
.zbf-sb-group-head {
  display: flex; align-items: center; justify-content: space-between; gap: 6px;
  padding: 4px 6px; border-radius: 5px; font-size: 12px; font-weight: 600; cursor: pointer;
}
.zbf-sb-group-head:hover { background: var(--zbf-hover); }
.zbf-sb-group-dot { width: 8px; height: 8px; border-radius: 999px; flex: none; }
.zbf-vtab-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 5px 8px; border-radius: 6px; cursor: pointer; }
.zbf-vtab-row:hover { background: var(--zbf-hover); }
.zbf-vtab-row.selected { background: color-mix(in srgb, var(--zbf-accent) 13%, transparent); font-weight: 600; }
.zbf-vtab-row.sleeping { opacity: 0.62; }
.zbf-vtab-row.virtual { opacity: 0.68; border: 1px dashed var(--zbf-border); }
.zbf-vtab-main { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 1px; }
.zbf-vtab-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-vtab-sub { font-size: 11px; color: var(--zbf-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-vtab-right { display: inline-flex; align-items: center; gap: 3px; flex: none; }
.zbf-cite-badge { font-size: 11px; font-weight: 600; padding: 1px 5px; border-radius: 4px; background: #0D9488; color: #fff; }
.zbf-row-btn {
  display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px;
  border: 0; border-radius: 4px; background: transparent; color: var(--zbf-muted); cursor: pointer; opacity: 0;
}
.zbf-vtab-row:hover .zbf-row-btn { opacity: 1; }
.zbf-row-btn:hover { background: var(--zbf-hover); color: var(--zbf-text); }
.zbf-sb-status { padding: 6px 10px; border-top: 1px solid var(--zbf-border); font-size: 11px; color: var(--zbf-muted); display: flex; justify-content: space-between; }

.zbf-hover-card {
  position: fixed; z-index: 9999; width: 280px; padding: 10px; border-radius: 8px;
  border: 1px solid var(--zbf-border); background: var(--zbf-card); color: var(--zbf-text);
  box-shadow: 0 6px 20px rgba(0,0,0,0.22); pointer-events: none; font: 12px/1.45 system-ui, sans-serif;
}
.zbf-hc-title { font-weight: 600; margin-bottom: 4px; }
.zbf-hc-meta { font-size: 11px; color: var(--zbf-muted); }

.zbf-spot-box {
  width: 480px; max-width: 90vw; padding: 10px; background: var(--zbf-card); color: var(--zbf-text);
  display: flex; flex-direction: column; gap: 8px; font: 13px system-ui, sans-serif;
}
.zbf-spot-input {
  width: 100%; box-sizing: border-box; padding: 7px 10px; border-radius: 6px;
  border: 1px solid var(--zbf-border); background: var(--zbf-surface); color: var(--zbf-text); font: inherit;
}
.zbf-spot-results { max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.zbf-spot-row {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 6px 8px; border-radius: 6px; border: 0; background: transparent; color: inherit;
  text-align: left; font: inherit; cursor: pointer;
}
.zbf-spot-row.active, .zbf-spot-row:hover { background: color-mix(in srgb, var(--zbf-accent) 14%, transparent); }
.zbf-spot-badge { font-size: 11px; padding: 1px 6px; border-radius: 4px; background: var(--zbf-hover); color: var(--zbf-muted); flex: none; }
`;
