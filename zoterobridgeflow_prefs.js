/* Zotero BridgeFlow v0.5.11 - Preferences controller. */
"use strict";
(() => {
  // src/kernel/pref-schema.ts
  var PREF_PREFIX = "extensions.zotero.bridgeflow.";
  var PREF_SCHEMA = {
    // === Core Module & Fusion Master Switches ===
    "modules.workspace.enable": { defaultValue: true },
    "modules.inspector.enable": { defaultValue: true },
    "modules.wordCite.enable": { defaultValue: true },
    "modules.visualNotes.enable": { defaultValue: true },
    "fusion.copyToLookupHistory": { defaultValue: true },
    "fusion.sidebarCiteBadge": { defaultValue: true },
    "fusion.spotlightCrossDomain": { defaultValue: true },
    "fusion.lookupJumpExistingTab": { defaultValue: true },
    "debug": {
      defaultValue: false
    },
    // === Domain A: Workspace (Tabs, Groups, Sessions, Sleep, Spotlight) ===
    "workspace.enableHorizontalGroups": { defaultValue: true },
    "workspace.horizontalTabCompactMode": {
      defaultValue: "auto",
      enumValues: ["auto", "compact", "normal"]
    },
    "workspace.compactTopBar": { defaultValue: false },
    "workspace.enableVerticalSidebar": { defaultValue: true },
    "workspace.enableBatchSelection": { defaultValue: true },
    "workspace.enablePinnedTabs": { defaultValue: true },
    "workspace.pinnedIconOnly": { defaultValue: false },
    "workspace.enableVirtualMembers": { defaultValue: true },
    "workspace.newTabMode": {
      defaultValue: "independent",
      enumValues: ["independent", "collection"]
    },
    "workspace.multiCollectionStrategy": {
      defaultValue: "active",
      enumValues: ["active", "existing", "first"]
    },
    "workspace.enableTabRemarks": { defaultValue: true },
    "workspace.syncRemarkToExtra": { defaultValue: true },
    "workspace.remarkColumn.enable": { defaultValue: true },
    "workspace.readingColumn.enable": { defaultValue: true },
    "workspace.readingTitleHeatmap.enable": { defaultValue: true },
    "workspace.readingHeatmap.color": { defaultValue: "#0d9488" },
    "workspace.readingHeatmap.opacity": { defaultValue: 42, min: 10, max: 90 },
    "workspace.annotationColumn.enable": { defaultValue: true },
    "visualNotes.infoBriefNote.enable": { defaultValue: true },
    "visualNotes.statusColumn.enable": { defaultValue: true },
    "visualNotes.ratingColumn.enable": { defaultValue: true },
    "visualNotes.ratingStorage": {
      defaultValue: "cache",
      enumValues: ["cache", "extra", "tag"]
    },
    "visualNotes.gallery.enable": { defaultValue: true },
    "visualNotes.gallery.defaultMode": {
      defaultValue: "gallery",
      enumValues: ["gallery", "board"]
    },
    "visualNotes.gallery.groupBy": {
      defaultValue: "status",
      enumValues: ["status", "rating", "readState", "year", "publication", "itemType"]
    },
    "visualNotes.gallery.cardWidth": { defaultValue: 220, min: 140, max: 440 },
    "visualNotes.gallery.coverHeight": { defaultValue: 0, min: 0, max: 360 },
    "visualNotes.gallery.cardDensity": {
      defaultValue: "comfortable",
      enumValues: ["comfortable", "compact"]
    },
    "visualNotes.gallery.showBriefNote": { defaultValue: true },
    "visualNotes.collectionHub.separateWindow": { defaultValue: false },
    "visualNotes.collectionHub.enable": { defaultValue: true },
    "visualNotes.collectionHub.ignoreFigureTable": { defaultValue: false },
    "visualNotes.collectionHub.preferCommentOverQuote": { defaultValue: false },
    "workspace.remarkDisplayMode": {
      defaultValue: "both",
      enumValues: ["both", "remark", "title"]
    },
    "workspace.verticalTabTitleMode": {
      defaultValue: "title",
      enumValues: ["title", "shortTitle", "filename"]
    },
    "workspace.verticalTabSubtitleMode": {
      defaultValue: "source",
      enumValues: ["source", "creatorYear", "collection", "lastViewed", "none"]
    },
    "workspace.verticalTabRowHeight": { defaultValue: 42, min: 28, max: 72 },
    "workspace.verticalTabFontSize": { defaultValue: 13, min: 11, max: 18 },
    "workspace.verticalSidebarWidth": { defaultValue: 276, min: 200, max: 440 },
    "workspace.verticalSidebarCollapsed": { defaultValue: false },
    "workspace.enableHoverPreview": { defaultValue: true },
    "workspace.enableSpotlight": { defaultValue: true },
    "workspace.enableAnnotationMatrix": { defaultValue: true },
    "workspace.enableSessions": { defaultValue: true },
    "workspace.enableRollingSnapshots": { defaultValue: true },
    "workspace.enableTabSleep": { defaultValue: true },
    "workspace.autoSleepMinutes": { defaultValue: 0, min: 0, max: 1440 },
    "workspace.activeReaderBudget": { defaultValue: 0, min: 0, max: 100 },
    "workspace.enableStaleSuggestions": { defaultValue: true },
    "workspace.staleSuggestDays": { defaultValue: 7, min: 1, max: 3650 },
    "workspace.enableTabContextMenu": { defaultValue: true },
    "workspace.enableCopyReference": { defaultValue: true },
    "workspace.enableShowInFilesystem": { defaultValue: true },
    "workspace.enableReloadTab": { defaultValue: true },
    "workspace.document": { defaultValue: "", resettable: false },
    // === Domain B: Inspector (CSL Preview, Citation Lookup, PDF Preview & Folder) ===
    "inspector.cslPreview.enable": { defaultValue: true },
    "inspector.cslPreview.citationstyle": { defaultValue: "" },
    "inspector.cslPreview.position": {
      defaultValue: "zotero-item-pane-header",
      enumValues: ["zotero-item-pane-header", "zotero-editpane-item-box", "zotero-editpane-related"]
    },
    "inspector.cslPreview.whatToShow": {
      defaultValue: "zpboth",
      enumValues: ["zpboth", "zpcite", "zpbib"]
    },
    "inspector.cslPreview.fontsize": { defaultValue: "1" },
    "inspector.cslPreview.spacing": { defaultValue: "1.5" },
    "inspector.cslPreview.maxPreviewItems": { defaultValue: 100, min: 1, max: 500 },
    "inspector.lookup.enable": { defaultValue: true },
    "inspector.lookup.historyEnable": { defaultValue: true },
    "inspector.lookup.cacheDirectory": { defaultValue: "" },
    "inspector.lookup.cacheMaxEntries": { defaultValue: 2e3, min: 100, max: 1e5 },
    "inspector.lookup.cacheTtlDays": { defaultValue: 90, min: 7, max: 3650 },
    "inspector.pdfPreview.enable": { defaultValue: true },
    "inspector.pdfPreview.position": {
      defaultValue: "zotero-editpane-related",
      enumValues: ["zotero-item-pane-header", "zotero-editpane-item-box", "zotero-editpane-related"]
    },
    "inspector.pdfPreview.mode": {
      defaultValue: "section",
      enumValues: ["section", "full"]
    },
    "inspector.pdfPreview.defaultZoom": { defaultValue: 100, min: 60, max: 200 },
    "inspector.pdfPreview.doubleClickOpen": { defaultValue: true },
    "inspector.pdfPreview.showPageBadge": { defaultValue: true },
    "inspector.pdfPreview.neighborCompareEnable": { defaultValue: true },
    "inspector.annotations.mergeEnable": { defaultValue: true },
    "inspector.annotations.popupLabelsEnable": { defaultValue: true },
    "inspector.annotations.colorLabels": { defaultValue: "" },
    "inspector.annotations.enabledColors": { defaultValue: "" },
    "inspector.pdfFolder.enable": { defaultValue: true },
    "inspector.pdfFolder.position": {
      defaultValue: "zotero-editpane-related",
      enumValues: ["zotero-item-pane-header", "zotero-editpane-item-box", "zotero-editpane-related"]
    },
    "inspector.pdfFolder.openMode": {
      defaultValue: "reveal",
      enumValues: ["reveal", "folder"]
    },
    "inspector.wordCite.enable": { defaultValue: true },
    "inspector.wordCite.position": {
      defaultValue: "zotero-editpane-related",
      enumValues: [
        "zotero-item-pane-header",
        "zotero-editpane-item-box",
        "zotero-editpane-abstract",
        "zotero-editpane-attachments",
        "zotero-editpane-notes",
        "zotero-editpane-related"
      ]
    },
    "inspector.wordCite.showDocSwitcher": { defaultValue: true },
    "inspector.wordCite.showSummaryCounts": { defaultValue: true },
    "inspector.wordCite.showGroupSynergy": { defaultValue: true },
    "inspector.wordCite.showCollectionLink": { defaultValue: true },
    // === Domain C: Word Citation Tracking & Governance ===
    "wordCite.column.enable": { defaultValue: true },
    "wordCite.dragCite.enable": { defaultValue: true },
    "wordCite.tabContextMenu.enable": { defaultValue: true },
    "wordCite.collections.enable": { defaultValue: true },
    "wordCite.citationTags.enable": { defaultValue: true },
    "wordCite.citationTags.text": { defaultValue: "/Citations" },
    "wordCite.citationTagDebounceMs": { defaultValue: 150, min: 0, max: 2e3 },
    "wordCite.itemsViewRefreshDebounceMs": { defaultValue: 120, min: 0, max: 2e3 },
    "wordCite.healthWindowMs": { defaultValue: 3e5, min: 1e4, max: 36e5 },
    "wordCite.perfSlowThresholdMs": { defaultValue: 50, min: 5, max: 5e3 }
  };

  // src/kernel/pref-service.ts
  function resolveDefaultAdapter() {
    const host = globalThis.Zotero?.Prefs;
    return host && typeof host.get === "function" ? host : null;
  }
  function normalizePrefValue(key, raw) {
    const desc = PREF_SCHEMA[key];
    const def = desc.defaultValue;
    if (raw === void 0 || raw === null || raw === "undefined" || raw === "null") return def;
    if (typeof def === "boolean") return Boolean(raw);
    if (typeof def === "number") {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) return def;
      let clamped = Math.round(n);
      if (typeof desc.min === "number") clamped = Math.max(desc.min, clamped);
      if (typeof desc.max === "number") clamped = Math.min(desc.max, clamped);
      return clamped;
    }
    const str = String(raw);
    if (key === "inspector.cslPreview.fontsize" || key === "inspector.cslPreview.spacing") {
      const num = Number(str);
      if (!Number.isFinite(num) || num <= 0) return def;
    }
    if (desc.enumValues && !desc.enumValues.includes(str)) {
      return def;
    }
    return str;
  }
  var UnifiedPrefService = class {
    cache = /* @__PURE__ */ new Map();
    observerIDs = [];
    bus;
    adapterOverride;
    constructor(options = {}) {
      this.bus = options.bus;
      this.adapterOverride = options.adapter;
    }
    get adapter() {
      return this.adapterOverride ?? resolveDefaultAdapter();
    }
    fullKey(key) {
      return PREF_PREFIX + key;
    }
    get(key) {
      if (this.cache.has(key)) return this.cache.get(key);
      const raw = this.readRaw(this.fullKey(key));
      const normalized = normalizePrefValue(key, raw);
      this.cache.set(key, normalized);
      return normalized;
    }
    set(key, value) {
      const normalized = normalizePrefValue(key, value);
      this.cache.set(key, normalized);
      try {
        this.adapter?.set(this.fullKey(key), normalized, true);
      } catch {
      }
      this.bus?.emit("prefs:changed", { key, value: normalized });
      return normalized;
    }
    readRaw(fullKey) {
      try {
        return this.adapter?.get(fullKey, true);
      } catch {
        return void 0;
      }
    }
    invalidate(key) {
      if (key) this.cache.delete(key);
      else this.cache.clear();
    }
    resetAllDefaults() {
      for (const key of Object.keys(PREF_SCHEMA)) {
        const desc = PREF_SCHEMA[key];
        if (desc.resettable === false) continue;
        this.set(key, desc.defaultValue);
      }
    }
    seedDefaults() {
      const adapter = this.adapter;
      if (!adapter) return;
      for (const key of Object.keys(PREF_SCHEMA)) {
        const full = this.fullKey(key);
        const existing = this.readRaw(full);
        const desc = PREF_SCHEMA[key];
        const normalized = normalizePrefValue(key, existing);
        if (existing === void 0 || existing === "undefined" || existing === "null" || existing !== normalized) {
          try {
            adapter.set(full, normalized ?? desc.defaultValue, true);
          } catch {
          }
        }
      }
    }
    observeKeys(keys, onChange) {
      const localTokens = [];
      const adapter = this.adapter;
      if (adapter?.registerObserver) {
        for (const key of keys) {
          const token = adapter.registerObserver(this.fullKey(key), () => {
            this.invalidate(key);
            const next = this.get(key);
            this.bus?.emit("prefs:changed", { key, value: next });
            onChange(key, next);
          }, true);
          this.observerIDs.push(token);
          localTokens.push(token);
        }
      }
      return () => {
        if (!adapter?.unregisterObserver) return;
        for (const token of localTokens) {
          try {
            adapter.unregisterObserver(token);
          } catch {
          }
          const idx = this.observerIDs.indexOf(token);
          if (idx >= 0) this.observerIDs.splice(idx, 1);
        }
      };
    }
    dispose() {
      const adapter = this.adapter;
      if (adapter?.unregisterObserver) {
        for (const token of this.observerIDs) {
          try {
            adapter.unregisterObserver(token);
          } catch {
          }
        }
      }
      this.observerIDs.length = 0;
      this.cache.clear();
    }
  };

  // src/services/annotation-utils.ts
  var DEFAULT_ANNOTATION_COLORS = {
    "#ffd400": "Context",
    "#ff6666": "Method",
    "#5fb236": "Gap",
    "#2ea8e5": "Finding",
    "#a28ae5": "Evidence",
    "#e56eee": "Quote",
    "#f19837": "Idea",
    "#aaaaaa": "Note"
  };
  var DEFAULT_ENABLED_ANNOTATION_COLORS = [
    "#ffd400",
    "#ff6666",
    "#5fb236",
    "#2ea8e5",
    "#a28ae5"
  ];
  var ANNOTATION_COLOR_PRESETS = {
    "3": ["#ffd400", "#ff6666", "#2ea8e5"],
    "5": DEFAULT_ENABLED_ANNOTATION_COLORS,
    "8": Object.keys(DEFAULT_ANNOTATION_COLORS)
  };
  function normalizeHexColor(color) {
    const clean = String(color || "").trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(clean)) return clean;
    if (/^#[0-9a-f]{3}$/.test(clean)) {
      return `#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`;
    }
    return clean;
  }
  function parseColorSemantics(rawJson) {
    const merged = { ...DEFAULT_ANNOTATION_COLORS };
    const raw = String(rawJson || "").trim();
    if (!raw) return merged;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          const hex = normalizeHexColor(k);
          const label = String(v || "").trim();
          if (hex && label) merged[hex] = label;
        }
      } else if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (!Array.isArray(entry) || entry.length < 2) continue;
          const a = String(entry[0] || "").trim();
          const b = String(entry[1] || "").trim();
          const aHex = /^#[0-9a-f]{3,6}$/i.test(a);
          const bHex = /^#[0-9a-f]{3,6}$/i.test(b);
          if (aHex && b) merged[normalizeHexColor(a)] = b;
          else if (bHex && a) merged[normalizeHexColor(b)] = a;
        }
      }
    } catch {
    }
    return merged;
  }
  function parseEnabledAnnotationColors(raw) {
    const clean = String(raw || "").trim();
    if (!clean) return new Set(DEFAULT_ENABLED_ANNOTATION_COLORS);
    const out = /* @__PURE__ */ new Set();
    const pushHex = (val) => {
      const hex = normalizeHexColor(String(val || ""));
      if (/^#[0-9a-f]{6}$/.test(hex)) out.add(hex);
    };
    if (clean.startsWith("[")) {
      try {
        const parsed = JSON.parse(clean);
        if (Array.isArray(parsed)) parsed.forEach(pushHex);
      } catch {
      }
    } else {
      for (const token of clean.split(/[\s,;]+/)) pushHex(token);
    }
    return out.size ? out : new Set(DEFAULT_ENABLED_ANNOTATION_COLORS);
  }
  function serializeEnabledAnnotationColors(colors) {
    const unique = [];
    const seen = /* @__PURE__ */ new Set();
    for (const raw of colors) {
      const hex = normalizeHexColor(raw);
      if (/^#[0-9a-f]{6}$/.test(hex) && !seen.has(hex)) {
        seen.add(hex);
        unique.push(hex);
      }
    }
    if (!unique.length) return "";
    const isDefault = unique.length === DEFAULT_ENABLED_ANNOTATION_COLORS.length && DEFAULT_ENABLED_ANNOTATION_COLORS.every((hex) => seen.has(hex));
    return isDefault ? "" : unique.join(",");
  }

  // src/prefs-color-editor.ts
  var XHTML_NS = "http://www.w3.org/1999/xhtml";
  function detectColorPresetValue(enabled) {
    for (const key of ["3", "5", "8"]) {
      const list = ANNOTATION_COLOR_PRESETS[key];
      if (enabled.size === list.length && list.every((hex) => enabled.has(hex))) return key;
    }
    return "custom";
  }
  function syncPresetMenulist(doc, enabled) {
    const ml = doc.getElementById("zbf-sel-ann-color-count");
    if (!ml) return;
    const val = detectColorPresetValue(enabled);
    try {
      ml.value = val;
    } catch {
    }
    ml.setAttribute?.("value", val);
    const items = Array.from(ml.querySelectorAll?.("menuitem") || []);
    const matched = items.find((it) => it.getAttribute("value") === val);
    if (matched) {
      try {
        ml.selectedItem = matched;
      } catch {
      }
      const lbl = matched.getAttribute("label") || (matched.textContent || "").trim();
      if (lbl) ml.setAttribute?.("label", lbl);
    }
  }
  function parseSlotPairs(rawJson) {
    const raw = rawJson.trim();
    if (!raw.startsWith("[")) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      const pairs = [];
      for (const item of parsed) {
        if (!Array.isArray(item) || item.length < 2) continue;
        const hex = normalizeHexColor(String(item[0] || ""));
        const lbl = String(item[1] || "").trim();
        if (hex && lbl) pairs.push([hex, lbl]);
      }
      return pairs.length ? pairs : null;
    } catch {
      return null;
    }
  }
  function buildColorLabelsJsonFromInputs(inputs) {
    const entries = [];
    let colorChanged = false;
    const defaults = Object.keys(DEFAULT_ANNOTATION_COLORS);
    let i = 0;
    for (const input of inputs) {
      const hex = normalizeHexColor(input.getAttribute("data-zbf-color"));
      const defHex = normalizeHexColor(input.getAttribute("data-zbf-default-color")) || defaults[i] || "";
      i += 1;
      if (!hex) continue;
      const defLabel = DEFAULT_ANNOTATION_COLORS[defHex] || "";
      const val = input.value.trim() || defLabel;
      if (defHex && hex !== defHex) colorChanged = true;
      entries.push([hex, val, defLabel]);
    }
    if (colorChanged) {
      return JSON.stringify(entries.map(([hex, val]) => [hex, val]));
    }
    const custom = {};
    for (const [hex, val, defLabel] of entries) {
      if (val && val !== defLabel) custom[hex] = val;
    }
    return Object.keys(custom).length ? JSON.stringify(custom) : "";
  }
  function syncAnnotationColorInputs(doc, rawJson, rawEnabled) {
    const grid = doc.getElementById("zbf-ann-color-grid");
    if (!grid) return;
    const trimmed = rawJson.trim();
    const pairs = parseSlotPairs(trimmed);
    const merged = parseColorSemantics(trimmed);
    const enabled = parseEnabledAnnotationColors(rawEnabled);
    const defaultEntries = Object.entries(DEFAULT_ANNOTATION_COLORS);
    const extraEntries = Object.entries(merged).filter(([hex]) => !(hex in DEFAULT_ANNOTATION_COLORS));
    const activeEl = doc.activeElement;
    let idx = 0;
    let extraIdx = 0;
    grid.querySelectorAll(".zbf-color-label-item").forEach((row) => {
      const swatch = row.querySelector?.('input[type="color"]');
      const input = row.querySelector?.("input[data-zbf-color]");
      const toggle = row.querySelector?.('input[type="checkbox"]');
      const [defHex, defLabel] = defaultEntries[idx] || ["", ""];
      const pair = pairs?.[idx];
      idx += 1;
      if (!input) return;
      let effectiveHex = defHex;
      if (pair) {
        effectiveHex = pair[0];
      } else if (trimmed) {
        const currentHex = normalizeHexColor(input.getAttribute("data-zbf-color")) || defHex;
        if (currentHex in merged) effectiveHex = currentHex;
        else if (!(defHex in merged) && extraEntries[extraIdx]) effectiveHex = extraEntries[extraIdx++][0];
      }
      const isEnabled = enabled.has(effectiveHex);
      if (toggle) {
        toggle.checked = isEnabled;
        if (isEnabled) toggle.setAttribute("checked", "true");
        else toggle.removeAttribute("checked");
      }
      row.classList?.toggle?.("is-muted", !isEnabled);
      if (activeEl && (activeEl === input || activeEl === swatch)) return;
      const val = pair?.[1] || merged[effectiveHex] || defLabel;
      if (swatch) {
        swatch.value = effectiveHex;
        swatch.setAttribute("value", effectiveHex);
        swatch.title = `${effectiveHex}（点击自定义颜色）`;
      }
      input.setAttribute("data-zbf-color", effectiveHex);
      row.style?.setProperty?.("--zbf-pill-color", effectiveHex);
      input.value = val;
      input.setAttribute("value", val);
    });
    syncPresetMenulist(doc, enabled);
  }
  function initAnnotationColorEditor(doc, prefs, onSaved) {
    const grid = doc.getElementById("zbf-ann-color-grid");
    if (!grid || grid.childElementCount > 0) return;
    const rawStr = String(prefs.get("inspector.annotations.colorLabels") || "");
    const rawEnabled = String(prefs.get("inspector.annotations.enabledColors") || "");
    const enabledSet = parseEnabledAnnotationColors(rawEnabled);
    const pairs = parseSlotPairs(rawStr);
    const merged = parseColorSemantics(rawStr);
    const extraEntries = Object.entries(merged).filter(([hex]) => !(hex in DEFAULT_ANNOTATION_COLORS));
    const commitEnabledFromGrid = () => {
      const activeHexes = [];
      grid.querySelectorAll(".zbf-color-label-item").forEach((item) => {
        const cb = item.querySelector?.('input[type="checkbox"]');
        const inp = item.querySelector?.("input[data-zbf-color]");
        const hex = normalizeHexColor(inp?.getAttribute("data-zbf-color"));
        const on = Boolean(cb?.checked);
        item.classList?.toggle?.("is-muted", !on);
        if (on && hex) activeHexes.push(hex);
      });
      if (!activeHexes.length) return false;
      const serialized = serializeEnabledAnnotationColors(activeHexes);
      prefs.set("inspector.annotations.enabledColors", serialized);
      syncPresetMenulist(doc, new Set(activeHexes));
      onSaved();
      return true;
    };
    let idx = 0;
    let extraIdx = 0;
    for (const [defHex, defLabel] of Object.entries(DEFAULT_ANNOTATION_COLORS)) {
      const pair = pairs?.[idx];
      idx += 1;
      let hex = pair ? pair[0] : defHex;
      if (!pair && rawStr && extraEntries[extraIdx] && !rawStr.toLowerCase().includes(defHex)) {
        hex = extraEntries[extraIdx++][0];
      }
      const isEnabled = enabledSet.has(hex);
      const row = doc.createElementNS(XHTML_NS, "div");
      row.className = isEnabled ? "zbf-color-label-item" : "zbf-color-label-item is-muted";
      row.style?.setProperty?.("--zbf-pill-color", hex);
      const swatch = doc.createElementNS(XHTML_NS, "input");
      swatch.type = "color";
      swatch.className = "zbf-color-label-dot";
      swatch.value = hex;
      swatch.setAttribute("value", hex);
      swatch.title = `${hex}（点击自定义颜色）`;
      const input = doc.createElementNS(XHTML_NS, "input");
      input.type = "text";
      input.className = "zbf-text-input zbf-color-label-input";
      input.setAttribute("data-zbf-default-color", defHex);
      input.setAttribute("data-zbf-color", hex);
      input.placeholder = defLabel;
      input.value = merged[hex] || defLabel;
      input.setAttribute("value", input.value);
      input.title = "点击编辑颜色语义标签";
      const toggle = doc.createElementNS(XHTML_NS, "input");
      toggle.type = "checkbox";
      toggle.className = "zbf-color-label-toggle";
      toggle.checked = isEnabled;
      if (isEnabled) toggle.setAttribute("checked", "true");
      toggle.title = "在 PDF 选词弹窗中启用/隐藏此颜色";
      const commit = (fallbackEmpty) => {
        if (fallbackEmpty && !input.value.trim()) input.value = defLabel;
        const allInputs = Array.from(grid.querySelectorAll("input[data-zbf-color]"));
        const nextJson = buildColorLabelsJsonFromInputs(allInputs);
        prefs.set("inspector.annotations.colorLabels", nextJson);
        onSaved();
      };
      const applyColor = () => {
        const nextHex = normalizeHexColor(swatch.value) || defHex;
        input.setAttribute("data-zbf-color", nextHex);
        swatch.title = `${nextHex}（点击自定义颜色）`;
        row.style?.setProperty?.("--zbf-pill-color", nextHex);
        commit(true);
        if (toggle.checked) commitEnabledFromGrid();
      };
      swatch.addEventListener("input", applyColor);
      swatch.addEventListener("change", applyColor);
      input.addEventListener("click", (ev) => ev.stopPropagation());
      input.addEventListener("input", () => commit(false));
      input.addEventListener("change", () => commit(true));
      input.addEventListener("blur", () => {
        commit(true);
        try {
          input.setSelectionRange?.(0, 0);
        } catch {
        }
        input.scrollLeft = 0;
      });
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          commit(true);
          input.blur?.();
        }
      });
      toggle.addEventListener("click", (ev) => ev.stopPropagation());
      toggle.addEventListener("change", () => {
        if (!commitEnabledFromGrid()) {
          toggle.checked = true;
          row.classList?.remove?.("is-muted");
        }
      });
      row.addEventListener("click", (ev) => {
        if (ev.target === row) input.focus();
      });
      row.append(swatch, input, toggle);
      grid.appendChild(row);
    }
    const presetSel = doc.getElementById("zbf-sel-ann-color-count");
    if (presetSel) {
      const onPreset = () => {
        const val = String(presetSel.selectedItem?.getAttribute?.("value") ?? presetSel.value ?? "");
        if (val !== "3" && val !== "5" && val !== "8") return;
        const presetColors = ANNOTATION_COLOR_PRESETS[val];
        const serialized = serializeEnabledAnnotationColors(presetColors);
        prefs.set("inspector.annotations.enabledColors", serialized);
        syncAnnotationColorInputs(doc, String(prefs.get("inspector.annotations.colorLabels") || ""), serialized);
        onSaved();
      };
      presetSel.addEventListener("command", onPreset);
      presetSel.addEventListener("change", onPreset);
      syncPresetMenulist(doc, enabledSet);
    }
  }

  // src/prefs-helpers.ts
  function setSubtreeDisabled(el, disabled) {
    if (!el) return;
    el.setAttribute("data-disabled", disabled ? "true" : "false");
    el.querySelectorAll("checkbox, menulist, input, button").forEach((ctrl) => {
      try {
        ctrl.disabled = disabled;
      } catch {
      }
      if (disabled) ctrl.setAttribute("disabled", "true");
      else ctrl.removeAttribute("disabled");
    });
  }
  function syncMenulistLabels(doc) {
    doc.querySelectorAll("#zotero-prefpane-zotero-bridgeflow menulist").forEach((ml) => {
      const hostMl = ml;
      const val = String(hostMl.value ?? ml.getAttribute("value") ?? "");
      const items = Array.from(ml.querySelectorAll("menuitem"));
      const matched = items.find((it) => it.getAttribute("value") === val) || hostMl.selectedItem || items[0];
      if (matched) {
        try {
          hostMl.selectedItem = matched;
        } catch {
        }
        const lbl = matched.getAttribute("label") || (matched.textContent || "").trim();
        if (lbl) ml.setAttribute("label", lbl);
      }
    });
  }
  function setStatusFeedback(doc, l10nId, fallbackText) {
    const statusEl = doc.getElementById("zbf-prefs-status");
    if (!statusEl) return;
    statusEl.setAttribute("data-l10n-id", l10nId);
    statusEl.textContent = fallbackText;
  }
  function updatePreferenceDependencies(doc, prefs) {
    prefs.invalidate();
    const wsOn = Boolean(prefs.get("modules.workspace.enable"));
    const insOn = Boolean(prefs.get("modules.inspector.enable"));
    const wcOn = Boolean(prefs.get("modules.wordCite.enable"));
    const vnOn = Boolean(prefs.get("modules.visualNotes.enable"));
    const vSideOn = wsOn && Boolean(prefs.get("workspace.enableVerticalSidebar"));
    const modMap = [
      ["workspace", wsOn],
      ["visualnotes", vnOn],
      ["inspector", insOn],
      ["wordcite", wcOn]
    ];
    for (const [slug, enabled] of modMap) {
      const offBanner = doc.getElementById(`zbf-off-${slug}`);
      if (offBanner) offBanner.hidden = enabled;
    }
    setSubtreeDisabled(doc.getElementById("zbf-group-workspace"), !wsOn);
    setSubtreeDisabled(doc.getElementById("zbf-group-visualnotes"), !vnOn);
    setSubtreeDisabled(doc.getElementById("zbf-sub-reading-heatmap"), !vnOn || !prefs.get("workspace.readingTitleHeatmap.enable"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-rating-cfg"), !vnOn || !prefs.get("visualNotes.ratingColumn.enable"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-gallery-cfg"), !vnOn || !prefs.get("visualNotes.gallery.enable"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-hub-cfg"), !vnOn || !prefs.get("visualNotes.collectionHub.enable"));
    setSubtreeDisabled(doc.getElementById("zbf-group-inspector"), !insOn);
    setSubtreeDisabled(doc.getElementById("zbf-group-pdf"), !insOn);
    setSubtreeDisabled(doc.getElementById("zbf-group-wordcite"), !wcOn);
    setSubtreeDisabled(doc.getElementById("zbf-group-word-perf"), !wcOn);
    setSubtreeDisabled(doc.getElementById("zbf-sub-hcompact"), !wsOn || !prefs.get("workspace.enableHorizontalGroups"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-compactTop"), !vSideOn || !prefs.get("workspace.enableHorizontalGroups"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-vsidebar-cfg"), !vSideOn);
    setSubtreeDisabled(doc.getElementById("zbf-sub-vsidebar-typo"), !vSideOn);
    setSubtreeDisabled(doc.getElementById("zbf-sub-pinnedIcon"), !wsOn || !prefs.get("workspace.enablePinnedTabs"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-multicol"), !wsOn || prefs.get("workspace.newTabMode") !== "collection");
    setSubtreeDisabled(doc.getElementById("zbf-session-actions"), !wsOn || !prefs.get("workspace.enableSessions"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-rolling"), !wsOn || !prefs.get("workspace.enableSessions"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-sleep-cfg"), !wsOn || !prefs.get("workspace.enableTabSleep"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-stale-days"), !wsOn || !prefs.get("workspace.enableStaleSuggestions"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-remark-cfg"), !wsOn || !prefs.get("workspace.enableTabRemarks"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-tabmenu"), !wsOn || !prefs.get("workspace.enableTabContextMenu"));
    const matrixBtn = doc.getElementById("zbf-btn-open-matrix");
    if (matrixBtn) {
      const dis = !vnOn || !prefs.get("workspace.enableAnnotationMatrix");
      try {
        matrixBtn.disabled = dis;
      } catch {
      }
      if (dis) matrixBtn.setAttribute("disabled", "true");
      else matrixBtn.removeAttribute("disabled");
    }
    const hubBtn = doc.getElementById("zbf-btn-open-collection-hub");
    if (hubBtn) {
      const dis = !vnOn || !prefs.get("visualNotes.collectionHub.enable");
      try {
        hubBtn.disabled = dis;
      } catch {
      }
      if (dis) hubBtn.setAttribute("disabled", "true");
      else hubBtn.removeAttribute("disabled");
    }
    const cslOn = insOn && Boolean(prefs.get("inspector.cslPreview.enable"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-csl"), !cslOn);
    setSubtreeDisabled(doc.getElementById("zbf-sub-csl-layout"), !cslOn);
    const lookupOn = insOn && Boolean(prefs.get("inspector.lookup.enable"));
    const historyOn = lookupOn && Boolean(prefs.get("inspector.lookup.historyEnable"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-lookup-history"), !lookupOn);
    setSubtreeDisabled(doc.getElementById("zbf-sub-lookup-quota"), !historyOn);
    setSubtreeDisabled(doc.getElementById("zbf-sub-pdf-preview"), !insOn || !prefs.get("inspector.pdfPreview.enable"));
    setSubtreeDisabled(doc.getElementById("zbf-card-annotations"), !vnOn);
    setSubtreeDisabled(doc.getElementById("zbf-sub-pdf-folder"), !insOn || !prefs.get("inspector.pdfFolder.enable"));
    const wordPanelCard = doc.getElementById("zbf-sub-word-panel-card");
    setSubtreeDisabled(wordPanelCard, !wcOn || !insOn);
    setSubtreeDisabled(doc.getElementById("zbf-sub-word-panel"), !wcOn || !insOn || !prefs.get("inspector.wordCite.enable"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-wc-tag-text"), !wcOn || !prefs.get("wordCite.citationTags.enable"));
    syncMenulistLabels(doc);
  }
  function bindActionBtn(el, handler) {
    if (!el) return;
    let lastAt = 0;
    const run = () => {
      const now = Date.now();
      if (now - lastAt < 120) return;
      lastAt = now;
      handler();
    };
    el.addEventListener("command", run);
    el.addEventListener("click", run);
  }
  function bindPreferenceActions(doc, targetWin, prefs, syncAll) {
    const getApp = () => globalThis.Zotero?.zoterobridgeflow;
    const getMainWin = () => globalThis.Zotero?.getMainWindow?.() || targetWin;
    bindActionBtn(doc.getElementById("zbf-clear-cache"), () => {
      getApp()?.kernel?.bus?.emit("inspector:clear-cache", { target: "all" });
      setStatusFeedback(doc, "zbf-prefs-status-cache-cleared", "✓ 已清空全部引文与反查缓存");
    });
    bindActionBtn(doc.getElementById("zbf-clear-workspace-state"), () => {
      const app = getApp();
      if (app?.workspace?.store?.clearWorkspaceLayout) {
        app.workspace.store.clearWorkspaceLayout();
      } else {
        prefs.set("workspace.document", "");
      }
      app?.workspace?.refreshAllWindows?.();
      setStatusFeedback(doc, "zbf-prefs-status-ws-cleared", "✓ 已清除工作区分组与会话（阅读时长与简记已完整保留）");
    });
    const exportJsonBackup = async (title, defaultName, json, statusId, okText) => {
      if (!json) return;
      try {
        const cu = targetWin?.ChromeUtils || globalThis.ChromeUtils;
        if (cu?.importESModule && targetWin) {
          const mod = cu.importESModule("chrome://zotero/content/modules/filePicker.mjs");
          const picker = new mod.FilePicker();
          picker.init(targetWin, title, picker.modeSave ?? 1);
          picker.appendFilter("JSON 文件", "*.json");
          picker.defaultString = defaultName;
          const rv = await picker.show();
          if ((rv === picker.returnOK || rv === picker.returnReplace) && picker.file) {
            await globalThis.Zotero?.File?.putContentsAsync?.(picker.file, json);
            setStatusFeedback(doc, statusId, okText);
          }
        }
      } catch {
      }
    };
    bindActionBtn(doc.getElementById("zbf-btn-export-reading"), () => {
      void exportJsonBackup(
        "导出阅读时长与热力图备份 (JSON)",
        `BridgeFlow-ReadingProgress-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`,
        getApp()?.workspace?.store?.exportReadingJson?.(),
        "zbf-prefs-status-reading-exported",
        "✓ 已导出阅读时长与热力图 JSON 备份"
      );
    });
    bindActionBtn(doc.getElementById("zbf-clear-reading-notes"), () => {
      if (targetWin?.confirm && !targetWin.confirm("确定要清空所有文献的累计阅读时长与热力图记录吗？（不影响工作区分组与条目简记 Note，此操作不可撤销）")) {
        return;
      }
      const app = getApp();
      app?.workspace?.store?.clearReadingProgress?.();
      app?.workspace?.refreshAllWindows?.();
      app?.visualNotes?.refreshLibraryViews?.();
      setStatusFeedback(doc, "zbf-prefs-status-reading-cleared", "✓ 已清空阅读时长与热力图缓存（简记已保留）");
    });
    bindActionBtn(doc.getElementById("zbf-btn-export-brief-notes"), () => {
      void exportJsonBackup(
        "导出条目简记 (Note) 备份 (JSON)",
        `BridgeFlow-BriefNotes-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`,
        getApp()?.workspace?.store?.exportBriefNotesJson?.(),
        "zbf-prefs-status-notes-exported",
        "✓ 已导出独立简记 JSON 备份"
      );
    });
    bindActionBtn(doc.getElementById("zbf-clear-brief-notes"), () => {
      if (targetWin?.confirm && !targetWin.confirm("确定要清空本地独立缓存 brief-notes.json 中的条目简记吗？（不影响工作区、阅读时长及已同步到 Zotero Extra 的内容）")) {
        return;
      }
      const app = getApp();
      app?.workspace?.store?.clearBriefNotes?.();
      app?.workspace?.refreshAllWindows?.();
      app?.visualNotes?.refreshLibraryViews?.();
      setStatusFeedback(doc, "zbf-prefs-status-notes-cleared", "✓ 已清空本地简记缓存文件");
    });
    bindActionBtn(doc.getElementById("zbf-btn-export-ratings"), () => {
      void exportJsonBackup(
        "导出文献星级评价备份 (JSON)",
        `BridgeFlow-ItemRatings-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`,
        getApp()?.services?.ratings?.exportJson?.(),
        "zbf-prefs-status-ratings-exported",
        "✓ 已导出星级评价 JSON 备份"
      );
    });
    bindActionBtn(doc.getElementById("zbf-clear-ratings-cache"), () => {
      if (targetWin?.confirm && !targetWin.confirm("确定要清空本地独立缓存 item-ratings.json 中的文献星级评价吗？（不影响工作区、简记及 Zotero 原生字段）")) {
        return;
      }
      const app = getApp();
      app?.services?.ratings?.clearAll?.(true);
      app?.visualNotes?.refreshLibraryViews?.();
      setStatusFeedback(doc, "zbf-prefs-status-ratings-cleared", "✓ 已清空本地星级评价缓存文件");
    });
    bindActionBtn(doc.getElementById("zbf-reset-defaults"), () => {
      prefs.resetAllDefaults();
      syncAll();
      targetWin?.setTimeout?.(() => syncMenulistLabels(doc), 0);
      setStatusFeedback(doc, "zbf-prefs-status-reset", "✓ 已恢复全部默认设置");
    });
    bindActionBtn(doc.getElementById("zbf-btn-ws-save-session"), () => {
      const app = getApp();
      const mw = getMainWin();
      const openKeys = app?.workspace?.tabs?.openKeys?.(mw) || [];
      app?.workspace?.store?.saveSession?.(`Snapshot ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`, { openKeys });
      app?.workspace?.refreshAllWindows?.();
      setStatusFeedback(doc, "zbf-prefs-status-ws-snapshot", "✓ 已保存当前工作区快照");
    });
    bindActionBtn(doc.getElementById("zbf-btn-ws-reset-width"), () => {
      prefs.set("workspace.verticalSidebarWidth", 276);
      prefs.set("workspace.verticalSidebarCollapsed", false);
      syncAll();
      getApp()?.workspace?.refreshAllWindows?.();
      setStatusFeedback(doc, "zbf-prefs-status-saved", "✓ 设置已自动保存并实时生效");
    });
    bindActionBtn(doc.getElementById("zbf-btn-csl-refresh"), () => {
      void getApp()?.inspector?.refreshAllPreviews?.();
      setStatusFeedback(doc, "zbf-prefs-status-csl-refreshed", "✓ 已刷新侧栏 CSL 预览与协同面板");
    });
    initAnnotationColorEditor(doc, prefs, () => setStatusFeedback(doc, "zbf-prefs-status-saved", "✓ 设置已自动保存并实时生效"));
    bindActionBtn(doc.getElementById("zbf-btn-reset-ann-colors"), () => {
      prefs.set("inspector.annotations.colorLabels", "");
      prefs.set("inspector.annotations.enabledColors", "");
      syncAnnotationColorInputs(doc, "", "");
      syncAll();
      setStatusFeedback(doc, "zbf-prefs-status-saved", "✓ 设置已自动保存并实时生效");
    });
    bindActionBtn(doc.getElementById("zbf-btn-open-matrix"), () => {
      const mw = getMainWin();
      const app = getApp();
      if (!mw || !app) return;
      mw.focus?.();
      if (app.visualNotes?.openCurrentMatrix) app.visualNotes.openCurrentMatrix(mw);
      else app.workspace?.tabs?.openGroupAnnotationMatrix?.(mw);
    });
    bindActionBtn(doc.getElementById("zbf-btn-open-collection-hub"), () => {
      const mw = getMainWin();
      const app = getApp();
      if (!mw || !app) return;
      mw.focus?.();
      app.visualNotes?.openCollectionHub?.(mw);
    });
    bindActionBtn(doc.getElementById("zbf-btn-open-gallery"), () => {
      const mw = getMainWin();
      const app = getApp();
      if (!mw || !app) return;
      mw.focus?.();
      app.visualNotes?.galleryBoard?.toggleWindowGallery?.(mw);
    });
    bindActionBtn(doc.getElementById("zbf-btn-pdf-reset-zoom"), () => {
      prefs.set("inspector.pdfPreview.defaultZoom", 100);
      prefs.set("inspector.pdfPreview.mode", "section");
      syncAll();
      setStatusFeedback(doc, "zbf-prefs-status-pdf-reset", "✓ 已恢复 PDF 默认缩放与分栏高度");
    });
    bindActionBtn(doc.getElementById("zbf-btn-default-cachedir"), () => {
      prefs.set("inspector.lookup.cacheDirectory", "");
      syncAll();
      setStatusFeedback(doc, "zbf-prefs-status-saved", "✓ 设置已自动保存并实时生效");
    });
    bindActionBtn(doc.getElementById("zbf-btn-browse-cachedir"), async () => {
      try {
        const cu = targetWin?.ChromeUtils || globalThis.ChromeUtils;
        if (cu?.importESModule && targetWin) {
          const mod = cu.importESModule("chrome://zotero/content/modules/filePicker.mjs");
          const picker = new mod.FilePicker();
          picker.init(targetWin, "BridgeFlow Cache Directory", picker.modeGetFolder);
          if (await picker.show() === picker.returnOK && picker.file) {
            prefs.set("inspector.lookup.cacheDirectory", String(picker.file));
            syncAll();
            setStatusFeedback(doc, "zbf-prefs-status-saved", "✓ 设置已自动保存并实时生效");
          }
        }
      } catch {
      }
    });
    bindActionBtn(doc.getElementById("zbf-btn-word-resync"), () => {
      void getApp()?.wordCite?.resyncNow?.();
      setStatusFeedback(doc, "zbf-prefs-status-word-resynced", "✓ 已触发 Word 引用状态同步");
    });
    bindActionBtn(doc.getElementById("zbf-btn-word-refresh"), () => {
      getApp()?.kernel?.bus?.emit("word:refresh-request", { win: getMainWin() || void 0 });
      setStatusFeedback(doc, "zbf-prefs-status-word-refreshed", "✓ 已向活动 Word 文档发送刷新指令");
    });
    bindActionBtn(doc.getElementById("zbf-btn-word-purge-cols"), () => {
      void getApp()?.wordCite?.collections?.purgeStaleCollections?.();
      setStatusFeedback(doc, "zbf-prefs-status-word-purged", "✓ 已清理过期 Word 临时分类");
    });
    bindActionBtn(doc.getElementById("zbf-btn-word-clear-tags"), () => {
      void getApp()?.wordCite?.tagGovernance?.syncCitedItems?.(/* @__PURE__ */ new Set());
      setStatusFeedback(doc, "zbf-prefs-status-word-tags-cleared", "✓ 已清理全部插件托管引用标签");
    });
  }

  // src/preferences.ts
  var initializedPanes = /* @__PURE__ */ new WeakSet();
  function resolveDoc(win) {
    return win?.document || (typeof document !== "undefined" && document ? document : globalThis.document ?? null);
  }
  function resolveWin(doc, win) {
    return win || doc?.defaultView || (typeof window !== "undefined" && window ? window : globalThis.window ?? null);
  }
  function extractPrefKey(el) {
    const direct = el.getAttribute("data-zbf-pref");
    if (direct && direct in PREF_SCHEMA) return direct;
    const full = el.getAttribute("preference") || el.getAttribute("data-preference") || "";
    const shortKey = full.startsWith(PREF_PREFIX) ? full.slice(PREF_PREFIX.length) : "";
    return shortKey in PREF_SCHEMA ? shortKey : null;
  }
  async function populateCslStyles(doc, prefs) {
    const hostZotero = doc.defaultView?.Zotero || globalThis.Zotero;
    const hostStyles = hostZotero?.Styles;
    if (!hostStyles) return;
    try {
      await hostStyles.init?.();
      if (!doc.defaultView || doc.defaultView.closed) return;
      const menu = doc.getElementById("zbf-sel-csl-style");
      const popup = menu?.querySelector?.("menupopup");
      if (!menu || !popup) return;
      const createXul = (tag) => typeof doc.createXULElement === "function" ? doc.createXULElement(tag) : doc.createElement(tag);
      popup.textContent = "";
      const autoItem = createXul("menuitem");
      autoItem.setAttribute("value", "");
      autoItem.setAttribute("data-l10n-id", "zbf-opt-style-quickcopy");
      autoItem.setAttribute("label", "跟随 Zotero 快速复制（Quick Copy）默认样式");
      popup.appendChild(autoItem);
      const selectedStyle = String(prefs.get("inspector.cslPreview.citationstyle") || "");
      for (const style of hostStyles.getVisible?.() || []) {
        if (!style?.styleID) continue;
        const item = createXul("menuitem");
        item.setAttribute("value", style.styleID);
        item.setAttribute("label", style.title || style.styleID);
        popup.appendChild(item);
      }
      menu.value = selectedStyle;
      menu.setAttribute("value", selectedStyle);
      syncMenulistLabels(doc);
    } catch {
    }
  }
  var BridgeFlowPreferences = {
    init(win) {
      const doc = resolveDoc(win);
      const targetWin = resolveWin(doc, win);
      const pane = doc?.getElementById("zotero-prefpane-zotero-bridgeflow") ?? null;
      if (!doc || !pane) return false;
      if (initializedPanes.has(pane)) return true;
      initializedPanes.add(pane);
      const prefs = new UnifiedPrefService();
      prefs.seedDefaults();
      const versionEl = doc.getElementById("zbf-version-badge");
      if (versionEl) {
        versionEl.setAttribute("data-l10n-args", JSON.stringify({ version: "0.5.11" }));
        versionEl.textContent = `v${"0.5.11"}`;
      }
      const brandIcon = doc.querySelector(".zbf-brand-icon");
      const rootURI = String(doc.defaultView?.Zotero?.zoterobridgeflow?.kernel?.info?.rootURI || globalThis.Zotero?.zoterobridgeflow?.kernel?.info?.rootURI || "");
      if (brandIcon && rootURI) brandIcon.src = `${rootURI}assets/bridgeflow.svg`;
      const checkboxes = Array.from(pane.querySelectorAll("checkbox[preference]"));
      const menulists = Array.from(pane.querySelectorAll("menulist[preference]"));
      const inputs = Array.from(pane.querySelectorAll("input[data-zbf-pref]"));
      let disposed = false;
      const localObservers = [];
      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        for (const id of localObservers.splice(0)) {
          try {
            globalThis.Zotero?.Prefs?.unregisterObserver?.(id);
          } catch {
          }
        }
        prefs.dispose();
      };
      const syncAll = () => {
        if (disposed) return;
        try {
          if (!doc.defaultView || doc.defaultView.closed || !pane.isConnected) {
            cleanup();
            return;
          }
          prefs.invalidate();
          for (const cb of checkboxes) {
            const key = extractPrefKey(cb);
            if (!key) continue;
            const checked = Boolean(prefs.get(key));
            try {
              cb.checked = checked;
            } catch {
            }
            if (checked) cb.setAttribute("checked", "true");
            else cb.removeAttribute("checked");
          }
          for (const ml of menulists) {
            const key = extractPrefKey(ml);
            if (!key) continue;
            const val = String(prefs.get(key));
            try {
              ml.value = val;
            } catch {
            }
            ml.setAttribute("value", val);
          }
          for (const input of inputs) {
            const key = extractPrefKey(input);
            if (!key) continue;
            const val = prefs.get(key);
            const strVal = val == null || val === "undefined" ? String(PREF_SCHEMA[key].defaultValue) : String(val);
            input.value = strVal;
            input.setAttribute("value", strVal);
          }
          const cacheDirInput = doc.getElementById("zbf-input-cachedir");
          const defaultDir = globalThis.Zotero?.zoterobridgeflow?.services?.history?.getDirectoryPath?.() || "";
          if (cacheDirInput && defaultDir) cacheDirInput.placeholder = defaultDir;
          const heatColorHex = doc.getElementById("zbf-heatmap-color-hex");
          if (heatColorHex) heatColorHex.textContent = String(prefs.get("workspace.readingHeatmap.color") || "#0d9488");
          const heatRange = doc.getElementById("zbf-range-heatmap-opacity");
          if (heatRange) {
            const op = String(prefs.get("workspace.readingHeatmap.opacity") || 42);
            heatRange.value = op;
            heatRange.setAttribute("value", op);
          }
          syncAnnotationColorInputs(
            doc,
            String(prefs.get("inspector.annotations.colorLabels") || ""),
            String(prefs.get("inspector.annotations.enabledColors") || "")
          );
          updatePreferenceDependencies(doc, prefs);
        } catch {
          cleanup();
        }
      };
      for (const cb of checkboxes) {
        const key = extractPrefKey(cb);
        if (!key) continue;
        cb.addEventListener("command", () => {
          const next = Boolean(cb.checked ?? cb.hasAttribute("checked"));
          prefs.set(key, next);
          updatePreferenceDependencies(doc, prefs);
          setStatusFeedback(doc, "zbf-prefs-status-saved", "✓ 设置已自动保存并实时生效");
        });
      }
      for (const ml of menulists) {
        const key = extractPrefKey(ml);
        if (!key) continue;
        const onSelect = () => {
          const hostMl = ml;
          const val = String(hostMl.selectedItem?.getAttribute?.("value") ?? hostMl.value ?? "");
          prefs.set(key, val);
          updatePreferenceDependencies(doc, prefs);
          setStatusFeedback(doc, "zbf-prefs-status-saved", "✓ 设置已自动保存并实时生效");
        };
        ml.addEventListener("command", onSelect);
        ml.addEventListener("change", onSelect);
      }
      for (const input of inputs) {
        const key = extractPrefKey(input);
        if (!key) continue;
        const commitInput = () => {
          const raw = input.type === "number" ? Number(input.value) : input.value.trim();
          input.value = String(prefs.set(key, raw));
          updatePreferenceDependencies(doc, prefs);
          setStatusFeedback(doc, "zbf-prefs-status-saved", "✓ 设置已自动保存并实时生效");
        };
        if (key === "workspace.readingHeatmap.color") {
          input.addEventListener("input", () => {
            const val = input.value.trim();
            prefs.set(key, val);
            const hexEl = doc.getElementById("zbf-heatmap-color-hex");
            if (hexEl) hexEl.textContent = val;
            setStatusFeedback(doc, "zbf-prefs-status-saved", "✓ 设置已自动保存并实时生效");
          });
        } else if (key === "workspace.readingHeatmap.opacity") {
          input.addEventListener("input", () => {
            const range = doc.getElementById("zbf-range-heatmap-opacity");
            const n = Number(input.value);
            if (Number.isFinite(n) && range) range.value = String(n);
          });
        }
        input.addEventListener("change", commitInput);
        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") commitInput();
        });
      }
      const heatOpacityRange = doc.getElementById("zbf-range-heatmap-opacity");
      const heatOpacityNum = doc.getElementById("zbf-num-heatmap-opacity");
      if (heatOpacityRange) {
        const syncRange = () => {
          const next = String(prefs.set("workspace.readingHeatmap.opacity", Number(heatOpacityRange.value)));
          if (heatOpacityNum) {
            heatOpacityNum.value = next;
            heatOpacityNum.setAttribute("value", next);
          }
          setStatusFeedback(doc, "zbf-prefs-status-saved", "✓ 设置已自动保存并实时生效");
        };
        heatOpacityRange.addEventListener("input", syncRange);
        heatOpacityRange.addEventListener("change", syncRange);
      }
      bindPreferenceActions(doc, targetWin, prefs, syncAll);
      syncAnnotationColorInputs(
        doc,
        String(prefs.get("inspector.annotations.colorLabels") || ""),
        String(prefs.get("inspector.annotations.enabledColors") || "")
      );
      let stylesRequested = false;
      const ensureStyles = () => {
        if (stylesRequested) return;
        stylesRequested = true;
        void populateCslStyles(doc, prefs);
      };
      const tabs = Array.from(pane.querySelectorAll('[role="tab"]'));
      const panels = Array.from(pane.querySelectorAll('[role="tabpanel"]'));
      const selectTab = (tabId, focusTab = false) => {
        for (const tab of tabs) {
          const active = tab.getAttribute("data-zbf-tab") === tabId;
          tab.setAttribute("aria-selected", String(active));
          tab.tabIndex = active ? 0 : -1;
          tab.classList.toggle("is-active", active);
          if (active && focusTab) tab.focus();
        }
        for (const panel of panels) {
          panel.hidden = panel.getAttribute("data-zbf-panel") !== tabId;
        }
        if (tabId === "inspector") ensureStyles();
      };
      tabs.forEach((tab, idx) => {
        tab.addEventListener("click", () => selectTab(tab.getAttribute("data-zbf-tab") || "overview"));
        tab.addEventListener("keydown", (ev) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(ev.key)) return;
          ev.preventDefault();
          const next = ev.key === "Home" ? 0 : ev.key === "End" ? tabs.length - 1 : (idx + (ev.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
          selectTab(tabs[next]?.getAttribute("data-zbf-tab") || "overview", true);
        });
      });
      pane.querySelectorAll("[data-zbf-jump]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const target = btn.getAttribute("data-zbf-jump");
          if (target) selectTab(target);
        });
      });
      pane.querySelectorAll("[data-zbf-enable-mod]").forEach((btn) => {
        const modKey = btn.getAttribute("data-zbf-enable-mod");
        if (!modKey || !(modKey in PREF_SCHEMA)) return;
        const enableMod = () => {
          prefs.set(modKey, true);
          syncAll();
          setStatusFeedback(doc, "zbf-prefs-status-saved", "✓ 设置已自动保存并实时生效");
        };
        btn.addEventListener("command", enableMod);
        btn.addEventListener("click", enableMod);
      });
      doc.l10n?.ready?.then?.(() => {
        if (!disposed) syncMenulistLabels(doc);
      });
      if (globalThis.Zotero?.Prefs?.registerObserver) {
        const keys = Object.keys(PREF_SCHEMA).filter((k) => k !== "workspace.document");
        for (const k of keys) {
          localObservers.push(globalThis.Zotero.Prefs.registerObserver(PREF_PREFIX + k, () => syncAll(), true));
        }
        targetWin?.addEventListener?.("pagehide", cleanup, { once: true });
        targetWin?.addEventListener?.("unload", cleanup, { once: true });
      }
      syncAll();
      targetWin?.setTimeout?.(() => {
        if (!disposed) syncAll();
      }, 30);
      targetWin?.setTimeout?.(() => {
        if (!disposed) syncAll();
      }, 150);
      return true;
    }
  };
  globalThis.BridgeFlowPreferences = BridgeFlowPreferences;
  (() => {
    const doc = resolveDoc();
    const win = resolveWin(doc);
    if (!doc) return;
    doc.addEventListener("load", (ev) => {
      const target = ev.target;
      if (!target || target.id === "zotero-prefpane-zotero-bridgeflow" || doc.getElementById("zotero-prefpane-zotero-bridgeflow")) {
        BridgeFlowPreferences.init(win || void 0);
      }
    }, true);
    if (!BridgeFlowPreferences.init(win || void 0)) {
      const Obs = win?.MutationObserver || globalThis.MutationObserver;
      if (Obs && doc.documentElement) {
        const mo = new Obs(() => {
          if (BridgeFlowPreferences.init(win || void 0)) mo.disconnect();
        });
        mo.observe(doc.documentElement, { childList: true, subtree: true });
        win?.addEventListener?.("unload", () => mo.disconnect(), { once: true });
      }
    }
  })();
})();
