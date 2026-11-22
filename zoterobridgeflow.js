/* Zotero BridgeFlow v0.0.1 - Unified Reading Workspace, Inspector & Word Citation Tracking for Zotero 10-12. */
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

  // src/domains/inspector/citation-lookup-section.ts
  var CitationLookupSectionController = class {
    unregisterFn = null;
    kernel;
    services;
    engine;
    constructor(kernel, services, engine) {
      this.kernel = kernel;
      this.services = services;
      this.engine = engine;
    }
    register() {
      if (this.unregisterFn) return;
      const icon = `${this.kernel.info.rootURI}assets/view.svg`;
      this.unregisterFn = this.services.itemPanes.register({
        paneID: "bridgeflow-citation-lookup",
        pluginID: this.kernel.info.id,
        header: { l10nID: "zbf-pane-lookup-title", icon },
        sidenav: { l10nID: "zbf-pane-lookup-title", icon, orderable: true },
        onInit: ({ body }) => this.mountUI(body),
        onItemChange: () => true
      });
    }
    unregister() {
      this.unregisterFn?.();
      this.unregisterFn = null;
    }
    mountUI(body) {
      const doc = body.ownerDocument;
      if (!doc) return;
      body.textContent = "";
      const input = doc.createElementNS("http://www.w3.org/1999/xhtml", "input");
      input.type = "text";
      input.className = "zbf-lookup-input";
      input.placeholder = "DOI / Compact citation...";
      const list = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      list.className = "zbf-lookup-results";
      const runLookup = async (query) => {
        const hits = await this.engine.lookup(query);
        this.renderHits(doc, list, hits);
      };
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") void runLookup(input.value);
      });
      body.append(input, list);
    }
    renderHits(doc, container, hits) {
      container.textContent = "";
      for (const hit of hits) {
        const row = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
        row.type = "button";
        row.className = "zbf-lookup-hit";
        row.textContent = `${hit.title} (${hit.score}%)`;
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
  var CslPreviewSectionController = class {
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
      this.unregisterFn = this.services.itemPanes.register({
        paneID: "bridgeflow-csl-preview",
        pluginID: this.kernel.info.id,
        header: { l10nID: "zbf-pane-csl-preview-title", icon },
        sidenav: { l10nID: "zbf-pane-csl-preview-title", icon, orderable: true },
        onInit: ({ body }) => {
          this.states.set(body, { body, items: [], generation: 0 });
        },
        onDestroy: ({ body }) => {
          this.states.delete(body);
        },
        onItemChange: ({ body, item }) => {
          const st = this.states.get(body);
          if (!st) return false;
          const maxItems = this.kernel.prefs.get("inspector.cslPreview.maxPreviewItems");
          const { items } = deduplicateRegularItems(item ? [item] : [], maxItems);
          st.items = items;
          return items.length > 0;
        },
        onAsyncRender: async ({ body }) => {
          await this.renderState(body);
        }
      });
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
      const fontSize = `${this.kernel.prefs.get("inspector.cslPreview.fontsize")}em`;
      const lineHeight = String(this.kernel.prefs.get("inspector.cslPreview.spacing"));
      if (citeRes?.text) {
        body.append(this.buildBlock(doc, "In-Text", citeRes.text, fontSize, lineHeight, true, st.items));
      }
      if (bibRes?.text) {
        body.append(this.buildBlock(doc, "Bibliography", bibRes.text, fontSize, lineHeight, false, st.items));
      }
    }
    async refreshAll() {
      for (const body of this.states.keys()) {
        await this.renderState(body);
      }
    }
    unregister() {
      this.unregisterFn?.();
      this.unregisterFn = null;
      this.states.clear();
    }
    buildBlock(doc, label, text, fontSize, lineHeight, asCitation, items) {
      const wrap = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      wrap.className = "zbf-csl-block";
      wrap.style.fontSize = fontSize;
      wrap.style.lineHeight = lineHeight;
      const content = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      content.className = "zbf-csl-text";
      content.textContent = text;
      wrap.append(content);
      const copyBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
      copyBtn.type = "button";
      copyBtn.className = "zbf-csl-copy-btn";
      copyBtn.textContent = `Copy ${label}`;
      copyBtn.addEventListener("click", () => {
        void this.services.clipboard.copyItems(items, { asCitation, source: "preview" });
      });
      wrap.append(copyBtn);
      return wrap;
    }
  };

  // src/domains/inspector/pdf-folder-section.ts
  var PdfFolderSectionController = class {
    unregisterFn = null;
    kernel;
    services;
    constructor(kernel, services) {
      this.kernel = kernel;
      this.services = services;
    }
    register() {
      if (this.unregisterFn) return;
      const icon = `${this.kernel.info.rootURI}assets/pdf-folder.svg`;
      this.unregisterFn = this.services.itemPanes.register({
        paneID: "bridgeflow-pdf-folder",
        pluginID: this.kernel.info.id,
        header: { l10nID: "zbf-pane-pdf-folder-title", icon },
        sidenav: { l10nID: "zbf-pane-pdf-folder-title", icon, orderable: true },
        onItemChange: ({ item }) => Boolean(item),
        onToggle: ({ item }) => {
          if (item) void this.revealAttachmentFolder(item);
        }
      });
    }
    async revealAttachmentFolder(item) {
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
      this.unregisterFn?.();
      this.unregisterFn = null;
    }
  };

  // src/domains/inspector/pdf-preview-section.ts
  var PdfPreviewSectionController = class {
    unregisterFn = null;
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
      this.unregisterFn = this.services.itemPanes.register({
        paneID: "bridgeflow-pdf-preview",
        pluginID: this.kernel.info.id,
        header: { l10nID: "zbf-pane-pdf-preview-title", icon },
        sidenav: { l10nID: "zbf-pane-pdf-preview-title", icon: sidenavIcon, orderable: true },
        onItemChange: ({ item }) => Boolean(item),
        onAsyncRender: async ({ body, item }) => {
          await this.renderCompareList(body, item);
        }
      });
    }
    async resolveSameItemPdfs(item) {
      const owner = await normalizeToRegularItemAsync(item);
      return resolvePdfAttachments(owner || item);
    }
    async renderCompareList(body, item) {
      const doc = body.ownerDocument;
      if (!doc) return;
      body.textContent = "";
      const pdfs = await this.resolveSameItemPdfs(item);
      if (!pdfs.length) return;
      for (const pdf of pdfs) {
        const btn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
        btn.type = "button";
        btn.className = "zbf-pdf-entry";
        btn.textContent = pdf.filename || pdf.title;
        btn.addEventListener("click", () => {
          this.kernel.bus.emit("workspace:open-item-request", {
            itemID: pdf.id,
            attachmentID: pdf.id,
            preferExistingTab: true,
            assignToActiveGroup: true
          });
        });
        body.append(btn);
      }
    }
    unregister() {
      this.unregisterFn?.();
      this.unregisterFn = null;
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
      if (this.kernel.prefs.get("inspector.lookup.enable")) this.lookupSection.register();
      else this.lookupSection.unregister();
      if (this.kernel.prefs.get("inspector.pdfPreview.enable")) this.pdfPreview.register();
      else this.pdfPreview.unregister();
      if (this.kernel.prefs.get("inspector.pdfFolder.enable")) this.pdfFolder.register();
      else this.pdfFolder.unregister();
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

  // src/domains/word-cite/module.ts
  var WordCiteDomainModule = class {
    id = "word-cite";
    enabledPref = "modules.wordCite.enable";
    tracker;
    tagGovernance;
    dragCite;
    column;
    disposables = new DisposableStack();
    active = false;
    kernel;
    constructor(kernel, services) {
      this.kernel = kernel;
      this.tracker = new WordSessionTracker(kernel.bus, services.win32);
      this.tagGovernance = new CitationTagGovernance(kernel.prefs);
      this.dragCite = new DragCiteController(kernel, services.win32);
      this.column = new CitationColumnController(kernel, this.tracker);
    }
    isActive() {
      return this.active;
    }
    start() {
      if (this.active) return;
      this.active = true;
      this.disposables.reset();
      this.column.register();
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

  // src/domains/workspace/workspace-ui.ts
  var WORKSPACE_CSS = `
.zbf-hgroup-bar { display:flex; align-items:center; gap:6px; padding:2px 8px; overflow-x:auto; font-size:12px; }
.zbf-group-pill { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:999px; color:#fff; cursor:pointer; white-space:nowrap; }
.zbf-vsidebar { display:flex; flex-direction:column; border-inline-end:1px solid color-mix(in srgb,currentColor 14%,transparent); overflow-y:auto; }
.zbf-vtab-row { display:flex; align-items:center; justify-content:space-between; gap:6px; padding:4px 8px; cursor:pointer; }
.zbf-vtab-row:hover { background:color-mix(in srgb,currentColor 8%,transparent); }
.zbf-cite-badge { font-size:11px; font-weight:600; padding:1px 5px; border-radius:4px; background:#0D9488; color:#fff; flex-shrink:0; }
`;
  var WorkspaceWindowUI = class {
    disposables = new DisposableStack();
    badges = /* @__PURE__ */ new Map();
    win;
    prefs;
    store;
    tabs;
    spotlight;
    sidebarEl = null;
    hbarEl = null;
    constructor(win, prefs, store, tabs, spotlight) {
      this.win = win;
      this.prefs = prefs;
      this.store = store;
      this.tabs = tabs;
      this.spotlight = spotlight;
    }
    mount() {
      const doc = this.win.document;
      if (!doc?.documentElement) return;
      const style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
      style.id = "zbf-workspace-style";
      style.textContent = WORKSPACE_CSS;
      doc.documentElement.append(style);
      this.disposables.add(() => style.remove());
      const onKeyDown = (ev) => {
        if (!this.prefs.get("workspace.enableSpotlight")) return;
        if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === "p") {
          ev.preventDefault();
          this.openSpotlightOverlay();
        }
      };
      this.win.addEventListener?.("keydown", onKeyDown);
      this.disposables.add(() => this.win.removeEventListener?.("keydown", onKeyDown));
      this.disposables.add(this.store.onChange(() => this.render()));
      this.render();
    }
    setCitationBadges(badges) {
      this.badges = badges;
      this.render();
    }
    render() {
      const doc = this.win.document;
      if (!doc) return;
      this.renderHorizontalBar(doc);
      this.renderVerticalSidebar(doc);
    }
    renderHorizontalBar(doc) {
      const host2 = doc.getElementById("tab-bar-container");
      if (!host2) return;
      if (!this.prefs.get("workspace.enableHorizontalGroups")) {
        this.hbarEl?.remove();
        this.hbarEl = null;
        return;
      }
      if (!this.hbarEl) {
        const bar = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
        bar.id = "zbf-hgroup-bar";
        bar.className = "zbf-hgroup-bar";
        host2.append(bar);
        this.hbarEl = bar;
        this.disposables.add(() => {
          this.hbarEl?.remove();
          this.hbarEl = null;
        });
      }
      this.hbarEl.textContent = "";
      for (const group of this.store.state.groups) {
        const pill = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
        pill.className = "zbf-group-pill";
        pill.style.backgroundColor = group.color;
        pill.textContent = `${group.name} (${group.memberKeys.length})`;
        pill.addEventListener("click", () => {
          const collapsed = this.store.state.collapsed.includes(group.id);
          this.store.setCollapsed(group.id, !collapsed);
        });
        this.hbarEl.append(pill);
      }
    }
    renderVerticalSidebar(doc) {
      const host2 = doc.getElementById("zotero-pane-stack") || doc.getElementById("browser");
      if (!host2) return;
      if (!this.prefs.get("workspace.enableVerticalSidebar") || this.prefs.get("workspace.verticalSidebarCollapsed")) {
        this.sidebarEl?.remove();
        this.sidebarEl = null;
        return;
      }
      if (!this.sidebarEl) {
        const el = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
        el.id = "zbf-vertical-sidebar";
        el.className = "zbf-vsidebar";
        host2.prepend(el);
        this.sidebarEl = el;
        this.disposables.add(() => {
          this.sidebarEl?.remove();
          this.sidebarEl = null;
        });
      }
      this.sidebarEl.style.width = `${this.prefs.get("workspace.verticalSidebarWidth")}px`;
      this.sidebarEl.textContent = "";
      const showBadges = this.prefs.get("fusion.sidebarCiteBadge");
      const tracked = this.tabs.buildTrackedTabs(this.win);
      for (const tab of tracked) {
        const row = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
        row.className = "zbf-vtab-row";
        row.style.minHeight = `${this.prefs.get("workspace.verticalTabRowHeight")}px`;
        row.style.fontSize = `${this.prefs.get("workspace.verticalTabFontSize")}px`;
        const label = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
        label.textContent = tab.remark ? `${tab.remark} · ${tab.title}` : tab.title;
        row.append(label);
        if (showBadges) {
          const badgeInfo = this.badges.get(tab.parentItemID) || this.badges.get(tab.itemID);
          if (badgeInfo) {
            const badge = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
            badge.className = "zbf-cite-badge";
            badge.textContent = `[${badgeInfo.ordinal}]`;
            badge.title = `${badgeInfo.documentName}: ${badgeInfo.shortText}`;
            row.append(badge);
          }
        }
        row.addEventListener("click", () => {
          if (tab.tabID) this.tabs.selectTab(this.win, tab.tabID);
          else void this.tabs.focusOrOpenItem(this.win, { itemID: tab.parentItemID, attachmentID: tab.itemID });
        });
        this.sidebarEl.append(row);
      }
    }
    openSpotlightOverlay() {
      const results = this.spotlight.query("", this.win);
      if (results.length === 1) {
        void results[0].action();
      }
    }
    dispose() {
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
            "workspace.enableVerticalSidebar",
            "workspace.verticalSidebarWidth",
            "workspace.verticalSidebarCollapsed",
            "workspace.verticalTabRowHeight",
            "workspace.verticalTabFontSize",
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
    "inspector.pdfPreview.mode": {
      defaultValue: "section",
      enumValues: ["section", "full"],
      legacyKeys: ["extensions.zotero.tabflow.pdfPreviewMode"]
    },
    "inspector.pdfPreview.defaultZoom": { defaultValue: 100, min: 60, max: 200, legacyKeys: ["extensions.zotero.tabflow.pdfPreviewDefaultZoom"] },
    "inspector.pdfPreview.doubleClickOpen": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.pdfPreviewDoubleClickOpen"] },
    "inspector.pdfPreview.showPageBadge": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.pdfPreviewShowPageBadge"] },
    "inspector.pdfFolder.enable": { defaultValue: true, legacyKeys: ["extensions.zotero.tabflow.enablePdfFolderSidenav"] },
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
        return () => this.unregister(spec.paneID);
      }
      const manager = globalThis.Zotero?.ItemPaneManager;
      if (!manager?.registerSection) {
        return () => {
        };
      }
      const sectionID = manager.registerSection(spec);
      if (sectionID) {
        this.registered.set(spec.paneID, String(sectionID));
      }
      return () => this.unregister(spec.paneID);
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
    win32;
    kernel;
    constructor(kernel) {
      this.kernel = kernel;
      this.csl = new CslFormattingEngine(kernel.prefs);
      this.clipboard = new UnifiedClipboardService(this.csl, kernel.bus);
      this.history = new CitationHistoryStore();
      this.itemPanes = new ItemPaneRegistryService();
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
