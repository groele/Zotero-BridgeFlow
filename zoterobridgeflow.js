/* Zotero BridgeFlow v0.0.3 - Unified Reading Workspace, Inspector & Word Citation Tracking for Zotero 10-12. */
"use strict";
(() => {
  // src/kernel/disposable.ts
  var DisposableStack = class {
    items = [];
    disposed = false;
    add(disposer) {
      if (!disposer) return () => {
      };
      if (this.disposed) {
        try {
          disposer();
        } catch {
        }
        return () => {
        };
      }
      let active = true;
      const wrapped = () => {
        if (!active) return;
        active = false;
        const idx = this.items.indexOf(wrapped);
        if (idx >= 0) this.items.splice(idx, 1);
        disposer();
      };
      this.items.push(wrapped);
      return wrapped;
    }
    get size() {
      return this.items.length;
    }
    disposeAll(onError) {
      if (this.disposed) return;
      this.disposed = true;
      while (this.items.length > 0) {
        const fn = this.items.pop();
        if (!fn) continue;
        try {
          fn();
        } catch (error) {
          onError?.(error);
        }
      }
    }
    reset() {
      this.disposeAll();
      this.disposed = false;
    }
  };

  // src/bridges/cite-badge-bridge.ts
  var CiteBadgeBridge = class {
    id = "cite-badge-bridge";
    disposables = new DisposableStack();
    lastSnapshot = null;
    kernel;
    workspace;
    constructor(kernel, workspace) {
      this.kernel = kernel;
      this.workspace = workspace;
    }
    start() {
      this.disposables.reset();
      this.disposables.add(
        this.kernel.bus.on("citation:snapshot-updated", (snapshot) => {
          this.lastSnapshot = snapshot;
          this.pushBadges();
        })
      );
      this.disposables.add(
        this.kernel.prefs.observeKeys(["fusion.sidebarCiteBadge"], () => this.pushBadges())
      );
    }
    stop() {
      this.disposables.disposeAll();
      this.workspace.setCitationBadges(/* @__PURE__ */ new Map());
      this.lastSnapshot = null;
    }
    pushBadges() {
      if (!this.kernel.prefs.get("fusion.sidebarCiteBadge") || !this.lastSnapshot) {
        this.workspace.setCitationBadges(/* @__PURE__ */ new Map());
        return;
      }
      this.workspace.setCitationBadges(this.lastSnapshot.byItemID);
    }
  };

  // src/bridges/copy-history-bridge.ts
  var CopyHistoryBridge = class {
    id = "copy-history-bridge";
    disposables = new DisposableStack();
    kernel;
    services;
    constructor(kernel, services) {
      this.kernel = kernel;
      this.services = services;
    }
    start() {
      this.disposables.reset();
      this.disposables.add(
        this.kernel.bus.on("citation:copied", (ev) => {
          if (!this.kernel.prefs.get("fusion.copyToLookupHistory")) return;
          if (!this.kernel.prefs.get("inspector.lookup.historyEnable")) return;
          if (!ev.text || ev.itemIDs.length !== 1) return;
          const itemID = ev.itemIDs[0];
          const item = globalThis.Zotero?.Items?.get?.(itemID);
          this.services.history.record({
            text: ev.text,
            libraryID: Number(item?.libraryID || 1),
            itemKey: String(item?.key || ""),
            itemID,
            title: String(item?.getField?.("title") || item?.title || ev.text.slice(0, 80)),
            style: ev.styleID
          });
        })
      );
    }
    stop() {
      this.disposables.disposeAll();
    }
  };

  // src/bridges/lookup-workspace-bridge.ts
  var LookupWorkspaceBridge = class {
    id = "lookup-workspace-bridge";
    disposables = new DisposableStack();
    kernel;
    workspace;
    constructor(kernel, workspace) {
      this.kernel = kernel;
      this.workspace = workspace;
    }
    start() {
      this.disposables.reset();
      this.disposables.add(
        this.kernel.bus.on("workspace:open-item-request", async (req) => {
          if (!this.workspace.isActive()) return;
          await this.workspace.focusOrOpenItem({
            ...req,
            preferExistingTab: req.preferExistingTab ?? this.kernel.prefs.get("fusion.lookupJumpExistingTab")
          });
        })
      );
    }
    stop() {
      this.disposables.disposeAll();
    }
  };

  // src/bridges/spotlight-fusion-bridge.ts
  var SpotlightFusionBridge = class {
    id = "spotlight-fusion-bridge";
    disposables = new DisposableStack();
    kernel;
    workspace;
    wordCite;
    constructor(kernel, workspace, wordCite) {
      this.kernel = kernel;
      this.workspace = workspace;
      this.wordCite = wordCite;
    }
    start() {
      this.disposables.reset();
      this.disposables.add(
        this.workspace.registerSpotlightProvider({
          id: "bridgeflow-cross-domain",
          priority: 80,
          query: (term, win) => {
            if (!this.kernel.prefs.get("fusion.spotlightCrossDomain")) return [];
            const out = [];
            const active = this.wordCite.tracker.getActiveSession();
            if (active) {
              const groupCmdTitle = `Group open tabs cited in ${active.displayName}`;
              if (!term || groupCmdTitle.toLowerCase().includes(term) || "word".includes(term)) {
                out.push({
                  id: `cmd:group-word:${active.sessionID}`,
                  category: "command",
                  title: groupCmdTitle,
                  subtitle: `${active.itemCitations.size} cited items`,
                  badge: "WORD",
                  action: () => {
                    this.workspace.groupOpenTabsByItemIDs(
                      active.displayName,
                      [...active.itemCitations.keys()],
                      win
                    );
                  }
                });
              }
              for (const [itemID, info] of active.itemCitations.entries()) {
                const label = `${info.shortText} (${active.displayName})`;
                if (term && !label.toLowerCase().includes(term) && !`[${info.ordinal}]`.includes(term)) {
                  continue;
                }
                out.push({
                  id: `word-cite:${active.sessionID}:${itemID}`,
                  category: "citation",
                  title: info.shortText || `Item #${itemID}`,
                  subtitle: active.displayName,
                  badge: `[${info.ordinal}]`,
                  action: async () => {
                    await this.workspace.focusOrOpenItem({
                      itemID,
                      preferExistingTab: true,
                      assignToActiveGroup: false
                    }, win);
                  }
                });
              }
            }
            if (!term || "clear cache".includes(term)) {
              out.push({
                id: "cmd:clear-citation-cache",
                category: "command",
                title: "Clear citation memory & reverse-lookup cache",
                badge: "CMD",
                action: () => {
                  this.kernel.bus.emit("inspector:clear-cache", { target: "all" });
                }
              });
            }
            return out;
          }
        })
      );
    }
    stop() {
      this.disposables.disposeAll();
    }
  };

  // src/services/item-resolution.ts
  function isItemTrashedOrDeleted(item) {
    if (!item) return true;
    if (item.deleted) return true;
    if (typeof item.isTrashed === "function" && item.isTrashed()) return true;
    return false;
  }
  function isItemWritable(item) {
    if (isItemTrashedOrDeleted(item)) return false;
    if (typeof item.isEditable === "function" && !item.isEditable()) return false;
    return true;
  }
  function isRegularValidItem(item) {
    if (isItemTrashedOrDeleted(item)) return false;
    if (typeof item.isRegularItem === "function") return Boolean(item.isRegularItem());
    return item.itemType !== "attachment" && item.itemType !== "note" && item.itemType !== "annotation";
  }
  function normalizeToRegularItem(item) {
    if (isItemTrashedOrDeleted(item)) return null;
    const seen = /* @__PURE__ */ new Set();
    let current = item;
    while (current) {
      if (isItemTrashedOrDeleted(current)) return null;
      const id = Number(current.id || 0);
      if (id > 0) {
        if (seen.has(id)) return null;
        seen.add(id);
      }
      if (isRegularValidItem(current)) return current;
      const parentID = Number(current.parentID || current.parentItemID || 0);
      if (current.parentItem) {
        current = current.parentItem;
        continue;
      }
      if (parentID > 0 && globalThis.Zotero?.Items?.get) {
        current = globalThis.Zotero.Items.get(parentID);
        continue;
      }
      return null;
    }
    return null;
  }
  async function normalizeToRegularItemAsync(item) {
    const sync = normalizeToRegularItem(item);
    if (sync) return sync;
    if (isItemTrashedOrDeleted(item)) return null;
    const parentID = Number(item.parentID || item.parentItemID || 0);
    if (parentID > 0 && globalThis.Zotero?.Items?.getAsync) {
      try {
        const parent = await globalThis.Zotero.Items.getAsync(parentID);
        return normalizeToRegularItem(parent);
      } catch {
        return null;
      }
    }
    return null;
  }
  function deduplicateRegularItems(items, maxItems = 100) {
    const result = [];
    const seen = /* @__PURE__ */ new Set();
    let truncated = false;
    for (const raw of items) {
      const norm = normalizeToRegularItem(raw);
      if (!norm) continue;
      const id = Number(norm.id || 0);
      if (id > 0) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      if (result.length >= maxItems) {
        truncated = true;
        break;
      }
      result.push(norm);
    }
    return { items: result, truncated };
  }
  async function resolvePdfAttachments(item) {
    if (isItemTrashedOrDeleted(item)) return [];
    const hostItems = globalThis.Zotero?.Items;
    const candidates = [];
    if (typeof item.isPDFAttachment === "function" && item.isPDFAttachment()) {
      candidates.push(item);
    } else if (typeof item.getAttachments === "function") {
      const ids = item.getAttachments() || [];
      for (const id of ids) {
        const att = hostItems?.getAsync ? await hostItems.getAsync(id) : hostItems?.get?.(id);
        if (att && !isItemTrashedOrDeleted(att) && att.isPDFAttachment?.()) {
          candidates.push(att);
        }
      }
    }
    return candidates.map((att) => ({
      item: att,
      id: Number(att.id || 0),
      title: String(att.getField?.("title") || att.attachmentFilename || "PDF"),
      filename: String(att.attachmentFilename || "")
    }));
  }

  // src/domains/inspector/citation-lookup-engine.ts
  var DOI_REGEX = /\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)\b/i;
  var YEAR_REGEX = /\b(19|20)\d{2}\b/;
  function extractDoi(input) {
    const match = String(input || "").match(DOI_REGEX);
    return match ? match[1].replace(/[.,;)\]]+$/, "").toLowerCase() : "";
  }
  function extractYear(input) {
    const match = String(input || "").match(YEAR_REGEX);
    return match ? match[0] : "";
  }
  var CitationLookupEngine = class {
    history;
    constructor(history) {
      this.history = history;
    }
    async lookup(rawQuery, libraryItems) {
      const query = String(rawQuery || "").trim();
      if (!query) return [];
      const exact = this.history.lookupExact(query);
      if (exact) {
        return [{ itemID: exact.itemID, title: exact.title, score: 100, source: "history-exact" }];
      }
      const fuzzy = this.history.searchFuzzy(query, 3);
      const results = fuzzy.map((rec) => ({
        itemID: rec.itemID,
        title: rec.title,
        score: 85,
        source: "history-fuzzy"
      }));
      const candidates = libraryItems ?? await this.fetchLocalLibraryItems();
      const targetDoi = extractDoi(query);
      const targetYear = extractYear(query);
      const lowerQuery = query.toLowerCase();
      const seen = new Set(results.map((r) => r.itemID));
      for (const item of candidates) {
        if (!isRegularValidItem(item)) continue;
        const id = Number(item.id || 0);
        if (!id || seen.has(id)) continue;
        const title = String(item.getField?.("title") || item.title || "");
        const doi = String(item.getField?.("DOI") || item.DOI || "").trim().toLowerCase();
        if (targetDoi && doi && doi === targetDoi) {
          seen.add(id);
          results.push({ itemID: id, title, score: 98, source: "doi" });
          continue;
        }
        let score = 0;
        const year = String(item.getField?.("year") || item.getField?.("date") || "").slice(0, 4);
        if (targetYear && year === targetYear) score += 25;
        const journal = String(item.getField?.("publicationTitle") || item.getField?.("journalAbbreviation") || "").toLowerCase();
        if (journal && journal.length >= 3 && lowerQuery.includes(journal)) score += 30;
        const pages = String(item.getField?.("pages") || "").replace(/[\u2013\u2014]/g, "-");
        const firstPage = pages.split("-")[0]?.trim();
        if (firstPage && firstPage.length >= 2 && lowerQuery.includes(firstPage)) score += 25;
        const creator = String(item.firstCreator || "").toLowerCase().split(",")[0]?.trim();
        if (creator && creator.length >= 2 && lowerQuery.includes(creator)) score += 20;
        if (title && title.length >= 8 && lowerQuery.includes(title.toLowerCase().slice(0, 24))) {
          score += 45;
        }
        if (score >= 45) {
          seen.add(id);
          results.push({ itemID: id, title, score: Math.min(95, score), source: "library-weighted" });
        }
      }
      results.sort((a, b) => b.score - a.score);
      return results.slice(0, 8);
    }
    async fetchLocalLibraryItems() {
      const hostItems = globalThis.Zotero?.Items;
      const userLibID = globalThis.Zotero?.Libraries?.userLibraryID ?? 1;
      if (typeof hostItems?.getAll === "function") {
        try {
          return await hostItems.getAll(userLibID, true, false);
        } catch {
          return [];
        }
      }
      return [];
    }
  };

  // src/services/pane-positioner.ts
  function normalizePanePosition(raw, fallback = "zotero-item-pane-header") {
    if (raw === "zotero-item-pane-header" || raw === "zotero-editpane-item-box" || raw === "zotero-editpane-related") {
      return raw;
    }
    return fallback;
  }
  var ItemPanePositionCoordinator = class {
    targets = /* @__PURE__ */ new Map();
    observers = /* @__PURE__ */ new Map();
    timers = /* @__PURE__ */ new Map();
    running = /* @__PURE__ */ new Set();
    dirty = /* @__PURE__ */ new Set();
    setTarget(key, spec) {
      if (!spec) this.targets.delete(key);
      else this.targets.set(key, spec);
    }
    observeAndQueue(body) {
      const owner = body?.closest?.("item-details");
      if (!owner?.getPanes) return;
      if (!this.observers.has(owner)) {
        const parent = owner.getPanes().find((p) => p.contains?.(body))?.parentNode;
        const Observer = owner.ownerDocument?.defaultView?.MutationObserver;
        if (parent && Observer) {
          const obs = new Observer(() => this.queue(owner));
          obs.observe(parent, { childList: true });
          this.observers.set(owner, obs);
        }
      }
      this.queue(owner);
    }
    queueAll() {
      for (const owner of this.observers.keys()) {
        this.queue(owner);
      }
    }
    queue(owner) {
      if (!owner?.getPanes || this.timers.has(owner)) return;
      if (this.running.has(owner)) {
        this.dirty.add(owner);
        return;
      }
      const timer = setTimeout(() => {
        this.timers.delete(owner);
        this.running.add(owner);
        void this.applyAll(owner).finally(() => {
          this.running.delete(owner);
          if (this.dirty.has(owner)) {
            this.dirty.delete(owner);
            this.queue(owner);
          }
        });
      }, 0);
      this.timers.set(owner, timer);
    }
    dispose() {
      for (const t of this.timers.values()) clearTimeout(t);
      this.timers.clear();
      for (const obs of this.observers.values()) obs.disconnect();
      this.observers.clear();
      this.targets.clear();
      this.running.clear();
      this.dirty.clear();
    }
    async applyAll(owner) {
      if (owner.skipRender) return;
      const independent = [];
      const anchored = [];
      for (const spec of this.targets.values()) {
        if (spec.anchorAfterSectionID) {
          anchored.push({ sectionID: spec.sectionID, anchorAfterSectionID: spec.anchorAfterSectionID });
        } else {
          independent.push(spec);
        }
      }
      for (const spec of independent) {
        await this.moveSectionToPosition(owner, spec.sectionID, spec.getPosition());
      }
      for (const spec of anchored) {
        await this.moveSectionAfter(owner, spec.sectionID, spec.anchorAfterSectionID);
      }
    }
    async moveSectionToPosition(owner, sectionID, position) {
      const panes = owner.getPanes();
      const current = panes.findIndex((p) => p.dataset.pane === sectionID);
      if (current < 0) return;
      let targetIdx = 0;
      if (position === "zotero-editpane-related") {
        targetIdx = panes.length;
      } else if (position === "zotero-editpane-item-box") {
        const info = panes.findIndex((p) => p.dataset.pane === "info");
        targetIdx = info < 0 ? 0 : info + 1;
      }
      if (current === targetIdx || current === targetIdx - 1) return;
      const targetPaneID = panes[targetIdx]?.dataset.pane;
      await this.reorderPane(owner, sectionID, targetPaneID, targetIdx);
    }
    async moveSectionAfter(owner, sectionID, anchorSectionID) {
      const panes = owner.getPanes();
      const anchorIdx = panes.findIndex((p) => p.dataset.pane === anchorSectionID);
      const currentIdx = panes.findIndex((p) => p.dataset.pane === sectionID);
      if (anchorIdx < 0 || currentIdx < 0 || currentIdx === anchorIdx + 1) return;
      const desiredPaneIndex = currentIdx < anchorIdx ? anchorIdx : anchorIdx + 1;
      const targetPaneID = panes[anchorIdx + 1]?.dataset.pane;
      await this.reorderPane(owner, sectionID, targetPaneID, desiredPaneIndex);
    }
    async reorderPane(owner, sectionID, targetPaneID, fallbackIdx) {
      const sidenav = owner.sidenav;
      if (sidenav?.container === owner && sidenav.changePaneOrder) {
        const wrappers = Array.from(sidenav.querySelectorAll?.(".inherit-flex > .pin-wrapper") || []);
        const sidenavTargetIdx = targetPaneID ? wrappers.findIndex((w) => w.querySelector(".btn[data-pane]")?.dataset.pane === targetPaneID) : wrappers.length;
        await sidenav.changePaneOrder(
          sectionID,
          wrappers.length && sidenavTargetIdx >= 0 ? sidenavTargetIdx : fallbackIdx,
          { persist: false, render: false }
        );
      } else if (owner.changePaneOrder) {
        await owner.changePaneOrder(sectionID, fallbackIdx, { render: false });
      }
    }
  };

  // src/domains/inspector/citation-lookup-section.ts
  var LOOKUP_CSS = `
.zbf-lookup-root { display:flex; flex-direction:column; gap:6px; padding:4px 0; font:12px/1.45 system-ui,sans-serif; }
.zbf-lookup-input { width:100%; box-sizing:border-box; padding:5px 8px; border-radius:5px; border:1px solid color-mix(in srgb,currentColor 20%,transparent); background:var(--material-background,transparent); color:inherit; font:inherit; }
.zbf-lookup-actions { display:flex; gap:6px; }
.zbf-lookup-btn { padding:4px 8px; border-radius:5px; border:1px solid color-mix(in srgb,currentColor 20%,transparent); background:transparent; color:inherit; font:inherit; cursor:pointer; }
.zbf-lookup-btn:hover { background:color-mix(in srgb,currentColor 8%,transparent); }
.zbf-lookup-status { font-size:11px; opacity:0.75; }
.zbf-lookup-results { display:flex; flex-direction:column; gap:4px; }
.zbf-lookup-hit { text-align:left; padding:5px 8px; border-radius:5px; border:1px solid color-mix(in srgb,currentColor 14%,transparent); background:color-mix(in srgb,currentColor 3%,transparent); color:inherit; font:inherit; cursor:pointer; }
.zbf-lookup-hit:hover { border-color:var(--accent-blue,#2563EB); background:color-mix(in srgb,var(--accent-blue,#2563EB) 10%,transparent); }
`;
  var CitationLookupSectionController = class {
    unregisterFn = null;
    sectionID = false;
    anchorSectionID = false;
    kernel;
    services;
    engine;
    constructor(kernel, services, engine) {
      this.kernel = kernel;
      this.services = services;
      this.engine = engine;
    }
    setAnchorSectionID(anchorID) {
      this.anchorSectionID = anchorID;
      this.syncPositionTarget();
    }
    register() {
      if (this.unregisterFn) return;
      const icon = `${this.kernel.info.rootURI}assets/lookup.svg`;
      const reg = this.services.itemPanes.register({
        paneID: "bridgeflow-citation-lookup",
        pluginID: this.kernel.info.id,
        header: { l10nID: "zbf-pane-lookup-header", icon },
        sidenav: { l10nID: "zbf-pane-lookup-sidenav", icon, orderable: true },
        onInit: ({ body, setEnabled }) => {
          setEnabled?.(true);
          this.mountUI(body);
          this.services.panePositions.observeAndQueue(body);
        },
        onItemChange: ({ body, setEnabled }) => {
          setEnabled?.(true);
          this.services.panePositions.observeAndQueue(body);
          return true;
        },
        onRender: ({ body, setEnabled }) => {
          setEnabled?.(true);
          this.services.panePositions.observeAndQueue(body);
        }
      });
      this.sectionID = reg.sectionID;
      this.unregisterFn = reg.dispose;
      this.syncPositionTarget();
    }
    unregister() {
      this.services.panePositions.setTarget("citation-lookup", null);
      this.sectionID = false;
      this.unregisterFn?.();
      this.unregisterFn = null;
    }
    syncPositionTarget() {
      if (!this.sectionID) return;
      this.services.panePositions.setTarget("citation-lookup", {
        sectionID: this.sectionID,
        getPosition: () => normalizePanePosition(this.kernel.prefs.get("inspector.cslPreview.position"), "zotero-item-pane-header"),
        anchorAfterSectionID: this.anchorSectionID || void 0
      });
    }
    mountUI(body) {
      const doc = body.ownerDocument;
      if (!doc) return;
      doc.defaultView?.MozXULElement?.insertFTLIfNeeded?.("zotero-bridgeflow.ftl");
      if (!doc.getElementById("zbf-lookup-style")) {
        const style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
        style.id = "zbf-lookup-style";
        style.textContent = LOOKUP_CSS;
        doc.documentElement?.append(style);
      }
      body.textContent = "";
      const root = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      root.className = "zbf-lookup-root";
      const input = doc.createElementNS("http://www.w3.org/1999/xhtml", "input");
      input.type = "text";
      input.className = "zbf-lookup-input";
      input.placeholder = "DOI / Compact citation...";
      const actions = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      actions.className = "zbf-lookup-actions";
      const searchBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
      searchBtn.type = "button";
      searchBtn.className = "zbf-lookup-btn";
      searchBtn.textContent = "Lookup";
      const clipBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
      clipBtn.type = "button";
      clipBtn.className = "zbf-lookup-btn";
      clipBtn.textContent = "Clipboard";
      actions.append(searchBtn, clipBtn);
      const status = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      status.className = "zbf-lookup-status";
      status.textContent = `History cache: ${this.services.history.count}`;
      const list = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      list.className = "zbf-lookup-results";
      const runLookup = async (query) => {
        status.textContent = "Searching...";
        const hits = await this.engine.lookup(query);
        status.textContent = hits.length ? `Matched ${hits.length} item(s)` : "No matching item found";
        this.renderHits(doc, list, hits);
      };
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") void runLookup(input.value);
      });
      searchBtn.addEventListener("click", () => {
        void runLookup(input.value);
      });
      clipBtn.addEventListener("click", () => {
        const clip = this.readClipboardText();
        if (clip) {
          input.value = clip;
          void runLookup(clip);
        } else {
          status.textContent = "Clipboard is empty";
        }
      });
      root.append(input, actions, status, list);
      body.append(root);
    }
    readClipboardText() {
      try {
        const text = globalThis.Zotero?.Utilities?.Internal?.getClipboardText?.();
        return String(text || "").trim();
      } catch {
        return "";
      }
    }
    renderHits(doc, container, hits) {
      container.textContent = "";
      for (const hit of hits) {
        const row = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
        row.type = "button";
        row.className = "zbf-lookup-hit";
        row.textContent = `${hit.title} (${hit.score}% · ${hit.source})`;
        row.addEventListener("click", () => {
          this.kernel.bus.emit("workspace:open-item-request", {
            itemID: hit.itemID,
            preferExistingTab: this.kernel.prefs.get("fusion.lookupJumpExistingTab"),
            assignToActiveGroup: true
          });
        });
        container.append(row);
      }
    }
  };

  // src/domains/inspector/csl-preview-section.ts
  var CSL_CSS = `
.zbf-csl-root { display:flex; flex-direction:column; gap:8px; padding:4px 0; font:12px/1.5 system-ui,sans-serif; color:var(--fill-primary,currentColor); }
.zbf-csl-block { border:1px solid color-mix(in srgb,currentColor 14%,transparent); border-radius:6px; padding:8px; background:color-mix(in srgb,currentColor 2%,transparent); }
.zbf-csl-head { display:flex; align-items:center; justify-content:space-between; gap:6px; margin-bottom:4px; font-size:11px; opacity:0.78; font-weight:600; }
.zbf-csl-text { user-select:text; overflow-wrap:anywhere; }
.zbf-csl-copy-btn { padding:2px 8px; border-radius:4px; border:1px solid color-mix(in srgb,currentColor 20%,transparent); background:transparent; color:inherit; font:inherit; cursor:pointer; }
.zbf-csl-copy-btn:hover { background:color-mix(in srgb,currentColor 8%,transparent); }
`;
  var CslPreviewSectionController = class {
    sectionID = false;
    states = /* @__PURE__ */ new Map();
    unregisterFn = null;
    kernel;
    services;
    constructor(kernel, services) {
      this.kernel = kernel;
      this.services = services;
    }
    register() {
      if (this.unregisterFn) return;
      const icon = `${this.kernel.info.rootURI}assets/view.svg`;
      const reg = this.services.itemPanes.register({
        paneID: "bridgeflow-csl-preview",
        pluginID: this.kernel.info.id,
        header: { l10nID: "zbf-pane-csl-preview-header", icon },
        sidenav: { l10nID: "zbf-pane-csl-preview-sidenav", icon, orderable: true },
        onInit: ({ body, item, setEnabled }) => {
          const doc = body.ownerDocument;
          doc?.defaultView?.MozXULElement?.insertFTLIfNeeded?.("zotero-bridgeflow.ftl");
          this.ensureStyle(doc);
          const st = { body, items: [], generation: 0, setEnabled };
          this.states.set(body, st);
          this.updateItems(st, item, setEnabled);
          this.services.panePositions.observeAndQueue(body);
        },
        onDestroy: ({ body }) => {
          this.states.delete(body);
        },
        onItemChange: ({ body, item, setEnabled }) => {
          const st = this.states.get(body);
          if (!st) return false;
          this.services.panePositions.observeAndQueue(body);
          return this.updateItems(st, item, setEnabled);
        },
        onRender: ({ body, item, setEnabled }) => {
          const st = this.states.get(body);
          if (!st) return;
          this.updateItems(st, item, setEnabled);
          this.services.panePositions.observeAndQueue(body);
          void this.renderState(body);
        },
        onAsyncRender: async ({ body }) => {
          await this.renderState(body);
        },
        onToggle: ({ body }) => {
          void this.renderState(body);
        }
      });
      this.sectionID = reg.sectionID;
      this.unregisterFn = reg.dispose;
      if (this.sectionID) {
        this.services.panePositions.setTarget("csl-preview", {
          sectionID: this.sectionID,
          getPosition: () => normalizePanePosition(this.kernel.prefs.get("inspector.cslPreview.position"), "zotero-item-pane-header")
        });
      }
    }
    async renderState(body) {
      const st = this.states.get(body);
      if (!st) return;
      const gen = ++st.generation;
      const doc = body.ownerDocument;
      if (!doc) return;
      if (!st.items.length) {
        body.textContent = "";
        return;
      }
      const mode = this.kernel.prefs.get("inspector.cslPreview.whatToShow");
      const wantCite = mode === "zpboth" || mode === "zpcite";
      const wantBib = mode === "zpboth" || mode === "zpbib";
      const [citeRes, bibRes] = await Promise.all([
        wantCite ? this.services.csl.formatItems(st.items, { asCitation: true }) : Promise.resolve(null),
        wantBib ? this.services.csl.formatItems(st.items, { asCitation: false }) : Promise.resolve(null)
      ]);
      if (gen !== st.generation) return;
      body.textContent = "";
      const root = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      root.className = "zbf-csl-root";
      const fontSize = `${this.kernel.prefs.get("inspector.cslPreview.fontsize")}em`;
      const lineHeight = String(this.kernel.prefs.get("inspector.cslPreview.spacing"));
      if (citeRes?.text) {
        root.append(this.buildBlock(doc, "In-Text", citeRes.text, fontSize, lineHeight, true, st.items));
      }
      if (bibRes?.text) {
        root.append(this.buildBlock(doc, "Bibliography", bibRes.text, fontSize, lineHeight, false, st.items));
      }
      body.append(root);
    }
    async refreshAll() {
      for (const body of this.states.keys()) {
        await this.renderState(body);
      }
    }
    unregister() {
      this.services.panePositions.setTarget("csl-preview", null);
      this.sectionID = false;
      this.unregisterFn?.();
      this.unregisterFn = null;
      this.states.clear();
    }
    updateItems(st, item, setEnabled) {
      const maxItems = this.kernel.prefs.get("inspector.cslPreview.maxPreviewItems");
      const selected = item ? [item] : globalThis.Zotero?.getMainWindow?.()?.ZoteroPane?.getSelectedItems?.() || [];
      const { items } = deduplicateRegularItems(selected, maxItems);
      st.items = items;
      const enabled = items.length > 0;
      (setEnabled || st.setEnabled)?.(enabled);
      return enabled;
    }
    ensureStyle(doc) {
      if (!doc || doc.getElementById("zbf-csl-preview-style")) return;
      const style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
      style.id = "zbf-csl-preview-style";
      style.textContent = CSL_CSS;
      doc.documentElement?.append(style);
    }
    buildBlock(doc, label, text, fontSize, lineHeight, asCitation, items) {
      const wrap = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      wrap.className = "zbf-csl-block";
      const head = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      head.className = "zbf-csl-head";
      const title = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
      title.textContent = label;
      const copyBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
      copyBtn.type = "button";
      copyBtn.className = "zbf-csl-copy-btn";
      copyBtn.textContent = `Copy`;
      copyBtn.addEventListener("click", async () => {
        const ok = await this.services.clipboard.copyItems(items, { asCitation, source: "preview" });
        if (ok) {
          copyBtn.textContent = "Copied ✓";
          setTimeout(() => {
            copyBtn.textContent = "Copy";
          }, 1200);
        }
      });
      head.append(title, copyBtn);
      const content = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      content.className = "zbf-csl-text";
      content.style.fontSize = fontSize;
      content.style.lineHeight = lineHeight;
      content.textContent = text;
      wrap.append(head, content);
      return wrap;
    }
  };

  // src/domains/inspector/pdf-folder-section.ts
  var PdfFolderSectionController = class {
    unregisterFn = null;
    states = /* @__PURE__ */ new Map();
    kernel;
    services;
    constructor(kernel, services) {
      this.kernel = kernel;
      this.services = services;
    }
    register() {
      if (this.unregisterFn) return;
      const icon = `${this.kernel.info.rootURI}assets/pdf-folder.svg`;
      const reg = this.services.itemPanes.register({
        paneID: "bridgeflow-pdf-folder",
        pluginID: this.kernel.info.id,
        header: { l10nID: "zbf-pane-pdf-folder-header", icon },
        sidenav: { l10nID: "zbf-pane-pdf-folder-sidenav", icon, orderable: true },
        onInit: ({ body, item, setEnabled }) => {
          this.initBody(body, item, setEnabled);
          this.services.panePositions.observeAndQueue(body);
        },
        onDestroy: ({ body }) => {
          this.states.delete(body);
        },
        onItemChange: ({ body, item, setEnabled }) => {
          this.updateState(body, item, setEnabled);
          this.services.panePositions.observeAndQueue(body);
          return Boolean(item);
        },
        onRender: ({ body, item, setEnabled }) => {
          this.updateState(body, item, setEnabled);
          this.services.panePositions.observeAndQueue(body);
        },
        onToggle: ({ body, item }) => {
          const target = item ?? this.states.get(body)?.item;
          if (target) void this.revealAttachmentFolder(target);
        }
      });
      this.unregisterFn = reg.dispose;
      if (reg.sectionID) {
        this.services.panePositions.setTarget("pdf-folder", {
          sectionID: reg.sectionID,
          getPosition: () => normalizePanePosition(this.kernel.prefs.get("inspector.pdfFolder.position"), "zotero-editpane-related")
        });
      }
    }
    async revealAttachmentFolder(item) {
      if (!item) return false;
      const owner = await normalizeToRegularItemAsync(item);
      const pdfs = await resolvePdfAttachments(owner || item);
      const first = pdfs[0]?.item;
      if (!first) return false;
      try {
        const filePath = typeof first.getFilePathAsync === "function" ? await first.getFilePathAsync() : first.getFilePath?.();
        if (!filePath) return false;
        const zFile = globalThis.Zotero?.File;
        const mode = this.kernel.prefs.get("inspector.pdfFolder.openMode");
        if (mode === "folder" && typeof zFile?.pathToFile === "function") {
          const f = zFile.pathToFile(filePath);
          f?.parent?.launch?.();
          return true;
        }
        const win = globalThis.Zotero?.getMainWindow?.();
        win?.ZoteroPane?.showAttachmentInFilesystem?.(first.id);
        return true;
      } catch {
        return false;
      }
    }
    unregister() {
      this.services.panePositions.setTarget("pdf-folder", null);
      this.unregisterFn?.();
      this.unregisterFn = null;
      this.states.clear();
    }
    initBody(body, item, setEnabled) {
      const doc = body.ownerDocument;
      if (!doc) return;
      doc.defaultView?.MozXULElement?.insertFTLIfNeeded?.("zotero-bridgeflow.ftl");
      body.textContent = "";
      const wrap = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      wrap.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr);gap:6px;padding:4px 0;font:12px/1.4 system-ui,sans-serif;";
      const meta = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      meta.style.cssText = "opacity:0.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      const btn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
      btn.type = "button";
      btn.setAttribute("data-l10n-id", "zbf-pane-pdf-folder-header");
      btn.textContent = "Open PDF Folder";
      btn.style.cssText = "justify-self:start;padding:5px 10px;border-radius:5px;border:1px solid color-mix(in srgb,currentColor 20%,transparent);background:transparent;color:inherit;font:inherit;cursor:pointer;";
      btn.addEventListener("click", () => {
        const st = this.states.get(body);
        if (st?.item) void this.revealAttachmentFolder(st.item);
      });
      wrap.append(meta, btn);
      body.append(wrap);
      this.states.set(body, { body, item: item ?? null, btn, meta });
      this.updateState(body, item, setEnabled);
    }
    updateState(body, item, setEnabled) {
      const st = this.states.get(body);
      if (!st) return;
      st.item = item ?? null;
      const enabled = Boolean(item);
      st.btn.disabled = !enabled;
      st.meta.textContent = item ? String(item.getField?.("title") || item.attachmentFilename || "") : "";
      setEnabled?.(enabled);
    }
  };

  // src/domains/inspector/pdf-preview-section.ts
  var PDF_CSS = `
.zbf-pdf-root { display:flex; flex-direction:column; gap:6px; padding:4px 0; font:12px/1.4 system-ui,sans-serif; }
.zbf-pdf-entry { display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; text-align:left; padding:6px 8px; border-radius:6px; border:1px solid color-mix(in srgb,currentColor 16%,transparent); background:color-mix(in srgb,currentColor 3%,transparent); color:inherit; font:inherit; cursor:pointer; }
.zbf-pdf-entry:hover { border-color:var(--accent-blue,#2563EB); background:color-mix(in srgb,var(--accent-blue,#2563EB) 10%,transparent); }
.zbf-pdf-badge { font-size:11px; opacity:0.75; flex-shrink:0; }
`;
  var PdfPreviewSectionController = class {
    unregisterFn = null;
    states = /* @__PURE__ */ new Map();
    kernel;
    services;
    constructor(kernel, services) {
      this.kernel = kernel;
      this.services = services;
    }
    register() {
      if (this.unregisterFn) return;
      const icon = `${this.kernel.info.rootURI}assets/pdf-preview.svg`;
      const sidenavIcon = `${this.kernel.info.rootURI}assets/pdf-preview-sidenav.svg`;
      const reg = this.services.itemPanes.register({
        paneID: "bridgeflow-pdf-preview",
        pluginID: this.kernel.info.id,
        header: { l10nID: "zbf-pane-pdf-preview-header", icon },
        sidenav: { l10nID: "zbf-pane-pdf-preview-sidenav", icon: sidenavIcon, orderable: true },
        onInit: ({ body, item, setEnabled }) => {
          const doc = body.ownerDocument;
          doc?.defaultView?.MozXULElement?.insertFTLIfNeeded?.("zotero-bridgeflow.ftl");
          if (doc && !doc.getElementById("zbf-pdf-preview-style")) {
            const style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
            style.id = "zbf-pdf-preview-style";
            style.textContent = PDF_CSS;
            doc.documentElement?.append(style);
          }
          this.states.set(body, { body, item: item ?? null, setEnabled });
          setEnabled?.(Boolean(item));
          this.services.panePositions.observeAndQueue(body);
        },
        onDestroy: ({ body }) => {
          this.states.delete(body);
        },
        onItemChange: ({ body, item, setEnabled }) => {
          const st = this.states.get(body);
          if (st) st.item = item ?? null;
          const active = Boolean(item);
          setEnabled?.(active);
          this.services.panePositions.observeAndQueue(body);
          return active;
        },
        onRender: ({ body, item, setEnabled }) => {
          const st = this.states.get(body);
          if (st && item !== void 0) st.item = item;
          setEnabled?.(Boolean(item ?? st?.item));
          this.services.panePositions.observeAndQueue(body);
        },
        onAsyncRender: async ({ body, item, setEnabled }) => {
          await this.renderCompareList(body, item ?? this.states.get(body)?.item, setEnabled);
        }
      });
      this.unregisterFn = reg.dispose;
      if (reg.sectionID) {
        this.services.panePositions.setTarget("pdf-preview", {
          sectionID: reg.sectionID,
          getPosition: () => normalizePanePosition(this.kernel.prefs.get("inspector.pdfPreview.position"), "zotero-editpane-related")
        });
      }
    }
    async resolveSameItemPdfs(item) {
      if (!item) return [];
      const owner = await normalizeToRegularItemAsync(item);
      return resolvePdfAttachments(owner || item);
    }
    async renderCompareList(body, item, setEnabled) {
      const doc = body.ownerDocument;
      if (!doc) return;
      body.textContent = "";
      const pdfs = await this.resolveSameItemPdfs(item);
      setEnabled?.(pdfs.length > 0);
      if (!pdfs.length) return;
      const root = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      root.className = "zbf-pdf-root";
      for (const pdf of pdfs) {
        const btn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
        btn.type = "button";
        btn.className = "zbf-pdf-entry";
        const name = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
        name.textContent = pdf.filename || pdf.title;
        const badge = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
        badge.className = "zbf-pdf-badge";
        badge.textContent = "Open / Focus";
        btn.append(name, badge);
        btn.addEventListener("click", () => {
          this.kernel.bus.emit("workspace:open-item-request", {
            itemID: pdf.id,
            attachmentID: pdf.id,
            preferExistingTab: true,
            assignToActiveGroup: true
          });
        });
        root.append(btn);
      }
      body.append(root);
    }
    unregister() {
      this.services.panePositions.setTarget("pdf-preview", null);
      this.unregisterFn?.();
      this.unregisterFn = null;
      this.states.clear();
    }
  };

  // src/domains/inspector/module.ts
  var InspectorDomainModule = class {
    id = "inspector";
    enabledPref = "modules.inspector.enable";
    lookupEngine;
    cslPreview;
    lookupSection;
    pdfPreview;
    pdfFolder;
    disposables = new DisposableStack();
    active = false;
    kernel;
    services;
    constructor(kernel, services) {
      this.kernel = kernel;
      this.services = services;
      this.lookupEngine = new CitationLookupEngine(services.history);
      this.cslPreview = new CslPreviewSectionController(kernel, services);
      this.lookupSection = new CitationLookupSectionController(kernel, services, this.lookupEngine);
      this.pdfPreview = new PdfPreviewSectionController(kernel, services);
      this.pdfFolder = new PdfFolderSectionController(kernel, services);
    }
    isActive() {
      return this.active;
    }
    start() {
      if (this.active) return;
      this.active = true;
      this.disposables.reset();
      this.syncSections();
      this.disposables.add(
        this.kernel.prefs.observeKeys(
          [
            "inspector.cslPreview.enable",
            "inspector.lookup.enable",
            "inspector.pdfPreview.enable",
            "inspector.pdfFolder.enable"
          ],
          () => this.syncSections()
        )
      );
      this.disposables.add(
        this.kernel.prefs.observeKeys(
          [
            "inspector.cslPreview.position",
            "inspector.pdfPreview.position",
            "inspector.pdfFolder.position"
          ],
          () => this.services.panePositions.queueAll()
        )
      );
      this.disposables.add(
        this.kernel.prefs.observeKeys(
          [
            "inspector.cslPreview.citationstyle",
            "inspector.cslPreview.whatToShow",
            "inspector.cslPreview.fontsize",
            "inspector.cslPreview.spacing",
            "inspector.cslPreview.maxPreviewItems"
          ],
          () => {
            void this.cslPreview.refreshAll();
          }
        )
      );
    }
    async lookupQuery(query, libraryItems) {
      return this.lookupEngine.lookup(query, libraryItems);
    }
    stop() {
      if (!this.active) return;
      this.active = false;
      this.cslPreview.unregister();
      this.lookupSection.unregister();
      this.pdfPreview.unregister();
      this.pdfFolder.unregister();
      this.disposables.disposeAll();
    }
    syncSections() {
      if (!this.active) return;
      if (this.kernel.prefs.get("inspector.cslPreview.enable")) this.cslPreview.register();
      else this.cslPreview.unregister();
      this.lookupSection.setAnchorSectionID(this.cslPreview.sectionID);
      if (this.kernel.prefs.get("inspector.lookup.enable")) this.lookupSection.register();
      else this.lookupSection.unregister();
      if (this.kernel.prefs.get("inspector.pdfPreview.enable")) this.pdfPreview.register();
      else this.pdfPreview.unregister();
      if (this.kernel.prefs.get("inspector.pdfFolder.enable")) this.pdfFolder.register();
      else this.pdfFolder.unregister();
      this.services.panePositions.queueAll();
    }
  };

  // src/domains/word-cite/citation-column.ts
  var CitationColumnController = class {
    columnID = false;
    kernel;
    tracker;
    constructor(kernel, tracker) {
      this.kernel = kernel;
      this.tracker = tracker;
    }
    register() {
      if (this.columnID) return;
      const manager = globalThis.Zotero?.ItemTreeManager;
      if (!manager?.registerColumn) return;
      this.columnID = manager.registerColumn({
        dataKey: "bridgeflowCitation",
        label: "Citation",
        pluginID: this.kernel.info.id,
        dataProvider: (item) => {
          const id = Number(item?.id || 0);
          if (!id) return "";
          return this.tracker.getCitationDisplayForItem(id);
        }
      });
    }
    unregister() {
      if (!this.columnID) return;
      const id = this.columnID;
      this.columnID = false;
      try {
        globalThis.Zotero?.ItemTreeManager?.unregisterColumn?.(id);
      } catch {
      }
    }
  };

  // src/domains/word-cite/drag-cite-controller.ts
  var DragCiteController = class {
    busy = false;
    windowDisposers = /* @__PURE__ */ new Map();
    kernel;
    win32;
    constructor(kernel, win32) {
      this.kernel = kernel;
      this.win32 = win32;
    }
    attachWindow(win) {
      if (!this.win32.supportsNativeWin32() || this.windowDisposers.has(win)) return;
      const itemsView = win.ZoteroPane?.itemsView;
      if (!itemsView || typeof itemsView.onDragStart !== "function") return;
      const unpatch = this.kernel.runtime.patch(
        itemsView,
        "onDragStart",
        "itemsView",
        (orig) => (event, ...rest) => {
          const res = orig.call(itemsView, event, ...rest);
          if (!this.kernel.prefs.get("wordCite.dragCite.enable")) return res;
          const selected = win.ZoteroPane?.getSelectedItems?.() || [];
          const { items } = deduplicateRegularItems(selected);
          if (!items.length) return res;
          try {
            event?.dataTransfer?.clearData?.("text/html");
            event?.dataTransfer?.setData?.("text/plain", "");
          } catch {
          }
          const onDragEnd = () => {
            win.removeEventListener?.("dragend", onDragEnd, true);
            void this.handleDropEnd(items);
          };
          win.addEventListener?.("dragend", onDragEnd, { once: true, capture: true });
          return res;
        }
      );
      this.windowDisposers.set(win, unpatch);
    }
    detachWindow(win) {
      const disposer = this.windowDisposers.get(win);
      if (!disposer) return;
      this.windowDisposers.delete(win);
      disposer();
    }
    async handleDropEnd(items) {
      if (!this.kernel.prefs.get("wordCite.dragCite.enable")) return "unavailable";
      const probe = this.win32.probeCursorWordDropTarget();
      if (probe.status !== "word-confirmed") return "non-word";
      if (this.busy) return "busy";
      this.busy = true;
      try {
        const integration = globalThis.Zotero?.Integration;
        if (!integration?.execCommand) return "unavailable";
        await integration.execCommand("WinWord", "addEditCitation", items.map((i) => i.id));
        return "inserted";
      } catch (err) {
        this.kernel.logger.error("word-cite:drag", err);
        return "unavailable";
      } finally {
        this.busy = false;
      }
    }
    disposeAll() {
      for (const disposer of this.windowDisposers.values()) disposer();
      this.windowDisposers.clear();
    }
  };

  // src/domains/word-cite/session-tracker.ts
  function extractDocumentBaseName(rawPath) {
    const cleaned = String(rawPath || "").trim();
    if (!cleaned) return "Untitled Word Document";
    const parts = cleaned.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || cleaned;
  }
  function disambiguateDocumentNames(sessions) {
    const baseCounts = /* @__PURE__ */ new Map();
    for (const s of sessions) {
      const base = extractDocumentBaseName(s.path);
      baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
    }
    const result = /* @__PURE__ */ new Map();
    for (const s of sessions) {
      const base = extractDocumentBaseName(s.path);
      if ((baseCounts.get(base) ?? 0) <= 1) {
        result.set(s.sessionID, base);
        continue;
      }
      const segments = s.path.split(/[\\/]/).filter(Boolean);
      const parent = segments.length >= 2 ? segments[segments.length - 2] : "";
      result.set(s.sessionID, parent ? `${base} (${parent})` : base);
    }
    return result;
  }
  var WordSessionTracker = class {
    sessions = /* @__PURE__ */ new Map();
    activeSessionID = null;
    lastFingerprint = "";
    bus;
    win32;
    constructor(bus, win32) {
      this.bus = bus;
      this.win32 = win32;
    }
    getActiveSession() {
      if (!this.activeSessionID) return null;
      return this.sessions.get(this.activeSessionID) ?? null;
    }
    getAllSessions() {
      return [...this.sessions.values()];
    }
    getUnionCitedItemIDs() {
      const union = /* @__PURE__ */ new Set();
      for (const ses of this.sessions.values()) {
        for (const itemID of ses.itemCitations.keys()) {
          union.add(itemID);
        }
      }
      return union;
    }
    getCitationDisplayForItem(itemID) {
      const active = this.getActiveSession();
      if (active) {
        const hit = active.itemCitations.get(itemID);
        if (hit) return `[${hit.ordinal}] ${hit.shortText}`.trim();
      }
      for (const ses of this.sessions.values()) {
        const hit = ses.itemCitations.get(itemID);
        if (hit) return `[${hit.ordinal}] ${hit.shortText}`.trim();
      }
      return "";
    }
    /**
     * Updates tracked sessions from Zotero.Integration snapshots (or test fixtures)
     * and emits `citation:snapshot-updated` only when the deterministic fingerprint changes.
     */
    syncSessions(rawSessions) {
      const names = disambiguateDocumentNames(
        rawSessions.map((s) => ({ sessionID: s.sessionID, path: s.documentPath }))
      );
      this.sessions.clear();
      for (const raw of rawSessions) {
        const map = /* @__PURE__ */ new Map();
        for (const c of raw.citations) {
          if (!Number.isInteger(c.itemID) || c.itemID <= 0) continue;
          if (!map.has(c.itemID)) {
            map.set(c.itemID, { ordinal: c.ordinal, shortText: c.shortText });
          }
        }
        this.sessions.set(raw.sessionID, {
          sessionID: raw.sessionID,
          documentPath: raw.documentPath,
          displayName: names.get(raw.sessionID) || extractDocumentBaseName(raw.documentPath),
          itemCitations: map
        });
      }
      if (this.activeSessionID && !this.sessions.has(this.activeSessionID)) {
        this.activeSessionID = null;
      }
      if (!this.activeSessionID && rawSessions.length > 0) {
        this.activeSessionID = rawSessions[0].sessionID;
      }
      this.syncForegroundActiveSession();
      const fingerprint = this.computeFingerprint();
      if (fingerprint === this.lastFingerprint) return false;
      this.lastFingerprint = fingerprint;
      this.emitSnapshot();
      return true;
    }
    /**
     * P1-B Foreground Word Session Sync:
     * Only switches activeSessionID when the foreground Word title uniquely matches a single session.
     */
    syncForegroundActiveSession(overrideTitle) {
      const fgTitle = (overrideTitle ?? this.win32.probeForegroundWordTitle()).trim().toLowerCase();
      if (!fgTitle || this.sessions.size === 0) return false;
      const matches = [];
      for (const ses of this.sessions.values()) {
        const base = extractDocumentBaseName(ses.documentPath).toLowerCase();
        const stem = base.replace(/\.(docx?|rtf)$/i, "");
        if (base && (fgTitle.includes(base) || stem && fgTitle.includes(stem))) {
          matches.push(ses.sessionID);
        }
      }
      if (matches.length !== 1) return false;
      if (this.activeSessionID === matches[0]) return false;
      this.activeSessionID = matches[0];
      return true;
    }
    clear() {
      this.sessions.clear();
      this.activeSessionID = null;
      this.lastFingerprint = "";
      this.emitSnapshot();
    }
    computeFingerprint() {
      const parts = [`active=${this.activeSessionID || ""}`];
      for (const ses of this.sessions.values()) {
        const items = [...ses.itemCitations.entries()].sort((a, b) => a[0] - b[0]).map(([id, c]) => `${id}:${c.ordinal}:${c.shortText}`).join(",");
        parts.push(`${ses.sessionID}|${ses.displayName}|${items}`);
      }
      return parts.join(";");
    }
    emitSnapshot() {
      const active = this.getActiveSession();
      const byItemID = /* @__PURE__ */ new Map();
      const citedItemIDs = [];
      if (active) {
        for (const [itemID, info] of active.itemCitations.entries()) {
          byItemID.set(itemID, {
            itemID,
            ordinal: info.ordinal,
            shortText: info.shortText,
            documentName: active.displayName,
            sessionID: active.sessionID
          });
          citedItemIDs.push(itemID);
        }
      }
      const payload = {
        activeSessionID: active?.sessionID ?? null,
        activeDocumentName: active?.displayName ?? "",
        byItemID,
        citedItemIDs
      };
      this.bus.emit("citation:snapshot-updated", payload);
    }
  };

  // src/domains/word-cite/tag-governance.ts
  var CitationTagGovernance = class {
    managedItemIDs = /* @__PURE__ */ new Set();
    activeTagText;
    prefs;
    constructor(prefs) {
      this.prefs = prefs;
      this.activeTagText = this.sanitizeTagText(prefs.get("wordCite.citationTags.text"));
    }
    get managedCount() {
      return this.managedItemIDs.size;
    }
    sanitizeTagText(raw) {
      const clean = String(raw || "").replace(/[\r\n\x00-\x1f]/g, "").trim().slice(0, 200);
      return clean || "/Citations";
    }
    async syncCitedItems(citedUnion, resolveItem = (id) => globalThis.Zotero?.Items?.get?.(id)) {
      const enabled = this.prefs.get("wordCite.citationTags.enable");
      const nextTag = this.sanitizeTagText(this.prefs.get("wordCite.citationTags.text"));
      let added = 0;
      let removed = 0;
      if (nextTag !== this.activeTagText) {
        const prevTag = this.activeTagText;
        this.activeTagText = nextTag;
        for (const id of [...this.managedItemIDs]) {
          const item = resolveItem(id);
          if (!isItemWritable(item)) continue;
          if (item.hasTag?.(prevTag)) {
            item.removeTag?.(prevTag);
            if (enabled && citedUnion.has(id)) item.addTag?.(nextTag);
            await item.saveTx?.();
          }
        }
      }
      if (!enabled) {
        for (const id of [...this.managedItemIDs]) {
          const item = resolveItem(id);
          if (isItemWritable(item) && item.hasTag?.(this.activeTagText)) {
            item.removeTag?.(this.activeTagText);
            await item.saveTx?.();
            removed++;
          }
          this.managedItemIDs.delete(id);
        }
        return { added, removed };
      }
      for (const id of citedUnion) {
        const item = resolveItem(id);
        if (!isItemWritable(item)) continue;
        if (!item.hasTag?.(this.activeTagText)) {
          item.addTag?.(this.activeTagText);
          await item.saveTx?.();
          this.managedItemIDs.add(id);
          added++;
        }
      }
      for (const id of [...this.managedItemIDs]) {
        if (citedUnion.has(id)) continue;
        const item = resolveItem(id);
        if (isItemWritable(item) && item.hasTag?.(this.activeTagText)) {
          item.removeTag?.(this.activeTagText);
          await item.saveTx?.();
          removed++;
        }
        this.managedItemIDs.delete(id);
      }
      return { added, removed };
    }
  };

  // src/domains/word-cite/word-poller.ts
  var WordIntegrationPoller = class {
    timer = null;
    unpatchExec = null;
    running = false;
    idleRounds = 0;
    kernel;
    tracker;
    constructor(kernel, tracker) {
      this.kernel = kernel;
      this.tracker = tracker;
    }
    start() {
      if (this.running) return;
      this.running = true;
      this.idleRounds = 0;
      this.installHooks();
      this.pollOnce();
      this.scheduleNext();
    }
    stop() {
      this.running = false;
      if (this.timer !== null) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.unpatchExec?.();
      this.unpatchExec = null;
    }
    pollOnce() {
      const integration = globalThis.Zotero?.Integration;
      const sessionsMap = integration?.sessions;
      if (!sessionsMap) return false;
      const rawSessions = [];
      const entries = sessionsMap instanceof Map ? [...sessionsMap.entries()] : Object.entries(sessionsMap);
      for (const [sessionID, session] of entries) {
        if (!session) continue;
        const citations = [];
        const byItem = session.citationsByItemID;
        if (byItem && typeof byItem === "object") {
          for (const [rawID, list] of Object.entries(byItem)) {
            const itemID = Number(rawID);
            if (!Number.isInteger(itemID) || itemID <= 0) continue;
            const first = Array.isArray(list) ? list[0] : list;
            const ordinal = Number(first?.citationIndex ?? first?.index ?? 1);
            const shortText = String(first?.properties?.formattedCitation || first?.text || "").trim();
            citations.push({ itemID, ordinal, shortText });
          }
        }
        const docPath = String(session.doc?.filePath || session.filePath || session.name || sessionID);
        rawSessions.push({ sessionID: String(sessionID), documentPath: docPath, citations });
      }
      const changed = this.tracker.syncSessions(rawSessions);
      if (changed) this.idleRounds = 0;
      else this.idleRounds = Math.min(10, this.idleRounds + 1);
      return changed;
    }
    installHooks() {
      const integration = globalThis.Zotero?.Integration;
      if (!integration || typeof integration.execCommand !== "function" || this.unpatchExec) return;
      this.unpatchExec = this.kernel.runtime.patch(
        integration,
        "execCommand",
        "Zotero.Integration",
        (orig) => async (...args) => {
          try {
            return await Promise.resolve(orig.apply(integration, args));
          } finally {
            this.idleRounds = 0;
            setTimeout(() => {
              if (this.running) this.pollOnce();
            }, 150);
          }
        }
      );
    }
    scheduleNext() {
      if (!this.running) return;
      const delay = this.idleRounds >= 5 ? 3e3 : 1200;
      this.timer = setTimeout(() => {
        this.timer = null;
        if (!this.running) return;
        try {
          this.pollOnce();
        } catch (err) {
          this.kernel.logger.error("word-cite:poll", err);
        }
        this.scheduleNext();
      }, delay);
    }
  };

  // src/domains/word-cite/module.ts
  var WordCiteDomainModule = class {
    id = "word-cite";
    enabledPref = "modules.wordCite.enable";
    tracker;
    tagGovernance;
    dragCite;
    column;
    poller;
    disposables = new DisposableStack();
    active = false;
    kernel;
    constructor(kernel, services) {
      this.kernel = kernel;
      this.tracker = new WordSessionTracker(kernel.bus, services.win32);
      this.tagGovernance = new CitationTagGovernance(kernel.prefs);
      this.dragCite = new DragCiteController(kernel, services.win32);
      this.column = new CitationColumnController(kernel, this.tracker);
      this.poller = new WordIntegrationPoller(kernel, this.tracker);
    }
    isActive() {
      return this.active;
    }
    start() {
      if (this.active) return;
      this.active = true;
      this.disposables.reset();
      this.column.register();
      this.poller.start();
      this.disposables.add(
        this.kernel.bus.on("citation:snapshot-updated", () => {
          void this.tagGovernance.syncCitedItems(this.tracker.getUnionCitedItemIDs());
        })
      );
      this.disposables.add(
        this.kernel.prefs.observeKeys(
          ["wordCite.citationTags.enable", "wordCite.citationTags.text"],
          () => {
            void this.tagGovernance.syncCitedItems(this.tracker.getUnionCitedItemIDs());
          }
        )
      );
    }
    onMainWindowLoad(win) {
      if (!this.active) return;
      this.dragCite.attachWindow(win);
    }
    onMainWindowUnload(win) {
      this.dragCite.detachWindow(win);
    }
    stop() {
      if (!this.active) return;
      this.active = false;
      this.poller.stop();
      this.column.unregister();
      this.dragCite.disposeAll();
      this.tracker.clear();
      this.disposables.disposeAll();
    }
  };

  // src/domains/workspace/spotlight-engine.ts
  var SpotlightEngine = class {
    providers = /* @__PURE__ */ new Map();
    tabs;
    constructor(tabs) {
      this.tabs = tabs;
    }
    registerProvider(provider) {
      this.providers.set(provider.id, provider);
      return () => {
        this.providers.delete(provider.id);
      };
    }
    query(rawTerm, win) {
      const term = rawTerm.trim().toLowerCase();
      const results = [];
      const tracked = this.tabs.buildTrackedTabs(win);
      for (const tab of tracked) {
        const haystack = `${tab.title} ${tab.remark} ${tab.source} ${tab.collection}`.toLowerCase();
        if (term && !haystack.includes(term)) continue;
        results.push({
          id: `tab:${tab.key}`,
          category: "tab",
          title: tab.remark ? `${tab.remark} · ${tab.title}` : tab.title,
          subtitle: [tab.source, tab.collection].filter(Boolean).join(" · ") || void 0,
          badge: tab.pinned ? "PIN" : tab.sleeping ? "SLEEP" : tab.virtual ? "VIRTUAL" : void 0,
          action: () => {
            if (tab.tabID) this.tabs.selectTab(win, tab.tabID);
            else void this.tabs.focusOrOpenItem(win, { itemID: tab.parentItemID, attachmentID: tab.itemID });
          }
        });
      }
      const sortedProviders = [...this.providers.values()].sort((a, b) => b.priority - a.priority);
      for (const provider of sortedProviders) {
        try {
          const extra = provider.query(term, win);
          if (extra?.length) results.push(...extra);
        } catch {
        }
      }
      return results;
    }
  };

  // src/domains/workspace/types.ts
  var GROUP_PALETTE = [
    "#2563EB",
    "#0D9488",
    "#D97706",
    "#DC2626",
    "#7C3AED",
    "#DB2777",
    "#059669",
    "#4F46E5"
  ];
  var MAX_REMARK_LENGTH = 300;
  var MAX_ROLLING_SESSIONS = 3;
  var MAX_MANUAL_SESSIONS = 30;

  // src/domains/workspace/state-store.ts
  function createEmptyState() {
    return {
      version: 1,
      groups: [],
      collapsed: [],
      pinnedKeys: [],
      sleepingKeys: [],
      remarks: {},
      lastViewedAt: {},
      virtualMembers: {},
      sessions: [],
      rollingSessions: []
    };
  }
  var WorkspaceStateStore = class {
    state = createEmptyState();
    prefs;
    listeners = /* @__PURE__ */ new Set();
    constructor(prefs) {
      this.prefs = prefs;
      this.load();
    }
    load() {
      const raw = this.prefs.get("workspace.state");
      if (!raw) {
        this.state = createEmptyState();
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        this.state = {
          ...createEmptyState(),
          ...parsed,
          groups: Array.isArray(parsed?.groups) ? parsed.groups : [],
          collapsed: Array.isArray(parsed?.collapsed) ? parsed.collapsed : [],
          pinnedKeys: Array.isArray(parsed?.pinnedKeys) ? parsed.pinnedKeys : [],
          sleepingKeys: Array.isArray(parsed?.sleepingKeys) ? parsed.sleepingKeys : [],
          remarks: parsed?.remarks && typeof parsed.remarks === "object" ? parsed.remarks : {},
          lastViewedAt: parsed?.lastViewedAt && typeof parsed.lastViewedAt === "object" ? parsed.lastViewedAt : {},
          virtualMembers: parsed?.virtualMembers && typeof parsed.virtualMembers === "object" ? parsed.virtualMembers : {},
          sessions: Array.isArray(parsed?.sessions) ? parsed.sessions : [],
          rollingSessions: Array.isArray(parsed?.rollingSessions) ? parsed.rollingSessions : []
        };
      } catch {
        this.state = createEmptyState();
      }
    }
    save() {
      try {
        this.prefs.set("workspace.state", JSON.stringify(this.state));
      } catch {
      }
      for (const fn of this.listeners) {
        try {
          fn();
        } catch {
        }
      }
    }
    onChange(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    createGroup(name, color) {
      const trimmed = name.trim() || "Group";
      const id = `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const chosen = color || GROUP_PALETTE[this.state.groups.length % GROUP_PALETTE.length];
      const group = { id, name: trimmed, color: chosen, memberKeys: [] };
      this.state.groups.push(group);
      this.save();
      return group;
    }
    renameGroup(groupId, name) {
      const group = this.state.groups.find((g) => g.id === groupId);
      const trimmed = name.trim();
      if (!group || !trimmed) return false;
      group.name = trimmed;
      this.save();
      return true;
    }
    setGroupColor(groupId, color) {
      const group = this.state.groups.find((g) => g.id === groupId);
      if (!group || !color) return false;
      group.color = color;
      this.save();
      return true;
    }
    restoreSessionLayout(session) {
      this.state.groups = session.groups.map((g) => ({ ...g, memberKeys: [...g.memberKeys] }));
      this.state.pinnedKeys = [...session.pinnedKeys];
      this.state.remarks = { ...this.state.remarks, ...session.remarks };
      this.save();
    }
    removeGroup(groupId) {
      const idx = this.state.groups.findIndex((g) => g.id === groupId);
      if (idx < 0) return false;
      this.state.groups.splice(idx, 1);
      this.state.collapsed = this.state.collapsed.filter((id) => id !== groupId);
      this.save();
      return true;
    }
    assignToGroup(key, groupId) {
      for (const g of this.state.groups) {
        g.memberKeys = g.memberKeys.filter((k) => k !== key);
      }
      if (groupId) {
        const target = this.state.groups.find((g) => g.id === groupId);
        if (target && !target.memberKeys.includes(key)) {
          target.memberKeys.push(key);
        }
      }
      this.save();
    }
    groupOfKey(key) {
      const found = this.state.groups.find((g) => g.memberKeys.includes(key));
      return found ? found.id : "";
    }
    setCollapsed(groupId, collapsed) {
      const set = new Set(this.state.collapsed);
      if (collapsed) set.add(groupId);
      else set.delete(groupId);
      this.state.collapsed = [...set];
      this.save();
    }
    setPinned(key, pinned) {
      const set = new Set(this.state.pinnedKeys);
      if (pinned) {
        set.add(key);
        this.state.sleepingKeys = this.state.sleepingKeys.filter((k) => k !== key);
      } else {
        set.delete(key);
      }
      this.state.pinnedKeys = [...set];
      this.save();
    }
    isPinned(key) {
      return this.state.pinnedKeys.includes(key);
    }
    setSleeping(key, sleeping) {
      if (sleeping && this.isPinned(key)) return;
      const set = new Set(this.state.sleepingKeys);
      if (sleeping) set.add(key);
      else set.delete(key);
      this.state.sleepingKeys = [...set];
      this.save();
    }
    isSleeping(key) {
      return this.state.sleepingKeys.includes(key);
    }
    setRemark(key, remark) {
      const clean = remark.trim().slice(0, MAX_REMARK_LENGTH);
      if (clean) this.state.remarks[key] = clean;
      else delete this.state.remarks[key];
      this.save();
    }
    touchViewed(key, now = Date.now()) {
      this.state.lastViewedAt[key] = now;
    }
    saveVirtualMember(meta) {
      this.state.virtualMembers[meta.key] = meta;
      this.save();
    }
    removeVirtualMember(key) {
      if (!(key in this.state.virtualMembers)) return;
      delete this.state.virtualMembers[key];
      this.save();
    }
    saveSession(name, options = {}) {
      const session = {
        id: `ses-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        name: name.trim() || (/* @__PURE__ */ new Date()).toLocaleString(),
        createdAt: Date.now(),
        isTemplate: Boolean(options.isTemplate),
        groups: this.state.groups.map((g) => ({
          ...g,
          memberKeys: options.isTemplate ? [] : [...g.memberKeys]
        })),
        pinnedKeys: options.isTemplate ? [] : [...this.state.pinnedKeys],
        remarks: options.isTemplate ? {} : { ...this.state.remarks }
      };
      if (options.rolling) {
        this.state.rollingSessions.unshift(session);
        this.state.rollingSessions = this.state.rollingSessions.slice(0, MAX_ROLLING_SESSIONS);
      } else {
        this.state.sessions.unshift(session);
        this.state.sessions = this.state.sessions.slice(0, MAX_MANUAL_SESSIONS);
      }
      this.save();
      return session;
    }
    exportJson() {
      return JSON.stringify({ format: "zotero-bridgeflow-workspace", version: 1, state: this.state }, null, 2);
    }
    importJson(jsonText) {
      try {
        const parsed = JSON.parse(jsonText);
        const incoming = parsed?.state ?? parsed;
        if (!incoming || !Array.isArray(incoming.groups)) return false;
        this.state = { ...createEmptyState(), ...incoming };
        this.save();
        return true;
      } catch {
        return false;
      }
    }
  };

  // src/domains/workspace/tab-controller.ts
  var WorkspaceTabController = class {
    prefs;
    store;
    clipboard;
    constructor(prefs, store, clipboard) {
      this.prefs = prefs;
      this.store = store;
      this.clipboard = clipboard;
    }
    tabKey(tab) {
      if (!tab) return "";
      if (tab.type === "library") return "library";
      const itemID = Number(tab.data?.itemID || tab.itemID || 0);
      if (itemID > 0) return `item:${itemID}`;
      return `tab:${String(tab.id || "")}`;
    }
    buildTrackedTabs(win) {
      const tabsApi = win.Zotero_Tabs;
      const nativeTabs = Array.isArray(tabsApi?._tabs) ? tabsApi._tabs : [];
      const hostItems = globalThis.Zotero?.Items;
      const tracked = [];
      const openKeys = /* @__PURE__ */ new Set();
      for (const tab of nativeTabs) {
        if (!tab || tab.type === "library") continue;
        const key = this.tabKey(tab);
        openKeys.add(key);
        const itemID = Number(tab.data?.itemID || 0);
        const rawItem = itemID > 0 ? hostItems?.get?.(itemID) : null;
        const parentItem = rawItem ? normalizeToRegularItem(rawItem) : null;
        const displayItem = parentItem || rawItem;
        const title = String(displayItem?.getField?.("title") || tab.title || key);
        const shortTitle = String(displayItem?.getField?.("shortTitle") || title);
        const filename = String(rawItem?.attachmentFilename || "");
        const source = String(displayItem?.getField?.("publicationTitle") || displayItem?.getField?.("proceedingsTitle") || "");
        const creatorYear = this.formatCreatorYear(displayItem);
        const collection = this.resolvePrimaryCollectionName(displayItem);
        tracked.push({
          tabID: String(tab.id || ""),
          key,
          type: String(tab.type || "reader"),
          itemID,
          parentItemID: Number(parentItem?.id || itemID),
          title,
          shortTitle,
          filename,
          source,
          creatorYear,
          collection,
          groupId: this.store.groupOfKey(key),
          pinned: this.store.isPinned(key),
          sleeping: this.store.isSleeping(key),
          virtual: false,
          remark: this.store.state.remarks[key] || "",
          lastViewedAt: this.store.state.lastViewedAt[key] || 0
        });
      }
      if (this.prefs.get("workspace.enableVirtualMembers")) {
        for (const [key, meta] of Object.entries(this.store.state.virtualMembers)) {
          if (openKeys.has(key)) continue;
          const groupId = this.store.groupOfKey(key);
          if (!groupId) continue;
          tracked.push({
            tabID: "",
            key,
            type: meta.type || "reader",
            itemID: meta.itemID,
            parentItemID: meta.parentItemID || meta.itemID,
            title: meta.title,
            shortTitle: meta.shortTitle || meta.title,
            filename: meta.filename || "",
            source: meta.source || "",
            creatorYear: meta.creatorYear || "",
            collection: meta.collection || "",
            groupId,
            pinned: false,
            sleeping: false,
            virtual: true,
            remark: this.store.state.remarks[key] || "",
            lastViewedAt: this.store.state.lastViewedAt[key] || 0
          });
        }
      }
      return tracked;
    }
    selectTab(win, tabID) {
      const tabsApi = win.Zotero_Tabs;
      if (!tabsApi?.select) return false;
      const tracked = this.buildTrackedTabs(win).find((t) => t.tabID === tabID);
      if (tracked) {
        if (tracked.sleeping) this.store.setSleeping(tracked.key, false);
        if (tracked.groupId && this.store.state.collapsed.includes(tracked.groupId)) {
          this.store.setCollapsed(tracked.groupId, false);
        }
        this.store.touchViewed(tracked.key);
      }
      tabsApi.select(tabID);
      return true;
    }
    async closeTabs(win, tabIDs, options = {}) {
      const tabsApi = win.Zotero_Tabs;
      if (!tabsApi?.close || !tabIDs.length) return 0;
      const selectedID = String(tabsApi.selectedID || "");
      const trackedByID = new Map(this.buildTrackedTabs(win).map((t) => [t.tabID, t]));
      const toClose = [];
      for (const id of new Set(tabIDs)) {
        const t = trackedByID.get(id);
        if (!t || t.virtual) continue;
        if (options.protectPinned && t.pinned) continue;
        if (options.protectSelected && id === selectedID) continue;
        if (t.groupId && (options.preserveVirtual ?? true) && this.prefs.get("workspace.enableVirtualMembers")) {
          this.store.saveVirtualMember({
            key: t.key,
            itemID: t.itemID,
            parentItemID: t.parentItemID,
            title: t.title,
            shortTitle: t.shortTitle,
            filename: t.filename,
            source: t.source,
            creatorYear: t.creatorYear,
            collection: t.collection,
            type: t.type
          });
        }
        toClose.push(id);
      }
      if (!toClose.length) return 0;
      tabsApi.close(toClose.length === 1 ? toClose[0] : toClose);
      return toClose.length;
    }
    sleepTab(win, tabID) {
      if (!this.prefs.get("workspace.enableTabSleep")) return false;
      const tabsApi = win.Zotero_Tabs;
      const tracked = this.buildTrackedTabs(win).find((t) => t.tabID === tabID);
      if (!tracked || tracked.pinned || tracked.virtual) return false;
      if (typeof tabsApi?.unload === "function") {
        tabsApi.unload(tabID);
      }
      this.store.setSleeping(tracked.key, true);
      return true;
    }
    async reloadTab(win, tabID) {
      const tracked = this.buildTrackedTabs(win).find((t) => t.tabID === tabID);
      if (!tracked) return false;
      this.store.setSleeping(tracked.key, false);
      this.selectTab(win, tabID);
      const reader = globalThis.Zotero?.Reader?.getByTabID?.(tabID);
      if (typeof reader?.reload === "function") {
        await reader.reload();
      }
      return true;
    }
    async archiveAndCloseGroup(win, groupId) {
      const group = this.store.state.groups.find((g) => g.id === groupId);
      if (!group) return 0;
      const ids = this.buildTrackedTabs(win).filter((t) => t.groupId === groupId && t.tabID).map((t) => t.tabID);
      this.store.saveSession(group.name);
      return this.closeTabs(win, ids, { preserveVirtual: true, protectPinned: true });
    }
    autoGroupByCollection(win) {
      const strategy = this.prefs.get("workspace.multiCollectionStrategy");
      const activeColName = String(win.ZoteroPane?.getSelectedCollection?.()?.name || "");
      const tracked = this.buildTrackedTabs(win).filter((t) => !t.virtual && !t.groupId);
      const hostItems = globalThis.Zotero?.Items;
      const hostCols = globalThis.Zotero?.Collections;
      let grouped = 0;
      for (const tab of tracked) {
        const item = hostItems?.get?.(tab.parentItemID || tab.itemID);
        const colIDs = item?.getCollections?.() || [];
        const colNames = colIDs.map((id) => String(hostCols?.get?.(id)?.name || "")).filter(Boolean);
        if (!colNames.length) continue;
        let chosen = "";
        if (strategy === "active" && activeColName && colNames.includes(activeColName)) {
          chosen = activeColName;
        } else if (strategy === "existing") {
          chosen = colNames.find((n) => this.store.state.groups.some((g) => g.name === n)) || colNames[0];
        } else {
          chosen = colNames[0];
        }
        if (!chosen) continue;
        let group = this.store.state.groups.find((g) => g.name === chosen);
        if (!group) group = this.store.createGroup(chosen);
        this.store.assignToGroup(tab.key, group.id);
        grouped++;
      }
      return grouped;
    }
    getDisplayTitle(tab) {
      const titleMode = this.prefs.get("workspace.verticalTabTitleMode");
      const base = titleMode === "shortTitle" && tab.shortTitle ? tab.shortTitle : titleMode === "filename" && tab.filename ? tab.filename : tab.title;
      if (!this.prefs.get("workspace.enableTabRemarks") || !tab.remark) return base;
      const mode = this.prefs.get("workspace.remarkDisplayMode");
      if (mode === "remark") return tab.remark;
      if (mode === "title") return base;
      return `${tab.remark} · ${base}`;
    }
    /**
     * Unified copy citation action — delegates to shared UnifiedClipboardService
     * so tab-menu copies automatically populate reverse-lookup history.
     */
    async copyTabCitation(win, tabID) {
      const tracked = this.buildTrackedTabs(win).find((t) => t.tabID === tabID);
      if (!tracked) return false;
      const hostItems = globalThis.Zotero?.Items;
      const item = hostItems?.get?.(tracked.parentItemID || tracked.itemID);
      if (!item) return false;
      return this.clipboard.copyItems([item], { source: "tab-menu" });
    }
    /**
     * Cross-domain hook: focus an already-open tab matching itemID/attachmentID,
     * or open it in reader and optionally assign it to the active tab's group.
     */
    async focusOrOpenItem(win, req) {
      const tracked = this.buildTrackedTabs(win);
      const match = tracked.find(
        (t) => !t.virtual && (t.parentItemID === req.itemID || t.itemID === req.itemID || req.attachmentID && t.itemID === req.attachmentID)
      );
      if (match && (req.preferExistingTab ?? true)) {
        this.selectTab(win, match.tabID);
        return "focused";
      }
      const reader = globalThis.Zotero?.Reader;
      const targetAttachmentID = req.attachmentID || req.itemID;
      if (typeof reader?.open === "function" && targetAttachmentID > 0) {
        await reader.open(targetAttachmentID);
        if (req.assignToActiveGroup) {
          const selectedID = String(win.Zotero_Tabs?.selectedID || "");
          const activeTab = tracked.find((t) => t.tabID === selectedID);
          if (activeTab?.groupId) {
            this.store.assignToGroup(`item:${targetAttachmentID}`, activeTab.groupId);
          }
        }
        return "opened";
      }
      return "not-found";
    }
    /**
     * Cross-domain hook: group all currently open tabs whose parent/item ID
     * belongs to the provided set (e.g. items cited in the active Word document).
     */
    groupOpenTabsByItemIDs(win, groupName, itemIDs) {
      const idSet = new Set(itemIDs);
      if (!idSet.size) return null;
      const matching = this.buildTrackedTabs(win).filter(
        (t) => !t.virtual && (idSet.has(t.parentItemID) || idSet.has(t.itemID))
      );
      if (!matching.length) return null;
      const existing = this.store.state.groups.find((g) => g.name === groupName);
      const group = existing ?? this.store.createGroup(groupName);
      for (const tab of matching) {
        this.store.assignToGroup(tab.key, group.id);
      }
      return { groupId: group.id, count: matching.length };
    }
    findStaleTabs(win, now = Date.now()) {
      const days = this.prefs.get("workspace.staleSuggestDays");
      const cutoff = now - days * 864e5;
      return this.buildTrackedTabs(win).filter(
        (t) => !t.virtual && !t.pinned && t.lastViewedAt > 0 && t.lastViewedAt < cutoff
      );
    }
    formatCreatorYear(item) {
      if (!item) return "";
      const first = String(item.firstCreator || "");
      const date = String(item.getField?.("year") || item.getField?.("date") || "").slice(0, 4);
      return [first, date].filter(Boolean).join(", ");
    }
    resolvePrimaryCollectionName(item) {
      if (!item || typeof item.getCollections !== "function") return "";
      const ids = item.getCollections() || [];
      if (!ids.length) return "";
      const col = globalThis.Zotero?.Collections?.get?.(ids[0]);
      return String(col?.name || "");
    }
  };

  // src/domains/workspace/workspace-icons.ts
  var SVG_NS = "http://www.w3.org/2000/svg";
  var ICON_PATHS = {
    bridge: "M2 11 C4 4, 12 4, 14 11 M1.5 11 H14.5 M5.5 7.5 V11 M8 5.5 V11 M10.5 7.5 V11",
    plus: "M8 3 V13 M3 8 H13",
    folder: "M2 4.5 C2 3.7 2.7 3 3.5 3 H6.5 L8 4.5 H12.5 C13.3 4.5 14 5.2 14 6 V11.5 C14 12.3 13.3 13 12.5 13 H3.5 C2.7 13 2 12.3 2 11.5 Z",
    sleep: "M11.5 10.5 A4.5 4.5 0 0 1 5.5 4.5 A5 5 0 1 0 11.5 10.5 Z",
    sidebar: "M2.5 3 H13.5 V13 H2.5 Z M6 3 V13",
    search: "M7 11.5 A4.5 4.5 0 1 1 7 2.5 A4.5 4.5 0 0 1 7 11.5 Z M10.5 10.5 L14 14",
    pin: "M5 3 H11 L10 7.5 L12 9.5 H8 V13.5 M8 9.5 H4 L6 7.5 Z",
    close: "M4 4 L12 12 M12 4 L4 12",
    archive: "M2.5 3.5 H13.5 V6 H2.5 Z M3.5 6 V12.5 H12.5 V6 M6.5 8.5 H9.5"
  };
  function createWorkspaceIcon(doc, name, size = 14) {
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "none");
    svg.setAttribute("class", "zbf-tb-icon");
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", ICON_PATHS[name]);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
    return svg;
  }

  // src/domains/workspace/horizontal-bar.ts
  var HorizontalBarController = class {
    groupBar = null;
    pinnedStrip = null;
    toolbarBar = null;
    badges = /* @__PURE__ */ new Map();
    draggedKey = null;
    win;
    doc;
    prefs;
    store;
    tabs;
    menus;
    hover;
    spotlightPanel;
    workspacePopover;
    onRefresh;
    constructor(win, doc, prefs, store, tabs, menus, hover, spotlightPanel, workspacePopover, onRefresh) {
      this.win = win;
      this.doc = doc;
      this.prefs = prefs;
      this.store = store;
      this.tabs = tabs;
      this.menus = menus;
      this.hover = hover;
      this.spotlightPanel = spotlightPanel;
      this.workspacePopover = workspacePopover;
      this.onRefresh = onRefresh;
    }
    setCitationBadges(badges) {
      this.badges = badges;
      this.render();
    }
    mount() {
      const host2 = this.doc?.getElementById?.("tab-bar-container");
      const inner = host2?.querySelector(".tab-bar-inner-container");
      if (!host2 || !inner) return false;
      if (!this.pinnedStrip) {
        const strip = this.h("div", "zbf-pinned-strip");
        strip.hidden = true;
        this.bindWheel(strip);
        this.pinnedStrip = strip;
      }
      if (!this.groupBar) {
        const bar = this.h("div");
        bar.id = "zbf-inline";
        this.bindWheel(bar);
        this.groupBar = bar;
      }
      const wrapper = inner.querySelector(".tabs-wrapper");
      if (this.pinnedStrip.parentElement !== inner) inner.insertBefore(this.pinnedStrip, wrapper);
      if (this.groupBar.parentElement !== inner) inner.insertBefore(this.groupBar, wrapper);
      if (!this.toolbarBar) {
        const actions = this.h("div");
        actions.id = "zbf-toolbar-actions";
        this.toolbarBar = actions;
      }
      const nativeToolbar = this.doc.getElementById("zotero-tabs-toolbar") || inner;
      if (this.toolbarBar.parentElement !== nativeToolbar) {
        nativeToolbar.append(this.toolbarBar);
      }
      return true;
    }
    render() {
      const host2 = this.doc?.getElementById?.("tab-bar-container");
      if (!host2 || !this.mount()) return;
      const compactTop = this.prefs.get("workspace.enableVerticalSidebar") && !this.prefs.get("workspace.verticalSidebarCollapsed") && this.prefs.get("workspace.compactTopBar");
      const inlineOn = this.prefs.get("workspace.enableHorizontalGroups") && !compactTop;
      host2.toggleAttribute("data-zbf-inline", inlineOn);
      if (this.groupBar) this.groupBar.hidden = !inlineOn;
      if (inlineOn) {
        const tracked = this.tabs.buildTrackedTabs(this.win);
        this.renderPinned(tracked);
        this.renderGroupedTabs(tracked);
      } else if (this.pinnedStrip) {
        this.pinnedStrip.hidden = true;
      }
      this.renderToolbarButtons();
    }
    dispose() {
      this.pinnedStrip?.remove();
      this.pinnedStrip = null;
      this.groupBar?.remove();
      this.groupBar = null;
      this.toolbarBar?.remove();
      this.toolbarBar = null;
    }
    renderPinned(tracked) {
      if (!this.pinnedStrip) return;
      const pinned = this.prefs.get("workspace.enablePinnedTabs") ? tracked.filter((t) => !t.virtual && t.pinned) : [];
      this.pinnedStrip.hidden = pinned.length === 0;
      this.pinnedStrip.textContent = "";
      if (!pinned.length) return;
      const selectedID = String(this.win.Zotero_Tabs?.selectedID || "");
      const iconOnly = this.prefs.get("workspace.pinnedIconOnly");
      for (const tab of pinned) {
        const chip = this.h("button", `zbf-pinned-chip${tab.tabID === selectedID ? " selected" : ""}${iconOnly ? " icon-only" : ""}`);
        chip.type = "button";
        chip.title = this.tabs.getDisplayTitle(tab);
        chip.append(createWorkspaceIcon(this.doc, "pin", 12));
        if (!iconOnly) {
          const span = this.h("span");
          span.textContent = this.tabs.getDisplayTitle(tab);
          chip.append(span);
        }
        chip.addEventListener("click", () => {
          this.tabs.selectTab(this.win, tab.tabID);
          this.onRefresh();
        });
        chip.addEventListener("contextmenu", (e) => this.menus.openTabMenu(e, tab));
        this.pinnedStrip.append(chip);
      }
    }
    renderGroupedTabs(tracked) {
      if (!this.groupBar || this.groupBar.querySelector(".zbf-inline-edit")) return;
      this.groupBar.textContent = "";
      const selectedID = String(this.win.Zotero_Tabs?.selectedID || "");
      const unpinned = tracked.filter((t) => !t.pinned);
      for (const group of this.store.state.groups) {
        const members = unpinned.filter((t) => t.groupId === group.id);
        const collapsed = this.store.state.collapsed.includes(group.id);
        const section = this.h("div", "zbf-hsection");
        section.setAttribute("data-grouped", "true");
        section.style.setProperty("--zbf-gcolor", group.color);
        const pill = this.h("button", "zbf-group-pill");
        pill.type = "button";
        pill.style.backgroundColor = group.color;
        pill.textContent = `${group.name} (${members.length})`;
        pill.addEventListener("click", () => {
          this.store.setCollapsed(group.id, !collapsed);
          this.onRefresh();
        });
        pill.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          this.beginInlineEdit(pill, group.name, (val) => this.store.renameGroup(group.id, val));
        });
        pill.addEventListener("contextmenu", (e) => this.menus.openGroupMenu(e, group));
        pill.addEventListener("dragover", (e) => {
          if (this.draggedKey) e.preventDefault();
        });
        pill.addEventListener("drop", (e) => {
          e.preventDefault();
          if (this.draggedKey) {
            this.store.assignToGroup(this.draggedKey, group.id);
            this.draggedKey = null;
            this.onRefresh();
          }
        });
        section.append(pill);
        if (!collapsed) {
          for (const tab of members) section.append(this.buildTabChip(tab, selectedID, group.name));
        }
        this.groupBar.append(section);
      }
      const ungrouped = unpinned.filter((t) => !t.groupId);
      if (ungrouped.length) {
        const loose = this.h("div", "zbf-hsection");
        for (const tab of ungrouped) loose.append(this.buildTabChip(tab, selectedID, ""));
        this.groupBar.append(loose);
      }
      const addBtn = this.h("button", "zbf-add-group");
      addBtn.type = "button";
      addBtn.title = "New Tab Group";
      addBtn.append(createWorkspaceIcon(this.doc, "plus", 13));
      addBtn.addEventListener("click", () => {
        this.beginInlineEdit(addBtn, "", (val) => {
          this.store.createGroup(val);
        }, "Group name...");
      });
      this.groupBar.append(addBtn);
    }
    buildTabChip(tab, selectedID, groupName) {
      const cls = [
        "zbf-htab",
        tab.tabID && tab.tabID === selectedID ? "selected" : "",
        tab.sleeping ? "sleeping" : "",
        tab.virtual ? "virtual" : ""
      ].filter(Boolean).join(" ");
      const chip = this.h("div", cls);
      chip.draggable = true;
      chip.addEventListener("dragstart", () => {
        this.draggedKey = tab.key;
      });
      chip.addEventListener("dragend", () => {
        this.draggedKey = null;
      });
      const title = this.h("span", "zbf-htab-title");
      const badge = this.badges.get(tab.parentItemID) || this.badges.get(tab.itemID);
      const prefix = tab.virtual ? "◌ " : badge && this.prefs.get("fusion.sidebarCiteBadge") ? `[${badge.ordinal}] ` : "";
      title.textContent = `${prefix}${this.tabs.getDisplayTitle(tab)}`;
      chip.append(title);
      if (tab.tabID) {
        const closeBtn = this.h("button", "zbf-htab-close");
        closeBtn.type = "button";
        closeBtn.append(createWorkspaceIcon(this.doc, "close", 11));
        closeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          void this.tabs.closeTabs(this.win, [tab.tabID], { protectPinned: true }).then(() => this.onRefresh());
        });
        chip.append(closeBtn);
      }
      chip.addEventListener("click", () => {
        if (tab.tabID) this.tabs.selectTab(this.win, tab.tabID);
        else void this.tabs.focusOrOpenItem(this.win, { itemID: tab.parentItemID, attachmentID: tab.itemID });
        this.onRefresh();
      });
      chip.addEventListener("auxclick", (e) => {
        if (e.button === 1 && tab.tabID) {
          e.preventDefault();
          void this.tabs.closeTabs(this.win, [tab.tabID], { protectPinned: true }).then(() => this.onRefresh());
        }
      });
      chip.addEventListener("contextmenu", (e) => this.menus.openTabMenu(e, tab));
      if (this.prefs.get("workspace.enableHoverPreview")) {
        chip.addEventListener("mouseenter", () => this.hover.scheduleShow(chip, tab, groupName, badge));
        chip.addEventListener("mouseleave", () => this.hover.hide());
      }
      return chip;
    }
    renderToolbarButtons() {
      if (!this.toolbarBar) return;
      this.toolbarBar.textContent = "";
      if (this.prefs.get("workspace.enableVerticalSidebar")) {
        const collapsed = this.prefs.get("workspace.verticalSidebarCollapsed");
        this.toolbarBar.append(this.mkBtn("sidebar", "侧栏", "Toggle vertical sidebar", !collapsed, () => {
          this.prefs.set("workspace.verticalSidebarCollapsed", !collapsed);
          this.onRefresh();
        }));
      }
      this.toolbarBar.append(this.mkBtn("folder", "归组", "Auto-group tabs by Zotero collection", false, () => {
        this.tabs.autoGroupByCollection(this.win);
        this.onRefresh();
      }));
      if (this.prefs.get("workspace.enableSessions")) {
        const wsBtn = this.mkBtn("archive", "工作区", "Workspaces & Snapshots", false, () => {
          this.workspacePopover.toggle(wsBtn);
        });
        this.toolbarBar.append(wsBtn);
      }
      if (this.prefs.get("workspace.enableSpotlight")) {
        const spotBtn = this.mkBtn("search", "Spotlight", "Spotlight Search (Ctrl+P)", false, () => {
          this.spotlightPanel.toggle(spotBtn);
        });
        this.toolbarBar.append(spotBtn);
      }
      if (this.prefs.get("workspace.enableTabSleep")) {
        this.toolbarBar.append(this.mkBtn("sleep", "休眠", "Sleep inactive tabs", false, () => {
          const selectedID = String(this.win.Zotero_Tabs?.selectedID || "");
          for (const tab of this.tabs.buildTrackedTabs(this.win)) {
            if (tab.tabID && tab.tabID !== selectedID && !tab.pinned && !tab.sleeping && !tab.virtual) {
              this.tabs.sleepTab(this.win, tab.tabID);
            }
          }
          this.onRefresh();
        }));
      }
    }
    beginInlineEdit(anchor, initial, onCommit, placeholder = "") {
      const input = this.h("input", "zbf-inline-edit");
      input.type = "text";
      input.value = initial;
      if (placeholder) input.placeholder = placeholder;
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        input.replaceWith(anchor);
        if (save && input.value.trim()) onCommit(input.value.trim());
        this.onRefresh();
      };
      input.addEventListener("keydown", (e) => {
        const ke = e;
        e.stopPropagation();
        if (ke.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (ke.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      });
      input.addEventListener("blur", () => finish(true));
      anchor.replaceWith(input);
      input.focus();
      input.select();
    }
    bindWheel(area) {
      area.addEventListener("wheel", (e) => {
        if (e.ctrlKey || area.scrollWidth <= area.clientWidth) return;
        e.preventDefault();
        area.scrollLeft += e.deltaX || e.deltaY;
      }, { passive: false });
    }
    mkBtn(icon, label, title, pressed, onClick) {
      const btn = this.h("button", "zbf-tb-btn");
      btn.type = "button";
      btn.title = title;
      btn.setAttribute("aria-pressed", String(pressed));
      const span = this.h("span");
      span.textContent = label;
      btn.append(createWorkspaceIcon(this.doc, icon, 14), span);
      btn.addEventListener("click", onClick);
      return btn;
    }
    h(tag, className) {
      const el = this.doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
      if (className) el.className = className;
      return el;
    }
  };

  // src/domains/workspace/hover-card.ts
  var HoverCardController = class {
    card = null;
    showTimer = null;
    win;
    doc;
    constructor(win, doc) {
      this.win = win;
      this.doc = doc;
    }
    scheduleShow(anchor, tab, groupName, badge) {
      this.hide();
      this.showTimer = this.win.setTimeout?.(() => {
        this.showTimer = null;
        this.show(anchor, tab, groupName, badge);
      }, 380) ?? null;
    }
    hide() {
      if (this.showTimer !== null) {
        this.win.clearTimeout?.(this.showTimer);
        this.showTimer = null;
      }
      if (this.card) this.card.hidden = true;
    }
    dispose() {
      this.hide();
      this.card?.remove();
      this.card = null;
    }
    ensureCard() {
      if (this.card?.isConnected) return this.card;
      const root = this.doc?.documentElement;
      if (!root) return null;
      const el = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      el.id = "zbf-hover-card";
      el.className = "zbf-hover-card";
      el.hidden = true;
      root.append(el);
      this.card = el;
      return el;
    }
    show(anchor, tab, groupName, badge) {
      const card = this.ensureCard();
      if (!card) return;
      card.textContent = "";
      const title = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      title.className = "zbf-hc-title";
      title.textContent = tab.title;
      card.append(title);
      const lines = [];
      if (tab.creatorYear) lines.push(tab.creatorYear);
      if (tab.source) lines.push(tab.source);
      if (tab.collection) lines.push(`Collection: ${tab.collection}`);
      if (groupName) lines.push(`Group: ${groupName}`);
      if (tab.remark) lines.push(`Note: ${tab.remark}`);
      if (badge) lines.push(`Word [${badge.ordinal}] · ${badge.documentName}`);
      if (tab.lastViewedAt > 0) {
        lines.push(`Viewed: ${new Date(tab.lastViewedAt).toLocaleString()}`);
      }
      for (const line of lines) {
        const row = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
        row.className = "zbf-hc-meta";
        row.textContent = line;
        card.append(row);
      }
      const rect = anchor.getBoundingClientRect();
      card.style.left = `${Math.min((this.win.innerWidth || 900) - 300, Math.max(8, rect.right + 8))}px`;
      card.style.top = `${Math.min((this.win.innerHeight || 700) - 180, Math.max(8, rect.top))}px`;
      card.hidden = false;
    }
  };

  // src/domains/workspace/item-context-menu.ts
  var ItemContextMenuController = class {
    itemMenuEl = null;
    entryEl = null;
    subPopup = null;
    win;
    doc;
    prefs;
    store;
    tabs;
    onRefresh;
    constructor(win, doc, prefs, store, tabs, onRefresh) {
      this.win = win;
      this.doc = doc;
      this.prefs = prefs;
      this.store = store;
      this.tabs = tabs;
      this.onRefresh = onRefresh;
    }
    attach() {
      const itemMenu = this.doc?.getElementById?.("zotero-itemmenu");
      if (!itemMenu || this.itemMenuEl) return;
      const menu = this.xul("menu");
      menu.id = "zbf-item-open-group";
      menu.setAttribute("label", "BridgeFlow：打开并分组");
      const sub = this.xul("menupopup");
      menu.append(sub);
      itemMenu.append(menu);
      itemMenu.addEventListener("popupshowing", this.onMenuShowing);
      sub.addEventListener("popupshowing", this.onSubShowing);
      this.itemMenuEl = itemMenu;
      this.entryEl = menu;
      this.subPopup = sub;
    }
    dispose() {
      this.itemMenuEl?.removeEventListener("popupshowing", this.onMenuShowing);
      this.subPopup?.removeEventListener("popupshowing", this.onSubShowing);
      this.entryEl?.remove();
      this.itemMenuEl = null;
      this.entryEl = null;
      this.subPopup = null;
    }
    onMenuShowing = () => {
      const enabled = this.prefs.get("workspace.enableItemContextMenu");
      const selected = this.win.ZoteroPane?.getSelectedItems?.() || [];
      if (this.entryEl) {
        this.entryEl.hidden = !enabled;
        if (!selected.length) this.entryEl.setAttribute("disabled", "true");
        else this.entryEl.removeAttribute("disabled");
      }
    };
    onSubShowing = () => {
      if (!this.subPopup) return;
      this.subPopup.textContent = "";
      const selected = this.win.ZoteroPane?.getSelectedItems?.() || [];
      this.addItem(this.subPopup, "+ 打开到新分组…", () => {
        this.win.setTimeout?.(() => {
          const promptSvc = globalThis.Services?.prompt;
          const fallback = String(selected[0]?.getField?.("title") || "New Group").slice(0, 30);
          const input = { value: fallback };
          if (promptSvc?.prompt && !promptSvc.prompt(this.win, "打开到新分组", "分组名称：", input, null, {})) return;
          const g = this.store.createGroup(input.value || fallback);
          void this.openIntoGroup(selected, g.id);
        }, 0);
      });
      if (this.store.state.groups.length) this.subPopup.append(this.xul("menuseparator"));
      for (const g of this.store.state.groups) {
        this.addItem(this.subPopup, g.name, () => {
          void this.openIntoGroup(selected, g.id);
        });
      }
    };
    async openIntoGroup(items, groupId) {
      for (const it of items) {
        const best = typeof it.getBestAttachment === "function" ? await it.getBestAttachment().catch(() => null) : null;
        const targetID = Number(best?.id || it.id || 0);
        if (!targetID) continue;
        await this.tabs.focusOrOpenItem(this.win, { itemID: it.id, attachmentID: targetID, preferExistingTab: true });
        this.store.assignToGroup(`item:${targetID}`, groupId);
      }
      this.onRefresh();
    }
    xul(tag) {
      return this.doc.createXULElement ? this.doc.createXULElement(tag) : this.doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", tag);
    }
    addItem(popup, label, action) {
      const mi = this.xul("menuitem");
      mi.setAttribute("label", label);
      mi.addEventListener("command", action);
      popup.append(mi);
    }
  };

  // src/domains/workspace/spotlight-panel.ts
  var SpotlightPanelController = class {
    panel = null;
    input = null;
    resultsEl = null;
    entries = [];
    activeIndex = 0;
    win;
    doc;
    engine;
    constructor(win, doc, engine) {
      this.win = win;
      this.doc = doc;
      this.engine = engine;
    }
    open(anchor) {
      this.ensureMounted();
      if (!this.panel || !this.input) return;
      this.input.value = "";
      this.activeIndex = 0;
      this.renderResults();
      try {
        if (anchor && typeof this.panel.openPopup === "function") {
          this.panel.openPopup(anchor, "bottomleft topleft", 0, 4, false, false);
        } else if (typeof this.panel.openPopupAtScreen === "function") {
          const x = Math.round((this.win.screenX || 0) + (this.win.outerWidth || 1e3) / 2 - 240);
          const y = Math.round((this.win.screenY || 0) + 120);
          this.panel.openPopupAtScreen(x, y, false);
        }
      } catch {
      }
    }
    close() {
      try {
        this.panel?.hidePopup?.();
      } catch {
      }
    }
    toggle(anchor) {
      if (this.panel?.state === "open") this.close();
      else this.open(anchor);
    }
    dispose() {
      this.close();
      this.panel?.remove?.();
      this.panel = null;
      this.input = null;
      this.resultsEl = null;
    }
    ensureMounted() {
      if (this.panel) return;
      const popupset = this.doc.getElementById("mainPopupSet") || this.doc.querySelector("popupset");
      if (!popupset) return;
      const xul = this.doc.createXULElement ? this.doc.createXULElement("panel") : this.doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "panel");
      xul.id = "zbf-spotlight-panel";
      xul.setAttribute("orient", "vertical");
      const box = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      box.className = "zbf-spot-box";
      const input = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "input");
      input.type = "search";
      input.className = "zbf-spot-input";
      input.placeholder = "Search tabs, remarks, Word citations, or commands...";
      const results = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      results.className = "zbf-spot-results";
      box.append(input, results);
      xul.append(box);
      popupset.append(xul);
      xul.addEventListener("popupshown", () => {
        input.focus();
        input.select();
      });
      input.addEventListener("input", () => {
        this.activeIndex = 0;
        this.renderResults();
      });
      box.addEventListener("keydown", (e) => {
        if (e.isComposing) return;
        if (e.key === "Escape") {
          e.preventDefault();
          this.close();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          this.activeIndex = Math.min(Math.max(0, this.entries.length - 1), this.activeIndex + 1);
          this.highlightActive();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          this.activeIndex = Math.max(0, this.activeIndex - 1);
          this.highlightActive();
        } else if (e.key === "Enter") {
          e.preventDefault();
          const item = this.entries[this.activeIndex];
          if (item) {
            void item.action();
            this.close();
          }
        }
      });
      this.panel = xul;
      this.input = input;
      this.resultsEl = results;
    }
    renderResults() {
      if (!this.resultsEl || !this.input) return;
      this.entries = this.engine.query(this.input.value, this.win);
      this.resultsEl.textContent = "";
      if (!this.entries.length) {
        const empty = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
        empty.style.cssText = "padding:10px;opacity:0.65;text-align:center;";
        empty.textContent = "No matching tabs or commands";
        this.resultsEl.append(empty);
        return;
      }
      this.entries.forEach((entry, idx) => {
        const row = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
        row.type = "button";
        row.className = `zbf-spot-row${idx === this.activeIndex ? " active" : ""}`;
        const title = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
        title.textContent = entry.title;
        row.append(title);
        if (entry.badge) {
          const badge = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
          badge.className = "zbf-spot-badge";
          badge.textContent = entry.badge;
          row.append(badge);
        }
        row.addEventListener("click", () => {
          void entry.action();
          this.close();
        });
        this.resultsEl.append(row);
      });
    }
    highlightActive() {
      if (!this.resultsEl) return;
      Array.from(this.resultsEl.children).forEach((el, idx) => {
        el.classList.toggle("active", idx === this.activeIndex);
      });
    }
  };

  // src/domains/workspace/tab-context-menu.ts
  var TabContextMenuController = class {
    popups = /* @__PURE__ */ new Set();
    win;
    doc;
    prefs;
    store;
    tabs;
    onRefresh;
    constructor(win, doc, prefs, store, tabs, onRefresh) {
      this.win = win;
      this.doc = doc;
      this.prefs = prefs;
      this.store = store;
      this.tabs = tabs;
      this.onRefresh = onRefresh;
    }
    openTabMenu(event, tab) {
      if (!this.prefs.get("workspace.enableTabContextMenu")) return;
      event.preventDefault();
      event.stopPropagation();
      this.openAt(event, (popup) => {
        if (this.prefs.get("workspace.enablePinnedTabs")) {
          this.addItem(popup, tab.pinned ? "Unpin Tab" : "📌 Pin Tab (Protect)", () => {
            this.store.setPinned(tab.key, !tab.pinned);
            this.onRefresh();
          });
        }
        if (this.prefs.get("workspace.enableTabRemarks")) {
          this.addItem(popup, tab.remark ? "✎ Edit Tab Remark…" : "✎ Set Tab Remark…", () => {
            this.deferPrompt("Tab Remark", "Remark (max 300 chars):", tab.remark, (val) => {
              this.store.setRemark(tab.key, val);
              this.onRefresh();
            });
          });
        }
        if (this.prefs.get("workspace.enableTabSleep") && !tab.pinned && tab.tabID) {
          this.addItem(popup, tab.sleeping ? "⚡ Wake Tab" : "💤 Sleep Tab (Free Memory)", () => {
            if (tab.sleeping) this.tabs.selectTab(this.win, tab.tabID);
            else this.tabs.sleepTab(this.win, tab.tabID);
            this.onRefresh();
          });
        }
        const moveMenu = this.xul("menu");
        moveMenu.setAttribute("label", "Move to Group");
        const movePop = this.xul("menupopup");
        moveMenu.append(movePop);
        popup.append(moveMenu);
        this.addItem(movePop, "+ New Group…", () => {
          this.deferPrompt("New Group", "Group name:", "", (name) => {
            if (!name.trim()) return;
            const g = this.store.createGroup(name);
            this.store.assignToGroup(tab.key, g.id);
            this.onRefresh();
          });
        });
        for (const g of this.store.state.groups) {
          this.addItem(movePop, g.name, () => {
            this.store.assignToGroup(tab.key, g.id);
            this.onRefresh();
          }, { type: "radio", checked: tab.groupId === g.id });
        }
        if (tab.groupId) {
          this.addItem(movePop, "Remove from Group", () => {
            this.store.assignToGroup(tab.key, null);
            this.onRefresh();
          });
        }
        popup.append(this.xul("menuseparator"));
        if (this.prefs.get("workspace.enableCopyReference") && tab.tabID) {
          this.addItem(popup, "📋 Copy Citation (→ Lookup History)", () => {
            void this.tabs.copyTabCitation(this.win, tab.tabID);
          });
        }
        if (this.prefs.get("workspace.enableShowInFilesystem") && tab.itemID > 0) {
          this.addItem(popup, "📁 Reveal Attachment in Folder", () => {
            this.win.ZoteroPane?.showAttachmentInFilesystem?.(tab.itemID);
          });
        }
        if (this.prefs.get("workspace.enableReloadTab") && tab.tabID) {
          this.addItem(popup, "↻ Reload Tab", () => {
            void this.tabs.reloadTab(this.win, tab.tabID).then(() => this.onRefresh());
          });
        }
        if (tab.tabID) {
          popup.append(this.xul("menuseparator"));
          this.addItem(popup, "Close Tab", () => {
            void this.tabs.closeTabs(this.win, [tab.tabID], { protectPinned: false }).then(() => this.onRefresh());
          });
        }
      });
    }
    openGroupMenu(event, group) {
      event.preventDefault();
      event.stopPropagation();
      this.openAt(event, (popup) => {
        this.addItem(popup, "✎ Rename Group…", () => {
          this.deferPrompt("Rename Group", "Group name:", group.name, (val) => {
            this.store.renameGroup(group.id, val);
            this.onRefresh();
          });
        });
        const colorMenu = this.xul("menu");
        colorMenu.setAttribute("label", "Group Color");
        const colorPop = this.xul("menupopup");
        colorMenu.append(colorPop);
        popup.append(colorMenu);
        GROUP_PALETTE.forEach((c, idx) => {
          this.addItem(colorPop, `Color ${idx + 1} (${c})`, () => {
            this.store.setGroupColor(group.id, c);
            this.onRefresh();
          });
        });
        this.addItem(popup, "💾 Save to Workspace & Close Group", () => {
          void this.tabs.archiveAndCloseGroup(this.win, group.id).then(() => this.onRefresh());
        });
        this.addItem(popup, "Close All Tabs in Group", () => {
          const ids = this.tabs.buildTrackedTabs(this.win).filter((t) => t.groupId === group.id && t.tabID).map((t) => t.tabID);
          void this.tabs.closeTabs(this.win, ids, { protectPinned: true }).then(() => this.onRefresh());
        });
        this.addItem(popup, "Delete Group (Keep Tabs)", () => {
          this.store.removeGroup(group.id);
          this.onRefresh();
        });
      });
    }
    dispose() {
      for (const p of this.popups) p.remove();
      this.popups.clear();
    }
    openAt(event, build) {
      const popupset = this.doc.getElementById("mainPopupSet") || this.doc.querySelector("popupset");
      if (!popupset) return;
      const popup = this.xul("menupopup");
      popupset.append(popup);
      this.popups.add(popup);
      popup.addEventListener("popuphidden", (e) => {
        if (e.target === popup) {
          this.popups.delete(popup);
          popup.remove();
        }
      });
      build(popup);
      popup.openPopupAtScreen(event.screenX, event.screenY, true);
    }
    xul(tag) {
      return this.doc.createXULElement ? this.doc.createXULElement(tag) : this.doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", tag);
    }
    addItem(popup, label, action, attrs = {}) {
      const mi = this.xul("menuitem");
      mi.setAttribute("label", label);
      for (const [k, v] of Object.entries(attrs)) {
        if (v !== false) mi.setAttribute(k, String(v));
      }
      mi.addEventListener("command", action);
      popup.append(mi);
    }
    deferPrompt(title, msg, initial, onOk) {
      this.win.setTimeout?.(() => {
        const promptSvc = globalThis.Services?.prompt;
        if (!promptSvc?.prompt) return;
        const input = { value: initial };
        if (promptSvc.prompt(this.win, title, msg, input, null, {})) {
          onOk(input.value);
        }
      }, 0);
    }
  };

  // src/domains/workspace/vertical-sidebar.ts
  var VerticalSidebarController = class {
    sidebar = null;
    listEl = null;
    statusEl = null;
    searchInput = null;
    viewMode = "groups";
    badges = /* @__PURE__ */ new Map();
    draggedKey = null;
    win;
    doc;
    prefs;
    store;
    tabs;
    menus;
    hover;
    onRefresh;
    constructor(win, doc, prefs, store, tabs, menus, hover, onRefresh) {
      this.win = win;
      this.doc = doc;
      this.prefs = prefs;
      this.store = store;
      this.tabs = tabs;
      this.menus = menus;
      this.hover = hover;
      this.onRefresh = onRefresh;
    }
    setCitationBadges(badges) {
      this.badges = badges;
      this.render();
    }
    mount() {
      if (this.sidebar?.isConnected) return true;
      const deck = this.win.Zotero_Tabs?.deck;
      const deckParent = deck?.parentElement;
      if (!deck || !deckParent) return false;
      const aside = this.doc.createXULElement ? this.doc.createXULElement("vbox") : this.doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "vbox");
      aside.id = "zbf-sidebar";
      const header = this.h("div", "zbf-sb-header");
      const title = this.h("span", "zbf-sb-title");
      title.append(createWorkspaceIcon(this.doc, "bridge", 14), this.doc.createTextNode("BridgeFlow"));
      const actions = this.h("div", "zbf-sb-actions");
      actions.append(
        this.mkIconBtn("plus", "New Group", () => this.promptNewGroup()),
        this.mkIconBtn("folder", "Auto-Group by Collection", () => {
          this.tabs.autoGroupByCollection(this.win);
          this.onRefresh();
        }),
        this.mkIconBtn("sleep", "Sleep Inactive Tabs", () => this.sleepInactiveTabs()),
        this.mkIconBtn("sidebar", "Collapse Sidebar", () => {
          this.prefs.set("workspace.verticalSidebarCollapsed", !this.prefs.get("workspace.verticalSidebarCollapsed"));
          this.onRefresh();
        })
      );
      header.append(title, actions);
      const searchWrap = this.h("div", "zbf-sb-search-wrap");
      const search = this.h("input", "zbf-sb-search");
      search.type = "search";
      search.placeholder = "Filter tabs, remarks, collections...";
      search.addEventListener("input", () => this.renderList());
      searchWrap.append(search);
      const views = this.h("div", "zbf-sb-views");
      for (const [mode, label] of [["groups", "分组"], ["collection", "集合"], ["status", "状态"]]) {
        const btn = this.h("button", `zbf-sb-view-btn${this.viewMode === mode ? " active" : ""}`);
        btn.type = "button";
        btn.textContent = label;
        btn.addEventListener("click", () => {
          this.viewMode = mode;
          Array.from(views.children).forEach((el, idx) => {
            el.classList.toggle("active", ["groups", "collection", "status"][idx] === mode);
          });
          this.renderList();
        });
        views.append(btn);
      }
      const list = this.h("div", "zbf-sb-list");
      const status = this.h("div", "zbf-sb-status");
      const splitter = this.h("div", "zbf-sb-splitter");
      this.bindSplitter(splitter, aside);
      aside.append(header, searchWrap, views, list, status, splitter);
      deckParent.insertBefore(aside, deck);
      this.sidebar = aside;
      this.listEl = list;
      this.statusEl = status;
      this.searchInput = search;
      return true;
    }
    render() {
      if (!this.prefs.get("workspace.enableVerticalSidebar")) {
        this.dispose();
        return;
      }
      if (!this.mount() || !this.sidebar) return;
      const collapsed = this.prefs.get("workspace.verticalSidebarCollapsed");
      this.sidebar.setAttribute("data-collapsed", collapsed ? "true" : "false");
      this.sidebar.style.width = `${this.prefs.get("workspace.verticalSidebarWidth")}px`;
      if (!collapsed) this.renderList();
    }
    renderList() {
      if (!this.listEl || !this.statusEl) return;
      const tracked = this.tabs.buildTrackedTabs(this.win);
      const filter = (this.searchInput?.value || "").trim().toLowerCase();
      const visible = filter ? tracked.filter((t) => `${t.title} ${t.remark} ${t.source} ${t.collection}`.toLowerCase().includes(filter)) : tracked;
      this.listEl.textContent = "";
      if (this.viewMode === "groups") this.renderByGroups(visible);
      else if (this.viewMode === "collection") this.renderByKey(visible, (t) => t.collection || "Uncategorized");
      else this.renderByStatus(visible);
      const activeCount = tracked.filter((t) => !t.sleeping && !t.virtual).length;
      const sleepCount = tracked.filter((t) => t.sleeping).length;
      const virtualCount = tracked.filter((t) => t.virtual).length;
      this.statusEl.textContent = `Active ${activeCount} · Sleep ${sleepCount} · Virtual ${virtualCount}`;
    }
    dispose() {
      this.sidebar?.remove();
      this.sidebar = null;
      this.listEl = null;
      this.statusEl = null;
      this.searchInput = null;
    }
    renderByGroups(tabs) {
      if (!this.listEl) return;
      const pinned = this.prefs.get("workspace.enablePinnedTabs") ? tabs.filter((t) => t.pinned) : [];
      if (pinned.length) {
        const pHead = this.h("div", "zbf-sb-group-head");
        pHead.textContent = `📌 Pinned (${pinned.length})`;
        this.listEl.append(pHead);
        for (const tab of pinned) this.listEl.append(this.buildRow(tab, "Pinned"));
      }
      for (const group of this.store.state.groups) {
        const members = tabs.filter((t) => !t.pinned && t.groupId === group.id);
        const collapsed = this.store.state.collapsed.includes(group.id);
        const head = this.h("div", "zbf-sb-group-head");
        const left = this.h("span");
        left.style.cssText = "display:inline-flex;align-items:center;gap:6px;";
        const dot = this.h("span", "zbf-sb-group-dot");
        dot.style.backgroundColor = group.color;
        left.append(dot, this.doc.createTextNode(`${group.name} (${members.length})`));
        head.append(left);
        head.addEventListener("click", () => {
          this.store.setCollapsed(group.id, !collapsed);
          this.renderList();
        });
        head.addEventListener("contextmenu", (e) => this.menus.openGroupMenu(e, group));
        head.addEventListener("dragover", (e) => {
          if (this.draggedKey) e.preventDefault();
        });
        head.addEventListener("drop", (e) => {
          e.preventDefault();
          if (this.draggedKey) {
            this.store.assignToGroup(this.draggedKey, group.id);
            this.draggedKey = null;
            this.onRefresh();
          }
        });
        this.listEl.append(head);
        if (!collapsed) {
          for (const tab of members) this.listEl.append(this.buildRow(tab, group.name));
        }
      }
      for (const tab of tabs.filter((t) => !t.pinned && !t.groupId)) {
        this.listEl.append(this.buildRow(tab, ""));
      }
    }
    renderByKey(tabs, keyFn) {
      if (!this.listEl) return;
      const buckets = /* @__PURE__ */ new Map();
      for (const t of tabs) {
        const k = keyFn(t);
        const arr = buckets.get(k) || [];
        arr.push(t);
        buckets.set(k, arr);
      }
      for (const [label, list] of buckets.entries()) {
        const head = this.h("div", "zbf-sb-group-head");
        head.textContent = `${label} (${list.length})`;
        this.listEl.append(head);
        for (const t of list) this.listEl.append(this.buildRow(t, label));
      }
    }
    renderByStatus(tabs) {
      this.renderByKey(tabs, (t) => {
        if (this.badges.has(t.parentItemID) || this.badges.has(t.itemID)) return "Cited in Word";
        if (t.pinned) return "Pinned";
        if (t.sleeping) return "Sleeping";
        if (t.virtual) return "Virtual";
        return "Active";
      });
    }
    buildRow(tab, groupName) {
      const selectedID = String(this.win.Zotero_Tabs?.selectedID || "");
      const cls = ["zbf-vtab-row", tab.tabID === selectedID ? "selected" : "", tab.sleeping ? "sleeping" : "", tab.virtual ? "virtual" : ""].filter(Boolean).join(" ");
      const row = this.h("div", cls);
      row.draggable = true;
      row.addEventListener("dragstart", () => {
        this.draggedKey = tab.key;
      });
      row.addEventListener("dragend", () => {
        this.draggedKey = null;
      });
      row.style.minHeight = `${this.prefs.get("workspace.verticalTabRowHeight")}px`;
      row.style.fontSize = `${this.prefs.get("workspace.verticalTabFontSize")}px`;
      const main = this.h("div", "zbf-vtab-main");
      const title = this.h("span", "zbf-vtab-title");
      title.textContent = `${tab.virtual ? "◌ " : ""}${this.tabs.getDisplayTitle(tab)}`;
      main.append(title);
      const subMode = this.prefs.get("workspace.verticalTabSubtitleMode");
      const subText = subMode === "none" ? "" : subMode === "creatorYear" ? tab.creatorYear : subMode === "collection" ? tab.collection : tab.source || tab.creatorYear;
      if (subText) {
        const sub = this.h("span", "zbf-vtab-sub");
        sub.textContent = subText;
        main.append(sub);
      }
      row.append(main);
      const right = this.h("div", "zbf-vtab-right");
      const badgeInfo = this.badges.get(tab.parentItemID) || this.badges.get(tab.itemID);
      if (badgeInfo && this.prefs.get("fusion.sidebarCiteBadge")) {
        const badge = this.h("span", "zbf-cite-badge");
        badge.textContent = `[${badgeInfo.ordinal}]`;
        badge.title = `${badgeInfo.documentName}: ${badgeInfo.shortText}`;
        right.append(badge);
      }
      if (tab.itemID > 0 && this.prefs.get("workspace.enableShowInFilesystem")) {
        const folderBtn = this.mkIconBtn("folder", "Reveal PDF Folder", () => {
          this.win.ZoteroPane?.showAttachmentInFilesystem?.(tab.itemID);
        }, "zbf-row-btn");
        folderBtn.addEventListener("click", (e) => e.stopPropagation());
        right.append(folderBtn);
      }
      if (tab.tabID) {
        const closeBtn = this.mkIconBtn("close", "Close tab", () => {
          void this.tabs.closeTabs(this.win, [tab.tabID], { protectPinned: true }).then(() => this.onRefresh());
        }, "zbf-row-btn");
        closeBtn.addEventListener("click", (e) => e.stopPropagation());
        right.append(closeBtn);
      }
      row.append(right);
      row.addEventListener("click", () => {
        if (tab.tabID) this.tabs.selectTab(this.win, tab.tabID);
        else void this.tabs.focusOrOpenItem(this.win, { itemID: tab.parentItemID, attachmentID: tab.itemID });
        this.onRefresh();
      });
      row.addEventListener("contextmenu", (e) => this.menus.openTabMenu(e, tab));
      if (this.prefs.get("workspace.enableHoverPreview")) {
        row.addEventListener("mouseenter", () => this.hover.scheduleShow(row, tab, groupName, badgeInfo));
        row.addEventListener("mouseleave", () => this.hover.hide());
      }
      return row;
    }
    bindSplitter(splitter, aside) {
      splitter.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        const startX = ev.clientX;
        const startW = aside.getBoundingClientRect().width || this.prefs.get("workspace.verticalSidebarWidth");
        const onMove = (m) => {
          const next = Math.max(200, Math.min(440, Math.round(startW + (m.clientX - startX))));
          aside.style.width = `${next}px`;
        };
        const onUp = () => {
          this.win.removeEventListener("mousemove", onMove);
          this.win.removeEventListener("mouseup", onUp);
          const finalW = Math.round(aside.getBoundingClientRect().width || startW);
          this.prefs.set("workspace.verticalSidebarWidth", finalW);
        };
        this.win.addEventListener("mousemove", onMove);
        this.win.addEventListener("mouseup", onUp);
      });
    }
    promptNewGroup() {
      const promptSvc = globalThis.Services?.prompt;
      if (promptSvc?.prompt) {
        const input = { value: "" };
        if (!promptSvc.prompt(this.win, "New Tab Group", "Group name:", input, null, {})) return;
        if (input.value.trim()) this.store.createGroup(input.value);
      } else {
        this.store.createGroup(`Group ${this.store.state.groups.length + 1}`);
      }
      this.onRefresh();
    }
    sleepInactiveTabs() {
      const selectedID = String(this.win.Zotero_Tabs?.selectedID || "");
      for (const tab of this.tabs.buildTrackedTabs(this.win)) {
        if (tab.tabID && tab.tabID !== selectedID && !tab.pinned && !tab.sleeping && !tab.virtual) {
          this.tabs.sleepTab(this.win, tab.tabID);
        }
      }
      this.onRefresh();
    }
    mkIconBtn(icon, title, onClick, cls = "zbf-sb-icon-btn") {
      const btn = this.h("button", cls);
      btn.type = "button";
      btn.title = title;
      btn.append(createWorkspaceIcon(this.doc, icon, 14));
      btn.addEventListener("click", onClick);
      return btn;
    }
    h(tag, className) {
      const el = this.doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
      if (className) el.className = className;
      return el;
    }
  };

  // src/domains/workspace/workspace-popover.ts
  var WorkspacePopoverController = class {
    panel = null;
    listEl = null;
    nameInput = null;
    win;
    doc;
    store;
    tabs;
    onRefresh;
    constructor(win, doc, store, tabs, onRefresh) {
      this.win = win;
      this.doc = doc;
      this.store = store;
      this.tabs = tabs;
      this.onRefresh = onRefresh;
    }
    toggle(anchor) {
      this.ensureMounted();
      if (!this.panel) return;
      if (this.panel.state === "open") {
        this.close();
        return;
      }
      this.render();
      try {
        this.panel.openPopup(anchor, "bottomleft topleft", 0, 4, false, false);
      } catch {
      }
    }
    close() {
      try {
        this.panel?.hidePopup?.();
      } catch {
      }
    }
    dispose() {
      this.close();
      this.panel?.remove?.();
      this.panel = null;
      this.listEl = null;
      this.nameInput = null;
    }
    ensureMounted() {
      if (this.panel) return;
      const popupset = this.doc?.getElementById?.("mainPopupSet") || this.doc?.querySelector?.("popupset");
      if (!popupset) return;
      const xul = this.doc.createXULElement ? this.doc.createXULElement("panel") : this.doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "panel");
      xul.id = "zbf-workspace-panel";
      xul.setAttribute("orient", "vertical");
      const box = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      box.className = "zbf-spot-box";
      box.style.width = "360px";
      const row = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      row.style.cssText = "display:flex;gap:6px;";
      const input = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "input");
      input.type = "text";
      input.className = "zbf-spot-input";
      input.placeholder = "Workspace snapshot name...";
      const saveBtn = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
      saveBtn.type = "button";
      saveBtn.className = "zbf-tb-btn";
      saveBtn.textContent = "Save";
      saveBtn.addEventListener("click", () => {
        this.store.saveSession(input.value || `Workspace ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`);
        input.value = "";
        this.render();
        this.onRefresh();
      });
      row.append(input, saveBtn);
      const list = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      list.className = "zbf-spot-results";
      box.append(row, list);
      xul.append(box);
      popupset.append(xul);
      this.panel = xul;
      this.nameInput = input;
      this.listEl = list;
    }
    render() {
      if (!this.listEl) return;
      this.listEl.textContent = "";
      const all = [
        ...this.store.state.sessions.map((s) => ({ session: s, kind: "Saved" })),
        ...this.store.state.rollingSessions.map((s) => ({ session: s, kind: "Auto" }))
      ];
      if (!all.length) {
        const empty = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
        empty.style.cssText = "padding:10px;opacity:0.65;text-align:center;";
        empty.textContent = "No workspace snapshots yet";
        this.listEl.append(empty);
        return;
      }
      for (const { session, kind } of all) {
        const item = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
        item.className = "zbf-spot-row";
        const title = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
        title.textContent = `${session.name} (${session.groups.length} groups)`;
        const right = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
        right.style.cssText = "display:inline-flex;gap:4px;align-items:center;";
        const badge = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
        badge.className = "zbf-spot-badge";
        badge.textContent = kind;
        const restoreBtn = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
        restoreBtn.type = "button";
        restoreBtn.className = "zbf-tb-btn";
        restoreBtn.textContent = "Restore";
        restoreBtn.addEventListener("click", () => {
          void this.restoreSession(session);
        });
        right.append(badge, restoreBtn);
        item.append(title, right);
        this.listEl.append(item);
      }
    }
    async restoreSession(session) {
      this.store.restoreSessionLayout(session);
      for (const group of session.groups) {
        for (const key of group.memberKeys) {
          const idMatch = key.match(/^item:(\d+)$/);
          if (idMatch) {
            await this.tabs.focusOrOpenItem(this.win, {
              itemID: Number(idMatch[1]),
              attachmentID: Number(idMatch[1]),
              preferExistingTab: true
            });
          }
        }
      }
      this.close();
      this.onRefresh();
    }
  };

  // src/domains/workspace/workspace-styles.ts
  var WORKSPACE_CSS = `
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

  // src/domains/workspace/workspace-ui.ts
  var WorkspaceWindowUI = class {
    disposables = new DisposableStack();
    win;
    prefs;
    store;
    hover;
    tabMenus;
    itemMenus;
    spotlightPanel;
    workspacePopover;
    horizontal;
    sidebar;
    mountRetryTimer = null;
    constructor(win, prefs, store, tabs, spotlight) {
      this.win = win;
      this.prefs = prefs;
      this.store = store;
      const refresh = () => this.render();
      this.hover = new HoverCardController(win, win.document);
      this.tabMenus = new TabContextMenuController(win, win.document, prefs, store, tabs, refresh);
      this.itemMenus = new ItemContextMenuController(win, win.document, prefs, store, tabs, refresh);
      this.spotlightPanel = new SpotlightPanelController(win, win.document, spotlight);
      this.workspacePopover = new WorkspacePopoverController(win, win.document, store, tabs, refresh);
      this.horizontal = new HorizontalBarController(
        win,
        win.document,
        prefs,
        store,
        tabs,
        this.tabMenus,
        this.hover,
        this.spotlightPanel,
        this.workspacePopover,
        refresh
      );
      this.sidebar = new VerticalSidebarController(
        win,
        win.document,
        prefs,
        store,
        tabs,
        this.tabMenus,
        this.hover,
        refresh
      );
    }
    mount() {
      const doc = this.win.document;
      if (!doc) return;
      if (doc.readyState === "loading") {
        const onReady = () => {
          this.mount();
        };
        doc.addEventListener("DOMContentLoaded", onReady, { once: true });
        this.disposables.add(() => doc.removeEventListener("DOMContentLoaded", onReady));
        return;
      }
      this.win.MozXULElement?.insertFTLIfNeeded?.("zotero-bridgeflow.ftl");
      if (doc.documentElement && !doc.getElementById("zbf-workspace-style")) {
        const style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
        style.id = "zbf-workspace-style";
        style.textContent = WORKSPACE_CSS;
        doc.documentElement.append(style);
        this.disposables.add(() => style.remove());
      }
      this.itemMenus.attach();
      const onKeyDown = (ev) => {
        if (!this.prefs.get("workspace.enableSpotlight")) return;
        if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === "p") {
          ev.preventDefault();
          ev.stopPropagation();
          this.spotlightPanel.toggle();
        }
      };
      this.win.addEventListener?.("keydown", onKeyDown, true);
      this.disposables.add(() => this.win.removeEventListener?.("keydown", onKeyDown, true));
      this.disposables.add(this.store.onChange(() => this.render()));
      this.render();
      if (!doc.getElementById("zbf-toolbar-actions") && typeof this.win.setTimeout === "function") {
        this.mountRetryTimer = this.win.setTimeout(() => {
          this.mountRetryTimer = null;
          this.itemMenus.attach();
          this.render();
        }, 300);
      }
    }
    setCitationBadges(badges) {
      this.horizontal.setCitationBadges(badges);
      this.sidebar.setCitationBadges(badges);
    }
    render() {
      this.horizontal.render();
      this.sidebar.render();
    }
    dispose() {
      if (this.mountRetryTimer !== null) {
        this.win.clearTimeout?.(this.mountRetryTimer);
        this.mountRetryTimer = null;
      }
      this.hover.dispose();
      this.tabMenus.dispose();
      this.itemMenus.dispose();
      this.workspacePopover.dispose();
      this.spotlightPanel.dispose();
      this.horizontal.dispose();
      this.sidebar.dispose();
      this.disposables.disposeAll();
    }
  };

  // src/domains/workspace/module.ts
  var WorkspaceDomainModule = class {
    id = "workspace";
    enabledPref = "modules.workspace.enable";
    store;
    tabs;
    spotlight;
    kernel;
    disposables = new DisposableStack();
    windowUIs = /* @__PURE__ */ new Map();
    citationBadges = /* @__PURE__ */ new Map();
    active = false;
    constructor(kernel, services) {
      this.kernel = kernel;
      this.store = new WorkspaceStateStore(kernel.prefs);
      this.tabs = new WorkspaceTabController(kernel.prefs, this.store, services.clipboard);
      this.spotlight = new SpotlightEngine(this.tabs);
    }
    isActive() {
      return this.active;
    }
    start() {
      if (this.active) return;
      this.active = true;
      this.disposables.reset();
      this.disposables.add(
        this.kernel.notifier.subscribe(["tab", "item", "collection"], () => {
          for (const ui of this.windowUIs.values()) ui.render();
          this.emitTabsSummary();
        })
      );
      this.disposables.add(
        this.kernel.prefs.observeKeys(
          [
            "workspace.enableHorizontalGroups",
            "workspace.compactTopBar",
            "workspace.enableVerticalSidebar",
            "workspace.enablePinnedTabs",
            "workspace.pinnedIconOnly",
            "workspace.enableTabRemarks",
            "workspace.remarkDisplayMode",
            "workspace.verticalTabTitleMode",
            "workspace.verticalTabSubtitleMode",
            "workspace.verticalSidebarWidth",
            "workspace.verticalSidebarCollapsed",
            "workspace.verticalTabRowHeight",
            "workspace.verticalTabFontSize",
            "workspace.enableHoverPreview",
            "workspace.enableSpotlight",
            "workspace.enableSessions",
            "workspace.enableTabSleep",
            "fusion.sidebarCiteBadge"
          ],
          () => {
            for (const ui of this.windowUIs.values()) ui.render();
          }
        )
      );
    }
    onMainWindowLoad(win) {
      if (!this.active || this.windowUIs.has(win)) return;
      const ui = new WorkspaceWindowUI(win, this.kernel.prefs, this.store, this.tabs, this.spotlight);
      ui.setCitationBadges(this.citationBadges);
      ui.mount();
      this.windowUIs.set(win, ui);
      this.emitTabsSummary();
    }
    onMainWindowUnload(win) {
      const ui = this.windowUIs.get(win);
      if (!ui) return;
      this.windowUIs.delete(win);
      ui.dispose();
    }
    stop() {
      if (!this.active) return;
      this.active = false;
      for (const ui of this.windowUIs.values()) ui.dispose();
      this.windowUIs.clear();
      this.disposables.disposeAll();
    }
    // === Cross-domain controlled hooks (called by Layer 4 Bridges) ===
    registerSpotlightProvider(provider) {
      return this.spotlight.registerProvider(provider);
    }
    setCitationBadges(badges) {
      this.citationBadges = badges;
      for (const ui of this.windowUIs.values()) ui.setCitationBadges(badges);
    }
    async focusOrOpenItem(req, preferredWin) {
      const targetWin = preferredWin || [...this.windowUIs.keys()][0] || globalThis.Zotero?.getMainWindow?.();
      if (!targetWin) return "not-found";
      return this.tabs.focusOrOpenItem(targetWin, req);
    }
    groupOpenTabsByItemIDs(groupName, itemIDs, preferredWin) {
      const targetWin = preferredWin || [...this.windowUIs.keys()][0] || globalThis.Zotero?.getMainWindow?.();
      if (!targetWin) return null;
      return this.tabs.groupOpenTabsByItemIDs(targetWin, groupName, itemIDs);
    }
    emitTabsSummary() {
      const openItemIDs = /* @__PURE__ */ new Set();
      for (const win of this.windowUIs.keys()) {
        for (const t of this.tabs.buildTrackedTabs(win)) {
          if (!t.virtual && t.parentItemID > 0) openItemIDs.add(t.parentItemID);
        }
      }
      this.kernel.bus.emit("workspace:tabs-updated", {
        windowCount: this.windowUIs.size,
        openItemIDs: [...openItemIDs]
      });
    }
  };

  // src/kernel/event-bus.ts
  var TypedEventBus = class {
    listeners = /* @__PURE__ */ new Map();
    onError;
    constructor(onError) {
      this.onError = onError;
    }
    on(event, listener) {
      let set = this.listeners.get(event);
      if (!set) {
        set = /* @__PURE__ */ new Set();
        this.listeners.set(event, set);
      }
      set.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        set?.delete(listener);
        if (set && set.size === 0) this.listeners.delete(event);
      };
    }
    emit(event, payload) {
      const set = this.listeners.get(event);
      if (!set || set.size === 0) return;
      for (const listener of [...set]) {
        try {
          const result = listener(payload);
          if (result && typeof result.catch === "function") {
            result.catch((err) => this.onError?.(event, err));
          }
        } catch (error) {
          this.onError?.(event, error);
        }
      }
    }
    listenerCount(event) {
      if (event) return this.listeners.get(event)?.size ?? 0;
      let total = 0;
      for (const set of this.listeners.values()) total += set.size;
      return total;
    }
    clear() {
      this.listeners.clear();
    }
  };

  // src/kernel/logger.ts
  var KernelLogger = class {
    debugEnabled = false;
    slowThresholdMs = 50;
    slowRecords = [];
    maxRecords = 100;
    configure(options) {
      if (typeof options.debug === "boolean") this.debugEnabled = options.debug;
      if (typeof options.slowThresholdMs === "number" && Number.isFinite(options.slowThresholdMs)) {
        this.slowThresholdMs = Math.max(5, Math.min(5e3, Math.round(options.slowThresholdMs)));
      }
    }
    debug(scope, message, detail) {
      if (!this.debugEnabled) return;
      const suffix = detail === void 0 ? "" : ` ${safeStringify(detail)}`;
      try {
        globalThis.Zotero?.debug?.(`[BridgeFlow:${scope}] ${message}${suffix}`);
      } catch {
      }
    }
    error(scope, error) {
      try {
        const host2 = globalThis.Zotero;
        if (typeof host2?.logError === "function") {
          host2.logError(error instanceof Error ? error : new Error(`[BridgeFlow:${scope}] ${String(error)}`));
        }
      } catch {
      }
    }
    recordPerf(op, durationMs) {
      if (durationMs < this.slowThresholdMs) return;
      this.slowRecords.push({ op, durationMs, timestamp: Date.now() });
      if (this.slowRecords.length > this.maxRecords) {
        this.slowRecords.splice(0, this.slowRecords.length - this.maxRecords);
      }
      this.debug("perf", `slow op "${op}" took ${durationMs.toFixed(1)}ms`);
    }
    getSlowRecords() {
      return this.slowRecords;
    }
    clearPerf() {
      this.slowRecords.length = 0;
    }
  };
  function safeStringify(value) {
    try {
      return typeof value === "string" ? value : JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

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
    const host2 = globalThis.Zotero?.Prefs;
    return host2 && typeof host2.get === "function" ? host2 : null;
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

  // src/kernel/migration.ts
  var CURRENT_MIGRATION_VERSION = 1;
  function detectSourcePlugin(legacyKey) {
    if (legacyKey.startsWith("extensions.zotero.tabflow.")) return "TabFlow";
    if (legacyKey.startsWith("extensions.zoteropreview.")) return "ViewFlow";
    if (legacyKey.startsWith("extensions.zotero.zoterocitation.")) return "CiteFlow";
    return "Legacy";
  }
  function runLegacyPrefMigration(prefs) {
    const currentVersion = prefs.get("migrationVersion");
    if (currentVersion >= CURRENT_MIGRATION_VERSION) {
      return { skipped: true, migratedKeys: [], sourcesDetected: [] };
    }
    const migratedKeys = [];
    const sources = /* @__PURE__ */ new Set();
    for (const key of Object.keys(PREF_SCHEMA)) {
      const desc = PREF_SCHEMA[key];
      if (!desc.legacyKeys || desc.legacyKeys.length === 0) continue;
      const existingNew = prefs.readRaw(prefs.fullKey(key));
      if (existingNew !== void 0 && existingNew !== desc.defaultValue) {
        continue;
      }
      for (const legacyKey of desc.legacyKeys) {
        const legacyRaw = prefs.readRaw(legacyKey);
        if (legacyRaw === void 0 || legacyRaw === null) continue;
        const normalized = normalizePrefValue(key, legacyRaw);
        if (normalized !== desc.defaultValue) {
          prefs.set(key, normalized);
          migratedKeys.push(key);
          sources.add(detectSourcePlugin(legacyKey));
          break;
        }
      }
    }
    prefs.set("migrationVersion", CURRENT_MIGRATION_VERSION);
    return {
      skipped: false,
      migratedKeys,
      sourcesDetected: [...sources]
    };
  }

  // src/kernel/native-runtime.ts
  var NativeRuntime = class {
    patches = /* @__PURE__ */ new Set();
    patchByWrapper = /* @__PURE__ */ new WeakMap();
    restoreOriginal(entry) {
      let original = entry.original;
      let previous = this.patchByWrapper.get(original);
      while (previous && !previous.active) {
        original = previous.original;
        previous = this.patchByWrapper.get(original);
      }
      return original;
    }
    patch(owner, key, _ownerName, createWrapper) {
      if (!owner || typeof owner[key] !== "function") {
        throw new TypeError(`Cannot wrap ${key}`);
      }
      const original = owner[key];
      const delegate = createWrapper(original);
      if (typeof delegate !== "function") {
        throw new TypeError(`Invalid wrapper for ${key}`);
      }
      const entry = { owner, key, original, active: true, wrapper: original };
      entry.wrapper = function(...args) {
        return Reflect.apply(entry.active ? delegate : original, this, args);
      };
      owner[key] = entry.wrapper;
      this.patches.add(entry);
      this.patchByWrapper.set(entry.wrapper, entry);
      return () => {
        if (!entry.active) return;
        entry.active = false;
        if (owner[key] === entry.wrapper) {
          owner[key] = this.restoreOriginal(entry);
        }
        this.patches.delete(entry);
      };
    }
    unregisterAll() {
      for (const entry of [...this.patches].reverse()) {
        entry.active = false;
        if (entry.owner[entry.key] === entry.wrapper) {
          entry.owner[entry.key] = this.restoreOriginal(entry);
        }
      }
      this.patches.clear();
    }
    get pendingPatchCount() {
      return this.patches.size;
    }
  };

  // src/kernel/notifier-hub.ts
  var UnifiedNotifierHub = class {
    notifierID = null;
    listeners = /* @__PURE__ */ new Map();
    bus;
    constructor(bus) {
      this.bus = bus;
    }
    start() {
      if (this.notifierID) return;
      const notifier = globalThis.Zotero?.Notifier;
      if (!notifier?.registerObserver) return;
      this.notifierID = notifier.registerObserver(
        {
          notify: (event, type, ids, extraData) => {
            const payload = { event, type, ids: [...ids], extraData };
            this.dispatch(payload);
          }
        },
        ["item", "tab", "collection", "item-tag"],
        "zotero-bridgeflow"
      );
    }
    subscribe(types, callback) {
      for (const t of types) {
        let set = this.listeners.get(t);
        if (!set) {
          set = /* @__PURE__ */ new Set();
          this.listeners.set(t, set);
        }
        set.add(callback);
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        for (const t of types) {
          const set = this.listeners.get(t);
          set?.delete(callback);
          if (set && set.size === 0) this.listeners.delete(t);
        }
      };
    }
    dispatch(payload) {
      const set = this.listeners.get(payload.type);
      if (set) {
        for (const cb of [...set]) {
          try {
            cb(payload);
          } catch {
          }
        }
      }
      this.bus.emit("notifier:event", payload);
    }
    stop() {
      if (this.notifierID) {
        try {
          globalThis.Zotero?.Notifier?.unregisterObserver?.(this.notifierID);
        } catch {
        }
        this.notifierID = null;
      }
      this.listeners.clear();
    }
  };

  // src/kernel/plugin-kernel.ts
  var PluginKernel = class {
    info = { id: "bridgeflow@groele", version: "0.0.1", rootURI: "" };
    logger = new KernelLogger();
    bus;
    prefs;
    runtime = new NativeRuntime();
    notifier;
    disposables = new DisposableStack();
    lastMigrationReport = null;
    _ftlRegistered = false;
    domains = /* @__PURE__ */ new Map();
    bridges = [];
    openWindows = /* @__PURE__ */ new Set();
    initialized = false;
    started = false;
    constructor(options = {}) {
      this.bus = new TypedEventBus((event, err) => this.logger.error(`bus:${event}`, err));
      this.prefs = new UnifiedPrefService({ bus: this.bus, adapter: options.prefAdapter });
      this.notifier = new UnifiedNotifierHub(this.bus);
    }
    init(info) {
      if (this.initialized) return;
      this.info = { ...info };
      this.initialized = true;
      this.syncLoggerConfig();
    }
    registerDomain(domain) {
      this.domains.set(domain.id, domain);
    }
    registerBridge(bridge) {
      this.bridges.push(bridge);
    }
    async start() {
      if (this.started) return;
      this.started = true;
      this.lastMigrationReport = runLegacyPrefMigration(this.prefs);
      this.syncLoggerConfig();
      this.notifier.start();
      const watchedKeys = [
        "debug",
        "wordCite.perfSlowThresholdMs",
        "modules.workspace.enable",
        "modules.inspector.enable",
        "modules.wordCite.enable"
      ];
      this.disposables.add(
        this.prefs.observeKeys(watchedKeys, (key) => {
          if (key === "debug" || key === "wordCite.perfSlowThresholdMs") {
            this.syncLoggerConfig();
            return;
          }
          void this.syncDomainStates();
        })
      );
      await this.syncDomainStates();
      for (const bridge of this.bridges) {
        try {
          bridge.start();
        } catch (err) {
          this.logger.error(`bridge:${bridge.id}`, err);
        }
      }
      const existing = globalThis.Zotero?.getMainWindows?.();
      if (Array.isArray(existing)) {
        for (const win of existing) this.onMainWindowLoad(win);
      }
    }
    async syncDomainStates() {
      for (const domain of this.domains.values()) {
        const shouldEnable = Boolean(this.prefs.get(domain.enabledPref));
        const currentlyActive = domain.isActive();
        if (shouldEnable && !currentlyActive) {
          try {
            await domain.start();
            for (const win of this.openWindows) domain.onMainWindowLoad?.(win);
          } catch (err) {
            this.logger.error(`domain:start:${domain.id}`, err);
          }
        } else if (!shouldEnable && currentlyActive) {
          try {
            for (const win of this.openWindows) domain.onMainWindowUnload?.(win);
            domain.stop();
          } catch (err) {
            this.logger.error(`domain:stop:${domain.id}`, err);
          }
        }
      }
    }
    onMainWindowLoad(win) {
      if (!win || this.openWindows.has(win)) return;
      this.openWindows.add(win);
      for (const domain of this.domains.values()) {
        if (!domain.isActive()) continue;
        try {
          domain.onMainWindowLoad?.(win);
        } catch (err) {
          this.logger.error(`windowLoad:${domain.id}`, err);
        }
      }
    }
    onMainWindowUnload(win) {
      if (!win || !this.openWindows.has(win)) return;
      this.openWindows.delete(win);
      for (const domain of this.domains.values()) {
        if (!domain.isActive()) continue;
        try {
          domain.onMainWindowUnload?.(win);
        } catch (err) {
          this.logger.error(`windowUnload:${domain.id}`, err);
        }
      }
    }
    shutdown() {
      for (const bridge of [...this.bridges].reverse()) {
        try {
          bridge.stop();
        } catch (err) {
          this.logger.error(`bridge:stop:${bridge.id}`, err);
        }
      }
      for (const win of [...this.openWindows]) {
        this.onMainWindowUnload(win);
      }
      for (const domain of [...this.domains.values()].reverse()) {
        if (!domain.isActive()) continue;
        try {
          domain.stop();
        } catch (err) {
          this.logger.error(`domain:stop:${domain.id}`, err);
        }
      }
      this.notifier.stop();
      this.disposables.disposeAll((err) => this.logger.error("dispose", err));
      this.runtime.unregisterAll();
      this.prefs.dispose();
      this.bus.clear();
      this.started = false;
      this.initialized = false;
    }
    syncLoggerConfig() {
      this.logger.configure({
        debug: this.prefs.get("debug"),
        slowThresholdMs: this.prefs.get("wordCite.perfSlowThresholdMs")
      });
    }
  };

  // src/services/citation-history-store.ts
  function normalizeCitationKey(text) {
    return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
  }
  var CitationHistoryStore = class {
    records = /* @__PURE__ */ new Map();
    config = { maxEntries: 2e3, ttlDays: 90 };
    initialized = false;
    dirty = false;
    saveTimer = null;
    configure(partial) {
      if (typeof partial.maxEntries === "number" && Number.isFinite(partial.maxEntries)) {
        this.config.maxEntries = Math.max(100, Math.min(1e5, Math.floor(partial.maxEntries)));
      }
      if (typeof partial.ttlDays === "number" && Number.isFinite(partial.ttlDays)) {
        this.config.ttlDays = Math.max(7, Math.min(3650, Math.floor(partial.ttlDays)));
      }
      if (partial.customDir !== void 0) {
        this.config.customDir = partial.customDir.trim() || void 0;
      }
      this.pruneExpired();
      this.enforceEviction();
    }
    get count() {
      return this.records.size;
    }
    getDirectoryPath() {
      if (this.config.customDir) return this.config.customDir;
      const dataDir = globalThis.Zotero?.DataDirectory?.dir;
      const pathUtils = globalThis.PathUtils;
      if (dataDir && pathUtils?.join) {
        return pathUtils.join(dataDir, "bridgeflow-cache");
      }
      return "bridgeflow-cache";
    }
    getFilePath() {
      const pathUtils = globalThis.PathUtils;
      const dir = this.getDirectoryPath();
      return pathUtils?.join ? pathUtils.join(dir, "citation-history.json") : `${dir}/citation-history.json`;
    }
    record(entry) {
      const key = normalizeCitationKey(entry.text);
      if (!key) return null;
      const now = Date.now();
      const existing = this.records.get(key);
      const record = {
        ...entry,
        key,
        copiedAt: existing?.copiedAt ?? now,
        lastAccessedAt: now,
        hitCount: (existing?.hitCount ?? 0) + 1
      };
      this.records.delete(key);
      this.records.set(key, record);
      this.dirty = true;
      this.enforceEviction();
      this.scheduleSave();
      return record;
    }
    lookupExact(query) {
      const key = normalizeCitationKey(query);
      if (!key) return null;
      const rec = this.records.get(key);
      if (!rec) return null;
      if (Date.now() - (rec.lastAccessedAt || rec.copiedAt) >= this.config.ttlDays * 864e5) {
        this.records.delete(key);
        return null;
      }
      rec.lastAccessedAt = Date.now();
      rec.hitCount += 1;
      this.dirty = true;
      return rec;
    }
    searchFuzzy(query, limit = 5) {
      const norm = normalizeCitationKey(query);
      if (!norm) return [];
      const scored = [];
      for (const rec of this.records.values()) {
        if (rec.key === norm) {
          scored.push({ rec, score: 100 });
        } else if (rec.key.includes(norm) || norm.includes(rec.key)) {
          scored.push({ rec, score: 70 });
        }
      }
      scored.sort((a, b) => b.score - a.score || b.rec.hitCount - a.rec.hitCount);
      return scored.slice(0, limit).map((s) => s.rec);
    }
    clear() {
      this.records.clear();
      this.dirty = true;
      this.scheduleSave();
    }
    async init() {
      if (this.initialized) return;
      this.initialized = true;
      const ioUtils = globalThis.IOUtils;
      if (!ioUtils?.exists || !ioUtils?.readUTF8) return;
      const paths = [this.getFilePath()];
      const dataDir = globalThis.Zotero?.DataDirectory?.dir;
      const pathUtils = globalThis.PathUtils;
      if (!this.config.customDir && dataDir && pathUtils?.join) {
        paths.push(pathUtils.join(dataDir, "viewflow-cache", "viewflow-history.json"));
      }
      for (const filePath of paths) {
        try {
          if (!await ioUtils.exists(filePath)) continue;
          const parsed = JSON.parse(await ioUtils.readUTF8(filePath));
          const list = Array.isArray(parsed?.records) ? parsed.records : Array.isArray(parsed) ? parsed : [];
          for (const raw of list) {
            if (!raw?.text || !raw?.itemID) continue;
            const key = normalizeCitationKey(raw.text);
            if (!this.records.has(key)) {
              this.records.set(key, {
                key,
                text: String(raw.text),
                libraryID: Number(raw.libraryID || 1),
                itemKey: String(raw.itemKey || ""),
                itemID: Number(raw.itemID),
                title: String(raw.title || ""),
                style: String(raw.style || ""),
                copiedAt: Number(raw.copiedAt || Date.now()),
                lastAccessedAt: Number(raw.lastAccessedAt || raw.copiedAt || Date.now()),
                hitCount: Number(raw.hitCount || 1)
              });
            }
          }
          break;
        } catch {
        }
      }
      this.pruneExpired();
      this.enforceEviction();
    }
    dispose() {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
    }
    pruneExpired() {
      const now = Date.now();
      const ttlMs = this.config.ttlDays * 864e5;
      for (const [k, rec] of this.records.entries()) {
        if (now - (rec.lastAccessedAt || rec.copiedAt) >= ttlMs) {
          this.records.delete(k);
        }
      }
    }
    enforceEviction() {
      if (this.records.size <= this.config.maxEntries) return;
      const entries = [...this.records.values()];
      entries.sort((a, b) => {
        const scoreA = a.lastAccessedAt + a.hitCount * 36e5;
        const scoreB = b.lastAccessedAt + b.hitCount * 36e5;
        return scoreA - scoreB;
      });
      const overflow = this.records.size - this.config.maxEntries;
      for (let i = 0; i < overflow; i++) {
        this.records.delete(entries[i].key);
      }
    }
    scheduleSave() {
      const ioUtils = globalThis.IOUtils;
      if (!ioUtils?.writeUTF8 || !this.dirty) return;
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        void this.flushToDisk();
      }, 400);
    }
    async flushToDisk() {
      const ioUtils = globalThis.IOUtils;
      if (!ioUtils?.writeUTF8) return;
      try {
        await ioUtils.makeDirectory?.(this.getDirectoryPath(), { ignoreExisting: true });
        const payload = JSON.stringify({ version: 1, records: [...this.records.values()] });
        await ioUtils.writeUTF8(this.getFilePath(), payload);
        this.dirty = false;
      } catch {
      }
    }
  };

  // src/services/clipboard-service.ts
  var UnifiedClipboardService = class {
    csl;
    bus;
    constructor(csl, bus) {
      this.csl = csl;
      this.bus = bus;
    }
    writePayload(html, text, plainOnly = false) {
      const cleanText = String(text || "").trim();
      const cleanHtml = plainOnly ? "" : String(html || "");
      if (!cleanText && !cleanHtml) return false;
      const hostCc = globalThis.Cc;
      const hostCi = globalThis.Ci;
      if (hostCc && hostCi) {
        try {
          const transferable = hostCc["@mozilla.org/widget/transferable;1"].createInstance(hostCi.nsITransferable);
          transferable.init?.(null);
          if (cleanHtml) {
            const htmlStr = hostCc["@mozilla.org/supports-string;1"].createInstance(hostCi.nsISupportsString);
            htmlStr.data = cleanHtml;
            transferable.addDataFlavor("text/html");
            transferable.setTransferData("text/html", htmlStr);
          }
          if (cleanText) {
            const textStr = hostCc["@mozilla.org/supports-string;1"].createInstance(hostCi.nsISupportsString);
            textStr.data = cleanText;
            transferable.addDataFlavor("text/plain");
            transferable.setTransferData("text/plain", textStr);
          }
          const clipboard = hostCc["@mozilla.org/widget/clipboard;1"].getService(hostCi.nsIClipboard);
          clipboard.setData(transferable, null, hostCi.nsIClipboard.kGlobalClipboard);
          return true;
        } catch {
          return false;
        }
      }
      const clipHelper = globalThis.Zotero?.Utilities?.Internal?.copyTextToClipboard;
      if (typeof clipHelper === "function") {
        clipHelper(cleanText);
        return true;
      }
      return false;
    }
    async copyItems(rawItems, options) {
      const { items } = deduplicateRegularItems(rawItems);
      if (!items.length) return false;
      const formatted = await this.csl.formatItems(items, {
        styleID: options.styleID,
        asCitation: options.asCitation
      });
      if (!formatted.text && !formatted.html) return false;
      const ok = this.writePayload(formatted.html, formatted.text, Boolean(options.plainOnly));
      if (ok) {
        this.bus.emit("citation:copied", {
          itemIDs: items.map((it) => Number(it.id || 0)).filter((n) => n > 0),
          styleID: formatted.styleID,
          html: formatted.html,
          text: formatted.text,
          source: options.source
        });
      }
      return ok;
    }
  };

  // src/services/csl-engine.ts
  var CslFormattingEngine = class {
    cache = /* @__PURE__ */ new Map();
    bytes = 0;
    limit;
    byteLimit;
    ttlMs;
    prefs;
    constructor(prefs, options = {}) {
      this.prefs = prefs;
      this.limit = options.limit ?? 64;
      this.byteLimit = options.byteLimit ?? 2 * 1024 * 1024;
      this.ttlMs = options.ttlMs ?? 6e4;
    }
    resolveStyleID(overrideStyle) {
      const custom = (overrideStyle ?? this.prefs.get("inspector.cslPreview.citationstyle")).trim();
      if (custom) return custom;
      try {
        const quickCopy = String(globalThis.Zotero?.Prefs?.get?.("export.quickCopy.setting") || "");
        const match = quickCopy.match(/^bibliography=(.+)$/);
        if (match?.[1]) return match[1].trim();
      } catch {
      }
      return "http://www.zotero.org/styles/apa";
    }
    buildCacheKey(items, styleID, asCitation) {
      const itemPart = items.map((it) => `${it.id || 0}:${it.dateModified || it.version || 0}`).join(",");
      return `${asCitation ? "cite" : "bib"}|${styleID}|${itemPart}`;
    }
    async formatItems(items, options = {}) {
      const styleID = this.resolveStyleID(options.styleID);
      const asCitation = Boolean(options.asCitation);
      if (!items.length) return { html: "", text: "", styleID };
      const key = this.buildCacheKey(items, styleID, asCitation);
      const cached = this.getCached(key);
      if (cached) return cached;
      const host2 = globalThis.Zotero;
      if (host2?.Styles?.init) {
        await Promise.race([
          host2.Styles.init(),
          new Promise((resolve) => setTimeout(resolve, 1e4))
        ]);
      }
      let html = "";
      let text = "";
      if (host2?.QuickCopy?.getContentFromItems) {
        const formatStr = `bibliography=${styleID}`;
        const res = host2.QuickCopy.getContentFromItems(items, formatStr, null, asCitation);
        html = String(res?.html || "");
        text = String(res?.text || "").trim();
      } else {
        text = items.map((it) => String(it.getField?.("title") || it.title || "")).filter(Boolean).join("\n");
        html = text;
      }
      const result = { html, text, styleID };
      this.setCached(key, result, items.map((it) => Number(it.id || 0)).filter((n) => n > 0));
      return result;
    }
    invalidateItems(itemIDs) {
      const target = new Set(itemIDs);
      if (!target.size) return;
      for (const [key, entry] of this.cache.entries()) {
        if (entry.itemIDs.some((id) => target.has(id))) {
          this.bytes = Math.max(0, this.bytes - entry.bytes);
          this.cache.delete(key);
        }
      }
    }
    clearCache() {
      this.cache.clear();
      this.bytes = 0;
    }
    get cacheSize() {
      return this.cache.size;
    }
    getCached(key) {
      const entry = this.cache.get(key);
      if (!entry) return null;
      if (Date.now() - entry.timestamp > this.ttlMs) {
        this.bytes = Math.max(0, this.bytes - entry.bytes);
        this.cache.delete(key);
        return null;
      }
      this.cache.delete(key);
      this.cache.set(key, entry);
      return entry.value;
    }
    setCached(key, value, itemIDs) {
      const bytes = (value.html.length + value.text.length) * 2;
      if (bytes > this.byteLimit) return;
      const existing = this.cache.get(key);
      if (existing) {
        this.bytes = Math.max(0, this.bytes - existing.bytes);
        this.cache.delete(key);
      }
      while (this.cache.size >= this.limit || this.bytes + bytes > this.byteLimit) {
        const oldestKey = this.cache.keys().next().value;
        if (!oldestKey) break;
        const oldest = this.cache.get(oldestKey);
        if (oldest) this.bytes = Math.max(0, this.bytes - oldest.bytes);
        this.cache.delete(oldestKey);
      }
      this.cache.set(key, { value, bytes, itemIDs, timestamp: Date.now() });
      this.bytes += bytes;
    }
  };

  // src/services/item-pane-registry.ts
  var ItemPaneRegistryService = class {
    registered = /* @__PURE__ */ new Map();
    register(spec) {
      if (this.registered.has(spec.paneID)) {
        const existing = this.registered.get(spec.paneID) || false;
        return { sectionID: existing, dispose: () => this.unregister(spec.paneID) };
      }
      const manager = globalThis.Zotero?.ItemPaneManager;
      if (!manager?.registerSection) {
        return { sectionID: false, dispose: () => {
        } };
      }
      const sectionID = manager.registerSection(spec);
      if (sectionID) {
        this.registered.set(spec.paneID, String(sectionID));
      }
      return {
        sectionID: sectionID ? String(sectionID) : false,
        dispose: () => this.unregister(spec.paneID)
      };
    }
    unregister(paneID) {
      const sectionID = this.registered.get(paneID);
      if (!sectionID) return;
      this.registered.delete(paneID);
      try {
        globalThis.Zotero?.ItemPaneManager?.unregisterSection?.(sectionID);
      } catch {
      }
    }
    isRegistered(paneID) {
      return this.registered.has(paneID);
    }
    listRegistered() {
      return [...this.registered.keys()];
    }
    unregisterAll() {
      for (const paneID of [...this.registered.keys()].reverse()) {
        this.unregister(paneID);
      }
    }
  };

  // src/services/win32-bridge.ts
  var Win32BridgeService = class {
    cached = null;
    supportsNativeWin32() {
      const host2 = globalThis.Zotero;
      return typeof host2 === "undefined" || host2.isWin !== false;
    }
    probeForegroundWordTitle() {
      if (!this.supportsNativeWin32()) return "";
      try {
        const api = this.getApi();
        return this.readForegroundWordTitle(api);
      } catch {
        return "";
      }
    }
    probeWordWindowTitles() {
      if (!this.supportsNativeWin32()) return { foregroundTitle: "", visibleTitles: [] };
      try {
        const api = this.getApi();
        const foregroundTitle = this.readForegroundWordTitle(api);
        const visibleTitles = [];
        let current = null;
        for (let i = 0; i < 32; i++) {
          current = api.findWindowEx(null, current, "OpusApp", null);
          if (!current || current.isNull()) break;
          if (!api.isWindowVisible(current)) continue;
          const title = this.readWindowTitle(api, current);
          if (title) visibleTitles.push(title);
        }
        return { foregroundTitle, visibleTitles };
      } catch {
        return { foregroundTitle: "", visibleTitles: [] };
      }
    }
    probeCursorWordDropTarget() {
      if (!this.supportsNativeWin32()) return { status: "unknown", windowTitle: "" };
      try {
        const api = this.getApi();
        const pt = api.POINT();
        if (!api.getCursorPos(pt.address())) return { status: "unknown", windowTitle: "" };
        const hwnd = api.windowFromPoint(pt);
        if (!hwnd || hwnd.isNull()) return { status: "unknown", windowTitle: "" };
        const root = api.getAncestor(hwnd, 2);
        const target = root && !root.isNull() ? root : hwnd;
        if (!this.isWinWordWindow(api, target)) {
          return { status: "non-word", windowTitle: this.readWindowTitle(api, target) };
        }
        return { status: "word-confirmed", windowTitle: this.readWindowTitle(api, target) };
      } catch {
        return { status: "unknown", windowTitle: "" };
      }
    }
    dispose() {
      if (!this.cached) return;
      const { user32, kernel32 } = this.cached;
      this.cached = null;
      try {
        kernel32?.close();
      } catch {
      }
      try {
        user32?.close();
      } catch {
      }
    }
    getApi() {
      if (this.cached) return this.cached;
      const ctypes = globalThis.ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs").ctypes;
      const POINT = new ctypes.StructType("BridgeFlowDropPoint", [
        { x: ctypes.long },
        { y: ctypes.long }
      ]);
      const user32 = ctypes.open("user32.dll");
      const kernel32 = ctypes.open("kernel32.dll");
      this.cached = {
        ctypes,
        POINT,
        user32,
        kernel32,
        getCursorPos: user32.declare("GetCursorPos", ctypes.winapi_abi, ctypes.int32_t, POINT.ptr),
        windowFromPoint: user32.declare("WindowFromPoint", ctypes.winapi_abi, ctypes.voidptr_t, POINT),
        getWindowThreadProcessId: user32.declare("GetWindowThreadProcessId", ctypes.winapi_abi, ctypes.uint32_t, ctypes.voidptr_t, ctypes.uint32_t.ptr),
        openProcess: kernel32.declare("OpenProcess", ctypes.winapi_abi, ctypes.voidptr_t, ctypes.uint32_t, ctypes.int32_t, ctypes.uint32_t),
        queryFullProcessImageName: kernel32.declare("QueryFullProcessImageNameW", ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.jschar.ptr, ctypes.uint32_t.ptr),
        closeHandle: kernel32.declare("CloseHandle", ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t),
        getAncestor: user32.declare("GetAncestor", ctypes.winapi_abi, ctypes.voidptr_t, ctypes.voidptr_t, ctypes.uint32_t),
        getForegroundWindow: user32.declare("GetForegroundWindow", ctypes.winapi_abi, ctypes.voidptr_t),
        findWindowEx: user32.declare("FindWindowExW", ctypes.winapi_abi, ctypes.voidptr_t, ctypes.voidptr_t, ctypes.voidptr_t, ctypes.jschar.ptr, ctypes.voidptr_t),
        isWindowVisible: user32.declare("IsWindowVisible", ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t),
        getWindowText: user32.declare("GetWindowTextW", ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t, ctypes.jschar.ptr, ctypes.int32_t),
        pathBuffer: ctypes.jschar.array(32768)(),
        titleBuffer: ctypes.jschar.array(1024)()
      };
      return this.cached;
    }
    readWindowTitle(api, hwnd) {
      if (!hwnd || hwnd.isNull()) return "";
      const len = api.getWindowText(hwnd, api.titleBuffer, api.titleBuffer.length);
      return len > 0 ? api.titleBuffer.readString() : "";
    }
    isWinWordWindow(api, hwnd) {
      if (!hwnd || hwnd.isNull()) return false;
      let handle;
      try {
        const pid = api.ctypes.uint32_t();
        if (!api.getWindowThreadProcessId(hwnd, pid.address()) || !pid.value) return false;
        handle = api.openProcess(4096, false, pid.value);
        if (handle.isNull()) return false;
        const len = api.ctypes.uint32_t(api.pathBuffer.length);
        if (!api.queryFullProcessImageName(handle, 0, api.pathBuffer, len.address())) return false;
        return api.pathBuffer.readString().split(/[\\/]/).pop()?.toLowerCase() === "winword.exe";
      } catch {
        return false;
      } finally {
        if (handle && !handle.isNull()) {
          try {
            api.closeHandle(handle);
          } catch {
          }
        }
      }
    }
    readForegroundWordTitle(api) {
      const fg = api.getForegroundWindow();
      if (!fg || fg.isNull()) return "";
      const root = api.getAncestor(fg, 2);
      const target = root && !root.isNull() ? root : fg;
      return this.isWinWordWindow(api, target) ? this.readWindowTitle(api, target) : "";
    }
  };

  // src/services/service-container.ts
  var ServiceContainer = class {
    csl;
    clipboard;
    history;
    itemPanes;
    panePositions;
    win32;
    kernel;
    constructor(kernel) {
      this.kernel = kernel;
      this.csl = new CslFormattingEngine(kernel.prefs);
      this.clipboard = new UnifiedClipboardService(this.csl, kernel.bus);
      this.history = new CitationHistoryStore();
      this.itemPanes = new ItemPaneRegistryService();
      this.panePositions = new ItemPanePositionCoordinator();
      this.win32 = new Win32BridgeService();
    }
    async init() {
      this.syncHistoryConfig();
      await this.history.init();
      this.kernel.disposables.add(
        this.kernel.notifier.subscribe(["item"], (ev) => {
          const ids = ev.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0);
          if (ids.length) this.csl.invalidateItems(ids);
        })
      );
      this.kernel.disposables.add(
        this.kernel.prefs.observeKeys(
          ["inspector.lookup.cacheDirectory", "inspector.lookup.cacheMaxEntries", "inspector.lookup.cacheTtlDays"],
          () => this.syncHistoryConfig()
        )
      );
      this.kernel.disposables.add(
        this.kernel.bus.on("inspector:clear-cache", ({ target }) => {
          if (target === "memory" || target === "all") this.csl.clearCache();
          if (target === "disk" || target === "all") this.history.clear();
        })
      );
    }
    syncHistoryConfig() {
      this.history.configure({
        customDir: this.kernel.prefs.get("inspector.lookup.cacheDirectory"),
        maxEntries: this.kernel.prefs.get("inspector.lookup.cacheMaxEntries"),
        ttlDays: this.kernel.prefs.get("inspector.lookup.cacheTtlDays")
      });
    }
    dispose() {
      this.panePositions.dispose();
      this.itemPanes.unregisterAll();
      this.history.dispose();
      this.csl.clearCache();
      this.win32.dispose();
    }
  };

  // src/index.ts
  var BridgeFlowApp = class {
    kernel;
    services;
    workspace;
    inspector;
    wordCite;
    _ftlRegistered = false;
    constructor(options = {}) {
      this.kernel = new PluginKernel(options);
      this.services = new ServiceContainer(this.kernel);
      this.workspace = new WorkspaceDomainModule(this.kernel, this.services);
      this.inspector = new InspectorDomainModule(this.kernel, this.services);
      this.wordCite = new WordCiteDomainModule(this.kernel, this.services);
      this.kernel.registerDomain(this.workspace);
      this.kernel.registerDomain(this.inspector);
      this.kernel.registerDomain(this.wordCite);
      this.kernel.registerBridge(new CopyHistoryBridge(this.kernel, this.services));
      this.kernel.registerBridge(new CiteBadgeBridge(this.kernel, this.workspace));
      this.kernel.registerBridge(new SpotlightFusionBridge(this.kernel, this.workspace, this.wordCite));
      this.kernel.registerBridge(new LookupWorkspaceBridge(this.kernel, this.workspace));
    }
    init(info) {
      this.kernel.init(info);
    }
    async start() {
      await this.services.init();
      await this.kernel.start();
    }
    onMainWindowLoad(win) {
      this.kernel.onMainWindowLoad(win);
    }
    onMainWindowUnload(win) {
      this.kernel.onMainWindowUnload(win);
    }
    shutdown() {
      this.kernel.shutdown();
      this.services.dispose();
    }
  };
  var host = globalThis.Zotero;
  if (host && !host.zoterobridgeflow) {
    host.zoterobridgeflow = new BridgeFlowApp();
  }
})();
