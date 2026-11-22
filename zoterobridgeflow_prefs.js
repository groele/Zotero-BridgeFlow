/* Zotero BridgeFlow v0.0.3 - Preferences controller. */
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
      enumValues: ["source", "creatorYear", "collection", "none"],
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
  function setSubtreeDisabled(el, disabled) {
    if (!el) return;
    el.setAttribute("data-disabled", disabled ? "true" : "false");
    el.querySelectorAll("checkbox, menulist, input, button").forEach((ctrl) => {
      if (disabled) ctrl.setAttribute("disabled", "true");
      else ctrl.removeAttribute("disabled");
    });
  }
  function syncMenulistLabels(doc) {
    doc.querySelectorAll("#zotero-prefpane-zotero-bridgeflow menulist").forEach((ml) => {
      const selected = ml.selectedItem;
      const lbl = selected?.getAttribute?.("label");
      if (lbl) ml.setAttribute("label", lbl);
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
    setSubtreeDisabled(doc.getElementById("zbf-sub-lookup-history"), !lookupOn);
    setSubtreeDisabled(doc.getElementById("zbf-sub-lookup-quota"), !lookupOn);
    setSubtreeDisabled(doc.getElementById("zbf-sub-pdf-preview"), !insOn || !prefs.get("inspector.pdfPreview.enable"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-pdf-folder"), !insOn || !prefs.get("inspector.pdfFolder.enable"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-wc-tag-text"), !wcOn || !prefs.get("wordCite.citationTags.enable"));
    syncMenulistLabels(doc);
  }
  function bindTabs(doc) {
    const tabBtns = Array.from(doc.querySelectorAll(".zbf-tab-btn"));
    const panels = Array.from(doc.querySelectorAll(".zbf-tabpanel"));
    const activate = (tabID) => {
      for (const btn of tabBtns) {
        const match = btn.getAttribute("data-zbf-tab") === tabID;
        btn.classList.toggle("active", match);
        btn.setAttribute("aria-selected", String(match));
      }
      for (const panel of panels) {
        panel.hidden = panel.getAttribute("data-zbf-panel") !== tabID;
      }
    };
    for (const btn of tabBtns) {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-zbf-tab");
        if (id) activate(id);
      });
    }
  }
  var BridgeFlowPreferences = {
    observerIDs: [],
    init(win) {
      const doc = win?.document || globalThis.document;
      if (!doc) return;
      const pane = doc.getElementById("zotero-prefpane-zotero-bridgeflow");
      if (!pane) return;
      bindTabs(doc);
      const prefs = new UnifiedPrefService();
      const versionEl = doc.getElementById("zbf-version-badge");
      if (versionEl) {
        versionEl.setAttribute("data-l10n-args", JSON.stringify({ version: "0.0.3" }));
        versionEl.textContent = `v${"0.0.3"}`;
      }
      const inputs = Array.from(pane.querySelectorAll("[data-zbf-pref]"));
      const syncAll = () => {
        prefs.invalidate();
        for (const input of inputs) {
          const key = input.getAttribute("data-zbf-pref");
          if (key && key in PREF_SCHEMA) {
            input.value = String(prefs.get(key));
          }
        }
        updateDependencies(doc, prefs);
      };
      for (const input of inputs) {
        const key = input.getAttribute("data-zbf-pref");
        if (!key || !(key in PREF_SCHEMA)) continue;
        input.addEventListener("change", () => {
          const raw = input.type === "number" ? Number(input.value) : input.value;
          const next = prefs.set(key, raw);
          input.value = String(next);
          updateDependencies(doc, prefs);
        });
      }
      pane.addEventListener("command", () => updateDependencies(doc, prefs));
      pane.addEventListener("change", () => updateDependencies(doc, prefs));
      doc.getElementById("zbf-reset-defaults")?.addEventListener("command", () => {
        prefs.resetAllDefaults();
        syncAll();
        (win || globalThis.window)?.setTimeout?.(() => syncMenulistLabels(doc), 0);
      });
      doc.getElementById("zbf-clear-cache")?.addEventListener("command", () => {
        const app = globalThis.Zotero?.zoterobridgeflow;
        app?.kernel?.bus?.emit("inspector:clear-cache", { target: "all" });
      });
      doc.l10n?.ready?.then?.(() => syncMenulistLabels(doc));
      if (!this.observerIDs.length && globalThis.Zotero?.Prefs?.registerObserver) {
        const keys = Object.keys(PREF_SCHEMA);
        this.observerIDs = keys.map(
          (k) => globalThis.Zotero.Prefs.registerObserver(PREF_PREFIX + k, () => syncAll(), true)
        );
        (win || globalThis.window)?.addEventListener?.("unload", () => {
          for (const id of this.observerIDs) {
            try {
              globalThis.Zotero.Prefs.unregisterObserver(id);
            } catch {
            }
          }
          this.observerIDs = [];
          prefs.dispose();
        }, { once: true });
      }
      syncAll();
    }
  };
  globalThis.BridgeFlowPreferences = BridgeFlowPreferences;
  if (typeof globalThis.document !== "undefined") {
    const d = globalThis.document;
    if (d.readyState === "loading") {
      d.addEventListener("DOMContentLoaded", () => BridgeFlowPreferences.init(), { once: true });
    } else {
      BridgeFlowPreferences.init();
    }
  }
})();
