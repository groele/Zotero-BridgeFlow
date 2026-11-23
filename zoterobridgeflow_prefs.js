/* Zotero BridgeFlow v0.2.1 - Preferences controller. */
"use strict";
(() => {
  // src/kernel/pref-schema.ts
  var PREF_PREFIX = "extensions.zotero.bridgeflow.";
  var PREF_SCHEMA = {
    // === Core Module & Fusion Master Switches ===
    "modules.workspace.enable": { defaultValue: true },
    "modules.inspector.enable": { defaultValue: true },
    "modules.wordCite.enable": { defaultValue: true },
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
    const vSideOn = wsOn && Boolean(prefs.get("workspace.enableVerticalSidebar"));
    setSubtreeDisabled(doc.getElementById("zbf-group-workspace"), !wsOn);
    setSubtreeDisabled(doc.getElementById("zbf-group-sidebar"), !wsOn);
    setSubtreeDisabled(doc.getElementById("zbf-group-inspector"), !insOn);
    setSubtreeDisabled(doc.getElementById("zbf-group-pdf"), !insOn);
    setSubtreeDisabled(doc.getElementById("zbf-group-wordcite"), !wcOn);
    setSubtreeDisabled(doc.getElementById("zbf-sub-hcompact"), !wsOn || !prefs.get("workspace.enableHorizontalGroups"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-compactTop"), !vSideOn || !prefs.get("workspace.enableHorizontalGroups"));
    setSubtreeDisabled(doc.getElementById("zbf-sub-vsidebar-cfg"), !vSideOn);
    setSubtreeDisabled(doc.getElementById("zbf-sub-vsidebar-typo"), !vSideOn);
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
      prefs.set("workspace.document", "");
      const app = getApp();
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
    bindActionBtn(doc.getElementById("zbf-btn-ws-open-spotlight"), () => {
      getApp()?.kernel?.bus?.emit("inspector:lookup-clipboard", { win: getMainWin() || void 0 });
      setStatusFeedback(doc, "zbf-prefs-status-spotlight", "✓ 已在主窗口唤起 Spotlight 面板");
    });
    bindActionBtn(doc.getElementById("zbf-btn-csl-refresh"), () => {
      void getApp()?.inspector?.refreshAllPreviews?.();
      setStatusFeedback(doc, "zbf-prefs-status-csl-refreshed", "✓ 已刷新侧栏 CSL 预览与协同面板");
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
        versionEl.setAttribute("data-l10n-args", JSON.stringify({ version: "0.2.1" }));
        versionEl.textContent = `v${"0.2.1"}`;
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
            if (!key) continue;
            const val = prefs.get(key);
            const strVal = val == null || val === "undefined" ? String(PREF_SCHEMA[key].defaultValue) : String(val);
            input.value = strVal;
            input.setAttribute("value", strVal);
          }
          const cacheDirInput = doc.getElementById("zbf-input-cachedir");
          const defaultDir = globalThis.Zotero?.zoterobridgeflow?.services?.history?.getDirectoryPath?.() || "";
          if (cacheDirInput && defaultDir) cacheDirInput.placeholder = defaultDir;
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
        input.addEventListener("change", commitInput);
        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") commitInput();
        });
      }
      bindPreferenceActions(doc, targetWin, prefs, syncAll);
      void populateCslStyles(doc, prefs);
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
