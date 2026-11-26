export const SIDEBAR_CSS = `
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
`;
