/* Zotero BridgeFlow v0.0.12 - Preferences controller. */
"use strict";
(() => {
  // src/kernel/pref-schema.ts
  var PREF_PREFIX = "extensions.zotero.bridgeflow.";
  var PREF_SCHEMA = {
    // === Core Module & Fusion Master Switches ===
    "modules.workspace.enable": { defaultValue: true },
    "modules.inspector.enable": { defaultValue: true },
    "modules.wordCite.enable": { defaultValue: true, legacyKeys: ["extensions.zotero.zoterocitation.enable"] },
    "fusion.copyToLookupHistory": { defaultValue: true },
    "fusion.sidebarCiteBadge": { defaultValue: true },
    "fusion.spotlightCrossDomain": { defaultValue: true },
    "fusion.lookupJumpExistingTab": { defaultValue: true },
    "debug": {
      defaultValue: false,
      legacyKeys: [
        "extensions.zotero.tabflow.debug",
        "extensions.zoteropreview.debug",
        "extensions.zotero.zoterocitation.debug"
      ]
    },
    "migrationVersion": { defaultValue: 0, resettable: false },
    // === Domain A: Workspace (Tabs, Groups, Sessions, Sleep, Spotlight) ===
    "workspace.enableHorizontalGroups": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.enableHorizontalGroups"] },
    "workspace.horizontalTabCompactMode": {
      defaultValue: "auto",
      enumValues: ["auto", "compact", "normal"],
      legacyKeys: ["extensions.zotero.tabflow.horizontalTabCompactMode"]
    },
    "workspace.compactTopBar": { defaultValue: false, legacyKeys: ["extensions.zotero.tabflow.compactTopBar"] },
    "workspace.enableVerticalSidebar": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.enableVerticalSidebar"] },
    "workspace.enableBatchSelection": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.enableBatchSelection"] },
    "workspace.enablePinnedTabs": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.enablePinnedTabs"] },
    "workspace.pinnedIconOnly": { defaultValue: false, legacyKeys: ["extensions.zotero.tabflow.pinnedIconOnly"] },
    "workspace.enableVirtualMembers": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.enableVirtualMembers"] },
    "workspace.newTabMode": {
      defaultValue: "independent",
      enumValues: ["independent", "collection"],
      legacyKeys: ["extensions.zotero.tabflow.newTabMode"]
    },
    "workspace.multiCollectionStrategy": {
      defaultValue: "active",
      enumValues: ["active", "existing", "first"],
      legacyKeys: ["extensions.zotero.tabflow.multiCollectionStrategy"]
    },
    "workspace.enableTabRemarks": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.enableTabRemarks"] },
    "workspace.remarkDisplayMode": {
      defaultValue: "both",
      enumValues: ["both", "remark", "title"],
      legacyKeys: ["extensions.zotero.tabflow.remarkDisplayMode"]
    },
    "workspace.verticalTabTitleMode": {
      defaultValue: "title",
      enumValues: ["title", "shortTitle", "filename"],
      legacyKeys: ["extensions.zotero.tabflow.verticalTabTitleMode"]
    },
    "workspace.verticalTabSubtitleMode": {
      defaultValue: "source",
      enumValues: ["source", "creatorYear", "collection", "lastViewed", "none"],
      legacyKeys: ["extensions.zotero.tabflow.verticalTabSubtitleMode"]
    },
    "workspace.verticalTabRowHeight": { defaultValue: 42, min: 28, max: 72, legacyKeys: ["extensions.zotero.tabflow.verticalTabRowHeight"] },
    "workspace.verticalTabFontSize": { defaultValue: 13, min: 11, max: 18, legacyKeys: ["extensions.zotero.tabflow.verticalTabFontSize"] },
    "workspace.verticalSidebarWidth": { defaultValue: 276, min: 200, max: 440, legacyKeys: ["extensions.zotero.tabflow.verticalSidebarWidth"] },
    "workspace.verticalSidebarCollapsed": { defaultValue: false, legacyKeys: ["extensions.zotero.tabflow.verticalSidebarCollapsed"] },
    "workspace.enableHoverPreview": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.enableHoverPreview"] },
    "workspace.enableSpotlight": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.enableSpotlight"] },
    "workspace.enableSessions": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.enableSessions"] },
    "workspace.enableRollingSnapshots": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.enableRollingSnapshots"] },
    "workspace.enableTabSleep": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.enableTabSleep"] },
    "workspace.autoSleepMinutes": { defaultValue: 0, min: 0, max: 1440, legacyKeys: ["extensions.zotero.tabflow.autoSleepMinutes"] },
    "workspace.activeReaderBudget": { defaultValue: 0, min: 0, max: 100, legacyKeys: ["extensions.zotero.tabflow.activeReaderBudget"] },
    "workspace.enableStaleSuggestions": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.enableStaleSuggestions"] },
    "workspace.staleSuggestDays": { defaultValue: 7, min: 1, max: 3650, legacyKeys: ["extensions.zotero.tabflow.staleSuggestDays"] },
    "workspace.enableTabContextMenu": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.enableTabContextMenu"] },
    "workspace.enableItemContextMenu": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.enableItemContextMenu"] },
    "workspace.enableCopyReference": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.enableCopyReference"] },
    "workspace.enableShowInFilesystem": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.enableShowInFilesystem"] },
    "workspace.enableReloadTab": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.enableReloadTab"] },
    "workspace.state": { defaultValue: "", resettable: false, legacyKeys: ["extensions.zotero.tabflow.state"] },
    // === Domain B: Inspector (CSL Preview, Citation Lookup, PDF Preview & Folder) ===
    "inspector.cslPreview.enable": { defaultValue: true },
    "inspector.cslPreview.citationstyle": { defaultValue: "", legacyKeys: ["extensions.zoteropreview.citationstyle"] },
    "inspector.cslPreview.position": {
      defaultValue: "zotero-item-pane-header",
      enumValues: ["zotero-item-pane-header", "zotero-editpane-item-box", "zotero-editpane-related"],
      legacyKeys: ["extensions.zoteropreview.position"]
    },
    "inspector.cslPreview.whatToShow": {
      defaultValue: "zpboth",
      enumValues: ["zpboth", "zpcite", "zpbib"],
      legacyKeys: ["extensions.zoteropreview.whatToShow"]
    },
    "inspector.cslPreview.fontsize": { defaultValue: "1", legacyKeys: ["extensions.zoteropreview.fontsize"] },
    "inspector.cslPreview.spacing": { defaultValue: "1.5", legacyKeys: ["extensions.zoteropreview.spacing"] },
    "inspector.cslPreview.maxPreviewItems": { defaultValue: 100, min: 1, max: 500, legacyKeys: ["extensions.zoteropreview.maxPreviewItems"] },
    "inspector.lookup.enable": { defaultValue: true, legacyKeys: ["extensions.zoteropreview.lookupEnabled"] },
    "inspector.lookup.historyEnable": { defaultValue: true, legacyKeys: ["extensions.zoteropreview.lookupHistoryEnabled"] },
    "inspector.lookup.cacheDirectory": { defaultValue: "", legacyKeys: ["extensions.zoteropreview.cacheDirectory"] },
    "inspector.lookup.cacheMaxEntries": { defaultValue: 2e3, min: 100, max: 1e5, legacyKeys: ["extensions.zoteropreview.cacheMaxEntries"] },
    "inspector.lookup.cacheTtlDays": { defaultValue: 90, min: 7, max: 3650, legacyKeys: ["extensions.zoteropreview.cacheTtlDays"] },
    "inspector.pdfPreview.enable": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.enablePdfPreviewSidenav"] },
    "inspector.pdfPreview.position": {
      defaultValue: "zotero-editpane-related",
      enumValues: ["zotero-item-pane-header", "zotero-editpane-item-box", "zotero-editpane-related"]
    },
    "inspector.pdfPreview.mode": {
      defaultValue: "section",
      enumValues: ["section", "full"],
      legacyKeys: ["extensions.zotero.tabflow.pdfPreviewMode"]
    },
    "inspector.pdfPreview.defaultZoom": { defaultValue: 100, min: 60, max: 200, legacyKeys: ["extensions.zotero.tabflow.pdfPreviewDefaultZoom"] },
    "inspector.pdfPreview.doubleClickOpen": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.pdfPreviewDoubleClickOpen"] },
    "inspector.pdfPreview.showPageBadge": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.pdfPreviewShowPageBadge"] },
    "inspector.pdfFolder.enable": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.enablePdfFolderSidenav"] },
    "inspector.pdfFolder.position": {
      defaultValue: "zotero-editpane-related",
      enumValues: ["zotero-item-pane-header", "zotero-editpane-item-box", "zotero-editpane-related"]
    },
    "inspector.pdfFolder.openMode": {
      defaultValue: "reveal",
      enumValues: ["reveal", "folder"],
      legacyKeys: ["extensions.zotero.tabflow.pdfFolderOpenMode"]
    },
    // === Domain C: Word Citation Tracking & Governance ===
    "wordCite.dragCite.enable": { defaultValue: true, legacyKeys: ["extensions.zotero.zoterocitation.dragCite.enable"] },
    "wordCite.collections.enable": { defaultValue: true, legacyKeys: ["extensions.zotero.zoterocitation.collections.enable"] },
    "wordCite.citationTags.enable": { defaultValue: true, legacyKeys: ["extensions.zotero.zoterocitation.citationTags.enable"] },
    "wordCite.citationTags.text": { defaultValue: "/Citations", legacyKeys: ["extensions.zotero.zoterocitation.citationTags.text"] },
    "wordCite.citationTagDebounceMs": { defaultValue: 150, min: 0, max: 2e3, legacyKeys: ["extensions.zotero.zoterocitation.citationTagDebounceMs"] },
    "wordCite.itemsViewRefreshDebounceMs": { defaultValue: 120, min: 0, max: 2e3, legacyKeys: ["extensions.zotero.zoterocitation.itemsViewRefreshDebounceMs"] },
    "wordCite.healthWindowMs": { defaultValue: 3e5, min: 1e4, max: 36e5, legacyKeys: ["extensions.zotero.zoterocitation.healthWindowMs"] },
    "wordCite.perfSlowThresholdMs": { defaultValue: 50, min: 5, max: 5e3, legacyKeys: ["extensions.zotero.zoterocitation.perfSlowThresholdMs"] }
  };

  // src/kernel/pref-service.ts
  function resolveDefaultAdapter() {
    const host = globalThis.Zotero?.Prefs;
    return host && typeof host.get === "function" ? host : null;
  }
  function normalizePrefValue(key, raw) {
    const desc = PREF_SCHEMA[key];
    const def = desc.defaultValue;
    if (raw === void 0 || raw === null) return def;
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
        if (existing === void 0) {
          const desc = PREF_SCHEMA[key];
          try {
            adapter.set(full, desc.defaultValue, true);
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
  function updateDependencies(doc, prefs) {
    prefs.invalidate();
    const wsOn = Boolean(prefs.get("modules.workspace.enable"));
    const insOn = Boolean(prefs.get("modules.inspector.enable"));
    const wcOn = Boolean(prefs.get("modules.wordCite.enable"));
    setSubtreeDisabled(doc.getElementById("zbf-group-workspace"), !wsOn);
    setSubtreeDisabled(doc.getElementById("zbf-group-sidebar"), !wsOn);
    setSubtreeDisabled(doc.getElementById("zbf-group-inspector"), !insOn);
    setSubtreeDisabled(doc.getElementById("zbf-group-pdf"), !insOn);
    setSubtreeDisabled(doc.getElementById("zbf-group-wordcite"), !wcOn);
    setSubtreeDisabled(doc.getElementById("zbf-sub-hcompact"), !wsOn || !prefs.get("workspace.enableHorizontalGroups"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-compactTop"), !wsOn || !prefs.get("workspace.enableHorizontalGroups") || !prefs.get("workspace.enableVerticalSidebar"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-batch"), !wsOn || !prefs.get("workspace.enableVerticalSidebar"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-pinnedIcon"), !wsOn || !prefs.get("workspace.enablePinnedTabs"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-multicol"), !wsOn || prefs.get("workspace.newTabMode") !== "collection");
    setSubtreeDisabled(doc.getElementById("zbf-sub-rolling"), !wsOn || !prefs.get("workspace.enableSessions"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-sleep-cfg"), !wsOn || !prefs.get("workspace.enableTabSleep"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-stale-days"), !wsOn || !prefs.get("workspace.enableStaleSuggestions"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-remark-mode"), !wsOn || !prefs.get("workspace.enableTabRemarks"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-tabmenu"), !wsOn || !prefs.get("workspace.enableTabContextMenu"));
    const cslOn = insOn && Boolean(prefs.get("inspector.cslPreview.enable"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-csl"), !cslOn);
    setSubtreeDisabled(doc.getElementById("zbf-sub-csl-layout"), !cslOn);
    const lookupOn = insOn && Boolean(prefs.get("inspector.lookup.enable"));
    const historyOn = lookupOn && Boolean(prefs.get("inspector.lookup.historyEnable"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-lookup-history"), !lookupOn);
    setSubtreeDisabled(doc.getElementById("zbf-sub-lookup-quota"), !historyOn);
    setSubtreeDisabled(doc.getElementById("zbf-sub-pdf-preview"), !insOn || !prefs.get("inspector.pdfPreview.enable"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-pdf-folder"), !insOn || !prefs.get("inspector.pdfFolder.enable"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-wc-tag-text"), !wcOn || !prefs.get("wordCite.citationTags.enable"));
    syncMenulistLabels(doc);
  }
  function setStatusFeedback(doc, l10nId, fallbackText) {
    const statusEl = doc.getElementById("zbf-prefs-status");
    if (!statusEl) return;
    statusEl.setAttribute("data-l10n-id", l10nId);
    statusEl.textContent = fallbackText;
  }
  function bindTabs(pane) {
    const tabBtns = Array.from(pane.querySelectorAll(".zbf-tab-btn"));
    const panels = Array.from(pane.querySelectorAll(".zbf-tabpanel"));
    const activate = (tabID) => {
      for (const btn of tabBtns) {
        const match = btn.getAttribute("data-zbf-tab") === tabID;
        btn.classList.toggle("active", match);
        btn.setAttribute("aria-selected", String(match));
      }
      for (const panel of panels) {
        const match = panel.getAttribute("data-zbf-panel") === tabID;
        panel.hidden = !match;
        if (match) panel.removeAttribute("hidden");
        else panel.setAttribute("hidden", "hidden");
      }
    };
    tabBtns.forEach((btn, idx) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        const id = btn.getAttribute("data-zbf-tab");
        if (id) activate(id);
      });
      btn.addEventListener("keydown", (ev) => {
        if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
        ev.preventDefault();
        const nextBtn = tabBtns[(idx + (ev.key === "ArrowRight" ? 1 : tabBtns.length - 1)) % tabBtns.length];
        nextBtn?.focus?.();
        const id = nextBtn?.getAttribute("data-zbf-tab");
        if (id) activate(id);
      });
    });
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
      bindTabs(pane);
      const versionEl = doc.getElementById("zbf-version-badge");
      if (versionEl) {
        versionEl.setAttribute("data-l10n-args", JSON.stringify({ version: "0.0.12" }));
        versionEl.textContent = `v${"0.0.12"}`;
      }
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
            if (key) input.value = String(prefs.get(key));
          }
          const cacheDirInput = doc.getElementById("zbf-input-cachedir");
          const defaultDir = globalThis.Zotero?.zoterobridgeflow?.services?.history?.getDirectoryPath?.() || "";
          if (cacheDirInput && defaultDir) cacheDirInput.placeholder = defaultDir;
          updateDependencies(doc, prefs);
        } catch {
          cleanup();
        }
      };
      for (const cb of checkboxes) {
        const key = extractPrefKey(cb);
        if (!key) continue;
        const onToggle = () => {
          const next = Boolean(cb.checked ?? cb.hasAttribute("checked"));
          prefs.set(key, next);
          updateDependencies(doc, prefs);
          setStatusFeedback(doc, "zbf-prefs-status-saved", "✓ 设置已自动保存并实时生效");
        };
        cb.addEventListener("command", onToggle);
      }
      for (const ml of menulists) {
        const key = extractPrefKey(ml);
        if (!key) continue;
        const onSelect = () => {
          const hostMl = ml;
          const val = String(hostMl.selectedItem?.getAttribute?.("value") ?? hostMl.value ?? "");
          prefs.set(key, val);
          updateDependencies(doc, prefs);
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
          const next = prefs.set(key, raw);
          input.value = String(next);
          updateDependencies(doc, prefs);
          setStatusFeedback(doc, "zbf-prefs-status-saved", "✓ 设置已自动保存并实时生效");
        };
        input.addEventListener("change", commitInput);
        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") commitInput();
        });
      }
      bindActionBtn(doc.getElementById("zbf-clear-cache"), () => {
        const app = globalThis.Zotero?.zoterobridgeflow;
        app?.kernel?.bus?.emit("inspector:clear-cache", { target: "all" });
        setStatusFeedback(doc, "zbf-prefs-status-cache-cleared", "✓ 已清空全部引文与反查缓存");
      });
      bindActionBtn(doc.getElementById("zbf-clear-workspace-state"), () => {
        prefs.set("workspace.state", "");
        const app = globalThis.Zotero?.zoterobridgeflow;
        app?.workspace?.store?.load?.();
        app?.workspace?.refreshAllWindows?.();
        setStatusFeedback(doc, "zbf-prefs-status-ws-cleared", "✓ 已清除工作区分组与会话数据");
      });
      bindActionBtn(doc.getElementById("zbf-reset-defaults"), () => {
        prefs.resetAllDefaults();
        syncAll();
        targetWin?.setTimeout?.(() => syncMenulistLabels(doc), 0);
        setStatusFeedback(doc, "zbf-prefs-status-reset", "✓ 已恢复全部默认设置");
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
      void populateCslStyles(doc, prefs);
      doc.l10n?.ready?.then?.(() => {
        if (!disposed) syncMenulistLabels(doc);
      });
      if (globalThis.Zotero?.Prefs?.registerObserver) {
        const keys = Object.keys(PREF_SCHEMA).filter((k) => k !== "workspace.state" && k !== "migrationVersion");
        for (const k of keys) {
          localObservers.push(globalThis.Zotero.Prefs.registerObserver(PREF_PREFIX + k, () => syncAll(), true));
        }
        targetWin?.addEventListener?.("pagehide", cleanup, { once: true });
        targetWin?.addEventListener?.("unload", cleanup, { once: true });
      }
      syncAll();
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
