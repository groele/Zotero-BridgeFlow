/* Zotero BridgeFlow v0.4.2 - Unified Reading Workspace, Inspector & Word Citation Tracking for Zotero 10-12. */
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
          if (!ev.text || !ev.itemIDs.length) return;
          if (ev.itemIDs.length === 1) {
            const itemID = ev.itemIDs[0];
            if (!Number.isSafeInteger(itemID) || itemID <= 0) return;
            const item = globalThis.Zotero?.Items?.get?.(itemID);
            if (item?.deleted || item?.isTrashed?.()) return;
            this.services.history.record({
              text: ev.text,
              libraryID: Number(item?.libraryID || 1),
              itemKey: String(item?.key || ""),
              itemID,
              title: String(item?.getField?.("title") || item?.title || ev.text.slice(0, 80)),
              style: ev.styleID
            });
            return;
          }
          const lines = ev.text.split(/\r?\n+/).map((l) => l.trim()).filter((l) => l.length >= 12);
          if (lines.length === ev.itemIDs.length) {
            for (let i = 0; i < ev.itemIDs.length; i++) {
              const itemID = ev.itemIDs[i];
              if (!Number.isSafeInteger(itemID) || itemID <= 0) continue;
              const item = globalThis.Zotero?.Items?.get?.(itemID);
              if (item?.deleted || item?.isTrashed?.()) continue;
              this.services.history.record({
                text: lines[i],
                libraryID: Number(item?.libraryID || 1),
                itemKey: String(item?.key || ""),
                itemID,
                title: String(item?.getField?.("title") || item?.title || lines[i].slice(0, 80)),
                style: ev.styleID
              });
            }
          }
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
              const groupCmdTitle = `> 将当前 Word 引用文献归入工作区分组：${active.displayName}`;
              if (!term || groupCmdTitle.toLowerCase().includes(term) || "word".includes(term) || "group".includes(term)) {
                out.push({
                  id: `cmd:group-word:${active.sessionID}`,
                  category: "command",
                  title: groupCmdTitle,
                  subtitle: `共 ${active.itemCitations.size} 篇已引用文献`,
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
              if (active.itemCitations.size > 0 && this.kernel.prefs.get("modules.visualNotes.enable") && this.kernel.prefs.get("workspace.enableAnnotationMatrix")) {
                const matrixTitle = `> 为当前 Word 已引文献生成批注对比矩阵：${active.displayName}`;
                if (!term || matrixTitle.toLowerCase().includes(term) || "word".includes(term) || "matrix".includes(term) || "矩阵".includes(term)) {
                  out.push({
                    id: `cmd:matrix-word:${active.sessionID}`,
                    category: "command",
                    title: matrixTitle,
                    subtitle: `汇总「${active.displayName}」正文中已引 ${active.itemCitations.size} 篇文献的颜色批注`,
                    badge: "矩阵",
                    action: () => {
                      this.kernel.bus.emit("visual-notes:open-matrix", {
                        win,
                        title: `Word 已引：${active.displayName}`,
                        itemIDs: [...active.itemCitations.keys()]
                      });
                    }
                  });
                }
              }
            }
            if (this.wordCite.isActive()) {
              const insertLabel = "插入当前文献到 Word 光标处";
              if (!term || insertLabel.toLowerCase().includes(term) || "word".includes(term) || "cite".includes(term)) {
                out.push({
                  id: "cmd:cite-selected-word",
                  category: "command",
                  title: insertLabel,
                  subtitle: "在当前 Word 光标处生成原生 Zotero 可编辑引文域",
                  badge: "Word",
                  action: async () => {
                    await this.wordCite.citeCurrentSelection(win);
                  }
                });
              }
            }
            if (!term || "clear cache 清空缓存".includes(term)) {
              out.push({
                id: "cmd:clear-citation-cache",
                category: "command",
                title: "清空引文记忆与反查缓存",
                subtitle: "重置已记录的引文复制历史与反查索引",
                badge: "维护",
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

  // src/services/item-remark-sync.ts
  var REMARK_PREFIX = "BridgeFlow-Remark:";
  var REMARK_LINE_RE = /^BridgeFlow-Remark:\s*(.*)$/i;
  function readRemarkFromExtra(extraText) {
    const raw = String(extraText || "");
    if (!raw) return "";
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(REMARK_LINE_RE);
      if (m) return m[1].trim();
    }
    return "";
  }
  function upsertRemarkInExtra(extraText, remark) {
    const clean = remark.replace(/[\r\n]+/g, " ").trim();
    const lines = String(extraText || "").split(/\r?\n/).filter((line) => !REMARK_LINE_RE.test(line));
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (clean) {
      lines.push(`${REMARK_PREFIX} ${clean}`);
    }
    return lines.join("\n");
  }
  function getItemBriefNote(item, cachedRemark = "") {
    const direct = String(cachedRemark || "").trim();
    if (direct) return direct;
    if (!item || typeof item.getField !== "function") return "";
    try {
      return readRemarkFromExtra(String(item.getField("extra") || ""));
    } catch {
      return "";
    }
  }
  var pendingSyncByItemID = /* @__PURE__ */ new Map();
  async function performExtraSync(itemOrID, remark) {
    try {
      const hostItems = globalThis.Zotero?.Items;
      let item = typeof itemOrID === "number" ? hostItems?.get?.(itemOrID) || (hostItems?.getAsync ? await hostItems.getAsync(itemOrID) : null) : itemOrID;
      if (!item || item.deleted) return false;
      if (item.isAttachment?.() && item.parentItemID) {
        const parent = hostItems?.get?.(item.parentItemID) || (hostItems?.getAsync ? await hostItems.getAsync(item.parentItemID) : null);
        if (parent && !parent.deleted) item = parent;
      }
      if (!item?.isRegularItem?.() || typeof item.getField !== "function" || typeof item.setField !== "function") {
        return false;
      }
      const prevExtra = String(item.getField("extra") || "");
      const nextExtra = upsertRemarkInExtra(prevExtra, remark);
      if (prevExtra === nextExtra) return true;
      item.setField("extra", nextExtra);
      if (typeof item.saveTx === "function") {
        await item.saveTx();
      } else if (typeof item.save === "function") {
        await item.save();
      }
      return true;
    } catch {
      return false;
    }
  }
  function syncItemRemarkToExtra(itemOrID, remark) {
    const rawID = typeof itemOrID === "number" ? itemOrID : Number(itemOrID?.id || 0);
    if (rawID <= 0) return performExtraSync(itemOrID, remark);
    const prev = pendingSyncByItemID.get(rawID) || Promise.resolve(true);
    const next = prev.then(() => performExtraSync(itemOrID, remark));
    pendingSyncByItemID.set(rawID, next);
    void next.finally(() => {
      if (pendingSyncByItemID.get(rawID) === next) pendingSyncByItemID.delete(rawID);
    });
    return next;
  }

  // src/bridges/visual-notes-bridge.ts
  var VisualNotesBridge = class {
    id = "visual-notes-bridge";
    kernel;
    workspace;
    visualNotes;
    prevRemarks = /* @__PURE__ */ new Map();
    disposeStoreListener = null;
    active = false;
    constructor(kernel, workspace, visualNotes) {
      this.kernel = kernel;
      this.workspace = workspace;
      this.visualNotes = visualNotes;
    }
    start() {
      if (this.active) return;
      this.active = true;
      this.seedRemarks();
      this.visualNotes.setDataSource({
        getReadingProgress: (itemID) => this.workspace.store.state.readingProgress[`item:${itemID}`],
        getRemark: (itemID) => this.workspace.store.state.remarks[`item:${itemID}`] || "",
        setRemark: (itemID, remark) => {
          this.workspace.store.setRemark(`item:${itemID}`, remark);
          this.workspace.refreshAllWindows();
        }
      });
      this.disposeStoreListener = this.workspace.store.onChange(() => {
        if (!this.active) return;
        this.syncChangedRemarksToExtra();
        this.visualNotes.refreshLibraryViews();
      });
    }
    stop() {
      if (!this.active) return;
      this.active = false;
      this.disposeStoreListener?.();
      this.disposeStoreListener = null;
      this.visualNotes.setDataSource(void 0);
    }
    seedRemarks() {
      this.prevRemarks.clear();
      for (const [k, v] of Object.entries(this.workspace.store.state.remarks)) {
        this.prevRemarks.set(k, v);
      }
    }
    syncChangedRemarksToExtra() {
      const current = this.workspace.store.state.remarks;
      const changedKeys = [];
      for (const [k, v] of Object.entries(current)) {
        if (this.prevRemarks.get(k) !== v) changedKeys.push({ key: k, value: v });
      }
      for (const k of this.prevRemarks.keys()) {
        if (!(k in current)) changedKeys.push({ key: k, value: "" });
      }
      if (!changedKeys.length) return;
      this.seedRemarks();
      if (!this.kernel.prefs.get("workspace.syncRemarkToExtra")) return;
      for (const entry of changedKeys) {
        const vm = this.workspace.store.state.virtualMembers[entry.key];
        const match = entry.key.match(/^item:(\d+)$/);
        const itemID = Number(vm?.parentItemID || vm?.itemID || (match ? match[1] : 0));
        if (itemID > 0) {
          void syncItemRemarkToExtra(itemID, entry.value).catch(() => {
          });
        }
      }
    }
  };

  // src/services/item-resolution.ts
  function isItemTrashedOrDeleted(item) {
    if (!item || item.deleted) return true;
    return typeof item.isTrashed === "function" ? Boolean(item.isTrashed()) : false;
  }
  function isItemWritable(item) {
    if (isItemTrashedOrDeleted(item)) return false;
    return typeof item.isEditable === "function" ? Boolean(item.isEditable()) : true;
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
    while (current && !isItemTrashedOrDeleted(current)) {
      const id = Number(current.id || 0);
      if (id > 0) {
        if (seen.has(id)) return null;
        seen.add(id);
      }
      if (isRegularValidItem(current)) return current;
      const parentID = Number(current.parentID || current.parentItemID || 0);
      if (current.parentItem) current = current.parentItem;
      else if (parentID > 0 && globalThis.Zotero?.Items?.get) current = globalThis.Zotero.Items.get(parentID);
      else return null;
    }
    return null;
  }
  async function normalizeToRegularItemAsync(item) {
    const sync = normalizeToRegularItem(item);
    if (sync || isItemTrashedOrDeleted(item)) return sync;
    const parentID = Number(item.parentID || item.parentItemID || 0);
    if (parentID > 0 && globalThis.Zotero?.Items?.getAsync) {
      try {
        return normalizeToRegularItem(await globalThis.Zotero.Items.getAsync(parentID));
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
  function getPdfAttachmentSortRank(rawTitle, filename, isBest = false) {
    const probe = `${rawTitle} ${filename}`;
    const isSupp = /\[补充材料\]|【补充材料】|\[附(?:件|录|表|图)?\]|(?:\b|_|-)(?:supp(?:lement(?:ary|al)?)?|si|supporting[\s_-]*info(?:rmation)?|appendix)(?:\b|_|\.pdf|$)/i.test(probe);
    const isReview = /\[审稿|\[回复|(?:\b|_|-)(?:peer[\s_-]*review|rebuttal|response[\s_-]*to[\s_-]*reviewers?)(?:\b|_|\.pdf|$)/i.test(probe);
    const isMain = /\[正文\]|【正文】|(?:\b|_|-)(?:main|manuscript)(?:\b|_|\.pdf|$)/i.test(probe);
    if (isMain && !isSupp) return 0;
    if (!isSupp && !isReview) return isBest ? 1 : 2;
    if (isSupp) return 3;
    return 4;
  }
  function formatPdfAttachmentDisplayTitle(rawTitle, filename, index, hasDuplicateRawTitle = false) {
    const t = String(rawTitle || "").trim();
    const f = String(filename || "").trim();
    if (!t) return f || `PDF ${index + 1}`;
    if (!f || t.toLowerCase() === f.toLowerCase() || t.toLowerCase().endsWith(".pdf")) return t;
    const hasRolePrefix = /^(?:\[[^\]]+\]|【[^】]+】)/.test(t);
    if ((hasRolePrefix || t.length > 32) && !hasDuplicateRawTitle) {
      return t;
    }
    const shortFile = f.length > 36 ? `…${f.slice(-24)}` : f;
    return `${t} (${shortFile})`;
  }
  function formatCompactPdfOptionLabel(title, maxChars = 40) {
    const clean = String(title || "").replace(/\s+/g, " ").trim();
    if (clean.length <= maxChars) return clean;
    if (/^(?:\[[^\]]+\]|【[^】]+】)/.test(clean)) {
      return `${clean.slice(0, maxChars - 1).trimEnd()}…`;
    }
    const tailLen = Math.min(18, Math.floor((maxChars - 1) * 0.45));
    const headLen = Math.max(12, maxChars - 1 - tailLen);
    return `${clean.slice(0, headLen).trimEnd()}…${clean.slice(-tailLen).trimStart()}`;
  }
  async function resolvePdfAttachments(item) {
    if (isItemTrashedOrDeleted(item)) return [];
    const hostItems = globalThis.Zotero?.Items;
    const owner = await normalizeToRegularItemAsync(item);
    const target = owner || item;
    const candidates = [];
    const seen = /* @__PURE__ */ new Set();
    const pushIfPdf = (att) => {
      if (!att || isItemTrashedOrDeleted(att) || !att.isPDFAttachment?.()) return;
      const id = Number(att.id || 0);
      if (id > 0 && seen.has(id)) return;
      if (id > 0) seen.add(id);
      candidates.push(att);
    };
    const best = typeof target?.getBestAttachment === "function" ? await target.getBestAttachment().catch(() => null) : null;
    const bestID = Number(best?.id || 0);
    pushIfPdf(best);
    if (typeof target?.getAttachments === "function") {
      const ids = target.getAttachments() || [];
      for (const id of ids) {
        const att = hostItems?.get?.(id) || (hostItems?.getAsync ? await hostItems.getAsync(id).catch(() => null) : null);
        pushIfPdf(att);
      }
    }
    pushIfPdf(item);
    const rawList = candidates.map((att, origIdx) => {
      const id = Number(att.id || 0);
      const rawTitle = safeGetItemField(att, "title").trim();
      const filename = String(att.attachmentFilename || "").trim();
      const rank = getPdfAttachmentSortRank(rawTitle, filename, id > 0 && id === bestID);
      return { att, id, rawTitle, filename, rank, origIdx };
    });
    rawList.sort((a, b) => a.rank - b.rank || a.origIdx - b.origIdx);
    const titleCounts = /* @__PURE__ */ new Map();
    for (const r of rawList) {
      if (r.rawTitle) titleCounts.set(r.rawTitle.toLowerCase(), (titleCounts.get(r.rawTitle.toLowerCase()) || 0) + 1);
    }
    return rawList.map((r, idx) => ({
      item: r.att,
      id: r.id,
      title: formatPdfAttachmentDisplayTitle(
        r.rawTitle,
        r.filename,
        idx,
        Boolean(r.rawTitle && (titleCounts.get(r.rawTitle.toLowerCase()) || 0) > 1)
      ),
      filename: r.filename
    }));
  }
  async function resolveBestFileAttachment(itemOrID) {
    const hostItems = globalThis.Zotero?.Items;
    const item = typeof itemOrID === "number" ? hostItems?.get?.(itemOrID) || await hostItems?.getAsync?.(itemOrID) : itemOrID;
    if (!item || isItemTrashedOrDeleted(item)) return null;
    if (item.isFileAttachment?.()) return item;
    const best = await item.getBestAttachment?.().catch(() => null);
    if (best && !isItemTrashedOrDeleted(best) && (best.isFileAttachment?.() ?? true)) return best;
    const owner = await normalizeToRegularItemAsync(item);
    const pdfs = await resolvePdfAttachments(owner || item);
    return pdfs[0]?.item ?? null;
  }
  var recentRevealTimestamps = /* @__PURE__ */ new Map();
  async function revealItemAttachmentInFilesystem(itemOrID, options = {}) {
    try {
      const att = await resolveBestFileAttachment(itemOrID);
      if (!att) return false;
      const zotero = globalThis.Zotero;
      const filePath = await att.getFilePathAsync?.().catch(() => null) || att.getFilePath?.();
      const nsFile = filePath ? zotero?.File?.pathToFile?.(filePath) : null;
      const folder = nsFile?.parent?.path;
      const cacheKey = filePath || folder || String(att.id || "");
      const dedupMs = options.dedupMs ?? 350;
      if (cacheKey && dedupMs > 0) {
        const now = Date.now();
        if (now - (recentRevealTimestamps.get(cacheKey) ?? 0) < dedupMs) return true;
        recentRevealTimestamps.set(cacheKey, now);
      }
      try {
        if (options.openMode === "folder" && folder && zotero?.launchFile) {
          await zotero.launchFile(folder);
          return true;
        }
        if (nsFile && nsFile.exists?.() !== false && typeof nsFile.reveal === "function") {
          await Promise.resolve(nsFile.reveal());
          return true;
        }
        const targetWin = options.win?.ZoteroPane ? options.win : zotero?.getMainWindow?.();
        if (targetWin?.ZoteroPane?.showAttachmentInFilesystem) {
          await targetWin.ZoteroPane.showAttachmentInFilesystem(att.id);
          return true;
        }
        if (folder && zotero?.launchFile) {
          await zotero.launchFile(folder);
          return true;
        }
      } catch (err) {
        if (cacheKey) recentRevealTimestamps.delete(cacheKey);
        throw err;
      }
    } catch (error) {
      globalThis.Zotero?.logError?.(error instanceof Error ? error : new Error(String(error)));
    }
    return false;
  }
  async function locateItemInZoteroLibrary(itemOrID, options = {}) {
    try {
      const zotero = globalThis.Zotero;
      const win = options.win?.ZoteroPane ? options.win : zotero?.getMainWindow?.();
      const pane = win?.ZoteroPane;
      if (!pane) return false;
      const rawItem = typeof itemOrID === "number" ? zotero?.Items?.get?.(itemOrID) || await zotero?.Items?.getAsync?.(itemOrID) : itemOrID;
      if (rawItem && isItemTrashedOrDeleted(rawItem)) return false;
      const primary = rawItem ? normalizeToRegularItem(rawItem) || rawItem : null;
      const targetID = Number(primary?.id ?? (typeof itemOrID === "number" ? itemOrID : 0));
      if (!targetID) return false;
      if (win.Zotero_Tabs && win.Zotero_Tabs.selectedID !== "zotero-pane") {
        win.Zotero_Tabs.select?.("zotero-pane");
      }
      if (options.switchCollection && primary) {
        const cols = primary.getCollections?.() || [];
        if (cols.length && pane.collectionsView?.selectCollection) {
          await pane.collectionsView.selectCollection(cols[0]);
        }
      }
      const ok = await pane.selectItem?.(targetID, true);
      if (ok === false) return false;
      const tree = win.document?.getElementById?.("zotero-items-tree");
      if (tree?.ensureRowIsVisible && tree?.selection) {
        tree.ensureRowIsVisible(tree.selection.currentIndex);
      }
      return true;
    } catch {
      return false;
    }
  }
  var MAX_ITEM_FIELD_CACHE = 800;
  var itemFieldCache = /* @__PURE__ */ new Map();
  var titleMarkupCache = /* @__PURE__ */ new Map();
  function invalidateResolvedItemCache(itemIDs) {
    if (!itemIDs) {
      itemFieldCache.clear();
      titleMarkupCache.clear();
      return;
    }
    for (const id of itemIDs) itemFieldCache.delete(Number(id));
  }
  function getCachedPrimaryItemFields(item, fallbackTitle = "") {
    const primary = normalizeToRegularItem(item) || item;
    const id = Number(primary?.id || 0);
    const stamp = String(primary?.dateModified || primary?.version || "");
    if (id > 0 && stamp) {
      const hit = itemFieldCache.get(id);
      if (hit && hit.stamp === stamp) return hit;
    }
    const title = safeGetItemField(primary, "title") || stripItemTitleMarkup(fallbackTitle);
    const shortTitle = safeGetItemField(primary, "shortTitle") || title;
    const source = safeGetItemField(primary, "publicationTitle") || safeGetItemField(primary, "proceedingsTitle") || safeGetItemField(primary, "bookTitle") || safeGetItemField(primary, "repository");
    const creatorYear = formatCreatorYear(primary);
    const entry = { stamp, title, shortTitle, source, creatorYear };
    if (id > 0 && stamp && title) {
      if (itemFieldCache.size >= MAX_ITEM_FIELD_CACHE) itemFieldCache.clear();
      itemFieldCache.set(id, entry);
    }
    return entry;
  }
  function stripItemTitleMarkup(value) {
    const raw = String(value || "");
    if (!raw || !raw.includes("<")) return raw;
    const cached = titleMarkupCache.get(raw);
    if (cached !== void 0) return cached;
    let out = raw.replace(/<[^>]*>/g, "").trim();
    const render = globalThis.Zotero?.Utilities?.Internal?.renderItemTitle;
    if (typeof render === "function") {
      try {
        const r = render.call(globalThis.Zotero.Utilities.Internal, raw);
        out = (typeof r === "string" ? r : String(r?.textContent ?? raw)).replace(/<[^>]*>/g, "").trim();
      } catch {
      }
    }
    if (titleMarkupCache.size >= MAX_ITEM_FIELD_CACHE) titleMarkupCache.clear();
    titleMarkupCache.set(raw, out);
    return out;
  }
  function safeGetItemField(item, field) {
    if (!item || typeof item.getField !== "function") return "";
    let out = "";
    try {
      out = String(item.getField(field, false, true) || "");
    } catch {
      try {
        out = String(item.getField(field) || "");
      } catch {
        return "";
      }
    }
    return field === "title" || field === "shortTitle" ? stripItemTitleMarkup(out) : out;
  }
  function formatCreatorYear(item) {
    if (!item) return "";
    const first = String(item.firstCreator || safeGetItemField(item, "firstCreator") || "");
    const date = (safeGetItemField(item, "year") || safeGetItemField(item, "date")).slice(0, 4);
    return [first, date].filter(Boolean).join(", ");
  }
  function resolvePrimaryCollectionName(item) {
    const ids = item?.getCollections?.() || [];
    const hostCols = globalThis.Zotero?.Collections;
    for (const id of ids) {
      const col = hostCols?.get?.(id);
      const name = col && !col._isBridgeFlowCollection && !col._isCiteFlowCollection ? String(col.name || "") : "";
      if (name && !name.startsWith("📝 ")) return name;
    }
    return "";
  }

  // src/domains/inspector/citation-lookup-parser.ts
  function extractIdentifier(input) {
    const doiMatch = input.match(/\b(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)\b/i);
    const arxivMatch = input.match(/\b(?:arXiv:\s*|arxiv\.org\/(?:abs|pdf)\/)(\d{4}\.\d{4,5}(?:v\d+)?)\b/i) || input.trim().match(/^(\d{4}\.\d{4,5}(?:v\d+)?)$/i);
    return {
      doi: doiMatch ? doiMatch[1].replace(/[.,;)]+$/, "") : void 0,
      arxiv: arxivMatch ? arxivMatch[1] : void 0
    };
  }
  function stripAuthorPrefix(text2) {
    const quoteMatch = text2.match(/^(.+?)[,.\s]+["\u201c].+?["\u201d][,.\s]+(.+)$/);
    if (quoteMatch) {
      return { authors: quoteMatch[1].trim(), rest: quoteMatch[2].replace(/^in\s+/i, "").trim() };
    }
    const gbtMatch = text2.match(/^([^.]+?)\.\s*.+?\[J\][.,\s]+(.+)$/i);
    if (gbtMatch) {
      return { authors: gbtMatch[1].trim(), rest: gbtMatch[2].trim() };
    }
    const etAlMatch = text2.match(/^(.+?\bet\s+al\.?),?\s+(.+)$/i);
    if (etAlMatch) {
      return { authors: etAlMatch[1].trim(), rest: etAlMatch[2].trim() };
    }
    const semiMatch = text2.match(/^([^;]+(?:;\s*[^;]+)+)[,;]\s+([A-Z].+)$/);
    if (semiMatch) {
      return { authors: semiMatch[1].trim(), rest: semiMatch[2].trim() };
    }
    return { rest: text2 };
  }
  function normalizeJournal(name) {
    return name.toLowerCase().replace(/&/g, "and").replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
  }
  function parseCompactCitation(input) {
    if (!input || typeof input !== "string") return null;
    const clean = input.replace(/\s+/g, " ").trim().replace(/^(?:\[\d+\]\s*|\(\d+\)\s*|\d{1,3}[.)]\s+|•\s*)/, "").replace(/\.+$/, "").replace(/[\u2010-\u2015\u2212]/g, "-");
    const ids = extractIdentifier(clean);
    let stripped = clean;
    if (ids.doi) {
      stripped = stripped.replace(/(?:doi:?\s*|https?:\/\/(?:dx\.)?doi\.org\/)?10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/i, "").trim().replace(/[.,;:]+$/, "");
    }
    if (ids.arxiv) {
      stripped = stripped.replace(/(?:https?:\/\/)?(?:arXiv:\s*|arxiv\.org\/(?:abs|pdf)\/)?\b\d{4}\.\d{4,5}(?:v\d+)?\b/i, "").trim().replace(/[.,;:]+$/, "");
    }
    const { authors, rest: target } = stripAuthorPrefix(stripped);
    const m1 = target.match(/^(.+?)[,\s;:]+(\d{4})[,\s;:]+(?:vol\.?\s*)?(\d+)(?:\s*\(([\w-]+)\))?[,\s;:]+(?:pp?\.?\s*)?([A-Za-z]*\d+)(?:-([A-Za-z]*\d+))?$/i);
    if (m1) {
      return {
        raw: input,
        journalText: m1[1].trim(),
        year: parseInt(m1[2], 10),
        volume: m1[3].trim(),
        issue: m1[4] || void 0,
        firstPage: m1[5].trim(),
        lastPage: m1[6] ? m1[6].trim() : void 0,
        pages: m1[6] ? `${m1[5].trim()}-${m1[6].trim()}` : m1[5].trim(),
        authorPrefix: authors,
        ...ids
      };
    }
    const m2 = target.match(/^(.+?)[,\s]+(?:vol\.?\s*)?(\d+)(?:\s*\(([\w-]+)\))?\s*\((\d{4})\)[,\s;:]+(?:pp?\.?\s*)?([A-Za-z]*\d+)(?:-([A-Za-z]*\d+))?$/i);
    if (m2) {
      return {
        raw: input,
        journalText: m2[1].trim(),
        volume: m2[2].trim(),
        issue: m2[3] || void 0,
        year: parseInt(m2[4], 10),
        firstPage: m2[5].trim(),
        lastPage: m2[6] ? m2[6].trim() : void 0,
        pages: m2[6] ? `${m2[5].trim()}-${m2[6].trim()}` : m2[5].trim(),
        authorPrefix: authors,
        ...ids
      };
    }
    const m3 = target.match(/^(.+?)[,\s]+(?:vol\.?\s*)?(\d+)(?:(?:\s*\(([\w-]+)\))|[,\s]+(?:no\.?|issue)\s*([\w-]+))?[,\s;:]+(?:pp?\.?\s*)?([A-Za-z]*\d+)(?:-([A-Za-z]*\d+))?(?:\s*\((\d{4})\)|[,\s]+(?:[A-Za-z]+\.?\s+)?(\d{4}))$/i);
    if (m3) {
      return {
        raw: input,
        journalText: m3[1].trim(),
        volume: m3[2].trim(),
        issue: m3[3] || m3[4] || void 0,
        year: parseInt(m3[7] || m3[8], 10),
        firstPage: m3[5].trim(),
        lastPage: m3[6] ? m3[6].trim() : void 0,
        pages: m3[6] ? `${m3[5].trim()}-${m3[6].trim()}` : m3[5].trim(),
        authorPrefix: authors,
        ...ids
      };
    }
    if (ids.doi || ids.arxiv) {
      return { raw: input, journalText: "", year: 0, authorPrefix: authors, ...ids };
    }
    return null;
  }
  function isJournalMatch(queryJournal, pubTitle, abbr) {
    const qNorm = normalizeJournal(queryJournal);
    const pubNorm = normalizeJournal(pubTitle);
    const abbrNorm = normalizeJournal(abbr);
    if (pubNorm === qNorm || abbrNorm === qNorm) return true;
    if (!qNorm) return false;
    const stopwords = /* @__PURE__ */ new Set(["of", "the", "and", "for", "in", "on", "a", "an"]);
    const pubAcronym = pubNorm.split(" ").filter((w) => !stopwords.has(w)).map((w) => w[0]).join("");
    if (pubAcronym && pubAcronym === qNorm) return true;
    const abbrAcronym = abbrNorm.split(" ").filter((w) => !stopwords.has(w)).map((w) => w[0]).join("");
    if (abbrAcronym && abbrAcronym === qNorm) return true;
    const qTokens = qNorm.split(" ").filter((t) => t.length > 0 && !stopwords.has(t));
    if (!qTokens.length) return false;
    const lastToken = qTokens[qTokens.length - 1];
    if (lastToken && lastToken.length === 1 && /[a-z]/i.test(lastToken)) {
      const pubLast = pubNorm.split(" ").pop();
      const abbrLast = abbrNorm.split(" ").pop();
      if (pubLast !== lastToken && abbrLast !== lastToken) return false;
    }
    const matchTokens = (targetNorm) => {
      if (!targetNorm) return false;
      const tokens = targetNorm.split(" ").filter((token) => token.length > 0 && !stopwords.has(token));
      return tokens.length === qTokens.length && qTokens.every((token, index) => tokens[index].startsWith(token));
    };
    return matchTokens(pubNorm) || matchTokens(abbrNorm);
  }
  async function queryPhysicalCandidates(parsed, libraryID) {
    const host2 = globalThis.Zotero;
    if (!host2?.Items) return [];
    const runSearch = async (libID) => {
      if (!host2.Search) return [];
      try {
        const s = new host2.Search();
        if (libID !== void 0 && libID !== null) s.libraryID = libID;
        if (parsed.doi) {
          s.addCondition("DOI", "is", parsed.doi);
        } else if (parsed.arxiv && !parsed.journalText) {
          s.addCondition("quicksearch-everything", "contains", parsed.arxiv.replace(/v\d+$/, ""));
        } else {
          s.addCondition("itemType", "is", "journalArticle");
          if (parsed.year) {
            try {
              s.addCondition("date", "contains", String(parsed.year));
            } catch {
            }
          }
        }
        return await s.search() || [];
      } catch {
        return [];
      }
    };
    let ids = await runSearch(libraryID);
    if (!ids.length && libraryID !== void 0) ids = await runSearch(void 0);
    if (ids.length && host2.Items.getAsync) {
      const items = await host2.Items.getAsync(ids).catch(() => []);
      return Array.isArray(items) ? items : items ? [items] : [];
    }
    if (typeof host2.Items.getAll === "function") {
      const targetLib = libraryID ?? host2.Libraries?.userLibraryID ?? 1;
      return await host2.Items.getAll(targetLib, true, false).catch(() => []) || [];
    }
    return [];
  }
  function expandEndPage(first, last) {
    if (!first || !last) return last;
    if (/^\d+$/.test(first) && /^\d+$/.test(last) && first.length > last.length) {
      const expanded = first.slice(0, first.length - last.length) + last;
      if (parseInt(expanded, 10) > parseInt(first, 10)) return expanded;
    }
    return last;
  }
  function verifyAndFilterCandidates(candidates, parsed) {
    const matched = candidates.filter((item) => {
      if (!item || item.deleted || !item.isRegularItem?.()) return false;
      if (parsed.doi) {
        const itemDoi = safeGetItemField(item, "DOI").trim().toLowerCase();
        return itemDoi === parsed.doi.toLowerCase();
      }
      if (parsed.arxiv && !parsed.journalText) {
        const [, qBase = "", qVer] = parsed.arxiv.toLowerCase().match(/^(\d{4}\.\d{4,5})(?:v(\d+))?$/) || [
          "",
          parsed.arxiv.toLowerCase().replace(/v\d+$/, ""),
          void 0
        ];
        const fields = ["archiveID", "extra", "DOI", "url", "callNumber"].map((f) => safeGetItemField(item, f).toLowerCase());
        return fields.some((val) => {
          for (const m of val.matchAll(/(?:^|[^0-9])(\d{4}\.\d{4,5})(?:v(\d+))?(?=$|[^0-9])/g)) {
            if (m[1] === qBase && (!qVer || !m[2] || m[2] === qVer)) return true;
          }
          return false;
        });
      }
      if (parsed.year) {
        const itemYear = (safeGetItemField(item, "year") || safeGetItemField(item, "date")).match(/\b(19|20)\d{2}\b/)?.[0];
        if (!itemYear || Number(itemYear) !== parsed.year) return false;
      }
      const rawPages = safeGetItemField(item, "pages").replace(/[\u2010-\u2015\u2212]/g, "-").trim();
      const [first, last] = rawPages.split("-");
      const normItemLast = expandEndPage(first, last);
      const normParsedLast = expandEndPage(parsed.firstPage, parsed.lastPage);
      if (parsed.firstPage && first !== parsed.firstPage) return false;
      if (normParsedLast && normItemLast !== normParsedLast) return false;
      if (parsed.volume && safeGetItemField(item, "volume").trim() !== parsed.volume) return false;
      if (parsed.issue && safeGetItemField(item, "issue") !== parsed.issue) return false;
      const pubTitle = safeGetItemField(item, "publicationTitle");
      const abbr = safeGetItemField(item, "journalAbbreviation");
      return isJournalMatch(parsed.journalText, pubTitle, abbr);
    });
    if (matched.length > 1 && parsed.authorPrefix) {
      const surname = parsed.authorPrefix.replace(/\bet\s+al\.?/i, "").trim().split(/[,;\s]+/)[0]?.toLowerCase();
      if (surname && surname.length >= 2) {
        const byAuthor = matched.filter((it) => {
          const creators = it.getCreators?.() || [];
          const firstCreator = String(it.firstCreator || safeGetItemField(it, "firstCreator")).toLowerCase();
          return firstCreator.includes(surname) || creators.some((c) => String(c.lastName || c.name || "").toLowerCase().includes(surname));
        });
        if (byAuthor.length > 0) return byAuthor;
      }
    }
    return matched;
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
    async resolveRich(rawQuery, options = {}) {
      const query = String(rawQuery || "").trim();
      if (!query) return { parsed: null, historyMatched: false, candidates: [] };
      if (options.useHistory !== false) {
        const exact = this.history.lookupExact(query);
        if (exact) {
          const liveItem = await this.resolveLiveItem(exact.itemID);
          if (liveItem || options.libraryItems) {
            return {
              parsed: null,
              historyMatched: true,
              candidates: [{ itemID: exact.itemID, title: liveItem ? String(liveItem.getField?.("title") || exact.title) : exact.title, score: 100, source: "history-exact", item: liveItem }]
            };
          }
        }
        const fuzzy = this.history.searchFuzzy(query, 5);
        if (fuzzy.length) {
          const liveHits = [];
          for (const rec of fuzzy) {
            const liveItem = await this.resolveLiveItem(rec.itemID);
            if (liveItem) {
              liveHits.push({
                itemID: rec.itemID,
                title: String(liveItem.getField?.("title") || rec.title),
                score: 90,
                source: "history-fuzzy",
                item: liveItem
              });
            } else if (options.libraryItems) {
              liveHits.push({ itemID: rec.itemID, title: rec.title, score: 85, source: "history-fuzzy" });
            }
          }
          if (liveHits.length) {
            return { parsed: null, historyMatched: true, candidates: liveHits };
          }
        }
      }
      const parsed = parseCompactCitation(query);
      if (parsed && !options.libraryItems) {
        const physical = await queryPhysicalCandidates(parsed, options.libraryID);
        const verified = verifyAndFilterCandidates(physical, parsed);
        if (verified.length) {
          return {
            parsed,
            historyMatched: false,
            candidates: verified.map((it) => ({
              itemID: Number(it.id || 0),
              title: String(it.getField?.("title") || ""),
              score: 99,
              source: "physical-exact",
              item: it
            }))
          };
        }
      }
      const weighted = await this.weightedSearch(query, options.libraryItems, options.libraryID);
      return { parsed, historyMatched: false, candidates: weighted };
    }
    async lookup(rawQuery, libraryItems) {
      const outcome = await this.resolveRich(rawQuery, { useHistory: true, libraryItems });
      return [...outcome.candidates];
    }
    async resolveLiveItem(itemID) {
      const hostItems = globalThis.Zotero?.Items;
      if (!hostItems) return null;
      const item = typeof hostItems.getAsync === "function" ? await hostItems.getAsync(itemID).catch(() => null) : hostItems.get?.(itemID);
      if (!item || item.deleted || item.isTrashed?.() || !item.isRegularItem?.()) return null;
      return item;
    }
    async weightedSearch(query, libraryItems, libraryID) {
      const candidates = libraryItems ?? await this.fetchLocalLibraryItems(libraryID);
      const targetDoi = extractDoi(query);
      const targetYear = extractYear(query);
      const lowerQuery = query.toLowerCase();
      const results = [];
      const seen = /* @__PURE__ */ new Set();
      for (const item of candidates) {
        if (!isRegularValidItem(item)) continue;
        const id = Number(item.id || 0);
        if (!id || seen.has(id)) continue;
        const title = safeGetItemField(item, "title") || String(item.title || "");
        const doi = (safeGetItemField(item, "DOI") || String(item.DOI || "")).trim().toLowerCase();
        if (targetDoi && doi && doi === targetDoi) {
          seen.add(id);
          results.push({ itemID: id, title, score: 98, source: "doi", item });
          return results;
        }
        let score = 0;
        const year = (safeGetItemField(item, "year") || safeGetItemField(item, "date")).slice(0, 4);
        if (targetYear && year === targetYear) score += 25;
        const journal = (safeGetItemField(item, "publicationTitle") || safeGetItemField(item, "journalAbbreviation")).toLowerCase();
        if (journal && journal.length >= 3 && lowerQuery.includes(journal)) score += 30;
        const pages = safeGetItemField(item, "pages").replace(/[\u2013\u2014]/g, "-");
        const firstPage = pages.split("-")[0]?.trim();
        if (firstPage && firstPage.length >= 2 && lowerQuery.includes(firstPage)) score += 25;
        const creator = String(item.firstCreator || "").toLowerCase().split(",")[0]?.trim();
        if (creator && creator.length >= 2 && lowerQuery.includes(creator)) score += 20;
        if (title && title.length >= 8 && lowerQuery.includes(title.toLowerCase().slice(0, 24))) score += 45;
        if (score >= 45) {
          seen.add(id);
          results.push({ itemID: id, title, score: Math.min(95, score), source: "library-weighted", item });
        }
      }
      results.sort((a, b) => b.score - a.score);
      return results.slice(0, 8);
    }
    async fetchLocalLibraryItems(libraryID) {
      const hostItems = globalThis.Zotero?.Items;
      const targetLibID = libraryID ?? globalThis.Zotero?.Libraries?.userLibraryID ?? 1;
      if (typeof hostItems?.getAll === "function") {
        try {
          return await hostItems.getAll(targetLibID, true, false);
        } catch {
          return [];
        }
      }
      return [];
    }
  };

  // src/services/pane-positioner.ts
  var PANE_POSITION_ANCHORS = {
    "zotero-item-pane-header": null,
    "zotero-editpane-item-box": "info",
    "zotero-editpane-abstract": "abstract",
    "zotero-editpane-attachments": "attachments",
    "zotero-editpane-notes": "notes",
    "zotero-editpane-related": null
  };
  var PANE_POSITIONS = Object.keys(PANE_POSITION_ANCHORS);
  function normalizePanePosition(raw, fallback = "zotero-item-pane-header") {
    return typeof raw === "string" && Object.hasOwn(PANE_POSITION_ANCHORS, raw) ? raw : fallback;
  }
  var ItemPanePositionCoordinator = class {
    targets = /* @__PURE__ */ new Map();
    observers = /* @__PURE__ */ new Map();
    timers = /* @__PURE__ */ new Map();
    running = /* @__PURE__ */ new Set();
    dirty = /* @__PURE__ */ new Set();
    setTarget(key, spec) {
      if (!spec) this.targets.delete(key);
      else this.targets.set(key, { key, ...spec });
    }
    observeAndQueue(body) {
      const owner = body?.closest?.("item-details");
      if (!owner?.getPanes) return;
      if (!this.observers.has(owner)) {
        const parent = owner.getPanes().find((p) => p.contains?.(body))?.parentNode;
        const Observer = owner.ownerDocument?.defaultView?.MutationObserver;
        if (parent && Observer) {
          const obs = new Observer(() => {
            if (!this.running.has(owner)) this.queue(owner);
          });
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
      }, 20);
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
      if (owner.skipRender || owner.querySelector?.("[data-ztf-pdf-full-section]")) return;
      const paneIDs = this.getPaneIDs(owner);
      const targets = Array.from(this.targets.values()).filter((spec) => paneIDs.includes(spec.sectionID));
      if (!targets.length) return;
      const managed = new Set(targets.map((spec) => spec.sectionID));
      const desired = paneIDs.filter((id) => !managed.has(id));
      const native = [...desired];
      const groups = new Map(PANE_POSITIONS.map((position) => [position, []]));
      for (const spec of targets.filter((spec2) => !spec2.anchorAfterSectionID)) {
        groups.get(spec.getPosition()).push(spec.sectionID);
      }
      for (const spec of targets.filter((spec2) => spec2.anchorAfterSectionID)) {
        const group2 = groups.get(spec.getPosition());
        const anchor = group2.indexOf(spec.anchorAfterSectionID);
        group2.splice(anchor < 0 ? group2.length : anchor + 1, 0, spec.sectionID);
      }
      for (const position of PANE_POSITIONS) {
        const group2 = groups.get(position);
        if (!group2.length) continue;
        const anchor = PANE_POSITION_ANCHORS[position];
        const nativeIndex = anchor ? native.indexOf(anchor) : -1;
        const nextNative = native[nativeIndex + 1];
        const index = position === "zotero-editpane-related" || nextNative === void 0 ? desired.length : desired.indexOf(nextNative);
        desired.splice(index, 0, ...group2);
      }
      for (let index = desired.length - 1; index >= 0; index--) {
        const id = desired[index];
        if (!managed.has(id)) continue;
        const next = desired[index + 1];
        const current = this.getPaneIDs(owner);
        const currentIndex = current.indexOf(id);
        const targetIndex = next === void 0 ? current.length : current.indexOf(next);
        if (currentIndex < 0 || targetIndex < 0 || currentIndex + 1 === targetIndex) continue;
        await this.reorderPane(owner, id, next, targetIndex);
      }
    }
    getPaneIDs(owner) {
      return owner.getPanes().flatMap((pane) => pane.dataset.pane ? [pane.dataset.pane] : []);
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

  // src/domains/inspector/inspector-styles.ts
  var CLIPBOARD_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3V0H1V13H4V16H15V3H12ZM2 1H11V12H2V1ZM14 15H5V13H12V4H14V15Z" fill="#cc9200"/></svg>';
  var SUCCESS_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 1L5.5 9.5L2 6" stroke="#009900" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var VIEWFLOW_CSS = `
.zotero-preview-root {
	box-sizing: border-box;
	min-width: 0;
	max-width: 100%;
}

item-pane-custom-section:has(.zotero-preview-root),
collapsible-section:has(> .zotero-preview-root) {
	min-inline-size: 0;
	max-inline-size: 100%;
	inline-size: 100%;
	box-sizing: border-box;
	contain: inline-size;
}

.zotero-preview-root .csl-bib-body {
	line-height: var(--zotero-preview-line-height, 1.5) !important;
}

.zotero-preview-content {
	box-sizing: border-box;
	min-width: 0;
	font-size: var(--zotero-preview-font-size, 1em);
	line-height: var(--zotero-preview-line-height, 1.5);
	padding-left: 5px;
	padding-bottom: 5px;
	overflow-wrap: anywhere;
}

.zotero-preview-block {
	min-height: 22px;
}

.zotero-preview-block + .zotero-preview-block,
.zotero-preview-separator + .zotero-preview-block {
	margin-top: 6px;
}

.zotero-preview-block-row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	column-gap: 8px;
	align-items: center;
	min-width: 0;
}

.zotero-preview-block-body {
	min-width: 0;
	user-select: text;
}

.zotero-preview-block-toolbar {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	min-width: 24px;
}

.zotero-preview-message {
	padding: 5px;
	color: var(--fill-secondary, light-dark(#555, #ccc));
	font-size: 13px;
	line-height: 1.6;
}

.zotero-preview-message-info {
	color: #666;
}

.zotero-preview-message-warning,
.zotero-preview-message-error {
	color: var(--fill-primary, light-dark(#262626, #eee));
}

.zotero-preview-message-detail {
	padding: 0 5px 4px;
	color: var(--fill-secondary, light-dark(#666, #aaa));
	font-size: 12px;
	line-height: 1.5;
	overflow-wrap: anywhere;
}

.zotero-preview-root .zotero-preview-retry {
	font: inherit;
	margin: 4px 5px;
	padding: 4px 10px;
	border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
	border-radius: 4px;
	color: inherit;
	background: color-mix(in srgb, currentColor 4%, transparent);
	cursor: pointer;
}

.zotero-preview-root .zotero-preview-retry:focus-visible {
	outline: 2px solid var(--accent-blue, #4d90fe);
	outline-offset: 2px;
}

.zotero-preview-separator {
	color: #ccc;
	width: 25%;
	margin-left: 0;
}

.zotero-preview-copy {
	cursor: pointer;
	display: inline-flex;
	appearance: none;
	border: 0;
	padding: 0;
	margin: 0;
	background: transparent;
	color: inherit;
	width: 20px;
	height: 20px;
	align-items: center;
	justify-content: center;
	vertical-align: text-bottom;
	transition: transform 0.3s ease;
}

.zotero-preview-copy:hover,
.zotero-preview-copy:focus-visible {
	background: color-mix(in srgb, currentColor 10%, transparent);
	border-radius: 3px;
	outline: none;
}

.zotero-preview-copy:focus-visible {
	box-shadow: 0 0 0 2px var(--accent-blue, #4d90fe);
}

.zotero-preview-copy-success {
	transform: scale(1.2);
}

@media (prefers-color-scheme: dark) {
	.zotero-preview-message-info {
		color: var(--fill-secondary, #aaa);
	}
	.zotero-preview-separator {
		color: var(--material-border, #555);
	}
}

@media (prefers-reduced-motion: reduce) {
	.zotero-preview-copy { transition: none; }
	.zotero-preview-copy-success { transform: none; }
}

/* Compact native styling shared with ViewFlow's citation lookup. */
item-pane-custom-section:has(.zotero-viewflow-lookup-body),
collapsible-section:has(> .zotero-viewflow-lookup-body) {
	min-inline-size: 0;
	max-inline-size: 100%;
	box-sizing: border-box;
	contain: inline-size;
}
.zotero-viewflow-lookup-body {
	box-sizing: border-box;
	min-width: 0;
	max-width: 100%;
	color: var(--fill-primary, light-dark(#222, #eee));
	font: inherit;
}
.viewflow-lookup-container {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 4px 5px 6px;
	min-width: 0;
	font-size: 13px;
	line-height: 1.5;
}
.viewflow-lookup-input-wrap {
	position: relative;
	display: flex;
	align-items: center;
}
.viewflow-lookup-input {
	display: block;
	box-sizing: border-box;
	width: 100%;
	min-width: 0;
	height: 28px;
	padding: 3px 26px 3px 7px;
	border: 1px solid var(--material-border, light-dark(#d1d1d1, #555));
	border-radius: 3px;
	background: var(--material-background, light-dark(#fff, #242424));
	color: inherit;
	font: inherit;
}
.viewflow-lookup-clear {
	position: absolute;
	right: 4px;
	width: 18px;
	height: 18px;
	min-height: 0 !important;
	padding: 0 !important;
	border: 0 !important;
	border-radius: 3px;
	background: transparent !important;
	color: var(--fill-secondary, #888);
	display: inline-flex;
	align-items: center;
	justify-content: center;
	font-size: 11px;
}
.viewflow-lookup-clear[hidden] { display: none !important; }
.viewflow-lookup-input::placeholder { color: var(--fill-secondary, #888); }
.viewflow-lookup-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.viewflow-lookup-container button {
	appearance: none;
	min-height: 25px;
	margin: 0;
	padding: 2px 8px;
	border: 1px solid var(--material-border, light-dark(#d5d5d5, #555));
	border-radius: 3px;
	background: color-mix(in srgb, currentColor 3%, transparent);
	color: inherit;
	font: inherit;
	cursor: pointer;
}
.viewflow-lookup-container button:hover {
	background: color-mix(in srgb, currentColor 8%, transparent);
}
.viewflow-lookup-container button:active {
	background: color-mix(in srgb, currentColor 13%, transparent);
}
.viewflow-lookup-container .viewflow-lookup-search { font-weight: 500; }
.viewflow-lookup-container :is(button, input):focus-visible {
	outline: 2px solid var(--accent-blue, #4d90fe);
	outline-offset: 1px;
}
.viewflow-lookup-status {
	overflow-wrap: anywhere;
	color: var(--fill-secondary, light-dark(#666, #aaa));
	font-size: 12px;
}
.viewflow-lookup-status:empty { display: none; }
.viewflow-lookup-card {
	padding: 6px 0 0;
	margin-top: 2px;
	border-top: 1px solid var(--material-border, light-dark(#dedede, #444));
}
.viewflow-lookup-result-state { margin-bottom: 3px; font-size: 12px; }
.viewflow-lookup-card-head {
	color: var(--fill-primary, light-dark(#222, #eee));
	font-size: 13px;
	font-weight: 400;
	line-height: 1.5;
}
.viewflow-lookup-card-meta { margin: 4px 0 6px; font-size: 12px; }
.viewflow-lookup-card .viewflow-lookup-actions { color: var(--fill-primary, light-dark(#222, #eee)); }
.viewflow-lookup-status ul { display: grid; gap: 4px; padding: 0; list-style: none; }
.viewflow-lookup-status li button { width: 100%; text-align: start; white-space: normal; }

collapsible-section:has(.zotero-preview-root) > .head .title,
collapsible-section:has(.zotero-viewflow-lookup-body) > .head .title {
	font-size: 0.95em;
}
`;
  function ensureViewFlowStyles(doc) {
    if (!doc?.getElementById) return;
    let style = doc.getElementById("zbf-viewflow-style");
    if (!style) {
      style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
      style.id = "zbf-viewflow-style";
      (doc.head || doc.documentElement)?.append(style);
    }
    if (style.textContent !== VIEWFLOW_CSS) style.textContent = VIEWFLOW_CSS;
  }
  function setLookupL10n(el, id, fallback, args) {
    el.setAttribute("data-l10n-id", id);
    if (args) el.setAttribute("data-l10n-args", JSON.stringify(args));
    else el.removeAttribute("data-l10n-args");
    el.textContent = fallback;
  }
  function clearLookupResult(el) {
    el.removeAttribute("data-l10n-id");
    el.removeAttribute("data-l10n-args");
    el.innerHTML = "";
  }
  function renderLookupTitle(target, title) {
    const doc = target.ownerDocument;
    const Parser = doc?.defaultView?.DOMParser || globalThis.DOMParser;
    target.textContent = "";
    if (!doc || !Parser) {
      target.textContent = title.replace(/<[^>]*>/g, "");
      return;
    }
    const parsed = new Parser().parseFromString(title, "text/html");
    const allowed = /* @__PURE__ */ new Set(["sub", "sup", "i", "b", "em", "strong", "span"]);
    const append = (source, parent) => {
      if (source.nodeType === 3) {
        parent.appendChild(doc.createTextNode(source.textContent || ""));
        return;
      }
      if (source.nodeType !== 1) return;
      const tag = source.localName;
      if (["script", "style", "iframe", "object"].includes(tag)) return;
      const next = allowed.has(tag) ? doc.createElementNS("http://www.w3.org/1999/xhtml", tag) : parent;
      if (next !== parent) parent.appendChild(next);
      for (const child of Array.from(source.childNodes)) if (child) append(child, next);
    };
    for (const child of Array.from(parsed.body.childNodes)) append(child, target);
  }

  // src/domains/inspector/citation-lookup-ui.ts
  function renderLookupItemCard(doc, statusDiv, candidate, fallbackState, l10nId, cb) {
    const target = cb.resolveItem(candidate);
    clearLookupResult(statusDiv);
    const card = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    card.className = "viewflow-lookup-card";
    const stateEl = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    stateEl.className = "viewflow-lookup-result-state";
    setLookupL10n(stateEl, l10nId, fallbackState);
    card.appendChild(stateEl);
    const head = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    head.className = "viewflow-lookup-card-head";
    renderLookupTitle(head, safeGetItemField(target, "title") || candidate.title || "");
    card.appendChild(head);
    const meta = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    meta.className = "viewflow-lookup-card-meta";
    const journal = safeGetItemField(target, "publicationTitle") || safeGetItemField(target, "journalAbbreviation") || "";
    const year = (safeGetItemField(target, "year") || safeGetItemField(target, "date")).slice(0, 4);
    const vol = safeGetItemField(target, "volume");
    const pages = safeGetItemField(target, "pages");
    const headPart = [journal, year ? `(${year})` : ""].filter(Boolean).join(" ");
    const metaParts = [headPart, vol ? `Vol.${vol}` : "", pages ? `pp.${pages}` : ""].filter(Boolean);
    meta.textContent = metaParts.join(" · ") || "本地文库条目";
    card.appendChild(meta);
    const actRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    actRow.className = "viewflow-lookup-actions";
    const locateBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
    locateBtn.type = "button";
    setLookupL10n(locateBtn, "zbf-lookup-locate", "定位条目");
    locateBtn.onclick = async () => {
      locateBtn.disabled = true;
      try {
        const ok = await cb.onLocate(candidate.itemID);
        if (cb.isActive()) {
          setLookupL10n(
            stateEl,
            ok ? "zbf-lookup-status-located" : "zbf-lookup-status-locate-failed",
            ok ? "已定位" : "定位失败，请重试"
          );
        }
      } finally {
        locateBtn.disabled = false;
      }
    };
    const pdfBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
    pdfBtn.type = "button";
    setLookupL10n(pdfBtn, "zbf-lookup-open-pdf", "打开 PDF");
    pdfBtn.onclick = async () => {
      pdfBtn.disabled = true;
      try {
        const opened = await cb.onOpenPdf(target || candidate.itemID);
        if (cb.isActive() && !opened) {
          setLookupL10n(stateEl, "zbf-lookup-status-no-pdf", "未找到 PDF 附件");
        }
      } finally {
        pdfBtn.disabled = false;
      }
    };
    actRow.append(locateBtn, pdfBtn);
    if (cb.onCiteWord) {
      const citeBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
      citeBtn.type = "button";
      citeBtn.textContent = "插入 Word";
      citeBtn.title = "在当前 Word 光标处插入此文献的可编辑引文域";
      citeBtn.onclick = () => {
        const sent = cb.onCiteWord?.(candidate.itemID);
        if (cb.isActive() && sent) {
          stateEl.removeAttribute("data-l10n-id");
          stateEl.textContent = "已发送至 Word 光标处";
        }
      };
      actRow.appendChild(citeBtn);
    }
    card.appendChild(actRow);
    statusDiv.appendChild(card);
  }
  function renderLookupCandidatesList(doc, statusDiv, items, cb) {
    clearLookupResult(statusDiv);
    const heading = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    setLookupL10n(heading, "zbf-lookup-candidates-heading", `找到 ${items.length} 篇可能匹配的文献，请点击选择：`, { count: items.length });
    statusDiv.appendChild(heading);
    const list = doc.createElementNS("http://www.w3.org/1999/xhtml", "ul");
    for (const c of items) {
      const row = doc.createElementNS("http://www.w3.org/1999/xhtml", "li");
      const btn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
      btn.type = "button";
      const tObj = cb.resolveItem(c);
      const j = safeGetItemField(tObj, "journalAbbreviation") || safeGetItemField(tObj, "publicationTitle") || "";
      const y = (safeGetItemField(tObj, "year") || safeGetItemField(tObj, "date")).slice(0, 4);
      const suffix = j || y ? ` (${[j, y].filter(Boolean).join(", ")})` : "";
      renderLookupTitle(btn, safeGetItemField(tObj, "title") || c.title || "");
      if (suffix) btn.appendChild(doc.createTextNode(suffix));
      btn.onclick = () => renderLookupItemCard(doc, statusDiv, c, "候选文献，请核对后定位", "zbf-lookup-state-candidate", cb);
      row.appendChild(btn);
      list.appendChild(row);
    }
    statusDiv.appendChild(list);
  }
  function readSystemClipboardText() {
    try {
      const hostServices = globalThis.Services;
      const hostCc = globalThis.Cc;
      const hostCi = globalThis.Ci;
      if (hostServices?.clipboard && hostCc && hostCi) {
        const trans = hostCc["@mozilla.org/widget/transferable;1"].createInstance(hostCi.nsITransferable);
        trans.init?.(null);
        trans.addDataFlavor("text/plain");
        hostServices.clipboard.getData(trans, hostCi.nsIClipboard.kGlobalClipboard);
        const holder = {};
        trans.getTransferData("text/plain", holder);
        const txt = String(holder.value?.data || "").trim();
        if (txt) return txt;
      }
    } catch {
    }
    try {
      return String(globalThis.Zotero?.Utilities?.Internal?.getClipboardText?.() || "").trim();
    } catch {
      return "";
    }
  }

  // src/domains/inspector/citation-lookup-section.ts
  var CitationLookupSectionController = class {
    unregisterFn = null;
    sectionID = false;
    anchorSectionID = false;
    cleanups = /* @__PURE__ */ new WeakMap();
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
        onDestroy: ({ body }) => {
          this.cleanups.get(body)?.();
          this.cleanups.delete(body);
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
      this.cleanups.get(body)?.();
      const doc = body.ownerDocument;
      if (!doc) return;
      doc.defaultView?.MozXULElement?.insertFTLIfNeeded?.("zotero-bridgeflow.ftl");
      ensureViewFlowStyles(doc);
      body.textContent = "";
      body.className = "zotero-viewflow-lookup-body";
      const container = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      container.className = "viewflow-lookup-container";
      const inputWrap = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      inputWrap.className = "viewflow-lookup-input-wrap";
      const input = doc.createElementNS("http://www.w3.org/1999/xhtml", "input");
      input.type = "text";
      input.className = "viewflow-lookup-input";
      input.setAttribute("data-l10n-id", "zbf-lookup-input");
      const clearBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
      clearBtn.type = "button";
      clearBtn.className = "viewflow-lookup-clear";
      clearBtn.textContent = "✕";
      clearBtn.title = "清空引文输入";
      clearBtn.hidden = true;
      inputWrap.append(input, clearBtn);
      const btnRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      btnRow.className = "viewflow-lookup-actions";
      const searchBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
      searchBtn.type = "button";
      searchBtn.className = "viewflow-lookup-search";
      setLookupL10n(searchBtn, "zbf-lookup-search", "查找原文献");
      const clipBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
      clipBtn.type = "button";
      setLookupL10n(clipBtn, "zbf-lookup-clipboard", "读取剪贴板");
      btnRow.append(searchBtn, clipBtn);
      const statusDiv = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      statusDiv.className = "viewflow-lookup-status";
      statusDiv.setAttribute("role", "status");
      statusDiv.setAttribute("aria-live", "polite");
      const cacheNotice = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      cacheNotice.className = "viewflow-lookup-cache-error";
      cacheNotice.hidden = true;
      const cacheMsg = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
      const retryBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
      retryBtn.type = "button";
      retryBtn.className = "viewflow-lookup-cache-retry";
      retryBtn.textContent = "重试保存缓存";
      cacheNotice.append(cacheMsg, retryBtn);
      container.append(inputWrap, btnRow, cacheNotice, statusDiv);
      body.append(container);
      const syncCacheStatus = () => {
        if (!body.isConnected) return;
        if (this.services.history.saveFailed) {
          cacheNotice.hidden = false;
          cacheMsg.textContent = "历史缓存写入失败，记录暂存于内存，请点击重试保存。";
        } else {
          cacheNotice.hidden = true;
          cacheMsg.textContent = "";
        }
      };
      const offCacheStatus = this.services.history.onStatusChange(syncCacheStatus);
      retryBtn.onclick = async () => {
        await this.services.history.retrySave();
        syncCacheStatus();
      };
      syncCacheStatus();
      let request = 0;
      let pasteTimer;
      const cancelPaste = () => {
        if (pasteTimer !== void 0) clearTimeout(pasteTimer);
        pasteTimer = void 0;
      };
      this.cleanups.set(body, () => {
        request++;
        cancelPaste();
        offCacheStatus();
      });
      const resolveItem = (candidate) => candidate.item || globalThis.Zotero?.Items?.get?.(candidate.itemID) || null;
      const executeLookup = async (textToSearch) => {
        const current = ++request;
        const isActive = () => current === request && body.isConnected && input.value.trim() === textToSearch.trim();
        if (!textToSearch.trim()) {
          clearLookupResult(statusDiv);
          return;
        }
        const cb = {
          resolveItem,
          onLocate: (id) => this.locateItem(id),
          onOpenPdf: (target) => this.openItemPdf(target),
          onCiteWord: this.kernel.prefs.get("modules.wordCite.enable") && this.kernel.prefs.get("wordCite.tabContextMenu.enable") ? (id) => {
            this.kernel.bus.emit("word:insert-items-request", { itemIDs: [id], win: doc.defaultView || void 0 });
            return true;
          } : void 0,
          isActive
        };
        setLookupL10n(statusDiv, "zbf-lookup-status-searching", "正在反查本地文献库...");
        try {
          const pane = doc.defaultView?.ZoteroPane;
          const libraryID = pane?.getSelectedLibraryIDs?.()?.[0] ?? globalThis.Zotero?.Libraries?.userLibraryID;
          const outcome = await this.engine.resolveRich(textToSearch, {
            libraryID,
            useHistory: this.kernel.prefs.get("inspector.lookup.historyEnable")
          });
          if (!isActive()) return;
          if (!outcome.historyMatched && !outcome.parsed && !outcome.candidates.length) {
            setLookupL10n(statusDiv, "zbf-lookup-status-unrecognized", "无法识别引文结构，请提供包含期刊、年份、卷号与页码（或 DOI/arXiv）的引文。");
            return;
          }
          if (outcome.candidates.length === 1) {
            const hit = outcome.candidates[0];
            if (outcome.historyMatched) {
              renderLookupItemCard(doc, statusDiv, hit, "已匹配文献", "zbf-lookup-state-matched", cb);
            } else {
              await this.locateInLibrary(hit.itemID);
              if (!isActive()) return;
              renderLookupItemCard(doc, statusDiv, hit, "已定位文献", "zbf-lookup-state-located", cb);
            }
            return;
          }
          if (outcome.candidates.length > 1) {
            renderLookupCandidatesList(doc, statusDiv, outcome.candidates, cb);
            return;
          }
          const journalLabel = outcome.parsed?.journalText || outcome.parsed?.doi || outcome.parsed?.arxiv || "-";
          const yearLabel = String(outcome.parsed?.year || "-");
          setLookupL10n(
            statusDiv,
            "zbf-lookup-status-not-found",
            `未在当前文库中找到匹配项 (解析: ${journalLabel}, ${yearLabel})`,
            { journal: journalLabel, year: yearLabel }
          );
        } catch {
          if (isActive()) setLookupL10n(statusDiv, "zbf-lookup-status-error", "查询失败，请重试或重新粘贴引文。");
        }
      };
      const syncClear = () => {
        clearBtn.hidden = !input.value;
      };
      const resetInput = () => {
        cancelPaste();
        request++;
        input.value = "";
        syncClear();
        clearLookupResult(statusDiv);
      };
      clearBtn.onclick = () => {
        resetInput();
        input.focus();
      };
      input.oninput = () => {
        request++;
        syncClear();
        clearLookupResult(statusDiv);
        if (!input.value.trim()) cancelPaste();
      };
      searchBtn.onclick = () => {
        void executeLookup(input.value);
      };
      input.onpaste = () => {
        cancelPaste();
        pasteTimer = setTimeout(() => {
          pasteTimer = void 0;
          syncClear();
          if (input.value.trim()) void executeLookup(input.value);
        }, 0);
      };
      input.onkeydown = (e) => {
        const key = e.key;
        if (key === "Enter") {
          cancelPaste();
          void executeLookup(input.value);
        } else if (key === "Escape") {
          resetInput();
        }
      };
      clipBtn.onclick = () => {
        const clipText = readSystemClipboardText();
        if (clipText) {
          input.value = clipText;
          syncClear();
          void executeLookup(clipText);
          return;
        }
        setLookupL10n(statusDiv, "zbf-lookup-status-clipboard-fallback", "无法直接读取剪贴板，请手动在输入框中粘贴 (Ctrl+V)。");
        input.focus();
      };
    }
    async locateInLibrary(itemID) {
      return locateItemInZoteroLibrary(itemID);
    }
    async locateItem(itemID) {
      if (this.kernel.prefs.get("fusion.lookupJumpExistingTab")) {
        this.kernel.bus.emit("workspace:open-item-request", {
          itemID,
          preferExistingTab: true,
          assignToActiveGroup: false
        });
      }
      return this.locateInLibrary(itemID);
    }
    async openItemPdf(itemOrId) {
      try {
        const item = typeof itemOrId === "number" ? await globalThis.Zotero?.Items?.getAsync?.(itemOrId) : itemOrId;
        if (!item) return false;
        const pdfs = await resolvePdfAttachments(item);
        const first = pdfs[0];
        if (!first) return false;
        if (this.kernel.prefs.get("fusion.lookupJumpExistingTab")) {
          this.kernel.bus.emit("workspace:open-item-request", {
            itemID: Number(item.id || 0),
            attachmentID: first.id,
            preferExistingTab: true,
            assignToActiveGroup: true
          });
          return true;
        }
        const reader = globalThis.Zotero?.Reader;
        if (reader?.open) {
          await reader.open(first.id);
          return true;
        }
      } catch {
      }
      return false;
    }
  };

  // src/domains/inspector/csl-preview-section.ts
  var ERROR_L10N = {
    "no-style": ["zbf-preview-no-style", "QuickCopy 未选择参考文献样式，请在 Zotero 或 BridgeFlow 设置中配置样式。"],
    "style-missing": ["zbf-preview-style-missing", "所选引用样式尚未安装，请在 Zotero 中安装或切换其他样式。"],
    "quickcopy-unavailable": ["zbf-preview-quickcopy-unavailable", "QuickCopy 无法格式化当前条目，请检查引用样式后重试。"]
  };
  function escapeHTML(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
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
          if (!doc) return;
          doc.defaultView?.MozXULElement?.insertFTLIfNeeded?.("zotero-bridgeflow.ftl");
          ensureViewFlowStyles(doc);
          body.classList.add("zotero-preview-root");
          const st = {
            body,
            doc,
            items: [],
            omitted: 0,
            generation: 0,
            failed: false,
            lastHTML: "",
            payload: null,
            copyFeedback: /* @__PURE__ */ new Map(),
            feedbackTimers: /* @__PURE__ */ new Set(),
            setEnabled
          };
          this.states.set(body, st);
          this.bindBodyEvents(st);
          this.updateItems(st, item, setEnabled);
          this.services.panePositions.observeAndQueue(body);
        },
        onDestroy: ({ body }) => {
          const st = this.states.get(body);
          if (st) this.clearTimers(st);
          this.states.delete(body);
        },
        onItemChange: ({ body, item, setEnabled }) => {
          const st = this.states.get(body);
          if (!st) return false;
          st.failed = false;
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
      if (!st.items.length) {
        st.payload = null;
        this.renderMessage(st, "zbf-preview-select-items", "请选择一个或多个条目以预览引用。");
        return;
      }
      if (!st.payload && !st.lastHTML) {
        this.renderMessage(st, "zbf-preview-loading", "正在生成预览…");
      }
      try {
        const mode = String(this.kernel.prefs.get("inspector.cslPreview.whatToShow") || "zpboth");
        const wantBib = mode !== "zpcite" && mode !== "zpintext";
        const wantCite = mode !== "zpbib";
        const [bibRes, citeRes] = await Promise.all([
          wantBib ? this.services.csl.formatItems(st.items, { asCitation: false }) : Promise.resolve(null),
          wantCite ? this.services.csl.formatItems(st.items, { asCitation: true }) : Promise.resolve(null)
        ]);
        if (gen !== st.generation || st.body.isConnected === false) return;
        const payload = {};
        if (bibRes && (bibRes.html || bibRes.text)) payload.bibliography = bibRes;
        if (citeRes && (citeRes.html || citeRes.text)) payload.citation = citeRes;
        st.payload = payload;
        st.failed = false;
        this.renderPayload(st, payload);
      } catch (error) {
        if (gen !== st.generation || st.body.isConnected === false) return;
        st.payload = null;
        st.failed = true;
        const code = error?.previewCode || "";
        const [id, fallback] = ERROR_L10N[code] || ["zbf-preview-unavailable", "预览不可用，请检查引用样式后重试。"];
        const detail = code ? "" : error instanceof Error ? error.message : String(error || "");
        this.renderMessage(st, id, fallback, true, detail);
      }
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
      for (const st of this.states.values()) this.clearTimers(st);
      this.states.clear();
    }
    updateItems(st, item, setEnabled) {
      const maxItems = this.kernel.prefs.get("inspector.cslPreview.maxPreviewItems");
      const selected = item ? [item] : globalThis.Zotero?.getMainWindow?.()?.ZoteroPane?.getSelectedItems?.() || [];
      const { items } = deduplicateRegularItems(selected, maxItems);
      st.items = items;
      st.omitted = Math.max(0, deduplicateRegularItems(selected, 1e4).items.length - items.length);
      const enabled = items.length > 0;
      (setEnabled || st.setEnabled)?.(enabled);
      return enabled;
    }
    bindBodyEvents(st) {
      const triggerCopy = (button) => {
        if (!button || !st.payload) return;
        const asCitation = button.getAttribute("data-copy-citation") === "true";
        const content = st.payload[asCitation ? "citation" : "bibliography"];
        if (!content) return;
        const ok = this.services.clipboard.copyRendered(st.items, content, { asCitation, source: "preview" });
        if (ok) {
          st.body.querySelector?.(".zotero-preview-copy-status")?.remove();
          this.showCopyFeedback(st, button);
        } else {
          this.renderCopyError(st);
        }
      };
      st.body.addEventListener("click", (ev) => {
        const target = ev.target;
        const retryBtn = target?.closest?.(".zotero-preview-retry");
        if (retryBtn) {
          st.failed = false;
          void this.renderState(st.body);
          return;
        }
        const copyBtn = target?.closest?.(".zotero-preview-copy");
        if (copyBtn) triggerCopy(copyBtn);
      });
      st.body.addEventListener("keydown", (ev) => {
        const keyEv = ev;
        if (keyEv.key !== "Enter" && keyEv.key !== " ") return;
        const copyBtn = ev.target?.closest?.(".zotero-preview-copy");
        if (!copyBtn) return;
        keyEv.preventDefault?.();
        triggerCopy(copyBtn);
      });
    }
    renderPayload(st, payload) {
      const blocks = Object.entries(payload).map(([kind, content]) => {
        if (!content) return "";
        const fallbackLabel = kind === "citation" ? "复制正文引用" : "复制参考文献";
        return `<section class="zotero-preview-block"><div class="zotero-preview-block-row"><div class="zotero-preview-block-body">${content.html || escapeHTML(content.text)}</div><div class="zotero-preview-block-toolbar"><span class="zotero-preview-copy" role="button" tabindex="0" title="${fallbackLabel}" aria-label="${fallbackLabel}" data-l10n-id="zbf-preview-copy-${kind}" data-copy-citation="${kind === "citation"}">${CLIPBOARD_ICON_SVG}</span></div></div></section>`;
      }).filter(Boolean);
      let html = blocks.join('<hr class="zotero-preview-separator"/>');
      if (st.omitted > 0) {
        html += `<div class="zotero-preview-message" data-l10n-id="zbf-preview-truncated" data-l10n-args='${JSON.stringify({ count: st.omitted })}'>另有 ${st.omitted} 个条目未显示。</div>`;
      }
      if (!html) {
        this.renderMessage(st, "zbf-preview-select-items", "请选择一个或多个条目以预览引用。");
        return;
      }
      const fontSize = String(this.kernel.prefs.get("inspector.cslPreview.fontsize") || "1");
      const spacing = String(this.kernel.prefs.get("inspector.cslPreview.spacing") || "1.5");
      st.body.style.setProperty("--zotero-preview-font-size", `${fontSize}em`);
      st.body.style.setProperty("--zotero-preview-line-height", spacing);
      const wrapped = `<div class="zotero-preview-content">${html}</div>`;
      if (st.lastHTML !== wrapped) {
        this.setHTML(st, wrapped);
        st.lastHTML = wrapped;
      }
    }
    renderMessage(st, id, fallback, error = false, detail = "") {
      const cleanDetail = error ? detail.trim().slice(0, 240) : "";
      const detailHtml = cleanDetail ? `<div class="zotero-preview-message-detail">${escapeHTML(cleanDetail)}</div>` : "";
      const html = `<div class="zotero-preview-message${error ? " zotero-preview-message-error" : ""}" role="status" data-l10n-id="${id}">${escapeHTML(fallback)}</div>` + detailHtml + (error ? '<button type="button" class="zotero-preview-retry" data-preview-retry="" data-l10n-id="zbf-preview-retry">重新生成预览</button>' : "");
      if (st.lastHTML === html) return;
      this.setHTML(st, html);
      st.lastHTML = html;
    }
    renderCopyError(st) {
      let status = st.body.querySelector?.(".zotero-preview-copy-status");
      if (!status) {
        status = st.doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
        status.className = "zotero-preview-copy-status zotero-preview-message";
        status.setAttribute("role", "status");
        st.body.appendChild(status);
      }
      status.setAttribute("data-l10n-id", "zbf-preview-copy-unavailable");
      status.textContent = "复制不可用，请尝试 Zotero 快捷键或重新选择条目。";
    }
    showCopyFeedback(st, button) {
      for (const timer of st.copyFeedback.get(button) || []) {
        clearTimeout(timer);
        st.feedbackTimers.delete(timer);
      }
      button.classList.add("zotero-preview-copy-success");
      this.replaceButtonSvg(st.doc, button, SUCCESS_ICON_SVG);
      const scaleTimer = setTimeout(() => {
        st.feedbackTimers.delete(scaleTimer);
        button.classList.remove("zotero-preview-copy-success");
      }, 300);
      const iconTimer = setTimeout(() => {
        st.feedbackTimers.delete(iconTimer);
        st.copyFeedback.delete(button);
        this.replaceButtonSvg(st.doc, button, CLIPBOARD_ICON_SVG);
      }, 1e3);
      st.feedbackTimers.add(scaleTimer);
      st.feedbackTimers.add(iconTimer);
      st.copyFeedback.set(button, [scaleTimer, iconTimer]);
    }
    replaceButtonSvg(doc, button, svgMarkup) {
      const Parser = doc.defaultView?.DOMParser || globalThis.DOMParser;
      if (!Parser) return;
      const parsed = new Parser().parseFromString(svgMarkup, "text/html");
      if (parsed?.body?.firstChild) {
        button.replaceChildren(doc.importNode(parsed.body.firstChild, true));
      }
    }
    setHTML(st, html) {
      if (st.body.isConnected === false) return;
      this.clearTimers(st);
      const Parser = st.doc.defaultView?.DOMParser || globalThis.DOMParser;
      if (!Parser) {
        st.body.textContent = html.replace(/<[^>]*>/g, "");
        return;
      }
      const parsed = new Parser().parseFromString(html, "text/html");
      if (!parsed?.body) return;
      st.body.replaceChildren(
        ...Array.from(parsed.body.childNodes).map((node) => st.doc.importNode(node, true))
      );
    }
    clearTimers(st) {
      for (const timer of st.feedbackTimers) clearTimeout(timer);
      st.feedbackTimers.clear();
      st.copyFeedback.clear();
    }
  };

  // src/domains/inspector/pdf-renderer.ts
  var PDFJS_MODULE_URL = "resource://zotero/reader/pdf/build/pdf.mjs";
  var PDFJS_WORKER_URL = "resource://zotero/reader/pdf/build/pdf.worker.mjs";
  var PDFJS_CMAP_URL = "resource://zotero/reader/pdf/web/cmaps/";
  var PDFJS_FONT_URL = "resource://zotero/reader/pdf/web/standard_fonts/";
  var cachedPdfJsLib = null;
  function isPdfAttachment(att) {
    if (!att || att.deleted || att.isTrashed?.()) return false;
    if (typeof att.isPDFAttachment === "function") return Boolean(att.isPDFAttachment());
    if (att.isFileAttachment?.() === false) return false;
    const mime = String(att.attachmentContentType || "").toLowerCase();
    if (mime === "application/pdf") return true;
    const name = String(att.attachmentFilename || att.getField?.("title") || "").toLowerCase();
    return name.endsWith(".pdf");
  }
  var resolveOwnerRegularItem = async (it) => await normalizeToRegularItemAsync(it) || it;
  async function resolveAllPdfAttachments(item) {
    if (!item || item.deleted || item.isTrashed?.()) return [];
    const target = await resolveOwnerRegularItem(item);
    if (!target || target.deleted || target.isTrashed?.()) return [];
    const rawAtts = [];
    const seen = /* @__PURE__ */ new Set();
    const pushIfPdf = (att) => {
      if (!isPdfAttachment(att)) return;
      const id = Number(att.id) || rawAtts.length + 1;
      if (seen.has(id)) return;
      seen.add(id);
      rawAtts.push(att);
    };
    if (isPdfAttachment(target) && !target.isRegularItem?.()) {
      pushIfPdf(target);
    } else {
      const best = await target.getBestAttachment?.().catch(() => null);
      pushIfPdf(best);
      const ids = target.getAttachments?.() || [];
      const hostItems = globalThis.Zotero?.Items;
      if (ids.length && hostItems?.getAsync) {
        const batch = await hostItems.getAsync(ids).catch(() => null);
        if (Array.isArray(batch)) {
          for (const att of batch) pushIfPdf(att);
        }
      }
      for (const rawId of ids) {
        const id = Number(rawId) || 0;
        if (!id || seen.has(id)) continue;
        const att = hostItems?.get?.(id) || (hostItems?.getAsync ? await hostItems.getAsync(id).catch(() => null) : null);
        pushIfPdf(att);
      }
      if (isPdfAttachment(item)) pushIfPdf(item);
    }
    const bestID = Number((await target.getBestAttachment?.().catch(() => null))?.id || 0);
    const ranked = rawAtts.map((att, origIdx) => {
      const id = Number(att.id) || origIdx + 1;
      const rawTitle = String(att?.getField?.("title") || "").trim();
      const filename = String(att?.attachmentFilename || "").trim();
      const rank = getPdfAttachmentSortRank(rawTitle, filename, id === bestID);
      return { att, id, rawTitle, filename, rank, origIdx };
    });
    ranked.sort((a, b) => a.rank - b.rank || a.origIdx - b.origIdx);
    const titleCounts = /* @__PURE__ */ new Map();
    for (const r of ranked) {
      if (r.rawTitle) titleCounts.set(r.rawTitle.toLowerCase(), (titleCounts.get(r.rawTitle.toLowerCase()) || 0) + 1);
    }
    return ranked.map((r, idx) => {
      const hasDup = Boolean(r.rawTitle && (titleCounts.get(r.rawTitle.toLowerCase()) || 0) > 1);
      const title = formatPdfAttachmentDisplayTitle(r.rawTitle, r.filename, idx, hasDup);
      const fullTitle = r.rawTitle && r.filename && r.rawTitle.toLowerCase() !== r.filename.toLowerCase() ? `${r.rawTitle} (${r.filename})` : title;
      return {
        id: r.id,
        title,
        shortLabel: formatCompactPdfOptionLabel(title, 40),
        fullTitle,
        attachment: r.att
      };
    });
  }
  async function resolveSameItemPdfContext(item, win) {
    if (!item || item.deleted || item.isTrashed?.()) {
      return { ownerID: 0, currentAttachmentID: 0, entries: [] };
    }
    const isAtt = Boolean(item.isAttachment?.() || item.isPDFAttachment?.() || item.itemType === "attachment" || isPdfAttachment(item));
    const container = await resolveOwnerRegularItem(item);
    const ownerID = Number(container?.id || item.id) || 0;
    const entries = await resolveAllPdfAttachments(container || item);
    let currentAttachmentID = isAtt ? Number(item.id) || 0 : 0;
    if (!currentAttachmentID) {
      const hostZotero = globalThis.Zotero;
      const targetWin = win || hostZotero?.getMainWindow?.() || null;
      const selectedTabID = String(targetWin?.Zotero_Tabs?.selectedID || "");
      const readerAttID = Number(
        hostZotero?.Reader?.getByTabID?.(selectedTabID)?.itemID || targetWin?.Zotero_Tabs?._tabs?.find?.((t) => t?.id === selectedTabID)?.data?.itemID || 0
      );
      if (readerAttID > 0 && entries.some((entry) => entry.id === readerAttID)) {
        currentAttachmentID = readerAttID;
      }
    }
    return { ownerID, currentAttachmentID, entries };
  }
  function pickCompareAttachment(ctx, mode, explicitAttachmentID, tabType = "library") {
    if (!ctx.entries.length) return null;
    if (ctx.entries.length === 1) return ctx.entries[0];
    if (explicitAttachmentID) {
      const exact = ctx.entries.find((e) => e.id === explicitAttachmentID);
      if (exact) return exact;
    }
    if (tabType === "library") {
      if (ctx.currentAttachmentID) {
        return ctx.entries.find((e) => e.id === ctx.currentAttachmentID) ?? ctx.entries[0];
      }
      return ctx.entries[0];
    }
    if (mode === "self" && ctx.currentAttachmentID) {
      return ctx.entries.find((e) => e.id === ctx.currentAttachmentID) ?? ctx.entries[0];
    }
    if (ctx.currentAttachmentID) {
      return ctx.entries.find((e) => e.id !== ctx.currentAttachmentID) ?? ctx.entries[0];
    }
    return ctx.entries[0];
  }
  async function resolveAttachmentPath(att) {
    if (!att) return null;
    const p = await att.getFilePathAsync?.().catch(() => null) || att.getFilePath?.();
    return typeof p === "string" && p.trim() ? p : null;
  }
  function binaryStringToUint8Array(raw) {
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 255;
    return bytes;
  }
  async function readPdfBytes(filePath) {
    const zotero = globalThis.Zotero;
    const ioUtils = globalThis.IOUtils || zotero?.getMainWindow?.()?.IOUtils;
    if (ioUtils?.read) {
      const data = await ioUtils.read(filePath);
      return data instanceof Uint8Array ? data : new Uint8Array(data);
    }
    if (zotero?.File?.getBinaryContentsAsync) {
      const raw = await zotero.File.getBinaryContentsAsync(filePath);
      return raw instanceof Uint8Array ? raw : binaryStringToUint8Array(String(raw || ""));
    }
    throw new Error("No file reader available for PDF preview");
  }
  function tryImportModule(cu, url) {
    if (!cu?.importESModule) return null;
    for (const opts of [{ global: "current" }, null]) {
      try {
        const mod = opts !== null ? cu.importESModule(url, opts) : cu.importESModule(url);
        if (mod) return mod;
      } catch {
      }
    }
    return null;
  }
  async function loadPdfJsLib(win) {
    if (cachedPdfJsLib) return cachedPdfJsLib;
    const zotero = globalThis.Zotero;
    const hostWin = win || zotero?.getMainWindow?.();
    if (hostWin && !globalThis.window) {
      try {
        globalThis.window = hostWin;
        globalThis.document = hostWin.document;
      } catch {
      }
    }
    const winCu = hostWin?.ChromeUtils;
    const globalCu = globalThis.ChromeUtils;
    const workerMod = tryImportModule(winCu, PDFJS_WORKER_URL) || tryImportModule(globalCu, PDFJS_WORKER_URL);
    if (workerMod) {
      try {
        globalThis.pdfjsWorker = workerMod;
        if (hostWin) hostWin.pdfjsWorker = workerMod;
      } catch {
      }
    }
    let mod = tryImportModule(winCu, PDFJS_MODULE_URL) || tryImportModule(globalCu, PDFJS_MODULE_URL);
    if (typeof mod?.getDocument !== "function") {
      try {
        mod = await new Function("u", "return import(u)")(PDFJS_MODULE_URL);
      } catch {
        mod = null;
      }
    }
    if (typeof mod?.getDocument !== "function") throw new Error("Failed to load Zotero PDF.js module");
    if (mod.GlobalWorkerOptions && !mod.GlobalWorkerOptions.workerSrc) {
      mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    }
    cachedPdfJsLib = mod;
    return mod;
  }
  async function openPdfDocumentFromFile(filePath, doc) {
    const win = doc?.defaultView || globalThis.Zotero?.getMainWindow?.();
    const ownerDocument = doc || win?.document;
    const [pdfjsLib, data] = await Promise.all([loadPdfJsLib(win), readPdfBytes(filePath)]);
    const loadingTask = pdfjsLib.getDocument({
      data,
      ownerDocument,
      isEvalSupported: false,
      useWorkerFetch: false,
      cMapUrl: PDFJS_CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: PDFJS_FONT_URL
    });
    return await loadingTask.promise;
  }
  async function renderPageToCanvas(pdfDoc, pageNumber, canvas, targetWidth, zoomRatio, dpr, isAborted, onTask) {
    const page = await pdfDoc.getPage(pageNumber);
    if (isAborted()) {
      page.cleanup?.();
      return { width: 0, height: 0 };
    }
    const baseViewport = page.getViewport({ scale: 1 });
    const safeWidth = Math.max(120, targetWidth);
    const cssScale = safeWidth / Math.max(1, baseViewport.width) * zoomRatio;
    const cssViewport = page.getViewport({ scale: cssScale });
    const pixelRatio = Math.max(1.25, Math.min(3, (dpr || 1) * 1.15));
    canvas.width = Math.max(1, Math.floor(cssViewport.width * pixelRatio));
    canvas.height = Math.max(1, Math.floor(cssViewport.height * pixelRatio));
    if (Math.abs(zoomRatio - 1) < 0.01) {
      canvas.style.width = "100%";
      canvas.style.height = "auto";
    } else {
      canvas.style.width = `${Math.floor(cssViewport.width)}px`;
      canvas.style.height = `${Math.floor(cssViewport.height)}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    const transform = pixelRatio === 1 ? void 0 : [pixelRatio, 0, 0, pixelRatio, 0, 0];
    const task = page.render({ canvasContext: ctx, viewport: cssViewport, transform });
    onTask?.(() => {
      try {
        task.cancel?.();
      } catch {
      }
    });
    try {
      await task.promise;
    } catch (err) {
      if (err?.name === "RenderingCancelledException" || isAborted()) return { width: 0, height: 0 };
      throw err;
    } finally {
      page.cleanup?.();
    }
    return { width: Math.floor(cssViewport.width), height: Math.floor(cssViewport.height) };
  }
  async function openPdfInReader(att, win, pageNumber) {
    if (!att?.id) return false;
    const zotero = globalThis.Zotero;
    const location = typeof pageNumber === "number" && pageNumber >= 1 ? { pageIndex: pageNumber - 1 } : void 0;
    try {
      if (zotero?.Reader?.open) {
        try {
          await zotero.Reader.open(att.id, location, { openInWindow: false });
        } catch {
          await zotero.Reader.open(att.id, void 0, { openInWindow: false });
        }
        return true;
      }
      const targetWin = win?.ZoteroPane ? win : zotero?.getMainWindow?.();
      if (targetWin?.ZoteroPane?.viewAttachment) {
        await targetWin.ZoteroPane.viewAttachment([att.id]);
        return true;
      }
    } catch (error) {
      zotero?.logError?.(error instanceof Error ? error : new Error(String(error)));
    }
    return false;
  }

  // src/domains/inspector/pdf-folder-section.ts
  function displayAttachmentName(raw) {
    return raw.replace(/(?:%[a-f\d]{2})+/gi, (encoded) => {
      try {
        return decodeURIComponent(encoded);
      } catch {
        return encoded;
      }
    });
  }
  var FOLDER_ICON = 'item-pane-sidenav .btn[data-l10n-id="zbf-pane-pdf-folder-sidenav"]';
  function folderActionTarget(event) {
    return event.composedPath?.().find(
      (node) => node.matches?.(FOLDER_ICON) === true
    );
  }
  var PdfFolderSectionController = class {
    unregisterFn = null;
    states = /* @__PURE__ */ new Map();
    listeners = /* @__PURE__ */ new Map();
    openingFolders = /* @__PURE__ */ new WeakSet();
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
        onInit: ({ doc, body, item, setEnabled, setSectionSummary }) => {
          this.initBody(doc || body.ownerDocument, body, item, setEnabled, setSectionSummary);
          this.services.panePositions.observeAndQueue(body);
        },
        onDestroy: ({ doc, body }) => {
          this.onDestroy(doc || body.ownerDocument, body);
        },
        onItemChange: ({ body, item, setEnabled, setSectionSummary }) => {
          this.updateState(body, item, setEnabled, setSectionSummary);
          this.services.panePositions.observeAndQueue(body);
          return this.kernel.prefs.get("inspector.pdfFolder.enable") && Boolean(item);
        },
        onRender: ({ body, item, setEnabled, setSectionSummary }) => {
          this.updateState(body, item, setEnabled, setSectionSummary);
          this.services.panePositions.observeAndQueue(body);
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
    async revealAttachmentFolder(item, fallbackWin) {
      return revealItemAttachmentInFilesystem(item, {
        openMode: this.kernel.prefs.get("inspector.pdfFolder.openMode"),
        win: fallbackWin
      });
    }
    unregister() {
      this.services.panePositions.setTarget("pdf-folder", null);
      for (const state of this.states.values()) state.controller.abort();
      for (const controller of this.listeners.values()) controller.abort();
      this.listeners.clear();
      this.unregisterFn?.();
      this.unregisterFn = null;
      this.states.clear();
    }
    initBody(doc, body, item, setEnabled, setSectionSummary) {
      const win = doc?.defaultView;
      if (!doc || !win) return;
      win.MozXULElement?.insertFTLIfNeeded?.("zotero-bridgeflow.ftl");
      let controller = this.listeners.get(doc);
      if (!controller) {
        controller = new win.AbortController();
        this.listeners.set(doc, controller);
        this.bindFolderActions(doc, win, controller.signal);
      }
      body.textContent = "";
      const wrap = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      wrap.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr);gap:6px;min-inline-size:0;contain:inline-size;padding:4px 0;font:12px/1.4 system-ui,sans-serif;";
      const selectEl = doc.createElementNS("http://www.w3.org/1999/xhtml", "select");
      selectEl.className = "ztf-pdf-folder-select";
      selectEl.style.cssText = "display:none;min-inline-size:0;inline-size:100%;block-size:22px;padding:0 6px;border-radius:4px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:transparent;color:inherit;font:500 11px/1.2 system-ui,sans-serif;cursor:pointer;";
      const meta = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      meta.style.cssText = "display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere;";
      const btn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
      btn.type = "button";
      btn.className = "ztf-pdf-folder-action";
      btn.setAttribute("data-l10n-id", "zbf-pdf-folder-open");
      btn.textContent = "打开文件夹并选中 PDF";
      btn.style.cssText = "justify-self:start;min-inline-size:0;max-inline-size:100%;box-sizing:border-box;padding:5px 10px;border-radius:5px;border:1px solid color-mix(in srgb,currentColor 20%,transparent);background:transparent;color:inherit;font:inherit;white-space:normal;overflow-wrap:anywhere;text-align:start;cursor:pointer;";
      btn.disabled = true;
      this.states.get(body)?.controller.abort();
      const panelController = new win.AbortController();
      const st = { body, controller: panelController, refreshRevision: 0, item: null, selectedAttachment: null, entries: [], selectEl, btn, meta, setSectionSummary };
      btn.addEventListener("click", () => {
        if (!btn.disabled) this.openFolder(st.selectedAttachment, win);
      }, { signal: panelController.signal });
      selectEl.addEventListener("change", () => {
        const hit = st.entries.find((e) => String(e.id) === selectEl.value);
        if (hit) {
          st.selectedAttachment = hit.attachment;
          st.meta.textContent = displayAttachmentName(String(hit.attachment?.attachmentFilename || hit.title || "附件文件"));
          st.meta.title = st.meta.textContent;
          st.setSectionSummary?.(st.entries.length > 1 ? `${st.entries.length} · ${st.meta.textContent}` : st.meta.textContent);
          try {
            const CustomEv = win?.CustomEvent || CustomEvent;
            doc.dispatchEvent?.(new CustomEv("zbf:pdf-folder-attachment-selected", {
              detail: { attachmentID: hit.id }
            }));
          } catch {
          }
        }
      }, { signal: panelController.signal });
      doc.addEventListener("zbf:pdf-attachment-selected", ((ev) => {
        const attID = Number(ev?.detail?.attachmentID || 0);
        if (!attID || !st.entries.length) return;
        const hit = st.entries.find((e) => e.id === attID);
        if (hit && st.selectedAttachment !== hit.attachment) {
          st.selectedAttachment = hit.attachment;
          st.selectEl.value = String(hit.id);
          st.meta.textContent = displayAttachmentName(String(hit.attachment?.attachmentFilename || hit.title || "附件文件"));
          st.meta.title = st.meta.textContent;
        }
      }), { signal: panelController.signal });
      wrap.append(selectEl, meta, btn);
      body.append(wrap);
      this.states.set(body, st);
      this.updateState(body, item, setEnabled, setSectionSummary);
    }
    bindFolderActions(doc, win, signal) {
      const options = { capture: true, signal };
      let pressed;
      let keyed;
      doc.addEventListener("pointerdown", (event) => {
        keyed = void 0;
        pressed = event.isTrusted && event.button === 0 ? folderActionTarget(event) : void 0;
      }, options);
      doc.addEventListener("pointercancel", () => {
        pressed = void 0;
      }, options);
      doc.addEventListener("keydown", (event) => {
        pressed = void 0;
        keyed = event.isTrusted && !event.repeat && (event.key === "Enter" || event.key === " ") ? folderActionTarget(event) : void 0;
      }, options);
      doc.addEventListener("click", (event) => {
        const target = folderActionTarget(event);
        const activated = target && (!event.isTrusted || (event.detail === 0 ? keyed : pressed) === target);
        keyed = pressed = void 0;
        if (!activated || event.button !== 0 || event.detail > 1) return;
        if (!this.kernel.prefs.get("inspector.pdfFolder.enable")) return;
        const sidenav = target.closest("item-pane-sidenav");
        const item = sidenav?.container?.item ?? win.ZoteroPane?.getSelectedItems?.()?.[0];
        const state = [...this.states.values()].find((s) => s.body.ownerDocument === doc && s.item === item);
        this.openFolder(state?.selectedAttachment ?? item, win);
      }, options);
    }
    openFolder(item, win) {
      if (!item || this.openingFolders.has(win) || !this.kernel.prefs.get("inspector.pdfFolder.enable")) return;
      this.openingFolders.add(win);
      void this.revealAttachmentFolder(item, win).then((ok) => {
        if (ok) return;
        const zh = Boolean(globalThis.Zotero?.locale?.startsWith?.("zh"));
        for (const st of this.states.values()) {
          if (st.body.ownerDocument === win.document && (st.selectedAttachment === item || st.item === item)) {
            st.meta.textContent = zh ? "未找到本地附件文件（可能尚未下载或已被移动）" : "Local attachment file not found (may not be synced locally)";
            st.meta.title = st.meta.textContent;
          }
        }
      }).catch((error) => this.kernel.logger.error("pdf-folder", error)).finally(() => this.openingFolders.delete(win));
    }
    onDestroy(doc, body) {
      this.states.get(body)?.controller.abort();
      this.states.delete(body);
      if (!doc || [...this.states.keys()].some((other) => other.ownerDocument === doc)) return;
      this.listeners.get(doc)?.abort();
      this.listeners.delete(doc);
    }
    updateState(body, item, setEnabled, setSectionSummary) {
      const enabled = this.kernel.prefs.get("inspector.pdfFolder.enable") && Boolean(item);
      setEnabled?.(enabled);
      const st = this.states.get(body);
      if (!st) return;
      if (setSectionSummary) st.setSectionSummary = setSectionSummary;
      if (!enabled) st.setSectionSummary?.("");
      const previousID = st.item === item ? st.selectedAttachment?.id : null;
      st.item = enabled ? item : null;
      const revision = ++st.refreshRevision;
      st.btn.disabled = true;
      void Promise.resolve().then(() => {
        if (this.states.get(body) === st && revision === st.refreshRevision) void this.refreshMeta(st, revision, previousID);
      });
    }
    async refreshMeta(st, revision, previousID) {
      const item = st.item;
      st.btn.disabled = true;
      st.btn.style.opacity = "0.5";
      st.selectEl.style.display = "none";
      st.selectEl.textContent = "";
      st.entries = [];
      st.selectedAttachment = null;
      st.meta.textContent = "";
      st.meta.removeAttribute("title");
      st.meta.removeAttribute("data-l10n-id");
      if (!item) return;
      const entries = await resolveAllPdfAttachments(item).catch(() => []);
      const att = entries[0]?.attachment || await this.resolveFileAttachment(item).catch(() => null);
      if (this.states.get(st.body) !== st || st.refreshRevision !== revision) return;
      if (!att) {
        st.meta.setAttribute("data-l10n-id", "zbf-pdf-folder-unavailable");
        st.meta.textContent = "当前条目没有文件附件";
        return;
      }
      st.entries = entries;
      const doc = st.body.ownerDocument;
      if (doc && entries.length > 1) {
        entries.forEach((entry, idx) => {
          const opt = doc.createElementNS("http://www.w3.org/1999/xhtml", "option");
          opt.value = String(entry.id);
          const compact = displayAttachmentName(entry.shortLabel || entry.title);
          opt.textContent = `${idx + 1}. ${compact}`;
          opt.title = `${idx + 1}. ${displayAttachmentName(entry.fullTitle || entry.title)}`;
          st.selectEl.append(opt);
        });
        const directID = Number(item?.id) || 0;
        const initial = entries.find((e) => e.id === previousID) || entries.find((e) => e.id === directID) || entries[0];
        const initIdx = Math.max(0, entries.findIndex((e) => e.id === initial.id));
        st.selectedAttachment = initial.attachment;
        st.selectEl.value = String(initial.id);
        st.selectEl.title = `${initIdx + 1}. ${displayAttachmentName(initial.fullTitle || initial.title)}`;
        st.selectEl.style.display = "block";
      } else {
        st.selectedAttachment = att;
      }
      const activeAtt = st.selectedAttachment || att;
      st.meta.textContent = displayAttachmentName(String(activeAtt.attachmentFilename || activeAtt.getField?.("title") || "附件文件"));
      st.meta.title = st.meta.textContent;
      st.setSectionSummary?.(st.entries.length > 1 ? `${st.entries.length} · ${st.meta.textContent}` : st.meta.textContent);
      st.btn.disabled = false;
      st.btn.style.opacity = "1";
    }
    async resolveFileAttachment(item) {
      return resolveBestFileAttachment(item);
    }
  };

  // src/domains/inspector/pdf-preview-ui.ts
  var XHTML_NS = "http://www.w3.org/1999/xhtml";
  var SVG_NS = "http://www.w3.org/2000/svg";
  var TOOL_SVG_PATHS = {
    prev: "M10 3.5L5.5 8L10 12.5",
    next: "M6 3.5L10.5 8L6 12.5",
    zoomOut: "M3.8 8H12.2",
    zoomIn: "M8 3.8V12.2M3.8 8H12.2",
    toggleMode: "M2.5 5.5V2.5H5.5M10.5 2.5H13.5V5.5M13.5 10.5V13.5H10.5M5.5 13.5H2.5V10.5",
    openReader: "M9.5 2.8H13.2V6.5M13 3L7.5 8.5M11.5 9.2V12.4C11.5 12.84 11.14 13.2 10.7 13.2H3.6C3.16 13.2 2.8 12.84 2.8 12.4V5.3C2.8 4.86 3.16 4.5 3.6 4.5H6.8"
  };
  var STATUS_FALLBACKS = {
    "zbf-pdf-preview-loading": "正在加载 PDF 预览…",
    "zbf-pdf-preview-unavailable": "当前条目无可用的 PDF 附件",
    "zbf-pdf-preview-missing-file": "找不到本地 PDF 文件，请先检查附件存储路径",
    "zbf-pdf-preview-error": "无法渲染此 PDF，请尝试在阅读器中打开"
  };
  function createXhtmlEl(doc, tag, css = "") {
    const node = doc.createElementNS(XHTML_NS, tag);
    if (css) node.style.cssText = css;
    return node;
  }
  function createToolBtn(doc, text2, l10nId, extraClass = "", iconKey) {
    const btn = createXhtmlEl(doc, "button");
    btn.type = "button";
    btn.className = extraClass ? `ztf-pdf-btn ${extraClass}` : "ztf-pdf-btn";
    if (l10nId) btn.setAttribute("data-l10n-id", l10nId);
    const d = iconKey ? TOOL_SVG_PATHS[iconKey] : "";
    if (d && typeof doc.createElementNS === "function") {
      const svg = doc.createElementNS(SVG_NS, "svg");
      for (const [k, v] of [["viewBox", "0 0 16 16"], ["width", "12"], ["height", "12"], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "1.6"], ["stroke-linecap", "round"], ["stroke-linejoin", "round"], ["class", "ztf-pdf-btn-svg"]]) {
        svg.setAttribute(k, v);
      }
      const path = doc.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      svg.append(path);
      btn.append(svg);
      if (text2 && iconKey === "openReader") {
        const span = createXhtmlEl(doc, "span");
        span.textContent = text2;
        btn.append(span);
      }
    } else if (text2) btn.textContent = text2;
    return btn;
  }
  function applyStatusMessage(statusEl, l10nId) {
    if (!l10nId) {
      statusEl.style.display = "none";
      statusEl.removeAttribute("data-l10n-id");
      statusEl.textContent = "";
      return;
    }
    statusEl.style.display = "block";
    statusEl.setAttribute("data-l10n-id", l10nId);
    statusEl.textContent = STATUS_FALLBACKS[l10nId] || l10nId;
  }
  function ensureSectionConnected(body, root, _savedSection, savedCollapsible) {
    if (!body.contains(root)) body.replaceChildren(root);
    const owner = body.closest?.("collapsible-section") || (savedCollapsible?.contains(body) ? savedCollapsible : null);
    if (!owner) return null;
    owner.removeAttribute?.("empty");
    owner.style?.setProperty?.("--open-height", "auto");
    return owner;
  }
  var PreviewFocus = class {
    owners = /* @__PURE__ */ new WeakSet();
    isActive(body) {
      const owner = body.closest("item-details");
      return !!owner && this.owners.has(owner);
    }
    set(state, active) {
      const owner = state.body.closest("item-details");
      if (owner) {
        if (active) this.owners.add(owner);
        else this.owners.delete(owner);
      }
      state.fullActive = active;
      applyPreviewLayoutMode(state.body, state.root, state.customSection, active);
    }
  };
  function applyPreviewLayoutMode(body, root, savedSection, fullActive) {
    root.setAttribute("data-layout-mode", fullActive ? "full" : "section");
    const modeBtn = root.querySelector?.(".ztf-pdf-mode-btn");
    if (modeBtn) {
      if (fullActive) {
        modeBtn.setAttribute("data-active", "true");
        modeBtn.title = "退出全高独占模式，恢复侧边栏其他区块";
      } else {
        modeBtn.removeAttribute("data-active");
        modeBtn.title = "切换内嵌区块 / 占满侧边栏预览模式";
      }
    }
    const hostSection = body.closest?.("item-pane-custom-section") || savedSection;
    const stack = hostSection?.parentElement;
    if (!hostSection) return;
    if (fullActive) {
      hostSection.setAttribute("data-ztf-pdf-full-section", "true");
      stack?.setAttribute("data-ztf-pdf-full-stack", "true");
    } else {
      hostSection.removeAttribute("data-ztf-pdf-full-section");
      if (!stack?.querySelector("[data-ztf-pdf-full-section]")) stack?.removeAttribute("data-ztf-pdf-full-stack");
    }
  }
  function bindPreviewSidenavClick(doc, signal, body, onFullModeChange) {
    doc.addEventListener("click", (event) => {
      const mouse = event;
      if (mouse.button !== 0 || mouse.detail > 1) return;
      const selector = "item-pane-sidenav .btn[data-pane]";
      const btn = event.composedPath?.().find((node) => node?.matches?.(selector)) || event.target?.closest?.(selector);
      if (!btn || btn.hasAttribute("disabled")) return;
      const container = btn.closest("item-pane-sidenav")?.container;
      if (!container?.contains(body)) return;
      const section = body.closest("item-pane-custom-section");
      if (!section) return;
      const selected = btn.getAttribute("data-pane") === section.getAttribute("data-pane");
      if (selected) {
        const collapsible = body.closest("collapsible-section");
        if (collapsible && !collapsible.open) {
          collapsible.removeAttribute("empty");
          collapsible.open = true;
        }
      }
      onFullModeChange(selected);
    }, { capture: true, signal });
  }
  function createCompareBar(doc, signal, getState, onChange) {
    const bar = createXhtmlEl(doc, "div");
    bar.className = "ztf-pdf-compare-bar";
    bar.style.display = "none";
    const countLabel = createXhtmlEl(doc, "span");
    countLabel.className = "ztf-pdf-compare-count";
    countLabel.textContent = "PDF 1/1";
    const prevAttBtn = createToolBtn(doc, "‹", void 0, "ztf-pdf-compare-nav ztf-pdf-prev-att", "prev");
    prevAttBtn.title = "切换上一个 PDF 附件";
    const nextAttBtn = createToolBtn(doc, "›", void 0, "ztf-pdf-compare-nav ztf-pdf-next-att", "next");
    nextAttBtn.title = "切换下一个 PDF 附件";
    const swapBtn = createXhtmlEl(doc, "button");
    swapBtn.type = "button";
    swapBtn.className = "ztf-pdf-btn ztf-pdf-compare-btn ztf-pdf-swap-att";
    swapBtn.textContent = "⇄";
    swapBtn.title = "对比闪切：在当前与上一份对比 PDF 之间一键切换";
    const selfBtn = createXhtmlEl(doc, "button");
    selfBtn.type = "button";
    selfBtn.className = "ztf-pdf-btn ztf-pdf-compare-btn";
    selfBtn.textContent = "自身";
    selfBtn.setAttribute("data-l10n-id", "zbf-pdf-compare-self");
    const selectEl = createXhtmlEl(doc, "select");
    selectEl.className = "ztf-pdf-compare-select";
    selectEl.setAttribute("data-l10n-id", "zbf-pdf-compare-select");
    const switchAttachment = (val) => {
      if (!val) return;
      const cur = getState();
      const prevVal = Number(cur.pickedAttachmentID || selectEl.value || 0);
      if (prevVal && prevVal !== val) cur.lastAttachmentID = prevVal;
      selectEl.value = String(val);
      onChange(val === cur.currentAttachmentID ? "self" : "sibling", val);
    };
    const cycleAttachment = (delta) => {
      const opts = Array.from(selectEl.options || []);
      if (opts.length <= 1) return;
      const curIdx = Math.max(0, selectEl.selectedIndex);
      const nextIdx = (curIdx + delta + opts.length) % opts.length;
      switchAttachment(Number(opts[nextIdx]?.value || 0));
    };
    prevAttBtn.addEventListener("click", () => cycleAttachment(-1), { signal });
    nextAttBtn.addEventListener("click", () => cycleAttachment(1), { signal });
    swapBtn.addEventListener("click", () => {
      const opts = Array.from(selectEl.options || []);
      if (opts.length <= 1) return;
      const cur = getState();
      const curVal = Number(selectEl.value || 0);
      const lastVal = Number(cur.lastAttachmentID || 0);
      if (lastVal && lastVal !== curVal && opts.some((o) => Number(o.value) === lastVal)) {
        switchAttachment(lastVal);
      } else {
        cycleAttachment(1);
      }
    }, { signal });
    selfBtn.addEventListener("click", () => {
      const cur = getState();
      onChange(cur.mode === "self" ? "sibling" : "self", null);
    }, { signal });
    selectEl.addEventListener("change", () => {
      switchAttachment(Number(selectEl.value || 0));
    }, { signal });
    bar.append(countLabel, prevAttBtn, selectEl, nextAttBtn, swapBtn, selfBtn);
    return { bar, countLabel, prevAttBtn, swapBtn, selfBtn, selectEl, nextAttBtn };
  }
  function syncCompareBar(ui, st, entries, activeAttachmentID) {
    const isReaderSingle = st.tabType === "reader" && entries.length >= 1;
    const visible = entries.length > 1 || isReaderSingle;
    ui.bar.style.display = visible ? "flex" : "none";
    if (!visible) return;
    const multiAtt = entries.length > 1;
    ui.prevAttBtn.style.display = multiAtt ? "inline-flex" : "none";
    ui.nextAttBtn.style.display = multiAtt ? "inline-flex" : "none";
    ui.selectEl.style.display = multiAtt ? "block" : "none";
    ui.swapBtn.style.display = multiAtt ? "inline-flex" : "none";
    ui.countLabel.style.display = multiAtt ? "inline-flex" : "none";
    const showSelf = st.tabType === "reader" && st.currentAttachmentID > 0;
    ui.selfBtn.style.display = showSelf ? "inline-flex" : "none";
    const isSelf = st.mode === "self" || st.currentAttachmentID > 0 && activeAttachmentID === st.currentAttachmentID;
    if (isSelf) ui.selfBtn.setAttribute("data-active", "true");
    else ui.selfBtn.removeAttribute("data-active");
    const doc = ui.bar.ownerDocument;
    if (!doc) return;
    ui.selectEl.textContent = "";
    let activeIdx = 0;
    entries.forEach((entry, idx) => {
      if (entry.id === activeAttachmentID) activeIdx = idx;
      const opt = createXhtmlEl(doc, "option");
      opt.value = String(entry.id);
      const isCurrent = st.currentAttachmentID > 0 && entry.id === st.currentAttachmentID;
      const compact = entry.shortLabel || entry.title;
      opt.textContent = isCurrent ? `● ${idx + 1}. ${compact}` : `${idx + 1}. ${compact}`;
      opt.title = `${idx + 1}. ${entry.fullTitle || entry.title}`;
      ui.selectEl.append(opt);
    });
    if (activeAttachmentID) ui.selectEl.value = String(activeAttachmentID);
    const activeEntry = entries[activeIdx];
    if (activeEntry) {
      ui.selectEl.title = `${activeIdx + 1}. ${activeEntry.fullTitle || activeEntry.title}`;
    }
    ui.countLabel.textContent = `PDF ${activeIdx + 1}/${entries.length}`;
  }
  function openPageJumpInput(doc, pageLabel, currentPage, numPages, onCommit) {
    if (numPages <= 1) return;
    const input = createXhtmlEl(doc, "input");
    input.type = "number";
    input.className = "ztf-pdf-page-input";
    input.min = "1";
    input.max = String(numPages);
    input.value = String(currentPage || 1);
    let closed = false;
    const finish = (commit) => {
      if (closed) return;
      closed = true;
      const target = Number(input.value);
      input.replaceWith?.(pageLabel);
      if (commit && Number.isFinite(target) && target >= 1) onCommit(Math.round(target));
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault?.();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault?.();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    pageLabel.replaceWith?.(input);
    input.focus?.();
    input.select?.();
  }
  function evictDistantPageCanvases(slots, currentPage, radius = 8) {
    if (slots.length <= 14) return;
    for (const slot of slots) {
      if (slot.renderedZoom !== null && !slot.rendering && Math.abs(slot.pageNumber - currentPage) > radius) {
        slot.canvas.width = 0;
        slot.canvas.height = 0;
        slot.renderedZoom = null;
        slot.card.setAttribute("data-unrendered", "true");
        if (slot.lastHeight > 0) slot.card.style.minBlockSize = `${slot.lastHeight}px`;
      }
    }
  }

  // src/domains/inspector/pdf-viewport-manager.ts
  function disposePreviewDocument(state, clearAttachments = false) {
    const prevAttID = Number(state.attachment?.id) || 0;
    if (prevAttID > 0 && state.currentPage >= 1) {
      state.pageByAttachment.set(prevAttID, state.currentPage);
    }
    state.generation += 1;
    state.loading = false;
    state.observer?.disconnect();
    state.observer = null;
    for (const slot of state.slots) {
      slot.cancelTask?.();
      slot.canvas.width = 0;
      slot.canvas.height = 0;
    }
    state.slots = [];
    state.viewportEl.textContent = "";
    state.currentPage = 0;
    state.numPages = 0;
    state.attachment = null;
    if (clearAttachments) {
      state.attachments = [];
      state.attSelect.textContent = "";
      state.attSelect.style.display = "none";
    }
    const oldDoc = state.pdfDoc;
    state.pdfDoc = null;
    if (oldDoc?.destroy) void Promise.resolve(oldDoc.destroy()).catch(() => {
    });
    syncPreviewControls(state);
  }
  function syncPreviewControls(state) {
    const hasDoc = state.numPages > 0;
    const pageText = hasDoc ? `${state.currentPage} / ${state.numPages}` : "0 / 0";
    state.pageLabel.textContent = pageText;
    state.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
    const attID = Number(state.attachment?.id) || 0;
    const attIdx = attID > 0 ? state.attachments.findIndex((e) => e.id === attID) : -1;
    const summaryText = hasDoc ? state.attachments.length > 1 && attIdx >= 0 ? `PDF ${attIdx + 1}/${state.attachments.length} · ${pageText}` : pageText : "";
    state.setSectionSummary?.(summaryText);
    state.prevBtn.disabled = !hasDoc || state.currentPage <= 1;
    state.nextBtn.disabled = !hasDoc || state.currentPage >= state.numPages;
    state.openBtn.disabled = !state.attachment;
  }
  async function renderPageSlot(state, slot, gen, onError) {
    if (!state.pdfDoc || state.generation !== gen || slot.rendering || slot.renderedZoom === state.zoom) return;
    slot.rendering = true;
    const token = ++slot.renderToken;
    try {
      const w = Math.max(180, (state.viewportEl.clientWidth || state.body.clientWidth || 260) - 2);
      state.lastWidth = state.viewportEl.clientWidth || state.body.clientWidth || state.lastWidth;
      const m = await renderPageToCanvas(
        state.pdfDoc,
        slot.pageNumber,
        slot.canvas,
        w,
        state.zoom,
        state.win.devicePixelRatio || 1,
        () => state.generation !== gen || slot.renderToken !== token,
        (c) => {
          slot.cancelTask = c;
        }
      );
      if (state.generation === gen && slot.renderToken === token && m.height > 0) {
        slot.lastHeight = m.height;
        slot.card.removeAttribute("data-unrendered");
        slot.card.style.minBlockSize = "0";
        slot.renderedZoom = state.zoom;
      }
    } catch (error) {
      if (state.generation === gen && slot.renderToken === token) onError(error);
    } finally {
      if (slot.renderToken === token) {
        slot.rendering = false;
        slot.cancelTask = void 0;
      }
    }
  }
  function invalidateVisibleSlots(state, onError) {
    for (const slot of state.slots) {
      slot.renderToken += 1;
      slot.cancelTask?.();
      slot.cancelTask = void 0;
      slot.rendering = false;
      slot.renderedZoom = null;
    }
    const startIdx = Math.max(0, state.currentPage - 2);
    const endIdx = Math.min(state.slots.length, Math.max(2, state.currentPage + 1));
    for (let i = startIdx; i < endIdx; i++) {
      void renderPageSlot(state, state.slots[i], state.generation, onError);
    }
  }
  function jumpToPreviewPage(state, pageNumber, onError) {
    if (!state.numPages) return;
    const target = Math.max(1, Math.min(state.numPages, pageNumber));
    state.currentPage = target;
    const attID = Number(state.attachment?.id) || 0;
    if (attID > 0) state.pageByAttachment.set(attID, target);
    syncPreviewControls(state);
    const slot = state.slots[target - 1];
    if (!slot) return;
    state.viewportEl.scrollTop = Math.max(0, slot.card.offsetTop - (state.slots[0]?.card.offsetTop || 0));
    void renderPageSlot(state, slot, state.generation, onError);
    evictDistantPageCanvases(state.slots, state.currentPage);
  }
  async function loadAttachmentPreviewDoc(state, att, onError) {
    disposePreviewDocument(state, false);
    const gen = state.generation;
    state.loading = true;
    state.attachment = att;
    const nextAttID = Number(att?.id) || 0;
    if (nextAttID > 0 && state.ownerID > 0) {
      try {
        const CustomEv = state.win?.CustomEvent || CustomEvent;
        state.doc.dispatchEvent?.(new CustomEv("zbf:pdf-attachment-selected", {
          detail: { ownerID: state.ownerID, attachmentID: nextAttID }
        }));
      } catch {
      }
    }
    syncPreviewControls(state);
    applyStatusMessage(state.statusEl, "zbf-pdf-preview-loading");
    try {
      const filePath = await resolveAttachmentPath(att);
      if (state.generation !== gen) return;
      if (!filePath) {
        state.loading = false;
        applyStatusMessage(state.statusEl, "zbf-pdf-preview-missing-file");
        return;
      }
      const pdfDoc = await openPdfDocumentFromFile(filePath, state.doc);
      if (state.generation !== gen) {
        void Promise.resolve(pdfDoc.destroy?.()).catch(() => {
        });
        return;
      }
      state.loading = false;
      state.pdfDoc = pdfDoc;
      state.numPages = Math.max(0, pdfDoc.numPages || 0);
      const attID = Number(att?.id) || 0;
      const rememberedPage = attID > 0 ? state.pageByAttachment.get(attID) || 1 : 1;
      state.currentPage = state.numPages > 0 ? Math.max(1, Math.min(state.numPages, rememberedPage)) : 0;
      ensureSectionConnected(state.body, state.root, state.customSection, state.collapsible);
      if (!state.numPages) {
        applyStatusMessage(state.statusEl, "zbf-pdf-preview-unavailable");
        return;
      }
      applyStatusMessage(state.statusEl, "");
      buildSlots(state, gen, onError);
      if (state.currentPage > 1) {
        jumpToPreviewPage(state, state.currentPage, onError);
      } else {
        syncPreviewControls(state);
      }
    } catch (error) {
      if (state.generation === gen) {
        state.loading = false;
        onError(error);
        applyStatusMessage(state.statusEl, "zbf-pdf-preview-error");
      }
    }
  }
  async function loadItemPreviewAttachments(state, item, onError) {
    disposePreviewDocument(state, true);
    const gen = state.generation;
    if (!item) {
      applyStatusMessage(state.statusEl, "zbf-pdf-preview-unavailable");
      return;
    }
    state.loading = true;
    applyStatusMessage(state.statusEl, "zbf-pdf-preview-loading");
    const isReader = state.compare.tabType === "reader";
    let ctx;
    try {
      ctx = await resolveSameItemPdfContext(item, state.win);
    } catch (error) {
      if (state.generation === gen) {
        state.loading = false;
        applyStatusMessage(state.statusEl, "zbf-pdf-preview-error");
        onError(error);
      }
      return;
    }
    if (state.generation !== gen) return;
    const entries = ctx.entries;
    state.ownerID = ctx.ownerID;
    state.attachments = entries;
    state.compare.currentAttachmentID = ctx.currentAttachmentID;
    const chosen = entries.length > 0 ? pickCompareAttachment(ctx, state.compare.mode, state.compare.pickedAttachmentID, isReader ? "reader" : "library") : null;
    syncCompareBar(state.compareUI, state.compare, entries, chosen?.id || 0);
    state.attSelect.textContent = "";
    if (entries.length > 1) {
      entries.forEach((entry, idx) => {
        const opt = createXhtmlEl(state.doc, "option");
        opt.value = String(entry.id);
        opt.textContent = `${idx + 1}. ${entry.title}`;
        state.attSelect.append(opt);
      });
      if (chosen) state.attSelect.value = String(chosen.id);
    }
    state.attSelect.style.display = "none";
    if (!chosen) {
      state.loading = false;
      ensureSectionConnected(state.body, state.root, state.customSection, state.collapsible);
      applyStatusMessage(state.statusEl, "zbf-pdf-preview-unavailable");
      return;
    }
    await loadAttachmentPreviewDoc(state, chosen.attachment, onError);
  }
  function buildSlots(state, gen, onError) {
    state.viewportEl.textContent = "";
    state.slots = [];
    const frag = state.doc.createDocumentFragment();
    for (let p = 1; p <= state.numPages; p++) {
      const card = createXhtmlEl(state.doc, "div");
      card.className = "ztf-pdf-page-card";
      card.setAttribute("data-unrendered", "true");
      card.setAttribute("data-page-number", String(p));
      const canvas = createXhtmlEl(state.doc, "canvas");
      canvas.className = "ztf-pdf-canvas";
      const badge = createXhtmlEl(state.doc, "span");
      badge.className = "ztf-pdf-page-badge";
      badge.textContent = String(p);
      card.append(canvas, badge);
      frag.append(card);
      state.slots.push({ pageNumber: p, card, canvas, renderedZoom: null, rendering: false, renderToken: 0, lastHeight: 0 });
    }
    state.viewportEl.append(frag);
    const Observer = state.win.IntersectionObserver;
    if (Observer) {
      const slotByCard = new Map(state.slots.map((s) => [s.card, s]));
      state.observer = new Observer((entries) => {
        if (state.generation !== gen) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const slot = slotByCard.get(entry.target);
            if (slot) {
              void renderPageSlot(state, slot, gen, onError);
              evictDistantPageCanvases(state.slots, slot.pageNumber, 6);
            }
          }
        }
      }, { root: state.viewportEl, rootMargin: "220px 0px", threshold: 0.01 });
      for (const slot of state.slots) state.observer.observe(slot.card);
    }
    if (state.slots[0]) void renderPageSlot(state, state.slots[0], gen, onError);
    if (state.slots[1]) void renderPageSlot(state, state.slots[1], gen, onError);
  }
  function nearestPreviewPage(slots, top) {
    let low = 0;
    let high = slots.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (slots[mid].card.offsetTop < top) low = mid + 1;
      else high = mid;
    }
    if (low > 0 && top - slots[low - 1].card.offsetTop <= slots[low].card.offsetTop - top) low--;
    return slots[low].pageNumber;
  }

  // src/domains/inspector/pdf-compare-helpers.ts
  function attachNeighborCompareButtons(doc, bar, signal, onPickNeighbor) {
    const leftBtn = createXhtmlEl(doc, "button");
    leftBtn.type = "button";
    leftBtn.className = "ztf-pdf-btn ztf-pdf-compare-btn ztf-pdf-neighbor-left";
    leftBtn.textContent = "◀ 左标签";
    leftBtn.style.display = "none";
    const rightBtn = createXhtmlEl(doc, "button");
    rightBtn.type = "button";
    rightBtn.className = "ztf-pdf-btn ztf-pdf-compare-btn ztf-pdf-neighbor-right";
    rightBtn.textContent = "右标签 ▶";
    rightBtn.style.display = "none";
    const controls = { leftBtn, rightBtn, activeSide: null };
    leftBtn.addEventListener("click", () => onPickNeighbor("left"), { signal });
    rightBtn.addEventListener("click", () => onPickNeighbor("right"), { signal });
    bar.append(leftBtn, rightBtn);
    return controls;
  }
  function syncNeighborCompareButtons(controls, bar, tabType, sameItemCount, neighbors) {
    const isReader = tabType === "reader";
    const hasLeft = isReader && Boolean(neighbors?.left);
    const hasRight = isReader && Boolean(neighbors?.right);
    controls.leftBtn.style.display = hasLeft ? "inline-flex" : "none";
    controls.rightBtn.style.display = hasRight ? "inline-flex" : "none";
    if (neighbors?.left) {
      const shortLeft = neighbors.left.title.slice(0, 8);
      controls.leftBtn.textContent = `◀ ${shortLeft}`;
      controls.leftBtn.title = `对照左侧标签页：${neighbors.left.title}`;
    }
    if (neighbors?.right) {
      const shortRight = neighbors.right.title.slice(0, 8);
      controls.rightBtn.textContent = `${shortRight} ▶`;
      controls.rightBtn.title = `对照右侧标签页：${neighbors.right.title}`;
    }
    if (controls.activeSide === "left" && hasLeft) controls.leftBtn.setAttribute("data-active", "true");
    else controls.leftBtn.removeAttribute("data-active");
    if (controls.activeSide === "right" && hasRight) controls.rightBtn.setAttribute("data-active", "true");
    else controls.rightBtn.removeAttribute("data-active");
    if (sameItemCount > 1 || isReader && (sameItemCount >= 1 || hasLeft || hasRight)) {
      bar.style.display = "flex";
    } else {
      bar.style.display = "none";
    }
  }
  async function resolveNeighborPdfEntries(ref) {
    const hostItems = globalThis.Zotero?.Items;
    const targetID = ref.parentItemID || ref.itemID;
    let item = targetID > 0 ? hostItems?.get?.(targetID) || (hostItems?.getAsync ? await hostItems.getAsync(targetID).catch(() => null) : null) : null;
    if (!item && ref.itemID > 0 && ref.itemID !== targetID) {
      item = hostItems?.get?.(ref.itemID) || (hostItems?.getAsync ? await hostItems.getAsync(ref.itemID).catch(() => null) : null);
    }
    if (!item) return [];
    const entries = await resolveAllPdfAttachments(item);
    if (ref.itemID > 0) {
      const exact = entries.find((e) => e.id === ref.itemID);
      if (exact) return [exact, ...entries.filter((e) => e.id !== ref.itemID)];
    }
    return entries;
  }
  async function activateNeighborComparison(state, controls, side, neighbors, onError) {
    const ref = side === "left" ? neighbors?.left : neighbors?.right;
    if (!ref) return false;
    const entries = await resolveNeighborPdfEntries(ref);
    const chosen = entries[0];
    if (!chosen?.attachment) return false;
    controls.activeSide = side;
    state.compareUI.selfBtn?.removeAttribute?.("data-active");
    syncNeighborCompareButtons(controls, state.compareUI.bar, state.compare.tabType, state.attachments.length, neighbors);
    await loadAttachmentPreviewDoc(state, chosen.attachment, onError);
    return true;
  }

  // src/domains/inspector/pdf-preview-events.ts
  var MIN_ZOOM = 0.6;
  var MAX_ZOOM = 2;
  var ZOOM_STEP = 0.2;
  function setPreviewZoom(state, nextZoom, onError) {
    const clamped = Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom)) * 100) / 100;
    if (clamped === state.zoom) return;
    state.zoom = clamped;
    syncPreviewControls(state);
    invalidateVisibleSlots(state, onError);
  }
  function updatePreviewPageFromScroll(state) {
    if (!state.slots.length) return;
    const top = state.viewportEl.scrollTop + (state.slots[0]?.card.offsetTop || 0);
    const best = nearestPreviewPage(state.slots, top);
    if (best !== state.currentPage) {
      state.currentPage = best;
      const attID = Number(state.attachment?.id) || 0;
      if (attID > 0) state.pageByAttachment.set(attID, best);
      syncPreviewControls(state);
      evictDistantPageCanvases(state.slots, state.currentPage);
    }
  }
  function bindPreviewToolbar(state, zoomOutBtn, zoomInBtn, modeBtn, signal, actions) {
    const opts = { signal };
    state.prevBtn.addEventListener("click", () => jumpToPreviewPage(state, state.currentPage - 1, actions.onRenderError), opts);
    state.nextBtn.addEventListener("click", () => jumpToPreviewPage(state, state.currentPage + 1, actions.onRenderError), opts);
    zoomOutBtn.addEventListener("click", () => setPreviewZoom(state, state.zoom - ZOOM_STEP, actions.onRenderError), opts);
    zoomInBtn.addEventListener("click", () => setPreviewZoom(state, state.zoom + ZOOM_STEP, actions.onRenderError), opts);
    state.zoomLabel.addEventListener("click", () => setPreviewZoom(state, 1, actions.onRenderError), opts);
    modeBtn.addEventListener("click", () => actions.onToggleFullMode(state), opts);
    state.openBtn.addEventListener("click", () => state.attachment && void openPdfInReader(state.attachment, state.win, state.currentPage || 1), opts);
    const selectAttachmentById = (attId) => {
      const chosen = state.attachments.find((entry) => entry.id === attId);
      if (!chosen) return;
      const ctrl = actions.getNeighborCtrl(state.body);
      if (ctrl) ctrl.activeSide = null;
      const prevId = Number(state.compare.pickedAttachmentID || state.attachment?.id || 0);
      if (prevId && prevId !== chosen.id) state.compare.lastAttachmentID = prevId;
      state.compare.pickedAttachmentID = chosen.id;
      state.attSelect.value = String(chosen.id);
      syncCompareBar(state.compareUI, state.compare, state.attachments, chosen.id);
      if (ctrl) syncNeighborCompareButtons(ctrl, state.compareUI.bar, state.compare.tabType, state.attachments.length, actions.getLatestNeighbors());
      if (chosen.attachment !== state.attachment) {
        void loadAttachmentPreviewDoc(state, chosen.attachment, actions.onRenderError);
      }
    };
    state.attSelect.addEventListener("change", () => selectAttachmentById(Number(state.attSelect.value || 0)), opts);
    state.doc.addEventListener("zbf:pdf-folder-attachment-selected", ((ev) => selectAttachmentById(Number(ev?.detail?.attachmentID || 0))), opts);
    state.pageLabel.addEventListener("click", () => openPageJumpInput(state.doc, state.pageLabel, state.currentPage, state.numPages, (p) => jumpToPreviewPage(state, p, actions.onRenderError)), opts);
    state.viewportEl.addEventListener("scroll", () => updatePreviewPageFromScroll(state), opts);
    state.viewportEl.addEventListener("dblclick", (event) => {
      if (!state.attachment || !actions.isDblClickOpen()) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      const card = event.target?.closest?.("[data-page-number]");
      void openPdfInReader(state.attachment, state.win, Number(card?.getAttribute?.("data-page-number")) || state.currentPage || 1);
    }, opts);
    state.viewportEl.addEventListener("keydown", (event) => {
      if (!state.numPages) return;
      const k = event.key;
      if (k === "PageDown" || k === "ArrowRight") {
        event.preventDefault?.();
        jumpToPreviewPage(state, state.currentPage + 1, actions.onRenderError);
      } else if (k === "PageUp" || k === "ArrowLeft") {
        event.preventDefault?.();
        jumpToPreviewPage(state, state.currentPage - 1, actions.onRenderError);
      } else if (k === "Home" || k === "End") {
        event.preventDefault?.();
        jumpToPreviewPage(state, k === "Home" ? 1 : state.numPages, actions.onRenderError);
      } else if ((event.ctrlKey || event.metaKey) && k === "0") {
        event.preventDefault?.();
        setPreviewZoom(state, 1, actions.onRenderError);
      }
    }, opts);
    state.viewportEl.addEventListener("wheel", (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setPreviewZoom(state, state.zoom + (e.deltaY < 0 ? 0.1 : -0.1), actions.onRenderError);
      }
    }, { signal, passive: false });
  }
  function setupPreviewResizeObserver(state, onError) {
    const RO = state.win.ResizeObserver;
    if (!RO) return;
    state.resizeObserver = new RO(() => {
      const width = state.viewportEl.clientWidth || state.body.clientWidth || 0;
      if (!width || !state.pdfDoc || Math.abs(width - state.lastWidth) < 8) return;
      state.lastWidth = width;
      if (state.resizeTimer !== null) state.win.clearTimeout(state.resizeTimer);
      state.resizeTimer = state.win.setTimeout(() => {
        state.resizeTimer = null;
        invalidateVisibleSlots(state, onError);
      }, 120);
    });
    state.resizeObserver.observe(state.viewportEl);
  }

  // src/domains/inspector/pdf-preview-styles.ts
  var STYLE_ID = "zbf-pdf-preview-styles";
  var PREVIEW_CSS = `
.ztf-pdf-root {
	display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px;
	min-inline-size: 0; inline-size: 100%; contain: inline-size;
	font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
	padding: 2px 0 4px 0; color: var(--fill-primary, currentColor);
}
.ztf-pdf-toolbar {
	display: flex; align-items: center; justify-content: space-between;
	gap: 4px; flex-wrap: wrap; min-block-size: 24px; padding: 0 1px 4px;
	min-inline-size: 0; max-inline-size: 100%; overflow: hidden;
	background: transparent;
	border-bottom: 1px solid var(--fill-quinary, color-mix(in srgb, currentColor 7%, transparent));
}
.ztf-pdf-att-select {
	flex: 1 1 100%; min-inline-size: 0; inline-size: 100%; block-size: 22px;
	padding: 0 6px; margin-top: 2px; border-radius: 4px;
	border: 1px solid var(--fill-quarternary, rgba(127, 127, 127, 0.22));
	background: var(--material-background, transparent);
	color: var(--fill-primary, inherit); font: 500 11px/1.3 system-ui, sans-serif; cursor: pointer;
}
.ztf-pdf-btn-group { display: flex; align-items: center; gap: 2px; }
.ztf-pdf-btn {
	appearance: none !important; -moz-appearance: none !important; box-sizing: border-box;
	display: inline-flex; align-items: center; justify-content: center; gap: 4px;
	min-inline-size: 20px !important; min-block-size: 20px !important; block-size: 20px !important;
	margin: 0 !important; padding: 0 5px !important;
	border: 1px solid transparent !important; border-radius: 4px !important;
	background: transparent !important; box-shadow: none !important;
	color: var(--fill-secondary, inherit); font: 500 11.5px/1 system-ui, sans-serif;
	cursor: pointer; user-select: none;
	transition: background-color 0.12s ease, color 0.12s ease, opacity 0.12s ease;
}
.ztf-pdf-btn-svg { inline-size: 12px; block-size: 12px; flex-shrink: 0; pointer-events: none; }
.ztf-pdf-btn:hover:not(:disabled) {
	background: var(--fill-quinary, color-mix(in srgb, currentColor 8%, transparent)) !important;
	color: var(--fill-primary, inherit);
}
.ztf-pdf-btn:active:not(:disabled) {
	background: var(--fill-quarternary, color-mix(in srgb, currentColor 14%, transparent)) !important;
}
.ztf-pdf-btn:disabled { opacity: 0.32; cursor: default; }
.ztf-pdf-mode-btn[data-active="true"] {
	color: var(--accent-blue, #4072e5) !important;
	background: var(--accent-blue10, rgba(64, 114, 229, 0.14)) !important;
	border-color: var(--accent-blue30, rgba(64, 114, 229, 0.35)) !important;
}
.ztf-pdf-compare-bar {
	display: flex; align-items: center; flex-wrap: wrap; gap: 3px; flex: 1 1 100%; min-inline-size: 0;
	padding-top: 3px; margin-top: 2px;
	border-top: 1px dashed var(--fill-quinary, color-mix(in srgb, currentColor 8%, transparent));
}
.ztf-pdf-compare-count {
	flex-shrink: 0; padding: 1px 5px; border-radius: 999px;
	background: var(--accent-blue10, rgba(64, 114, 229, 0.12));
	color: var(--accent-blue, #4072e5); font: 600 10.5px/1.3 system-ui, sans-serif;
	font-variant-numeric: tabular-nums;
}
.ztf-pdf-compare-nav { flex-shrink: 0; padding: 0 3px !important; }
.ztf-pdf-compare-btn { font-size: 11px !important; padding: 0 6px !important; flex-shrink: 0; max-inline-size: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ztf-pdf-compare-btn[data-active="true"] {
	color: var(--accent-blue, #4072e5) !important;
	background: var(--accent-blue10, rgba(64, 114, 229, 0.14)) !important;
	border-color: var(--accent-blue30, rgba(64, 114, 229, 0.35)) !important;
}
.ztf-pdf-compare-select, .ztf-pdf-att-select, .ztf-pdf-folder-select {
	appearance: none !important; -moz-appearance: none !important;
	flex: 1 1 auto; min-inline-size: 0; max-inline-size: 100%;
	block-size: 22px; padding: 0 20px 0 7px; border-radius: 5px;
	border: 1px solid var(--fill-quarternary, rgba(127, 127, 127, 0.22));
	background-color: var(--fill-senary, rgba(127, 127, 127, 0.06));
	background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 16 16' fill='none' stroke='%2364748b' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E");
	background-repeat: no-repeat; background-position: right 6px center;
	color: var(--fill-primary, inherit);
	font: 500 11.5px/20px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei UI", sans-serif;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer;
	transition: border-color 0.14s ease, background-color 0.14s ease;
}
.ztf-pdf-compare-select:hover, .ztf-pdf-att-select:hover, .ztf-pdf-folder-select:hover {
	border-color: var(--accent-blue50, rgba(64, 114, 229, 0.45));
	background-color: var(--fill-quinary, rgba(127, 127, 127, 0.11));
}
.ztf-pdf-compare-select:focus-visible, .ztf-pdf-att-select:focus-visible, .ztf-pdf-folder-select:focus-visible {
	outline: none; border-color: var(--accent-blue, #4072e5);
}
.ztf-pdf-open-btn {
	padding: 0 7px !important; color: var(--accent-blue, #4072e5) !important;
	background: var(--accent-blue10, rgba(64, 114, 229, 0.1)) !important;
	font-weight: 500; font-size: 11px;
}
.ztf-pdf-open-btn:hover:not(:disabled) {
	background: var(--accent-blue30, rgba(64, 114, 229, 0.2)) !important;
	color: var(--accent-blue, #4072e5) !important;
}
.ztf-pdf-page-label {
	min-inline-size: 38px; padding: 2px 4px; border-radius: 4px;
	text-align: center; font-variant-numeric: tabular-nums;
	color: var(--fill-secondary, inherit); font-size: 11px; cursor: pointer; user-select: none;
}
.ztf-pdf-page-label:hover {
	background: var(--fill-quinary, color-mix(in srgb, currentColor 8%, transparent));
	color: var(--fill-primary, inherit);
}
.ztf-pdf-page-input {
	inline-size: 38px; block-size: 19px; padding: 0 3px; border-radius: 4px;
	border: 1px solid var(--accent-blue, #4072e5);
	background: var(--material-background, #fff); color: var(--fill-primary, inherit);
	font: 500 11px/1 system-ui, sans-serif; text-align: center; outline: none;
}
.ztf-pdf-status {
	padding: 12px 8px; color: var(--fill-secondary, inherit);
	font-size: 12px; text-align: center; display: none; overflow-wrap: anywhere;
}
.ztf-pdf-viewport {
	position: relative; display: flex; flex-direction: column; align-items: stretch;
	gap: 8px; max-block-size: clamp(240px, 38vh, 420px);
	min-inline-size: 0; max-inline-size: 100%; box-sizing: border-box;
	overflow-y: auto; overflow-x: auto; padding: 2px 0 4px; background: transparent;
	scrollbar-width: thin; outline: none;
	scrollbar-color: var(--color-scrollbar, rgba(127, 127, 127, 0.38)) transparent;
}
.ztf-pdf-page-card {
	position: relative; flex: 0 0 auto; flex-shrink: 0; display: block;
	min-inline-size: 0; max-inline-size: 100%;
	inline-size: 100%; box-sizing: border-box; background: #fff;
	border-radius: 5px; border: 1px solid light-dark(rgba(15, 23, 42, 0.16), rgba(255, 255, 255, 0.18));
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08); overflow: hidden; cursor: pointer;
	transition: border-color 0.14s ease, box-shadow 0.14s ease;
}
.ztf-pdf-page-card:hover {
	border-color: var(--accent-blue50, rgba(64, 114, 229, 0.45));
	box-shadow: 0 2px 6px rgba(0, 0, 0, 0.09);
}
.ztf-pdf-page-card[data-unrendered="true"] {
	aspect-ratio: 1 / 1.4142; min-block-size: 220px;
	background: var(--fill-senary, rgba(0, 0, 0, 0.02));
}
.ztf-pdf-canvas { display: block; inline-size: 100%; block-size: auto; background: #fff; }
.ztf-pdf-page-badge {
	position: absolute; inset-inline-end: 6px; inset-block-end: 6px;
	padding: 1px 6px; border-radius: 999px; font: 500 10px/1.35 system-ui, sans-serif;
	font-variant-numeric: tabular-nums; background: rgba(15, 23, 42, 0.56);
	color: #fff; pointer-events: none; opacity: 0.72; transition: opacity 0.14s ease;
}
.ztf-pdf-page-card:hover .ztf-pdf-page-badge { opacity: 0.95; }
.ztf-pdf-root[data-show-badge="false"] .ztf-pdf-page-badge { display: none; }
[data-ztf-pdf-full-stack="true"] > :not([data-ztf-pdf-full-section="true"]) { display: none !important; }
[data-ztf-pdf-full-stack="true"]::before { display: none !important; }
[data-ztf-pdf-full-stack="true"] {
	display: flex !important; flex-direction: column !important;
	block-size: 100% !important; max-block-size: 100% !important; overflow: hidden !important;
}
[data-ztf-pdf-full-section="true"],
[data-ztf-pdf-full-section="true"] > collapsible-section,
[data-ztf-pdf-full-section="true"] > collapsible-section > [data-type="body"] {
	display: flex !important; flex-direction: column !important;
	flex: 1 1 auto !important; block-size: 100% !important; min-block-size: 0 !important;
}
[data-ztf-pdf-full-section="true"] > collapsible-section > .head { display: none !important; }
.ztf-pdf-root[data-layout-mode="full"] {
	display: flex; flex-direction: column; flex: 1 1 auto; block-size: 100%; min-block-size: 0;
}
.ztf-pdf-root[data-layout-mode="full"] .ztf-pdf-viewport {
	flex: 1 1 auto; max-block-size: calc(100vh - 96px); block-size: 100%;
}
`;
  function ensurePdfPreviewStyles(doc) {
    if (!doc?.getElementById) return;
    let style = doc.getElementById(STYLE_ID);
    if (!style) {
      style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
      style.id = STYLE_ID;
      (doc.head || doc.documentElement)?.append(style);
    }
    if (style.textContent !== PREVIEW_CSS) style.textContent = PREVIEW_CSS;
  }
  function removePdfPreviewStyles(doc) {
    doc?.getElementById?.(STYLE_ID)?.remove?.();
  }

  // src/domains/inspector/pdf-preview-section.ts
  var PdfPreviewSectionController = class {
    unregisterFn = null;
    prefSub = null;
    neighborSub = null;
    latestNeighbors = null;
    focus = new PreviewFocus();
    states = /* @__PURE__ */ new Map();
    neighborControls = /* @__PURE__ */ new Map();
    listeners = /* @__PURE__ */ new Map();
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
        onInit: (props) => {
          this.onInit(props);
          this.services.panePositions.observeAndQueue(props.body);
        },
        onDestroy: ({ body }) => this.onDestroy(body),
        onItemChange: (props) => {
          this.services.panePositions.observeAndQueue(props.body);
          return this.renderSection(props);
        },
        onRender: (props) => {
          this.services.panePositions.observeAndQueue(props.body);
          this.renderSection(props);
        },
        onToggle: (props) => this.renderSection(props)
      });
      this.unregisterFn = reg.dispose;
      if (reg.sectionID) {
        this.services.panePositions.setTarget("pdf-preview", {
          sectionID: reg.sectionID,
          getPosition: () => normalizePanePosition(this.kernel.prefs.get("inspector.pdfPreview.position"), "zotero-editpane-related")
        });
      }
      if (!this.neighborSub) {
        this.neighborSub = this.kernel.bus.on("workspace:reader-neighbors-updated", (payload) => {
          this.latestNeighbors = payload;
          const allowNeighbor = this.kernel.prefs.get("inspector.pdfPreview.neighborCompareEnable");
          for (const [b, st] of this.states.entries()) {
            const ctrl = this.neighborControls.get(b);
            if (ctrl) syncNeighborCompareButtons(ctrl, st.compareUI.bar, st.compare.tabType, st.attachments.length, allowNeighbor ? payload : null);
          }
        });
        this.kernel.bus.emit("workspace:reader-neighbors-query", {});
      }
      if (!this.prefSub) {
        this.prefSub = this.kernel.prefs.observeKeys(
          ["inspector.pdfPreview.mode", "inspector.pdfPreview.defaultZoom", "inspector.pdfPreview.showPageBadge", "inspector.pdfPreview.enable", "inspector.pdfPreview.neighborCompareEnable"],
          (changedKey) => {
            const isFull = this.kernel.prefs.get("inspector.pdfPreview.mode") === "full" && this.kernel.prefs.get("inspector.pdfPreview.enable");
            const showBadge = this.kernel.prefs.get("inspector.pdfPreview.showPageBadge");
            const defaultZoom = Math.round(this.kernel.prefs.get("inspector.pdfPreview.defaultZoom")) / 100;
            const allowNeighbor = this.kernel.prefs.get("inspector.pdfPreview.neighborCompareEnable");
            for (const [b, st] of this.states.entries()) {
              if (changedKey === "inspector.pdfPreview.mode" || changedKey === "inspector.pdfPreview.enable") this.focus.set(st, isFull);
              st.root.setAttribute("data-show-badge", showBadge ? "true" : "false");
              if (changedKey === "inspector.pdfPreview.defaultZoom") st.zoom = defaultZoom;
              const ctrl = this.neighborControls.get(b);
              if (ctrl) syncNeighborCompareButtons(ctrl, st.compareUI.bar, st.compare.tabType, st.attachments.length, allowNeighbor ? this.latestNeighbors : null);
              syncPreviewControls(st);
              invalidateVisibleSlots(st, this.onRenderError);
            }
          }
        );
      }
    }
    async resolveSameItemPdfs(item) {
      if (!item) return [];
      const owner = await normalizeToRegularItemAsync(item);
      return resolvePdfAttachments(owner || item);
    }
    unregister() {
      this.services.panePositions.setTarget("pdf-preview", null);
      this.prefSub?.();
      this.prefSub = null;
      this.neighborSub?.();
      this.neighborSub = null;
      this.latestNeighbors = null;
      this.neighborControls.clear();
      for (const state of this.states.values()) {
        if (state.resizeTimer !== null) state.win.clearTimeout?.(state.resizeTimer);
        state.resizeObserver?.disconnect();
        applyPreviewLayoutMode(state.body, state.root, state.customSection, false);
        disposePreviewDocument(state, true);
        removePdfPreviewStyles(state.doc);
      }
      for (const controller of this.listeners.values()) controller.abort();
      this.listeners.clear();
      this.states.clear();
      this.focus = new PreviewFocus();
      this.unregisterFn?.();
      this.unregisterFn = null;
    }
    onRenderError = (err) => {
      this.kernel.logger.error("inspector:pdf-preview", err);
    };
    isDblClickOpen = () => this.kernel.prefs.get("inspector.pdfPreview.doubleClickOpen");
    onInit(props) {
      const { body, item, tabType, setEnabled, setSectionSummary } = props;
      const doc = props.doc || body?.ownerDocument;
      const win = doc?.defaultView || globalThis.Zotero?.getMainWindow?.();
      if (!win || !doc || !body) return;
      const customSection = body.closest?.("item-pane-custom-section") || null;
      const collapsible = body.closest?.("collapsible-section") || null;
      setEnabled?.(this.isSectionEnabled(tabType));
      win.MozXULElement?.insertFTLIfNeeded?.("zotero-bridgeflow.ftl");
      ensurePdfPreviewStyles(doc);
      if (this.states.has(body)) this.onDestroy(body);
      const controller = new win.AbortController();
      this.listeners.set(body, controller);
      body.textContent = "";
      const root = createXhtmlEl(doc, "div");
      root.className = "ztf-pdf-root";
      const toolbar = createXhtmlEl(doc, "div");
      toolbar.className = "ztf-pdf-toolbar";
      const navGroup = createXhtmlEl(doc, "div");
      navGroup.className = "ztf-pdf-btn-group";
      const prevBtn = createToolBtn(doc, "‹", "zbf-pdf-preview-prev", "", "prev");
      const pageLabel = createXhtmlEl(doc, "span");
      pageLabel.className = "ztf-pdf-page-label";
      pageLabel.textContent = "0 / 0";
      const nextBtn = createToolBtn(doc, "›", "zbf-pdf-preview-next", "", "next");
      navGroup.append(prevBtn, pageLabel, nextBtn);
      const zoomGroup = createXhtmlEl(doc, "div");
      zoomGroup.className = "ztf-pdf-btn-group";
      const zoomOutBtn = createToolBtn(doc, "−", "zbf-pdf-preview-zoom-out", "", "zoomOut");
      const zoomLabel = createToolBtn(doc, "100%");
      const zoomInBtn = createToolBtn(doc, "+", "zbf-pdf-preview-zoom-in", "", "zoomIn");
      const modeBtn = createToolBtn(doc, "", "zbf-pdf-preview-toggle-mode", "ztf-pdf-mode-btn", "toggleMode");
      const openBtn = createToolBtn(doc, "在阅读器中打开", "zbf-pdf-preview-open-reader", "ztf-pdf-open-btn", "openReader");
      zoomGroup.append(zoomOutBtn, zoomLabel, zoomInBtn, modeBtn, openBtn);
      const attSelect = createXhtmlEl(doc, "select", "display:none");
      attSelect.className = "ztf-pdf-att-select";
      const compare = { mode: "sibling", pickedAttachmentID: null, currentAttachmentID: 0, tabType: tabType || "library" };
      const compareUI = createCompareBar(doc, controller.signal, () => state.compare, (nextMode, nextPickedID) => {
        const ctrl = this.neighborControls.get(body);
        if (ctrl) ctrl.activeSide = null;
        state.compare.mode = nextMode;
        state.compare.pickedAttachmentID = nextPickedID;
        const chosen = pickCompareAttachment(
          { ownerID: state.ownerID, currentAttachmentID: state.compare.currentAttachmentID, entries: state.attachments },
          nextMode,
          nextPickedID,
          state.compare.tabType === "reader" ? "reader" : "library"
        );
        if (chosen) {
          state.compare.pickedAttachmentID = chosen.id;
          state.attSelect.value = String(chosen.id);
        }
        syncCompareBar(compareUI, state.compare, state.attachments, chosen?.id || 0);
        const allowNeighbor = this.kernel.prefs.get("inspector.pdfPreview.neighborCompareEnable");
        if (ctrl) syncNeighborCompareButtons(ctrl, compareUI.bar, state.compare.tabType, state.attachments.length, allowNeighbor ? this.latestNeighbors : null);
        if (chosen && chosen.attachment !== state.attachment) {
          void loadAttachmentPreviewDoc(state, chosen.attachment, this.onRenderError);
        }
      });
      const neighborCtrl = attachNeighborCompareButtons(doc, compareUI.bar, controller.signal, (side) => {
        if (neighborCtrl.activeSide === side) {
          neighborCtrl.activeSide = null;
          syncNeighborCompareButtons(neighborCtrl, compareUI.bar, state.compare.tabType, state.attachments.length, this.latestNeighbors);
          const fallback = pickCompareAttachment(
            { ownerID: state.ownerID, currentAttachmentID: state.compare.currentAttachmentID, entries: state.attachments },
            state.compare.mode,
            state.compare.pickedAttachmentID,
            state.compare.tabType === "reader" ? "reader" : "library"
          );
          if (fallback && fallback.attachment !== state.attachment) void loadAttachmentPreviewDoc(state, fallback.attachment, this.onRenderError);
          return;
        }
        void activateNeighborComparison(state, neighborCtrl, side, this.latestNeighbors, this.onRenderError);
      });
      this.neighborControls.set(body, neighborCtrl);
      toolbar.append(navGroup, zoomGroup, attSelect, compareUI.bar);
      const statusEl = createXhtmlEl(doc, "div");
      statusEl.className = "ztf-pdf-status";
      const viewportEl = createXhtmlEl(doc, "div");
      viewportEl.className = "ztf-pdf-viewport";
      viewportEl.setAttribute("tabindex", "0");
      root.append(toolbar, statusEl, viewportEl);
      body.append(root);
      const state = {
        doc,
        win,
        body,
        root,
        customSection,
        collapsible,
        setSectionSummary,
        item: null,
        ownerID: 0,
        attIdsKey: "",
        attachment: null,
        attachments: [],
        pageByAttachment: /* @__PURE__ */ new Map(),
        pdfDoc: null,
        loading: false,
        generation: 0,
        fullActive: this.focus.isActive(body),
        zoom: Math.round(this.kernel.prefs.get("inspector.pdfPreview.defaultZoom")) / 100,
        currentPage: 0,
        numPages: 0,
        lastWidth: 0,
        resizeTimer: null,
        resizeObserver: null,
        slots: [],
        observer: null,
        statusEl,
        pageLabel,
        zoomLabel,
        prevBtn,
        nextBtn,
        openBtn,
        attSelect,
        viewportEl,
        compare,
        compareUI
      };
      root.setAttribute("data-show-badge", this.kernel.prefs.get("inspector.pdfPreview.showPageBadge") ? "true" : "false");
      this.states.set(body, state);
      ensureSectionConnected(body, root, customSection, collapsible);
      if (state.fullActive && state.collapsible) state.collapsible.open = true;
      applyPreviewLayoutMode(body, root, customSection, state.fullActive);
      bindPreviewSidenavClick(
        doc,
        controller.signal,
        body,
        (active) => {
          this.focus.set(state, active);
          if (!active) this.services.panePositions.observeAndQueue(body);
        }
      );
      bindPreviewToolbar(state, zoomOutBtn, zoomInBtn, modeBtn, controller.signal, {
        isDblClickOpen: this.isDblClickOpen,
        onToggleFullMode: (st) => {
          this.focus.set(st, !st.fullActive);
          if (!st.fullActive) this.services.panePositions.observeAndQueue(st.body);
          invalidateVisibleSlots(st, this.onRenderError);
        },
        getLatestNeighbors: () => this.kernel.prefs.get("inspector.pdfPreview.neighborCompareEnable") ? this.latestNeighbors : null,
        getNeighborCtrl: (b) => this.neighborControls.get(b),
        onRenderError: this.onRenderError
      });
      setupPreviewResizeObserver(state, this.onRenderError);
      syncPreviewControls(state);
      this.renderSection(props);
    }
    isSectionEnabled(tabType) {
      return Boolean(this.kernel.prefs.get("inspector.pdfPreview.enable") && (!tabType || tabType === "library" || tabType === "reader"));
    }
    onDestroy(body) {
      const state = this.states.get(body);
      if (state) {
        if (state.resizeTimer !== null) state.win.clearTimeout?.(state.resizeTimer);
        state.resizeObserver?.disconnect();
        applyPreviewLayoutMode(state.body, state.root, state.customSection, false);
        disposePreviewDocument(state, true);
      }
      this.states.delete(body);
      this.neighborControls.delete(body);
      this.listeners.get(body)?.abort();
      this.listeners.delete(body);
    }
    renderSection({ body, item, tabType, setEnabled, setSectionSummary }) {
      const enabled = this.isSectionEnabled(tabType);
      setEnabled?.(enabled);
      let state = this.states.get(body);
      if (!state) {
        const doc = body?.ownerDocument;
        if (!doc) return enabled;
        this.onInit({ doc, body, item, tabType, setEnabled, setSectionSummary });
        state = this.states.get(body);
        if (!state) return enabled;
      }
      if (setSectionSummary) state.setSectionSummary = setSectionSummary;
      ensureSectionConnected(state.body, state.root, state.customSection, state.collapsible);
      if (!enabled) {
        state.item = null;
        applyPreviewLayoutMode(state.body, state.root, state.customSection, false);
        disposePreviewDocument(state, true);
        applyStatusMessage(state.statusEl, "");
        return false;
      }
      applyPreviewLayoutMode(state.body, state.root, state.customSection, state.fullActive);
      const nextTabType = tabType || "library";
      const isAtt = Boolean(item?.isAttachment?.() || item?.isPDFAttachment?.() || item?.itemType === "attachment");
      const nextAttIdsKey = `${Number(item?.id || 0)}:${(item?.parentItem?.getAttachments?.() || item?.getAttachments?.() || []).join(",")}`;
      const itemChanged = item !== state.item || nextTabType !== state.compare.tabType || nextAttIdsKey !== state.attIdsKey;
      state.compare.tabType = nextTabType;
      state.attIdsKey = nextAttIdsKey;
      if (state.collapsible?.open === false && !state.fullActive) {
        if (itemChanged || state.loading) disposePreviewDocument(state, true);
        state.item = item ?? null;
        return enabled;
      }
      if (!itemChanged && item && (state.pdfDoc || state.loading)) return true;
      const nextOwnerID = isAtt ? Number(item?.parentID || item?.parentItemID || item?.parentItem?.id || 0) : Number(item?.id || 0);
      const sameOwner = nextOwnerID > 0 && nextOwnerID === state.ownerID;
      state.compare.mode = "sibling";
      state.compare.pickedAttachmentID = isAtt ? Number(item?.id) || null : sameOwner ? state.compare.pickedAttachmentID : null;
      state.compare.currentAttachmentID = 0;
      const ctrl = this.neighborControls.get(body);
      if (ctrl) ctrl.activeSide = null;
      const allowNeighbor = this.kernel.prefs.get("inspector.pdfPreview.neighborCompareEnable");
      syncCompareBar(state.compareUI, state.compare, [], 0);
      if (ctrl) syncNeighborCompareButtons(ctrl, state.compareUI.bar, nextTabType, 0, allowNeighbor ? this.latestNeighbors : null);
      state.item = item ?? null;
      void loadItemPreviewAttachments(state, state.item, this.onRenderError).then(() => {
        if (ctrl && state.body.isConnected) {
          const allow = this.kernel.prefs.get("inspector.pdfPreview.neighborCompareEnable");
          syncNeighborCompareButtons(ctrl, state.compareUI.bar, state.compare.tabType, state.attachments.length, allow ? this.latestNeighbors : null);
        }
      });
      return enabled;
    }
  };

  // src/domains/inspector/word-cite-panel-ui.ts
  function formatInsertReceipt(res, zh) {
    const doc = res.documentName ? zh ? `「${res.documentName}」` : `"${res.documentName}"` : "Word";
    if (res.status === "inserted") return { tone: "ok", text: zh ? `✓ 已插入 ${res.itemCount} 篇引文到 ${doc}` : `✓ Inserted ${res.itemCount} citation(s) into ${doc}` };
    if (res.status === "busy") return { tone: "warn", text: zh ? "⌛ Word 正在处理引文，请稍候再试" : "⌛ Word is busy updating citations, try again" };
    if (res.status === "non-word") return { tone: "warn", text: zh ? "⚠ 当前激活文档不是受支持的 Word 文档" : "⚠ Active document is not a supported Word document" };
    if (res.status === "cancelled") return { tone: "warn", text: zh ? "ⓘ 已取消插入引文" : "ⓘ Citation insertion cancelled" };
    return { tone: "err", text: zh ? "✕ 插入失败：请先打开 Word 并确认插件连接正常" : "✕ Unable to insert: verify Word is open and connected" };
  }
  function formatRefreshReceipt(res, zh) {
    const doc = res.documentName ? zh ? `「${res.documentName}」` : `"${res.documentName}"` : "Word";
    if (res.ok) return { tone: "ok", text: zh ? `↻ 已刷新 ${doc}，并同步序号` : `↻ Refreshed ${doc} citations` };
    return { tone: "warn", text: zh ? "⚠ 未检测到可刷新的活动 Word 文档" : "⚠ No active Word document to refresh" };
  }
  function formatPendingReceipt(kind, zh) {
    const text2 = kind === "insert" ? zh ? "正在插入 Word 引文…" : "Inserting Word citations…" : zh ? "正在刷新 Word 引文…" : "Refreshing Word citations…";
    return { tone: "warn", text: text2 };
  }
  function buildWordCiteMetaText(zh, items) {
    if (!items.length) return zh ? "请选择文献条目以插入 Word 引文" : "Select an item to insert a Word citation";
    const info = getCachedPrimaryItemFields(items[0]);
    const first = [info.creatorYear, info.title].filter(Boolean).join(" · ") || info.title;
    if (items.length === 1) return first;
    return zh ? `已选 ${items.length} 篇：${first}` : `${items.length} items: ${first}`;
  }
  var STYLE_ID2 = "zbf-word-cite-styles";
  var XHTML_NS2 = "http://www.w3.org/1999/xhtml";
  function createXhtmlEl2(doc, tag) {
    return typeof doc.createElementNS === "function" ? doc.createElementNS(XHTML_NS2, tag) : doc.createElement(tag);
  }
  function ensureWordCitePanelStyles(doc) {
    if (!doc?.getElementById) return;
    let style = doc.getElementById(STYLE_ID2);
    if (!style) {
      style = createXhtmlEl2(doc, "style");
      style.id = STYLE_ID2;
      (doc.head || doc.documentElement)?.appendChild(style);
    }
    const css = `
/* Zotero's synthetic scroll spacer can leave a viewport of empty space after
   the final action. Keep the native alignment space for pinned sections. */
item-details:not([pinnedPane]:not([pinnedPane=""])) .zotero-view-item:has(> :nth-last-child(1 of [data-pane]:not([hidden])) .zbf-word-cite-wrap)::before {
	height: 0;
}
.zbf-word-cite-wrap { box-sizing: border-box; display: grid; grid-template-columns: minmax(0, 1fr); gap: 7px; inline-size: 100%; max-inline-size: 100%; min-inline-size: 0; contain: inline-size; overflow: hidden; padding: 6px 2px 8px; font-size: 12px; }
.zbf-word-cite-wrap [hidden] { display: none !important; }
.zbf-wc-row1 { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; min-width: 0; max-width: 100%; min-height: 22px; }
.zbf-wc-doc { box-sizing: border-box; display: inline-flex; align-items: center; gap: 5px; min-width: 0; max-width: 100%; flex: 0 1 auto; padding: 2px 7px; border-radius: 999px; border: 1px solid rgba(128,128,128,0.24); background: var(--fill-quinary, rgba(128,128,128,0.08)); color: inherit; font-size: 11px; line-height: 1.4; cursor: default; appearance: none; }
.zbf-wc-doc.is-multi { cursor: pointer; border-color: rgba(37,99,235,0.35); }
.zbf-wc-doc.is-multi:hover { background: rgba(37,99,235,0.12); }
.zbf-wc-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: #94a3b8; }
.zbf-wc-dot.is-live { background: #16a34a; }
.zbf-wc-docname { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zbf-wc-swap { flex: none; opacity: 0.78; font-size: 10px; }
.zbf-wc-stats { box-sizing: border-box; font-size: 11px; padding: 2px 7px; border-radius: 999px; max-width: 100%; min-width: 0; flex: 0 1 auto; margin-inline-start: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; background: rgba(128,128,128,0.1); color: inherit; opacity: 0.85; }
.zbf-wc-stats.is-cited { background: rgba(22,163,74,0.14); color: #15803d; font-weight: 600; opacity: 1; }
.zbf-wc-meta { min-width: 0; max-width: 100%; font-size: 12px; opacity: 0.88; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-inline: 2px; }
.zbf-wc-actions { display: flex; align-items: stretch; gap: 6px; min-width: 0; max-width: 100%; }
.zbf-word-cite-action { box-sizing: border-box; flex: 1 1 0; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 5px 8px; border-radius: 6px; border: 1px solid rgba(37,99,235,0.42); background: rgba(37,99,235,0.11); color: inherit; font-size: 12px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.zbf-word-cite-action:hover:not(:disabled) { background: rgba(37,99,235,0.2); }
.zbf-word-cite-action:disabled { opacity: 0.45; cursor: default; }
.zbf-word-refresh-action { box-sizing: border-box; flex: 0 0 30px; width: 30px; border-radius: 6px; border: 1px solid rgba(128,128,128,0.28); background: var(--fill-quinary, rgba(128,128,128,0.08)); color: inherit; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.zbf-word-refresh-action:hover:not(:disabled) { background: var(--fill-quarternary, rgba(128,128,128,0.16)); }
.zbf-wc-synergy { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; min-width: 0; max-width: 100%; padding-top: 4px; border-top: 1px dashed rgba(128,128,128,0.2); }
.zbf-wc-link { min-width: 0; max-width: 100%; background: none; border: none; padding: 1px 2px; font-size: 11px; color: #2563eb; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.zbf-wc-link:hover { text-decoration: underline; }
.zbf-wc-doc.is-multi:focus-visible, .zbf-word-cite-action:focus-visible, .zbf-word-refresh-action:focus-visible, .zbf-wc-link:focus-visible { outline: 2px solid var(--accent-blue, #2563eb); outline-offset: 1px; }
.zbf-wc-col-link { flex: none; margin-inline-start: auto; }
.zbf-wc-receipt { font-size: 11px; padding: 4px 7px; border-radius: 5px; line-height: 1.4; }
.zbf-wc-receipt.is-ok { background: rgba(22,163,74,0.12); color: #15803d; }
.zbf-wc-receipt.is-warn { background: rgba(217,119,6,0.12); color: #b45309; }
.zbf-wc-receipt.is-err { background: rgba(220,38,38,0.12); color: #b91c1c; }
@media (prefers-color-scheme: dark) {
	.zbf-wc-stats.is-cited, .zbf-wc-receipt.is-ok { color: #4ade80; }
	.zbf-wc-receipt.is-warn { color: #fbbf24; }
	.zbf-wc-receipt.is-err { color: #f87171; }
	.zbf-wc-link { color: #60a5fa; }
}`;
    if (style.textContent !== css) style.textContent = css;
  }
  function createWordCiteBodyState(doc, body) {
    ensureWordCitePanelStyles(doc);
    const el = (tag, cls) => {
      const node = createXhtmlEl2(doc, tag);
      node.className = cls;
      return node;
    };
    const root = el("div", "zbf-word-cite-wrap");
    const row1 = el("div", "zbf-wc-row1");
    const docBtn = el("button", "zbf-wc-doc");
    docBtn.type = "button";
    const docDot = el("span", "zbf-wc-dot");
    const docName = el("span", "zbf-wc-docname");
    const docSwap = el("span", "zbf-wc-swap");
    docSwap.textContent = "⇄";
    docSwap.hidden = true;
    docBtn.append(docDot, docName, docSwap);
    const statsEl = el("span", "zbf-wc-stats");
    row1.append(docBtn, statsEl);
    const metaEl = el("div", "zbf-wc-meta");
    const actions = el("div", "zbf-wc-actions");
    const insertBtn = el("button", "zbf-word-cite-action");
    insertBtn.type = "button";
    const refreshBtn = el("button", "zbf-word-refresh-action");
    refreshBtn.type = "button";
    refreshBtn.textContent = "↻";
    actions.append(insertBtn, refreshBtn);
    const synergyEl = el("div", "zbf-wc-synergy");
    const groupBtn = el("button", "zbf-wc-link zbf-word-group-action");
    groupBtn.type = "button";
    const colBtn = el("button", "zbf-wc-link zbf-wc-col-link zbf-word-col-action");
    colBtn.type = "button";
    synergyEl.append(groupBtn, colBtn);
    const receiptEl = el("div", "zbf-wc-receipt");
    receiptEl.hidden = true;
    receiptEl.setAttribute("role", "status");
    root.append(row1, metaEl, actions, synergyEl, receiptEl);
    body.appendChild(root);
    return {
      root,
      row1,
      docBtn,
      docDot,
      docName,
      docSwap,
      statsEl,
      metaEl,
      insertBtn,
      refreshBtn,
      synergyEl,
      groupBtn,
      colBtn,
      receiptEl,
      activeItem: null,
      lastItemIDs: [],
      lastGroup: null
    };
  }
  function renderWordCitePanel(st, vm) {
    st.docBtn.hidden = !vm.showDocSwitcher;
    st.docBtn.classList.toggle("is-multi", vm.isMultiSession);
    st.docBtn.disabled = !vm.isMultiSession;
    st.docBtn.title = vm.docTitle;
    st.docDot.classList.toggle("is-live", vm.hasWordSession);
    st.docName.textContent = vm.docName;
    st.docSwap.hidden = !vm.isMultiSession;
    st.statsEl.hidden = !vm.showSummaryCounts;
    st.statsEl.textContent = vm.statsText;
    st.statsEl.title = vm.statsTitle;
    st.statsEl.classList.toggle("is-cited", vm.statsState === "cited");
    st.statsEl.classList.toggle("is-uncited", vm.statsState !== "cited");
    st.row1.hidden = !vm.showDocSwitcher && !vm.showSummaryCounts;
    st.metaEl.textContent = vm.metaText;
    st.metaEl.title = vm.metaTitle;
    st.insertBtn.textContent = vm.insertLabel;
    st.insertBtn.disabled = vm.insertDisabled;
    st.refreshBtn.disabled = vm.refreshDisabled;
    st.refreshBtn.title = vm.refreshTitle;
    st.groupBtn.hidden = !vm.groupButtonText;
    st.groupBtn.disabled = vm.refreshDisabled;
    st.groupBtn.textContent = vm.groupButtonText;
    st.groupBtn.title = vm.groupButtonTitle;
    st.colBtn.hidden = !vm.showCollectionButton;
    st.colBtn.textContent = vm.colButtonText;
    st.colBtn.title = vm.colButtonTitle;
    st.synergyEl.hidden = st.groupBtn.hidden && st.colBtn.hidden;
    st.receiptEl.hidden = vm.receiptTone === "none" || !vm.receiptText;
    st.receiptEl.textContent = vm.receiptText;
    st.receiptEl.classList.remove("is-ok", "is-warn", "is-err");
    if (vm.receiptTone !== "none") st.receiptEl.classList.add(`is-${vm.receiptTone}`);
  }

  // src/domains/inspector/word-cite-section.ts
  var WORD_CITE_ICON = 'item-pane-sidenav .btn[data-l10n-id="zbf-pane-word-cite-sidenav"]';
  function isZhLocale() {
    return String(globalThis.Zotero?.locale || "zh-CN").toLowerCase().startsWith("zh");
  }
  var WordCiteSectionController = class {
    kernel;
    services;
    disposables = new DisposableStack();
    states = /* @__PURE__ */ new Map();
    buttonListeners = /* @__PURE__ */ new Map();
    docListeners = /* @__PURE__ */ new Map();
    unregisterFn = null;
    snapshot = null;
    groups = [];
    receiptOwner;
    receipt = { text: "", tone: "none" };
    requestSeq = 0;
    pendingRequest;
    pendingTimer = null;
    constructor(kernel, services) {
      this.kernel = kernel;
      this.services = services;
    }
    register() {
      if (this.unregisterFn) return;
      this.disposables.reset();
      this.disposables.add(this.kernel.bus.on("citation:snapshot-updated", (snap) => {
        this.snapshot = snap;
        this.renderAllBodies();
      }));
      this.disposables.add(this.kernel.bus.on("workspace:groups-updated", ({ groups }) => {
        this.groups = groups;
        this.renderAllBodies();
      }));
      this.disposables.add(this.kernel.bus.on("word:insert-result", (res) => {
        if (!this.pendingRequest || res.requestId !== this.pendingRequest) return;
        this.clearPendingTimer();
        this.pendingRequest = void 0;
        this.receipt = formatInsertReceipt(res, isZhLocale());
        this.renderAllBodies();
      }));
      this.disposables.add(this.kernel.bus.on("word:refresh-result", (res) => {
        if (!this.pendingRequest || res.requestId !== this.pendingRequest) return;
        this.clearPendingTimer();
        this.pendingRequest = void 0;
        this.receipt = formatRefreshReceipt(res, isZhLocale());
        this.renderAllBodies();
      }));
      const icon = `${this.kernel.info.rootURI}assets/word-cite.svg`;
      const reg = this.services.itemPanes.register({
        paneID: "bridgeflow-word-cite",
        pluginID: this.kernel.info.id,
        header: { l10nID: "zbf-pane-word-cite-header", icon },
        sidenav: { l10nID: "zbf-pane-word-cite-sidenav", icon, orderable: true },
        onInit: ({ doc, body, item, setEnabled, setSectionSummary }) => {
          this.initBody(doc || body.ownerDocument, body, item, setEnabled, setSectionSummary);
          this.services.panePositions.observeAndQueue(body);
        },
        onDestroy: ({ doc, body }) => {
          this.onDestroy(doc || body.ownerDocument, body);
        },
        onItemChange: ({ body, item, setEnabled, setSectionSummary }) => {
          if (this.states.get(body) === this.receiptOwner && !this.pendingRequest) this.receipt = { text: "", tone: "none" };
          this.updateState(body, item, setEnabled, setSectionSummary);
          this.services.panePositions.observeAndQueue(body);
          return this.isSectionEnabled() && Boolean(item);
        },
        onRender: ({ body, item, setEnabled, setSectionSummary }) => {
          this.updateState(body, item, setEnabled, setSectionSummary);
          this.services.panePositions.observeAndQueue(body);
        },
        onToggle: ({ body, item, setEnabled, setSectionSummary }) => {
          this.updateState(body, item, setEnabled, setSectionSummary);
          this.kernel.bus.emit("word:snapshot-query", { requester: "inspector" });
          this.kernel.bus.emit("workspace:groups-query", { requester: "inspector" });
        }
      });
      this.unregisterFn = reg.dispose;
      if (reg.sectionID) {
        this.services.panePositions.setTarget("word-cite", {
          sectionID: reg.sectionID,
          getPosition: () => normalizePanePosition(this.kernel.prefs.get("inspector.wordCite.position"), "zotero-editpane-related")
        });
      }
      this.kernel.bus.emit("word:snapshot-query", { requester: "inspector" });
      this.kernel.bus.emit("workspace:groups-query", { requester: "inspector" });
    }
    refreshAll() {
      this.renderAllBodies();
    }
    unregister() {
      this.clearPendingTimer();
      this.services.panePositions.setTarget("word-cite", null);
      this.disposables.disposeAll();
      for (const c of this.buttonListeners.values()) c.abort();
      this.buttonListeners.clear();
      for (const c of this.docListeners.values()) c.abort();
      this.docListeners.clear();
      this.unregisterFn?.();
      this.unregisterFn = null;
      this.states.clear();
      this.receiptOwner = void 0;
      this.pendingRequest = void 0;
      this.receipt = { text: "", tone: "none" };
    }
    citeItemsInWord(itemIDs, win, owner) {
      const valid = [...new Set(itemIDs.filter((id) => Number.isSafeInteger(id) && id > 0))];
      if (!valid.length || !this.isSectionEnabled() || this.pendingRequest) return false;
      const requestId = this.beginRequest("insert", owner);
      this.kernel.bus.emit("word:insert-items-request", { itemIDs: valid, win, requestId });
      return true;
    }
    clearPendingTimer() {
      if (this.pendingTimer !== null) {
        clearTimeout(this.pendingTimer);
        this.pendingTimer = null;
      }
    }
    beginRequest(kind, owner) {
      this.clearPendingTimer();
      const requestId = `word-${++this.requestSeq}`;
      this.pendingRequest = requestId;
      this.receiptOwner = owner;
      this.receipt = formatPendingReceipt(kind, isZhLocale());
      this.pendingTimer = setTimeout(() => {
        if (this.pendingRequest !== requestId) return;
        this.pendingTimer = null;
        this.pendingRequest = void 0;
        this.receipt = { tone: "warn", text: isZhLocale() ? "⌛ 未收到 Word 响应，请检查 Word 后重试" : "⌛ Word request timed out; retry when ready" };
        this.renderAllBodies();
      }, 12e3);
      this.renderAllBodies();
      return requestId;
    }
    isSectionEnabled() {
      return Boolean(
        this.kernel.prefs.get("inspector.wordCite.enable") && this.kernel.prefs.get("modules.wordCite.enable")
      );
    }
    initBody(doc, body, item, setEnabled, setSectionSummary) {
      if (!doc) return;
      this.onDestroy(null, body);
      const st = createWordCiteBodyState(doc, body);
      st.setSectionSummary = setSectionSummary;
      this.states.set(body, st);
      const win = body.ownerDocument.defaultView;
      const controller = new (win?.AbortController ?? AbortController)();
      this.buttonListeners.set(body, controller);
      const click = (button, action) => {
        button.addEventListener("click", () => {
          if (!button.disabled && !button.hidden) action();
        }, { signal: controller.signal });
      };
      click(st.insertBtn, () => this.citeItemsInWord(st.lastItemIDs, win ?? void 0, st));
      click(st.refreshBtn, () => this.kernel.bus.emit("word:refresh-request", {
        requestId: this.beginRequest("refresh", st),
        win: win ?? void 0
      }));
      click(st.docBtn, () => this.cycleWordSession());
      click(st.groupBtn, () => this.citeItemsInWord(st.lastGroup?.itemIDs || [], win ?? void 0, st));
      click(st.colBtn, () => this.kernel.bus.emit("word:select-collection-request", {
        sessionID: this.snapshot?.activeSessionID || void 0,
        win: win ?? void 0
      }));
      this.bindDocumentEvents(doc);
      this.updateState(body, item, setEnabled, setSectionSummary);
    }
    bindDocumentEvents(doc) {
      if (this.docListeners.has(doc)) return;
      const ac = new (doc.defaultView?.AbortController ?? AbortController)();
      this.docListeners.set(doc, ac);
      doc.addEventListener("click", (event) => {
        const me = event;
        if (typeof me.button === "number" && me.button !== 0) return;
        const target = event.target;
        const path = event.composedPath?.();
        const hitIcon = path?.some((n) => n?.matches?.(WORD_CITE_ICON)) ?? Boolean(target?.closest?.(WORD_CITE_ICON));
        if (hitIcon) {
          for (const st of this.states.values()) {
            if (st.root.ownerDocument !== doc) continue;
            const collapsible = st.root.closest?.("collapsible-section");
            if (collapsible && !collapsible.open) collapsible.open = true;
            this.renderBodyState(st);
          }
          return;
        }
      }, { capture: true, signal: ac.signal });
    }
    onDestroy(doc, body) {
      this.buttonListeners.get(body)?.abort();
      this.buttonListeners.delete(body);
      if (this.states.get(body) === this.receiptOwner) this.receiptOwner = void 0;
      this.states.delete(body);
      body.textContent = "";
      if (doc && ![...this.states.keys()].some((b) => b.ownerDocument === doc)) {
        this.docListeners.get(doc)?.abort();
        this.docListeners.delete(doc);
      }
    }
    cycleWordSession() {
      const sessions = this.snapshot?.sessions || [];
      if (sessions.length < 2) return;
      const curIdx = sessions.findIndex((s) => s.sessionID === this.snapshot?.activeSessionID);
      const next = sessions[(curIdx + 1) % sessions.length];
      if (next) this.kernel.bus.emit("word:switch-session-request", { sessionID: next.sessionID });
    }
    renderAllBodies() {
      for (const st of this.states.values()) this.renderBodyState(st);
    }
    updateState(body, item, setEnabled, setSectionSummary) {
      const st = this.states.get(body);
      if (!st) return;
      if (setSectionSummary) st.setSectionSummary = setSectionSummary;
      st.activeItem = item ?? null;
      const items = this.resolveTargetItems(body.ownerDocument?.defaultView || null, item);
      const enabled = this.isSectionEnabled() && items.length > 0;
      setEnabled?.(enabled);
      st.lastItemIDs = enabled ? items.map((it) => Number(it.id)) : [];
      this.renderBodyState(st, items);
    }
    renderBodyState(st, resolvedItems) {
      const items = resolvedItems ?? this.resolveTargetItems(st.root.ownerDocument?.defaultView || null, st.activeItem);
      const zh = isZhLocale();
      const snap = this.snapshot;
      const hasSession = Boolean(snap?.activeSessionID);
      const sessionCount = snap?.sessions?.length ?? 0;
      const showDocSwitcher = this.kernel.prefs.get("inspector.wordCite.showDocSwitcher");
      const showSummaryCounts = this.kernel.prefs.get("inspector.wordCite.showSummaryCounts");
      const showGroupSynergy = this.kernel.prefs.get("inspector.wordCite.showGroupSynergy");
      const showCollectionLink = this.kernel.prefs.get("inspector.wordCite.showCollectionLink");
      const idSet = new Set(st.lastItemIDs);
      const matchedGroup = showGroupSynergy && idSet.size > 0 ? this.groups.find((g) => g.itemIDs.length >= 2 && g.itemIDs.some((id) => idSet.has(id))) ?? null : null;
      st.lastGroup = matchedGroup;
      const uncitedInGroup = matchedGroup && hasSession ? matchedGroup.itemIDs.filter((id) => !snap.byItemID.has(id)).length : 0;
      st.setSectionSummary?.(showSummaryCounts ? this.buildSectionSummary(zh, snap, st.lastItemIDs) : "");
      const stats = this.buildStats(zh, snap, st.lastItemIDs);
      const meta = buildWordCiteMetaText(zh, items);
      const vm = {
        showDocSwitcher,
        showSummaryCounts,
        docName: hasSession ? snap.activeDocumentName || "Word" : zh ? "未连接 Word" : "No Word session",
        docTitle: sessionCount >= 2 ? zh ? `点击切换目标 Word 文档 (${sessionCount} 个已打开)` : `Click to switch active Word doc (${sessionCount} open)` : hasSession ? snap.activeDocumentName : zh ? "请打开 Word 文档" : "Open a Word document",
        isMultiSession: sessionCount >= 2,
        hasWordSession: hasSession,
        statsText: stats.text,
        statsTitle: stats.title,
        statsState: stats.state,
        metaText: meta,
        metaTitle: meta,
        insertLabel: st.lastItemIDs.length > 1 ? zh ? `合并插入 ${st.lastItemIDs.length} 篇引文到 Word` : `Insert ${st.lastItemIDs.length} Citations in Word` : zh ? "插入引文到 Word 光标处" : "Insert Citation at Word Cursor",
        insertDisabled: Boolean(this.pendingRequest) || st.lastItemIDs.length === 0 || !this.isSectionEnabled(),
        refreshDisabled: Boolean(this.pendingRequest) || !this.isSectionEnabled(),
        refreshTitle: zh ? "刷新当前 Word 文档引文与编号" : "Refresh Word document & sync ordinals",
        groupButtonText: matchedGroup ? zh ? `引用所在分组「${matchedGroup.groupName}」(${matchedGroup.itemIDs.length})` : `Cite Group "${matchedGroup.groupName}" (${matchedGroup.itemIDs.length})` : "",
        groupButtonTitle: matchedGroup ? zh ? `将工作区分组「${matchedGroup.groupName}」中的 ${matchedGroup.itemIDs.length} 篇文献合并插入 Word${hasSession ? `（其中 ${uncitedInGroup} 篇尚未引用）` : ""}` : `Insert all ${matchedGroup.itemIDs.length} papers from "${matchedGroup.groupName}"${hasSession ? ` (${uncitedInGroup} uncited)` : ""}` : "",
        showCollectionButton: showCollectionLink && hasSession && Boolean(this.kernel.prefs.get("wordCite.collections.enable")),
        colButtonText: zh ? "已引清单" : "Cited List",
        colButtonTitle: zh ? "在左侧目录树定位当前文档的已引用文献合集" : "Reveal temporary Word collection in library tree",
        receiptText: st === this.receiptOwner ? this.receipt.text : "",
        receiptTone: st === this.receiptOwner ? this.receipt.tone : "none"
      };
      renderWordCitePanel(st, vm);
    }
    buildSectionSummary(zh, snap, ids) {
      if (!snap?.activeSessionID) return "";
      const total = snap.totalCitedCount;
      if (ids.length > 1) return zh ? `已选 ${ids.length} 篇 · 共引 ${total} 篇` : `${ids.length} selected · ${total} cited`;
      const badge = ids.length === 1 ? snap.byItemID.get(ids[0]) : void 0;
      if (badge) return zh ? `序号 [${badge.ordinal}] · 共引 ${total} 篇` : `[${badge.ordinal}] · ${total} cited`;
      return zh ? `未引用 · 共引 ${total} 篇` : `Uncited · ${total} cited`;
    }
    buildStats(zh, snap, ids) {
      if (!snap?.activeSessionID) {
        return { text: zh ? "请先打开 Word" : "Open Word first", title: zh ? "暂未检测到活动 Word 文档会话" : "No active Word session detected", state: "none" };
      }
      const total = snap.totalCitedCount;
      if (ids.length === 1) {
        const b = snap.byItemID.get(ids[0]);
        if (b) {
          const occ = b.occurrences ?? 1;
          return { text: zh ? `序号 [${b.ordinal}] / 共 ${total} 篇` : `[${b.ordinal}] / ${total} cited`, title: zh ? `在「${snap.activeDocumentName}」中出现 ${occ} 次${b.shortText ? ` · ${b.shortText}` : ""}` : `Cited ${occ} time(s) in "${snap.activeDocumentName}"`, state: "cited" };
        }
        return { text: zh ? `未引 / 共 ${total} 篇` : `Uncited / ${total}`, title: zh ? `尚未在「${snap.activeDocumentName}」中引用 (当前共引 ${total} 篇)` : `Not yet cited in "${snap.activeDocumentName}" (${total} total)`, state: "uncited" };
      }
      if (ids.length > 1) {
        const cited = ids.map((id) => snap.byItemID.get(id)).filter((b) => Boolean(b)).sort((a, b) => a.ordinal - b.ordinal);
        if (cited.length) {
          const list = `[${cited.slice(0, 3).map((b) => b.ordinal).join(", ")}${cited.length > 3 ? "…" : ""}]`;
          return { text: zh ? `已引 ${list} / 共 ${total} 篇` : `${cited.length}/${ids.length} cited · ${total} total`, title: zh ? `所选 ${ids.length} 篇中有 ${cited.length} 篇已引用` : `${cited.length} of ${ids.length} selected items cited`, state: "cited" };
        }
        return { text: zh ? `未引 (${ids.length} 篇) / 共 ${total} 篇` : `0/${ids.length} cited · ${total} total`, title: zh ? "当前选中文献均尚未在 Word 中引用" : "None of the selected items are cited yet", state: "uncited" };
      }
      return { text: zh ? `共引 ${total} 篇` : `${total} cited`, title: snap.activeDocumentName, state: "uncited" };
    }
    resolveTargetItems(win, item) {
      if (!item) return [];
      const reg = normalizeToRegularItem(item) || item;
      const paneItems = win?.ZoteroPane?.getSelectedItems?.() || [];
      const regId = Number(reg?.id || 0);
      const itemId = Number(item?.id || 0);
      if (paneItems.length > 1 && paneItems.some((p) => Number(p?.id || 0) === itemId || regId > 0 && Number(p?.id || 0) === regId)) {
        return deduplicateRegularItems(paneItems).items;
      }
      return deduplicateRegularItems([reg]).items;
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
    wordCiteSection;
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
      this.wordCiteSection = new WordCiteSectionController(kernel, services);
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
            "inspector.pdfFolder.enable",
            "inspector.wordCite.enable",
            "modules.wordCite.enable"
          ],
          () => this.syncSections()
        )
      );
      this.disposables.add(
        this.kernel.prefs.observeKeys(
          [
            "inspector.wordCite.showDocSwitcher",
            "inspector.wordCite.showSummaryCounts",
            "inspector.wordCite.showGroupSynergy",
            "inspector.wordCite.showCollectionLink",
            "wordCite.collections.enable"
          ],
          () => this.wordCiteSection.refreshAll()
        )
      );
      this.disposables.add(
        this.kernel.prefs.observeKeys(
          [
            "inspector.cslPreview.position",
            "inspector.pdfPreview.position",
            "inspector.pdfFolder.position",
            "inspector.wordCite.position"
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
    async refreshAllPreviews() {
      await this.cslPreview.refreshAll();
      this.wordCiteSection.refreshAll();
    }
    stop() {
      if (!this.active) return;
      this.active = false;
      this.cslPreview.unregister();
      this.lookupSection.unregister();
      this.pdfPreview.unregister();
      this.pdfFolder.unregister();
      this.wordCiteSection.unregister();
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
      if (this.kernel.prefs.get("inspector.wordCite.enable") && this.kernel.prefs.get("modules.wordCite.enable")) {
        this.wordCiteSection.register();
      } else {
        this.wordCiteSection.unregister();
      }
      this.services.panePositions.queueAll();
    }
  };

  // src/services/annotation-utils.ts
  var DEFAULT_ANNOTATION_COLORS = {
    "#ffd400": "背景",
    "#ff6666": "方法",
    "#5fb236": "不足",
    "#2ea8e5": "创新",
    "#a28ae5": "结论",
    "#e56eee": "引用",
    "#f19837": "数据",
    "#aaaaaa": "备注"
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
  function resolveColorLabel(color, semantics) {
    const hex = normalizeHexColor(color);
    return hex && semantics[hex] || hex || "未分类";
  }
  function joinAnnotationText(parts) {
    let acc = "";
    for (const raw of parts) {
      const piece = String(raw || "").trim();
      if (!piece) continue;
      if (!acc) {
        acc = piece;
      } else if (acc.endsWith("-") && /^[a-zA-Z]/.test(piece)) {
        acc = acc.slice(0, -1) + piece;
      } else {
        acc = `${acc} ${piece}`;
      }
    }
    return acc;
  }
  function compareAnnotationsByOrder(a, b) {
    const sa = String(a?.annotationSortIndex || "");
    const sb = String(b?.annotationSortIndex || "");
    if (sa && sb && sa !== sb) return sa.localeCompare(sb);
    const pa = Number(a?.annotationPageLabel || 0);
    const pb = Number(b?.annotationPageLabel || 0);
    if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
    return Number(a?.id || 0) - Number(b?.id || 0);
  }
  function mergeAnnotationPayloads(annotations) {
    const sorted = [...annotations].sort(compareAnnotationsByOrder);
    const texts = [];
    const comments = [];
    const commentSeen = /* @__PURE__ */ new Set();
    let basePos = null;
    const allRects = [];
    for (const ann of sorted) {
      const t = String(ann?.annotationText ?? ann?.getField?.("annotationText") ?? "").trim();
      if (t) texts.push(t);
      const c = String(ann?.annotationComment ?? ann?.getField?.("annotationComment") ?? "").trim();
      if (c && !commentSeen.has(c)) {
        commentSeen.add(c);
        comments.push(c);
      }
      const posRaw = ann?.annotationPosition ?? ann?.getField?.("annotationPosition");
      if (typeof posRaw === "string" && posRaw.trim()) {
        try {
          const parsed = JSON.parse(posRaw);
          if (parsed && typeof parsed === "object") {
            if (!basePos) basePos = { ...parsed };
            if (basePos && Array.isArray(parsed.rects) && parsed.pageIndex === basePos.pageIndex) {
              allRects.push(...parsed.rects);
            }
          }
        } catch {
        }
      }
    }
    if (basePos && allRects.length) {
      basePos.rects = allRects;
    }
    return {
      mergedText: joinAnnotationText(texts),
      mergedComment: comments.join("\n"),
      mergedPosition: basePos ? JSON.stringify(basePos) : ""
    };
  }
  async function mergeAnnotationsByIDs(ids) {
    const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
    if (unique.length < 2) return { ok: false, keptID: 0, removedCount: 0 };
    const hostItems = globalThis.Zotero?.Items;
    if (!hostItems) return { ok: false, keptID: 0, removedCount: 0 };
    const loaded = [];
    for (const id of unique) {
      const it = hostItems.get?.(id) || (hostItems.getAsync ? await hostItems.getAsync(id).catch(() => null) : null);
      if (it && !it.deleted && (it.isAnnotation?.() || it.itemType === "annotation")) {
        loaded.push(it);
      }
    }
    if (loaded.length < 2) return { ok: false, keptID: 0, removedCount: 0 };
    const parentID = Number(loaded[0].parentID || loaded[0].parentItemID || 0);
    const sameParent = loaded.filter((it) => Number(it.parentID || it.parentItemID || 0) === parentID);
    if (sameParent.length < 2) return { ok: false, keptID: 0, removedCount: 0 };
    const sorted = [...sameParent].sort(compareAnnotationsByOrder);
    const primary = sorted[0];
    const rest = sorted.slice(1);
    const { mergedText, mergedComment, mergedPosition } = mergeAnnotationPayloads(sorted);
    primary.annotationText = mergedText;
    primary.annotationComment = mergedComment;
    if (mergedPosition) primary.annotationPosition = mergedPosition;
    if (typeof primary.saveTx === "function") await primary.saveTx();
    else if (typeof primary.save === "function") await primary.save();
    const restIDs = rest.map((r) => Number(r.id)).filter((id) => id > 0);
    if (restIDs.length && typeof hostItems.trashTx === "function") {
      await hostItems.trashTx(restIDs);
    } else {
      for (const r of rest) {
        r.deleted = true;
        if (typeof r.saveTx === "function") await r.saveTx();
      }
    }
    return { ok: true, keptID: Number(primary.id || 0), removedCount: rest.length };
  }
  function collectItemAnnotations(items, semantics) {
    const hostItems = globalThis.Zotero?.Items;
    const out = [];
    const seenAnn = /* @__PURE__ */ new Set();
    for (const rawItem of items) {
      if (!rawItem || rawItem.deleted) continue;
      const itemID = Number(rawItem.id || 0);
      const itemTitle = String(rawItem.getField?.("title") || rawItem.title || `文献 #${itemID}`);
      const creator = String(rawItem.firstCreator || "").trim();
      const year = String(rawItem.getField?.("year") || rawItem.getField?.("date") || "").slice(0, 4);
      const creatorYear = [creator, year].filter(Boolean).join(" ");
      const canHaveAnnotations = (it) => {
        if (!it || it.deleted || typeof it.getAnnotations !== "function") return false;
        if (typeof it.isFileAttachment === "function") return Boolean(it.isFileAttachment());
        if (typeof it.isAttachment === "function" && !it.isAttachment()) return false;
        return true;
      };
      const attachments = [];
      if (canHaveAnnotations(rawItem)) attachments.push(rawItem);
      const attIDs = typeof rawItem.getAttachments === "function" ? rawItem.getAttachments() || [] : [];
      for (const aid of attIDs) {
        const att = hostItems?.get?.(aid);
        if (canHaveAnnotations(att)) attachments.push(att);
      }
      for (const att of attachments) {
        let anns = [];
        try {
          anns = att.getAnnotations?.() || [];
        } catch {
          anns = [];
        }
        for (const ann of [...anns].sort(compareAnnotationsByOrder)) {
          const annID = Number(ann?.id || 0);
          if (!ann || ann.deleted || annID > 0 && seenAnn.has(annID)) continue;
          if (annID > 0) seenAnn.add(annID);
          const color = normalizeHexColor(ann.annotationColor || ann.color);
          const text2 = String(ann.annotationText || "").trim();
          const comment = String(ann.annotationComment || "").trim();
          if (!text2 && !comment) continue;
          const tags = typeof ann.getTags === "function" ? (ann.getTags() || []).map((t) => String(t?.tag || t || "").trim()).filter(Boolean) : [];
          out.push({
            itemID,
            itemTitle,
            creatorYear,
            annotationID: annID,
            color,
            colorLabel: resolveColorLabel(color, semantics),
            text: text2,
            comment,
            pageLabel: String(ann.annotationPageLabel || ""),
            tags
          });
        }
      }
    }
    return out;
  }

  // src/services/annotation-matrix.ts
  function matchesAnnotationQuery(ann, rawQuery) {
    const query = String(rawQuery || "").trim().toLowerCase();
    if (!query) return true;
    const hay = `${ann.text} ${ann.comment} ${ann.itemTitle} ${ann.colorLabel} ${ann.tags.join(" ")}`.toLowerCase();
    const orClauses = query.split("||").map((s) => s.trim()).filter(Boolean);
    if (!orClauses.length) return true;
    return orClauses.some((clause) => {
      const andTerms = clause.split("&&").map((s) => s.trim()).filter(Boolean);
      return andTerms.length > 0 && andTerms.every((term) => hay.includes(term));
    });
  }
  function filterCollectedAnnotations(list, opts = {}) {
    const wantedColor = String(opts.colorLabel || "").trim().toLowerCase();
    const wantedTag = String(opts.tag || "").trim().toLowerCase();
    return list.filter((ann) => {
      if (wantedColor && ann.colorLabel.toLowerCase() !== wantedColor && normalizeHexColor(ann.color) !== wantedColor) {
        return false;
      }
      if (wantedTag && !ann.tags.some((t) => t.toLowerCase() === wantedTag || t.toLowerCase().includes(wantedTag))) {
        return false;
      }
      return matchesAnnotationQuery(ann, opts.query || "");
    });
  }
  function buildAnnotationMatrix(items, colorLabelsJson, opts = {}) {
    const semantics = parseColorSemantics(colorLabelsJson);
    const all = collectItemAnnotations(items, semantics);
    const filtered = filterCollectedAnnotations(all, opts);
    const colOrder = [];
    const colSeen = /* @__PURE__ */ new Set();
    for (const label of Object.values(semantics)) {
      if (filtered.some((a) => a.colorLabel === label) && !colSeen.has(label)) {
        colSeen.add(label);
        colOrder.push(label);
      }
    }
    for (const a of filtered) {
      if (!colSeen.has(a.colorLabel)) {
        colSeen.add(a.colorLabel);
        colOrder.push(a.colorLabel);
      }
    }
    const byItem = /* @__PURE__ */ new Map();
    for (const raw of items) {
      const id = Number(raw?.id || 0);
      if (!id || raw?.deleted) continue;
      const title = String(raw.getField?.("title") || raw.title || `文献 #${id}`);
      const creator = String(raw.firstCreator || "").trim();
      const year = String(raw.getField?.("year") || raw.getField?.("date") || "").slice(0, 4);
      byItem.set(id, { title, creatorYear: [creator, year].filter(Boolean).join(" "), list: [] });
    }
    for (const a of filtered) {
      let bucket = byItem.get(a.itemID);
      if (!bucket) {
        bucket = { title: a.itemTitle, creatorYear: a.creatorYear, list: [] };
        byItem.set(a.itemID, bucket);
      }
      bucket.list.push(a);
    }
    const rows = [];
    for (const [itemID, entry] of byItem.entries()) {
      if (filtered.length > 0 && entry.list.length === 0 && (opts.query || opts.colorLabel || opts.tag)) continue;
      const cells = {};
      for (const col of colOrder) cells[col] = [];
      for (const a of entry.list) {
        if (!cells[a.colorLabel]) cells[a.colorLabel] = [];
        cells[a.colorLabel].push(a);
      }
      rows.push({ itemID, title: entry.title, creatorYear: entry.creatorYear, cells });
    }
    return { columns: colOrder, rows, totalAnnotations: filtered.length };
  }
  function formatAnnotationCellText(list) {
    return list.map((a) => {
      const page = a.pageLabel ? `[p.${a.pageLabel}] ` : "";
      const body = a.comment && a.text ? `${a.text}（评注：${a.comment}）` : a.comment || a.text;
      return `${page}${body}`;
    }).join("；");
  }
  function renderMatrixMarkdown(matrix, heading = "文献对比矩阵") {
    const cols = ["文献", ...matrix.columns];
    const header = `| ${cols.join(" | ")} |`;
    const sep = `| ${cols.map(() => "---").join(" | ")} |`;
    const lines = [`## ${heading}`, "", header, sep];
    for (const row of matrix.rows) {
      const meta = row.creatorYear ? `${row.title} (${row.creatorYear})` : row.title;
      const cells = [
        meta.replace(/\|/g, "\\|"),
        ...matrix.columns.map((c) => formatAnnotationCellText(row.cells[c] || []).replace(/\|/g, "\\|").replace(/\r?\n/g, " "))
      ];
      lines.push(`| ${cells.join(" | ")} |`);
    }
    return lines.join("\n");
  }
  function csvCell(val) {
    const s = String(val || "");
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function renderMatrixCsv(matrix) {
    const header = ["文献", "作者年份", ...matrix.columns].map(csvCell).join(",");
    const rows = matrix.rows.map((row) => [
      row.title,
      row.creatorYear,
      ...matrix.columns.map((c) => formatAnnotationCellText(row.cells[c] || []))
    ].map(csvCell).join(","));
    return [header, ...rows].join("\n");
  }
  function escHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function renderMatrixHtmlNote(matrix, heading = "BridgeFlow 文献对比矩阵") {
    const ths = ["文献", ...matrix.columns].map((c) => `<th>${escHtml(c)}</th>`).join("");
    const trs = matrix.rows.map((row) => {
      const meta = row.creatorYear ? `${escHtml(row.title)}<br/><small>${escHtml(row.creatorYear)}</small>` : escHtml(row.title);
      const tds = matrix.columns.map((c) => `<td>${escHtml(formatAnnotationCellText(row.cells[c] || []))}</td>`).join("");
      return `<tr><td>${meta}</td>${tds}</tr>`;
    }).join("");
    return `<h2>${escHtml(heading)}</h2><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
  }
  async function saveMatrixAsZoteroNote(matrix, heading, libraryID) {
    const ZoteroObj = globalThis.Zotero;
    const ItemCtor = ZoteroObj?.Item;
    if (typeof ItemCtor !== "function") return null;
    try {
      const note = new ItemCtor("note");
      note.libraryID = libraryID || Number(ZoteroObj?.Libraries?.userLibraryID || 1);
      note.setNote(renderMatrixHtmlNote(matrix, heading));
      const id = await note.saveTx?.();
      return Number(id || note.id || 0) || null;
    } catch {
      return null;
    }
  }

  // src/domains/visual-notes/annotation-matrix-ui.ts
  var MATRIX_STYLE_ID = "zbf-matrix-modal-style";
  var MATRIX_CSS = `
.zbf-matrix-backdrop { position: fixed; inset: 0; z-index: 2147483646; background: rgba(15,23,42,0.48); display: flex; align-items: center; justify-content: center; padding: 20px; }
.zbf-matrix-dialog { width: min(1040px, 94vw); max-height: 86vh; display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border-radius: 12px; background: light-dark(#ffffff, #1e293b); color: light-dark(#111827, #e2e8f0); border: 1px solid light-dark(rgba(15,23,42,0.14), rgba(148,163,184,0.24)); box-shadow: 0 20px 50px rgba(0,0,0,0.32); font: 12.5px/1.45 system-ui, "Microsoft YaHei UI", sans-serif; }
.zbf-matrix-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.zbf-matrix-title { font-size: 15px; font-weight: 600; }
.zbf-matrix-close { width: 26px; height: 26px; border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; font-size: 14px; display: inline-flex; align-items: center; justify-content: center; }
.zbf-matrix-close:hover { background: light-dark(rgba(15,23,42,0.08), rgba(255,255,255,0.1)); }
.zbf-matrix-controls { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.zbf-matrix-search-wrap { position: relative; flex: 1 1 230px; min-width: 180px; display: flex; align-items: center; }
.zbf-matrix-input { width: 100%; height: 29px; padding: 0 26px 0 9px; border-radius: 6px; border: 1px solid light-dark(rgba(15,23,42,0.18), rgba(148,163,184,0.32)); background: light-dark(#f8fafc, #0f172a); color: inherit; font: inherit; box-sizing: border-box; }
.zbf-matrix-input:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.16); }
.zbf-matrix-clear { position: absolute; right: 4px; width: 20px; height: 20px; border: 0; border-radius: 4px; background: transparent; color: inherit; opacity: 0.6; cursor: pointer; display: none; align-items: center; justify-content: center; }
.zbf-matrix-clear:hover { opacity: 1; background: rgba(128,128,128,0.16); }
.zbf-matrix-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; border: 1px solid light-dark(rgba(15,23,42,0.16), rgba(148,163,184,0.28)); background: transparent; color: inherit; cursor: pointer; font-size: 11.5px; transition: background-color 0.12s, border-color 0.12s; }
.zbf-matrix-chip:hover { background: light-dark(rgba(15,23,42,0.05), rgba(255,255,255,0.06)); }
.zbf-matrix-chip[data-active="true"] { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 600; }
.zbf-matrix-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; display: inline-block; border: 1px solid rgba(0,0,0,0.18); }
.zbf-matrix-empty { padding: 32px 16px; text-align: center; font-size: 13px; opacity: 0.72; }
.zbf-matrix-scroll { flex: 1 1 auto; overflow: auto; border: 1px solid light-dark(rgba(15,23,42,0.14), rgba(148,163,184,0.22)); border-radius: 8px; }
.zbf-matrix-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
.zbf-matrix-table th, .zbf-matrix-table td { border-bottom: 1px solid light-dark(rgba(15,23,42,0.1), rgba(148,163,184,0.16)); border-right: 1px solid light-dark(rgba(15,23,42,0.08), rgba(148,163,184,0.14)); padding: 7px 9px; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
.zbf-matrix-table th { position: sticky; top: 0; background: light-dark(#f8fafc, #0f172a); font-weight: 600; z-index: 1; }
.zbf-matrix-table tbody tr:hover td { background: light-dark(rgba(15,23,42,0.015), rgba(255,255,255,0.02)); }
.zbf-matrix-item-link { border: 0; padding: 0; background: transparent; color: light-dark(#2563eb, #60a5fa); font: inherit; font-weight: 600; text-align: left; cursor: pointer; }
.zbf-matrix-item-link:hover { text-decoration: underline; }
.zbf-matrix-ann { margin-bottom: 6px; padding: 4px 6px; border-radius: 4px; border-left: 3px solid transparent; background: light-dark(rgba(15,23,42,0.03), rgba(255,255,255,0.04)); cursor: pointer; transition: background-color 0.12s ease; }
.zbf-matrix-ann:hover { background: light-dark(rgba(37,99,235,0.09), rgba(96,165,250,0.15)); }
.zbf-matrix-ann:last-child { margin-bottom: 0; }
.zbf-matrix-mark { padding: 0 2px; border-radius: 2px; background: light-dark(#fef08a, rgba(250, 204, 21, 0.34)); color: inherit; font-weight: 600; }
.zbf-matrix-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.zbf-matrix-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.zbf-matrix-btn { padding: 5px 11px; border-radius: 6px; border: 1px solid light-dark(rgba(15,23,42,0.18), rgba(148,163,184,0.28)); background: light-dark(#f8fafc, #0f172a); color: inherit; font: 500 12px/1.2 inherit; cursor: pointer; }
.zbf-matrix-btn:hover { background: light-dark(#e2e8f0, #334155); }
.zbf-matrix-btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.zbf-matrix-btn.primary:hover { background: #1d4ed8; }
.zbf-matrix-status { font-size: 12px; opacity: 0.85; }
`;
  function matrixEl(doc, tag) {
    return doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
  }
  function ensureMatrixStyles(doc) {
    if (doc.getElementById(MATRIX_STYLE_ID)) return;
    const style = matrixEl(doc, "style");
    style.id = MATRIX_STYLE_ID;
    style.textContent = MATRIX_CSS;
    (doc.head || doc.documentElement)?.appendChild(style);
  }
  function writeMatrixClipboard(text2, clipboard) {
    if (clipboard?.writePayload("", text2, true)) return true;
    try {
      const cb = globalThis.Zotero?.Utilities?.Internal?.copyTextToClipboard;
      if (typeof cb === "function") {
        cb(text2);
        return true;
      }
    } catch {
    }
    return false;
  }
  function extractQueryTerms(rawQuery) {
    return String(rawQuery || "").split(/(?:\|\||&&)/).map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 2);
  }
  function renderHighlightedSnippet(doc, container, text2, terms) {
    if (!terms.length || !doc.createTextNode) {
      container.textContent = text2;
      return;
    }
    const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const re = new RegExp(`(${escaped.join("|")})`, "gi");
    let last = 0;
    for (const match of text2.matchAll(re)) {
      const idx = match.index ?? 0;
      if (idx > last) container.appendChild(doc.createTextNode(text2.slice(last, idx)));
      const mark = matrixEl(doc, "mark");
      mark.className = "zbf-matrix-mark";
      mark.textContent = match[0];
      container.appendChild(mark);
      last = idx + match[0].length;
    }
    if (last < text2.length) container.appendChild(doc.createTextNode(text2.slice(last)));
  }

  // src/domains/visual-notes/annotation-matrix-modal.ts
  function openAnnotationMatrixModal(options) {
    const doc = options.win.document;
    if (!doc) return;
    ensureMatrixStyles(doc);
    doc.getElementById("zbf-matrix-backdrop")?.remove();
    const hostItems = globalThis.Zotero?.Items;
    const items = [...new Set(options.itemIDs)].map((id) => hostItems?.get?.(id)).filter((it) => it && !it.deleted);
    const colorJson = options.prefs.get("inspector.annotations.colorLabels");
    const semantics = parseColorSemantics(colorJson);
    const colorByLabel = /* @__PURE__ */ new Map();
    for (const [hex, lbl] of Object.entries(semantics)) {
      if (!colorByLabel.has(lbl)) colorByLabel.set(lbl, hex);
    }
    const fullMatrix = buildAnnotationMatrix(items, colorJson);
    const countsByCol = /* @__PURE__ */ new Map();
    for (const col of fullMatrix.columns) {
      let total = 0;
      for (const r of fullMatrix.rows) total += (r.cells[col] || []).length;
      countsByCol.set(col, total);
    }
    const backdrop = matrixEl(doc, "div");
    backdrop.id = "zbf-matrix-backdrop";
    backdrop.className = "zbf-matrix-backdrop";
    const dialog = matrixEl(doc, "div");
    dialog.className = "zbf-matrix-dialog";
    const head = matrixEl(doc, "div");
    head.className = "zbf-matrix-head";
    const heading = matrixEl(doc, "div");
    heading.className = "zbf-matrix-title";
    heading.textContent = `文献对比矩阵 · ${options.title} (${items.length} 篇 / ${fullMatrix.totalAnnotations} 条标注)`;
    const closeBtn = matrixEl(doc, "button");
    closeBtn.type = "button";
    closeBtn.className = "zbf-matrix-close";
    closeBtn.textContent = "✕";
    head.append(heading, closeBtn);
    const controls = matrixEl(doc, "div");
    controls.className = "zbf-matrix-controls";
    const searchWrap = matrixEl(doc, "div");
    searchWrap.className = "zbf-matrix-search-wrap";
    const queryInput = matrixEl(doc, "input");
    queryInput.type = "text";
    queryInput.className = "zbf-matrix-input";
    queryInput.placeholder = "筛选标注（支持 方法 && 对照 或 局限 || 不足）...";
    const clearBtn = matrixEl(doc, "button");
    clearBtn.type = "button";
    clearBtn.className = "zbf-matrix-clear";
    clearBtn.textContent = "✕";
    clearBtn.title = "清空筛选条件";
    searchWrap.append(queryInput, clearBtn);
    controls.appendChild(searchWrap);
    let activeColor = "";
    const chipButtons = [];
    const addChip = (label, value, count2) => {
      const btn = matrixEl(doc, "button");
      btn.type = "button";
      btn.className = "zbf-matrix-chip";
      const dotHex = value ? colorByLabel.get(value) : "";
      if (dotHex) {
        const dot = matrixEl(doc, "span");
        dot.className = "zbf-matrix-dot";
        dot.style.background = dotHex;
        btn.appendChild(dot);
      }
      const txt = matrixEl(doc, "span");
      txt.textContent = count2 > 0 ? `${label} (${count2})` : label;
      btn.appendChild(txt);
      if (!value) btn.setAttribute("data-active", "true");
      btn.addEventListener("click", () => {
        activeColor = value;
        for (const b of chipButtons) b.removeAttribute("data-active");
        btn.setAttribute("data-active", "true");
        renderTable();
      });
      chipButtons.push(btn);
      controls.appendChild(btn);
    };
    addChip("全部维度", "", fullMatrix.totalAnnotations);
    for (const col of fullMatrix.columns) addChip(col, col, countsByCol.get(col) || 0);
    const scroll = matrixEl(doc, "div");
    scroll.className = "zbf-matrix-scroll";
    const statusEl = matrixEl(doc, "span");
    statusEl.className = "zbf-matrix-status";
    const selectedIDs = new Set(items.map((it) => Number(it.id)));
    let currentMatrix = fullMatrix;
    const updateStatus = () => {
      const visibleSelected = currentMatrix.rows.filter((r) => selectedIDs.has(r.itemID)).length;
      statusEl.textContent = `当前显示 ${currentMatrix.rows.length} 篇 / ${currentMatrix.totalAnnotations} 条标注 · 已勾选 ${visibleSelected} 篇`;
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault?.();
        close();
      }
    };
    const close = () => {
      doc.removeEventListener?.("keydown", onKey, true);
      backdrop.remove();
    };
    const renderTable = () => {
      clearBtn.style.display = queryInput.value ? "inline-flex" : "none";
      currentMatrix = buildAnnotationMatrix(items, colorJson, { query: queryInput.value, colorLabel: activeColor });
      scroll.textContent = "";
      updateStatus();
      if (!currentMatrix.rows.length || !currentMatrix.columns.length) {
        const empty = matrixEl(doc, "div");
        empty.className = "zbf-matrix-empty";
        empty.textContent = items.length ? "当前筛选条件下没有匹配的标注，请尝试调整关键词或颜色维度。" : "未检测到可对比的文献。请先在阅读器中打开文献，或在主文库选中多篇带标注的文献后重试。";
        scroll.appendChild(empty);
        return;
      }
      const terms = extractQueryTerms(queryInput.value);
      const table = matrixEl(doc, "table");
      table.className = "zbf-matrix-table";
      const thead = matrixEl(doc, "thead");
      const trHead = matrixEl(doc, "tr");
      const firstTh = matrixEl(doc, "th");
      firstTh.style.width = "220px";
      const allCb = matrixEl(doc, "input");
      allCb.type = "checkbox";
      const syncAllCheckbox = () => {
        const total = currentMatrix.rows.length;
        const checkedCount = currentMatrix.rows.filter((r) => selectedIDs.has(r.itemID)).length;
        allCb.checked = total > 0 && checkedCount === total;
        allCb.indeterminate = checkedCount > 0 && checkedCount < total;
      };
      syncAllCheckbox();
      allCb.style.marginRight = "6px";
      allCb.title = "全选 / 取消当前列表文献";
      const rowCbs = [];
      allCb.addEventListener("change", () => {
        allCb.indeterminate = false;
        for (const r of currentMatrix.rows) {
          if (allCb.checked) selectedIDs.add(r.itemID);
          else selectedIDs.delete(r.itemID);
        }
        for (const cb of rowCbs) cb.checked = allCb.checked;
        updateStatus();
      });
      const headTitle = matrixEl(doc, "span");
      headTitle.textContent = `文献 (${currentMatrix.rows.length})`;
      firstTh.append(allCb, headTitle);
      trHead.appendChild(firstTh);
      for (const col of currentMatrix.columns) {
        const th = matrixEl(doc, "th");
        const dotHex = colorByLabel.get(col);
        if (dotHex) {
          const dot = matrixEl(doc, "span");
          dot.className = "zbf-matrix-dot";
          dot.style.background = dotHex;
          dot.style.marginRight = "5px";
          th.appendChild(dot);
        }
        const lbl = matrixEl(doc, "span");
        lbl.textContent = col;
        th.appendChild(lbl);
        trHead.appendChild(th);
      }
      thead.appendChild(trHead);
      table.appendChild(thead);
      const tbody = matrixEl(doc, "tbody");
      for (const row of currentMatrix.rows) {
        const tr = matrixEl(doc, "tr");
        const tdTitle = matrixEl(doc, "td");
        const cb = matrixEl(doc, "input");
        cb.type = "checkbox";
        cb.checked = selectedIDs.has(row.itemID);
        cb.style.marginRight = "6px";
        rowCbs.push(cb);
        cb.addEventListener("change", () => {
          if (cb.checked) selectedIDs.add(row.itemID);
          else selectedIDs.delete(row.itemID);
          syncAllCheckbox();
          updateStatus();
        });
        const link = matrixEl(doc, "button");
        link.type = "button";
        link.className = "zbf-matrix-item-link";
        link.textContent = row.title;
        link.title = "打开并聚焦此文献阅读器";
        link.addEventListener("click", () => {
          close();
          options.bus?.emit("workspace:open-item-request", { itemID: row.itemID, preferExistingTab: true });
        });
        tdTitle.append(cb, link);
        if (row.creatorYear) {
          const sub = matrixEl(doc, "div");
          sub.style.opacity = "0.72";
          sub.style.fontSize = "11px";
          sub.textContent = row.creatorYear;
          tdTitle.appendChild(sub);
        }
        tr.appendChild(tdTitle);
        for (const col of currentMatrix.columns) {
          const td = matrixEl(doc, "td");
          const colColor = colorByLabel.get(col) || "";
          for (const ann of row.cells[col] || []) {
            const block = matrixEl(doc, "div");
            block.className = "zbf-matrix-ann";
            if (colColor) block.style.borderLeftColor = colColor;
            const page = ann.pageLabel ? `[p.${ann.pageLabel}] ` : "";
            const snippet = ann.comment && ann.text ? `${page}${ann.text}（评注：${ann.comment}）` : `${page}${ann.comment || ann.text}`;
            renderHighlightedSnippet(doc, block, snippet, terms);
            block.title = "点击复制此条标注内容";
            block.addEventListener("click", () => {
              statusEl.textContent = writeMatrixClipboard(snippet, options.clipboard) ? "✓ 已复制单条标注内容" : "✕ 复制失败";
            });
            td.appendChild(block);
          }
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      scroll.appendChild(table);
    };
    clearBtn.addEventListener("click", () => {
      queryInput.value = "";
      renderTable();
      queryInput.focus?.();
    });
    queryInput.addEventListener("input", renderTable);
    renderTable();
    const foot = matrixEl(doc, "div");
    foot.className = "zbf-matrix-foot";
    const actions = matrixEl(doc, "div");
    actions.className = "zbf-matrix-actions";
    const mkBtn = (label, primary, onClick) => {
      const b = matrixEl(doc, "button");
      b.type = "button";
      b.className = primary ? "zbf-matrix-btn primary" : "zbf-matrix-btn";
      b.textContent = label;
      b.addEventListener("click", onClick);
      actions.appendChild(b);
    };
    mkBtn("存为 Zotero 笔记", true, () => {
      void saveMatrixAsZoteroNote(currentMatrix, `文献对比矩阵 · ${options.title}`).then((id) => {
        statusEl.textContent = id ? `✓ 已生成笔记 (#${id})` : "✕ 生成笔记失败";
      });
    });
    mkBtn("复制 Markdown", false, () => {
      statusEl.textContent = writeMatrixClipboard(renderMatrixMarkdown(currentMatrix, options.title), options.clipboard) ? "✓ 已复制 Markdown 表格" : "✕ 复制失败";
    });
    mkBtn("复制 CSV", false, () => {
      statusEl.textContent = writeMatrixClipboard(renderMatrixCsv(currentMatrix), options.clipboard) ? "✓ 已复制 CSV" : "✕ 复制失败";
    });
    if (options.clipboard) {
      mkBtn("复制勾选 CSL 引文", false, () => {
        const targets = currentMatrix.rows.filter((r) => selectedIDs.has(r.itemID)).map((r) => hostItems?.get?.(r.itemID)).filter(Boolean);
        if (!targets.length) {
          statusEl.textContent = "请先勾选至少一篇文献";
          return;
        }
        void options.clipboard?.copyItems(targets, { source: "tab-menu" }).then((ok) => {
          statusEl.textContent = ok ? `✓ 已复制 ${targets.length} 篇 CSL 引文并记入反查历史` : "✕ 复制引文失败";
        });
      });
    }
    if (options.bus && options.prefs.get("modules.wordCite.enable")) {
      mkBtn("合并插入 Word", false, () => {
        const ids = currentMatrix.rows.filter((r) => selectedIDs.has(r.itemID)).map((r) => r.itemID);
        if (!ids.length) {
          statusEl.textContent = "请先勾选至少一篇文献";
          return;
        }
        options.bus?.emit("word:insert-items-request", { itemIDs: ids, win: options.win });
        statusEl.textContent = `✓ 已发送 ${ids.length} 篇文献到 Word`;
      });
    }
    foot.append(statusEl, actions);
    dialog.append(head, controls, scroll, foot);
    backdrop.appendChild(dialog);
    doc.addEventListener?.("keydown", onKey, true);
    closeBtn.addEventListener("click", close);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });
    (doc.body || doc.documentElement)?.appendChild(backdrop);
    queryInput.focus?.();
  }

  // src/domains/visual-notes/annotation-popup-labels.ts
  var STYLE_ID3 = "zbf-reader-color-labels-style";
  var LABEL_CLASS = "zbf-popup-color-name";
  var COLOR_KEYS = Object.keys(DEFAULT_ANNOTATION_COLORS);
  var POPUP_CSS = `
.selection-popup, .annotation-popup { max-width: 480px !important; }
.selection-popup .colors, .annotation-popup .colors { flex-wrap: wrap !important; justify-content: flex-start !important; gap: 5px 10px !important; }
.selection-popup .colors .color-button, .annotation-popup .colors .color-button {
  width: auto !important; min-width: 20px; height: 22px !important;
  padding: 2px 6px !important; display: inline-flex !important;
  align-items: center !important; gap: 5px !important; border-radius: 5px !important;
  transition: background-color 0.12s ease !important;
}
.selection-popup .colors .color-button svg, .annotation-popup .colors .color-button svg { flex: none; }
.${LABEL_CLASS} {
  font-size: 12px; line-height: 1.2; color: var(--fill-primary, currentColor);
  white-space: nowrap; max-width: 110px; overflow: hidden; text-overflow: ellipsis; pointer-events: none;
}
`;
  function rgbToHex(raw) {
    const m = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (!m) return "";
    const toHex = (n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0");
    return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`;
  }
  function resolvePopupButtonColor(btn, index) {
    const fillNode = btn.querySelector?.('path[fill]:not([fill="none"]), rect[fill]:not([fill="none"]), circle[fill]:not([fill="none"])');
    const fillAttr = String(fillNode?.getAttribute?.("fill") || "").trim();
    if (fillAttr) {
      return fillAttr.startsWith("rgb") ? rgbToHex(fillAttr) : normalizeHexColor(fillAttr);
    }
    const bg = String(btn.style?.backgroundColor || "").trim();
    if (bg.startsWith("#")) return normalizeHexColor(bg);
    if (bg.startsWith("rgb")) return rgbToHex(bg);
    return COLOR_KEYS[index] || "";
  }
  function decorateSelectionPopupDoc(readerDoc, semantics) {
    const buttons = readerDoc.querySelectorAll?.(".selection-popup .colors .color-button, .annotation-popup .colors .color-button");
    if (!buttons || !buttons.length) return 0;
    let updated = 0;
    buttons.forEach((btn, index) => {
      const hex = resolvePopupButtonColor(btn, index);
      const label = hex && semantics[hex] || "";
      let span = btn.querySelector?.(`.${LABEL_CLASS}`);
      if (!label) {
        span?.remove?.();
        return;
      }
      if (!span) {
        const htmlNs = "http://www.w3.org/1999/xhtml";
        span = typeof readerDoc.createElementNS === "function" ? readerDoc.createElementNS(htmlNs, "span") : readerDoc.createElement("span");
        span.className = LABEL_CLASS;
        btn.appendChild(span);
      }
      if (span.textContent !== label) span.textContent = label;
      btn.setAttribute("title", label);
      updated += 1;
    });
    return updated;
  }
  function clearSelectionPopupDoc(readerDoc) {
    readerDoc.getElementById?.(STYLE_ID3)?.remove?.();
    readerDoc.querySelectorAll?.(`.${LABEL_CLASS}`).forEach((el) => el.remove?.());
  }
  var ReaderPopupLabelsController = class {
    kernel;
    attachedDocs = /* @__PURE__ */ new Map();
    pendingReaders = /* @__PURE__ */ new Set();
    notifierSub = null;
    active = false;
    constructor(kernel) {
      this.kernel = kernel;
    }
    isEnabled() {
      return Boolean(this.kernel.prefs.get("inspector.annotations.popupLabelsEnable"));
    }
    getSemantics() {
      return parseColorSemantics(String(this.kernel.prefs.get("inspector.annotations.colorLabels") || ""));
    }
    start() {
      if (this.active) return;
      this.active = true;
      this.sync();
      this.notifierSub = this.kernel.notifier?.subscribe?.(["tab"], ({ event }) => {
        if (!this.active || !this.isEnabled()) return;
        if (event === "add" || event === "select" || event === "open") {
          this.scanOpenReaders();
        } else if (event === "close") {
          this.pruneClosedDocs();
        }
      }) ?? null;
    }
    stop() {
      this.active = false;
      this.notifierSub?.();
      this.notifierSub = null;
      this.pendingReaders.clear();
      for (const dispose of [...this.attachedDocs.values()]) dispose();
      this.attachedDocs.clear();
    }
    sync() {
      if (!this.active) return;
      if (!this.isEnabled()) {
        for (const dispose of [...this.attachedDocs.values()]) dispose();
        this.attachedDocs.clear();
        this.pendingReaders.clear();
        return;
      }
      this.scanOpenReaders();
      const sem = this.getSemantics();
      for (const doc of this.attachedDocs.keys()) {
        decorateSelectionPopupDoc(doc, sem);
      }
    }
    attachReaderDoc(readerDoc) {
      if (!this.active || !this.isEnabled() || !readerDoc || this.attachedDocs.has(readerDoc)) return;
      const headOrRoot = readerDoc.head || readerDoc.documentElement;
      if (headOrRoot && !readerDoc.getElementById?.(STYLE_ID3)) {
        const htmlNs = "http://www.w3.org/1999/xhtml";
        const styleEl = typeof readerDoc.createElementNS === "function" ? readerDoc.createElementNS(htmlNs, "style") : readerDoc.createElement("style");
        styleEl.id = STYLE_ID3;
        styleEl.textContent = POPUP_CSS;
        headOrRoot.appendChild(styleEl);
      }
      const apply = () => decorateSelectionPopupDoc(readerDoc, this.getSemantics());
      apply();
      const Obs = readerDoc.defaultView?.MutationObserver || globalThis.MutationObserver;
      const target = readerDoc.body || readerDoc.documentElement;
      let observer = null;
      let applyQueued = false;
      if (Obs && target) {
        const isPopupMutation = (records) => {
          try {
            for (let r = 0; r < records.length; r++) {
              const rec = records[r];
              const t = rec?.target;
              if (t && t.nodeType === 1 && t.closest?.(".selection-popup, .annotation-popup")) return true;
              const added = rec?.addedNodes;
              if (added) {
                for (let i = 0; i < added.length; i++) {
                  const el = added[i];
                  if (el && el.nodeType === 1 && (el.matches?.(".selection-popup, .annotation-popup") || el.querySelector?.(".selection-popup, .annotation-popup"))) {
                    return true;
                  }
                }
              }
            }
            return false;
          } catch {
            return true;
          }
        };
        const obs = new Obs((records) => {
          if (!isPopupMutation(records) || applyQueued) return;
          applyQueued = true;
          void Promise.resolve().then(() => {
            applyQueued = false;
            if (this.active && this.isEnabled() && this.attachedDocs.has(readerDoc)) apply();
          });
        });
        obs.observe(target, { childList: true, subtree: true });
        observer = obs;
      }
      this.attachedDocs.set(readerDoc, () => {
        observer?.disconnect();
        clearSelectionPopupDoc(readerDoc);
      });
    }
    scanOpenReaders() {
      const readers = globalThis.Zotero?.Reader?._readers || [];
      for (const reader of readers) {
        if (!reader || reader._isTabClosed || reader._isUninitialized) continue;
        const doc = reader._iframeWindow?.document;
        if (doc?.body) {
          this.attachReaderDoc(doc);
        } else if (!this.pendingReaders.has(reader)) {
          this.pendingReaders.add(reader);
          const waitReady = reader._waitForReader?.() ?? reader._initPromise ?? Promise.resolve();
          void Promise.resolve(waitReady).then(() => {
            this.pendingReaders.delete(reader);
            if (this.active && this.isEnabled() && !reader._isTabClosed) {
              const readyDoc = reader._iframeWindow?.document;
              if (readyDoc?.body) this.attachReaderDoc(readyDoc);
            }
          }).catch(() => {
            this.pendingReaders.delete(reader);
          });
        }
      }
    }
    pruneClosedDocs() {
      for (const [doc, dispose] of [...this.attachedDocs.entries()]) {
        if (!doc.defaultView || doc.defaultView.closed) {
          this.attachedDocs.delete(doc);
          dispose();
        }
      }
    }
  };

  // src/domains/visual-notes/annotation-tools.ts
  var ReaderAnnotationTools = class {
    unregisterListener = null;
    kernel;
    popupLabels;
    constructor(kernel) {
      this.kernel = kernel;
      this.popupLabels = new ReaderPopupLabelsController(kernel);
    }
    register() {
      this.popupLabels.start();
      if (this.unregisterListener) return;
      const readerApi = globalThis.Zotero?.Reader;
      if (typeof readerApi?.registerEventListener !== "function") return;
      const listener = (event) => {
        if (!this.kernel.prefs.get("inspector.annotations.mergeEnable")) return;
        const ids = Array.isArray(event?.params?.ids) ? event.params.ids.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0) : [];
        if (ids.length < 2 || typeof event?.append !== "function") return;
        const zh = Boolean(globalThis.Zotero?.locale?.startsWith?.("zh"));
        event.append({
          label: zh ? `合并选中的 ${ids.length} 条标注` : `Merge ${ids.length} Selected Annotations`,
          onCommand: () => {
            void mergeAnnotationsByIDs(ids).then((res) => {
              try {
                const PW = globalThis.Zotero?.ProgressWindow;
                if (typeof PW !== "function") return;
                const win = new PW({ closeOnClick: true });
                win.changeHeadline(zh ? "BridgeFlow 批注合并" : "BridgeFlow Annotation Merge");
                win.addDescription(res.ok ? zh ? `已合并 ${ids.length} 条标注为 1 条` : `Merged ${ids.length} annotations` : zh ? "无法合并所选批注（请确认属于同一有效附件）" : "Unable to merge selected annotations");
                win.show();
                win.startCloseTimer(2600);
              } catch {
              }
            });
          }
        });
      };
      try {
        readerApi.registerEventListener("createAnnotationContextMenu", listener, this.kernel.info.id);
        this.unregisterListener = () => {
          try {
            readerApi.unregisterEventListener?.("createAnnotationContextMenu", listener);
          } catch {
          }
        };
      } catch {
        this.unregisterListener = null;
      }
    }
    unregister() {
      this.popupLabels.stop();
      this.unregisterListener?.();
      this.unregisterListener = null;
    }
    mergeByIDs(ids) {
      return mergeAnnotationsByIDs(ids);
    }
  };

  // src/domains/visual-notes/data-source.ts
  function resolveParentItemID(item) {
    if (!item) return 0;
    if (item.isAttachment?.() && item.parentItemID) return Number(item.parentItemID) || 0;
    return Number(item.id || 0);
  }
  function readItemRemarkWithFallback(item, dataSource) {
    if (!item) return "";
    const id = Number(item.id || 0);
    if (id > 0 && dataSource) {
      const cached = dataSource.getRemark(id);
      if (cached) return cached;
    }
    const parentID = resolveParentItemID(item);
    if (parentID > 0 && parentID !== id && dataSource) {
      const parentCached = dataSource.getRemark(parentID);
      if (parentCached) return parentCached;
    }
    const attIDs = typeof item.getAttachments === "function" ? item.getAttachments() || [] : [];
    if (dataSource) {
      for (const attID of attIDs) {
        const attCached = dataSource.getRemark(attID);
        if (attCached) return attCached;
      }
    }
    const hostItems = globalThis.Zotero?.Items;
    const targetItem = parentID > 0 && parentID !== id ? hostItems?.get?.(parentID) || item : item;
    return getItemBriefNote(targetItem);
  }
  function writeItemRemarkWithSync(item, remark, syncToExtra, dataSource) {
    if (!item) return;
    const clean = String(remark || "").replace(/[\r\n]+/g, " ").trim();
    const id = Number(item.id || 0);
    const parentID = resolveParentItemID(item);
    if (dataSource) {
      if (id > 0) dataSource.setRemark(id, clean);
      if (parentID > 0 && parentID !== id) dataSource.setRemark(parentID, clean);
    }
    if (syncToExtra) {
      const targetID = parentID > 0 ? parentID : id;
      if (targetID > 0) void syncItemRemarkToExtra(targetID, clean);
    }
  }

  // src/domains/visual-notes/info-brief-note.ts
  var InfoBriefNoteController = class {
    kernel;
    dataSource;
    registeredRowID = "";
    onUpdated;
    constructor(kernel, onUpdated) {
      this.kernel = kernel;
      this.onUpdated = onUpdated;
    }
    setDataSource(source) {
      this.dataSource = source;
    }
    register() {
      if (this.registeredRowID) return true;
      const manager = globalThis.Zotero?.ItemPaneManager;
      if (typeof manager?.registerInfoRow !== "function") return false;
      try {
        const rowID = manager.registerInfoRow({
          rowID: "bridgeflow-brief-note",
          pluginID: this.kernel.info.id,
          label: { l10nID: "zbf-info-brief-note-label" },
          position: "start",
          multiline: true,
          nowrap: false,
          editable: true,
          onGetData: ({ item }) => readItemRemarkWithFallback(item, this.dataSource),
          onSetData: ({ item, value }) => {
            if (!item) return;
            const syncExtra = Boolean(this.kernel.prefs.get("workspace.syncRemarkToExtra"));
            writeItemRemarkWithSync(item, String(value ?? ""), syncExtra, this.dataSource);
            this.refresh();
            this.onUpdated();
          },
          onItemChange: ({ item, setEnabled, setEditable }) => {
            const valid = Boolean(item && !item.deleted && (item.isRegularItem?.() || item.isAttachment?.()));
            setEnabled?.(valid);
            setEditable?.(Boolean(valid && (item?.editable ?? true)));
          }
        });
        if (typeof rowID === "string" && rowID) {
          this.registeredRowID = rowID;
          return true;
        }
      } catch {
      }
      return false;
    }
    unregister() {
      if (!this.registeredRowID) return;
      const id = this.registeredRowID;
      this.registeredRowID = "";
      try {
        globalThis.Zotero?.ItemPaneManager?.unregisterInfoRow?.(id);
      } catch {
      }
    }
    refresh() {
      if (!this.registeredRowID) return;
      try {
        globalThis.Zotero?.ItemPaneManager?.refreshInfoRow?.(this.registeredRowID);
      } catch {
      }
    }
  };

  // src/services/reading-stats.ts
  function mergePageSeconds(prevMap, lastPage, deltaSeconds) {
    const next = prevMap ? { ...prevMap } : {};
    if (lastPage && lastPage > 0 && deltaSeconds > 0) {
      const pageKey = String(Math.floor(lastPage));
      next[pageKey] = Math.max(0, (next[pageKey] || 0) + deltaSeconds);
    }
    return Object.keys(next).length ? next : void 0;
  }
  function buildReadingHeatmapBuckets(progress2, bucketCount = 16) {
    const pageSec = progress2?.pageSeconds;
    if (!pageSec || !Object.keys(pageSec).length) return [];
    const pages = Object.keys(pageSec).map((p) => Number(p)).filter((p) => Number.isFinite(p) && p > 0);
    if (!pages.length) return [];
    const maxPage = Math.max(Number(progress2?.totalPages || 0), ...pages);
    if (maxPage <= 0) return [];
    const bins = Array.from({ length: bucketCount }, () => 0);
    for (const p of pages) {
      const sec = pageSec[String(p)] || 0;
      const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((p - 1) / maxPage * bucketCount)));
      bins[idx] += sec;
    }
    const peak = Math.max(...bins, 1);
    return bins.map((v) => Math.round(v / peak * 100) / 100);
  }
  function formatReadingDuration(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    if (total < 60) return "";
    const mins = Math.floor(total / 60);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem ? `${hrs}h${rem}m` : `${hrs}h`;
  }
  function formatReadingProgress(prog) {
    if (!prog) return { text: "", ratio: null };
    const dur = formatReadingDuration(prog.readSeconds);
    const page = Number(prog.lastPage) || 0;
    const total = Number(prog.totalPages) || 0;
    const pageText = page > 0 ? total > 0 ? `p.${page}/${total}` : `p.${page}` : "";
    const text2 = [dur, pageText].filter(Boolean).join(" · ");
    const ratio = page > 0 && total > 0 ? Math.max(0, Math.min(1, page / total)) : null;
    return { text: text2, ratio };
  }

  // src/domains/visual-notes/library-columns.ts
  function makeSourceFromStore(store) {
    if (!store) return void 0;
    return {
      getReadingProgress: (id) => store.state.readingProgress?.[`item:${id}`],
      getRemark: (id) => store.state.remarks?.[`item:${id}`] || "",
      setRemark: () => {
      }
    };
  }
  function registerTreeColumn(registeredKeys, descriptor, isActive) {
    const manager = globalThis.Zotero?.ItemTreeManager;
    const regFn = manager?.registerColumns || manager?.registerColumn;
    if (typeof regFn !== "function") return false;
    try {
      const res = regFn.call(manager, descriptor);
      const recordKey = (val) => {
        for (const k of Array.isArray(val) ? val : [val]) {
          if (typeof k === "string" && k) registeredKeys.add(k);
        }
        if (!isActive() && registeredKeys.size) flushUnregisterColumns(registeredKeys);
      };
      if (res && typeof res.then === "function") {
        void res.then(recordKey).catch(() => {
        });
      } else {
        recordKey(res);
      }
      return true;
    } catch {
      return false;
    }
  }
  function flushUnregisterColumns(registeredKeys) {
    if (!registeredKeys.size) return;
    const keys2 = [...registeredKeys];
    registeredKeys.clear();
    const manager = globalThis.Zotero?.ItemTreeManager;
    try {
      if (typeof manager?.unregisterColumns === "function") {
        void Promise.resolve(manager.unregisterColumns(keys2)).catch(() => {
        });
      } else if (typeof manager?.unregisterColumn === "function") {
        for (const k of keys2) void Promise.resolve(manager.unregisterColumn(k)).catch(() => {
        });
      }
    } catch {
    }
  }
  var RemarkColumnController = class {
    registeredKeys = /* @__PURE__ */ new Set();
    active = false;
    kernel;
    dataSource;
    constructor(kernel, storeOrSource) {
      this.kernel = kernel;
      this.dataSource = storeOrSource && "getRemark" in storeOrSource ? storeOrSource : makeSourceFromStore(storeOrSource);
    }
    setDataSource(source) {
      this.dataSource = source;
    }
    getDisplayForItem(item) {
      return readItemRemarkWithFallback(item, this.dataSource);
    }
    register() {
      if (this.active) return;
      this.active = true;
      const zh = Boolean(globalThis.Zotero?.locale?.startsWith?.("zh"));
      registerTreeColumn(this.registeredKeys, {
        dataKey: "bridgeflowRemark",
        label: zh ? "简记" : "Brief Note",
        enabledTreeIDs: ["main"],
        zoteroPersist: ["width", "hidden", "sortDirection"],
        pluginID: this.kernel.info.id,
        dataProvider: (item) => this.getDisplayForItem(item)
      }, () => this.active);
    }
    unregister() {
      this.active = false;
      flushUnregisterColumns(this.registeredKeys);
    }
    refresh() {
      if (!this.active) return;
      try {
        globalThis.Zotero?.ItemTreeManager?.refreshColumns?.();
      } catch {
      }
    }
  };
  var ReadingColumnsController = class {
    registeredKeys = /* @__PURE__ */ new Set();
    activeReadTime = false;
    activeAnnotations = false;
    kernel;
    dataSource;
    cachedColorRaw = "";
    cachedSemantics = parseColorSemantics(void 0);
    constructor(kernel, storeOrSource) {
      this.kernel = kernel;
      this.dataSource = storeOrSource && "getReadingProgress" in storeOrSource ? storeOrSource : makeSourceFromStore(storeOrSource);
    }
    setDataSource(source) {
      this.dataSource = source;
    }
    syncColumns() {
      const wantRead = Boolean(this.kernel.prefs.get("workspace.readingColumn.enable"));
      const wantAnn = Boolean(this.kernel.prefs.get("workspace.annotationColumn.enable"));
      if (wantRead !== this.activeReadTime || wantAnn !== this.activeAnnotations) {
        this.unregisterAll();
        if (wantRead) this.registerReadTimeColumn();
        if (wantAnn) this.registerAnnotationColumn();
      }
    }
    unregisterAll() {
      this.activeReadTime = false;
      this.activeAnnotations = false;
      flushUnregisterColumns(this.registeredKeys);
    }
    refreshColumns() {
      if (!this.activeReadTime && !this.activeAnnotations) return;
      try {
        globalThis.Zotero?.ItemTreeManager?.refreshColumns?.();
      } catch {
      }
    }
    getReadProgressForItem(item) {
      if (!item || !this.dataSource) return void 0;
      const id = Number(item.id || 0);
      if (id > 0) {
        const direct = this.dataSource.getReadingProgress(id);
        if (direct) return direct;
      }
      const attIDs = typeof item.getAttachments === "function" ? item.getAttachments() || [] : [];
      let best;
      for (const attID of attIDs) {
        const prog = this.dataSource.getReadingProgress(attID);
        if (!prog) continue;
        const hasPages = Boolean(prog.pageSeconds && Object.keys(prog.pageSeconds).length);
        const bestHasPages = Boolean(best?.pageSeconds && Object.keys(best.pageSeconds).length);
        if (!best || hasPages && !bestHasPages || hasPages === bestHasPages && prog.readSeconds > best.readSeconds) {
          best = prog;
        }
      }
      return best;
    }
    getReadTimeDisplay(item) {
      return formatReadingProgress(this.getReadProgressForItem(item)).text;
    }
    getAnnotationSummaryDisplay(item) {
      if (!item) return "";
      const rawColor = String(this.kernel.prefs.get("inspector.annotations.colorLabels") || "");
      if (rawColor !== this.cachedColorRaw) {
        this.cachedColorRaw = rawColor;
        this.cachedSemantics = parseColorSemantics(rawColor);
      }
      const collected = collectItemAnnotations([item], this.cachedSemantics);
      if (!collected.length) return "";
      const counts = /* @__PURE__ */ new Map();
      for (const a of collected) {
        counts.set(a.colorLabel, (counts.get(a.colorLabel) || 0) + 1);
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([lbl, n]) => `${lbl}:${n}`).join(" ");
      return `${collected.length} (${top})`;
    }
    registerReadTimeColumn() {
      const zh = Boolean(globalThis.Zotero?.locale?.startsWith?.("zh"));
      this.activeReadTime = registerTreeColumn(this.registeredKeys, {
        dataKey: "bridgeflowReadTime",
        label: zh ? "阅读时长" : "Read Time",
        enabledTreeIDs: ["main"],
        zoteroPersist: ["width", "hidden", "sortDirection"],
        pluginID: this.kernel.info.id,
        dataProvider: (item) => this.getReadTimeDisplay(item)
      }, () => this.activeReadTime);
    }
    registerAnnotationColumn() {
      const zh = Boolean(globalThis.Zotero?.locale?.startsWith?.("zh"));
      this.activeAnnotations = registerTreeColumn(this.registeredKeys, {
        dataKey: "bridgeflowAnnotations",
        label: zh ? "标注分布" : "Annotations",
        enabledTreeIDs: ["main"],
        zoteroPersist: ["width", "hidden", "sortDirection"],
        pluginID: this.kernel.info.id,
        dataProvider: (item) => this.getAnnotationSummaryDisplay(item)
      }, () => this.activeAnnotations);
    }
  };

  // src/domains/visual-notes/title-heatmap.ts
  var DEFAULT_RGB = "13, 148, 136";
  var HEATMAP_STYLE_ID = "zbf-title-heatmap-style";
  var HEATMAP_CSS = `
.virtualized-table .cell-text[data-zbf-heatmap="1"] {
  border-radius: 3px; background-repeat: no-repeat; box-decoration-break: clone;
}
.virtualized-table:focus-within .row.selected .cell-text[data-zbf-heatmap="1"] {
  --zbf-heat-rgb: 255, 255, 255 !important;
}
`;
  function hexToRgbTuple(hex) {
    const raw = String(hex || "").trim().replace(/^#/, "");
    let full = raw;
    if (/^[0-9a-f]{3}$/i.test(raw)) {
      full = `${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
    }
    if (!/^[0-9a-f]{6}$/i.test(full)) return DEFAULT_RGB;
    const r = Number.parseInt(full.slice(0, 2), 16);
    const g = Number.parseInt(full.slice(2, 4), 16);
    const b = Number.parseInt(full.slice(4, 6), 16);
    return `${r}, ${g}, ${b}`;
  }
  function formatStopPct(idx, total) {
    return `${(idx / total * 100).toFixed(2)}%`;
  }
  function buildTitleHeatmapGradient(progress2, options = {}) {
    const rawTotal = Number(progress2?.totalPages || 0);
    const bucketCount = options.bucketCount ?? (rawTotal > 0 && rawTotal < 16 ? rawTotal : 16);
    const buckets = buildReadingHeatmapBuckets(progress2, bucketCount);
    if (!buckets.length || !buckets.some((v) => v > 0)) return "";
    const rgb = hexToRgbTuple(options.color);
    const maxPct = Number(options.opacityPercent);
    const maxAlpha = Number.isFinite(maxPct) ? Math.max(0.1, Math.min(0.9, maxPct / 100)) : 0.42;
    const minAlpha = Math.max(0.05, maxAlpha * 0.34);
    const stops = [];
    const total = buckets.length;
    let i = 0;
    while (i < total) {
      const ratio = buckets[i];
      let end = i + 1;
      while (end < total && buckets[end] === ratio) end += 1;
      const color = ratio > 0 ? `rgba(var(--zbf-heat-rgb, ${rgb}), ${(minAlpha + ratio * (maxAlpha - minAlpha)).toFixed(3)})` : "transparent";
      stops.push(`${color} ${formatStopPct(i, total)}`, `${color} ${formatStopPct(end, total)}`);
      i = end;
    }
    return `linear-gradient(to right, ${stops.join(", ")})`;
  }
  function findCellText(cell) {
    if (!cell) return null;
    if (cell.classList?.contains?.("cell-text")) return cell;
    return cell.querySelector?.(".cell-text") ?? null;
  }
  function clearTitleHeatmapFromCell(cell) {
    const textEl = findCellText(cell);
    if (!textEl) return;
    if (typeof textEl.style?.removeProperty === "function") {
      textEl.style.removeProperty("background-image");
      textEl.style.removeProperty("--zbf-heat-rgb");
    } else if (textEl.style) {
      textEl.style.backgroundImage = "";
    }
    textEl.removeAttribute?.("data-zbf-heatmap");
  }
  function applyTitleHeatmapToCell(cell, progress2, options = {}) {
    const textEl = findCellText(cell);
    if (!textEl) return false;
    const gradient = buildTitleHeatmapGradient(progress2, options);
    if (!gradient) {
      clearTitleHeatmapFromCell(textEl);
      return false;
    }
    if (textEl.style) {
      textEl.style.backgroundImage = gradient;
    }
    textEl.setAttribute?.("data-zbf-heatmap", "1");
    return true;
  }
  var TitleHeatmapController = class {
    kernel;
    resolveProgress;
    windows = /* @__PURE__ */ new Set();
    disposers = /* @__PURE__ */ new Map();
    pollTimers = /* @__PURE__ */ new Map();
    constructor(kernel, resolveProgress) {
      this.kernel = kernel;
      this.resolveProgress = resolveProgress;
    }
    isEnabled() {
      return Boolean(
        this.kernel.prefs.get("modules.visualNotes.enable") && this.kernel.prefs.get("workspace.readingTitleHeatmap.enable")
      );
    }
    getOptions() {
      return {
        color: String(this.kernel.prefs.get("workspace.readingHeatmap.color") || "#0d9488"),
        opacityPercent: Number(this.kernel.prefs.get("workspace.readingHeatmap.opacity") || 42)
      };
    }
    attachWindow(win) {
      if (!win) return;
      this.windows.add(win);
      if (!this.isEnabled() || this.disposers.has(win) || this.pollTimers.has(win)) return;
      this.tryPatchWindow(win, 0);
    }
    detachWindow(win) {
      this.windows.delete(win);
      this.clearWindowPatch(win);
    }
    sync(knownWindows) {
      if (knownWindows) {
        for (const win of knownWindows) this.windows.add(win);
      }
      if (this.isEnabled()) {
        for (const win of this.windows) {
          if (!this.disposers.has(win) && !this.pollTimers.has(win)) {
            this.tryPatchWindow(win, 0);
          }
        }
        this.refreshWindows();
      } else {
        for (const win of [...this.windows]) {
          this.clearWindowPatch(win);
        }
      }
    }
    refreshWindows() {
      for (const win of this.windows) {
        try {
          win?.ZoteroPane?.itemsView?.tree?.invalidate?.();
        } catch {
        }
      }
    }
    disposeAll() {
      for (const win of [...this.windows]) {
        this.clearWindowPatch(win);
      }
      this.windows.clear();
    }
    clearWindowPatch(win) {
      const timer = this.pollTimers.get(win);
      if (timer !== void 0) {
        clearTimeout(timer);
        this.pollTimers.delete(win);
      }
      try {
        win.document?.getElementById?.(HEATMAP_STYLE_ID)?.remove?.();
      } catch {
      }
      const dispose = this.disposers.get(win);
      if (dispose) {
        this.disposers.delete(win);
        try {
          dispose();
        } catch {
        }
        try {
          win?.ZoteroPane?.itemsView?.tree?.invalidate?.();
        } catch {
        }
      }
    }
    ensureWindowStyles(win) {
      const doc = win?.document;
      if (!doc || doc.getElementById?.(HEATMAP_STYLE_ID)) return;
      const head = doc.head || doc.documentElement;
      if (!head || typeof doc.createElementNS !== "function") return;
      const style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
      style.id = HEATMAP_STYLE_ID;
      style.textContent = HEATMAP_CSS;
      head.appendChild(style);
    }
    tryPatchWindow(win, attempt) {
      this.pollTimers.delete(win);
      if (win.closed || !this.windows.has(win) || !this.isEnabled() || this.disposers.has(win)) {
        return;
      }
      const iv = win?.ZoteroPane?.itemsView;
      if (!iv || typeof iv._renderCell !== "function") {
        if (attempt < 120) {
          const timer = setTimeout(() => this.tryPatchWindow(win, attempt + 1), 50);
          this.pollTimers.set(win, timer);
        }
        return;
      }
      this.ensureWindowStyles(win);
      const resolveProgress = this.resolveProgress;
      const isEnabled = () => this.isEnabled();
      const getOptions = () => this.getOptions();
      const dispose = this.kernel.runtime.patch(iv, "_renderCell", "itemsView", (orig) => function(...args) {
        const cell = orig.apply(this, args);
        if (!isEnabled() || !cell) return cell;
        const [index, , column] = args;
        if (column?.dataKey !== "title" && column?.primary !== true) return cell;
        const row = this.getRow?.(index) ?? this._rows?.[index];
        const item = row?.ref;
        if (item && typeof item.id === "number" && !item.deleted && (row?.isItem ?? true)) {
          applyTitleHeatmapToCell(cell, resolveProgress(item), getOptions());
        } else {
          clearTitleHeatmapFromCell(cell);
        }
        return cell;
      });
      this.disposers.set(win, dispose);
      try {
        iv.tree?.invalidate?.();
      } catch {
      }
    }
  };

  // src/domains/visual-notes/module.ts
  var VisualNotesDomainModule = class {
    id = "visual-notes";
    enabledPref = "modules.visualNotes.enable";
    infoBriefNote;
    remarkColumn;
    readingColumns;
    titleHeatmap;
    annotationTools;
    kernel;
    services;
    disposables = new DisposableStack();
    windows = /* @__PURE__ */ new Set();
    active = false;
    constructor(kernel, services) {
      this.kernel = kernel;
      this.services = services;
      this.remarkColumn = new RemarkColumnController(kernel);
      this.readingColumns = new ReadingColumnsController(kernel);
      this.infoBriefNote = new InfoBriefNoteController(kernel, () => {
        this.remarkColumn.refresh();
      });
      this.titleHeatmap = new TitleHeatmapController(kernel, (item) => this.readingColumns.getReadProgressForItem(item));
      this.annotationTools = new ReaderAnnotationTools(kernel);
    }
    setDataSource(source) {
      this.infoBriefNote.setDataSource(source);
      this.remarkColumn.setDataSource(source);
      this.readingColumns.setDataSource(source);
    }
    isActive() {
      return this.active;
    }
    start() {
      if (this.active) return;
      this.active = true;
      this.disposables.reset();
      this.syncFeatureStates();
      this.annotationTools.register();
      this.disposables.add(
        this.kernel.prefs.observeKeys(
          [
            "visualNotes.infoBriefNote.enable",
            "workspace.remarkColumn.enable",
            "workspace.readingColumn.enable",
            "workspace.readingTitleHeatmap.enable",
            "workspace.readingHeatmap.color",
            "workspace.readingHeatmap.opacity",
            "workspace.annotationColumn.enable",
            "inspector.annotations.popupLabelsEnable",
            "inspector.annotations.colorLabels"
          ],
          (key) => {
            if (!this.active) return;
            this.syncFeatureStates();
            if (key === "inspector.annotations.popupLabelsEnable" || key === "inspector.annotations.colorLabels") {
              this.annotationTools.popupLabels.sync();
            }
            if (key === "inspector.annotations.colorLabels") {
              this.readingColumns.refreshColumns();
            }
          }
        )
      );
      this.disposables.add(
        this.kernel.bus.on("visual-notes:open-matrix", ({ win, title, itemIDs }) => {
          if (!this.active || !this.kernel.prefs.get("workspace.enableAnnotationMatrix")) return;
          openAnnotationMatrixModal({
            win,
            title,
            itemIDs,
            prefs: this.kernel.prefs,
            bus: this.kernel.bus,
            clipboard: this.services.clipboard
          });
        })
      );
      this.disposables.add(
        this.kernel.bus.on("visual-notes:reading-updated", () => {
          if (this.active) this.refreshLibraryViews();
        })
      );
      this.disposables.add(
        this.kernel.notifier.subscribe(["item"], ({ event }) => {
          if (!this.active) return;
          if (event === "modify" || event === "add" || event === "trash" || event === "restore") {
            this.readingColumns.refreshColumns();
            this.remarkColumn.refresh();
            this.infoBriefNote.refresh();
            this.titleHeatmap.refreshWindows();
          }
        })
      );
      for (const win of this.getMainWindows()) {
        this.onMainWindowLoad(win);
      }
    }
    onMainWindowLoad(win) {
      if (!this.active || !win) return;
      this.windows.add(win);
      this.titleHeatmap.attachWindow(win);
    }
    onMainWindowUnload(win) {
      this.windows.delete(win);
      this.titleHeatmap.detachWindow(win);
    }
    refreshLibraryViews() {
      if (!this.active) return;
      this.readingColumns.refreshColumns();
      this.remarkColumn.refresh();
      this.infoBriefNote.refresh();
      this.titleHeatmap.refreshWindows();
    }
    openMatrixModal(win, title, itemIDs) {
      if (!this.active) return;
      openAnnotationMatrixModal({
        win,
        title,
        itemIDs,
        prefs: this.kernel.prefs,
        bus: this.kernel.bus,
        clipboard: this.services.clipboard
      });
    }
    openCurrentMatrix(win) {
      if (!this.active || !win) return;
      const ids = [];
      const seen = /* @__PURE__ */ new Set();
      const pushItem = (raw) => {
        if (!raw) return;
        const pid = Number(raw.parentItemID || raw.id || 0);
        if (pid > 0 && !seen.has(pid)) {
          seen.add(pid);
          ids.push(pid);
        }
      };
      const selected = win.ZoteroPane?.getSelectedItems?.() || [];
      for (const item of selected) pushItem(item);
      const tabs = win.Zotero_Tabs?._tabs || [];
      const hostItems = globalThis.Zotero?.Items;
      for (const t of tabs) {
        const itemID = Number(t?.data?.itemID || 0);
        if (itemID > 0) pushItem(hostItems?.get?.(itemID) || { id: itemID });
      }
      this.openMatrixModal(win, selected.length ? "已选与已开文献" : "已开文献", ids);
    }
    stop() {
      if (!this.active) return;
      this.active = false;
      this.infoBriefNote.unregister();
      this.remarkColumn.unregister();
      this.readingColumns.unregisterAll();
      this.titleHeatmap.disposeAll();
      this.annotationTools.unregister();
      this.windows.clear();
      this.disposables.disposeAll();
    }
    syncFeatureStates() {
      if (this.kernel.prefs.get("visualNotes.infoBriefNote.enable")) this.infoBriefNote.register();
      else this.infoBriefNote.unregister();
      if (this.kernel.prefs.get("workspace.remarkColumn.enable")) this.remarkColumn.register();
      else this.remarkColumn.unregister();
      this.readingColumns.syncColumns();
      this.titleHeatmap.sync(this.windows);
    }
    getMainWindows() {
      const wins = globalThis.Zotero?.getMainWindows?.();
      return Array.isArray(wins) ? wins : [];
    }
  };

  // src/domains/word-cite/collection-tree-order.ts
  var TEMP_COLLECTION_RELATION = "dc:relation";
  var TEMP_COLLECTION_MARKER = "https://github.com/groele/Zotero-BridgeFlow#temporary-collection";
  var TEMP_COLLECTION_KEYS_PREF = "extensions.zotero.bridgeflow.wordCite.temporaryCollectionKeys";
  var RECOGNIZED_MARKERS = /* @__PURE__ */ new Set([
    TEMP_COLLECTION_MARKER,
    "https://github.com/groele/Zotero-CiteFlow#temporary-collection",
    "https://github.com/MuiseDestiny/zotero-citation#temporary-collection",
    "BridgeFlow"
  ]);
  function isCitationCollectionRef(ref, activeKeys, activeNames) {
    if (!ref || typeof ref !== "object") return false;
    if (ref._isBridgeFlowCollection === true || ref._isCiteFlowCollection === true) return true;
    if (typeof ref.key === "string" && ref.key && activeKeys.has(ref.key)) return true;
    const name = String(ref.name || "");
    if (name && (activeNames?.has(name) || /\.(?:docx|docm|doc|dotx|rtf)\s*(?:\([^)]+\))?$/i.test(name))) return true;
    try {
      const rels = ref.getRelationsByPredicate?.(TEMP_COLLECTION_RELATION) || [];
      if (Array.isArray(rels) && rels.some((r) => RECOGNIZED_MARKERS.has(r))) return true;
    } catch {
    }
    return false;
  }
  function isBottomVirtualRow(row) {
    if (!row || typeof row !== "object") return false;
    const t = row.type;
    return t === "publications" || t === "duplicates" || t === "unfiled" || t === "retracted" || t === "trash" || Boolean(row.isPublications?.() || row.isDuplicates?.() || row.isUnfiled?.() || row.isRetracted?.() || row.isTrash?.());
  }
  function compareCollectionNames(nameA, nameB) {
    const a = String(nameA ?? "");
    const b = String(nameB ?? "");
    const zot = globalThis.Zotero;
    return typeof zot?.localeCompare === "function" ? zot.localeCompare(a, b) : a.localeCompare(b);
  }
  function reorderCitationRowsInSlice(rows, startIndex, endIndex, targetLevel, activeKeys, activeNames) {
    if (!Array.isArray(rows) || startIndex < 0 || endIndex <= startIndex || endIndex > rows.length) return false;
    const beforeBlocks = [], citationBlocks = [], afterBlocks = [];
    let i = startIndex, reachedBottomVirtual = false;
    while (i < endIndex) {
      const head = rows[i];
      const block = [head];
      i += 1;
      while (i < endIndex && (rows[i]?.level ?? targetLevel) > targetLevel) {
        block.push(rows[i]);
        i += 1;
      }
      const isCitation = Boolean(
        (head?.isCollection?.() || head?.type === "collection" || head?.ref?.key) && isCitationCollectionRef(head?.ref, activeKeys, activeNames)
      );
      if (isCitation) citationBlocks.push(block);
      else if (reachedBottomVirtual || isBottomVirtualRow(head)) {
        reachedBottomVirtual = true;
        afterBlocks.push(block);
      } else beforeBlocks.push(block);
    }
    if (!citationBlocks.length) return false;
    citationBlocks.sort((a, b) => compareCollectionNames(a[0]?.ref?.name, b[0]?.ref?.name));
    const reordered = [...beforeBlocks.flat(), ...citationBlocks.flat(), ...afterBlocks.flat()];
    if (reordered.length !== endIndex - startIndex) return false;
    if (reordered.every((item, idx) => rows[startIndex + idx] === item)) return false;
    rows.splice(startIndex, endIndex - startIndex, ...reordered);
    return true;
  }
  function reorderViewCollections(cv, activeKeys, activeNames) {
    const rows = cv?._rows;
    if (!cv || !Array.isArray(rows) || rows.length < 2) return false;
    const focusedID = cv.getRow?.(cv.selection?.focused)?.id;
    const pivotID = cv.getRow?.(cv.selection?.pivot)?.id;
    const selectedIDs = cv.selection?.selected instanceof Set ? [...cv.selection.selected].map((idx) => cv.getRow?.(idx)?.id).filter(Boolean) : [];
    let anyChanged = false;
    let sawLibraryRow = false;
    let i = 0;
    while (i < rows.length) {
      const row = rows[i];
      const isLib = Boolean(row?.isLibrary?.(true) || row?.type === "library" || row?.type === "group");
      if (isLib) {
        sawLibraryRow = true;
        if (typeof cv.isContainerOpen !== "function" || cv.isContainerOpen(i)) {
          const libLevel = typeof cv.getLevel === "function" ? cv.getLevel(i) : row.level ?? 0;
          let endIndex = i + 1;
          while (endIndex < rows.length) {
            const nextLevel = typeof cv.getLevel === "function" ? cv.getLevel(endIndex) : rows[endIndex]?.level ?? 0;
            if (nextLevel <= libLevel) break;
            endIndex += 1;
          }
          if (reorderCitationRowsInSlice(rows, i + 1, endIndex, libLevel + 1, activeKeys, activeNames)) {
            anyChanged = true;
          }
          i = endIndex;
          continue;
        }
      }
      i += 1;
    }
    if (!sawLibraryRow) {
      const baseLevel = typeof cv.getLevel === "function" ? cv.getLevel(0) : rows[0]?.level ?? 0;
      if (reorderCitationRowsInSlice(rows, 0, rows.length, baseLevel, activeKeys, activeNames)) {
        anyChanged = true;
      }
    }
    if (!anyChanged) return false;
    cv._refreshRowMap?.();
    if (cv.selection && cv._rowMap) {
      if (focusedID && typeof cv._rowMap[focusedID] === "number") cv.selection.focused = cv._rowMap[focusedID];
      if (pivotID && typeof cv._rowMap[pivotID] === "number") cv.selection.pivot = cv._rowMap[pivotID];
      if (cv.selection.selected instanceof Set && selectedIDs.length) {
        cv.selection.selected = new Set(
          selectedIDs.map((id) => cv._rowMap[id]).filter((idx) => typeof idx === "number")
        );
      }
    }
    cv.tree?.invalidate?.();
    return true;
  }
  function insertCitationRowAbovePublications(cv, col, activeKeys) {
    const startRow = cv?._rowMap?.["L" + col?.libraryID];
    if (startRow === void 0 || typeof cv.isContainerOpen === "function" && !cv.isContainerOpen(startRow)) {
      return false;
    }
    const libLevel = typeof cv.getLevel === "function" ? cv.getLevel(startRow) : cv._rows?.[startRow]?.level ?? 0;
    const level = libLevel + 1;
    let beforeRow = startRow + 1;
    if (typeof cv.isContainerEmpty !== "function" || !cv.isContainerEmpty(startRow)) {
      for (let i = startRow + 1; i < (cv._rows?.length || 0); i++) {
        const rowLevel = typeof cv.getLevel === "function" ? cv.getLevel(i) : cv._rows[i]?.level ?? 0;
        if (rowLevel < level) {
          beforeRow = i;
          break;
        }
        if (rowLevel === level) {
          const treeRow = cv.getRow?.(i) ?? cv._rows[i];
          if (isBottomVirtualRow(treeRow)) {
            beforeRow = i;
            break;
          }
          if ((treeRow?.isCollection?.() || treeRow?.type === "collection") && isCitationCollectionRef(treeRow.ref, activeKeys) && compareCollectionNames(treeRow.ref?.name, col.name) > 0) {
            beforeRow = i;
            break;
          }
        }
        beforeRow = i + 1;
      }
    }
    const RowCtor = globalThis.Zotero?.CollectionTreeRow || cv?._rows?.find?.((r) => (r?.isCollection?.() || r?.type === "collection") && typeof r?.constructor === "function" && r.constructor !== Object)?.constructor;
    if (typeof RowCtor !== "function" || typeof cv._addRow !== "function") {
      return false;
    }
    if (typeof cv._includedInTree !== "function" || cv._includedInTree(col)) {
      cv._addRow(new RowCtor(cv, "collection", col, level), beforeRow);
    }
    return beforeRow;
  }
  var WORD_COLLECTION_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="16" height="16" fill="none" style="width:16px;height:16px;display:block;flex-shrink:0;pointer-events:none;"><defs><linearGradient id="msWordTop" x1="36" y1="12" x2="118" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#41A5EE"/><stop offset="100%" stop-color="#2B7CD3"/></linearGradient><linearGradient id="msWordTile" x1="10" y1="32" x2="72" y2="96" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#2368C4"/><stop offset="50%" stop-color="#185ABD"/><stop offset="100%" stop-color="#114694"/></linearGradient></defs><path d="M 38 22 C 38 15.4 43.4 10 50 10 H 106 C 112.6 10 118 15.4 118 22 V 37 H 38 Z" fill="url(#msWordTop)"/><rect x="38" y="36" width="80" height="28" fill="#2B7CD3"/><rect x="38" y="63" width="80" height="28" fill="#185ABD"/><path d="M 38 90 H 118 V 106 C 118 112.6 112.6 118 106 118 H 50 C 43.4 118 38 112.6 38 106 Z" fill="#103F91"/><rect x="13" y="36" width="62" height="62" rx="13" fill="#0B2559" fill-opacity="0.32"/><rect x="10" y="33" width="62" height="62" rx="13" fill="url(#msWordTile)"/><path d="M 20.5 47 H 28.5 L 33.5 72.5 L 40 47 H 46.8 L 53.2 72.5 L 58.2 47 H 66 L 57.5 82 H 49.8 L 43.4 58.2 L 37 82 H 29.2 Z" fill="#FFFFFF"/></svg>`;
  var WORD_COLLECTION_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(WORD_COLLECTION_SVG)}`;
  function patchCollectionsViewForWindow(win, runtime, getActiveKeys, wordIconURI, getActiveNames) {
    const cv = win?.ZoteroPane?.collectionsView;
    if (!cv) return () => {
    };
    const disposers = [];
    const resolvedURI = wordIconURI || WORD_COLLECTION_DATA_URI;
    const isCiteRow = (row) => Boolean((row?.isCollection?.() || row?.type === "collection") && isCitationCollectionRef(row?.ref, getActiveKeys(), getActiveNames?.()));
    const createWordIcon = () => {
      const icon = win.document.createElementNS("http://www.w3.org/1999/xhtml", "img");
      icon.src = resolvedURI;
      icon.alt = "";
      icon.width = 16;
      icon.height = 16;
      return icon;
    };
    if (typeof cv._getIcon === "function") {
      disposers.push(runtime.patch(cv, "_getIcon", "collectionsView", (orig) => function(...args) {
        const index = args[0];
        const row = this.getRow?.(index) ?? this._rows?.[index];
        return isCiteRow(row) ? createWordIcon() : orig.apply(this, args);
      }));
    }
    if (typeof cv._expandRow === "function") {
      disposers.push(
        runtime.patch(cv, "_expandRow", "collectionsView", (orig) => async function(...args) {
          const [rows, row] = args;
          const added = await orig.apply(this, args);
          if (typeof added === "number" && added > 0 && rows?.[row]?.isLibrary?.(true)) {
            const libLevel = typeof this.getLevel === "function" && rows === this._rows ? this.getLevel(row) : rows[row]?.level ?? 0;
            if (reorderCitationRowsInSlice(rows, row + 1, row + 1 + added, libLevel + 1, getActiveKeys())) {
              this._refreshRowMap?.();
              this.tree?.invalidate?.();
            }
          }
          return added;
        })
      );
    }
    if (typeof cv._addSortedRow === "function") {
      disposers.push(
        runtime.patch(cv, "_addSortedRow", "collectionsView", (orig) => async function(...args) {
          const [objectType, id] = args;
          const activeKeys = getActiveKeys();
          if (objectType === "collection") {
            const zotCols = globalThis.Zotero?.Collections;
            const col = zotCols?.get?.(id) || await zotCols?.getAsync?.(id);
            if (col && !col.parentID && isCitationCollectionRef(col, activeKeys)) {
              const inserted = insertCitationRowAbovePublications(this, col, activeKeys);
              if (inserted !== false) return inserted;
              const res = await orig.apply(this, args);
              reorderViewCollections(this, activeKeys);
              return res;
            }
          }
          const masked = [];
          for (const row of this._rows || []) {
            if ((row?.isCollection?.() || row?.type === "collection") && isCitationCollectionRef(row?.ref, activeKeys)) {
              const hasOwn = Object.prototype.hasOwnProperty.call(row, "isCollection");
              const original = row.isCollection;
              row.isCollection = () => false;
              masked.push({ row, hasOwn, original });
            }
          }
          try {
            return await orig.apply(this, args);
          } finally {
            for (const { row, hasOwn, original } of masked) {
              if (hasOwn) row.isCollection = original;
              else delete row.isCollection;
            }
          }
        })
      );
    }
    return () => {
      for (const fn of disposers.reverse()) {
        try {
          fn();
        } catch {
        }
      }
      cv.tree?.invalidate?.();
    };
  }

  // src/domains/word-cite/citation-collections.ts
  var WordCitationCollectionManager = class {
    sessionCollections = /* @__PURE__ */ new Map();
    trackedCollectionKeys = /* @__PURE__ */ new Set();
    windowDisposers = /* @__PURE__ */ new Map();
    syncQueue = Promise.resolve();
    kernel;
    constructor(kernel) {
      this.kernel = kernel;
      this.loadPersistedKeys();
    }
    loadPersistedKeys() {
      try {
        const raw = String(globalThis.Zotero?.Prefs?.get?.(TEMP_COLLECTION_KEYS_PREF, true) || "");
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const k of parsed) {
            if (typeof k === "string" && k) this.trackedCollectionKeys.add(k);
          }
        }
      } catch {
      }
    }
    savePersistedKeys() {
      try {
        globalThis.Zotero?.Prefs?.set?.(
          TEMP_COLLECTION_KEYS_PREF,
          JSON.stringify([...this.trackedCollectionKeys]),
          true
        );
      } catch {
      }
    }
    getActiveKeySet() {
      const keys2 = new Set(this.trackedCollectionKeys);
      for (const col of this.sessionCollections.values()) {
        if (col?.key) keys2.add(String(col.key));
      }
      return keys2;
    }
    getActiveNameSet() {
      const names = /* @__PURE__ */ new Set();
      for (const col of this.sessionCollections.values()) {
        const name = String(col?.name || "");
        if (name) names.add(name);
      }
      return names;
    }
    attachWindow(win) {
      if (!win || this.windowDisposers.has(win)) return;
      const iconURI = this.kernel.info.rootURI ? `${this.kernel.info.rootURI}assets/word.svg` : void 0;
      const tryPatch = (attempt = 0) => {
        if (win.closed || this.windowDisposers.has(win)) return;
        const cv = win?.ZoteroPane?.collectionsView;
        if (!cv) {
          if (attempt < 120) {
            const schedule = typeof win.setTimeout === "function" ? win.setTimeout.bind(win) : setTimeout;
            schedule(() => tryPatch(attempt + 1), 50);
          }
          return;
        }
        const dispose = patchCollectionsViewForWindow(
          win,
          this.kernel.runtime,
          () => this.getActiveKeySet(),
          iconURI,
          () => this.getActiveNameSet()
        );
        this.windowDisposers.set(win, dispose);
        reorderViewCollections(cv, this.getActiveKeySet(), this.getActiveNameSet());
        cv.tree?.invalidate?.();
      };
      tryPatch();
    }
    detachWindow(win) {
      const dispose = this.windowDisposers.get(win);
      if (!dispose) return;
      this.windowDisposers.delete(win);
      dispose();
    }
    getSessionIdByCollectionKey(collectionKey) {
      if (!collectionKey) return null;
      for (const [sid, col] of this.sessionCollections.entries()) {
        if (col?.key === collectionKey) return sid;
      }
      return null;
    }
    selectSessionCollection(win, sessionID) {
      const targetID = sessionID || this.sessionCollections.keys().next().value;
      const col = targetID ? this.sessionCollections.get(targetID) : null;
      if (!col?.id) return false;
      const targetWin = win?.ZoteroPane ? win : globalThis.Zotero?.getMainWindow?.();
      const tabs = targetWin?.Zotero_Tabs;
      if (tabs?.selectedID && tabs.selectedID !== "zotero-pane" && typeof tabs.select === "function") {
        try {
          tabs.select("zotero-pane");
        } catch {
        }
      }
      const pane = targetWin?.ZoteroPane;
      const cv = pane?.collectionsView;
      if (typeof cv?.selectCollection === "function") {
        void Promise.resolve(cv.selectCollection(col.id)).catch(() => {
        });
        return true;
      }
      if (typeof pane?.selectCollection === "function") {
        void Promise.resolve(pane.selectCollection(col.id)).catch(() => {
        });
        return true;
      }
      return false;
    }
    resolveSelectedCollectionSessionID(win) {
      const targetWin = win?.ZoteroPane ? win : globalThis.Zotero?.getMainWindow?.();
      const pane = targetWin?.ZoteroPane;
      let selected = [];
      try {
        const getSelected = pane?.getSelectedCollections || pane?.collectionsView?.getSelectedCollections;
        if (typeof getSelected === "function") {
          selected = getSelected.call(pane?.getSelectedCollections ? pane : pane?.collectionsView) || [];
        }
      } catch {
      }
      for (const col of selected) {
        const sid = this.getSessionIdByCollectionKey(String(col?.key || ""));
        if (sid) return sid;
      }
      return null;
    }
    async purgeStaleCollections() {
      const ZoteroObj = globalThis.Zotero;
      const colsApi = ZoteroObj?.Collections;
      const libraryID = ZoteroObj?.Libraries?.userLibraryID;
      if (typeof colsApi?.getByLibrary !== "function" || !libraryID) return;
      const all = colsApi.getByLibrary(libraryID, true, true) || [];
      const activeKeys = new Set([...this.sessionCollections.values()].map((c) => c?.key).filter(Boolean));
      const persistedKeys = new Set(this.trackedCollectionKeys);
      for (const col of all) {
        if (!col || activeKeys.has(col.key)) continue;
        try {
          if (persistedKeys.has(col.key)) {
            await col.eraseTx?.();
            this.trackedCollectionKeys.delete(col.key);
            continue;
          }
          await col.loadDataType?.("relations");
          if (isCitationCollectionRef(col, persistedKeys)) {
            await col.eraseTx?.();
            this.trackedCollectionKeys.delete(col.key);
          }
        } catch (err) {
          this.kernel.logger.error("word-cite:purge-collection", err);
        }
      }
      this.savePersistedKeys();
    }
    sync(sessions) {
      this.syncQueue = this.syncQueue.then(() => this.runSync(sessions)).catch((err) => this.kernel.logger.error("word-cite:collections", err));
    }
    async clearAll() {
      await this.syncQueue;
      for (const dispose of this.windowDisposers.values()) {
        try {
          dispose();
        } catch {
        }
      }
      this.windowDisposers.clear();
      for (const col of this.sessionCollections.values()) {
        try {
          await col?.eraseTx?.();
          if (col?.key) this.trackedCollectionKeys.delete(col.key);
        } catch (err) {
          this.kernel.logger.error("word-cite:erase-collection", err);
        }
      }
      this.sessionCollections.clear();
      this.savePersistedKeys();
    }
    async runSync(sessions) {
      const enabled = this.kernel.prefs.get("wordCite.collections.enable");
      const ZoteroObj = globalThis.Zotero;
      if (!ZoteroObj?.Collection || !ZoteroObj?.Libraries?.userLibraryID) return;
      if (!enabled) {
        for (const [sid, col] of this.sessionCollections) {
          try {
            await col?.eraseTx?.();
            if (col?.key) this.trackedCollectionKeys.delete(col.key);
          } catch {
          }
          this.sessionCollections.delete(sid);
        }
        this.savePersistedKeys();
        return;
      }
      const activeIDs = new Set(sessions.map((s) => s.sessionID));
      for (const [sid, col] of this.sessionCollections) {
        if (!activeIDs.has(sid)) {
          try {
            await col?.eraseTx?.();
            if (col?.key) this.trackedCollectionKeys.delete(col.key);
          } catch {
          }
          this.sessionCollections.delete(sid);
          this.savePersistedKeys();
        }
      }
      const userLibID = ZoteroObj.Libraries.userLibraryID;
      const hostItems = ZoteroObj.Items;
      for (const ses of sessions) {
        let col = this.sessionCollections.get(ses.sessionID);
        const colName = ses.displayName;
        if (!col || col.deleted) {
          col = new ZoteroObj.Collection();
          col._isBridgeFlowCollection = true;
          col.libraryID = userLibID;
          col.name = colName;
          try {
            col.addRelation?.(TEMP_COLLECTION_RELATION, TEMP_COLLECTION_MARKER);
          } catch {
          }
          if (col.key) this.trackedCollectionKeys.add(String(col.key));
          await col.saveTx?.({ skipSelect: true });
          if (col.key) {
            this.trackedCollectionKeys.add(String(col.key));
            this.savePersistedKeys();
          }
          this.sessionCollections.set(ses.sessionID, col);
          this.repositionAllViews(ZoteroObj);
        } else if (col.name !== colName) {
          const prevName = col.name;
          col.name = colName;
          try {
            await col.saveTx?.({ skipSelect: true });
            this.repositionAllViews(ZoteroObj);
          } catch {
            col.name = prevName;
          }
        }
        const targetIDs = [...ses.itemCitations.keys()].filter((id) => {
          if (!Number.isSafeInteger(id) || id <= 0) return false;
          if (typeof hostItems?.get !== "function") return true;
          const item = hostItems.get(id);
          if (!item) return false;
          const inTrash = typeof item.inTrash === "function" ? item.inTrash() === true : item.inTrash === true;
          if (item.deleted === true || inTrash) return false;
          if (item.libraryID != null && col.libraryID != null && item.libraryID !== col.libraryID) return false;
          return typeof item.isTopLevelItem !== "function" || item.isTopLevelItem();
        });
        const existingRaw = col.getChildItems?.(true) || [];
        const existingIDs = existingRaw.map((x) => typeof x === "number" ? x : Number(x?.id || 0)).filter((id) => Number.isSafeInteger(id) && id > 0);
        const targetSet = new Set(targetIDs);
        const currentSet = new Set(existingIDs);
        const toRemove = existingIDs.filter((id) => !targetSet.has(id));
        const toAdd = targetIDs.filter((id) => !currentSet.has(id));
        if (!toRemove.length && !toAdd.length) continue;
        try {
          if (typeof ZoteroObj.DB?.executeTransaction === "function") {
            await ZoteroObj.DB.executeTransaction(async () => {
              if (toRemove.length) await col.removeItems?.(toRemove);
              if (toAdd.length) await col.addItems?.(toAdd);
            });
          } else {
            if (toRemove.length) await col.removeItems?.(toRemove);
            if (toAdd.length) await col.addItems?.(toAdd);
          }
        } catch (err) {
          this.kernel.logger.error("word-cite:collection-sync", err);
        }
      }
    }
    repositionAllViews(zoteroObj) {
      const wins = zoteroObj?.getMainWindows?.() || [];
      const mainWin = zoteroObj?.getMainWindow?.();
      if (mainWin && !wins.includes(mainWin)) wins.push(mainWin);
      const activeKeys = this.getActiveKeySet();
      const activeNames = this.getActiveNameSet();
      for (const win of wins) {
        try {
          if (!this.windowDisposers.has(win)) this.attachWindow(win);
          const cv = win?.ZoteroPane?.collectionsView;
          if (cv) {
            reorderViewCollections(cv, activeKeys, activeNames);
            cv.tree?.invalidate?.();
          }
        } catch {
        }
      }
    }
  };

  // src/domains/word-cite/citation-column.ts
  var CitationColumnController = class {
    registeredKeys = /* @__PURE__ */ new Set();
    active = false;
    cachedSessionID;
    cachedSessionAt = 0;
    kernel;
    tracker;
    collections;
    constructor(kernel, tracker, collections) {
      this.kernel = kernel;
      this.tracker = tracker;
      this.collections = collections;
    }
    resolvePreferredSessionID() {
      const now = Date.now();
      if (now - this.cachedSessionAt > 80) {
        this.cachedSessionAt = now;
        this.cachedSessionID = this.collections?.resolveSelectedCollectionSessionID();
      }
      return this.cachedSessionID;
    }
    register() {
      if (this.active) return;
      const manager = globalThis.Zotero?.ItemTreeManager;
      const regFn = manager?.registerColumns || manager?.registerColumn;
      if (typeof regFn !== "function") return;
      this.active = true;
      const descriptor = {
        dataKey: "bridgeflowCitation",
        label: globalThis.Zotero?.locale?.startsWith?.("zh") ? "引用" : "Citation",
        enabledTreeIDs: ["main"],
        zoteroPersist: ["width", "hidden", "sortDirection"],
        pluginID: this.kernel.info.id,
        dataProvider: (item) => {
          const id = Number(item?.id || 0);
          if (!id) return "";
          const preferred = this.resolvePreferredSessionID();
          const direct = this.tracker.getCitationDisplayForItem(id, preferred);
          if (direct) return direct;
          const parentID = Number(item?.parentItemID || 0);
          return parentID > 0 ? this.tracker.getCitationDisplayForItem(parentID, preferred) : "";
        }
      };
      try {
        const res = regFn.call(manager, descriptor);
        const recordKey = (val) => {
          const list = Array.isArray(val) ? val : [val];
          for (const k of list) {
            if (typeof k === "string" && k) this.registeredKeys.add(k);
          }
          if (!this.active && this.registeredKeys.size) {
            this.flushUnregister();
          }
        };
        if (res && typeof res.then === "function") {
          void res.then(recordKey).catch(() => {
          });
        } else {
          recordKey(res);
        }
      } catch {
      }
    }
    unregister() {
      this.active = false;
      this.flushUnregister();
    }
    flushUnregister() {
      if (!this.registeredKeys.size) return;
      const keys2 = [...this.registeredKeys];
      this.registeredKeys.clear();
      const manager = globalThis.Zotero?.ItemTreeManager;
      try {
        if (typeof manager?.unregisterColumns === "function") {
          void Promise.resolve(manager.unregisterColumns(keys2)).catch(() => {
          });
        } else if (typeof manager?.unregisterColumn === "function") {
          for (const k of keys2) {
            void Promise.resolve(manager.unregisterColumn(k)).catch(() => {
            });
          }
        }
      } catch {
      }
    }
  };

  // src/domains/word-cite/word-command.ts
  var commandInFlight = false;
  var commandStartedAt = 0;
  async function runWordCommand(kernel, command, run) {
    const host2 = globalThis.Zotero;
    const integration = host2?.Integration;
    const iface = integration?.Interface?.prototype;
    if (host2?.isMac !== true && host2?.isWin === false) return "unavailable";
    if (typeof integration?.execCommand !== "function" || typeof integration.getApplication !== "function" || typeof iface?.[command] !== "function") {
      return "unavailable";
    }
    if (commandInFlight && commandStartedAt > 0 && Date.now() - commandStartedAt > 9e4) {
      commandInFlight = false;
      commandStartedAt = 0;
    }
    if (commandInFlight || integration.currentDoc) return "busy";
    const isMac = host2.isMac === true;
    const agent = isMac ? "MacWord16" : "WinWord";
    const docId = isMac ? "/Applications/Microsoft Word.app/" : null;
    const disposers = [];
    let application;
    let document2;
    let result = "unavailable";
    const isCancelled = (error) => {
      const UserCancelled = host2.Exception?.UserCancelled;
      return typeof UserCancelled === "function" && error instanceof UserCancelled;
    };
    commandInFlight = true;
    commandStartedAt = Date.now();
    try {
      disposers.push(kernel.runtime.patch(
        integration,
        "getApplication",
        "Word command",
        (original) => function(...args) {
          const app = Reflect.apply(original, this, args);
          if (!application && args[0] === agent && args[1] === command && args[2] === docId) {
            application = app;
            if (!isMac && typeof app?.getDocument === "function" && typeof app.getActiveDocument === "function") {
              disposers.push(kernel.runtime.patch(
                app,
                "getActiveDocument",
                "WinWord adapter",
                () => async () => app.getDocument("")
              ));
            }
          }
          return app;
        }
      ));
      disposers.push(kernel.runtime.patch(
        iface,
        command,
        "Word command",
        (original) => async function(...args) {
          const invoke = () => Reflect.apply(original, this, args);
          if (!application || this._app !== application) return invoke();
          document2 = this._doc;
          try {
            const value = await run(invoke, this._session);
            result = "completed";
            return value;
          } catch (error) {
            if (isCancelled(error)) result = "cancelled";
            throw error;
          }
        }
      ));
      if (typeof integration._handleCommandError === "function") {
        disposers.push(kernel.runtime.patch(
          integration,
          "_handleCommandError",
          "Word command",
          (original) => function(...args) {
            if (document2 && args[0] === document2) result = "unavailable";
            return Reflect.apply(original, this, args);
          }
        ));
      }
      await integration.execCommand(agent, command, docId, isMac ? 2 : 1);
      return result;
    } catch (error) {
      if (isCancelled(error)) return "cancelled";
      kernel.logger.error(`word-cite:${command}`, error);
      return "unavailable";
    } finally {
      for (const dispose of disposers.reverse()) dispose();
      commandInFlight = false;
      commandStartedAt = 0;
    }
  }

  // src/domains/word-cite/word-inserter.ts
  function resolveActiveSelectionForWord(win) {
    const zotero = globalThis.Zotero;
    const targetWin = win || zotero?.getMainWindow?.() || zotero?.getMainWindows?.()?.[0];
    const tabs = targetWin?.Zotero_Tabs;
    const pane = targetWin?.ZoteroPane;
    if (!tabs || !pane) return [];
    if (tabs.selectedID === "zotero-pane" || tabs.selectedIndex === 0) {
      const { items } = deduplicateRegularItems(pane.getSelectedItems?.() || []);
      return items;
    }
    const reader = zotero?.Reader?.getByTabID?.(tabs.selectedID);
    const attachment = reader && zotero?.Items?.get?.(reader.itemID);
    const candidate = attachment?.parentItem || attachment;
    return candidate ? deduplicateRegularItems([candidate]).items : [];
  }
  async function insertItemsIntoWord(kernel, win32, rawItems, options = {}) {
    const { items } = deduplicateRegularItems(rawItems);
    const selectedIDs = items.map((item) => Number(item.id)).filter((id) => Number.isSafeInteger(id) && id > 0);
    if (!selectedIDs.length) return "unavailable";
    const host2 = globalThis.Zotero;
    const integration = host2?.Integration;
    if (typeof integration?.CitationField !== "function" || typeof integration?.Citation !== "function" || typeof integration?.Field?.loadExisting !== "function") return "unavailable";
    const verifyDrop = host2.isMac !== true && options.verifyCursor;
    if (verifyDrop && !win32.verifyDroppedWordTarget()) return "non-word";
    const insertCitation = async function(field) {
      let newField = false;
      let activeField = field;
      let citation;
      let committed = false;
      try {
        if (activeField) {
          activeField = await integration.Field.loadExisting(activeField);
          if (activeField && activeField.type === 2) {
            throw new host2.Exception.Alert("integration.error.notInCitation");
          }
          if (activeField && activeField.type === 1) {
            citation = new integration.Citation(activeField, await activeField.unserialize(), await activeField.getNoteIndex());
          } else {
            newField = true;
            activeField = new integration.CitationField(activeField?._field ?? activeField);
            citation = new integration.Citation(activeField);
          }
        } else {
          newField = true;
          activeField = new integration.CitationField(await this.addField(true));
          citation = new integration.Citation(activeField);
        }
        await citation.prepareForEditing();
        let fieldIndex = -1;
        if (!this.data.prefs.delayCitationUpdates || !Object.keys(this.citationsByItemID).length) {
          const findFieldIndex = this.getFields().then(async (fields) => {
            for (const [index, candidate] of fields.entries()) {
              if (await candidate.equals(activeField?._field)) {
                activeField = new integration.CitationField(candidate);
                return index;
              }
            }
            throw new Error("Could not locate the Word citation field");
          });
          const [fieldResult, updateResult] = await Promise.allSettled([findFieldIndex, this.updateFromDocument(0)]);
          if (fieldResult.status === "rejected") throw fieldResult.reason;
          if (updateResult.status === "rejected") throw updateResult.reason;
          fieldIndex = fieldResult.value;
        }
        const existingIDs = new Set(citation.citationItems.map((item) => Number(item.id)));
        for (const id of selectedIDs) {
          if (!existingIDs.has(id)) citation.citationItems.push({ id });
        }
        const citations = await this._insertCitingResult(fieldIndex, activeField, citation);
        if (!citations.length) throw new Error("Word returned no citation fields");
        let refreshedFields;
        if (!this.data?.prefs?.delayCitationUpdates) {
          if (citations.length !== 1) {
            refreshedFields = await this.getFields(true);
          }
          await this.updateFromDocument(0);
        }
        for (const cit of citations) {
          const idx = cit.fieldIndex ?? cit._fieldIndex;
          if (refreshedFields) {
            const rep = new integration.CitationField(refreshedFields[idx]);
            if ("field" in cit) cit.field = rep;
            else cit._field = rep;
          }
          const citField = cit.field ?? cit._field;
          await this.addCitation(idx, await citField.getNoteIndex(), cit);
          committed = true;
        }
        return citations;
      } catch (error) {
        if (newField && !committed && typeof activeField?.delete === "function") {
          try {
            await activeField.delete();
            await this.getFields(true);
            await this.updateFromDocument(0);
          } catch (cleanupErr) {
            kernel.logger.error("word-cite:rollback", cleanupErr);
          }
        }
        throw error;
      }
    };
    let committedSession;
    try {
      const result = await runWordCommand(kernel, "addEditCitation", async (invoke, session2) => {
        if (typeof session2?.cite !== "function" || typeof session2._insertCitingResult !== "function" || typeof session2.addCitation !== "function") throw new Error("Word citation API unavailable");
        let wroteCitation = false;
        const dispose = kernel.runtime.patch(
          session2,
          "cite",
          "Word session",
          () => async (field) => {
            const citations = await insertCitation.call(session2, field);
            wroteCitation = true;
            return citations;
          }
        );
        try {
          await invoke();
          if (!wroteCitation) throw new Error("The Word command did not insert a citation");
          committedSession = session2;
        } finally {
          dispose();
        }
      });
      if (result !== "completed") return result;
      try {
        options.onCommitted?.(committedSession);
      } catch {
      }
      return "inserted";
    } finally {
      if (verifyDrop) win32.clearLastDroppedWordTarget();
    }
  }
  async function refreshActiveWordDocument(kernel) {
    return await runWordCommand(kernel, "refresh", async (invoke) => invoke()) === "completed";
  }

  // src/domains/word-cite/drag-cite-controller.ts
  var DragCiteController = class {
    windowDisposers = /* @__PURE__ */ new Map();
    activeDragItems = null;
    activeDragStartedAt = 0;
    kernel;
    win32;
    onInserted;
    constructor(kernel, win32, onInserted = () => {
    }) {
      this.kernel = kernel;
      this.win32 = win32;
      this.onInserted = onInserted;
    }
    attachWindow(win) {
      if (this.windowDisposers.has(win)) return;
      const tryBind = (attempt = 0) => {
        if (win.closed || this.windowDisposers.has(win)) return;
        const itemsView = win.ZoteroPane?.itemsView;
        if (!itemsView && attempt < 120 && typeof win.setTimeout === "function") {
          win.setTimeout(() => tryBind(attempt + 1), 50);
          return;
        }
        this.bindWindowImmediate(win, itemsView);
      };
      tryBind();
    }
    bindWindowImmediate(win, itemsView) {
      if (this.windowDisposers.has(win)) return;
      const disposers = [];
      if (itemsView && typeof itemsView.onDragStart === "function" && (this.win32.supportsNativeWin32() || globalThis.Zotero?.isMac)) {
        const unpatch = this.kernel.runtime.patch(
          itemsView,
          "onDragStart",
          "itemsView",
          (orig) => (event, ...rest) => {
            const row = rest[0];
            this.activeDragItems = null;
            this.activeDragStartedAt = 0;
            this.win32.clearLastDroppedWordTarget();
            const dragEnabled = this.kernel.prefs.get("wordCite.dragCite.enable");
            const selection = itemsView.selection;
            if (dragEnabled && typeof row === "number" && Number.isInteger(row) && selection && !selection.isSelected?.(row)) {
              selection.select?.(row);
            }
            const res = orig.call(itemsView, event, ...rest);
            if (res === false || !dragEnabled) return res;
            const selected = win.ZoteroPane?.getSelectedItems?.() || [];
            const { items } = deduplicateRegularItems(selected);
            if (!items.length) return res;
            this.activeDragItems = items;
            this.activeDragStartedAt = Date.now();
            try {
              event?.dataTransfer?.clearData?.("text/html");
              event?.dataTransfer?.setData?.("text/plain", "");
            } catch {
            }
            return res;
          }
        );
        disposers.push(unpatch);
        const doc = win.document;
        if (doc?.addEventListener) {
          const onDragEnd = (ev) => {
            const items = this.activeDragItems;
            const startedAt = this.activeDragStartedAt;
            this.activeDragItems = null;
            this.activeDragStartedAt = 0;
            if (!items?.length || !this.kernel.prefs.get("wordCite.dragCite.enable")) return;
            const dt = ev.dataTransfer;
            if (dt?.mozUserCancelled) return;
            if (startedAt > 0 && Date.now() - startedAt > 6e4) return;
            void this.handleDropEnd(items);
          };
          doc.addEventListener("dragend", onDragEnd, true);
          disposers.push(() => doc.removeEventListener("dragend", onDragEnd, true));
        }
      }
      this.windowDisposers.set(win, () => {
        for (const fn of disposers.reverse()) {
          try {
            fn();
          } catch {
          }
        }
      });
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
      if (probe.status !== "word-confirmed" && !globalThis.Zotero?.isMac) {
        if (probe.status === "unknown") {
          this.notifyHint("未检测到 Microsoft Word 窗口目标，请确认将文献拖拽至 Word 文档编辑区内。");
        }
        return "non-word";
      }
      return insertItemsIntoWord(this.kernel, this.win32, items, {
        verifyCursor: true,
        onCommitted: this.onInserted
      });
    }
    async insertItems(items, onInserted) {
      if (!this.kernel.prefs.get("modules.wordCite.enable")) return "unavailable";
      const result = await insertItemsIntoWord(this.kernel, this.win32, items, {
        verifyCursor: false,
        onCommitted: (session2) => {
          this.onInserted?.(session2);
          onInserted?.(session2?.sessionID || "");
        }
      });
      if (result === "unavailable" && !onInserted) {
        this.notifyHint("插入 Word 引文失败：请先打开 Microsoft Word 文档并将光标置于正文需要插入引文的位置。");
      }
      return result;
    }
    disposeAll() {
      for (const disposer of this.windowDisposers.values()) disposer();
      this.windowDisposers.clear();
    }
    notifyHint(message) {
      try {
        const pw = new globalThis.Zotero.ProgressWindow();
        pw.changeHeadline("Zotero BridgeFlow · Word 引用");
        pw.addDescription(message);
        pw.show();
        pw.startCloseTimer(4e3);
      } catch {
      }
    }
  };

  // src/domains/word-cite/session-tracker.ts
  function extractDocumentBaseName(rawPath) {
    let cleaned = String(rawPath || "").replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\uFEFF]/g, " ").replace(/\s+/g, " ").trim();
    if (!cleaned || cleaned === "__doc__") return "Untitled Word Document";
    cleaned = cleaned.replace(/^(["'])(.*)\1$/, "$2").trim();
    if (cleaned.startsWith("window-title:")) {
      cleaned = cleaned.slice("window-title:".length).trim();
    }
    const wordSuffixRe = /\s+[-–—]\s+(?:Microsoft\s+)?Word(?:\s*\([^)]*\))?$/i;
    if (wordSuffixRe.test(cleaned)) {
      cleaned = cleaned.replace(wordSuffixRe, "").trim();
    }
    const isURL = /^[a-z][a-z0-9+.-]*:\/\//i.test(cleaned);
    if (isURL && /(?:\/|^)(?:Doc|WopiFrame2?|redir)\.aspx(?:\?|$)/i.test(cleaned)) {
      const fileParam = cleaned.match(/[?&](?:file|filename|name)=([^&#]+)/i);
      if (fileParam?.[1]) {
        try {
          const decoded = decodeURIComponent(fileParam[1].replace(/\+/g, "%20")).trim();
          if (decoded && !/[\\/]/.test(decoded)) cleaned = decoded;
        } catch {
        }
      }
    }
    const withoutQuery = isURL ? cleaned.replace(/[?#].*$/, "") : cleaned;
    const parts = withoutQuery.split(/[\\/]/).filter(Boolean);
    let candidate = parts[parts.length - 1] || cleaned;
    if (isURL || /%[0-9A-Fa-f]{2}/.test(candidate)) {
      try {
        candidate = decodeURIComponent(candidate);
      } catch {
      }
    }
    const extMatch = candidate.match(/^(.+?\.(?:docx|docm|doc|dotx|dotm|rtf|odt))(?:\s*\[[^\]]*\]|\s+[-–—]\s+.*)*$/i);
    if (extMatch) {
      candidate = extMatch[1].trim();
    } else {
      const statusRe = /(?:\s*\[(?:兼容模式|Compatibility Mode|只读|Read-Only|受保护的视图|Protected View|自动保存|AutoSave)[^\]]*\]|\s+[-–—]\s+(?:已保存.*|正在保存.*|上次保存.*|只读|兼容模式|受保护的视图|未保存|Saved.*|Saving.*|Last saved.*|Read-Only|Compatibility Mode|Protected View|Unsaved))\s*$/i;
      let prev = "";
      while (candidate && candidate !== prev) {
        prev = candidate;
        candidate = candidate.replace(statusRe, "").trim();
      }
    }
    return (candidate || "Untitled Word Document").slice(0, 200);
  }
  function extractParentQualifier(rawPath, depth = 1) {
    const trimmed = String(rawPath || "").trim();
    if (!trimmed || trimmed.startsWith("window-title:")) return "";
    const clean = trimmed.replace(/[?#].*$/, "");
    const parts = clean.split(/[\\/]+/).filter(Boolean);
    const parents = parts.slice(0, -1).filter((p) => !/^[A-Za-z]:$/.test(p) && !/^[a-z]+:$/i.test(p));
    return parents.length ? parents.slice(-depth).join("/") : "";
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
      const peers = sessions.filter((p) => p.sessionID !== s.sessionID && extractDocumentBaseName(p.path) === base);
      let qualified = base;
      for (const depth of [1, 2, 3]) {
        const own = extractParentQualifier(s.path, depth);
        if (!own) break;
        if (peers.every((p) => extractParentQualifier(p.path, depth) !== own)) {
          qualified = `${base} (${own})`;
          break;
        }
        qualified = `${base} (${own})`;
      }
      result.set(s.sessionID, qualified);
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
    getSession(id) {
      return this.sessions.get(id);
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
    getCitationDisplayForItem(itemID, preferredSessionID) {
      if (preferredSessionID && this.sessions.has(preferredSessionID)) {
        const prefSes = this.sessions.get(preferredSessionID);
        const hit = prefSes.itemCitations.get(itemID);
        return hit ? `[${hit.ordinal}] ${hit.shortText}`.trim() : "";
      }
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
            map.set(c.itemID, { ordinal: c.ordinal, shortText: c.shortText, occurrences: c.occurrences ?? 1 });
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
      if (this.sessions.size <= 1) return false;
      const fgTitle = (overrideTitle ?? this.win32.probeForegroundWordTitle()).trim().toLowerCase();
      if (!fgTitle) return false;
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
    setActiveSession(sessionID) {
      if (!sessionID || !this.sessions.has(sessionID)) return false;
      if (this.activeSessionID === sessionID) return false;
      this.activeSessionID = sessionID;
      this.lastFingerprint = this.computeFingerprint();
      this.emitSnapshot();
      return true;
    }
    emitCurrentSnapshot() {
      this.emitSnapshot();
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
        const items = [...ses.itemCitations.entries()].sort((a, b) => a[0] - b[0]).map(([id, c]) => `${id}:${c.ordinal}:${c.occurrences ?? 1}:${c.shortText}`).join(",");
        parts.push(`${ses.sessionID}|${ses.displayName}|${items}`);
      }
      return parts.join(";");
    }
    emitSnapshot() {
      const active = this.getActiveSession();
      const sessions = [];
      let activeByItemID = /* @__PURE__ */ new Map();
      const citedItemIDs = [];
      for (const ses of this.sessions.values()) {
        const map = /* @__PURE__ */ new Map();
        for (const [itemID, info] of ses.itemCitations.entries()) {
          map.set(itemID, {
            itemID,
            ordinal: info.ordinal,
            occurrences: info.occurrences ?? 1,
            shortText: info.shortText,
            documentName: ses.displayName,
            sessionID: ses.sessionID
          });
          if (ses.sessionID === active?.sessionID) citedItemIDs.push(itemID);
        }
        if (ses.sessionID === active?.sessionID) activeByItemID = map;
        sessions.push({
          sessionID: ses.sessionID,
          documentName: ses.displayName,
          totalCitedCount: map.size,
          byItemID: map
        });
      }
      const payload = {
        activeSessionID: active?.sessionID ?? null,
        activeDocumentName: active?.displayName ?? "",
        byItemID: activeByItemID,
        citedItemIDs,
        totalCitedCount: activeByItemID.size,
        sessions
      };
      this.bus.emit("citation:snapshot-updated", payload);
    }
  };

  // src/domains/word-cite/tag-governance.ts
  var MANAGED_TAG_IDS_PREF = "extensions.zotero.bridgeflow.wordCite.managedTagItemIDs";
  var CitationTagGovernance = class {
    managedItemIDs = /* @__PURE__ */ new Set();
    activeTagText;
    syncQueue = Promise.resolve({ added: 0, removed: 0 });
    prefs;
    constructor(prefs) {
      this.prefs = prefs;
      this.activeTagText = this.sanitizeTagText(prefs.get("wordCite.citationTags.text"));
      this.loadPersistedIDs();
    }
    loadPersistedIDs() {
      try {
        const raw = String(globalThis.Zotero?.Prefs?.get?.(MANAGED_TAG_IDS_PREF, true) || "");
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const id of parsed) {
            const n = Number(id);
            if (Number.isSafeInteger(n) && n > 0) this.managedItemIDs.add(n);
          }
        }
      } catch {
      }
    }
    savePersistedIDs() {
      try {
        globalThis.Zotero?.Prefs?.set?.(MANAGED_TAG_IDS_PREF, JSON.stringify([...this.managedItemIDs]), true);
      } catch {
      }
    }
    get managedCount() {
      return this.managedItemIDs.size;
    }
    sanitizeTagText(raw) {
      const clean = String(raw || "").replace(/[\r\n\x00-\x1f]/g, "").trim().slice(0, 200);
      return clean || "/Citations";
    }
    syncCitedItems(citedUnion, resolveItem = (id) => globalThis.Zotero?.Items?.get?.(id)) {
      const snapshotUnion = new Set(citedUnion);
      const run = this.syncQueue.then(() => this.performSync(snapshotUnion, resolveItem));
      this.syncQueue = run.catch(() => ({ added: 0, removed: 0 }));
      return run;
    }
    async performSync(citedUnion, resolveItem) {
      const enabled = this.prefs.get("wordCite.citationTags.enable");
      const nextTag = this.sanitizeTagText(this.prefs.get("wordCite.citationTags.text"));
      let added = 0;
      let removed = 0;
      try {
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
      } finally {
        this.savePersistedIDs();
      }
    }
  };

  // src/domains/word-cite/word-poller.ts
  var VALID_INDEX_KEY_RE = /^(?:0|[1-9]\d*)$/;
  var WordIntegrationPoller = class {
    timer = null;
    viewRefreshTimer = null;
    postExecTimer = null;
    unpatchExec = null;
    unpatchGetSession = null;
    running = false;
    polling = false;
    execDepth = 0;
    idleRounds = 0;
    emptyStreakBySession = /* @__PURE__ */ new Map();
    docPathBySession = /* @__PURE__ */ new Map();
    pendingCmdDocHint = "";
    kernel;
    tracker;
    win32;
    constructor(kernel, tracker, win32) {
      this.kernel = kernel;
      this.tracker = tracker;
      this.win32 = win32;
    }
    start() {
      if (this.running) return;
      this.running = true;
      this.idleRounds = 0;
      this.emptyStreakBySession.clear();
      this.installHooks();
      void this.pollOnce();
      this.scheduleNext();
    }
    stop() {
      this.running = false;
      if (this.timer !== null) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.viewRefreshTimer !== null) {
        clearTimeout(this.viewRefreshTimer);
        this.viewRefreshTimer = null;
      }
      if (this.postExecTimer !== null) {
        clearTimeout(this.postExecTimer);
        this.postExecTimer = null;
      }
      this.unpatchExec?.();
      this.unpatchExec = null;
      this.unpatchGetSession?.();
      this.unpatchGetSession = null;
      this.emptyStreakBySession.clear();
      this.docPathBySession.clear();
    }
    async notifyCommittedSession(session2) {
      return this.pollOnce(true, session2);
    }
    async pollOnce(allowDuringExec = false, committedSession) {
      if (this.polling || !allowDuringExec && this.execDepth > 0) return false;
      const integration = globalThis.Zotero?.Integration;
      const sessionsMap = integration?.sessions;
      if (!sessionsMap && !committedSession) return false;
      this.polling = true;
      try {
        const merged = /* @__PURE__ */ new Map();
        if (sessionsMap) {
          const rawEntries = sessionsMap instanceof Map ? [...sessionsMap.entries()] : Object.entries(sessionsMap);
          for (const [sid, s] of rawEntries) merged.set(String(sid), s);
        }
        if (committedSession && typeof committedSession === "object") {
          const sid = String(committedSession.sessionID || "word-active");
          if (!merged.has(sid)) merged.set(sid, committedSession);
        }
        const entries = [...merged.entries()];
        const activeIDs = /* @__PURE__ */ new Set();
        const rawSessions = [];
        for (const [rawID, session2] of entries) {
          if (!session2) continue;
          const agent = String(session2.agent || "WinWord");
          if (!/(WinWord|MacWord|Word)/i.test(agent)) continue;
          const sessionID = String(rawID);
          activeIDs.add(sessionID);
          await this.ensureConsistentSnapshot(session2);
          const parsed = this.extractSessionCitations(session2);
          const prevTracked = this.tracker.getSession(sessionID);
          if (!parsed.length && prevTracked && prevTracked.itemCitations.size > 0) {
            const streak = (this.emptyStreakBySession.get(sessionID) ?? 0) + 1;
            this.emptyStreakBySession.set(sessionID, streak);
            if (streak < 2) {
              rawSessions.push({
                sessionID,
                documentPath: prevTracked.documentPath,
                citations: [...prevTracked.itemCitations.entries()].map(([itemID, info]) => ({
                  itemID,
                  ordinal: info.ordinal,
                  shortText: info.shortText,
                  occurrences: info.occurrences
                }))
              });
              continue;
            }
          } else if (parsed.length > 0) {
            this.emptyStreakBySession.delete(sessionID);
          }
          const docPath = this.resolveSessionDocumentPath(sessionID, session2, entries.length);
          rawSessions.push({ sessionID, documentPath: docPath, citations: parsed });
        }
        for (const key of this.emptyStreakBySession.keys()) if (!activeIDs.has(key)) this.emptyStreakBySession.delete(key);
        for (const key of this.docPathBySession.keys()) if (!activeIDs.has(key)) this.docPathBySession.delete(key);
        const changed = this.tracker.syncSessions(rawSessions);
        if (changed) {
          this.idleRounds = 0;
          this.scheduleItemsViewRefresh();
        } else {
          this.idleRounds = Math.min(10, this.idleRounds + 1);
        }
        return changed;
      } finally {
        this.polling = false;
      }
    }
    async ensureConsistentSnapshot(session2) {
      if (typeof session2.updateFromDocument !== "function") return;
      const byIdx = session2.citationsByIndex;
      const byItem = session2.citationsByItemID;
      const missingObj = !byIdx || typeof byIdx !== "object" || !byItem || typeof byItem !== "object";
      const mismatch = !missingObj && Object.keys(byIdx).length === 0 !== (Object.keys(byItem).length === 0);
      if (!missingObj && !mismatch) return;
      let guard;
      try {
        await Promise.race([
          Promise.resolve(session2.updateFromDocument(0)),
          new Promise((resolve) => {
            guard = setTimeout(resolve, 4e3);
          })
        ]);
      } catch {
      } finally {
        if (guard !== void 0) clearTimeout(guard);
      }
    }
    extractDirectDocCandidate(session2, docObj) {
      const doc = docObj ?? session2?._doc ?? session2?.doc;
      const desc = typeof doc === "object" && doc !== null ? doc : void 0;
      const candidates = [
        typeof doc === "string" ? doc : null,
        desc?.docId,
        desc?.documentPath,
        desc?.documentName,
        desc?.fullName,
        desc?.filePath,
        desc?.path,
        desc?.url,
        desc?.uri,
        desc?.filename,
        desc?.title,
        desc?.name,
        session2?.docId,
        session2?.documentPath,
        session2?.documentName,
        session2?.filePath,
        session2?.path,
        session2?.title,
        session2?.name
      ];
      for (const c of candidates) {
        if (typeof c === "string" && c.trim() && c.trim() !== "__doc__") {
          return c.trim();
        }
      }
      return "";
    }
    resolveSessionDocumentPath(sessionID, session2, totalSessions) {
      const direct = this.extractDirectDocCandidate(session2);
      if (direct) {
        this.docPathBySession.set(sessionID, direct);
        return direct;
      }
      const cached = this.docPathBySession.get(sessionID);
      if (cached && !cached.startsWith("window-title:")) return cached;
      if (this.win32) {
        const probed = this.win32.probeWordWindowTitles();
        const fg = probed.foregroundTitle ? extractDocumentBaseName(`window-title:${probed.foregroundTitle}`) : "";
        if (fg && fg !== "Untitled Word Document" && (totalSessions === 1 || !cached)) {
          const winId = `window-title:${fg}`;
          this.docPathBySession.set(sessionID, winId);
          return winId;
        }
        if (totalSessions === 1 && probed.visibleTitles.length === 1) {
          const vis = extractDocumentBaseName(`window-title:${probed.visibleTitles[0]}`);
          if (vis && vis !== "Untitled Word Document") {
            const winId = `window-title:${vis}`;
            this.docPathBySession.set(sessionID, winId);
            return winId;
          }
        }
      }
      return cached || sessionID;
    }
    // Extracts unique valid cited items in exact order of appearance across citationsByIndex (1, 2, 3, 4...).
    extractSessionCitations(session2) {
      const hostItems = globalThis.Zotero?.Items;
      const ordinalMap = /* @__PURE__ */ new Map();
      const trashStatus = /* @__PURE__ */ new Map();
      let nextOrdinal = 1;
      const cleanText = (raw) => String(raw || "").replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\uFEFF]/g, " ").replace(/\s+/g, " ").trim();
      const isDeletedOrTrashed = (itemID) => {
        const cached = trashStatus.get(itemID);
        if (cached !== void 0) return cached;
        const zotItem = hostItems?.get?.(itemID);
        if (!zotItem) {
          trashStatus.set(itemID, false);
          return false;
        }
        const inTrash = typeof zotItem.inTrash === "function" ? zotItem.inTrash() === true : zotItem.inTrash === true;
        const deleted = zotItem.deleted === true || inTrash;
        trashStatus.set(itemID, deleted);
        return deleted;
      };
      const recordHit = (itemID, shortText, explicitItemOrdinal, countOcc = false) => {
        if (!Number.isSafeInteger(itemID) || itemID <= 0) return;
        if (isDeletedOrTrashed(itemID)) return;
        const label = cleanText(shortText);
        let existing = ordinalMap.get(itemID);
        if (!existing) {
          const assigned = explicitItemOrdinal && explicitItemOrdinal > 0 ? explicitItemOrdinal : nextOrdinal;
          nextOrdinal = Math.max(nextOrdinal + 1, assigned + 1);
          existing = { ordinal: assigned, occurrences: 0, labels: [] };
          ordinalMap.set(itemID, existing);
        }
        if (countOcc) existing.occurrences += 1;
        else if (existing.occurrences === 0) existing.occurrences = 1;
        if (label && !existing.labels.includes(label)) {
          existing.labels.push(label);
        }
      };
      const byIndex = session2.citationsByIndex;
      if (byIndex && typeof byIndex === "object") {
        const sortedKeys = Object.keys(byIndex).filter((k) => VALID_INDEX_KEY_RE.test(k)).sort((a, b) => Number(a) - Number(b));
        for (const key of sortedKeys) {
          const cit = byIndex[key];
          const cItems = Array.isArray(cit?.citationItems) ? cit.citationItems : [];
          const shortText = cit?.properties?.plainCitation ?? cit?.properties?.formattedCitation ?? cit?.text ?? "";
          for (const ci of cItems) {
            const itemID = Number(ci?.id ?? ci?.itemID ?? 0);
            const explicitOrdinal = Number(ci?.ordinal ?? ci?.citationNumber ?? 0);
            recordHit(itemID, shortText, explicitOrdinal > 0 ? explicitOrdinal : void 0, true);
          }
        }
      }
      const byItem = session2.citationsByItemID;
      if (byItem && typeof byItem === "object") {
        for (const [rawID, list] of Object.entries(byItem)) {
          const itemID = Number(rawID);
          const entries = Array.isArray(list) ? list : [list];
          for (const entry of entries) {
            if (!entry) continue;
            const shortText = entry.properties?.plainCitation ?? entry.properties?.formattedCitation ?? entry.text ?? "";
            recordHit(itemID, shortText);
          }
        }
      }
      return [...ordinalMap.entries()].map(([itemID, info]) => ({ itemID, ordinal: info.ordinal, shortText: info.labels.join(", "), occurrences: info.occurrences }));
    }
    scheduleItemsViewRefresh() {
      if (this.viewRefreshTimer !== null) return;
      const delay = this.kernel.prefs.get("wordCite.itemsViewRefreshDebounceMs");
      this.viewRefreshTimer = setTimeout(() => {
        this.viewRefreshTimer = null;
        const wins = globalThis.Zotero?.getMainWindows?.() || [];
        for (const win of wins) {
          try {
            const iv = win.ZoteroPane?.itemsView;
            if (!iv) continue;
            if (typeof iv.invalidateRowCache === "function" && typeof iv.tree?.invalidate === "function") {
              iv.invalidateRowCache(true);
              iv.tree.invalidate();
            } else if (typeof iv.refreshAndMaintainSelection === "function") {
              void Promise.resolve(iv.refreshAndMaintainSelection()).catch(() => {
              });
            } else {
              iv.refresh?.();
            }
          } catch {
          }
        }
      }, Math.max(20, delay));
    }
    installHooks() {
      const integration = globalThis.Zotero?.Integration;
      if (!integration) return;
      if (typeof integration.getSession === "function" && !this.unpatchGetSession) {
        this.unpatchGetSession = this.kernel.runtime.patch(
          integration,
          "getSession",
          "Zotero.Integration",
          (orig) => async (...args) => {
            const [, doc] = args;
            const res = await Promise.resolve(orig.apply(integration, args));
            const sessionObj = Array.isArray(res) ? res[0] : res;
            const sid = typeof sessionObj?.sessionID === "string" ? sessionObj.sessionID : "";
            if (sid) {
              const candidate = this.extractDirectDocCandidate(sessionObj, doc) || this.pendingCmdDocHint;
              if (candidate) this.docPathBySession.set(sid, candidate);
            }
            return res;
          }
        );
      }
      if (typeof integration.execCommand === "function" && !this.unpatchExec) {
        this.unpatchExec = this.kernel.runtime.patch(
          integration,
          "execCommand",
          "Zotero.Integration",
          (orig) => async (...args) => {
            const [, , docId] = args;
            if (typeof docId === "string" && docId.trim() && docId.trim() !== "__doc__") {
              this.pendingCmdDocHint = docId.trim();
            }
            this.execDepth++;
            try {
              return await Promise.resolve(orig.apply(integration, args));
            } finally {
              this.execDepth = Math.max(0, this.execDepth - 1);
              this.pendingCmdDocHint = "";
              this.idleRounds = 0;
              if (this.postExecTimer !== null) clearTimeout(this.postExecTimer);
              this.postExecTimer = setTimeout(() => {
                this.postExecTimer = null;
                if (this.running) void this.pollOnce();
              }, 150);
            }
          }
        );
      }
    }
    scheduleNext() {
      if (!this.running) return;
      const delay = this.idleRounds >= 10 ? 5e3 : this.idleRounds >= 4 ? 3e3 : 1200;
      this.timer = setTimeout(() => {
        this.timer = null;
        if (!this.running) return;
        void this.pollOnce().catch((err) => this.kernel.logger.error("word-cite:poll", err)).finally(() => {
          if (this.running) this.scheduleNext();
        });
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
    collections;
    column;
    poller;
    disposables = new DisposableStack();
    tagDebounceTimer = null;
    active = false;
    kernel;
    constructor(kernel, services) {
      this.kernel = kernel;
      this.tracker = new WordSessionTracker(kernel.bus, services.win32);
      this.tagGovernance = new CitationTagGovernance(kernel.prefs);
      this.collections = new WordCitationCollectionManager(kernel);
      this.poller = new WordIntegrationPoller(kernel, this.tracker, services.win32);
      this.dragCite = new DragCiteController(kernel, services.win32, (session2) => {
        void this.poller.notifyCommittedSession(session2).catch((err) => this.kernel.logger.error("word-cite:poll", err));
      });
      this.column = new CitationColumnController(kernel, this.tracker, this.collections);
    }
    isActive() {
      return this.active;
    }
    async citeCurrentSelection(win) {
      const items = resolveActiveSelectionForWord(win);
      if (items.length) await this.dragCite.insertItems(items);
    }
    async resyncNow() {
      if (!this.active) return false;
      const ok = await this.poller.notifyCommittedSession();
      this.tracker.emitCurrentSnapshot();
      return ok;
    }
    start() {
      if (this.active) return;
      this.active = true;
      this.disposables.reset();
      void this.collections.purgeStaleCollections();
      if (this.kernel.prefs.get("wordCite.column.enable")) this.column.register();
      this.poller.start();
      this.disposables.add(
        this.kernel.prefs.observeKeys(["wordCite.column.enable"], () => {
          if (!this.active) return;
          if (this.kernel.prefs.get("wordCite.column.enable")) this.column.register();
          else this.column.unregister();
        })
      );
      this.disposables.add(
        this.kernel.bus.on("citation:snapshot-updated", () => {
          this.scheduleTagSync();
          this.collections.sync(this.tracker.getAllSessions());
        })
      );
      this.disposables.add(
        this.kernel.prefs.observeKeys(
          ["wordCite.citationTags.enable", "wordCite.citationTags.text"],
          () => this.scheduleTagSync()
        )
      );
      this.disposables.add(
        this.kernel.prefs.observeKeys(
          ["wordCite.collections.enable"],
          () => this.collections.sync(this.tracker.getAllSessions())
        )
      );
      this.disposables.add(
        this.kernel.bus.on("word:insert-items-request", async ({ itemIDs, requestId }) => {
          if (!this.active) return;
          let itemCount = 0;
          let documentName = "";
          let status = "unavailable";
          try {
            const hostItems = globalThis.Zotero?.Items;
            const { items } = deduplicateRegularItems(itemIDs.map((id) => hostItems?.get?.(id)));
            itemCount = items.length;
            status = await this.dragCite.insertItems(items, (sessionID) => {
              documentName = this.tracker.getAllSessions().find((session2) => session2.sessionID === sessionID)?.displayName || "";
            });
          } catch (err) {
            this.kernel.logger.error("word-cite:insert-request", err);
          }
          this.kernel.bus.emit("word:insert-result", { requestId, status, documentName, itemCount });
        })
      );
      this.disposables.add(
        this.kernel.bus.on("word:refresh-request", async ({ requestId }) => {
          if (!this.active) return;
          const docName = this.tracker.getActiveSession()?.displayName || "";
          const ok = await refreshActiveWordDocument(this.kernel);
          if (ok) {
            void this.poller.notifyCommittedSession().catch((err) => this.kernel.logger.error("word-cite:poll", err));
          }
          this.kernel.bus.emit("word:refresh-result", { requestId, ok, documentName: docName });
        })
      );
      this.disposables.add(
        this.kernel.bus.on("word:snapshot-query", () => {
          if (this.active) this.tracker.emitCurrentSnapshot();
        })
      );
      this.disposables.add(
        this.kernel.bus.on("word:switch-session-request", ({ sessionID }) => {
          if (this.active && !this.tracker.setActiveSession(sessionID)) {
            this.tracker.emitCurrentSnapshot();
          }
        })
      );
      this.disposables.add(
        this.kernel.bus.on("word:select-collection-request", ({ sessionID, win }) => {
          if (!this.active) return;
          const sid = sessionID || this.tracker.getActiveSession()?.sessionID || null;
          this.collections.selectSessionCollection(win, sid);
        })
      );
    }
    onMainWindowLoad(win) {
      if (!this.active) return;
      this.dragCite.attachWindow(win);
      this.collections.attachWindow(win);
    }
    onMainWindowUnload(win) {
      this.dragCite.detachWindow(win);
      this.collections.detachWindow(win);
    }
    stop() {
      if (!this.active) return;
      this.active = false;
      if (this.tagDebounceTimer !== null) {
        clearTimeout(this.tagDebounceTimer);
        this.tagDebounceTimer = null;
      }
      this.poller.stop();
      this.column.unregister();
      this.dragCite.disposeAll();
      void this.collections.clearAll();
      this.tracker.clear();
      this.disposables.disposeAll();
    }
    scheduleTagSync() {
      if (this.tagDebounceTimer !== null) clearTimeout(this.tagDebounceTimer);
      const delay = this.kernel.prefs.get("wordCite.citationTagDebounceMs");
      this.tagDebounceTimer = setTimeout(() => {
        this.tagDebounceTimer = null;
        if (!this.active) return;
        void this.tagGovernance.syncCitedItems(this.tracker.getUnionCitedItemIDs());
      }, Math.max(0, delay));
    }
  };

  // src/domains/workspace/spotlight-engine.ts
  var WorkspaceSpotlightEngine = class {
    providers = /* @__PURE__ */ new Set();
    prefs;
    store;
    tabs;
    constructor(prefs, store, tabs) {
      this.prefs = prefs;
      this.store = store;
      this.tabs = tabs;
    }
    registerProvider(provider) {
      this.providers.add(provider);
      return () => {
        this.providers.delete(provider);
      };
    }
    query(rawTerm, win) {
      const term = rawTerm.trim().toLowerCase();
      if (term.startsWith(">") && term !== ">tabs" && term !== ">recent") {
        const command = term.slice(1).trim();
        const results2 = this.filterBuiltInCommands(command, win);
        for (const provider of this.providers) {
          try {
            results2.push(...provider.query(command, win));
          } catch {
          }
        }
        return results2.slice(0, 40);
      }
      const tabList = term === ">tabs" || term === ">recent";
      const needle = tabList ? "" : term;
      const results = [];
      const limit = term ? 40 : 12;
      const nativeTabs = win.Zotero_Tabs?._tabs || [];
      const viewedAt = (tab) => this.store.state.lastViewedAt[tab.data?.itemID ? "item:" + tab.data.itemID : "tab:" + tab.id] || 0;
      const source = tabList ? [...nativeTabs].sort((a, b) => viewedAt(b) - viewedAt(a)) : nativeTabs;
      for (const tab of source) {
        if (tab.type === "library") continue;
        const key = tab.data?.itemID ? "item:" + tab.data.itemID : "tab:" + tab.id;
        const title = tab.title || key;
        const remark = this.prefs.get("workspace.enableTabRemarks") ? this.store.state.remarks[key] || "" : "";
        if (needle && !(title + " " + remark).toLowerCase().includes(needle)) continue;
        results.push({
          id: "tab:" + key,
          category: "tab",
          title,
          subtitle: remark,
          action: () => {
            this.tabs.selectTab(win, tab.id);
          }
        });
        if (results.length === limit) return results;
      }
      if (!needle) return results;
      for (const group2 of this.store.state.groups) {
        if (!group2.name.toLowerCase().includes(needle)) continue;
        results.push({
          id: "group:" + group2.id,
          category: "collection",
          title: group2.name,
          badge: "分组",
          action: () => {
            this.store.setCollapsed(group2.id, false);
            const first = this.tabs.buildTrackedTabs(win).find((tab) => !tab.virtual && tab.groupId === group2.id);
            if (first) this.tabs.selectTab(win, first.tabID);
          }
        });
        if (results.length === limit) return results;
      }
      if (this.prefs.get("workspace.enableSessions")) {
        for (const session2 of this.store.state.sessions) {
          if (session2.isTemplate || !session2.name.toLowerCase().includes(needle)) continue;
          results.push({
            id: "session:" + session2.id,
            category: "collection",
            title: session2.name,
            badge: "工作区",
            action: () => {
              void this.tabs.restoreSession(win, session2, true);
            }
          });
          if (results.length === limit) return results;
        }
      }
      if (needle.length >= 2 && !needle.startsWith("@")) {
        for (const cmd of this.filterBuiltInCommands(needle, win)) {
          results.push(cmd);
          if (results.length === limit) break;
        }
      }
      return results;
    }
    filterBuiltInCommands(command, win) {
      return this.buildBuiltInCommands(win).filter((item) => (item.title + " " + item.subtitle).toLowerCase().includes(command));
    }
    buildBuiltInCommands(win) {
      return [
        {
          id: "cmd:auto-group",
          category: "command",
          title: "> 按集合自动分组当前标签页",
          subtitle: "为未分组的阅读标签页按所属 Zotero 集合归组",
          badge: "命令",
          action: () => {
            this.tabs.autoGroupByCollection(win);
          }
        },
        {
          id: "cmd:pub-group",
          category: "command",
          title: "> 按期刊 / 会议自动归组同期刊文献",
          subtitle: "将同源期刊/会议（>=2篇）的未分组标签自动归组",
          badge: "命令",
          action: () => {
            for (const sug of this.tabs.getPublicationSuggestions(win)) {
              const grp = this.store.state.groups.find((g) => g.name === sug.venue) ?? this.store.createGroup(sug.venue);
              for (const k of sug.keys) this.store.assignToGroup(k, grp.id);
            }
          }
        },
        {
          id: "cmd:sleep-inactive",
          category: "command",
          title: "> 休眠所有非活动标签页",
          subtitle: "卸载后台未固定的阅读器以释放内存",
          badge: "命令",
          action: () => {
            this.tabs.sleepInactiveTabs(win);
          }
        },
        {
          id: "cmd:toggle-sidebar",
          category: "command",
          title: "> 切换左侧竖版工作区侧栏",
          subtitle: "展开或收起 Zotero 左侧文献工作区面板",
          badge: "命令",
          action: () => {
            const cur = this.prefs.get("workspace.enableVerticalSidebar") && !this.prefs.get("workspace.verticalSidebarCollapsed");
            if (!this.prefs.get("workspace.enableVerticalSidebar")) {
              this.prefs.set("workspace.enableVerticalSidebar", true);
              this.prefs.set("workspace.verticalSidebarCollapsed", false);
            } else {
              this.prefs.set("workspace.verticalSidebarCollapsed", cur);
            }
          }
        },
        {
          id: "cmd:toggle-compact-topbar",
          category: "command",
          title: "> 切换顶部横栏精简模式",
          subtitle: "在完整横向分栏与精简标签栏间切换",
          badge: "命令",
          action: () => {
            this.prefs.set("workspace.compactTopBar", !this.prefs.get("workspace.compactTopBar"));
          }
        },
        {
          id: "cmd:save-snapshot",
          category: "command",
          title: "> 保存当前工作区快照",
          subtitle: "保存当前所有分组、固定标签与备注配置",
          badge: "命令",
          action: () => {
            this.store.saveSession(`快照 ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`, { openKeys: this.tabs.openKeys(win) });
          }
        },
        {
          id: "cmd:copy-active-citation",
          category: "command",
          title: "> 复制当前阅读文献的标准引文",
          subtitle: "复制当前标签页文献的 CSL 引文并自动记入反查历史",
          badge: "命令",
          action: () => {
            const selID = String(win.Zotero_Tabs?.selectedID || "");
            if (selID) void this.tabs.copyTabCitation(win, selID);
          }
        },
        {
          id: "cmd:undo-close",
          category: "command",
          title: "> 恢复最近关闭的标签页",
          subtitle: "重新打开刚才关闭的文献阅读器",
          badge: "命令",
          action: () => {
            this.tabs.undoCloseTab(win);
          }
        },
        ...this.prefs.get("workspace.enableAnnotationMatrix") ? [{
          id: "cmd:open-annotation-matrix",
          category: "command",
          title: "> 生成已开文献对比矩阵",
          subtitle: "按标注颜色维度汇总当前打开文献的批注，支持导出与插入 Word",
          badge: "矩阵",
          action: () => {
            this.tabs.openGroupAnnotationMatrix(win);
          }
        }] : []
      ];
    }
  };

  // src/domains/workspace/reader-neighbors.ts
  function toNeighborRef(tab) {
    return {
      tabID: tab.tabID,
      itemID: tab.itemID,
      parentItemID: tab.parentItemID,
      title: tab.shortTitle || tab.title || tab.filename || `文献 #${tab.itemID}`
    };
  }
  function computeReaderNeighbors(win, tracked) {
    const activeTabID = String(win.Zotero_Tabs?.selectedID || "");
    if (!activeTabID || activeTabID === "zotero-pane") {
      return { activeTabID };
    }
    const readers = tracked.filter((t) => !t.virtual && t.tabID && t.itemID > 0 && t.type.startsWith("reader"));
    const idx = readers.findIndex((t) => t.tabID === activeTabID);
    if (idx < 0) return { activeTabID };
    return {
      activeTabID,
      left: idx > 0 ? toNeighborRef(readers[idx - 1]) : void 0,
      right: idx + 1 < readers.length ? toNeighborRef(readers[idx + 1]) : void 0
    };
  }
  function neighborFingerprint(payload) {
    return [
      payload.activeTabID,
      payload.left ? `${payload.left.tabID}:${payload.left.itemID}` : "",
      payload.right ? `${payload.right.tabID}:${payload.right.itemID}` : ""
    ].join("|");
  }
  var ReaderNeighborPublisher = class {
    lastFp = "";
    bus;
    constructor(bus) {
      this.bus = bus;
    }
    publish(win, tracked, force = false) {
      if (!win) return;
      const payload = computeReaderNeighbors(win, tracked);
      const fp = neighborFingerprint(payload);
      if (!force && fp === this.lastFp) return;
      this.lastFp = fp;
      this.bus.emit("workspace:reader-neighbors-updated", payload);
    }
    reset() {
      this.lastFp = "";
    }
  };

  // node_modules/valibot/dist/index.mjs
  var store$4;
  var DEFAULT_CONFIG = {
    lang: void 0,
    message: void 0,
    abortEarly: void 0,
    abortPipeEarly: void 0
  };
  // @__NO_SIDE_EFFECTS__
  function getGlobalConfig(config$1) {
    if (!config$1 && !store$4) return DEFAULT_CONFIG;
    return {
      lang: config$1?.lang ?? store$4?.lang,
      message: config$1?.message,
      abortEarly: config$1?.abortEarly ?? store$4?.abortEarly,
      abortPipeEarly: config$1?.abortPipeEarly ?? store$4?.abortPipeEarly
    };
  }
  var store$3;
  // @__NO_SIDE_EFFECTS__
  function getGlobalMessage(lang) {
    return store$3?.get(lang);
  }
  var store$2;
  // @__NO_SIDE_EFFECTS__
  function getSchemaMessage(lang) {
    return store$2?.get(lang);
  }
  var store$1;
  // @__NO_SIDE_EFFECTS__
  function getSpecificMessage(reference, lang) {
    return store$1?.get(reference)?.get(lang);
  }
  // @__NO_SIDE_EFFECTS__
  function _stringify(input) {
    const type = typeof input;
    if (type === "string") return `"${input}"`;
    if (type === "number" || type === "bigint" || type === "boolean") return `${input}`;
    if (type === "object" || type === "function") return (input && Object.getPrototypeOf(input)?.constructor?.name) ?? "null";
    return type;
  }
  function _addIssue(context, label, dataset, config$1, other) {
    const input = other && "input" in other ? other.input : dataset.value;
    const expected = other?.expected ?? context.expects ?? null;
    const received = other?.received ?? /* @__PURE__ */ _stringify(input);
    const issue = {
      kind: context.kind,
      type: context.type,
      input,
      expected,
      received,
      message: `Invalid ${label}: ${expected ? `Expected ${expected} but r` : "R"}eceived ${received}`,
      requirement: context.requirement,
      path: other?.path,
      issues: other?.issues,
      lang: config$1.lang,
      abortEarly: config$1.abortEarly,
      abortPipeEarly: config$1.abortPipeEarly
    };
    const isSchema = context.kind === "schema";
    const message$1 = other?.message ?? context.message ?? /* @__PURE__ */ getSpecificMessage(context.reference, issue.lang) ?? (isSchema ? /* @__PURE__ */ getSchemaMessage(issue.lang) : null) ?? config$1.message ?? /* @__PURE__ */ getGlobalMessage(issue.lang);
    if (message$1 !== void 0) issue.message = typeof message$1 === "function" ? message$1(issue) : message$1;
    if (isSchema) dataset.typed = false;
    if (dataset.issues) dataset.issues.push(issue);
    else dataset.issues = [issue];
  }
  // @__NO_SIDE_EFFECTS__
  function _isSameValueZero(value1, value2) {
    return value1 === value2 || Number.isNaN(value1) && Number.isNaN(value2);
  }
  // @__NO_SIDE_EFFECTS__
  function _isValidObjectKey(object$1, key) {
    return Object.prototype.hasOwnProperty.call(object$1, key) && key !== "__proto__" && key !== "prototype" && key !== "constructor";
  }
  // @__NO_SIDE_EFFECTS__
  function _joinExpects(values$1, separator) {
    const list = [...new Set(values$1)];
    if (list.length > 1) return `(${list.join(` ${separator} `)})`;
    return list[0] ?? "never";
  }
  function _standardSchema(schema) {
    schema["~standard"] = {
      version: 1,
      vendor: "valibot",
      validate: (value$1) => schema["~run"]({ value: value$1 }, /* @__PURE__ */ getGlobalConfig())
    };
    return schema;
  }
  var ValiError = class extends Error {
    /**
    * Creates a Valibot error with useful information.
    *
    * @param issues The error issues.
    */
    constructor(issues) {
      super(issues[0].message);
      this.name = "ValiError";
      this.issues = issues;
    }
  };
  var EMOJI_REGEX = new RegExp("^(?:[\\u{1F1E6}-\\u{1F1FF}]{2}|\\u{1F3F4}[\\u{E0061}-\\u{E007A}]{2}[\\u{E0030}-\\u{E0039}\\u{E0061}-\\u{E007A}]{1,3}\\u{E007F}|(?:\\p{Emoji}\\uFE0F\\u20E3?|\\p{Emoji_Modifier_Base}\\p{Emoji_Modifier}?|(?![\\p{Emoji_Modifier_Base}\\u{1F1E6}-\\u{1F1FF}])\\p{Emoji_Presentation})(?:\\u200D(?:\\p{Emoji}\\uFE0F\\u20E3?|\\p{Emoji_Modifier_Base}\\p{Emoji_Modifier}?|(?![\\p{Emoji_Modifier_Base}\\u{1F1E6}-\\u{1F1FF}])\\p{Emoji_Presentation}))*)+$", "u");
  // @__NO_SIDE_EFFECTS__
  function minValue(requirement, message$1) {
    return {
      kind: "validation",
      type: "min_value",
      reference: minValue,
      async: false,
      expects: `>=${requirement instanceof Date ? requirement.toJSON() : /* @__PURE__ */ _stringify(requirement)}`,
      requirement,
      message: message$1,
      "~run"(dataset, config$1) {
        if (dataset.typed && !(dataset.value >= this.requirement)) _addIssue(this, "value", dataset, config$1, { received: dataset.value instanceof Date ? dataset.value.toJSON() : /* @__PURE__ */ _stringify(dataset.value) });
        return dataset;
      }
    };
  }
  // @__NO_SIDE_EFFECTS__
  function getFallback(schema, dataset, config$1) {
    return typeof schema.fallback === "function" ? schema.fallback(dataset, config$1) : schema.fallback;
  }
  // @__NO_SIDE_EFFECTS__
  function getDefault(schema, dataset, config$1) {
    return typeof schema.default === "function" ? schema.default(dataset, config$1) : schema.default;
  }
  // @__NO_SIDE_EFFECTS__
  function array(item, message$1) {
    return _standardSchema({
      kind: "schema",
      type: "array",
      reference: array,
      expects: "Array",
      async: false,
      item,
      message: message$1,
      "~run"(dataset, config$1) {
        const input = dataset.value;
        if (Array.isArray(input)) {
          dataset.typed = true;
          dataset.value = [];
          for (let key = 0; key < input.length; key++) {
            const value$1 = input[key];
            const itemDataset = this.item["~run"]({ value: value$1 }, config$1);
            if (itemDataset.issues) {
              const pathItem = {
                type: "array",
                origin: "value",
                input,
                key,
                value: value$1
              };
              for (const issue of itemDataset.issues) {
                if (issue.path) issue.path.unshift(pathItem);
                else issue.path = [pathItem];
                dataset.issues?.push(issue);
              }
              if (!dataset.issues) dataset.issues = itemDataset.issues;
              if (config$1.abortEarly) {
                dataset.typed = false;
                break;
              }
            }
            if (!itemDataset.typed) dataset.typed = false;
            dataset.value.push(itemDataset.value);
          }
        } else _addIssue(this, "type", dataset, config$1);
        return dataset;
      }
    });
  }
  // @__NO_SIDE_EFFECTS__
  function boolean(message$1) {
    return _standardSchema({
      kind: "schema",
      type: "boolean",
      reference: boolean,
      expects: "boolean",
      async: false,
      message: message$1,
      "~run"(dataset, config$1) {
        if (typeof dataset.value === "boolean") dataset.typed = true;
        else _addIssue(this, "type", dataset, config$1);
        return dataset;
      }
    });
  }
  // @__NO_SIDE_EFFECTS__
  function literal(literal_, message$1) {
    return _standardSchema({
      kind: "schema",
      type: "literal",
      reference: literal,
      expects: /* @__PURE__ */ _stringify(literal_),
      async: false,
      literal: literal_,
      message: message$1,
      "~run"(dataset, config$1) {
        if (/* @__PURE__ */ _isSameValueZero(dataset.value, this.literal)) dataset.typed = true;
        else _addIssue(this, "type", dataset, config$1);
        return dataset;
      }
    });
  }
  // @__NO_SIDE_EFFECTS__
  function number(message$1) {
    return _standardSchema({
      kind: "schema",
      type: "number",
      reference: number,
      expects: "number",
      async: false,
      message: message$1,
      "~run"(dataset, config$1) {
        if (typeof dataset.value === "number" && !isNaN(dataset.value)) dataset.typed = true;
        else _addIssue(this, "type", dataset, config$1);
        return dataset;
      }
    });
  }
  // @__NO_SIDE_EFFECTS__
  function optional(wrapped, default_) {
    return _standardSchema({
      kind: "schema",
      type: "optional",
      reference: optional,
      expects: `(${wrapped.expects} | undefined)`,
      async: false,
      wrapped,
      default: default_,
      "~run"(dataset, config$1) {
        if (dataset.value === void 0) {
          if (this.default !== void 0) dataset.value = /* @__PURE__ */ getDefault(this, dataset, config$1);
          if (dataset.value === void 0) {
            dataset.typed = true;
            return dataset;
          }
        }
        return this.wrapped["~run"](dataset, config$1);
      }
    });
  }
  // @__NO_SIDE_EFFECTS__
  function picklist(options, message$1) {
    return _standardSchema({
      kind: "schema",
      type: "picklist",
      reference: picklist,
      expects: /* @__PURE__ */ _joinExpects(options.map(_stringify), "|"),
      async: false,
      options,
      message: message$1,
      "~run"(dataset, config$1) {
        if (this.options.includes(dataset.value)) dataset.typed = true;
        else _addIssue(this, "type", dataset, config$1);
        return dataset;
      }
    });
  }
  // @__NO_SIDE_EFFECTS__
  function record(key, value$1, message$1) {
    return _standardSchema({
      kind: "schema",
      type: "record",
      reference: record,
      expects: "Object",
      async: false,
      key,
      value: value$1,
      message: message$1,
      "~run"(dataset, config$1) {
        const input = dataset.value;
        if (input && typeof input === "object") {
          dataset.typed = true;
          dataset.value = {};
          for (const entryKey in input) if (/* @__PURE__ */ _isValidObjectKey(input, entryKey)) {
            const entryValue = input[entryKey];
            const keyDataset = this.key["~run"]({ value: entryKey }, config$1);
            if (keyDataset.issues) {
              const pathItem = {
                type: "object",
                origin: "key",
                input,
                key: entryKey,
                value: entryValue
              };
              for (const issue of keyDataset.issues) {
                issue.path = [pathItem];
                dataset.issues?.push(issue);
              }
              if (!dataset.issues) dataset.issues = keyDataset.issues;
              if (config$1.abortEarly) {
                dataset.typed = false;
                break;
              }
            }
            const valueDataset = this.value["~run"]({ value: entryValue }, config$1);
            if (valueDataset.issues) {
              const pathItem = {
                type: "object",
                origin: "value",
                input,
                key: entryKey,
                value: entryValue
              };
              for (const issue of valueDataset.issues) {
                if (issue.path) issue.path.unshift(pathItem);
                else issue.path = [pathItem];
                dataset.issues?.push(issue);
              }
              if (!dataset.issues) dataset.issues = valueDataset.issues;
              if (config$1.abortEarly) {
                dataset.typed = false;
                break;
              }
            }
            if (!keyDataset.typed || !valueDataset.typed) dataset.typed = false;
            if (keyDataset.typed) dataset.value[keyDataset.value] = valueDataset.value;
          }
        } else _addIssue(this, "type", dataset, config$1);
        return dataset;
      }
    });
  }
  // @__NO_SIDE_EFFECTS__
  function strictObject(entries$1, message$1) {
    return _standardSchema({
      kind: "schema",
      type: "strict_object",
      reference: strictObject,
      expects: "Object",
      async: false,
      entries: entries$1,
      message: message$1,
      "~run"(dataset, config$1) {
        const input = dataset.value;
        if (input && typeof input === "object") {
          dataset.typed = true;
          dataset.value = {};
          for (const key in this.entries) {
            const valueSchema = this.entries[key];
            if (key in input || (valueSchema.type === "exact_optional" || valueSchema.type === "optional" || valueSchema.type === "nullish") && valueSchema.default !== void 0) {
              const value$1 = key in input ? input[key] : /* @__PURE__ */ getDefault(valueSchema);
              const valueDataset = valueSchema["~run"]({ value: value$1 }, config$1);
              if (valueDataset.issues) {
                const pathItem = {
                  type: "object",
                  origin: "value",
                  input,
                  key,
                  value: value$1
                };
                for (const issue of valueDataset.issues) {
                  if (issue.path) issue.path.unshift(pathItem);
                  else issue.path = [pathItem];
                  dataset.issues?.push(issue);
                }
                if (!dataset.issues) dataset.issues = valueDataset.issues;
                if (config$1.abortEarly) {
                  dataset.typed = false;
                  break;
                }
              }
              if (!valueDataset.typed) dataset.typed = false;
              dataset.value[key] = valueDataset.value;
            } else if (valueSchema.fallback !== void 0) dataset.value[key] = /* @__PURE__ */ getFallback(valueSchema);
            else if (valueSchema.type !== "exact_optional" && valueSchema.type !== "optional" && valueSchema.type !== "nullish") {
              _addIssue(this, "key", dataset, config$1, {
                input: void 0,
                expected: `"${key}"`,
                path: [{
                  type: "object",
                  origin: "key",
                  input,
                  key,
                  value: input[key]
                }]
              });
              if (config$1.abortEarly) break;
            }
          }
          if (!dataset.issues || !config$1.abortEarly) {
            for (const key in input) if (!Object.prototype.hasOwnProperty.call(this.entries, key)) {
              _addIssue(this, "key", dataset, config$1, {
                input: key,
                expected: "never",
                path: [{
                  type: "object",
                  origin: "key",
                  input,
                  key,
                  value: input[key]
                }]
              });
              break;
            }
          }
        } else _addIssue(this, "type", dataset, config$1);
        return dataset;
      }
    });
  }
  // @__NO_SIDE_EFFECTS__
  function string(message$1) {
    return _standardSchema({
      kind: "schema",
      type: "string",
      reference: string,
      expects: "string",
      async: false,
      message: message$1,
      "~run"(dataset, config$1) {
        if (typeof dataset.value === "string") dataset.typed = true;
        else _addIssue(this, "type", dataset, config$1);
        return dataset;
      }
    });
  }
  function parse(schema, input, config$1) {
    const dataset = schema["~run"]({ value: input }, /* @__PURE__ */ getGlobalConfig(config$1));
    if (dataset.issues) throw new ValiError(dataset.issues);
    return dataset.value;
  }
  // @__NO_SIDE_EFFECTS__
  function pipe(...pipe$1) {
    return _standardSchema({
      ...pipe$1[0],
      pipe: pipe$1,
      "~run"(dataset, config$1) {
        for (const item of pipe$1) if (item.kind !== "metadata") {
          if (dataset.issues && (item.kind === "schema" || item.kind === "transformation")) {
            dataset.typed = false;
            break;
          }
          if (!dataset.issues || !config$1.abortEarly && !config$1.abortPipeEarly) dataset = item["~run"](dataset, config$1);
        }
        return dataset;
      }
    });
  }

  // src/domains/workspace/workspace-schema.ts
  var text = string();
  var keys = array(text);
  var optionalText = optional(text);
  var count = pipe(number(), minValue(0));
  var strings = record(text, text);
  var group = strictObject({ id: text, name: text, color: text, memberKeys: keys });
  var virtualMember = strictObject({
    key: text,
    itemID: count,
    parentItemID: optional(count),
    title: text,
    shortTitle: optionalText,
    filename: optionalText,
    source: optionalText,
    creatorYear: optionalText,
    collection: optionalText,
    type: text
  });
  var remarkMode = picklist(["both", "remark", "title"]);
  var session = strictObject({
    id: text,
    name: text,
    createdAt: count,
    isTemplate: optional(boolean()),
    scopedGroupId: optionalText,
    kind: optional(picklist(["manual", "template", "rolling", "pre-replace"])),
    groups: array(group),
    pinnedKeys: keys,
    openKeys: keys,
    remarks: strings,
    collapsed: keys,
    virtualMembers: record(text, virtualMember),
    remarkModes: record(text, remarkMode)
  });
  var progress = strictObject({
    readSeconds: count,
    lastPage: optional(count),
    totalPages: optional(count),
    pageSeconds: optional(record(text, count))
  });
  var document = strictObject({
    version: literal(2),
    groups: array(group),
    collapsed: keys,
    pinnedKeys: keys,
    sleepingKeys: keys,
    remarks: strings,
    remarkModes: record(text, remarkMode),
    lastViewedAt: record(text, count),
    readingProgress: record(text, progress),
    virtualMembers: record(text, virtualMember),
    sessions: array(session),
    rollingSessions: array(session)
  });
  var backup = strictObject({ format: literal("zotero-bridgeflow-workspace"), version: literal(2), state: document });
  var readingNotesDocument = strictObject({
    remarks: strings,
    remarkModes: record(text, remarkMode),
    lastViewedAt: record(text, count),
    readingProgress: record(text, progress)
  });
  var readingNotesBackup = strictObject({
    format: literal("zotero-bridgeflow-reading-notes"),
    version: literal(1),
    state: readingNotesDocument
  });
  var readingProgressDocument = strictObject({
    lastViewedAt: record(text, count),
    readingProgress: record(text, progress)
  });
  var readingProgressBackup = strictObject({
    format: literal("zotero-bridgeflow-reading-progress"),
    version: literal(1),
    state: readingProgressDocument
  });
  var briefNotesDocument = strictObject({
    remarks: strings,
    remarkModes: record(text, remarkMode)
  });
  var briefNotesBackup = strictObject({
    format: literal("zotero-bridgeflow-brief-notes"),
    version: literal(1),
    state: briefNotesDocument
  });
  function readWorkspace(raw) {
    return parse(document, JSON.parse(raw));
  }
  function readBackup(raw) {
    return parse(backup, JSON.parse(raw)).state;
  }
  function readReadingNotesBackup(raw) {
    return parse(readingNotesBackup, JSON.parse(raw)).state;
  }
  function readReadingProgressBackup(raw) {
    return parse(readingProgressBackup, JSON.parse(raw)).state;
  }
  function readBriefNotesBackup(raw) {
    return parse(briefNotesBackup, JSON.parse(raw)).state;
  }
  function pickWorkspaceLayoutState(state) {
    return {
      version: 2,
      groups: state.groups,
      collapsed: state.collapsed,
      pinnedKeys: state.pinnedKeys,
      sleepingKeys: state.sleepingKeys,
      remarks: {},
      remarkModes: {},
      lastViewedAt: {},
      readingProgress: {},
      virtualMembers: state.virtualMembers,
      sessions: state.sessions,
      rollingSessions: state.rollingSessions
    };
  }
  function pickReadingNotesState(state) {
    return {
      remarks: state.remarks || {},
      remarkModes: state.remarkModes || {},
      lastViewedAt: state.lastViewedAt || {},
      readingProgress: state.readingProgress || {}
    };
  }
  function pickReadingProgressState(state) {
    return {
      lastViewedAt: state.lastViewedAt || {},
      readingProgress: state.readingProgress || {}
    };
  }
  function pickBriefNotesState(state) {
    return {
      remarks: state.remarks || {},
      remarkModes: state.remarkModes || {}
    };
  }
  function hasLegacyReadingNotes(state) {
    if (!state) return false;
    return Boolean(
      Object.keys(state.remarks || {}).length || Object.keys(state.remarkModes || {}).length || Object.keys(state.lastViewedAt || {}).length || Object.keys(state.readingProgress || {}).length
    );
  }

  // src/services/cache-directory.ts
  function cacheDirectory(custom) {
    if (typeof custom === "string" && custom.trim()) return custom.trim();
    const host2 = globalThis;
    const data = host2.Zotero?.DataDirectory?.dir;
    return data ? cacheFile(data, "bridgeflow-cache") : "bridgeflow-cache";
  }
  function cacheFile(directory, name) {
    return globalThis.PathUtils?.join(directory, name) ?? directory + "/" + name;
  }

  // src/domains/workspace/workspace-disk-cache.ts
  var WorkspaceDiskCache = class {
    flushTimer = null;
    flushing = null;
    lastWrittenJson = "";
    lastError = "";
    constructor(privateDirectory = "") {
      this.directory = cacheDirectory(privateDirectory);
    }
    directory;
    getDirectoryPath() {
      return this.directory;
    }
    getFilePath() {
      return cacheFile(this.directory, "workspace-snapshots.json");
    }
    getBackupFilePath() {
      return cacheFile(this.directory, "workspace-snapshots.bak.json");
    }
    scheduleSave(state, immediate = false, serialized) {
      const ioUtils = globalThis.IOUtils;
      if (!ioUtils?.writeUTF8) return;
      if (this.flushTimer !== null) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      if (immediate) {
        void this.flushNow(state, serialized);
        return;
      }
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flushNow(state, serialized);
      }, 320);
    }
    async flushNow(state, _serialized) {
      const ioUtils = globalThis.IOUtils;
      if (!ioUtils?.writeUTF8) return true;
      const payload = `${JSON.stringify({ format: "zotero-bridgeflow-workspace", version: 2, state }, null, 2)}
`;
      const run = async () => {
        if (payload === this.lastWrittenJson) return true;
        try {
          await ioUtils.makeDirectory?.(this.getDirectoryPath(), { ignoreExisting: true });
          const mainPath = this.getFilePath();
          const bakPath = this.getBackupFilePath();
          if (this.lastWrittenJson) {
            try {
              await ioUtils.writeUTF8(bakPath, this.lastWrittenJson, { tmpPath: bakPath + ".tmp" });
            } catch {
            }
          }
          await ioUtils.writeUTF8(mainPath, payload, { tmpPath: mainPath + ".tmp" });
          this.lastWrittenJson = payload;
          this.lastError = "";
          return true;
        } catch (err) {
          this.lastError = err instanceof Error ? err.message : String(err || "write failed");
          return false;
        }
      };
      this.flushing = (this.flushing || Promise.resolve(true)).then(run, run);
      return this.flushing;
    }
    async loadFromDisk() {
      const ioUtils = globalThis.IOUtils;
      if (!ioUtils?.exists || !ioUtils?.readUTF8) return null;
      const paths = [this.getFilePath(), this.getBackupFilePath()];
      if (this.directory !== cacheDirectory()) {
        paths.push(cacheFile(cacheDirectory(), "workspace-snapshots.json"), cacheFile(cacheDirectory(), "workspace-snapshots.bak.json"));
      }
      for (const candidatePath of paths) {
        try {
          if (!await ioUtils.exists(candidatePath)) continue;
          const raw = await ioUtils.readUTF8(candidatePath);
          if (!raw) continue;
          try {
            const parsed = readBackup(raw);
            this.lastWrittenJson = candidatePath === this.getFilePath() ? raw : "";
            return parsed;
          } catch {
            const parsed = readWorkspace(raw);
            this.lastWrittenJson = candidatePath === this.getFilePath() ? raw : "";
            return parsed;
          }
        } catch {
        }
      }
      return null;
    }
    /**
     * Merges durable disk state into memory state so saved sessions, virtual members,
     * and groups survive preference resets or profile migrations.
     */
    mergeDurableState(current, disk) {
      let changed = false;
      const mergeSessions = (target, source, max) => {
        const byIdOrName = /* @__PURE__ */ new Map();
        for (const s of target) byIdOrName.set(s.id, s);
        for (const diskSes of source) {
          const match = target.find((s) => s.id === diskSes.id || !s.isTemplate && !diskSes.isTemplate && s.name === diskSes.name);
          if (!match) {
            target.push(diskSes);
            changed = true;
          } else {
            const mergedVirtuals = { ...diskSes.virtualMembers, ...match.virtualMembers };
            if (Object.keys(mergedVirtuals).length > Object.keys(match.virtualMembers).length) {
              match.virtualMembers = mergedVirtuals;
              changed = true;
            }
            const mergedOpen = [.../* @__PURE__ */ new Set([...match.openKeys, ...diskSes.openKeys])];
            if (mergedOpen.length > match.openKeys.length) {
              match.openKeys = mergedOpen;
              changed = true;
            }
          }
        }
        target.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        if (target.length > max) target.length = max;
        void byIdOrName;
      };
      mergeSessions(current.sessions, disk.sessions, 30);
      mergeSessions(current.rollingSessions, disk.rollingSessions, 5);
      for (const [k, meta] of Object.entries(disk.virtualMembers)) {
        if (!current.virtualMembers[k]) {
          current.virtualMembers[k] = meta;
          changed = true;
        }
      }
      for (const [k, rem] of Object.entries(disk.remarks)) {
        if (!current.remarks[k]) {
          current.remarks[k] = rem;
          changed = true;
        }
      }
      for (const [k, viewedAt] of Object.entries(disk.lastViewedAt)) {
        if (viewedAt > (current.lastViewedAt[k] || 0)) {
          current.lastViewedAt[k] = viewedAt;
          changed = true;
        }
      }
      for (const [k, diskProg] of Object.entries(disk.readingProgress)) {
        const cur = current.readingProgress[k];
        if (!cur) {
          current.readingProgress[k] = {
            ...diskProg,
            ...diskProg.pageSeconds ? { pageSeconds: { ...diskProg.pageSeconds } } : {}
          };
          changed = true;
        } else {
          const mergedPages = { ...cur.pageSeconds || {} };
          let pagesChanged = false;
          for (const [p, sec] of Object.entries(diskProg.pageSeconds || {})) {
            if (sec > (mergedPages[p] || 0)) {
              mergedPages[p] = sec;
              pagesChanged = true;
            }
          }
          const nextRead = Math.max(cur.readSeconds, diskProg.readSeconds);
          const nextLast = cur.lastPage || diskProg.lastPage;
          const nextTotal = Math.max(cur.totalPages || 0, diskProg.totalPages || 0) || void 0;
          if (pagesChanged || nextRead > cur.readSeconds || nextLast !== cur.lastPage || nextTotal !== cur.totalPages) {
            current.readingProgress[k] = {
              readSeconds: nextRead,
              ...nextLast ? { lastPage: nextLast } : {},
              ...nextTotal ? { totalPages: nextTotal } : {},
              ...Object.keys(mergedPages).length ? { pageSeconds: mergedPages } : {}
            };
            changed = true;
          }
        }
      }
      if (!current.groups.length && disk.groups.length) {
        current.groups = disk.groups.map((g) => ({ ...g, memberKeys: [...g.memberKeys] }));
        current.collapsed = [...disk.collapsed];
        changed = true;
      }
      return changed;
    }
    dispose() {
      if (this.flushTimer !== null) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
    }
  };

  // src/domains/workspace/reading-progress-cache.ts
  var ReadingProgressDiskCache = class {
    flushTimer = null;
    flushing = null;
    lastWrittenJson = "";
    lastError = "";
    loadedFromLegacy = false;
    directory;
    constructor(privateDirectory = "") {
      this.directory = cacheDirectory(privateDirectory);
    }
    getDirectoryPath() {
      return this.directory;
    }
    getFilePath() {
      return cacheFile(this.directory, "reading-progress.json");
    }
    getBackupFilePath() {
      return cacheFile(this.directory, "reading-progress.bak.json");
    }
    scheduleSave(state, immediate = false) {
      const ioUtils = globalThis.IOUtils;
      if (!ioUtils?.writeUTF8) return;
      if (this.flushTimer !== null) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      if (immediate) {
        void this.flushNow(state);
        return;
      }
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flushNow(state);
      }, 320);
    }
    async flushNow(state) {
      const ioUtils = globalThis.IOUtils;
      if (!ioUtils?.writeUTF8) return true;
      const payload = `${JSON.stringify({
        format: "zotero-bridgeflow-reading-progress",
        version: 1,
        state: pickReadingProgressState(state)
      }, null, 2)}
`;
      const run = async () => {
        if (payload === this.lastWrittenJson) return true;
        try {
          await ioUtils.makeDirectory?.(this.getDirectoryPath(), { ignoreExisting: true });
          const mainPath = this.getFilePath();
          const bakPath = this.getBackupFilePath();
          if (this.lastWrittenJson) {
            try {
              await ioUtils.writeUTF8(bakPath, this.lastWrittenJson, { tmpPath: bakPath + ".tmp" });
            } catch {
            }
          }
          await ioUtils.writeUTF8(mainPath, payload, { tmpPath: mainPath + ".tmp" });
          this.lastWrittenJson = payload;
          this.lastError = "";
          return true;
        } catch (err) {
          this.lastError = err instanceof Error ? err.message : String(err || "write failed");
          return false;
        }
      };
      this.flushing = (this.flushing || Promise.resolve(true)).then(run, run);
      return this.flushing;
    }
    async loadFromDisk() {
      const ioUtils = globalThis.IOUtils;
      if (!ioUtils?.exists || !ioUtils?.readUTF8) return null;
      this.loadedFromLegacy = false;
      const primaryPaths = [this.getFilePath(), this.getBackupFilePath()];
      if (this.directory !== cacheDirectory()) {
        primaryPaths.push(cacheFile(cacheDirectory(), "reading-progress.json"), cacheFile(cacheDirectory(), "reading-progress.bak.json"));
      }
      for (const p of primaryPaths) {
        try {
          if (!await ioUtils.exists(p)) continue;
          const raw = await ioUtils.readUTF8(p);
          if (!raw) continue;
          const parsed = readReadingProgressBackup(raw);
          this.lastWrittenJson = p === this.getFilePath() ? raw : "";
          return parsed;
        } catch {
        }
      }
      const legacyPaths = [cacheFile(this.directory, "reading-notes.json"), cacheFile(this.directory, "reading-notes.bak.json")];
      if (this.directory !== cacheDirectory()) {
        legacyPaths.push(cacheFile(cacheDirectory(), "reading-notes.json"), cacheFile(cacheDirectory(), "reading-notes.bak.json"));
      }
      for (const lp of legacyPaths) {
        try {
          if (!await ioUtils.exists(lp)) continue;
          const raw = await ioUtils.readUTF8(lp);
          if (!raw) continue;
          const parsed = readReadingNotesBackup(raw);
          this.loadedFromLegacy = true;
          return pickReadingProgressState(parsed);
        } catch {
        }
      }
      return null;
    }
    mergeDurableState(current, disk) {
      let changed = false;
      for (const [k, viewedAt] of Object.entries(disk.lastViewedAt)) {
        if (viewedAt > (current.lastViewedAt[k] || 0)) {
          current.lastViewedAt[k] = viewedAt;
          changed = true;
        }
      }
      for (const [k, diskProg] of Object.entries(disk.readingProgress)) {
        const cur = current.readingProgress[k];
        if (!cur) {
          current.readingProgress[k] = {
            ...diskProg,
            ...diskProg.pageSeconds ? { pageSeconds: { ...diskProg.pageSeconds } } : {}
          };
          changed = true;
          continue;
        }
        const mergedPages = { ...cur.pageSeconds || {} };
        let pagesChanged = false;
        for (const [p, sec] of Object.entries(diskProg.pageSeconds || {})) {
          if (sec > (mergedPages[p] || 0)) {
            mergedPages[p] = sec;
            pagesChanged = true;
          }
        }
        const mergedSeconds = Math.max(cur.readSeconds, diskProg.readSeconds);
        const nextLastPage = cur.lastPage || diskProg.lastPage;
        const nextTotal = Math.max(cur.totalPages || 0, diskProg.totalPages || 0) || void 0;
        if (pagesChanged || mergedSeconds > cur.readSeconds || nextLastPage !== cur.lastPage || nextTotal !== cur.totalPages) {
          current.readingProgress[k] = {
            readSeconds: mergedSeconds,
            ...nextLastPage ? { lastPage: nextLastPage } : {},
            ...nextTotal ? { totalPages: nextTotal } : {},
            ...Object.keys(mergedPages).length ? { pageSeconds: mergedPages } : {}
          };
          changed = true;
        }
      }
      return changed;
    }
    dispose() {
      if (this.flushTimer !== null) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
    }
  };

  // src/domains/workspace/brief-notes-cache.ts
  var BriefNotesDiskCache = class {
    flushTimer = null;
    flushing = null;
    lastWrittenJson = "";
    lastError = "";
    loadedFromLegacy = false;
    directory;
    constructor(privateDirectory = "") {
      this.directory = cacheDirectory(privateDirectory);
    }
    getDirectoryPath() {
      return this.directory;
    }
    getFilePath() {
      return cacheFile(this.directory, "brief-notes.json");
    }
    getBackupFilePath() {
      return cacheFile(this.directory, "brief-notes.bak.json");
    }
    scheduleSave(state, immediate = false) {
      const ioUtils = globalThis.IOUtils;
      if (!ioUtils?.writeUTF8) return;
      if (this.flushTimer !== null) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      if (immediate) {
        void this.flushNow(state);
        return;
      }
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flushNow(state);
      }, 240);
    }
    async flushNow(state) {
      const ioUtils = globalThis.IOUtils;
      if (!ioUtils?.writeUTF8) return true;
      const payload = `${JSON.stringify({
        format: "zotero-bridgeflow-brief-notes",
        version: 1,
        state: pickBriefNotesState(state)
      }, null, 2)}
`;
      const run = async () => {
        if (payload === this.lastWrittenJson) return true;
        try {
          await ioUtils.makeDirectory?.(this.getDirectoryPath(), { ignoreExisting: true });
          const mainPath = this.getFilePath();
          const bakPath = this.getBackupFilePath();
          if (this.lastWrittenJson) {
            try {
              await ioUtils.writeUTF8(bakPath, this.lastWrittenJson, { tmpPath: bakPath + ".tmp" });
            } catch {
            }
          }
          await ioUtils.writeUTF8(mainPath, payload, { tmpPath: mainPath + ".tmp" });
          this.lastWrittenJson = payload;
          this.lastError = "";
          return true;
        } catch (err) {
          this.lastError = err instanceof Error ? err.message : String(err || "write failed");
          return false;
        }
      };
      this.flushing = (this.flushing || Promise.resolve(true)).then(run, run);
      return this.flushing;
    }
    async loadFromDisk() {
      const ioUtils = globalThis.IOUtils;
      if (!ioUtils?.exists || !ioUtils?.readUTF8) return null;
      this.loadedFromLegacy = false;
      const primaryPaths = [this.getFilePath(), this.getBackupFilePath()];
      if (this.directory !== cacheDirectory()) {
        primaryPaths.push(cacheFile(cacheDirectory(), "brief-notes.json"), cacheFile(cacheDirectory(), "brief-notes.bak.json"));
      }
      for (const p of primaryPaths) {
        try {
          if (!await ioUtils.exists(p)) continue;
          const raw = await ioUtils.readUTF8(p);
          if (!raw) continue;
          const parsed = readBriefNotesBackup(raw);
          this.lastWrittenJson = p === this.getFilePath() ? raw : "";
          return parsed;
        } catch {
        }
      }
      const legacyPaths = [cacheFile(this.directory, "reading-notes.json"), cacheFile(this.directory, "reading-notes.bak.json")];
      if (this.directory !== cacheDirectory()) {
        legacyPaths.push(cacheFile(cacheDirectory(), "reading-notes.json"), cacheFile(cacheDirectory(), "reading-notes.bak.json"));
      }
      for (const lp of legacyPaths) {
        try {
          if (!await ioUtils.exists(lp)) continue;
          const raw = await ioUtils.readUTF8(lp);
          if (!raw) continue;
          const parsed = readReadingNotesBackup(raw);
          this.loadedFromLegacy = true;
          return pickBriefNotesState(parsed);
        } catch {
        }
      }
      return null;
    }
    mergeDurableState(current, disk) {
      let changed = false;
      for (const [k, rem] of Object.entries(disk.remarks)) {
        if (!current.remarks[k]) {
          current.remarks[k] = rem;
          changed = true;
        }
      }
      for (const [k, mode] of Object.entries(disk.remarkModes)) {
        if (!current.remarkModes[k]) {
          current.remarkModes[k] = mode;
          changed = true;
        }
      }
      return changed;
    }
    dispose() {
      if (this.flushTimer !== null) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
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

  // src/domains/workspace/workspace-session-ops.ts
  async function hydrateWorkspaceDiskCaches(store) {
    const [diskLayout, diskReading, diskNotes] = await Promise.all([
      store.diskCache.loadFromDisk(),
      store.readingCache.loadFromDisk(),
      store.notesCache.loadFromDisk()
    ]);
    const hadLegacy = hasLegacyReadingNotes(store.state) || hasLegacyReadingNotes(diskLayout);
    let layoutChanged = false;
    let readingChanged = false;
    let notesChanged = false;
    if (store.readOnlyGuard && diskLayout) {
      store.state = { ...diskLayout, ...pickReadingNotesState(store.state) };
      store.readOnlyGuard = false;
      layoutChanged = true;
    } else if (diskLayout && store.diskCache.mergeDurableState(store.state, diskLayout)) {
      layoutChanged = true;
    }
    if (diskReading && store.readingCache.mergeDurableState(store.state, diskReading)) readingChanged = true;
    if (diskNotes && store.notesCache.mergeDurableState(store.state, diskNotes)) notesChanged = true;
    if (hadLegacy) {
      await Promise.all([
        store.readingCache.flushNow(store.state),
        store.notesCache.flushNow(store.state)
      ]);
      store.save(false);
      await store.diskCache.flushNow(pickWorkspaceLayoutState(store.state));
      return true;
    }
    if (layoutChanged || !diskLayout && !store.readOnlyGuard) store.save(Boolean(layoutChanged));
    if (readingChanged || store.readingCache.loadedFromLegacy || !diskReading && Object.keys(store.state.readingProgress).length) {
      await store.readingCache.flushNow(store.state);
    }
    if (notesChanged || store.notesCache.loadedFromLegacy || !diskNotes && Object.keys(store.state.remarks).length) {
      await store.notesCache.flushNow(store.state);
    }
    return layoutChanged || readingChanged || notesChanged;
  }
  function groupOfStateKey(state, key) {
    return state.groups.find((g) => g.memberKeys.includes(key))?.id || "";
  }
  function captureWorkspaceLayout(state, groupId, template = false) {
    const inScope = (key) => !groupId || groupOfStateKey(state, key) === groupId;
    const scopedRecord = (record2) => template ? {} : Object.fromEntries(Object.entries(record2).filter(([key]) => inScope(key)));
    return {
      groups: state.groups.filter((g) => !groupId || g.id === groupId).map((g) => ({ ...g, memberKeys: template ? [] : [...g.memberKeys] })),
      collapsed: state.collapsed.filter((id) => !groupId || id === groupId),
      pinnedKeys: template ? [] : state.pinnedKeys.filter(inScope),
      remarks: scopedRecord(state.remarks),
      remarkModes: scopedRecord(state.remarkModes),
      virtualMembers: scopedRecord(state.virtualMembers)
    };
  }
  function applySessionLayoutToState(state, session2, merge) {
    const hasNotes = Boolean(Object.keys(session2.remarks).length || Object.keys(session2.remarkModes).length);
    if (!merge) {
      state.groups = session2.groups.map((g) => ({ ...g, memberKeys: [...g.memberKeys] }));
      state.pinnedKeys = [...session2.pinnedKeys];
      state.collapsed = [...session2.collapsed];
      state.virtualMembers = { ...session2.virtualMembers };
      Object.assign(state.remarks, session2.remarks);
      Object.assign(state.remarkModes, session2.remarkModes);
      return hasNotes;
    }
    for (const sg of session2.groups) {
      let existing = state.groups.find((g) => g.id === sg.id || g.name === sg.name);
      if (!existing) {
        existing = { id: sg.id, name: sg.name, color: sg.color, memberKeys: [] };
        state.groups.push(existing);
      }
      if (session2.collapsed.includes(sg.id) && !state.collapsed.includes(existing.id)) state.collapsed.push(existing.id);
      for (const key of sg.memberKeys) {
        if (!groupOfStateKey(state, key)) existing.memberKeys.push(key);
      }
    }
    state.virtualMembers = { ...session2.virtualMembers, ...state.virtualMembers };
    state.remarkModes = { ...session2.remarkModes, ...state.remarkModes };
    state.pinnedKeys = [.../* @__PURE__ */ new Set([...state.pinnedKeys, ...session2.pinnedKeys])];
    state.remarks = { ...state.remarks, ...session2.remarks };
    return hasNotes;
  }
  function saveWorkspaceSessionRecord(state, name, options = {}) {
    const cleanName = name.trim() || (/* @__PURE__ */ new Date()).toLocaleString();
    const captured = captureWorkspaceLayout(state, options.groupId, options.isTemplate);
    const openKeyList = options.isTemplate ? [] : options.groupId ? [.../* @__PURE__ */ new Set([...options.openKeys || [], ...captured.groups.flatMap((g) => g.memberKeys)])] : [...new Set(options.openKeys || [])];
    const existingIdx = !options.rolling && !options.isTemplate && options.groupId ? state.sessions.findIndex((s) => !s.isTemplate && (s.scopedGroupId === options.groupId || s.name === cleanName)) : -1;
    const prior = existingIdx >= 0 ? state.sessions[existingIdx] : null;
    const session2 = {
      id: prior?.id || `ses-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      name: cleanName,
      createdAt: Date.now(),
      scopedGroupId: options.groupId ?? prior?.scopedGroupId,
      isTemplate: Boolean(options.isTemplate),
      openKeys: openKeyList,
      kind: options.kind ?? (options.isTemplate ? "template" : options.rolling ? "rolling" : "manual"),
      ...captured,
      virtualMembers: options.isTemplate ? {} : { ...prior?.virtualMembers || {}, ...captured.virtualMembers }
    };
    if (options.rolling) {
      state.rollingSessions.unshift(session2);
      state.rollingSessions = state.rollingSessions.slice(0, MAX_ROLLING_SESSIONS);
    } else {
      if (existingIdx >= 0) state.sessions.splice(existingIdx, 1);
      state.sessions.unshift(session2);
      state.sessions = state.sessions.slice(0, MAX_MANUAL_SESSIONS);
    }
    return session2;
  }

  // src/domains/workspace/state-store.ts
  var createEmptyState = () => ({
    version: 2,
    groups: [],
    collapsed: [],
    pinnedKeys: [],
    sleepingKeys: [],
    remarks: {},
    remarkModes: {},
    lastViewedAt: {},
    readingProgress: {},
    virtualMembers: {},
    sessions: [],
    rollingSessions: []
  });
  var WorkspaceStateStore = class {
    state = createEmptyState();
    diskCache;
    readingCache;
    notesCache;
    readOnlyGuard = false;
    prefs;
    listeners = /* @__PURE__ */ new Set();
    constructor(prefs) {
      this.prefs = prefs;
      const customDir = prefs.get("inspector.lookup.cacheDirectory");
      this.diskCache = new WorkspaceDiskCache(customDir);
      this.readingCache = new ReadingProgressDiskCache(customDir);
      this.notesCache = new BriefNotesDiskCache(customDir);
      this.load();
    }
    load() {
      const prevProgress = pickReadingProgressState(this.state);
      const prevNotes = pickBriefNotesState(this.state);
      const raw = this.prefs.get("workspace.document");
      if (!raw) {
        this.state = { ...createEmptyState(), ...prevProgress, ...prevNotes };
        this.readOnlyGuard = false;
        return;
      }
      try {
        this.state = readWorkspace(raw);
        this.readingCache.mergeDurableState(this.state, prevProgress);
        this.notesCache.mergeDurableState(this.state, prevNotes);
        this.readOnlyGuard = false;
      } catch {
        this.readOnlyGuard = true;
      }
    }
    async initDiskCache() {
      return hydrateWorkspaceDiskCaches(this);
    }
    save(immediateDisk = false) {
      if (!this.readOnlyGuard) {
        const layoutOnly = pickWorkspaceLayoutState(this.state);
        const serialized = JSON.stringify(layoutOnly);
        try {
          this.prefs.set("workspace.document", serialized);
        } catch {
        }
        this.diskCache.scheduleSave(layoutOnly, immediateDisk, serialized);
      }
      this.emitChange();
    }
    saveReadingProgress(immediateDisk = false) {
      this.readingCache.scheduleSave(this.state, immediateDisk);
      this.emitChange();
    }
    saveBriefNotes(immediateDisk = false) {
      this.notesCache.scheduleSave(this.state, immediateDisk);
      this.emitChange();
    }
    emitChange() {
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
    clearWorkspaceLayout() {
      const notes = pickReadingNotesState(this.state);
      this.state = { ...createEmptyState(), ...notes };
      this.readOnlyGuard = false;
      this.save(true);
    }
    clearReadingProgress() {
      this.state.lastViewedAt = {};
      this.state.readingProgress = {};
      this.saveReadingProgress(true);
    }
    clearBriefNotes() {
      this.state.remarks = {};
      this.state.remarkModes = {};
      this.saveBriefNotes(true);
    }
    createGroup(name, color) {
      const trimmed = name.trim() || "新分组";
      const id = `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const chosen = color || GROUP_PALETTE[this.state.groups.length % GROUP_PALETTE.length];
      const group2 = { id, name: trimmed, color: chosen, memberKeys: [] };
      this.state.groups.push(group2);
      this.save();
      return group2;
    }
    assignKeyRelative(key, groupId, anchorKey, after) {
      for (const g of this.state.groups) g.memberKeys = g.memberKeys.filter((k) => k !== key);
      if (groupId) {
        const target = this.state.groups.find((g) => g.id === groupId);
        if (target) {
          const idx = target.memberKeys.indexOf(anchorKey);
          if (idx >= 0) target.memberKeys.splice(after ? idx + 1 : idx, 0, key);
          else target.memberKeys.push(key);
        }
      }
      this.save();
    }
    deleteSession(sessionId) {
      const before = this.state.sessions.length + this.state.rollingSessions.length;
      this.state.sessions = this.state.sessions.filter((s) => s.id !== sessionId);
      this.state.rollingSessions = this.state.rollingSessions.filter((s) => s.id !== sessionId);
      if (this.state.sessions.length + this.state.rollingSessions.length === before) return false;
      this.save();
      return true;
    }
    renameGroup(groupId, name) {
      const group2 = this.state.groups.find((g) => g.id === groupId);
      const trimmed = name.trim();
      if (!group2 || !trimmed) return false;
      group2.name = trimmed;
      this.save();
      return true;
    }
    setGroupColor(groupId, color) {
      const group2 = this.state.groups.find((g) => g.id === groupId);
      if (!group2 || !color) return false;
      group2.color = color;
      this.save();
      return true;
    }
    restoreSessionLayout(session2, merge = false, openKeys = []) {
      if (!merge && (openKeys.length || this.state.groups.length || this.state.pinnedKeys.length)) {
        this.saveSession(`恢复前备份 · ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`, { kind: "pre-replace", rolling: true, openKeys });
      }
      const hasNotes = applySessionLayoutToState(this.state, session2, merge);
      this.save();
      if (hasNotes) this.saveBriefNotes();
    }
    collapseOtherGroups(activeGroupId2) {
      this.state.collapsed = this.state.groups.filter((g) => g.id !== activeGroupId2).map((g) => g.id);
      this.save();
    }
    setRemarkMode(key, mode) {
      if (mode) this.state.remarkModes[key] = mode;
      else delete this.state.remarkModes[key];
      this.saveBriefNotes();
    }
    groupOfKey(key) {
      return groupOfStateKey(this.state, key);
    }
    setCollapsed(groupId, collapsed) {
      const set = new Set(this.state.collapsed);
      if (collapsed) set.add(groupId);
      else set.delete(groupId);
      this.state.collapsed = [...set];
      this.save();
    }
    updateSession(sessionId, openKeys) {
      const ses = this.state.sessions.find((s) => s.id === sessionId);
      if (!ses) return false;
      ses.createdAt = Date.now();
      const inScope = (key) => !ses.scopedGroupId || this.groupOfKey(key) === ses.scopedGroupId;
      if (openKeys) ses.openKeys = ses.isTemplate ? [] : [...new Set(openKeys)].filter(inScope);
      Object.assign(ses, captureWorkspaceLayout(this.state, ses.scopedGroupId, ses.isTemplate));
      this.save();
      return true;
    }
    renameSession(sessionId, name) {
      const trimmed = name.trim();
      const ses = this.state.sessions.find((s) => s.id === sessionId);
      if (!ses || !trimmed) return false;
      ses.name = trimmed;
      this.save();
      return true;
    }
    promoteRollingSession(sessionId) {
      const idx = this.state.rollingSessions.findIndex((s) => s.id === sessionId);
      if (idx < 0) return false;
      const [item] = this.state.rollingSessions.splice(idx, 1);
      this.state.sessions.unshift({ ...item, kind: "manual" });
      this.state.sessions = this.state.sessions.slice(0, MAX_MANUAL_SESSIONS);
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
      for (const g of this.state.groups) g.memberKeys = g.memberKeys.filter((k) => k !== key);
      if (groupId) {
        const target = this.state.groups.find((g) => g.id === groupId);
        if (target && !target.memberKeys.includes(key)) target.memberKeys.push(key);
      }
      this.save();
    }
    setPinned(key, pinned) {
      const set = new Set(this.state.pinnedKeys);
      if (pinned) {
        set.add(key);
        this.state.sleepingKeys = this.state.sleepingKeys.filter((k) => k !== key);
      } else set.delete(key);
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
      this.saveBriefNotes();
    }
    touchViewed(key, now = Date.now()) {
      this.state.lastViewedAt[key] = now;
    }
    updateReadingProgress(key, deltaSeconds, lastPage, totalPages) {
      const prev = this.state.readingProgress[key] ?? { readSeconds: 0 };
      const pageSeconds = mergePageSeconds(prev.pageSeconds, lastPage, deltaSeconds);
      return this.state.readingProgress[key] = {
        readSeconds: Math.max(0, (prev.readSeconds || 0) + Math.max(0, deltaSeconds)),
        ...lastPage && lastPage > 0 ? { lastPage } : prev.lastPage ? { lastPage: prev.lastPage } : {},
        ...totalPages && totalPages > 0 ? { totalPages } : prev.totalPages ? { totalPages: prev.totalPages } : {},
        ...pageSeconds ? { pageSeconds } : {}
      };
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
      const session2 = saveWorkspaceSessionRecord(this.state, name, options);
      this.save(true);
      return session2;
    }
    exportJson() {
      return JSON.stringify({ format: "zotero-bridgeflow-workspace", version: 2, state: this.state }, null, 2);
    }
    exportReadingJson() {
      return JSON.stringify({ format: "zotero-bridgeflow-reading-progress", version: 1, state: pickReadingProgressState(this.state) }, null, 2);
    }
    exportBriefNotesJson() {
      return JSON.stringify({ format: "zotero-bridgeflow-brief-notes", version: 1, state: pickBriefNotesState(this.state) }, null, 2);
    }
    importJson(jsonText) {
      try {
        this.state = readBackup(jsonText);
        this.readOnlyGuard = false;
        this.save(true);
        void this.readingCache.flushNow(this.state);
        void this.notesCache.flushNow(this.state);
        return true;
      } catch {
        return false;
      }
    }
    importReadingJson(jsonText) {
      try {
        this.readingCache.mergeDurableState(this.state, readReadingProgressBackup(jsonText));
        this.saveReadingProgress(true);
        return true;
      } catch {
        return false;
      }
    }
    importBriefNotesJson(jsonText) {
      try {
        this.notesCache.mergeDurableState(this.state, readBriefNotesBackup(jsonText));
        this.saveBriefNotes(true);
        return true;
      } catch {
        return false;
      }
    }
  };

  // src/domains/workspace/reading-tracker.ts
  function readReaderPageMetrics(tabID) {
    const reader = globalThis.Zotero?.Reader?.getByTabID?.(tabID);
    const internalReader = reader?._internalReader;
    const viewStats = internalReader?._state?.primaryViewStats || reader?.state?.primaryViewStats;
    const viewState = internalReader?._state?.primaryViewState || reader?.state?.primaryViewState;
    const pdfApp = internalReader?._primaryView?._iframeWindow?.PDFViewerApplication || reader?._iframeWindow?.PDFViewerApplication;
    const rawPageIndex = viewStats?.pageIndex ?? viewState?.pageIndex ?? reader?.state?.pageIndex;
    const page = Number(pdfApp?.page || (rawPageIndex != null ? Number(rawPageIndex) + 1 : 0)) || 0;
    const total = Number(
      viewStats?.pagesCount || pdfApp?.pagesCount || pdfApp?.pdfDocument?.numPages || internalReader?._primaryView?._pagesCount || internalReader?._pdfDocument?.numPages || reader?.pagesCount || 0
    ) || 0;
    return { page, total };
  }
  function trackActiveReaderProgress(win, store, tracked, elapsedSeconds, options = {}) {
    const doc = win.document;
    if (typeof doc?.hasFocus === "function" && !doc.hasFocus()) return false;
    const now = options.now ?? Date.now();
    const idleExpired = Boolean(
      options.idleCutoffMs && options.idleCutoffMs > 0 && options.lastActivityAt && now - options.lastActivityAt > options.idleCutoffMs
    );
    if (options.overrideKey) {
      if (idleExpired || options.overrideKey.startsWith("tab:")) return false;
      const prevText2 = formatReadingProgress(store.state.readingProgress[options.overrideKey]).text;
      store.touchViewed(options.overrideKey, now);
      const next2 = store.updateReadingProgress(
        options.overrideKey,
        elapsedSeconds,
        options.overrideLastPage,
        options.overrideTotalPages
      );
      return elapsedSeconds > 0 || formatReadingProgress(next2).text !== prevText2;
    }
    const selectedID = String(win.Zotero_Tabs?.selectedID || "");
    if (!selectedID || selectedID === "zotero-pane") return false;
    const current = tracked.find((t) => !t.virtual && t.tabID === selectedID);
    if (!current || current.key.startsWith("tab:") || !current.type.startsWith("reader")) return false;
    const prevProg = store.state.readingProgress[current.key];
    const prevText = formatReadingProgress(prevProg).text;
    const { page, total } = readReaderPageMetrics(selectedID);
    const pageFlipped = page > 0 && prevProg?.lastPage !== page;
    if (pageFlipped) options.onPageChanged?.(page);
    if (idleExpired && !pageFlipped) return false;
    store.touchViewed(current.key, now);
    const next = store.updateReadingProgress(current.key, elapsedSeconds, page, total);
    return elapsedSeconds > 0 || formatReadingProgress(next).text !== prevText;
  }

  // src/domains/workspace/tab-actions-helpers.ts
  function computeTabMoveTarget(ids, draggedTabID, targetTabID, after) {
    const from = ids.indexOf(draggedTabID);
    const to = ids.indexOf(targetTabID);
    if (from < 0 || to < 0 || from === to) return -1;
    let target = after ? to + 1 : to;
    if (from < target) target -= 1;
    return target;
  }
  async function openItemAttachmentOrNote(win, store, itemID, groupId, openInBackground = false) {
    try {
      const hostItems = globalThis.Zotero?.Items;
      const vMeta = store.state.virtualMembers[`item:${itemID}`];
      let item = itemID > 0 ? hostItems?.get?.(itemID) : null;
      if ((!item || item.deleted) && vMeta?.parentItemID && vMeta.parentItemID !== itemID) {
        item = hostItems?.get?.(vMeta.parentItemID);
      }
      if (!item || item.deleted) return false;
      const isNote = item.isNote?.() === true;
      let target = isNote || item.isAttachment?.() ? item : await item.getBestAttachment?.();
      if ((!target || target.deleted) && vMeta?.parentItemID) {
        const parent = hostItems?.get?.(vMeta.parentItemID);
        if (parent && !parent.deleted) target = await parent.getBestAttachment?.();
      }
      if (!target || target.deleted) return false;
      const key = `item:${target.id}`;
      const altKey = `item:${item.id}`;
      const nativeTabs = Array.isArray(win.Zotero_Tabs?._tabs) ? win.Zotero_Tabs._tabs : [];
      const existing = nativeTabs.find((t) => Number(t?.data?.itemID || 0) === target.id);
      if (existing) {
        if (!openInBackground) win.Zotero_Tabs?.select?.(existing.id);
      } else if (isNote) {
        if (typeof globalThis.Zotero?.Notes?.open !== "function") return false;
        await globalThis.Zotero.Notes.open(target.id, void 0, { openInBackground });
      } else {
        if (target.isFileAttachment?.() && typeof target.fileExists === "function" && !await target.fileExists()) {
          return false;
        }
        if (typeof globalThis.Zotero?.Reader?.open !== "function") return false;
        await globalThis.Zotero.Reader.open(target.id, void 0, { openInBackground });
      }
      if (groupId !== void 0) {
        store.assignToGroup(key, groupId || null);
      }
      store.removeVirtualMember(key);
      store.removeVirtualMember(altKey);
      return true;
    } catch (error) {
      globalThis.Zotero?.logError?.(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }
  async function revealAttachmentFile(win, itemID) {
    return revealItemAttachmentInFilesystem(itemID, { win });
  }
  async function selectItemInLibrary(win, itemID, switchCollection) {
    return locateItemInZoteroLibrary(itemID, { win, switchCollection });
  }
  function formatReadingProgress2(prog) {
    return formatReadingProgress(prog);
  }
  function buildVirtualMetaFromTracked(tab) {
    return {
      key: tab.key,
      itemID: tab.itemID,
      parentItemID: tab.parentItemID,
      title: tab.title,
      shortTitle: tab.shortTitle,
      filename: tab.filename,
      source: tab.source,
      creatorYear: tab.creatorYear,
      collection: tab.collection,
      type: tab.type
    };
  }
  function resolvePrimaryCollectionName2(item) {
    return resolvePrimaryCollectionName(item);
  }
  function autoGroupTrackedByCollection(win, store, strategy, tracked) {
    const pane = win.ZoteroPane;
    const activeCol = pane?.getSelectedCollections?.()?.[0];
    const activeColName = String(activeCol?.name || "");
    const hostItems = globalThis.Zotero?.Items;
    const hostCols = globalThis.Zotero?.Collections;
    let grouped = 0;
    for (const tab of tracked) {
      if (tab.virtual || tab.groupId) continue;
      const item = hostItems?.get?.(tab.parentItemID || tab.itemID);
      const colIDs = item?.getCollections?.() || [];
      const colNames = colIDs.map((id) => hostCols?.get?.(id)).filter((col) => col && !col._isBridgeFlowCollection && !col._isCiteFlowCollection).map((col) => String(col?.name || "")).filter((n) => Boolean(n && !n.startsWith("📝 ")));
      if (!colNames.length) continue;
      let chosen = "";
      if (strategy === "active" && activeColName && colNames.includes(activeColName)) chosen = activeColName;
      else if (strategy === "existing") chosen = colNames.find((n) => store.state.groups.some((g) => g.name === n)) || colNames[0];
      else chosen = colNames[0];
      if (!chosen) continue;
      const group2 = store.state.groups.find((g) => g.name === chosen) ?? store.createGroup(chosen);
      store.assignToGroup(tab.key, group2.id);
      grouped++;
    }
    return grouped;
  }
  async function restoreSessionTabsAndLayout(win, store, session2) {
    let opened = 0;
    for (const key of new Set(session2.openKeys)) {
      const match = /^item:(\d+)$/.exec(key);
      if (match && await openItemAttachmentOrNote(win, store, Number(match[1]), void 0, true)) opened++;
    }
    return opened;
  }
  function buildPublicationSuggestions(tracked) {
    const buckets = /* @__PURE__ */ new Map();
    for (const tab of tracked) {
      if (tab.virtual || tab.groupId) continue;
      const venue = tab.source.trim();
      if (!venue) continue;
      const entry = buckets.get(venue) ?? { keys: [], titles: [] };
      entry.keys.push(tab.key);
      entry.titles.push(tab.title);
      buckets.set(venue, entry);
    }
    return [...buckets.entries()].filter(([, b]) => b.keys.length >= 2).map(([venue, b]) => ({ venue, keys: b.keys, titles: b.titles })).sort((a, b) => b.keys.length - a.keys.length);
  }
  function collectRecentlyClosed(win, localStack, openKeys) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const push = (rec) => {
      if (!rec.itemID || seen.has(rec.itemID) || openKeys.has(rec.key)) return;
      seen.add(rec.itemID);
      out.push(rec);
    };
    for (let i = localStack.length - 1; i >= 0; i--) push(localStack[i]);
    const nativeClosed = win.Zotero_Tabs?._recentlyClosedTabs || [];
    for (let i = nativeClosed.length - 1; i >= 0; i--) {
      const tab = nativeClosed[i];
      const itemID = Number(tab?.data?.itemID || 0);
      if (!itemID || seen.has(itemID)) continue;
      const item = globalThis.Zotero?.Items?.get?.(itemID);
      if (!item || item.deleted) continue;
      push({
        key: `item:${itemID}`,
        itemID,
        groupId: "",
        title: String(tab?.title || item.getField?.("title") || `文献 #${itemID}`),
        closedAt: Number(tab?.closedAt || 0)
      });
    }
    return out.slice(0, 12);
  }
  async function focusOrOpenTrackedItem(win, store, tracked, req, onSelectTab) {
    const match = tracked.find(
      (t) => !t.virtual && (t.parentItemID === req.itemID || t.itemID === req.itemID || req.attachmentID && t.itemID === req.attachmentID)
    );
    if (match && (req.preferExistingTab ?? true)) {
      onSelectTab(match.tabID);
      return "focused";
    }
    try {
      if (!req.attachmentID) {
        const openedParent = await openItemAttachmentOrNote(
          win,
          store,
          req.itemID,
          req.assignToActiveGroup ? activeGroupId(win, tracked) : void 0,
          false
        );
        if (openedParent) return "opened";
      }
      const reader = globalThis.Zotero?.Reader;
      const targetAttachmentID = req.attachmentID || req.itemID;
      if (typeof reader?.open === "function" && targetAttachmentID > 0) {
        await reader.open(targetAttachmentID);
        store.removeVirtualMember(`item:${targetAttachmentID}`);
        store.removeVirtualMember(`item:${req.itemID}`);
        if (req.assignToActiveGroup) {
          const gid = activeGroupId(win, tracked);
          if (gid) store.assignToGroup(`item:${targetAttachmentID}`, gid);
        }
        return "opened";
      }
    } catch (error) {
      globalThis.Zotero?.logError?.(error instanceof Error ? error : new Error(String(error)));
    }
    return "not-found";
  }
  function activeGroupId(win, tracked) {
    const selectedID = String(win.Zotero_Tabs?.selectedID || "");
    return tracked.find((t) => t.tabID === selectedID)?.groupId || "";
  }
  function disambiguateSameParentTabs(tabs) {
    const counts = /* @__PURE__ */ new Map();
    for (const t of tabs) {
      if (t.parentItemID > 0) counts.set(t.parentItemID, (counts.get(t.parentItemID) || 0) + 1);
    }
    return tabs.map((t) => {
      if (t.parentItemID > 0 && (counts.get(t.parentItemID) || 0) > 1 && t.filename) {
        const suffix = ` (${t.filename})`;
        const nextTitle = t.title.includes(t.filename) ? t.title : `${t.title}${suffix}`;
        const nextShort = t.shortTitle.includes(t.filename) ? t.shortTitle : `${t.shortTitle}${suffix}`;
        return { ...t, title: nextTitle, shortTitle: nextShort };
      }
      return t;
    });
  }

  // src/domains/workspace/tab-projection.ts
  var MAX_COLLECTION_CACHE = 400;
  var collectionNameCache = /* @__PURE__ */ new Map();
  function invalidateTabProjectionCache() {
    collectionNameCache.clear();
  }
  function resolveCachedCollectionName(display) {
    const id = Number(display?.id || 0);
    const stamp = String(display?.dateModified || display?.version || "");
    if (id > 0 && stamp) {
      const hit = collectionNameCache.get(id);
      if (hit && hit.stamp === stamp) return hit.name;
    }
    const name = resolvePrimaryCollectionName2(display);
    if (id > 0 && stamp) {
      if (collectionNameCache.size >= MAX_COLLECTION_CACHE) collectionNameCache.clear();
      collectionNameCache.set(id, { stamp, name });
    }
    return name;
  }
  function describe(key, itemID, type, fallbackTitle) {
    const item = itemID ? globalThis.Zotero?.Items?.get?.(itemID) : null;
    const display = normalizeToRegularItem(item) || item;
    const fields = getCachedPrimaryItemFields(display, fallbackTitle || key);
    const title = fields.title || stripItemTitleMarkup(fallbackTitle) || key;
    return {
      key,
      itemID,
      parentItemID: Number(display?.id || itemID),
      type,
      title,
      shortTitle: fields.shortTitle || title,
      filename: String(item?.attachmentFilename || ""),
      source: fields.source,
      creatorYear: fields.creatorYear,
      collection: resolveCachedCollectionName(display)
    };
  }
  function projectWorkspaceTabs(win, store, prefs) {
    const native = win.Zotero_Tabs?._tabs ?? [];
    const live = /* @__PURE__ */ new Set();
    const rows = [];
    const groups = /* @__PURE__ */ new Map();
    for (const group2 of store.state.groups) for (const key of group2.memberKeys) groups.set(key, group2.id);
    const showPins = prefs.get("workspace.enablePinnedTabs");
    function append(meta, tab) {
      const { key, itemID, title } = meta;
      rows.push({
        ...meta,
        key,
        itemID,
        title,
        tabID: tab?.id || "",
        virtual: !tab,
        parentItemID: meta.parentItemID || itemID,
        shortTitle: meta.shortTitle || title,
        filename: meta.filename || "",
        source: meta.source || "",
        creatorYear: meta.creatorYear || "",
        collection: meta.collection || "",
        groupId: groups.get(key) || "",
        pinned: Boolean(tab && showPins && store.isPinned(key)),
        sleeping: Boolean(tab && (tab.type.endsWith("-unloaded") || store.isSleeping(key))),
        remark: store.state.remarks[key] || "",
        lastViewedAt: store.state.lastViewedAt[key] || 0
      });
    }
    for (const tab of native) {
      if (tab.type === "library") continue;
      const itemID = Number(tab.data?.itemID || 0);
      const key = itemID > 0 ? `item:${itemID}` : `tab:${tab.id}`;
      live.add(key);
      append(describe(key, itemID, tab.type, tab.title || ""), tab);
    }
    if (prefs.get("workspace.enableVirtualMembers")) {
      for (const key of groups.keys()) {
        if (live.has(key)) continue;
        const match = /^item:(\d+)$/.exec(key);
        if (!match) continue;
        const cached = store.state.virtualMembers[key];
        const meta = cached ? { ...cached, title: stripItemTitleMarkup(cached.title), shortTitle: stripItemTitleMarkup(cached.shortTitle || cached.title) } : describe(key, Number(match[1]), "reader", "");
        append(meta);
      }
    }
    return disambiguateSameParentTabs(rows);
  }

  // src/domains/workspace/tab-close.ts
  function isTabBusy(win, id) {
    const native = win.Zotero_Tabs?._tabs?.find((tab) => tab.id === id);
    const reader = globalThis.Zotero?.Reader?.getByTabID?.(id);
    return Boolean(native?.audioStatus?.active && !native.audioStatus.paused || native?.data?.soundPlaying || reader?.soundPlaying || reader?._internalReader?.hasUnsavedChanges);
  }
  async function closeWorkspaceTabs(win, tabIDs, options, tracked, store, prefs, closedStack) {
    const tabsApi = win.Zotero_Tabs;
    if (!tabsApi?.close || !tabIDs.length) return 0;
    const selectedID = String(tabsApi.selectedID || "");
    const trackedByID = new Map(tracked.map((t) => [t.tabID, t]));
    const toClose = [];
    for (const id of new Set(tabIDs)) {
      const t = trackedByID.get(id);
      if (!t || t.virtual) continue;
      if (options.protectPinned && t.pinned) continue;
      if (options.protectSelected && id === selectedID) continue;
      if (options.protectMedia !== false && isTabBusy(win, id)) continue;
      toClose.push(id);
    }
    if (!toClose.length) return 0;
    await tabsApi.close(toClose.length === 1 ? toClose[0] : toClose);
    for (const id of toClose) {
      const t = trackedByID.get(id);
      if (t.groupId && !store.state.virtualMembers[t.key] && (options.preserveVirtual ?? true) && prefs.get("workspace.enableVirtualMembers")) {
        store.saveVirtualMember(buildVirtualMetaFromTracked(t));
      }
      if (t.itemID > 0) {
        closedStack.push({ key: t.key, itemID: t.itemID, groupId: t.groupId, title: t.title, closedAt: Date.now() });
        if (closedStack.length > 20) closedStack.shift();
      }
      if (options.preserveVirtual === false && t.groupId) {
        store.removeVirtualMember(t.key);
        store.assignToGroup(t.key, null);
      }
      if (t.sleeping) store.setSleeping(t.key, false);
    }
    return toClose.length;
  }

  // src/domains/workspace/tab-controller.ts
  var WorkspaceTabController = class {
    prefs;
    store;
    clipboard;
    bus;
    closedByWindow = /* @__PURE__ */ new WeakMap();
    closedHistory(win) {
      let history = this.closedByWindow.get(win);
      if (!history) {
        history = [];
        this.closedByWindow.set(win, history);
      }
      return history;
    }
    constructor(prefs, store, clipboard, bus) {
      this.prefs = prefs;
      this.store = store;
      this.clipboard = clipboard;
      this.bus = bus;
    }
    citeItemsInWord(win, itemIDs) {
      const valid = [...new Set(itemIDs.filter((id) => Number.isInteger(id) && id > 0))];
      if (!valid.length || !this.bus || !this.prefs.get("modules.wordCite.enable") || !this.prefs.get("wordCite.tabContextMenu.enable")) {
        return false;
      }
      this.bus.emit("word:insert-items-request", { itemIDs: valid, win });
      return true;
    }
    buildTrackedTabs(win) {
      return projectWorkspaceTabs(win, this.store, this.prefs);
    }
    openKeys(win) {
      const tracked = this.buildTrackedTabs(win);
      for (const t of tracked) {
        if (t.itemID > 0) this.store.saveVirtualMember(buildVirtualMetaFromTracked(t));
      }
      return tracked.filter((t) => !t.virtual && t.itemID > 0).map((t) => t.key);
    }
    syncTrackedVirtualMeta(win, groupId) {
      const tracked = this.buildTrackedTabs(win).filter((t) => !groupId || t.groupId === groupId);
      const keys2 = [];
      for (const t of tracked) {
        if (t.itemID > 0) {
          this.store.saveVirtualMember(buildVirtualMetaFromTracked(t));
          keys2.push(t.key);
        }
      }
      if (groupId) {
        const grp = this.store.state.groups.find((g) => g.id === groupId);
        for (const k of grp?.memberKeys || []) {
          if (!keys2.includes(k)) keys2.push(k);
        }
      }
      return [...new Set(keys2)];
    }
    saveGroupSnapshot(win, groupId) {
      const group2 = this.store.state.groups.find((g) => g.id === groupId);
      if (!group2) return null;
      const groupKeys = this.syncTrackedVirtualMeta(win, groupId);
      return this.store.saveSession(group2.name, {
        openKeys: groupKeys,
        groupId
      });
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
      return closeWorkspaceTabs(win, tabIDs, options, this.buildTrackedTabs(win), this.store, this.prefs, this.closedHistory(win));
    }
    undoCloseTab(win) {
      const tabsApi = win.Zotero_Tabs;
      if (typeof tabsApi?.undoClose === "function") {
        try {
          void Promise.resolve(tabsApi.undoClose());
          return true;
        } catch {
        }
      }
      const last = this.closedHistory(win).pop();
      if (!last) return false;
      void this.openVirtualOrItem(win, last.itemID, last.groupId || void 0, false);
      return true;
    }
    sleepTab(win, tabID) {
      if (!this.prefs.get("workspace.enableTabSleep")) return false;
      const tabsApi = win.Zotero_Tabs;
      const tracked = this.buildTrackedTabs(win).find((t) => t.tabID === tabID);
      if (!tracked || tracked.pinned || tracked.virtual || tracked.sleeping) return false;
      if (tabsApi?.canUnload?.(tabID) === false) return false;
      if (typeof tabsApi?.unload !== "function" || tabsApi.selectedID === tabID || isTabBusy(win, tabID)) return false;
      if (tabsApi.unload(tabID) === false) return false;
      this.store.setSleeping(tracked.key, true);
      return true;
    }
    sleepInactiveTabs(win) {
      if (!this.prefs.get("workspace.enableTabSleep")) return 0;
      const selectedID = String(win.Zotero_Tabs?.selectedID || "");
      let count2 = 0;
      for (const tab of this.buildTrackedTabs(win)) {
        if (!tab.virtual && !tab.pinned && !tab.sleeping && tab.tabID !== selectedID) {
          if (this.sleepTab(win, tab.tabID)) count2++;
        }
      }
      return count2;
    }
    sleepIdleTabs(win, now = Date.now()) {
      const minutes = this.prefs.get("workspace.autoSleepMinutes");
      if (!this.prefs.get("workspace.enableTabSleep") || minutes <= 0) return 0;
      const selectedID = String(win.Zotero_Tabs?.selectedID || "");
      const cutoff = now - minutes * 6e4;
      let count2 = 0;
      for (const tab of this.buildTrackedTabs(win)) {
        if (tab.virtual || tab.pinned || tab.sleeping || tab.tabID === selectedID) continue;
        if (tab.lastViewedAt > 0 && tab.lastViewedAt < cutoff) {
          if (this.sleepTab(win, tab.tabID)) count2++;
        }
      }
      return count2;
    }
    async reloadTab(win, tabID) {
      const tracked = this.buildTrackedTabs(win).find((t) => t.tabID === tabID);
      if (!tracked) return false;
      this.store.setSleeping(tracked.key, false);
      this.selectTab(win, tabID);
      const reader = globalThis.Zotero?.Reader?.getByTabID?.(tabID);
      if (typeof reader?.reload === "function") await reader.reload();
      return true;
    }
    moveTabRelative(win, draggedTabID, targetTabID, after) {
      const tabsApi = win.Zotero_Tabs;
      if (!tabsApi?.move) return false;
      const ids = (Array.isArray(tabsApi._tabs) ? tabsApi._tabs : []).map((t) => String(t?.id || ""));
      const targetIdx = computeTabMoveTarget(ids, draggedTabID, targetTabID, after);
      if (targetIdx < 0) return false;
      tabsApi.move(draggedTabID, targetIdx);
      return true;
    }
    openVirtualOrItem(win, itemID, groupId, openInBackground = false) {
      return openItemAttachmentOrNote(win, this.store, itemID, groupId, openInBackground);
    }
    async restoreSession(win, session2, merge = true) {
      this.store.restoreSessionLayout(session2, merge, this.openKeys(win));
      return restoreSessionTabsAndLayout(win, this.store, session2);
    }
    getRecentlyClosed(win) {
      const openKeys = new Set(this.buildTrackedTabs(win).filter((t) => !t.virtual).map((t) => t.key));
      return collectRecentlyClosed(win, this.closedHistory(win), openKeys);
    }
    getPublicationSuggestions(win) {
      return buildPublicationSuggestions(this.buildTrackedTabs(win));
    }
    async openGroupVirtuals(win, groupId) {
      const virtuals = this.buildTrackedTabs(win).filter((t) => t.virtual && t.groupId === groupId);
      let opened = 0;
      for (const v of virtuals) {
        if (await this.openVirtualOrItem(win, v.itemID, groupId, true)) opened++;
      }
      return opened;
    }
    revealTabAttachment(win, itemID) {
      return revealAttachmentFile(win, itemID);
    }
    showInLibrary(win, itemID, switchCollection = false) {
      return selectItemInLibrary(win, itemID, switchCollection);
    }
    async archiveAndCloseGroup(win, groupId) {
      const group2 = this.store.state.groups.find((g) => g.id === groupId);
      if (!group2) return 0;
      this.saveGroupSnapshot(win, groupId);
      const ids = this.buildTrackedTabs(win).filter((t) => !t.virtual && t.groupId === groupId && t.tabID).map((t) => t.tabID);
      const closed = await this.closeTabs(win, ids, { preserveVirtual: false, protectPinned: true });
      const remainingLive = this.buildTrackedTabs(win).some((t) => !t.virtual && t.groupId === groupId);
      if (!remainingLive) {
        this.store.removeGroup(groupId);
      }
      return closed;
    }
    autoGroupByCollection(win, onlyTabIDs) {
      return autoGroupTrackedByCollection(
        win,
        this.store,
        this.prefs.get("workspace.multiCollectionStrategy"),
        this.buildTrackedTabs(win).filter((tab) => !onlyTabIDs || onlyTabIDs.has(tab.tabID))
      );
    }
    collectionToGroup(win, collectionName) {
      const targetCols = this.buildTrackedTabs(win).filter((t) => (t.collection || "未分类") === collectionName);
      if (!targetCols.length) return 0;
      const group2 = this.store.state.groups.find((g) => g.name === collectionName) ?? this.store.createGroup(collectionName);
      for (const tab of targetCols) {
        this.store.assignToGroup(tab.key, group2.id);
      }
      return targetCols.length;
    }
    getDisplayTitle(tab) {
      const titleMode = this.prefs.get("workspace.verticalTabTitleMode");
      const base = titleMode === "shortTitle" && tab.shortTitle ? tab.shortTitle : titleMode === "filename" && tab.filename ? tab.filename : tab.title;
      if (!this.prefs.get("workspace.enableTabRemarks") || !tab.remark) return base;
      const perTabMode = tab.key ? this.store.state.remarkModes[tab.key] : void 0;
      const mode = perTabMode || this.prefs.get("workspace.remarkDisplayMode");
      if (mode === "remark") return tab.remark;
      if (mode === "title") return base;
      return `${tab.remark} · ${base}`;
    }
    async copyTabCitation(win, tabID) {
      const tracked = this.buildTrackedTabs(win).find((t) => t.tabID === tabID);
      if (!tracked) return false;
      const item = globalThis.Zotero?.Items?.get?.(tracked.parentItemID || tracked.itemID);
      if (!item) return false;
      return this.clipboard.copyItems([item], { source: "tab-menu" });
    }
    async copyItemsCitations(itemIDs) {
      const hostItems = globalThis.Zotero?.Items;
      const items = itemIDs.map((id) => hostItems?.get?.(id)).filter(Boolean);
      if (!items.length) return false;
      return this.clipboard.copyItems(items, { source: "tab-menu" });
    }
    focusOrOpenItem(win, req) {
      return focusOrOpenTrackedItem(
        win,
        this.store,
        this.buildTrackedTabs(win),
        req,
        (tabID) => this.selectTab(win, tabID)
      );
    }
    groupOpenTabsByItemIDs(win, groupName, itemIDs) {
      const idSet = new Set(itemIDs);
      if (!idSet.size) return null;
      const matching = this.buildTrackedTabs(win).filter(
        (t) => !t.virtual && (idSet.has(t.parentItemID) || idSet.has(t.itemID))
      );
      if (!matching.length) return null;
      const group2 = this.store.state.groups.find((g) => g.name === groupName) ?? this.store.createGroup(groupName);
      for (const tab of matching) this.store.assignToGroup(tab.key, group2.id);
      return { groupId: group2.id, count: matching.length };
    }
    findStaleTabs(win, now = Date.now()) {
      const days = this.prefs.get("workspace.staleSuggestDays");
      const cutoff = now - days * 864e5;
      return this.buildTrackedTabs(win).filter(
        (t) => !t.virtual && !t.pinned && t.lastViewedAt > 0 && t.lastViewedAt < cutoff
      );
    }
    resolveActiveReaderSnapshot(win) {
      const selectedID = String(win.Zotero_Tabs?.selectedID || "");
      if (!selectedID || selectedID === "zotero-pane") return null;
      const current = this.buildTrackedTabs(win).find((t) => !t.virtual && t.tabID === selectedID);
      if (!current || current.key.startsWith("tab:") || !current.type.startsWith("reader")) return null;
      const { page, total } = readReaderPageMetrics(selectedID);
      return { tabID: selectedID, key: current.key, page, total };
    }
    trackReadingProgress(win, elapsedSeconds, options) {
      return trackActiveReaderProgress(win, this.store, this.buildTrackedTabs(win), elapsedSeconds, options);
    }
    openGroupAnnotationMatrix(win, groupId) {
      const group2 = groupId ? this.store.state.groups.find((g) => g.id === groupId) : null;
      const tracked = this.buildTrackedTabs(win).filter((t) => (!groupId || t.groupId === groupId) && (t.parentItemID > 0 || t.itemID > 0));
      const itemIDs = [...new Set(tracked.map((t) => t.parentItemID || t.itemID))];
      this.bus?.emit("visual-notes:open-matrix", {
        win,
        title: group2?.name || "已开文献",
        itemIDs
      });
    }
  };

  // src/domains/workspace/workspace-group-emitter.ts
  function buildWorkspaceGroupSummaries(windows, tabs, store) {
    const tabParentByKey = /* @__PURE__ */ new Map();
    for (const win of windows) {
      for (const tab of tabs.buildTrackedTabs(win)) {
        const pid = Number(tab.parentItemID || tab.itemID || 0);
        if (pid > 0) tabParentByKey.set(tab.key, pid);
      }
    }
    const hostItems = globalThis.Zotero?.Items;
    const resolveRegularId = (rawId) => {
      if (!Number.isSafeInteger(rawId) || rawId <= 0) return 0;
      const zItem = hostItems?.get?.(rawId);
      if (!zItem) return rawId;
      const reg = normalizeToRegularItem(zItem);
      return Number(reg?.id || 0);
    };
    const groups = [];
    for (const group2 of store.state.groups) {
      const seen = /* @__PURE__ */ new Set();
      for (const key of group2.memberKeys) {
        let rawId = tabParentByKey.get(key) || 0;
        if (!rawId) {
          const vm = store.state.virtualMembers[key];
          if (vm) rawId = Number(vm.parentItemID || vm.itemID || 0);
        }
        if (!rawId) {
          const m = key.match(/^item:(\d+)/);
          if (m) rawId = Number(m[1]);
        }
        const resolved = resolveRegularId(rawId);
        if (resolved > 0) seen.add(resolved);
      }
      groups.push({ groupId: group2.id, groupName: group2.name, itemIDs: [...seen] });
    }
    return groups;
  }

  // src/domains/workspace/workspace-elements.ts
  function createWorkspaceElement(doc, tag) {
    return doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
  }

  // src/domains/workspace/workspace-icons.ts
  var SVG_NS2 = "http://www.w3.org/2000/svg";
  var ICONS = {
    more: [
      { tag: "circle", attrs: { cx: "3.5", cy: "8", r: "1.1", fill: "currentColor", stroke: "none" } },
      { tag: "circle", attrs: { cx: "8", cy: "8", r: "1.1", fill: "currentColor", stroke: "none" } },
      { tag: "circle", attrs: { cx: "12.5", cy: "8", r: "1.1", fill: "currentColor", stroke: "none" } }
    ],
    layers: [
      { tag: "path", attrs: { d: "M8 2.2L2.2 5.3 8 8.4l5.8-3.1L8 2.2ZM2.2 8.2L8 11.3l5.8-3.1M2.2 11L8 14l5.8-3" } }
    ],
    bridge: [
      { tag: "path", attrs: { d: "M8 2.2L2.2 5.3 8 8.4l5.8-3.1L8 2.2ZM2.2 8.2L8 11.3l5.8-3.1M2.2 11L8 14l5.8-3" } }
    ],
    plus: [
      { tag: "path", attrs: { d: "M8 3.6v8.8M3.6 8h8.8" } }
    ],
    folder: [
      { tag: "path", attrs: { d: "M2.2 4.2a1 1 0 0 1 1-1h3l1.2 1.3h5.4a1 1 0 0 1 1 1v6.3a1 1 0 0 1-1 1H3.2a1 1 0 0 1-1-1V4.2Z" } }
    ],
    sleep: [
      { tag: "path", attrs: { d: "M12.8 9.9A5.4 5.4 0 0 1 6.1 3.2a5.5 5.5 0 1 0 6.7 6.7Z" } }
    ],
    sidebar: [
      { tag: "rect", attrs: { x: "2.2", y: "2.8", width: "11.6", height: "10.4", rx: "1.6" } },
      { tag: "path", attrs: { d: "M6 2.8v10.4" } }
    ],
    topbar: [
      { tag: "rect", attrs: { x: "2.2", y: "2.8", width: "11.6", height: "10.4", rx: "1.6" } },
      { tag: "path", attrs: { d: "M2.3 6.4h11.4" } }
    ],
    workspace: [
      { tag: "rect", attrs: { x: "2.2", y: "2.8", width: "11.6", height: "10.4", rx: "1.6" } },
      { tag: "path", attrs: { d: "M2.3 6h11.4M9.4 6v7.2" } }
    ],
    archive: [
      { tag: "rect", attrs: { x: "2.2", y: "3", width: "11.6", height: "2.6", rx: "0.8" } },
      { tag: "path", attrs: { d: "M3.2 5.6v6.6a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V5.6M6.5 8.4h3" } }
    ],
    search: [
      { tag: "circle", attrs: { cx: "7", cy: "7", r: "4.4" } },
      { tag: "path", attrs: { d: "M10.3 10.3L13.5 13.5" } }
    ],
    pin: [
      { tag: "path", attrs: { d: "M9.5 2.5L13.5 6.5L12 8L10.2 7.6L7.6 10.2L8 12L6.5 13.5L2.5 9.5L4 8L5.8 8.4L8.4 5.8L8 4L9.5 2.5Z" } },
      { tag: "path", attrs: { d: "M4.5 11.5L2 14" } }
    ],
    close: [
      { tag: "path", attrs: { d: "M4.5 4.5l7 7M11.5 4.5l-7 7" } }
    ],
    clock: [
      { tag: "circle", attrs: { cx: "8", cy: "8", r: "5.7" } },
      { tag: "path", attrs: { d: "M8 4.8V8l2.2 1.5" } }
    ],
    pdf: [
      { tag: "path", attrs: { d: "M4 2h5.5L13 5.5V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" } },
      { tag: "path", attrs: { d: "M9.5 2v3.5H13M5.5 8.5h5M5.5 11h3.5" } }
    ],
    note: [
      { tag: "path", attrs: { d: "M3.2 2.5h9.6a1 1 0 0 1 1 1v6.8L10.3 13.8H3.2a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" } },
      { tag: "path", attrs: { d: "M10 13.8v-3.5h3.5M5 6h5.5M5 8.8h3.8" } }
    ],
    virtual: [
      { tag: "circle", attrs: { cx: "8", cy: "8", r: "5.5", "stroke-dasharray": "2.4 2.1" } }
    ],
    edit: [
      { tag: "path", attrs: { d: "M10.8 2.6a1.4 1.4 0 0 1 2 2L5.5 11.9 2.6 12.6l.7-2.9 7.5-7.1Z" } },
      { tag: "path", attrs: { d: "M9.5 3.9l2 2" } }
    ],
    palette: [
      { tag: "path", attrs: { d: "M8 2.3a5.7 5.7 0 1 0 0 11.4c.9 0 1.5-.6 1.5-1.4 0-.4-.2-.7-.4-1-.2-.3-.3-.6-.3-.9 0-.7.6-1.3 1.3-1.3h1.4A2.5 2.5 0 0 0 13.7 6.6C13.7 4.1 11.1 2.3 8 2.3Z" } },
      { tag: "circle", attrs: { cx: "5.5", cy: "6.3", r: "0.8", fill: "currentColor", stroke: "none" } },
      { tag: "circle", attrs: { cx: "8", cy: "5", r: "0.8", fill: "currentColor", stroke: "none" } },
      { tag: "circle", attrs: { cx: "10.4", cy: "6.3", r: "0.8", fill: "currentColor", stroke: "none" } }
    ],
    trash: [
      { tag: "path", attrs: { d: "M3 4.4h10M6.2 4.4V3.1a.8.8 0 0 1 .8-.8h2a.8.8 0 0 1 .8.8v1.3M4.4 4.4l.6 8.3a1 1 0 0 0 1 .9h4a1 1 0 0 0 1-.9l.6-8.3M6.8 7v4M9.2 7v4" } }
    ],
    save: [
      { tag: "path", attrs: { d: "M3.4 2.6h7.4l2.6 2.6v7.4a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1V3.6a1 1 0 0 1 1-1Z" } },
      { tag: "path", attrs: { d: "M5.3 2.6v3.4h4.8V2.6M5.2 13.6V9.2h5.6v4.4" } }
    ],
    collapse: [
      { tag: "path", attrs: { d: "M4 6l4-3 4 3M4 10l4 3 4-3M3 8h10" } }
    ],
    word: [
      { tag: "rect", attrs: { x: "2.4", y: "2.4", width: "11.2", height: "11.2", rx: "1.8" } },
      { tag: "path", attrs: { d: "M4.7 5.3l1.4 5.4 1.9-4.1 1.9 4.1 1.4-5.4" } }
    ],
    copy: [
      { tag: "rect", attrs: { x: "5.5", y: "5.5", width: "7.8", height: "7.8", rx: "1.3" } },
      { tag: "path", attrs: { d: "M3.7 10.5H3.2a1 1 0 0 1-1-1V3.4a1 1 0 0 1 1-1h6.1a1 1 0 0 1 1 1v.5" } }
    ],
    locate: [
      { tag: "circle", attrs: { cx: "8", cy: "8", r: "4.5" } },
      { tag: "circle", attrs: { cx: "8", cy: "8", r: "1.4", fill: "currentColor", stroke: "none" } },
      { tag: "path", attrs: { d: "M8 2v1.6M8 12.4V14M2 8h1.6M12.4 8H14" } }
    ],
    refresh: [
      { tag: "path", attrs: { d: "M13.2 5.4A5.5 5.5 0 0 0 3.3 5M2.8 2.6v2.8h2.8M2.8 10.6a5.5 5.5 0 0 0 9.9.4M13.2 13.4v-2.8h-2.8" } }
    ],
    undo: [
      { tag: "path", attrs: { d: "M5.5 4.2L2.6 7l2.9 2.8" } },
      { tag: "path", attrs: { d: "M3 7h6.5a3.7 3.7 0 1 1 0 7.4H6.8" } }
    ],
    play: [
      { tag: "path", attrs: { d: "M4.5 3.3l8.2 4.7-8.2 4.7V3.3Z" } }
    ],
    eye: [
      { tag: "path", attrs: { d: "M1.8 8s2.3-4.2 6.2-4.2S14.2 8 14.2 8s-2.3 4.2-6.2 4.2S1.8 8 1.8 8Z" } },
      { tag: "circle", attrs: { cx: "8", cy: "8", r: "1.9" } }
    ]
  };
  function createWorkspaceIcon(doc, name, size = 13) {
    const svg = doc.createElementNS(SVG_NS2, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.35");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "zbf-tb-icon");
    for (const def of ICONS[name] || ICONS.layers) {
      const el = doc.createElementNS(SVG_NS2, def.tag);
      for (const [k, v] of Object.entries(def.attrs)) {
        el.setAttribute(k, v);
      }
      svg.appendChild(el);
    }
    return svg;
  }

  // src/domains/workspace/popup-menu-helpers.ts
  function createFloatingPopup(doc, anchor, event, minWidth = 228) {
    const host2 = doc.documentElement || doc.body;
    if (!host2) return null;
    const pop = createWorkspaceElement(doc, "div");
    pop.className = "zbf-popup-menu";
    pop.style.minWidth = `${minWidth}px`;
    host2.appendChild(pop);
    const rect = anchor.getBoundingClientRect();
    const hasMouse = Boolean(event && event.clientX > 0 && event.clientY > 0);
    const winW = doc.defaultView?.innerWidth || 1200;
    const winH = doc.defaultView?.innerHeight || 800;
    const popW = pop.offsetWidth || minWidth;
    const popH = Math.min(pop.offsetHeight || 260, winH - 16);
    const rawX = hasMouse ? event.clientX + 2 : rect.left > winW * 0.55 ? rect.right - popW : rect.left;
    let rawY = hasMouse ? event.clientY + 6 : rect.bottom + 6;
    if (rawY + popH > winH - 8) {
      rawY = hasMouse ? event.clientY - popH - 6 : rect.top - popH - 6;
    }
    const left = Math.max(8, Math.min(rawX, winW - popW - 12));
    const top = Math.max(8, Math.min(rawY, winH - popH - 8));
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    return pop;
  }
  function addPopupButton(doc, pop, label, onClick, closePopup, options = {}) {
    const btn = createWorkspaceElement(doc, "button");
    btn.type = "button";
    btn.className = `zbf-popup-item${options.danger ? " danger" : ""}`;
    if (options.disabled) btn.disabled = true;
    const left = createWorkspaceElement(doc, "span");
    left.className = "zbf-popup-item-main";
    if (options.icon) {
      left.appendChild(createWorkspaceIcon(doc, options.icon, 14));
    }
    const textSpan = createWorkspaceElement(doc, "span");
    textSpan.className = "zbf-popup-item-label";
    textSpan.textContent = label;
    left.appendChild(textSpan);
    btn.appendChild(left);
    if (options.badge) {
      const badgeEl = createWorkspaceElement(doc, "span");
      badgeEl.className = "zbf-popup-item-badge";
      badgeEl.textContent = options.badge;
      btn.appendChild(badgeEl);
    }
    btn.addEventListener("click", () => {
      closePopup();
      onClick();
    });
    pop.appendChild(btn);
    return btn;
  }
  function addPopupSeparator(doc, pop) {
    const sep = createWorkspaceElement(doc, "div");
    sep.className = "zbf-popup-sep";
    pop.appendChild(sep);
  }
  function addPopupSubmenuSection(doc, pop, label, icon, build, dotColor) {
    const wrap = createWorkspaceElement(doc, "div");
    wrap.className = "zbf-popup-submenu-wrap";
    const trigger = createWorkspaceElement(doc, "button");
    trigger.type = "button";
    trigger.className = "zbf-popup-item zbf-popup-submenu-trigger";
    const left = createWorkspaceElement(doc, "span");
    left.className = "zbf-popup-item-main";
    left.appendChild(createWorkspaceIcon(doc, icon, 14));
    const txt = createWorkspaceElement(doc, "span");
    txt.className = "zbf-popup-item-label";
    txt.textContent = label;
    left.appendChild(txt);
    if (dotColor) {
      const dot = createWorkspaceElement(doc, "span");
      dot.className = "zbf-popup-color-dot";
      dot.style.background = dotColor;
      left.appendChild(dot);
    }
    const arrow = createWorkspaceElement(doc, "span");
    arrow.className = "zbf-popup-submenu-arrow";
    arrow.textContent = "▸";
    trigger.append(left, arrow);
    const body = createWorkspaceElement(doc, "div");
    body.className = "zbf-popup-submenu-body";
    body.hidden = true;
    build(body);
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      body.hidden = !body.hidden;
      arrow.textContent = body.hidden ? "▸" : "▾";
    });
    wrap.append(trigger, body);
    pop.appendChild(wrap);
  }
  function openTextPromptModal(win, title, placeholder, initialValue, onConfirm, anchor) {
    const doc = win.document;
    const host2 = doc.documentElement || doc.body;
    if (!host2) return;
    const backdrop = createWorkspaceElement(doc, "div");
    backdrop.id = "zbf-hub-backdrop";
    backdrop.style.zIndex = "100020";
    const modal = createWorkspaceElement(doc, "div");
    modal.className = "zbf-hub-box";
    modal.style.maxWidth = "380px";
    modal.style.width = "360px";
    modal.style.position = "fixed";
    const target = anchor || doc.activeElement;
    const winW = win.innerWidth || 1200;
    const winH = win.innerHeight || 800;
    if (target && typeof target.getBoundingClientRect === "function") {
      const rect = target.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        const top = Math.max(12, Math.min(Math.round(rect.bottom + 8), winH - 180));
        const left = rect.left > winW * 0.55 ? Math.max(12, Math.min(Math.round(rect.right - 360), winW - 372)) : Math.max(12, Math.min(Math.round(rect.left), winW - 372));
        modal.style.top = `${top}px`;
        modal.style.left = `${left}px`;
      }
    }
    const head = createWorkspaceElement(doc, "div");
    head.className = "zbf-hub-head";
    const h3 = createWorkspaceElement(doc, "div");
    h3.className = "zbf-hub-title";
    h3.textContent = title;
    const closeBtn = createWorkspaceElement(doc, "button");
    closeBtn.type = "button";
    closeBtn.className = "zbf-hub-close";
    closeBtn.textContent = "✕";
    const input = createWorkspaceElement(doc, "input");
    input.type = "text";
    input.className = "zbf-hub-input";
    input.placeholder = placeholder;
    input.value = initialValue;
    const actions = createWorkspaceElement(doc, "div");
    actions.className = "zbf-hub-actions";
    actions.style.justifyContent = "flex-end";
    const cancelBtn = createWorkspaceElement(doc, "button");
    cancelBtn.type = "button";
    cancelBtn.className = "zbf-hub-btn";
    cancelBtn.textContent = "取消";
    const okBtn = createWorkspaceElement(doc, "button");
    okBtn.type = "button";
    okBtn.className = "zbf-hub-btn primary";
    okBtn.textContent = "确定";
    const cleanup = () => backdrop.remove();
    closeBtn.addEventListener("click", cleanup);
    cancelBtn.addEventListener("click", cleanup);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) cleanup();
    });
    const submit = () => {
      const val = input.value;
      cleanup();
      onConfirm(val);
    };
    okBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      const ke = e;
      if (ke.key === "Enter") {
        ke.preventDefault();
        submit();
      } else if (ke.key === "Escape") {
        ke.preventDefault();
        cleanup();
      }
    });
    head.append(h3, closeBtn);
    actions.append(cancelBtn, okBtn);
    modal.append(head, input, actions);
    backdrop.appendChild(modal);
    host2.appendChild(backdrop);
    win.setTimeout(() => {
      input.focus();
      input.select();
    }, 10);
  }

  // src/domains/workspace/pinned-strip.ts
  var HorizontalPinnedStrip = class {
    win;
    doc;
    prefs;
    tabs;
    menus;
    hover;
    activeMorePopup = null;
    outsideHandler = null;
    constructor(win, prefs, tabs, menus, hover) {
      this.win = win;
      this.doc = win.document;
      this.prefs = prefs;
      this.tabs = tabs;
      this.menus = menus;
      this.hover = hover;
    }
    render(container, pinnedTabs, selectedID) {
      if (!this.prefs.get("workspace.enablePinnedTabs") || !pinnedTabs.length) return;
      const strip = createWorkspaceElement(this.doc, "div");
      strip.className = "zbf-pinned-strip";
      const maxVisible = 5;
      const iconOnly = this.prefs.get("workspace.pinnedIconOnly");
      const visible = pinnedTabs.slice(0, maxVisible);
      const overflow = pinnedTabs.slice(maxVisible);
      for (const tab of visible) {
        const chip = createWorkspaceElement(this.doc, "button");
        chip.type = "button";
        chip.className = `zbf-pinned-chip${iconOnly ? " icon-only" : ""}${tab.tabID === selectedID ? " selected" : ""}`;
        chip.title = tab.title;
        chip.appendChild(createWorkspaceIcon(this.doc, "pin", 12));
        if (!iconOnly) {
          const span = createWorkspaceElement(this.doc, "span");
          span.textContent = this.tabs.getDisplayTitle(tab);
          chip.appendChild(span);
        }
        chip.addEventListener("click", () => this.tabs.selectTab(this.win, tab.tabID));
        chip.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          this.menus.openTabMenu(chip, tab, e);
        });
        this.hover.attach(chip, tab);
        strip.appendChild(chip);
      }
      if (overflow.length) {
        const moreBtn = createWorkspaceElement(this.doc, "button");
        moreBtn.type = "button";
        moreBtn.className = "zbf-pinned-more";
        moreBtn.textContent = `+${overflow.length}`;
        moreBtn.title = `另外 ${overflow.length} 个已固定标签页`;
        moreBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.openOverflowPopup(moreBtn, overflow, e);
        });
        strip.appendChild(moreBtn);
      }
      container.appendChild(strip);
    }
    destroy() {
      this.closePopup();
    }
    openOverflowPopup(anchor, overflow, event) {
      this.closePopup();
      const pop = createFloatingPopup(this.doc, anchor, event, 230);
      if (!pop) return;
      const close = () => this.closePopup();
      for (const tab of overflow) {
        addPopupButton(this.doc, pop, `📌 ${this.tabs.getDisplayTitle(tab)}`, () => {
          this.tabs.selectTab(this.win, tab.tabID);
        }, close);
      }
      this.activeMorePopup = pop;
      this.outsideHandler = (e) => {
        if (!pop.contains(e.target)) this.closePopup();
      };
      this.win.setTimeout(() => {
        if (this.outsideHandler) this.doc.addEventListener("mousedown", this.outsideHandler, true);
      }, 15);
    }
    closePopup() {
      this.activeMorePopup?.remove();
      this.activeMorePopup = null;
      if (this.outsideHandler) {
        this.doc.removeEventListener("mousedown", this.outsideHandler, true);
        this.outsideHandler = null;
      }
    }
  };

  // src/domains/workspace/workspace-drag.ts
  var BRIDGEFLOW_TAB_MIME = "application/x-zotero-bridgeflow-tab";
  function hasBridgeFlowDraggedTab(dt) {
    if (!dt?.types) return false;
    return Array.from(dt.types).includes(BRIDGEFLOW_TAB_MIME);
  }
  function hasZoteroDraggedItems(dt) {
    if (!dt?.types) return false;
    const types = Array.from(dt.types);
    return types.includes("zotero/item") || types.includes("text/x-moz-url");
  }
  function parseZoteroDraggedItemIDs(dt) {
    if (!dt) return [];
    const raw = dt.getData("zotero/item") || "";
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => Number(typeof v === "object" ? v?.id : v)).filter((n) => Number.isFinite(n) && n > 0);
      }
    } catch {
    }
    return raw.split(/[\s,;]+/).map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  }
  function beginTabDrag(dt, key, tabID) {
    if (!dt) return;
    try {
      dt.effectAllowed = "move";
      dt.setData(BRIDGEFLOW_TAB_MIME, JSON.stringify({ key, tabID }));
      dt.setData("text/plain", key);
    } catch {
    }
  }
  function readTabDragPayload(dt) {
    if (!dt) return null;
    try {
      const raw = dt.getData(BRIDGEFLOW_TAB_MIME);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.key) return { key: String(parsed.key), tabID: String(parsed.tabID || "") };
      }
    } catch {
    }
    const plain = dt.getData("text/plain");
    if (plain && (plain.startsWith("item:") || plain.startsWith("tab:"))) {
      return { key: plain, tabID: "" };
    }
    return null;
  }

  // src/domains/workspace/horizontal-bar.ts
  var WorkspaceHorizontalBar = class {
    win;
    doc;
    prefs;
    store;
    tabs;
    menus;
    hover;
    toolbar;
    pinnedStrip;
    onRefresh;
    inlineEl = null;
    headingClickTimer = 0;
    lastSelectedID = "";
    lastRenderKey = "";
    constructor(win, prefs, store, tabs, menus, hover, toolbar, onRefresh) {
      this.win = win;
      this.doc = win.document;
      this.prefs = prefs;
      this.store = store;
      this.tabs = tabs;
      this.menus = menus;
      this.hover = hover;
      this.toolbar = toolbar;
      this.onRefresh = onRefresh;
      this.pinnedStrip = new HorizontalPinnedStrip(win, prefs, tabs, menus, hover);
    }
    render(tracked) {
      this.toolbar.render(tracked);
      const tabBar = this.doc.getElementById("tab-bar-container");
      const inner = tabBar?.querySelector(".tab-bar-inner-container");
      if (!tabBar || !inner) return;
      const sidebarHealthy = this.prefs.get("workspace.enableVerticalSidebar") && !this.prefs.get("workspace.verticalSidebarCollapsed") && Boolean(this.doc.getElementById("zbf-sidebar")?.isConnected);
      const compactTop = this.prefs.get("workspace.enableHorizontalGroups") && this.prefs.get("workspace.compactTopBar") && sidebarHealthy;
      const enabled = this.prefs.get("workspace.enableHorizontalGroups") && !compactTop;
      if (!enabled) {
        tabBar.toggleAttribute("data-zbf-inline", compactTop);
        this.inlineEl?.setAttribute("hidden", "true");
        return;
      }
      tabBar.setAttribute("data-zbf-inline", "1");
      if (!this.inlineEl || !this.inlineEl.isConnected) {
        this.doc.getElementById("zbf-inline")?.remove();
        const inline = createWorkspaceElement(this.doc, "div");
        inline.id = "zbf-inline";
        inline.addEventListener("wheel", (e) => {
          const we = e;
          if (we.ctrlKey || inline.scrollWidth <= inline.clientWidth) return;
          we.preventDefault();
          inline.scrollLeft += we.deltaX || we.deltaY;
        }, { passive: false });
        inner.insertBefore(inline, inner.querySelector(".tabs-wrapper"));
        this.inlineEl = inline;
      }
      this.inlineEl.removeAttribute("hidden");
      const selectedID = String(this.win.Zotero_Tabs?.selectedID || "");
      const compactMode = this.prefs.get("workspace.horizontalTabCompactMode");
      const gKey = this.store.state.groups.map((g) => `${g.id}:${g.name}:${g.color}`).join(",");
      const tKey = tracked.map((t) => `${t.key}:${t.tabID}:${t.groupId}:${t.pinned ? 1 : 0}:${t.sleeping ? 1 : 0}:${t.virtual ? 1 : 0}:${t.remark}:${t.title}`).join("|");
      const renderKey = `${selectedID}|${compactMode}|${this.prefs.get("workspace.pinnedIconOnly")}|${this.store.state.collapsed.join(",")}|${gKey}|${tKey}`;
      if (renderKey === this.lastRenderKey && this.inlineEl.children.length > 0) return;
      this.lastRenderKey = renderKey;
      this.inlineEl.textContent = "";
      const pinnedTabs = tracked.filter((t) => !t.virtual && t.pinned);
      const unpinned = tracked.filter((t) => t.virtual || !t.pinned);
      this.pinnedStrip.render(this.inlineEl, pinnedTabs, selectedID);
      const compactInactive = compactMode === "compact" || compactMode === "auto" && unpinned.length > 5;
      for (const group2 of this.store.state.groups) {
        const members = unpinned.filter((t) => t.groupId === group2.id);
        if (!members.length && !this.store.state.groups.length) continue;
        this.inlineEl.appendChild(this.buildGroupSection(group2, members, selectedID, compactInactive));
      }
      const ungrouped = unpinned.filter((t) => !t.groupId);
      if (ungrouped.length) {
        const sec = createWorkspaceElement(this.doc, "div");
        sec.className = "zbf-hsection";
        for (const tab of ungrouped) {
          sec.appendChild(this.buildTabChip(tab, selectedID, compactInactive));
        }
        this.inlineEl.appendChild(sec);
      }
      const addBtn = createWorkspaceElement(this.doc, "button");
      addBtn.type = "button";
      addBtn.className = "zbf-add-group";
      addBtn.title = "新建分组";
      addBtn.setAttribute("aria-label", "新建标签页分组");
      addBtn.appendChild(createWorkspaceIcon(this.doc, "plus", 13));
      addBtn.addEventListener("click", () => {
        openTextPromptModal(this.win, "新建分组", "输入分组名称...", "新分组", (name) => {
          if (!name.trim()) return;
          this.store.createGroup(name);
          this.onRefresh();
        });
      });
      addBtn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.menus.openAddGroupMenu(addBtn, e);
      });
      this.bindDropToNewGroup(addBtn);
      this.inlineEl.appendChild(addBtn);
      if (selectedID && selectedID !== this.lastSelectedID) {
        this.lastSelectedID = selectedID;
        this.inlineEl.querySelector(".zbf-htab.selected")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      }
    }
    destroy() {
      if (this.headingClickTimer) this.win.clearTimeout(this.headingClickTimer);
      this.doc.getElementById("tab-bar-container")?.removeAttribute("data-zbf-inline");
      this.inlineEl?.remove();
      this.inlineEl = null;
      this.pinnedStrip.destroy();
      this.toolbar.destroy();
    }
    buildGroupSection(group2, members, selectedID, compactInactive) {
      const sec = createWorkspaceElement(this.doc, "div");
      sec.className = "zbf-hsection";
      sec.setAttribute("data-grouped", "true");
      sec.style.setProperty("--zbf-gcolor", group2.color);
      const isCollapsed = this.store.state.collapsed.includes(group2.id);
      const head = createWorkspaceElement(this.doc, "button");
      head.type = "button";
      head.className = "zbf-hheading";
      const labelText = `${isCollapsed ? "▸" : "▾"} ${group2.name} (${members.length})`;
      head.title = labelText;
      const dot = createWorkspaceElement(this.doc, "span");
      dot.className = "zbf-sb-group-dot";
      dot.style.background = group2.color;
      const nameSpan = createWorkspaceElement(this.doc, "span");
      nameSpan.textContent = labelText;
      head.append(dot, nameSpan);
      head.addEventListener("click", () => {
        if (this.headingClickTimer) this.win.clearTimeout(this.headingClickTimer);
        this.headingClickTimer = this.win.setTimeout(() => {
          this.headingClickTimer = 0;
          this.store.setCollapsed(group2.id, !this.store.state.collapsed.includes(group2.id));
          this.onRefresh();
        }, 210);
      });
      head.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        if (this.headingClickTimer) {
          this.win.clearTimeout(this.headingClickTimer);
          this.headingClickTimer = 0;
        }
        this.startInlineRename(head, group2);
      });
      head.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.menus.openGroupMenu(head, group2, e);
      });
      this.bindDropToGroup(head, group2.id);
      sec.appendChild(head);
      if (!isCollapsed) {
        const body = createWorkspaceElement(this.doc, "div");
        body.className = "zbf-hsection-body";
        for (const tab of members) {
          body.appendChild(this.buildTabChip(tab, selectedID, compactInactive));
        }
        sec.appendChild(body);
      }
      return sec;
    }
    buildTabChip(tab, selectedID, compactInactive) {
      const isSelected = !tab.virtual && tab.tabID === selectedID;
      const collapsed = compactInactive && !isSelected;
      const chip = createWorkspaceElement(this.doc, "div");
      chip.className = `zbf-htab${isSelected ? " selected" : ""}${tab.sleeping ? " sleeping" : ""}${tab.virtual ? " virtual" : ""}${collapsed ? " zbf-chip-collapsed" : ""}`;
      chip.title = this.tabs.getDisplayTitle(tab);
      if (!tab.virtual) {
        chip.draggable = true;
        chip.addEventListener("dragstart", (e) => beginTabDrag(e.dataTransfer, tab.key, tab.tabID));
      }
      const titleEl = createWorkspaceElement(this.doc, "span");
      titleEl.className = "zbf-htab-title";
      titleEl.textContent = collapsed ? "···" : this.tabs.getDisplayTitle(tab);
      chip.appendChild(titleEl);
      if (!tab.virtual && !collapsed) {
        const closeBtn = createWorkspaceElement(this.doc, "button");
        closeBtn.type = "button";
        closeBtn.className = "zbf-htab-close";
        closeBtn.title = "关闭标签页";
        closeBtn.appendChild(createWorkspaceIcon(this.doc, "close", 11));
        closeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          void this.tabs.closeTabs(this.win, [tab.tabID], { preserveVirtual: true });
        });
        chip.appendChild(closeBtn);
      }
      chip.addEventListener("click", () => {
        if (tab.virtual) void this.tabs.openVirtualOrItem(this.win, tab.itemID, tab.groupId).then(() => this.onRefresh());
        else this.tabs.selectTab(this.win, tab.tabID);
      });
      chip.addEventListener("auxclick", (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        if (!tab.virtual) void this.tabs.closeTabs(this.win, [tab.tabID], { preserveVirtual: true });
      });
      chip.addEventListener("contextmenu", (e) => {
        if (!this.prefs.get("workspace.enableTabContextMenu")) return;
        e.preventDefault();
        this.menus.openTabMenu(chip, tab, e);
      });
      this.bindDropToChip(chip, tab);
      this.hover.attach(chip, tab);
      return chip;
    }
    startInlineRename(head, group2) {
      const input = createWorkspaceElement(this.doc, "input");
      input.type = "text";
      input.className = "zbf-inline-edit";
      input.value = group2.name;
      head.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const finish = (commit) => {
        if (done) return;
        done = true;
        if (commit && input.value.trim()) this.store.renameGroup(group2.id, input.value);
        this.onRefresh();
      };
      input.addEventListener("keydown", (e) => {
        const ke = e;
        if (ke.key === "Enter") finish(true);
        else if (ke.key === "Escape") finish(false);
      });
      input.addEventListener("blur", () => finish(true));
    }
    bindDropToGroup(el, groupId) {
      el.addEventListener("dragover", (e) => {
        const de = e;
        if (!hasBridgeFlowDraggedTab(de.dataTransfer) && !hasZoteroDraggedItems(de.dataTransfer)) return;
        de.preventDefault();
        el.style.outline = "2px solid var(--zbf-accent)";
      });
      el.addEventListener("dragleave", () => {
        el.style.outline = "";
      });
      el.addEventListener("drop", (e) => {
        el.style.outline = "";
        const de = e;
        const payload = readTabDragPayload(de.dataTransfer);
        if (payload) {
          de.preventDefault();
          this.store.assignToGroup(payload.key, groupId);
          this.onRefresh();
          return;
        }
        const ids = parseZoteroDraggedItemIDs(de.dataTransfer);
        if (ids.length) {
          de.preventDefault();
          void Promise.all(ids.map((id) => this.tabs.openVirtualOrItem(this.win, id, groupId, true))).then(() => this.onRefresh());
        }
      });
    }
    bindDropToChip(el, target) {
      el.addEventListener("dragover", (e) => {
        const de = e;
        if (!hasBridgeFlowDraggedTab(de.dataTransfer) && !hasZoteroDraggedItems(de.dataTransfer)) return;
        de.preventDefault();
        el.setAttribute("data-zbf-drop", "stack");
      });
      el.addEventListener("dragleave", () => el.removeAttribute("data-zbf-drop"));
      el.addEventListener("drop", (e) => {
        el.removeAttribute("data-zbf-drop");
        const de = e;
        const payload = readTabDragPayload(de.dataTransfer);
        if (payload && payload.key !== target.key) {
          de.preventDefault();
          if (target.groupId) {
            this.store.assignToGroup(payload.key, target.groupId);
            if (payload.tabID && target.tabID) this.tabs.moveTabRelative(this.win, payload.tabID, target.tabID, true);
          } else {
            const newGrp = this.store.createGroup(this.tabs.getDisplayTitle(target).slice(0, 18));
            this.store.assignToGroup(target.key, newGrp.id);
            this.store.assignToGroup(payload.key, newGrp.id);
          }
          this.onRefresh();
          return;
        }
        const ids = parseZoteroDraggedItemIDs(de.dataTransfer);
        if (ids.length) {
          de.preventDefault();
          void Promise.all(ids.map((id) => this.tabs.openVirtualOrItem(this.win, id, target.groupId || void 0, true))).then(() => this.onRefresh());
        }
      });
    }
    bindDropToNewGroup(btn) {
      btn.addEventListener("dragover", (e) => {
        const de = e;
        if (!hasBridgeFlowDraggedTab(de.dataTransfer) && !hasZoteroDraggedItems(de.dataTransfer)) return;
        de.preventDefault();
      });
      btn.addEventListener("drop", (e) => {
        const de = e;
        const payload = readTabDragPayload(de.dataTransfer);
        if (payload) {
          de.preventDefault();
          const grp = this.store.createGroup("新分组");
          this.store.assignToGroup(payload.key, grp.id);
          this.onRefresh();
          return;
        }
        const ids = parseZoteroDraggedItemIDs(de.dataTransfer);
        if (ids.length) {
          de.preventDefault();
          const grp = this.store.createGroup("新分组");
          void Promise.all(ids.map((id) => this.tabs.openVirtualOrItem(this.win, id, grp.id, true))).then(() => this.onRefresh());
        }
      });
    }
  };

  // src/domains/workspace/horizontal-toolbar.ts
  var WorkspaceToolbarActions = class {
    win;
    doc;
    prefs;
    store;
    tabs;
    popover;
    onToggleSpotlight;
    onRefresh;
    buttons = /* @__PURE__ */ new Map();
    hostEl = null;
    constructor(win, prefs, store, tabs, popover, onToggleSpotlight, onRefresh) {
      this.win = win;
      this.doc = win.document;
      this.prefs = prefs;
      this.store = store;
      this.tabs = tabs;
      this.popover = popover;
      this.onToggleSpotlight = onToggleSpotlight;
      this.onRefresh = onRefresh;
    }
    render(tracked) {
      const bar = this.doc.getElementById("zotero-tabs-toolbar") || this.doc.querySelector("#tab-bar-container .tab-bar-inner-container");
      if (!bar) return;
      if (!this.hostEl || !this.hostEl.isConnected) {
        this.doc.getElementById("zbf-toolbar-actions")?.remove();
        const wrap = createWorkspaceElement(this.doc, "div");
        wrap.id = "zbf-toolbar-actions";
        bar.appendChild(wrap);
        this.hostEl = wrap;
      }
      const sidebarHealthy = this.prefs.get("workspace.enableVerticalSidebar") && !this.prefs.get("workspace.verticalSidebarCollapsed") && Boolean(this.doc.getElementById("zbf-sidebar")?.isConnected);
      const compactMode = this.prefs.get("workspace.enableHorizontalGroups") && this.prefs.get("workspace.compactTopBar") && sidebarHealthy;
      const actions = [];
      if (compactMode || this.prefs.get("workspace.enableHorizontalGroups") && sidebarHealthy) {
        actions.push({
          id: "compact",
          icon: "topbar",
          iconOnly: true,
          pressed: compactMode,
          label: "精简顶栏",
          title: compactMode ? "恢复水平分组标签栏" : "收起水平文献标签以节省顶部空间（保留文库与侧栏）",
          run: () => {
            this.prefs.set("workspace.compactTopBar", !compactMode);
            this.onRefresh();
          }
        });
      }
      if (this.prefs.get("workspace.enableVerticalSidebar")) {
        const open = !this.prefs.get("workspace.verticalSidebarCollapsed");
        actions.push({
          id: "sidebar",
          icon: "sidebar",
          iconOnly: true,
          pressed: open,
          label: "标签侧栏",
          title: open ? "收起垂直标签侧边栏" : "展开垂直标签侧边栏",
          run: () => {
            this.prefs.set("workspace.verticalSidebarCollapsed", open);
            this.onRefresh();
          }
        });
      }
      if (this.prefs.get("workspace.enableSpotlight")) {
        const isMac = Boolean(globalThis.Zotero?.isMac);
        const shortcut = isMac ? "⌘P" : "Ctrl+P";
        actions.push({
          id: "search",
          icon: "search",
          label: "快速查找",
          title: `查找标签、文献和操作（${shortcut}）`,
          run: (button) => this.onToggleSpotlight(button)
        });
      }
      if (this.prefs.get("workspace.enableSessions")) {
        const totalSaved = this.store.state.sessions.length + this.store.state.rollingSessions.length;
        actions.push({
          id: "workspace",
          icon: "workspace",
          popup: "dialog",
          count: totalSaved,
          label: "工作区",
          title: `已保存的工作区与快照 (${totalSaved})`,
          run: (button) => this.popover.openHub(button)
        });
      }
      if (this.prefs.get("workspace.enableStaleSuggestions")) {
        const staleCount = this.tabs.findStaleTabs(this.win).length;
        if (staleCount > 0) {
          actions.push({
            id: "stale",
            icon: "clock",
            popup: "menu",
            count: staleCount,
            status: "attention",
            label: "建议关闭",
            title: `建议关闭 (${staleCount})`,
            run: (button) => this.popover.openStaleMenu(button)
          });
        }
      }
      this.syncButtons(this.hostEl, actions);
    }
    destroy() {
      this.buttons.clear();
      this.hostEl?.remove();
      this.hostEl = null;
    }
    syncButtons(bar, actions) {
      const ids = new Set(actions.map(({ id }) => id));
      for (const [id, button] of this.buttons) {
        if (!ids.has(id)) {
          button.remove();
          this.buttons.delete(id);
        }
      }
      bar.hidden = actions.length === 0;
      let next = bar.firstElementChild;
      for (const action of actions) {
        const { id, label, title, icon, count: count2, pressed, popup } = action;
        let button = this.buttons.get(id);
        if (!button) {
          button = createWorkspaceElement(this.doc, "button");
          button.type = "button";
          button.className = "zbf-tb-btn";
          button.setAttribute("data-action", id);
          const svg = createWorkspaceIcon(this.doc, icon, 16);
          const caption2 = createWorkspaceElement(this.doc, "span");
          caption2.className = "zbf-tb-label";
          const badge2 = createWorkspaceElement(this.doc, "span");
          badge2.className = "zbf-tb-count";
          badge2.setAttribute("aria-hidden", "true");
          button.append(svg, caption2, badge2);
          this.buttons.set(id, button);
        }
        const caption = button.children[1];
        const badge = button.children[2];
        if (caption.textContent !== label) caption.textContent = label;
        const number2 = count2 ? count2 > 99 ? "99+" : String(count2) : "";
        if (badge.textContent !== number2) badge.textContent = number2;
        badge.hidden = !number2;
        button.title = title ?? label;
        button.setAttribute("aria-label", title?.startsWith(label) ? title : title ? `${label} · ${title}` : label);
        if (popup) button.setAttribute("aria-haspopup", popup);
        else button.removeAttribute("aria-haspopup");
        if (pressed !== void 0) button.setAttribute("aria-pressed", String(pressed));
        else button.removeAttribute("aria-pressed");
        button.classList.toggle("zbf-tb-icon-only", Boolean(action.iconOnly));
        button.classList.toggle("zbf-tb-attention", action.status === "attention");
        button.onclick = (e) => {
          e.stopPropagation();
          action.run(button);
        };
        if (button !== next) bar.insertBefore(button, next);
        next = button.nextElementSibling;
      }
    }
  };

  // src/domains/workspace/hover-card.ts
  function formatRelativeTimeZh(ts) {
    if (!ts) return "";
    const diffMin = Math.max(0, Math.floor((Date.now() - ts) / 6e4));
    if (diffMin < 1) return "刚刚";
    if (diffMin < 60) return `${diffMin} 分钟前`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours} 小时前`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} 天前`;
  }
  var WorkspaceHoverCard = class {
    doc;
    prefs;
    store;
    cardEl = null;
    showTimer = 0;
    hideTimer = 0;
    wordCiteMap = /* @__PURE__ */ new Map();
    constructor(doc, prefs, store) {
      this.doc = doc;
      this.prefs = prefs;
      this.store = store;
    }
    setWordCitationBadges(badges) {
      this.wordCiteMap = new Map(badges);
    }
    attach(target, tab) {
      target.addEventListener("mouseenter", () => {
        if (!this.prefs.get("workspace.enableHoverPreview")) return;
        this.clearTimers();
        const win = this.doc.defaultView || globalThis;
        this.showTimer = win.setTimeout(() => this.show(target, tab), 260);
      });
      target.addEventListener("mouseleave", () => {
        this.clearTimers();
        const win = this.doc.defaultView || globalThis;
        this.hideTimer = win.setTimeout(() => this.hide(), 90);
      });
      target.addEventListener("mousedown", () => this.hide());
    }
    show(anchor, tab) {
      this.hide();
      const host2 = this.doc.documentElement || this.doc.body;
      if (!host2) return;
      const card = createWorkspaceElement(this.doc, "div");
      card.className = "zbf-hover-card";
      card.setAttribute("data-zbf-hover-card", "1");
      const titleEl = createWorkspaceElement(this.doc, "div");
      titleEl.className = "zbf-hc-title";
      titleEl.textContent = tab.title;
      card.appendChild(titleEl);
      const subParts = [tab.creatorYear, tab.source].filter(Boolean);
      if (subParts.length) {
        const subEl = createWorkspaceElement(this.doc, "div");
        subEl.className = "zbf-hc-meta";
        subEl.textContent = subParts.join(" · ");
        card.appendChild(subEl);
      }
      if (tab.remark) {
        const remarkEl = createWorkspaceElement(this.doc, "div");
        remarkEl.className = "zbf-hc-note";
        remarkEl.textContent = `备注：${tab.remark}`;
        card.appendChild(remarkEl);
      }
      const group2 = tab.groupId ? this.store.state.groups.find((g) => g.id === tab.groupId) : null;
      const statusParts = [];
      if (group2) statusParts.push(`分组：${group2.name}`);
      if (tab.collection) statusParts.push(`集合：${tab.collection}`);
      const citeInfo = this.wordCiteMap.get(tab.parentItemID) || this.wordCiteMap.get(tab.itemID);
      if (citeInfo) statusParts.push(`Word [${citeInfo.ordinal}] (${citeInfo.documentName})`);
      if (tab.pinned) statusParts.push("已固定");
      if (tab.sleeping) statusParts.push("已休眠");
      if (tab.virtual) statusParts.push("虚拟成员");
      const rel = formatRelativeTimeZh(tab.lastViewedAt);
      if (rel) statusParts.push(`上次阅读：${rel}`);
      const reader = !tab.virtual && tab.tabID ? globalThis.Zotero?.Reader?.getByTabID?.(tab.tabID) : null;
      const ir = reader?._internalReader;
      const app = ir?._primaryView?._iframeWindow?.PDFViewerApplication;
      const pageIdx = typeof app?.page === "number" && app.page > 0 ? app.page - 1 : ir?._state?.primaryViewStats?.pageIndex ?? ir?._state?.primaryViewState?.pageIndex ?? reader?.state?.pageIndex;
      const numPages = app?.pagesCount || ir?._state?.primaryViewStats?.pagesCount || reader?._internalReader?._pdfDocument?.numPages || reader?.pagesCount;
      const storedProg = this.store.state.readingProgress[tab.key];
      const prog = formatReadingProgress(storedProg);
      if (typeof pageIdx === "number" && pageIdx >= 0) {
        const total = typeof numPages === "number" && numPages > 0 ? numPages : storedProg?.totalPages || 0;
        const dur = storedProg?.readSeconds && storedProg.readSeconds > 0 ? ` · ${prog.text.split(" · ")[0]}` : "";
        statusParts.push((total > 0 ? `第 ${pageIdx + 1} / ${total} 页` : `第 ${pageIdx + 1} 页`) + dur);
      } else if (prog.text) {
        statusParts.push(prog.text);
      }
      let peakNote = "";
      if (storedProg?.pageSeconds) {
        let peakPage = "";
        let peakSec = 0;
        for (const [p, sec] of Object.entries(storedProg.pageSeconds)) {
          if (sec > peakSec) {
            peakSec = sec;
            peakPage = p;
          }
        }
        if (peakPage && peakSec > 0) {
          peakNote = `最常停留 P${peakPage} (${Math.round(peakSec)}s)`;
          statusParts.push(peakNote);
        }
      }
      const itemObj = tab.itemID > 0 ? globalThis.Zotero?.Items?.get?.(tab.itemID) : null;
      let annots;
      try {
        const isFile = itemObj?.isFileAttachment ? itemObj.isFileAttachment() : itemObj?.isAttachment?.();
        if (isFile && typeof itemObj?.getAnnotations === "function") {
          annots = itemObj.getAnnotations()?.length;
        }
      } catch {
      }
      if (typeof annots === "number" && annots > 0) {
        statusParts.push(`批注 ${annots} 条`);
      }
      if (statusParts.length) {
        const footEl = createWorkspaceElement(this.doc, "div");
        footEl.className = "zbf-hc-meta";
        footEl.textContent = statusParts.join(" · ");
        card.appendChild(footEl);
      }
      const bucketCount = storedProg?.totalPages && storedProg.totalPages < 16 ? storedProg.totalPages : 16;
      const heat = buildReadingHeatmapBuckets(storedProg, bucketCount);
      if (heat.length) {
        const bar = createWorkspaceElement(this.doc, "div");
        bar.className = "zbf-hc-heatbar";
        bar.style.gridTemplateColumns = `repeat(${heat.length}, 1fr)`;
        const heatColor = String(this.prefs.get("workspace.readingHeatmap.color") || "").trim();
        const heatOpacity = Math.max(20, Math.min(95, Number(this.prefs.get("workspace.readingHeatmap.opacity") || 42))) / 100;
        if (heatColor) bar.style.setProperty("--zbf-heat-accent", heatColor);
        bar.title = peakNote ? `按页阅读热力分布 · ${peakNote}` : "按页阅读时长热力分布";
        for (const ratio of heat) {
          const cell = createWorkspaceElement(this.doc, "span");
          cell.className = "zbf-hc-heatcell";
          cell.style.opacity = String(ratio > 0 ? Math.max(0.24, Math.min(1, ratio * (0.45 + heatOpacity * 0.85))) : 0.12);
          if (ratio > 0) cell.setAttribute("data-active", "true");
          bar.appendChild(cell);
        }
        card.appendChild(bar);
      }
      host2.appendChild(card);
      const rect = anchor.getBoundingClientRect();
      const winW = this.doc.defaultView?.innerWidth || 1200;
      const winH = this.doc.defaultView?.innerHeight || 800;
      const cardW = card.offsetWidth || 320;
      const cardH = card.offsetHeight || 110;
      const left = Math.max(12, Math.min(rect.left, winW - cardW - 14));
      const top = rect.bottom + 8 + cardH <= winH ? rect.bottom + 8 : Math.max(12, rect.top - cardH - 8);
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
      this.cardEl = card;
    }
    hide() {
      this.clearTimers();
      this.cardEl?.remove();
      this.cardEl = null;
    }
    destroy() {
      this.hide();
    }
    clearTimers() {
      const win = this.doc.defaultView || globalThis;
      if (this.showTimer) win.clearTimeout(this.showTimer);
      if (this.hideTimer) win.clearTimeout(this.hideTimer);
      this.showTimer = 0;
      this.hideTimer = 0;
    }
  };

  // src/domains/workspace/spotlight-panel.ts
  var WorkspaceSpotlightPanel = class {
    win;
    doc;
    engine;
    panelEl = null;
    inputEl = null;
    listEl = null;
    results = [];
    activeIndex = 0;
    rows = [];
    timer = 0;
    dismissOutside = (event) => {
      if (this.panelEl && !event.composedPath().includes(this.panelEl) && !event.composedPath().some((node) => node.getAttribute?.("data-action") === "search")) this.close();
    };
    scheduleResults(delay) {
      this.win.clearTimeout(this.timer);
      this.timer = this.win.setTimeout(() => {
        this.timer = 0;
        if (this.inputEl) this.renderResults(this.inputEl.value);
      }, delay);
    }
    collapsedSections = /* @__PURE__ */ new Set(["groups"]);
    constructor(win, engine) {
      this.win = win;
      this.doc = win.document;
      this.engine = engine;
    }
    isOpen() {
      return Boolean(this.panelEl?.isConnected);
    }
    open(initialQuery = "", anchor) {
      if (this.isOpen()) {
        if (this.inputEl && initialQuery) {
          this.inputEl.value = initialQuery;
          this.renderResults(initialQuery);
        }
        this.positionNearAnchor(anchor);
        this.inputEl?.focus();
        return;
      }
      const host2 = this.doc.documentElement || this.doc.body;
      if (!host2) return;
      const panel = createWorkspaceElement(this.doc, "div");
      panel.id = "zbf-spotlight-panel";
      const inputWrap = createWorkspaceElement(this.doc, "div");
      inputWrap.className = "zbf-spot-input-wrap";
      inputWrap.appendChild(createWorkspaceIcon(this.doc, "search", 14));
      const input = createWorkspaceElement(this.doc, "input");
      input.id = "zbf-spotlight-input";
      input.type = "search";
      input.placeholder = "查找打开的标签、备注、分组或会话；输入 > 查看命令…";
      input.value = initialQuery;
      const clearBtn = createWorkspaceElement(this.doc, "button");
      clearBtn.type = "button";
      clearBtn.className = "zbf-spot-clear";
      clearBtn.textContent = "✕";
      clearBtn.title = "清空搜索";
      clearBtn.hidden = !initialQuery;
      clearBtn.addEventListener("click", () => {
        input.value = "";
        clearBtn.hidden = true;
        this.activeIndex = 0;
        this.renderResults("");
        input.focus();
      });
      input.addEventListener("input", () => {
        clearBtn.hidden = !input.value;
        this.activeIndex = 0;
        this.results = [];
        this.rows = [];
        this.listEl?.replaceChildren();
        this.scheduleResults(75);
      });
      input.addEventListener("keydown", (e) => this.handleKeydown(e));
      inputWrap.append(input, clearBtn);
      const list = createWorkspaceElement(this.doc, "div");
      list.id = "zbf-spotlight-list";
      const footer = createWorkspaceElement(this.doc, "div");
      footer.className = "zbf-spot-footer";
      footer.textContent = "↑↓ 选择 · Enter 打开/执行 · > 命令模式 · Esc 关闭";
      panel.append(inputWrap, list, footer);
      host2.appendChild(panel);
      this.panelEl = panel;
      this.inputEl = input;
      this.listEl = list;
      this.positionNearAnchor(anchor);
      input.focus();
      input.select();
      this.doc.addEventListener("pointerdown", this.dismissOutside, true);
      this.scheduleResults(16);
    }
    toggle(anchor) {
      if (this.isOpen()) this.close();
      else this.open("", anchor);
    }
    close() {
      this.doc.removeEventListener("pointerdown", this.dismissOutside, true);
      this.win.clearTimeout(this.timer);
      this.panelEl?.remove();
      this.panelEl = null;
      this.inputEl = null;
      this.listEl = null;
      this.results = [];
      this.rows = [];
    }
    destroy() {
      this.close();
    }
    positionNearAnchor(explicitAnchor) {
      if (!this.panelEl) return;
      const anchor = explicitAnchor || this.doc.querySelector('#zbf-toolbar-actions [data-action="search"]') || this.doc.getElementById("zbf-toolbar-actions");
      const winW = this.win.innerWidth || 1200;
      const winH = this.win.innerHeight || 800;
      const panelW = Math.min(480, winW - 24);
      this.panelEl.style.width = `${panelW}px`;
      if (anchor && typeof anchor.getBoundingClientRect === "function") {
        const rect = anchor.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          const top = Math.max(8, Math.min(Math.round(rect.bottom + 6), winH - 180));
          const left = Math.max(12, Math.min(Math.round(rect.right - panelW), winW - panelW - 12));
          this.panelEl.style.top = `${top}px`;
          this.panelEl.style.left = `${left}px`;
          return;
        }
      }
      this.panelEl.style.top = "44px";
      this.panelEl.style.left = `${Math.max(12, Math.round(winW - panelW - 16))}px`;
    }
    partitionSections(items) {
      const openTabs = [];
      const closedTabs = [];
      const groups = [];
      const sessions = [];
      const wordCites = [];
      const library = [];
      const commands = [];
      for (const it of items) {
        if (it.id.startsWith("closed:")) closedTabs.push(it);
        else if (it.id.startsWith("group:")) groups.push(it);
        else if (it.id.startsWith("session:")) sessions.push(it);
        else if (it.id.startsWith("lib:") || it.id.startsWith("recent-added:")) library.push(it);
        else if (it.category === "citation" || it.id.startsWith("word-cite:")) wordCites.push(it);
        else if (it.category === "command" || it.id.startsWith("cmd:")) commands.push(it);
        else openTabs.push(it);
      }
      return [
        { key: "tabs", title: "打开的标签页", items: openTabs },
        { key: "word", title: "Word 正在引用的文献", items: wordCites },
        { key: "closed", title: "最近关闭的标签页", items: closedTabs },
        { key: "sessions", title: "会话与快照", items: sessions },
        { key: "groups", title: "标签组", items: groups },
        { key: "library", title: "文库文献", items: library },
        { key: "actions", title: "快捷操作", items: commands }
      ].filter((s) => s.items.length > 0);
    }
    pickIcon(item) {
      if (item.id.startsWith("session:")) return "workspace";
      if (item.id.startsWith("group:")) return "folder";
      if (item.id.startsWith("closed:")) return "clock";
      if (item.category === "command" || item.id.startsWith("cmd:")) return "layers";
      if (item.badge?.includes("虚拟")) return "virtual";
      return "pdf";
    }
    renderResults(rawQuery) {
      if (!this.listEl) return;
      const fragment = this.doc.createDocumentFragment();
      const all = this.engine.query(rawQuery, this.win);
      const hasQuery = rawQuery.trim().length > 0;
      const sections = this.partitionSections(all);
      if (!sections.length) {
        this.results = [];
        this.rows = [];
        const empty = createWorkspaceElement(this.doc, "div");
        empty.className = "zbf-spotlight-empty";
        empty.textContent = hasQuery ? "没有匹配项。搜索整库请使用 Zotero 主文库搜索框。" : "当前没有打开的阅读标签。输入分组、会话名称，或输入 > 查看命令。";
        this.listEl.replaceChildren(empty);
        return;
      }
      const visible = [];
      this.rows = [];
      let rowIdx = 0;
      for (const sec of sections) {
        const collapsed = !hasQuery && this.collapsedSections.has(sec.key);
        const secHead = createWorkspaceElement(this.doc, "div");
        secHead.className = "zbf-spot-sec-head";
        secHead.setAttribute("data-collapsed", collapsed ? "true" : "false");
        const secTitle = createWorkspaceElement(this.doc, "span");
        secTitle.textContent = `${sec.title} (${sec.items.length})`;
        const secArrow = createWorkspaceElement(this.doc, "span");
        secArrow.className = "zbf-spot-sec-arrow";
        secArrow.textContent = collapsed ? "▸" : "▾";
        secHead.append(secTitle, secArrow);
        secHead.addEventListener("click", () => {
          if (this.collapsedSections.has(sec.key)) this.collapsedSections.delete(sec.key);
          else this.collapsedSections.add(sec.key);
          this.renderResults(this.inputEl?.value || "");
        });
        fragment.appendChild(secHead);
        if (collapsed) continue;
        for (const item of sec.items) {
          const idx = rowIdx++;
          visible.push(item);
          const row = createWorkspaceElement(this.doc, "div");
          row.setAttribute("role", "option");
          row.className = "zbf-spot-row";
          row.addEventListener("mouseenter", () => this.setActive(idx, false));
          row.addEventListener("click", () => {
            this.close();
            void Promise.resolve(item.action());
          });
          const topLine = createWorkspaceElement(this.doc, "div");
          topLine.className = "zbf-spot-row-top";
          topLine.appendChild(createWorkspaceIcon(this.doc, this.pickIcon(item), 14));
          const titleEl = createWorkspaceElement(this.doc, "span");
          titleEl.className = "zbf-spot-main";
          titleEl.textContent = item.title.replace(/^>\s*/, "");
          topLine.appendChild(titleEl);
          if (item.badge) {
            const badgeEl = createWorkspaceElement(this.doc, "span");
            badgeEl.className = "zbf-spot-badge";
            badgeEl.textContent = item.badge;
            topLine.appendChild(badgeEl);
          }
          row.appendChild(topLine);
          if (item.subtitle) {
            const subEl = createWorkspaceElement(this.doc, "div");
            subEl.className = "zbf-spot-sub";
            subEl.textContent = item.subtitle;
            row.appendChild(subEl);
          }
          fragment.appendChild(row);
          this.rows.push(row);
        }
      }
      this.listEl.replaceChildren(fragment);
      this.results = visible;
      this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.results.length - 1));
      this.rows[this.activeIndex]?.classList.add("active");
    }
    setActive(idx, scroll = true) {
      if (!this.results.length || !this.listEl) return;
      const next = (idx + this.results.length) % this.results.length;
      if (next !== this.activeIndex) {
        this.rows[this.activeIndex]?.classList.remove("active");
        this.rows[next]?.classList.add("active");
        this.activeIndex = next;
      }
      if (scroll) this.rows[next]?.scrollIntoView?.({ block: "nearest" });
    }
    handleKeydown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        this.setActive(this.activeIndex + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.setActive(this.activeIndex - 1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const picked = this.results[this.activeIndex];
        if (picked) {
          this.close();
          void Promise.resolve(picked.action());
        }
      }
    }
  };

  // src/domains/workspace/tab-context-menu.ts
  var WorkspaceTabContextMenu = class {
    win;
    doc;
    prefs;
    store;
    tabs;
    onRefresh;
    hoverCard;
    activePopup = null;
    boundOutside = null;
    constructor(win, prefs, store, tabs, onRefresh, hoverCard) {
      this.win = win;
      this.doc = win.document;
      this.prefs = prefs;
      this.store = store;
      this.tabs = tabs;
      this.onRefresh = onRefresh;
      this.hoverCard = hoverCard;
    }
    openTabMenu(anchor, tab, event) {
      this.hoverCard?.hide();
      if (tab.virtual) {
        this.openVirtualMenu(anchor, tab, event);
        return;
      }
      this.close();
      const pop = createFloatingPopup(this.doc, anchor, event, 232);
      if (!pop) return;
      const close = () => this.close();
      if (this.prefs.get("workspace.enablePinnedTabs")) {
        addPopupButton(this.doc, pop, tab.pinned ? "取消固定标签" : "固定标签（防误关）", () => {
          this.store.setPinned(tab.key, !tab.pinned);
          this.onRefresh();
        }, close, { icon: "pin" });
      }
      if (this.prefs.get("workspace.enableTabRemarks")) {
        addPopupButton(this.doc, pop, tab.remark ? "编辑标签备注…" : "设置标签备注…", () => {
          openTextPromptModal(this.win, "设置标签备注", "输入备注（≤300 字，留空清除）：", tab.remark || "", (val) => {
            this.store.setRemark(tab.key, val);
            this.onRefresh();
          }, anchor);
        }, close, { icon: "edit" });
        if (tab.remark) {
          addPopupSubmenuSection(this.doc, pop, "标签显示模式", "eye", (sub) => {
            const curMode = this.store.state.remarkModes[tab.key] || "";
            for (const [m, lbl] of [["", "跟随全局设置"], ["both", "备注 + 原标题"], ["remark", "仅显示备注"], ["title", "仅显示原标题"]]) {
              addPopupButton(this.doc, sub, `${curMode === m ? "✓ " : "   "}${lbl}`, () => {
                this.store.setRemarkMode(tab.key, m);
                this.onRefresh();
              }, close);
            }
          });
        }
      }
      if (this.prefs.get("workspace.enableTabSleep") && !tab.pinned) {
        addPopupButton(this.doc, pop, tab.sleeping ? "唤醒标签页" : "休眠标签（释放内存）", () => {
          if (tab.sleeping) void this.tabs.reloadTab(this.win, tab.tabID);
          else this.tabs.sleepTab(this.win, tab.tabID);
          this.onRefresh();
        }, close, { icon: "sleep" });
      }
      addPopupSeparator(this.doc, pop);
      addPopupSubmenuSection(this.doc, pop, "加入分组", "folder", (sub) => {
        for (const group2 of this.store.state.groups) {
          const inThis = tab.groupId === group2.id;
          addPopupButton(this.doc, sub, `${inThis ? "✓ " : "   "}${group2.name}`, () => {
            this.store.assignToGroup(tab.key, group2.id);
            this.onRefresh();
          }, close);
        }
        addPopupButton(this.doc, sub, "新建分组并加入…", () => {
          openTextPromptModal(this.win, "新建分组", "输入分组名称...", "新分组", (name) => {
            if (!name.trim()) return;
            const grp = this.store.createGroup(name);
            this.store.assignToGroup(tab.key, grp.id);
            this.onRefresh();
          }, anchor);
        }, close, { icon: "plus" });
        if (tab.groupId) {
          addPopupButton(this.doc, sub, "移出当前分组", () => {
            this.store.assignToGroup(tab.key, null);
            this.onRefresh();
          }, close, { icon: "close" });
        }
      });
      addPopupSeparator(this.doc, pop);
      if (tab.itemID > 0) {
        addPopupButton(this.doc, pop, "在文献库中定位", () => {
          void this.tabs.showInLibrary(this.win, tab.itemID, false);
        }, close, { icon: "locate" });
        addPopupButton(this.doc, pop, "在集合树中定位所属集合", () => {
          void this.tabs.showInLibrary(this.win, tab.itemID, true);
        }, close, { icon: "layers" });
      }
      if (this.prefs.get("workspace.enableCopyReference")) {
        addPopupButton(this.doc, pop, "复制引用到剪贴板", () => {
          void this.tabs.copyTabCitation(this.win, tab.tabID);
        }, close, { icon: "copy" });
      }
      if (tab.itemID > 0 && this.prefs.get("modules.wordCite.enable") && this.prefs.get("wordCite.tabContextMenu.enable")) {
        addPopupButton(this.doc, pop, "插入引文到 Word 光标处", () => {
          this.tabs.citeItemsInWord(this.win, [tab.parentItemID || tab.itemID]);
        }, close, { icon: "word" });
      }
      if (tab.itemID > 0 && this.prefs.get("workspace.enableShowInFilesystem")) {
        addPopupButton(this.doc, pop, "在文件管理器中显示", () => {
          void this.tabs.revealTabAttachment(this.win, tab.itemID);
        }, close, { icon: "folder" });
      }
      if (this.prefs.get("workspace.enableReloadTab")) {
        addPopupButton(this.doc, pop, "重新加载标签页", () => {
          void this.tabs.reloadTab(this.win, tab.tabID).then(() => this.onRefresh());
        }, close, { icon: "refresh" });
      }
      addPopupSeparator(this.doc, pop);
      if (this.prefs.get("workspace.enableVirtualMembers") && tab.groupId) {
        addPopupButton(this.doc, pop, "关闭标签（保留在分组）", () => {
          void this.tabs.closeTabs(this.win, [tab.tabID], { preserveVirtual: true });
        }, close, { icon: "virtual" });
      }
      addPopupButton(this.doc, pop, "彻底关闭标签页", () => {
        void this.tabs.closeTabs(this.win, [tab.tabID], { preserveVirtual: false });
      }, close, { icon: "close", danger: true });
      addPopupButton(this.doc, pop, "恢复最近关闭的标签页", () => {
        this.tabs.undoCloseTab(this.win);
        this.onRefresh();
      }, close, { icon: "undo" });
      this.bindPopup(pop);
    }
    openVirtualMenu(anchor, tab, event) {
      this.hoverCard?.hide();
      this.close();
      const pop = createFloatingPopup(this.doc, anchor, event, 215);
      if (!pop) return;
      const close = () => this.close();
      addPopupButton(this.doc, pop, "加载并打开文献", () => {
        void this.tabs.openVirtualOrItem(this.win, tab.itemID, tab.groupId).then(() => this.onRefresh());
      }, close, { icon: "play" });
      if (tab.itemID > 0) {
        addPopupButton(this.doc, pop, "在文献库中定位", () => {
          void this.tabs.showInLibrary(this.win, tab.itemID, true);
        }, close, { icon: "locate" });
        if (this.prefs.get("modules.wordCite.enable") && this.prefs.get("wordCite.tabContextMenu.enable")) {
          addPopupButton(this.doc, pop, "插入引文到 Word 光标处", () => {
            this.tabs.citeItemsInWord(this.win, [tab.parentItemID || tab.itemID]);
          }, close, { icon: "word" });
        }
      }
      addPopupSeparator(this.doc, pop);
      addPopupButton(this.doc, pop, "从分组移除虚拟成员", () => {
        this.store.removeVirtualMember(tab.key);
        this.store.assignToGroup(tab.key, null);
        this.onRefresh();
      }, close, { icon: "trash", danger: true });
      this.bindPopup(pop);
    }
    openGroupMenu(anchor, group2, event) {
      this.hoverCard?.hide();
      this.close();
      const pop = createFloatingPopup(this.doc, anchor, event, 236);
      if (!pop) return;
      const close = () => this.close();
      addPopupButton(this.doc, pop, "重命名分组…", () => {
        openTextPromptModal(this.win, "重命名分组", "分组名称：", group2.name, (val) => {
          if (this.store.renameGroup(group2.id, val)) this.onRefresh();
        }, anchor);
      }, close, { icon: "edit" });
      addPopupSubmenuSection(this.doc, pop, "分组颜色", "palette", (sub) => {
        const swatchRow = createWorkspaceElement(this.doc, "div");
        swatchRow.className = "zbf-color-row";
        for (const color of GROUP_PALETTE) {
          const swatch = createWorkspaceElement(this.doc, "button");
          swatch.type = "button";
          swatch.className = `zbf-color-swatch${color === group2.color ? " active" : ""}`;
          swatch.style.background = color;
          swatch.title = color;
          swatch.addEventListener("click", () => {
            this.store.setGroupColor(group2.id, color);
            this.close();
            this.onRefresh();
          });
          swatchRow.appendChild(swatch);
        }
        sub.appendChild(swatchRow);
        addPopupButton(this.doc, sub, "自定义 Hex 颜色…", () => {
          openTextPromptModal(this.win, "自定义颜色", "输入 3 位或 6 位 Hex 颜色（如 #3b82f6）：", group2.color, (hex) => {
            if (/^#[0-9a-fA-F]{3,8}$/.test(hex.trim())) {
              this.store.setGroupColor(group2.id, hex.trim());
              this.onRefresh();
            }
          }, anchor);
        }, close, { icon: "palette" });
      }, group2.color);
      addPopupSeparator(this.doc, pop);
      if (this.prefs.get("workspace.enableSessions")) {
        addPopupButton(this.doc, pop, "保存到工作区并关闭…", () => {
          void this.tabs.archiveAndCloseGroup(this.win, group2.id).then(() => this.onRefresh());
        }, close, { icon: "archive" });
        addPopupButton(this.doc, pop, "保存分组快照（保留标签）", () => {
          this.tabs.saveGroupSnapshot(this.win, group2.id);
          this.onRefresh();
        }, close, { icon: "save" });
      }
      if (this.prefs.get("workspace.enableAnnotationMatrix")) {
        addPopupButton(this.doc, pop, "生成本组文献对比矩阵…", () => {
          this.tabs.openGroupAnnotationMatrix(this.win, group2.id);
        }, close, { icon: "layers" });
      }
      addPopupButton(this.doc, pop, "折叠其他分组", () => {
        this.store.collapseOtherGroups(group2.id);
        this.onRefresh();
      }, close, { icon: "collapse", disabled: this.store.state.groups.length <= 1 });
      const virtualCount = this.tabs.buildTrackedTabs(this.win).filter((t) => t.virtual && t.groupId === group2.id).length;
      if (virtualCount > 0) {
        addPopupButton(this.doc, pop, "打开组内全部虚拟文献", () => {
          void this.tabs.openGroupVirtuals(this.win, group2.id).then(() => this.onRefresh());
        }, close, { icon: "play", badge: String(virtualCount) });
      }
      if (this.prefs.get("modules.wordCite.enable") && this.prefs.get("wordCite.tabContextMenu.enable")) {
        const groupItemIDs = [...new Set(
          this.tabs.buildTrackedTabs(this.win).filter((t) => t.groupId === group2.id && (t.parentItemID > 0 || t.itemID > 0)).map((t) => t.parentItemID || t.itemID)
        )];
        if (groupItemIDs.length > 0) {
          addPopupButton(this.doc, pop, "插入本组引文到 Word", () => {
            this.tabs.citeItemsInWord(this.win, groupItemIDs);
          }, close, { icon: "word", badge: String(groupItemIDs.length) });
        }
      }
      addPopupSeparator(this.doc, pop);
      addPopupButton(this.doc, pop, "仅打开本组（关闭其他标签）", () => {
        const ids = this.tabs.buildTrackedTabs(this.win).filter((t) => !t.virtual && t.groupId !== group2.id).map((t) => t.tabID);
        void this.tabs.closeTabs(this.win, ids, { preserveVirtual: true, protectPinned: true }).then(() => this.onRefresh());
      }, close, { icon: "layers" });
      addPopupButton(this.doc, pop, "关闭组内所有已开标签", () => {
        const ids = this.tabs.buildTrackedTabs(this.win).filter((t) => !t.virtual && t.groupId === group2.id).map((t) => t.tabID);
        void this.tabs.closeTabs(this.win, ids, { preserveVirtual: true, protectPinned: true }).then(() => this.onRefresh());
      }, close, { icon: "close" });
      addPopupButton(this.doc, pop, "解散此分组", () => {
        this.store.removeGroup(group2.id);
        this.onRefresh();
      }, close, { icon: "trash", danger: true });
      this.bindPopup(pop);
    }
    openAddGroupMenu(anchor, event) {
      this.hoverCard?.hide();
      this.close();
      const pop = createFloatingPopup(this.doc, anchor, event, 224);
      if (!pop) return;
      const close = () => this.close();
      addPopupButton(this.doc, pop, "新建空白分组…", () => {
        openTextPromptModal(this.win, "新建分组", "输入分组名称...", "新分组", (name) => {
          if (!name.trim()) return;
          this.store.createGroup(name);
          this.onRefresh();
        }, anchor);
      }, close, { icon: "plus" });
      addPopupButton(this.doc, pop, "按当前 Zotero 集合自动分组", () => {
        this.tabs.autoGroupByCollection(this.win);
        this.onRefresh();
      }, close, { icon: "folder" });
      this.bindPopup(pop);
    }
    close() {
      this.activePopup?.remove();
      this.activePopup = null;
      if (this.boundOutside) {
        this.doc.removeEventListener("mousedown", this.boundOutside, true);
        this.boundOutside = null;
      }
    }
    destroy() {
      this.close();
    }
    bindPopup(pop) {
      this.activePopup = pop;
      this.boundOutside = (e) => {
        if (!pop.contains(e.target)) this.close();
      };
      this.win.setTimeout(() => {
        if (this.boundOutside) this.doc.addEventListener("mousedown", this.boundOutside, true);
      }, 15);
    }
  };

  // src/domains/workspace/sidebar-keyboard.ts
  function visibleNavItems(list) {
    if (!list) return [];
    return Array.from(list.querySelectorAll("[data-zbf-nav]")).filter(
      (el) => Boolean(el) && typeof el.focus === "function" && !el.closest?.("[hidden]")
    );
  }
  function bindSidebarKeyboardNavigation(aside, list, searchInput, onClearSearch) {
    aside.addEventListener("keydown", (ev) => {
      const e = ev;
      if (e.isComposing || e.keyCode === 229) return;
      const target = e.target;
      if (target === searchInput) {
        if (e.key === "ArrowDown") {
          const first = visibleNavItems(list)[0];
          if (first) {
            e.preventDefault();
            first.focus();
            first.scrollIntoView({ block: "nearest" });
          }
        } else if (e.key === "Escape" && searchInput.value) {
          e.preventDefault();
          onClearSearch();
        }
        return;
      }
      if (target && (target.matches("input, textarea, select") || target.isContentEditable)) return;
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
        return;
      }
      const items = visibleNavItems(list);
      if (!items.length) return;
      const current = target?.closest("[data-zbf-nav]");
      const idx = current ? items.indexOf(current) : -1;
      let nextIdx = -1;
      if (e.key === "ArrowDown") nextIdx = idx < 0 ? 0 : Math.min(items.length - 1, idx + 1);
      else if (e.key === "ArrowUp") nextIdx = idx <= 0 ? 0 : idx - 1;
      else if (e.key === "Home") nextIdx = 0;
      else if (e.key === "End") nextIdx = items.length - 1;
      if (nextIdx >= 0 && items[nextIdx]) {
        e.preventDefault();
        items[nextIdx].focus();
        items[nextIdx].scrollIntoView({ block: "nearest" });
        return;
      }
      if (current && e.key === "Enter" && target === current) {
        e.preventDefault();
        current.click();
      }
    });
  }

  // src/domains/workspace/sidebar-list-helpers.ts
  function buildSidebarTabRow(deps, tab) {
    const { win, doc, prefs, store, tabs, menus, hover, selection, wordCiteMap, selectedID, onRefresh } = deps;
    const isSelected = !tab.virtual && tab.tabID === selectedID;
    const row = createWorkspaceElement(doc, "div");
    row.className = `zbf-vtab-row${isSelected ? " selected" : ""}${tab.sleeping ? " sleeping" : ""}${tab.virtual ? " virtual" : ""}`;
    row.tabIndex = 0;
    row.setAttribute("data-zbf-nav", "row");
    row.title = tab.title;
    const rowH = prefs.get("workspace.verticalTabRowHeight");
    if (rowH >= 28 && rowH <= 72) row.style.minHeight = `${rowH}px`;
    selection.addCheckbox(row, tab);
    const iconName = tab.pinned ? "pin" : tab.sleeping ? "sleep" : tab.virtual ? "virtual" : tab.type.includes("note") ? "note" : "pdf";
    row.appendChild(createWorkspaceIcon(doc, iconName, 13));
    const main = createWorkspaceElement(doc, "div");
    main.className = "zbf-vtab-main";
    const titleEl = createWorkspaceElement(doc, "div");
    titleEl.className = "zbf-vtab-title";
    titleEl.textContent = tabs.getDisplayTitle(tab);
    main.appendChild(titleEl);
    const subMode = prefs.get("workspace.verticalTabSubtitleMode");
    let subBase = "";
    if (tab.remark && prefs.get("workspace.enableTabRemarks")) {
      subBase = `备注：${tab.remark}`;
    } else if (subMode !== "none") {
      if (subMode === "source") subBase = tab.source || tab.creatorYear || tab.collection;
      else if (subMode === "creatorYear") subBase = tab.creatorYear || tab.source || tab.collection;
      else if (subMode === "collection") subBase = tab.collection || tab.creatorYear || tab.source;
      else if (subMode === "lastViewed") subBase = formatRelativeTimeZh(tab.lastViewedAt) || tab.creatorYear || tab.source;
    }
    const prog = formatReadingProgress2(store.state.readingProgress[tab.key]);
    const subText = [subBase, prog.text].filter(Boolean).join(" · ");
    if (subText) {
      const subEl = createWorkspaceElement(doc, "div");
      subEl.className = "zbf-vtab-sub";
      subEl.textContent = subText;
      main.appendChild(subEl);
    }
    if (prog.ratio !== null && prog.ratio > 0) {
      const bar = createWorkspaceElement(doc, "div");
      bar.className = "zbf-vtab-progress";
      const fill = createWorkspaceElement(doc, "span");
      fill.className = "zbf-vtab-progress-fill";
      fill.style.width = `${Math.round(prog.ratio * 100)}%`;
      bar.appendChild(fill);
      main.appendChild(bar);
    }
    row.appendChild(main);
    const right = createWorkspaceElement(doc, "div");
    right.className = "zbf-vtab-right";
    const citeInfo = wordCiteMap.get(tab.parentItemID) || wordCiteMap.get(tab.itemID);
    if (citeInfo) {
      const badge = createWorkspaceElement(doc, "span");
      badge.className = "zbf-cite-badge";
      badge.textContent = `[${citeInfo.ordinal}]`;
      badge.title = `${citeInfo.documentName}: ${citeInfo.shortText}（点击在文献库中定位）`;
      badge.style.cursor = "pointer";
      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        void tabs.showInLibrary(win, tab.parentItemID || tab.itemID, true);
      });
      right.appendChild(badge);
    }
    if (!tab.virtual && tab.itemID > 0 && prefs.get("workspace.enableShowInFilesystem")) {
      const folderBtn = createWorkspaceElement(doc, "button");
      folderBtn.type = "button";
      folderBtn.className = "zbf-row-btn";
      folderBtn.title = "在文件管理器中显示";
      folderBtn.appendChild(createWorkspaceIcon(doc, "folder", 12));
      folderBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void tabs.revealTabAttachment(win, tab.itemID);
      });
      right.appendChild(folderBtn);
    }
    if (!tab.virtual && !tab.pinned && prefs.get("workspace.enableTabSleep")) {
      const sleepBtn = createWorkspaceElement(doc, "button");
      sleepBtn.type = "button";
      sleepBtn.className = "zbf-row-btn";
      sleepBtn.title = tab.sleeping ? "唤醒并重新加载" : "休眠释放内存";
      sleepBtn.appendChild(createWorkspaceIcon(doc, "sleep", 12));
      sleepBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (tab.sleeping) void tabs.reloadTab(win, tab.tabID).then(onRefresh);
        else {
          tabs.sleepTab(win, tab.tabID);
          onRefresh();
        }
      });
      right.appendChild(sleepBtn);
    }
    const closeBtn = createWorkspaceElement(doc, "button");
    closeBtn.type = "button";
    closeBtn.className = "zbf-row-btn";
    closeBtn.title = tab.virtual ? "移除虚拟成员" : "关闭标签页";
    closeBtn.appendChild(createWorkspaceIcon(doc, "close", 12));
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (tab.virtual) {
        store.removeVirtualMember(tab.key);
        store.assignToGroup(tab.key, null);
        onRefresh();
      } else {
        void tabs.closeTabs(win, [tab.tabID], { preserveVirtual: true });
      }
    });
    right.appendChild(closeBtn);
    row.appendChild(right);
    if (!tab.virtual) {
      row.draggable = true;
      row.addEventListener("dragstart", (e) => beginTabDrag(e.dataTransfer, tab.key, tab.tabID));
    }
    bindRowDropTarget(deps, row, tab);
    row.addEventListener("click", () => {
      if (tab.virtual) void tabs.openVirtualOrItem(win, tab.itemID, tab.groupId).then(() => onRefresh());
      else tabs.selectTab(win, tab.tabID);
    });
    row.addEventListener("auxclick", (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      if (!tab.virtual) void tabs.closeTabs(win, [tab.tabID], { preserveVirtual: true });
    });
    row.addEventListener("contextmenu", (e) => {
      if (!prefs.get("workspace.enableTabContextMenu")) return;
      e.preventDefault();
      menus.openTabMenu(row, tab, e);
    });
    hover.attach(row, tab);
    return row;
  }
  function bindSidebarGroupDrop(head, groupId, win, store, tabs, onRefresh) {
    head.addEventListener("dragover", (e) => {
      const de = e;
      if (!hasBridgeFlowDraggedTab(de.dataTransfer) && !hasZoteroDraggedItems(de.dataTransfer)) return;
      de.preventDefault();
      head.style.background = "var(--zbf-accent-soft)";
    });
    head.addEventListener("dragleave", () => {
      head.style.background = "";
    });
    head.addEventListener("drop", (e) => {
      head.style.background = "";
      const de = e;
      const payload = readTabDragPayload(de.dataTransfer);
      if (payload) {
        de.preventDefault();
        store.assignToGroup(payload.key, groupId);
        onRefresh();
        return;
      }
      const ids = parseZoteroDraggedItemIDs(de.dataTransfer);
      if (ids.length) {
        de.preventDefault();
        void Promise.all(ids.map((id) => tabs.openVirtualOrItem(win, id, groupId, true))).then(() => onRefresh());
      }
    });
  }
  function bindSidebarSplitter(doc, aside, splitter, prefs) {
    let dragging = false;
    splitter.addEventListener("mousedown", (e) => {
      const me = e;
      me.preventDefault();
      dragging = true;
      splitter.classList.add("active");
      const startX = me.clientX;
      const startW = aside.getBoundingClientRect().width || 276;
      const onMove = (ev) => {
        if (!dragging) return;
        const mv = ev;
        const next = Math.max(200, Math.min(440, Math.round(startW + (mv.clientX - startX))));
        aside.style.width = `${next}px`;
      };
      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        splitter.classList.remove("active");
        const w = Math.round(aside.getBoundingClientRect().width || 276);
        prefs.set("workspace.verticalSidebarWidth", Math.max(200, Math.min(440, w)));
        doc.removeEventListener("mousemove", onMove, true);
        doc.removeEventListener("mouseup", onUp, true);
      };
      doc.addEventListener("mousemove", onMove, true);
      doc.addEventListener("mouseup", onUp, true);
    });
  }
  function bindRowDropTarget(deps, row, target) {
    const { win, store, tabs, onRefresh } = deps;
    const clearZone = () => row.removeAttribute("data-zbf-drop");
    row.addEventListener("dragover", (e) => {
      const de = e;
      if (!hasBridgeFlowDraggedTab(de.dataTransfer) && !hasZoteroDraggedItems(de.dataTransfer)) return;
      de.preventDefault();
      const rect = row.getBoundingClientRect();
      const ratio = rect.height > 0 ? (de.clientY - rect.top) / rect.height : 0.5;
      const zone = ratio < 0.28 ? "before" : ratio > 0.72 ? "after" : "join";
      row.setAttribute("data-zbf-drop", zone);
    });
    row.addEventListener("dragleave", clearZone);
    row.addEventListener("drop", (e) => {
      const zone = row.getAttribute("data-zbf-drop") || "join";
      clearZone();
      const de = e;
      const payload = readTabDragPayload(de.dataTransfer);
      if (payload && payload.key !== target.key) {
        de.preventDefault();
        if (zone === "join") {
          if (target.groupId) store.assignToGroup(payload.key, target.groupId);
          else {
            const newGrp = store.createGroup(tabs.getDisplayTitle(target).slice(0, 18));
            store.assignToGroup(target.key, newGrp.id);
            store.assignToGroup(payload.key, newGrp.id);
          }
        } else {
          const after = zone === "after";
          store.assignKeyRelative(payload.key, target.groupId || null, target.key, after);
          if (payload.tabID && target.tabID) tabs.moveTabRelative(win, payload.tabID, target.tabID, after);
        }
        onRefresh();
        return;
      }
      const ids = parseZoteroDraggedItemIDs(de.dataTransfer);
      if (ids.length) {
        de.preventDefault();
        void Promise.all(ids.map((id) => tabs.openVirtualOrItem(win, id, target.groupId || void 0, true))).then(() => onRefresh());
      }
    });
  }

  // src/domains/workspace/sidebar-sections-helpers.ts
  function renderSidebarEmptyBox(doc, win, hasAnyTabs, onClearSearch, onOpenHub) {
    const box = createWorkspaceElement(doc, "div");
    box.className = "zbf-sb-empty";
    const msg = createWorkspaceElement(doc, "div");
    msg.textContent = hasAnyTabs ? "未找到匹配的文献标签页" : "当前没有打开的文献标签页";
    box.appendChild(msg);
    if (hasAnyTabs) {
      const clearBtn = createWorkspaceElement(doc, "button");
      clearBtn.type = "button";
      clearBtn.className = "zbf-sb-empty-btn";
      clearBtn.textContent = "清除搜索条件";
      clearBtn.addEventListener("click", onClearSearch);
      box.appendChild(clearBtn);
    } else {
      const libBtn = createWorkspaceElement(doc, "button");
      libBtn.type = "button";
      libBtn.className = "zbf-sb-empty-btn";
      libBtn.textContent = "返回「我的文库」";
      libBtn.addEventListener("click", () => win.Zotero_Tabs?.select?.("zotero-pane"));
      const sesBtn = createWorkspaceElement(doc, "button");
      sesBtn.type = "button";
      sesBtn.className = "zbf-sb-empty-btn";
      sesBtn.textContent = "恢复最近会话快照";
      sesBtn.addEventListener("click", onOpenHub);
      box.append(libBtn, sesBtn);
    }
    return box;
  }
  function renderSidebarStatusBar(doc, win, statusEl, prefs, tabs, allTracked, onRefresh) {
    statusEl.textContent = "";
    const active = allTracked.filter((t) => !t.virtual && !t.sleeping).length;
    const sleeping = allTracked.filter((t) => !t.virtual && t.sleeping).length;
    const virtual = allTracked.filter((t) => t.virtual).length;
    const counts = createWorkspaceElement(doc, "span");
    counts.textContent = `活动 ${active} · 休眠 ${sleeping} · 虚拟 ${virtual}`;
    statusEl.appendChild(counts);
    const budget = prefs.get("workspace.activeReaderBudget");
    if (budget > 0 && active > budget && prefs.get("workspace.enableTabSleep")) {
      const warn = createWorkspaceElement(doc, "button");
      warn.type = "button";
      warn.className = "zbf-sb-budget-warn";
      warn.textContent = `超出 ${budget} 篇上限 · 休眠后台`;
      warn.addEventListener("click", () => {
        tabs.sleepInactiveTabs(win);
        onRefresh();
      });
      statusEl.appendChild(warn);
    }
  }
  function appendSidebarSectionHead(doc, listEl, title, color) {
    const head = createWorkspaceElement(doc, "div");
    head.className = "zbf-sb-group-head";
    head.tabIndex = 0;
    head.setAttribute("data-zbf-nav", "head");
    const dot = createWorkspaceElement(doc, "span");
    dot.className = "zbf-sb-group-dot";
    dot.style.background = color;
    const span = createWorkspaceElement(doc, "span");
    span.textContent = title;
    head.append(dot, span);
    listEl.appendChild(head);
  }
  function renderSidebarCollectionsList(listEl, rowDeps, filtered) {
    const { doc, win, tabs, onRefresh } = rowDeps;
    const byCol = /* @__PURE__ */ new Map();
    for (const tab of filtered) {
      const col = tab.collection || "未分类";
      const arr = byCol.get(col) || [];
      arr.push(tab);
      byCol.set(col, arr);
    }
    for (const [colName, colTabs] of byCol) {
      const rowHead = createWorkspaceElement(doc, "div");
      rowHead.className = "zbf-sb-group-head-row";
      const h = createWorkspaceElement(doc, "div");
      h.className = "zbf-sb-group-head";
      h.textContent = `📁 ${colName} (${colTabs.length})`;
      rowHead.appendChild(h);
      if (colName !== "未分类") {
        const toGrp = createWorkspaceElement(doc, "button");
        toGrp.type = "button";
        toGrp.className = "zbf-sb-col-group-btn";
        toGrp.textContent = "+";
        toGrp.title = `将集合「${colName}」转为标签分组`;
        toGrp.addEventListener("click", () => {
          tabs.collectionToGroup(win, colName);
          onRefresh();
        });
        rowHead.appendChild(toGrp);
      }
      listEl.appendChild(rowHead);
      for (const tab of colTabs) listEl.appendChild(buildSidebarTabRow(rowDeps, tab));
    }
  }

  // src/domains/workspace/sidebar-selection.ts
  var SidebarSelection = class {
    active = false;
    selected = /* @__PURE__ */ new Set();
    tracked = [];
    toggleBtn;
    controls;
    countEl;
    selectAllBtn;
    groupSelect;
    pinBtn;
    unpinBtn;
    copyRefsBtn;
    citeWordBtn;
    closeBtn;
    doc;
    prefs;
    store;
    list;
    onChange;
    onCloseSelected;
    onCopySelected;
    onCiteSelected;
    constructor(doc, prefs, store, headerActions, aside, list, onChange, onCloseSelected, onCopySelected, onCiteSelected) {
      this.doc = doc;
      this.prefs = prefs;
      this.store = store;
      this.list = list;
      this.onChange = onChange;
      this.onCloseSelected = onCloseSelected;
      this.onCopySelected = onCopySelected;
      this.onCiteSelected = onCiteSelected;
      this.toggleBtn = this.btn("多选", () => {
        this.active = !this.active;
        this.selected.clear();
        this.onChange();
      });
      this.toggleBtn.setAttribute("data-batch-toggle", "true");
      headerActions.prepend(this.toggleBtn);
      this.controls = this.h("div");
      this.controls.className = "zbf-batch-controls";
      this.controls.hidden = true;
      this.countEl = this.h("span");
      this.selectAllBtn = this.btn("全选可见", () => {
        for (const cb of this.visibleCheckboxes()) {
          this.selected.add(cb.value);
          cb.checked = true;
        }
        this.updateControls();
      });
      this.groupSelect = this.h("select");
      this.groupSelect.onchange = () => {
        if (this.groupSelect.selectedIndex > 0) {
          const targetGroupId = this.groupSelect.value;
          for (const key of this.selectedKeys()) {
            this.store.assignToGroup(key, targetGroupId);
          }
          this.onChange();
        }
        this.groupSelect.selectedIndex = 0;
      };
      this.pinBtn = this.btn("固定", () => {
        for (const key of this.selectedKeys()) this.store.setPinned(key, true);
        this.onChange();
      });
      this.unpinBtn = this.btn("取消固定", () => {
        for (const key of this.selectedKeys()) this.store.setPinned(key, false);
        this.onChange();
      });
      this.copyRefsBtn = this.btn("复制引文", () => {
        this.onCopySelected?.(this.selectedItemIDs());
      });
      this.citeWordBtn = this.btn("插入Word", () => {
        this.onCiteSelected?.(this.selectedItemIDs());
      });
      this.closeBtn = this.btn("关闭", () => {
        const ids = [...this.selected];
        this.selected.clear();
        this.onCloseSelected(ids);
      });
      this.controls.append(this.countEl, this.selectAllBtn, this.groupSelect, this.pinBtn, this.unpinBtn, this.copyRefsBtn, this.citeWordBtn, this.closeBtn);
      aside.insertBefore(this.controls, list);
    }
    beginRender(tracked) {
      const enabled = this.prefs.get("workspace.enableBatchSelection");
      if (!enabled) {
        this.active = false;
        this.selected.clear();
      }
      this.tracked = tracked;
      const open = new Set(tracked.map((t) => t.tabID).filter(Boolean));
      for (const id of this.selected) if (!open.has(id)) this.selected.delete(id);
      this.toggleBtn.hidden = !enabled;
      this.toggleBtn.setAttribute("aria-pressed", String(this.active));
      this.controls.hidden = !this.active;
      if (!this.active) return;
      const placeholder = this.h("option");
      placeholder.disabled = true;
      placeholder.selected = true;
      placeholder.textContent = "移到分组…";
      this.groupSelect.replaceChildren(placeholder);
      for (const group2 of this.store.state.groups) {
        const opt = this.h("option");
        opt.value = group2.id;
        opt.textContent = group2.name;
        this.groupSelect.append(opt);
      }
    }
    updateControls() {
      if (!this.active) return;
      const count2 = this.selected.size;
      this.countEl.textContent = `已选 ${count2}`;
      this.selectAllBtn.disabled = !this.visibleCheckboxes().some((cb) => !cb.checked);
      this.groupSelect.disabled = !count2 || !this.store.state.groups.length;
      const pinOn = this.prefs.get("workspace.enablePinnedTabs");
      this.pinBtn.hidden = !pinOn;
      this.unpinBtn.hidden = !pinOn;
      this.pinBtn.disabled = !count2;
      this.unpinBtn.disabled = !count2;
      this.copyRefsBtn.hidden = !this.onCopySelected || !this.prefs.get("workspace.enableCopyReference");
      this.copyRefsBtn.disabled = !count2;
      this.citeWordBtn.hidden = !this.onCiteSelected || !this.prefs.get("modules.wordCite.enable") || !this.prefs.get("wordCite.dragCite.enable");
      this.citeWordBtn.disabled = !count2;
      this.closeBtn.disabled = !count2;
    }
    addCheckbox(row, tab) {
      if (!this.active || !tab.tabID) return;
      const label = this.h("label");
      label.className = "zbf-batch-target";
      const check = this.h("input");
      check.className = "zbf-batch-check";
      check.type = "checkbox";
      check.value = tab.tabID;
      check.checked = this.selected.has(tab.tabID);
      check.setAttribute("aria-label", tab.title);
      check.onchange = () => {
        if (check.checked) this.selected.add(tab.tabID);
        else this.selected.delete(tab.tabID);
        this.updateControls();
      };
      label.onclick = (e) => e.stopPropagation();
      label.append(check);
      row.prepend(label);
    }
    visibleCheckboxes() {
      return Array.from(this.list.querySelectorAll(".zbf-batch-check")).filter((cb) => !cb.closest("[hidden]"));
    }
    selectedKeys() {
      return [...new Set(this.tracked.filter((t) => this.selected.has(t.tabID)).map((t) => t.key))];
    }
    selectedItemIDs() {
      return [...new Set(this.tracked.filter((t) => this.selected.has(t.tabID)).map((t) => t.parentItemID || t.itemID).filter((id) => id > 0))];
    }
    h(tag) {
      return this.doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
    }
    btn(label, onClick) {
      const b = this.h("button");
      b.type = "button";
      b.textContent = label;
      b.onclick = onClick;
      return b;
    }
  };

  // src/domains/workspace/vertical-sidebar.ts
  var WorkspaceVerticalSidebar = class {
    win;
    doc;
    prefs;
    store;
    tabs;
    menus;
    hover;
    popover;
    onToggleSpotlight;
    onRefresh;
    asideEl = null;
    listEl = null;
    statusEl = null;
    viewButtons = /* @__PURE__ */ new Map();
    selection = null;
    viewMode = "groups";
    searchTerm = "";
    lastRenderKey = "";
    wordCiteMap = /* @__PURE__ */ new Map();
    constructor(win, prefs, store, tabs, menus, hover, popover, onToggleSpotlight, onRefresh) {
      this.win = win;
      this.doc = win.document;
      this.prefs = prefs;
      this.store = store;
      this.tabs = tabs;
      this.menus = menus;
      this.hover = hover;
      this.popover = popover;
      this.onToggleSpotlight = onToggleSpotlight;
      this.onRefresh = onRefresh;
    }
    setWordCitationBadges(badges) {
      this.wordCiteMap = new Map(badges);
    }
    render(snapshot) {
      const mainDeck = this.win.Zotero_Tabs?.deck || this.doc.getElementById("zotero-main-window-deck") || this.doc.querySelector("#main-deck, #zotero-pane-stack")?.parentElement || this.doc.getElementById("zotero-pane")?.parentElement;
      if (!mainDeck) return;
      if (!this.asideEl || !this.asideEl.isConnected) {
        this.doc.getElementById("zbf-sidebar")?.remove();
        this.buildShell(mainDeck);
      }
      if (!this.asideEl) return;
      const enabled = this.prefs.get("workspace.enableVerticalSidebar") && !this.prefs.get("workspace.verticalSidebarCollapsed");
      this.asideEl.toggleAttribute("hidden", !enabled);
      this.asideEl.setAttribute("data-collapsed", enabled ? "false" : "true");
      if (!enabled) return;
      const savedW = this.prefs.get("workspace.verticalSidebarWidth");
      if (savedW >= 200 && savedW <= 440) this.asideEl.style.width = `${savedW}px`;
      const fontSize = this.prefs.get("workspace.verticalTabFontSize");
      if (fontSize >= 11 && fontSize <= 18) this.asideEl.style.fontSize = `${fontSize}px`;
      for (const [mode, btn] of this.viewButtons) {
        btn.classList.toggle("active", mode === this.viewMode);
      }
      this.renderList(snapshot);
    }
    destroy() {
      this.asideEl?.remove();
      this.asideEl = null;
      this.listEl = null;
      this.statusEl = null;
      this.selection = null;
      this.viewButtons.clear();
    }
    buildShell(mainDeck) {
      const aside = createWorkspaceElement(this.doc, "aside");
      aside.id = "zbf-sidebar";
      const header = createWorkspaceElement(this.doc, "div");
      header.className = "zbf-sb-header";
      const title = createWorkspaceElement(this.doc, "div");
      title.className = "zbf-sb-title";
      title.appendChild(createWorkspaceIcon(this.doc, "layers", 13));
      const titleText = createWorkspaceElement(this.doc, "span");
      titleText.textContent = "BridgeFlow";
      title.appendChild(titleText);
      const actions = createWorkspaceElement(this.doc, "div");
      actions.className = "zbf-sb-actions";
      header.append(title, actions);
      aside.appendChild(header);
      const searchWrap = createWorkspaceElement(this.doc, "div");
      searchWrap.className = "zbf-sb-search-wrap";
      const searchInput = createWorkspaceElement(this.doc, "input");
      searchInput.type = "search";
      searchInput.className = "zbf-sb-search";
      searchInput.placeholder = "筛选标题、作者、备注、分组...";
      searchInput.value = this.searchTerm;
      searchInput.addEventListener("input", () => {
        this.searchTerm = searchInput.value;
        this.renderList();
      });
      searchWrap.appendChild(searchInput);
      aside.appendChild(searchWrap);
      const views = createWorkspaceElement(this.doc, "div");
      views.className = "zbf-sb-views";
      for (const [mode, label] of [["groups", "分组"], ["collections", "集合"], ["status", "状态"]]) {
        const vBtn = createWorkspaceElement(this.doc, "button");
        vBtn.type = "button";
        vBtn.className = "zbf-sb-view-btn";
        vBtn.setAttribute("data-view-mode", mode);
        vBtn.textContent = label;
        vBtn.addEventListener("click", () => {
          this.viewMode = mode;
          this.render();
        });
        this.viewButtons.set(mode, vBtn);
        views.appendChild(vBtn);
      }
      aside.appendChild(views);
      const list = createWorkspaceElement(this.doc, "div");
      list.className = "zbf-sb-list";
      aside.appendChild(list);
      const status = createWorkspaceElement(this.doc, "div");
      status.className = "zbf-sb-status";
      aside.appendChild(status);
      const splitter = createWorkspaceElement(this.doc, "div");
      splitter.className = "zbf-sb-splitter";
      bindSidebarSplitter(this.doc, aside, splitter, this.prefs);
      aside.appendChild(splitter);
      this.selection = new SidebarSelection(
        this.doc,
        this.prefs,
        this.store,
        actions,
        aside,
        list,
        () => this.onRefresh(),
        (ids) => void this.tabs.closeTabs(this.win, ids, { preserveVirtual: true }),
        (itemIDs) => void this.tabs.copyItemsCitations(itemIDs),
        (itemIDs) => {
          this.tabs.citeItemsInWord(this.win, itemIDs);
        }
      );
      bindSidebarKeyboardNavigation(aside, list, searchInput, () => {
        this.searchTerm = "";
        searchInput.value = "";
        this.renderList();
      });
      this.addHeaderBtn(actions, "plus", "新建分组", () => {
        openTextPromptModal(this.win, "新建分组", "输入分组名称...", "新分组", (val) => {
          if (!val.trim()) return;
          this.store.createGroup(val);
          this.onRefresh();
        });
      });
      this.addHeaderBtn(actions, "sidebar", "折叠 / 展开侧边栏", () => {
        this.prefs.set("workspace.verticalSidebarCollapsed", true);
        this.onRefresh();
      });
      mainDeck.parentElement?.insertBefore(aside, mainDeck);
      this.asideEl = aside;
      this.listEl = list;
      this.statusEl = status;
    }
    renderList(snapshot) {
      if (!this.listEl || !this.selection) return;
      const needle = this.searchTerm.trim().toLowerCase();
      const allTracked = snapshot ?? this.tabs.buildTrackedTabs(this.win);
      const selectedID = String(this.win.Zotero_Tabs?.selectedID || "");
      const badgeKey = [...this.wordCiteMap.entries()].map(([id, b]) => `${id}:${b.ordinal}`).join(",");
      const groupKey = this.store.state.groups.map((g) => `${g.id}:${g.name}:${g.color}:${g.memberKeys.length}`).join(",");
      const tabKey = allTracked.map((t) => `${t.key}:${t.tabID}:${t.groupId}:${t.pinned ? 1 : 0}:${t.sleeping ? 1 : 0}:${t.virtual ? 1 : 0}:${t.remark}:${t.title}`).join("|");
      const renderKey = `${this.viewMode}|${needle}|${selectedID}|${this.store.state.collapsed.join(",")}|${this.prefs.get("workspace.verticalTabRowHeight")}|${this.prefs.get("workspace.verticalTabTitleMode")}|${this.prefs.get("workspace.verticalTabSubtitleMode")}|${this.prefs.get("workspace.enableBatchSelection")}|${groupKey}|${badgeKey}|${tabKey}`;
      if (renderKey === this.lastRenderKey && this.listEl.children.length > 0) return;
      this.lastRenderKey = renderKey;
      const prevScroll = this.listEl.scrollTop;
      this.listEl.textContent = "";
      const filtered = needle ? allTracked.filter((t) => `${t.title} ${t.shortTitle} ${t.creatorYear} ${t.collection} ${t.remark}`.toLowerCase().includes(needle)) : allTracked;
      this.selection.beginRender(filtered);
      const rowDeps = {
        win: this.win,
        doc: this.doc,
        prefs: this.prefs,
        store: this.store,
        tabs: this.tabs,
        menus: this.menus,
        hover: this.hover,
        selection: this.selection,
        wordCiteMap: this.wordCiteMap,
        selectedID,
        onRefresh: this.onRefresh
      };
      if (!filtered.length && !(this.viewMode === "groups" && !this.searchTerm && this.store.state.groups.length)) {
        this.renderEmptyState(allTracked.length > 0);
      } else if (this.viewMode === "groups") {
        const pinned = filtered.filter((t) => !t.virtual && t.pinned);
        if (pinned.length) this.appendSimpleSection("已固定标签", "#f59e0b", pinned, rowDeps);
        for (const grp of this.store.state.groups) {
          const members = filtered.filter((t) => (t.virtual || !t.pinned) && t.groupId === grp.id);
          const collapsed = this.store.state.collapsed.includes(grp.id);
          const head = createWorkspaceElement(this.doc, "button");
          head.type = "button";
          head.className = "zbf-sb-group-head";
          head.tabIndex = 0;
          head.setAttribute("data-zbf-nav", "head");
          const dot = createWorkspaceElement(this.doc, "span");
          dot.className = "zbf-sb-group-dot";
          dot.style.background = grp.color;
          const label = createWorkspaceElement(this.doc, "span");
          label.textContent = `${collapsed ? "▸" : "▾"} ${grp.name} (${members.length})`;
          head.append(dot, label);
          head.addEventListener("click", () => {
            this.store.setCollapsed(grp.id, !collapsed);
            this.renderList();
          });
          head.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            openTextPromptModal(this.win, "重命名分组", "输入新的分组名称...", grp.name, (val) => {
              if (this.store.renameGroup(grp.id, val)) this.onRefresh();
            });
          });
          head.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            this.menus.openGroupMenu(head, grp, e);
          });
          bindSidebarGroupDrop(head, grp.id, this.win, this.store, this.tabs, this.onRefresh);
          this.listEl.appendChild(head);
          if (!collapsed) {
            for (const tab of members) this.listEl.appendChild(buildSidebarTabRow(rowDeps, tab));
          }
        }
        const ungrouped = filtered.filter((t) => !t.pinned && !t.groupId);
        if (ungrouped.length) this.appendSimpleSection("未分组", "#64748b", ungrouped, rowDeps);
      } else if (this.viewMode === "collections") {
        renderSidebarCollectionsList(this.listEl, rowDeps, filtered);
      } else {
        this.renderStatusView(filtered, rowDeps);
      }
      this.renderFooter(allTracked);
      this.selection.updateControls();
      if (prevScroll > 0) this.listEl.scrollTop = prevScroll;
    }
    renderStatusView(filtered, rowDeps) {
      const cited = filtered.filter((t) => this.wordCiteMap.has(t.parentItemID) || this.wordCiteMap.has(t.itemID));
      const pinned = filtered.filter((t) => !t.virtual && t.pinned);
      const active = filtered.filter((t) => !t.virtual && !t.sleeping && !t.pinned);
      const sleeping = filtered.filter((t) => !t.virtual && t.sleeping);
      const virtual = filtered.filter((t) => t.virtual);
      if (cited.length) this.appendSimpleSection("Word 正在引用", "#0D9488", cited, rowDeps);
      if (pinned.length) this.appendSimpleSection("已固定", "#f59e0b", pinned, rowDeps);
      if (active.length) this.appendSimpleSection("当前活动", "#245ac7", active, rowDeps);
      if (sleeping.length) this.appendSimpleSection("已休眠", "#8b5cf6", sleeping, rowDeps);
      if (virtual.length) this.appendSimpleSection("虚拟保留", "#64748b", virtual, rowDeps);
    }
    appendSimpleSection(title, color, tabsList, rowDeps) {
      if (!this.listEl) return;
      appendSidebarSectionHead(this.doc, this.listEl, `${title} (${tabsList.length})`, color);
      for (const tab of tabsList) this.listEl.appendChild(buildSidebarTabRow(rowDeps, tab));
    }
    renderEmptyState(hasAnyTabs) {
      if (!this.listEl) return;
      this.listEl.appendChild(renderSidebarEmptyBox(
        this.doc,
        this.win,
        hasAnyTabs,
        () => {
          this.searchTerm = "";
          const inp = this.asideEl?.querySelector(".zbf-sb-search");
          if (inp) inp.value = "";
          this.renderList();
        },
        () => {
          const latest = this.store.state.sessions[0] || this.store.state.rollingSessions[0];
          if (latest && this.prefs.get("workspace.enableSessions")) {
            void this.tabs.restoreSession(this.win, latest, true).then(() => this.onRefresh());
          } else {
            this.popover.openHub();
          }
        }
      ));
    }
    renderFooter(allTracked) {
      if (this.statusEl) {
        renderSidebarStatusBar(this.doc, this.win, this.statusEl, this.prefs, this.tabs, allTracked, this.onRefresh);
      }
    }
    addHeaderBtn(container, icon, title, onClick) {
      const btn = createWorkspaceElement(this.doc, "button");
      btn.type = "button";
      btn.className = "zbf-sb-icon-btn";
      btn.title = title;
      btn.setAttribute("tooltiptext", title);
      btn.setAttribute("aria-label", title);
      btn.setAttribute("data-action", icon);
      btn.appendChild(createWorkspaceIcon(this.doc, icon, 13));
      btn.addEventListener("click", () => onClick(btn));
      container.appendChild(btn);
    }
  };

  // src/domains/workspace/workspace-hub-helpers.ts
  async function exportWorkspaceJson(win, store) {
    const json = store.exportJson();
    const ZoteroObj = globalThis.Zotero;
    try {
      const { FilePicker } = globalThis.ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
      const fp = new FilePicker();
      if (fp?.init) {
        fp.init(win, "导出工作区备份 (JSON)", fp.modeSave ?? 1);
        fp.appendFilter("JSON 文件", "*.json");
        fp.defaultString = `BridgeFlow-Workspace-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
        const rv = await fp.show();
        if ((rv === fp.returnOK || rv === fp.returnReplace) && fp.file) {
          await ZoteroObj.File.putContentsAsync(fp.file, json);
          return "已导出工作区 JSON 文件";
        }
        return "";
      }
    } catch {
    }
    try {
      await win.navigator.clipboard.writeText(json);
      return "已复制工作区 JSON 到剪贴板";
    } catch {
      openTextPromptModal(win, "工作区 JSON 备份（请全选复制）", "", json, () => {
      });
      return "";
    }
  }
  async function importWorkspaceJsonInteractive(win, store, onImported, onInvalid) {
    const ZoteroObj = globalThis.Zotero;
    try {
      const { FilePicker } = globalThis.ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
      const fp = new FilePicker();
      if (fp?.init) {
        fp.init(win, "导入工作区备份 (JSON)", fp.modeOpen ?? 0);
        fp.appendFilter("JSON 文件", "*.json");
        const rv = await fp.show();
        if (rv === fp.returnOK && fp.file) {
          const content = await ZoteroObj.File.getContentsAsync(fp.file);
          if (content && store.importJson(String(content))) onImported();
          else if (content) onInvalid?.();
          return;
        }
        return;
      }
    } catch {
    }
    openTextPromptModal(win, "导入工作区 JSON", "请在此粘贴工作区 JSON 内容...", "", (raw) => {
      if (raw && store.importJson(raw)) onImported();
      else if (raw?.trim()) onInvalid?.();
    });
  }
  function renderPublicationSuggestionsSection(doc, store, suggestions, onApplied) {
    if (!suggestions.length) return null;
    const wrap = createWorkspaceElement(doc, "div");
    wrap.className = "zbf-hub-section";
    const heading = createWorkspaceElement(doc, "div");
    heading.className = "zbf-hub-section-title";
    heading.textContent = `期刊 / 会议智能分组建议 (${suggestions.length})`;
    wrap.appendChild(heading);
    for (const sug of suggestions.slice(0, 5)) {
      const card = createWorkspaceElement(doc, "div");
      card.className = "zbf-hub-card";
      const topRow = createWorkspaceElement(doc, "div");
      topRow.className = "zbf-hub-card-top";
      const info = createWorkspaceElement(doc, "div");
      info.className = "zbf-hub-card-info";
      const nameEl = createWorkspaceElement(doc, "div");
      nameEl.className = "zbf-hub-card-name";
      nameEl.textContent = `📚 ${sug.venue}`;
      const metaEl = createWorkspaceElement(doc, "div");
      metaEl.className = "zbf-hub-card-meta";
      metaEl.textContent = `${sug.keys.length} 篇同源未分组文献`;
      info.append(nameEl, metaEl);
      const applyBtn = createWorkspaceElement(doc, "button");
      applyBtn.type = "button";
      applyBtn.className = "zbf-hub-btn primary";
      applyBtn.textContent = "一键归组";
      applyBtn.addEventListener("click", () => {
        const group2 = store.state.groups.find((g) => g.name === sug.venue) ?? store.createGroup(sug.venue);
        for (const k of sug.keys) store.assignToGroup(k, group2.id);
        onApplied();
      });
      topRow.append(info, applyBtn);
      card.appendChild(topRow);
      wrap.appendChild(card);
    }
    return wrap;
  }
  function renderSessionSection(doc, titleText, sessions, emptyText, handlers) {
    const wrap = createWorkspaceElement(doc, "div");
    wrap.className = "zbf-hub-section";
    const heading = createWorkspaceElement(doc, "div");
    heading.className = "zbf-hub-section-title";
    heading.textContent = `${titleText} (${sessions.length})`;
    wrap.appendChild(heading);
    if (!sessions.length) {
      const empty = createWorkspaceElement(doc, "div");
      empty.className = "zbf-hub-empty";
      empty.textContent = emptyText;
      wrap.appendChild(empty);
      return wrap;
    }
    const { win, store, isRolling, onRestore, onChanged } = handlers;
    for (const session2 of sessions) {
      const card = createWorkspaceElement(doc, "div");
      card.className = "zbf-hub-card";
      const topRow = createWorkspaceElement(doc, "div");
      topRow.className = "zbf-hub-card-top";
      const info = createWorkspaceElement(doc, "div");
      info.className = "zbf-hub-card-info";
      const icon = session2.isTemplate ? "📐 " : session2.kind === "pre-replace" ? "↩ " : isRolling ? "🕒 " : "💾 ";
      const nameEl = createWorkspaceElement(doc, "div");
      nameEl.className = "zbf-hub-card-name";
      nameEl.textContent = `${icon}${session2.name}`;
      const itemKeys = [.../* @__PURE__ */ new Set([
        ...session2.openKeys,
        ...session2.groups.flatMap((g) => g.memberKeys),
        ...Object.keys(session2.virtualMembers)
      ])].filter((k) => k.startsWith("item:"));
      const metaEl = createWorkspaceElement(doc, "div");
      metaEl.className = "zbf-hub-card-meta";
      const dt = new Date(session2.createdAt || Date.now()).toLocaleString();
      metaEl.textContent = `${itemKeys.length} 篇文献 · ${session2.groups.length} 个分组 · ${dt}`;
      info.append(nameEl, metaEl);
      const btns = createWorkspaceElement(doc, "div");
      btns.className = "zbf-hub-card-actions";
      const mergeBtn = createWorkspaceElement(doc, "button");
      mergeBtn.type = "button";
      mergeBtn.className = "zbf-hub-btn primary";
      mergeBtn.textContent = "重新打开";
      mergeBtn.title = "保留当前已打开文献与分组，重新打开该快照保存的分组与全部文献条目";
      mergeBtn.addEventListener("click", () => onRestore(session2, true));
      const replaceBtn = createWorkspaceElement(doc, "button");
      replaceBtn.type = "button";
      replaceBtn.className = "zbf-hub-btn";
      replaceBtn.textContent = "替换布局";
      replaceBtn.title = "自动先保存恢复前备份，再替换为该快照布局";
      replaceBtn.addEventListener("click", () => onRestore(session2, false));
      btns.append(mergeBtn, replaceBtn);
      if (isRolling) {
        const promoteBtn = createWorkspaceElement(doc, "button");
        promoteBtn.type = "button";
        promoteBtn.className = "zbf-hub-btn";
        promoteBtn.textContent = "转存";
        promoteBtn.addEventListener("click", () => {
          if (store.promoteRollingSession(session2.id)) onChanged();
        });
        btns.appendChild(promoteBtn);
      } else if (session2.kind !== "pre-replace") {
        const updateBtn = createWorkspaceElement(doc, "button");
        updateBtn.type = "button";
        updateBtn.className = "zbf-hub-btn";
        updateBtn.textContent = "更新";
        updateBtn.addEventListener("click", () => {
          if (store.updateSession(session2.id, handlers.tabs.openKeys(win))) onChanged();
        });
        const renameBtn = createWorkspaceElement(doc, "button");
        renameBtn.type = "button";
        renameBtn.className = "zbf-hub-btn";
        renameBtn.textContent = "重命名";
        renameBtn.addEventListener("click", () => {
          openTextPromptModal(win, "重命名快照", "输入新名称...", session2.name, (val) => {
            if (store.renameSession(session2.id, val)) onChanged();
          });
        });
        btns.append(updateBtn, renameBtn);
      }
      const delBtn = createWorkspaceElement(doc, "button");
      delBtn.type = "button";
      delBtn.className = "zbf-hub-btn";
      delBtn.textContent = "删除";
      delBtn.addEventListener("click", () => {
        if (store.deleteSession(session2.id)) onChanged();
      });
      btns.appendChild(delBtn);
      topRow.append(info, btns);
      card.appendChild(topRow);
      if (itemKeys.length && !session2.isTemplate) {
        const itemsBox = createWorkspaceElement(doc, "div");
        itemsBox.className = "zbf-hub-items";
        for (const key of itemKeys.slice(0, 12)) {
          const meta = session2.virtualMembers[key] || store.state.virtualMembers[key];
          const rawID = Number(meta?.itemID || key.replace(/^item:/, "") || 0);
          const zotItem = rawID > 0 ? globalThis.Zotero?.Items?.get?.(rawID) : null;
          const rawTitleStr = meta?.title || zotItem?.getField?.("title") || `文献条目 #${rawID}`;
          const titleStr = String(rawTitleStr).replace(/<[^>]*>/g, "");
          const subStr = [meta?.creatorYear, meta?.source].filter(Boolean).join(" · ");
          const row = createWorkspaceElement(doc, "button");
          row.type = "button";
          row.className = "zbf-hub-item-row";
          row.title = "点击单独打开此篇文献";
          const label = createWorkspaceElement(doc, "span");
          label.className = "zbf-hub-item-title";
          label.textContent = `📄 ${titleStr}${subStr ? ` (${subStr})` : ""}`;
          row.appendChild(label);
          row.addEventListener("click", () => {
            if (rawID > 0) {
              const grpId = session2.groups.find((g) => g.memberKeys.includes(key))?.id;
              void handlers.tabs.openVirtualOrItem(win, rawID, grpId, false);
            }
          });
          itemsBox.appendChild(row);
        }
        card.appendChild(itemsBox);
      }
      wrap.appendChild(card);
    }
    return wrap;
  }

  // src/domains/workspace/workspace-popover.ts
  var WorkspacePopover = class {
    win;
    doc;
    prefs;
    store;
    tabs;
    onRefresh;
    activeBackdrop = null;
    activePopup = null;
    boundOutside = null;
    constructor(win, prefs, store, tabs, onRefresh) {
      this.win = win;
      this.doc = win.document;
      this.prefs = prefs;
      this.store = store;
      this.tabs = tabs;
      this.onRefresh = onRefresh;
    }
    openHub(anchor) {
      this.close();
      const host2 = this.doc.documentElement || this.doc.body;
      if (!host2) return;
      const backdrop = createWorkspaceElement(this.doc, "div");
      backdrop.id = "zbf-hub-backdrop";
      backdrop.addEventListener("mousedown", (e) => {
        if (e.target === backdrop) this.close();
      });
      const modal = createWorkspaceElement(this.doc, "div");
      modal.className = "zbf-hub-box";
      modal.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          this.close();
        }
      });
      const header = createWorkspaceElement(this.doc, "div");
      header.className = "zbf-hub-head";
      const title = createWorkspaceElement(this.doc, "div");
      title.className = "zbf-hub-title";
      title.textContent = "工作区与会话快照中心";
      const closeBtn = createWorkspaceElement(this.doc, "button");
      closeBtn.type = "button";
      closeBtn.className = "zbf-hub-close";
      closeBtn.textContent = "✕";
      closeBtn.addEventListener("click", () => this.close());
      header.append(title, closeBtn);
      const nameInput = createWorkspaceElement(this.doc, "input");
      nameInput.type = "text";
      nameInput.className = "zbf-hub-input";
      nameInput.placeholder = "输入工作区快照或模板名称（如：论文修改轮次）...";
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          saveBtn.click();
        }
      });
      const statusEl = createWorkspaceElement(this.doc, "div");
      statusEl.className = "zbf-hub-status";
      const actions = createWorkspaceElement(this.doc, "div");
      actions.className = "zbf-hub-actions";
      const saveBtn = createWorkspaceElement(this.doc, "button");
      saveBtn.type = "button";
      saveBtn.className = "zbf-hub-btn primary";
      saveBtn.textContent = "保存当前快照";
      saveBtn.addEventListener("click", () => {
        const name = nameInput.value.trim() || `快照 ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`;
        this.store.saveSession(name, { isTemplate: false, openKeys: this.tabs.openKeys(this.win) });
        nameInput.value = "";
        statusEl.textContent = `已保存工作区快照「${name}」`;
        renderLists();
        this.onRefresh();
      });
      const tplBtn = createWorkspaceElement(this.doc, "button");
      tplBtn.type = "button";
      tplBtn.className = "zbf-hub-btn";
      tplBtn.textContent = "存为分组模板";
      tplBtn.addEventListener("click", () => {
        const name = nameInput.value.trim() || `模板 ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`;
        this.store.saveSession(name, { isTemplate: true });
        nameInput.value = "";
        statusEl.textContent = `已保存结构模板「${name}」`;
        renderLists();
        this.onRefresh();
      });
      const exportBtn = createWorkspaceElement(this.doc, "button");
      exportBtn.type = "button";
      exportBtn.className = "zbf-hub-btn";
      exportBtn.textContent = "导出 JSON";
      exportBtn.addEventListener("click", async () => {
        const msg = await exportWorkspaceJson(this.win, this.store);
        if (msg) statusEl.textContent = msg;
      });
      const importBtn = createWorkspaceElement(this.doc, "button");
      importBtn.type = "button";
      importBtn.className = "zbf-hub-btn";
      importBtn.textContent = "导入 JSON";
      importBtn.addEventListener("click", async () => {
        await importWorkspaceJsonInteractive(
          this.win,
          this.store,
          () => {
            statusEl.textContent = "已导入工作区状态";
            renderLists();
            this.onRefresh();
          },
          () => {
            statusEl.textContent = "导入失败：JSON 格式无效或版本不兼容";
          }
        );
      });
      actions.append(saveBtn, tplBtn, exportBtn, importBtn);
      const listsWrap = createWorkspaceElement(this.doc, "div");
      listsWrap.className = "zbf-hub-lists";
      const renderLists = () => {
        listsWrap.textContent = "";
        const suggestions = renderPublicationSuggestionsSection(
          this.doc,
          this.store,
          this.tabs.getPublicationSuggestions(this.win),
          () => {
            statusEl.textContent = "已按期刊 / 会议自动建立文献分组";
            renderLists();
            this.onRefresh();
          }
        );
        if (suggestions) listsWrap.appendChild(suggestions);
        const handlers = {
          win: this.win,
          store: this.store,
          tabs: this.tabs,
          onRestore: (ses, merge) => {
            this.close();
            void this.tabs.restoreSession(this.win, ses, merge).then(() => this.onRefresh());
          },
          onChanged: () => {
            renderLists();
            this.onRefresh();
          }
        };
        listsWrap.appendChild(renderSessionSection(
          this.doc,
          "已保存快照与模板",
          this.store.state.sessions,
          "暂无已保存的快照或模板，可在上方输入名称保存。",
          { ...handlers, isRolling: false }
        ));
        listsWrap.appendChild(renderSessionSection(
          this.doc,
          "自动滚动快照",
          this.store.state.rollingSessions,
          "暂无自动滚动快照。",
          { ...handlers, isRolling: true }
        ));
      };
      renderLists();
      modal.append(header, nameInput, actions, statusEl, listsWrap);
      backdrop.appendChild(modal);
      host2.appendChild(backdrop);
      this.positionHubNearAnchor(modal, anchor);
      this.activeBackdrop = backdrop;
      this.win.setTimeout(() => nameInput.focus(), 10);
    }
    positionHubNearAnchor(modal, explicitAnchor) {
      const target = explicitAnchor || this.doc.querySelector('#zbf-toolbar-actions [data-action="workspace"]') || this.doc.getElementById("zbf-toolbar-actions");
      const winW = this.win.innerWidth || 1200;
      const winH = this.win.innerHeight || 800;
      const boxW = Math.min(520, winW - 24);
      modal.style.width = `${boxW}px`;
      modal.style.position = "fixed";
      modal.style.maxHeight = `${Math.max(260, winH - 72)}px`;
      if (target && typeof target.getBoundingClientRect === "function") {
        const rect = target.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          const top = Math.max(8, Math.min(Math.round(rect.bottom + 6), winH - 220));
          const left = rect.left > winW * 0.45 ? Math.max(12, Math.min(Math.round(rect.right - boxW), winW - boxW - 12)) : Math.max(12, Math.min(Math.round(rect.left), winW - boxW - 12));
          modal.style.top = `${top}px`;
          modal.style.left = `${left}px`;
          return;
        }
      }
      modal.style.top = "44px";
      modal.style.left = `${Math.max(12, Math.round(winW - boxW - 16))}px`;
    }
    openStaleMenu(anchor, event) {
      this.close();
      const pop = createFloatingPopup(this.doc, anchor, event, 280);
      if (!pop) return;
      const days = this.prefs.get("workspace.staleSuggestDays");
      const stale = this.tabs.findStaleTabs(this.win);
      const title = createWorkspaceElement(this.doc, "div");
      title.className = "zbf-popup-header";
      title.textContent = `建议清理的标签页（超过 ${days} 天未查看：${stale.length} 篇）`;
      pop.appendChild(title);
      if (!stale.length) {
        const empty = createWorkspaceElement(this.doc, "div");
        empty.className = "zbf-popup-empty";
        empty.textContent = "当前没有长期未查看的陈旧标签页。";
        pop.appendChild(empty);
      } else {
        for (const tab of stale.slice(0, 12)) {
          const row = createWorkspaceElement(this.doc, "div");
          row.className = "zbf-stale-row";
          const label = createWorkspaceElement(this.doc, "span");
          label.className = "zbf-stale-title";
          label.textContent = this.tabs.getDisplayTitle(tab);
          label.addEventListener("click", () => {
            this.close();
            this.tabs.selectTab(this.win, tab.tabID);
            this.onRefresh();
          });
          const sleepBtn = createWorkspaceElement(this.doc, "button");
          sleepBtn.type = "button";
          sleepBtn.className = "zbf-mini-btn";
          sleepBtn.textContent = "休眠";
          sleepBtn.addEventListener("click", () => {
            this.tabs.sleepTab(this.win, tab.tabID);
            this.close();
            this.onRefresh();
          });
          const closeBtn = createWorkspaceElement(this.doc, "button");
          closeBtn.type = "button";
          closeBtn.className = "zbf-mini-btn danger";
          closeBtn.textContent = "关闭";
          closeBtn.addEventListener("click", () => {
            void this.tabs.closeTabs(this.win, [tab.tabID], { preserveVirtual: true });
            this.close();
            this.onRefresh();
          });
          row.append(label, sleepBtn, closeBtn);
          pop.appendChild(row);
        }
        addPopupSeparator(this.doc, pop);
        const footer = createWorkspaceElement(this.doc, "div");
        footer.className = "zbf-stale-footer";
        const sleepAll = createWorkspaceElement(this.doc, "button");
        sleepAll.type = "button";
        sleepAll.className = "zbf-mini-btn";
        sleepAll.textContent = "全部休眠";
        sleepAll.addEventListener("click", () => {
          for (const t of stale) this.tabs.sleepTab(this.win, t.tabID);
          this.close();
          this.onRefresh();
        });
        const closeAll = createWorkspaceElement(this.doc, "button");
        closeAll.type = "button";
        closeAll.className = "zbf-mini-btn danger";
        closeAll.textContent = "全部关闭";
        closeAll.addEventListener("click", () => {
          void this.tabs.closeTabs(this.win, stale.map((t) => t.tabID), { preserveVirtual: true, protectPinned: true });
          this.close();
          this.onRefresh();
        });
        footer.append(sleepAll, closeAll);
        pop.appendChild(footer);
      }
      this.activePopup = pop;
      this.boundOutside = (e) => {
        if (!pop.contains(e.target)) this.close();
      };
      this.win.setTimeout(() => {
        if (this.boundOutside) this.doc.addEventListener("mousedown", this.boundOutside, true);
      }, 15);
    }
    close() {
      this.activeBackdrop?.remove();
      this.activeBackdrop = null;
      this.activePopup?.remove();
      this.activePopup = null;
      if (this.boundOutside) {
        this.doc.removeEventListener("mousedown", this.boundOutside, true);
        this.boundOutside = null;
      }
    }
    destroy() {
      this.close();
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

#zbf-inline, #zbf-inline *, .zbf-pinned-strip, .zbf-pinned-strip *, #zbf-toolbar-actions, #zbf-toolbar-actions *, #zbf-hub-backdrop, #zbf-hub-backdrop *, #zbf-spotlight-panel, #zbf-spotlight-panel * {
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
.zbf-htab:focus-visible, .zbf-vtab-row:focus-visible { outline: 2px solid var(--zbf-accent); outline-offset: -2px; }
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

#zbf-spotlight-panel {
  z-index: 2147483647;
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
.zbf-spot-clear { appearance: none; border: 0; border-radius: 4px; width: 20px; height: 20px; background: transparent; color: var(--zbf-muted); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex: none; }
.zbf-spot-clear:hover { background: var(--zbf-hover); color: var(--zbf-text); }
.zbf-spot-clear[hidden] { display: none !important; }
.zbf-spot-footer { padding: 5px 4px 0; border-top: 1px solid var(--zbf-border); font-size: 11px; color: var(--zbf-muted); text-align: right; }
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
.zbf-hc-heatbar { display: grid; grid-template-columns: repeat(16, 1fr); gap: 2px; margin-top: 5px; height: 5px; }
.zbf-hc-heatcell { display: block; border-radius: 2px; background: var(--zbf-muted); }
.zbf-hc-heatcell[data-active="true"] { background: var(--zbf-heat-accent, var(--zbf-accent)); }
`;

  // src/domains/workspace/workspace-ui.ts
  var WorkspaceWindowUI = class {
    win;
    doc;
    prefs;
    tabs;
    styleEl = null;
    hoverCard = null;
    tabMenu = null;
    popover = null;
    toolbar = null;
    horizontal = null;
    sidebar = null;
    spotlightPanel = null;
    tabObserver = null;
    renderTimer = 0;
    destroyed = false;
    lifetime;
    onActivity;
    lastActivitySentAt = 0;
    onInputActivity = () => {
      const now = Date.now();
      if (now - this.lastActivitySentAt < 1500) return;
      this.lastActivitySentAt = now;
      this.onActivity?.();
    };
    onKeydown = (ev) => {
      const e = ev;
      if (e.defaultPrevented) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "p" && this.prefs.get("workspace.enableSpotlight")) {
        e.preventDefault();
        this.spotlightPanel?.toggle();
      } else if (mod && !e.altKey && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        this.tabs.undoCloseTab(this.win);
        this.scheduleRender(30);
      }
    };
    onResize = () => {
      this.scheduleRender(140);
    };
    constructor(win, prefs, store, tabs, spotlightEngine, onActivity) {
      this.win = win;
      this.doc = win.document;
      this.prefs = prefs;
      this.tabs = tabs;
      this.onActivity = onActivity;
      this.lifetime = this.doc ? new win.AbortController() : null;
      if (!this.doc || !this.lifetime) return;
      this.mountStyle();
      const refresh = () => this.render();
      this.hoverCard = new WorkspaceHoverCard(this.doc, prefs, store);
      this.popover = new WorkspacePopover(win, prefs, store, tabs, refresh);
      this.spotlightPanel = new WorkspaceSpotlightPanel(win, spotlightEngine);
      this.tabMenu = new WorkspaceTabContextMenu(win, prefs, store, tabs, refresh, this.hoverCard);
      this.toolbar = new WorkspaceToolbarActions(win, prefs, store, tabs, this.popover, (btn) => this.spotlightPanel?.toggle(btn), refresh);
      this.horizontal = new WorkspaceHorizontalBar(win, prefs, store, tabs, this.tabMenu, this.hoverCard, this.toolbar, refresh);
      this.sidebar = new WorkspaceVerticalSidebar(win, prefs, store, tabs, this.tabMenu, this.hoverCard, this.popover, (btn) => this.spotlightPanel?.toggle(btn), refresh);
      this.attachObservers();
      this.doc.addEventListener("keydown", this.onKeydown, { capture: true, signal: this.lifetime.signal });
      this.doc.addEventListener("pointerdown", this.onInputActivity, { capture: true, passive: true, signal: this.lifetime.signal });
      this.doc.addEventListener("keydown", this.onInputActivity, { capture: true, passive: true, signal: this.lifetime.signal });
      this.doc.addEventListener("wheel", this.onInputActivity, { capture: true, passive: true, signal: this.lifetime.signal });
      this.win.addEventListener("resize", this.onResize, { signal: this.lifetime.signal });
      this.render();
    }
    setCitationBadges(badges) {
      this.hoverCard?.setWordCitationBadges(badges);
      this.sidebar?.setWordCitationBadges(badges);
      this.scheduleRender(16);
    }
    openSpotlightWithQuery(initialQuery = "") {
      this.spotlightPanel?.open(initialQuery);
    }
    render() {
      if (this.destroyed || !this.doc) return;
      try {
        const snapshot = this.tabs.buildTrackedTabs(this.win);
        this.sidebar?.render(snapshot);
        this.horizontal?.render(snapshot);
      } catch (error) {
        globalThis.Zotero?.logError?.(error);
      }
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      if (this.renderTimer && typeof this.win.clearTimeout === "function") {
        this.win.clearTimeout(this.renderTimer);
      }
      this.tabObserver?.disconnect();
      this.tabObserver = null;
      this.lifetime?.abort();
      this.horizontal?.destroy();
      this.sidebar?.destroy();
      this.tabMenu?.destroy();
      this.popover?.destroy();
      this.hoverCard?.destroy();
      this.spotlightPanel?.destroy();
      this.styleEl?.remove();
      this.styleEl = null;
    }
    mountStyle() {
      if (!this.doc) return;
      this.doc.getElementById("zbf-workspace-style")?.remove();
      const style = createWorkspaceElement(this.doc, "style");
      style.id = "zbf-workspace-style";
      style.textContent = WORKSPACE_CSS;
      const target = this.doc.head || this.doc.documentElement;
      target?.appendChild(style);
      this.styleEl = style;
    }
    attachObservers() {
      if (!this.doc) return;
      const tabBar = this.doc.getElementById("tab-bar-container");
      const ObserverCtor = this.win.MutationObserver || globalThis.MutationObserver;
      if (!tabBar || typeof ObserverCtor !== "function") return;
      const obs = new ObserverCtor((mutations) => {
        if (this.destroyed) return;
        const external = mutations.some((m) => !this.isOwnNode(m.target));
        if (external) this.scheduleRender(40);
      });
      obs.observe(tabBar, { childList: true, subtree: true, attributes: true, attributeFilter: ["selected", "class"] });
      this.tabObserver = obs;
    }
    isOwnNode(node) {
      if (!node) return false;
      const el = typeof node.closest === "function" ? node : node.parentElement;
      if (!el || typeof el.closest !== "function") return false;
      return Boolean(el.closest("#zbf-inline, #zbf-toolbar-actions, #zbf-sidebar"));
    }
    scheduleRender(delayMs) {
      if (this.destroyed) return;
      if (this.renderTimer && typeof this.win.clearTimeout === "function") {
        this.win.clearTimeout(this.renderTimer);
      }
      this.renderTimer = this.win.setTimeout(() => {
        this.renderTimer = 0;
        this.render();
      }, delayMs);
    }
  };

  // src/domains/workspace/module.ts
  var WATCHED_WORKSPACE_PREFS = [
    "workspace.enableHorizontalGroups",
    "workspace.horizontalTabCompactMode",
    "workspace.compactTopBar",
    "workspace.enableVerticalSidebar",
    "workspace.verticalSidebarCollapsed",
    "workspace.verticalSidebarWidth",
    "workspace.enableBatchSelection",
    "workspace.enablePinnedTabs",
    "workspace.pinnedIconOnly",
    "workspace.enableVirtualMembers",
    "workspace.enableTabRemarks",
    "workspace.remarkDisplayMode",
    "workspace.verticalTabTitleMode",
    "workspace.verticalTabSubtitleMode",
    "workspace.verticalTabRowHeight",
    "workspace.verticalTabFontSize",
    "workspace.enableHoverPreview",
    "workspace.enableSpotlight",
    "workspace.enableSessions",
    "workspace.enableTabSleep",
    "workspace.activeReaderBudget",
    "workspace.enableStaleSuggestions",
    "workspace.staleSuggestDays"
  ];
  var WorkspaceDomainModule = class {
    id = "workspace";
    enabledPref = "modules.workspace.enable";
    store;
    tabs;
    spotlight;
    kernel;
    neighbors;
    disposables = new DisposableStack();
    windows = /* @__PURE__ */ new Map();
    active = false;
    latestBadges = /* @__PURE__ */ new Map();
    maintenanceTimer = null;
    readingTimer = null;
    autoGroupTimer = null;
    pendingAutoGroup = /* @__PURE__ */ new Set();
    lastRollingAt = 0;
    lastReadingTickAt = Date.now();
    lastActivityAt = Date.now();
    readingDirty = false;
    lastReaderByWin = /* @__PURE__ */ new WeakMap();
    refreshTimer = null;
    lastGroupFingerprint = "";
    constructor(kernel, services) {
      this.kernel = kernel;
      this.store = new WorkspaceStateStore(kernel.prefs);
      this.tabs = new WorkspaceTabController(kernel.prefs, this.store, services.clipboard, kernel.bus);
      this.spotlight = new WorkspaceSpotlightEngine(kernel.prefs, this.store, this.tabs);
      this.neighbors = new ReaderNeighborPublisher(kernel.bus);
    }
    async start() {
      if (this.active) return;
      this.active = true;
      this.disposables.reset();
      this.store.load();
      void this.store.initDiskCache().then((merged) => {
        if (merged && this.active) {
          this.kernel.bus.emit("visual-notes:reading-updated", {});
          this.refreshAllWindows();
        }
      });
      this.disposables.add(this.store.onChange(() => {
        this.queueRefresh();
      }));
      this.disposables.add(
        this.kernel.prefs.observeKeys([...WATCHED_WORKSPACE_PREFS], () => this.refreshAllWindows())
      );
      this.disposables.add(
        this.kernel.bus.on("inspector:lookup-clipboard", ({ win }) => {
          const targetWin = win || this.getTargetWindow();
          if (targetWin && this.active) {
            this.windows.get(targetWin)?.openSpotlightWithQuery("");
          }
        })
      );
      this.disposables.add(
        this.kernel.bus.on("workspace:groups-query", () => {
          if (this.active) this.emitGroupSummaries(true);
        })
      );
      this.disposables.add(
        this.kernel.bus.on("workspace:reader-neighbors-query", ({ win }) => {
          const targetWin = win || this.getTargetWindow();
          if (this.active && targetWin) this.neighbors.publish(targetWin, this.tabs.buildTrackedTabs(targetWin), true);
        })
      );
      this.disposables.add(
        this.kernel.notifier.subscribe(["tab", "collection", "item"], ({ event, type, ids }) => {
          if (type === "tab") {
            this.handleTabEvent(event, ids.map(String));
          } else if (event === "modify" || event === "add" || event === "delete" || event === "trash" || event === "restore") {
            invalidateTabProjectionCache();
            this.queueRefresh(32);
          }
        })
      );
      for (const win of this.getMainWindows()) {
        this.onMainWindowLoad(win);
      }
      this.emitGroupSummaries(true);
      this.lastReadingTickAt = Date.now();
      this.lastActivityAt = Date.now();
      this.maintenanceTimer = setInterval(() => this.runPeriodicMaintenance(), 6e4);
      this.readingTimer = setInterval(() => this.flushReadingProgress(1), 15e3);
    }
    stop() {
      if (!this.active) return;
      this.active = false;
      if (this.refreshTimer !== null) {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = null;
      }
      if (this.maintenanceTimer !== null) {
        clearInterval(this.maintenanceTimer);
        this.maintenanceTimer = null;
      }
      if (this.readingTimer !== null) {
        clearInterval(this.readingTimer);
        this.readingTimer = null;
      }
      if (this.autoGroupTimer !== null) {
        clearTimeout(this.autoGroupTimer);
        this.autoGroupTimer = null;
      }
      for (const ui of this.windows.values()) ui.destroy();
      this.windows.clear();
      this.pendingAutoGroup.clear();
      if (this.readingDirty) {
        this.readingDirty = false;
        void this.store.readingCache.flushNow(this.store.state);
      } else {
        void this.store.readingCache.flushNow(this.store.state);
      }
      void this.store.notesCache.flushNow(this.store.state);
      this.store.notesCache.dispose();
      this.store.readingCache.dispose();
      this.store.diskCache.dispose();
      this.neighbors.reset();
      this.disposables.disposeAll();
    }
    isActive() {
      return this.active;
    }
    onMainWindowLoad(win) {
      if (!this.active || this.windows.has(win)) return;
      const ui = new WorkspaceWindowUI(win, this.kernel.prefs, this.store, this.tabs, this.spotlight, () => {
        this.lastActivityAt = Date.now();
      });
      ui.setCitationBadges(this.latestBadges);
      this.windows.set(win, ui);
      const snap = this.tabs.resolveActiveReaderSnapshot(win);
      if (snap) this.lastReaderByWin.set(win, snap);
    }
    onMainWindowUnload(win) {
      const ui = this.windows.get(win);
      if (!ui) return;
      ui.destroy();
      this.windows.delete(win);
      this.lastReaderByWin.delete(win);
    }
    flushReadingProgress(minElapsed = 1, usePreviousReader = false) {
      const now = Date.now();
      const elapsed = Math.min(30, Math.floor((now - this.lastReadingTickAt) / 1e3));
      if (elapsed < minElapsed) return;
      this.lastReadingTickAt = now;
      let updated = false;
      for (const win of this.windows.keys()) {
        if (win.closed) continue;
        const prev = usePreviousReader ? this.lastReaderByWin.get(win) : void 0;
        const didUpdate = prev ? this.tabs.trackReadingProgress(win, Math.max(1, elapsed), {
          overrideKey: prev.key,
          overrideLastPage: prev.page,
          overrideTotalPages: prev.total,
          idleCutoffMs: 18e4,
          lastActivityAt: this.lastActivityAt,
          now
        }) : this.tabs.trackReadingProgress(win, Math.max(1, elapsed), {
          idleCutoffMs: 18e4,
          lastActivityAt: this.lastActivityAt,
          now,
          onPageChanged: () => {
            this.lastActivityAt = now;
          }
        });
        if (didUpdate) {
          this.readingDirty = true;
          updated = true;
        }
        const snap = this.tabs.resolveActiveReaderSnapshot(win);
        if (snap) this.lastReaderByWin.set(win, snap);
        else this.lastReaderByWin.delete(win);
      }
      if (updated) {
        this.store.readingCache.scheduleSave(this.store.state);
        this.kernel.bus.emit("visual-notes:reading-updated", {});
        if (this.kernel.prefs.get("workspace.verticalTabSubtitleMode") === "lastViewed") this.queueRefresh(50);
      }
    }
    queueRefresh(delayMs = 16) {
      if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        if (this.active) this.refreshAllWindows();
      }, delayMs);
    }
    refreshAllWindows() {
      for (const [win, ui] of [...this.windows.entries()]) {
        if (win.closed) {
          ui.destroy();
          this.windows.delete(win);
          continue;
        }
        try {
          ui.render();
        } catch (err) {
          this.kernel.logger.error("workspace:render", err);
        }
      }
      const targetWin = this.getTargetWindow();
      if (targetWin && !targetWin.closed) {
        try {
          this.neighbors.publish(targetWin, this.tabs.buildTrackedTabs(targetWin));
        } catch {
        }
      }
      this.emitGroupSummaries();
    }
    emitGroupSummaries(force = false) {
      if (!this.store.state.groups.length && !force && this.lastGroupFingerprint === "") return;
      const groups = buildWorkspaceGroupSummaries(this.windows.keys(), this.tabs, this.store);
      const fp = groups.map((g) => `${g.groupId}:${g.groupName}:${g.itemIDs.join(",")}`).join("|");
      if (!force && fp === this.lastGroupFingerprint) return;
      this.lastGroupFingerprint = fp;
      this.kernel.bus.emit("workspace:groups-updated", { groups });
    }
    setCitationBadges(badges) {
      this.latestBadges = new Map(badges);
      for (const ui of this.windows.values()) {
        ui.setCitationBadges(badges);
      }
    }
    registerSpotlightProvider(provider) {
      return this.spotlight.registerProvider(provider);
    }
    async focusOrOpenItem(req, preferredWin) {
      const win = preferredWin || this.getTargetWindow();
      if (!win) return "not-found";
      const res = await this.tabs.focusOrOpenItem(win, req);
      this.refreshAllWindows();
      return res;
    }
    groupOpenTabsByItemIDs(groupName, itemIDs, preferredWin) {
      const win = preferredWin || this.getTargetWindow();
      if (!win) return null;
      const res = this.tabs.groupOpenTabsByItemIDs(win, groupName, itemIDs);
      if (res) this.refreshAllWindows();
      return res;
    }
    handleTabEvent(event, tabIDs) {
      if (event === "select" || event === "close") {
        this.flushReadingProgress(2, true);
        this.lastActivityAt = Date.now();
      } else if (event === "add") {
        this.lastActivityAt = Date.now();
      }
      for (const win of this.windows.keys()) {
        const tracked = this.tabs.buildTrackedTabs(win);
        for (const id of tabIDs) {
          const tab = tracked.find((t) => t.tabID === id);
          if (!tab) continue;
          if (event === "select" || event === "add") {
            this.store.touchViewed(tab.key);
            this.readingDirty = true;
            this.store.removeVirtualMember(tab.key);
            if (tab.sleeping) this.store.setSleeping(tab.key, false);
            if (tab.groupId && this.store.state.collapsed.includes(tab.groupId)) {
              this.store.setCollapsed(tab.groupId, false);
            }
          }
        }
        const snap = this.tabs.resolveActiveReaderSnapshot(win);
        if (snap) this.lastReaderByWin.set(win, snap);
        else this.lastReaderByWin.delete(win);
      }
      if (event === "add" && this.kernel.prefs.get("workspace.newTabMode") === "collection") {
        for (const id of tabIDs) this.pendingAutoGroup.add(id);
        if (this.autoGroupTimer !== null) clearTimeout(this.autoGroupTimer);
        this.autoGroupTimer = setTimeout(() => {
          this.autoGroupTimer = null;
          const added = this.pendingAutoGroup;
          this.pendingAutoGroup = /* @__PURE__ */ new Set();
          for (const win of this.windows.keys()) this.tabs.autoGroupByCollection(win, added);
          this.refreshAllWindows();
        }, 80);
      }
      this.refreshAllWindows();
    }
    runPeriodicMaintenance() {
      if (!this.active) return;
      let changed = false;
      for (const win of this.windows.keys()) {
        if (this.tabs.sleepIdleTabs(win) > 0) changed = true;
      }
      if (this.readingDirty) {
        this.readingDirty = false;
        void this.store.readingCache.flushNow(this.store.state);
      }
      if (this.kernel.prefs.get("workspace.enableRollingSnapshots") && Date.now() - this.lastRollingAt > 9e5) {
        const openKeys = [...new Set([...this.windows.keys()].flatMap((win) => this.tabs.openKeys(win)))];
        if (openKeys.length || this.store.state.groups.length > 0 || this.store.state.pinnedKeys.length > 0) {
          this.store.saveSession(`自动滚动快照 ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`, { rolling: true, openKeys });
          this.lastRollingAt = Date.now();
        }
      }
      if (changed) this.refreshAllWindows();
    }
    getTargetWindow() {
      const hostWin = globalThis.Zotero?.getMainWindow?.();
      if (hostWin) return hostWin;
      return this.windows.keys().next().value ?? null;
    }
    getMainWindows() {
      const wins = globalThis.Zotero?.getMainWindows?.();
      return Array.isArray(wins) ? wins : [];
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
    const host2 = globalThis.Zotero?.Prefs;
    return host2 && typeof host2.get === "function" ? host2 : null;
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
    observeKeys(keys2, onChange) {
      const localTokens = [];
      const adapter = this.adapter;
      if (adapter?.registerObserver) {
        for (const key of keys2) {
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

  // src/kernel/plugin-kernel.ts
  var PluginKernel = class {
    info = { id: "bridgeflow@groele", version: "0.0.1", rootURI: "" };
    logger = new KernelLogger();
    bus;
    prefs;
    runtime = new NativeRuntime();
    notifier;
    disposables = new DisposableStack();
    _ftlRegistered = false;
    domains = /* @__PURE__ */ new Map();
    bridges = [];
    openWindows = /* @__PURE__ */ new Set();
    initialized = false;
    started = false;
    syncQueue = Promise.resolve();
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
      this.prefs.seedDefaults();
      this.syncLoggerConfig();
      this.notifier.start();
      const watchedKeys = [
        "debug",
        "wordCite.perfSlowThresholdMs",
        "modules.workspace.enable",
        "modules.visualNotes.enable",
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
      const zot = globalThis.Zotero;
      const existing = zot?.getMainWindows?.();
      if (Array.isArray(existing) && existing.length) {
        for (const win of existing) this.onMainWindowLoad(win);
      } else {
        const mainWin = zot?.getMainWindow?.();
        if (mainWin) this.onMainWindowLoad(mainWin);
      }
    }
    syncDomainStates() {
      const next = this.syncQueue.then(() => this.runSyncDomainStates());
      this.syncQueue = next.catch(() => {
      });
      return next;
    }
    async runSyncDomainStates() {
      for (const domain of this.domains.values()) {
        const shouldEnable = Boolean(this.prefs.get(domain.enabledPref));
        const currentlyActive = domain.isActive();
        if (shouldEnable && !currentlyActive) {
          try {
            await domain.start();
            for (const win of this.openWindows) {
              try {
                domain.onMainWindowLoad?.(win);
              } catch (err) {
                this.logger.error(`windowLoad:${domain.id}`, err);
              }
            }
          } catch (err) {
            this.logger.error(`domain:start:${domain.id}`, err);
          }
        } else if (!shouldEnable && currentlyActive) {
          try {
            for (const win of this.openWindows) {
              try {
                domain.onMainWindowUnload?.(win);
              } catch (err) {
                this.logger.error(`windowUnload:${domain.id}`, err);
              }
            }
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
  function normalizeCitationKey(text2) {
    return String(text2 || "").replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
  }
  var CitationHistoryStore = class {
    records = /* @__PURE__ */ new Map();
    config = { maxEntries: 2e3, ttlDays: 90 };
    initialized = false;
    dirty = false;
    writes = Promise.resolve(true);
    saveTimer = null;
    saveFailed = false;
    statusListeners = /* @__PURE__ */ new Set();
    onStatusChange(listener) {
      this.statusListeners.add(listener);
      return () => this.statusListeners.delete(listener);
    }
    async retrySave() {
      return this.flushToDisk();
    }
    configure(partial) {
      if (typeof partial.maxEntries === "number" && Number.isFinite(partial.maxEntries)) {
        this.config.maxEntries = Math.max(100, Math.min(1e5, Math.floor(partial.maxEntries)));
      }
      if (typeof partial.ttlDays === "number" && Number.isFinite(partial.ttlDays)) {
        this.config.ttlDays = Math.max(7, Math.min(3650, Math.floor(partial.ttlDays)));
      }
      if (!this.initialized && partial.customDir !== void 0) {
        this.config.customDir = partial.customDir.trim() || void 0;
      }
      this.pruneExpired();
      this.enforceEviction();
    }
    get count() {
      return this.records.size;
    }
    getDirectoryPath() {
      return cacheDirectory(this.config.customDir);
    }
    getFilePath() {
      return cacheFile(this.getDirectoryPath(), "citation-history.json");
    }
    record(entry) {
      const key = normalizeCitationKey(entry.text);
      if (!key) return null;
      const now = Date.now();
      const existing = this.records.get(key);
      const record2 = {
        ...entry,
        key,
        copiedAt: existing?.copiedAt ?? now,
        lastAccessedAt: now,
        hitCount: (existing?.hitCount ?? 0) + 1
      };
      this.records.delete(key);
      this.records.set(key, record2);
      this.dirty = true;
      this.enforceEviction();
      this.scheduleSave();
      return record2;
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
      this.scheduleSave();
      return rec;
    }
    searchFuzzy(query, limit = 5) {
      const norm = normalizeCitationKey(query);
      if (!norm) return [];
      const qTokens = norm.split(/[^a-z0-9\u4e00-\u9fff]+/i).filter((t) => t.length >= 2);
      const scored = [];
      for (const rec of this.records.values()) {
        if (rec.key === norm) {
          scored.push({ rec, score: 100 });
        } else if (rec.key.includes(norm) || norm.includes(rec.key)) {
          scored.push({ rec, score: 70 });
        } else if (qTokens.length >= 3) {
          let hits = 0;
          for (const tok of qTokens) if (rec.key.includes(tok)) hits++;
          const ratio = hits / qTokens.length;
          if (hits >= 3 && ratio >= 0.6) scored.push({ rec, score: Math.round(45 + ratio * 20) });
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
      if (this.config.customDir) paths.push(cacheFile(cacheDirectory(), "citation-history.json"));
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
          if (filePath !== paths[0]) {
            this.dirty = true;
            this.scheduleSave();
          }
          break;
        } catch {
        }
      }
      this.pruneExpired();
      this.enforceEviction();
    }
    dispose() {
      if (this.dirty) void this.flushToDisk();
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
    flushToDisk() {
      this.writes = this.writes.then(() => this.writeRecords());
      return this.writes;
    }
    async writeRecords() {
      const ioUtils = globalThis.IOUtils;
      if (!ioUtils?.writeUTF8) return true;
      try {
        await ioUtils.makeDirectory?.(this.getDirectoryPath(), { ignoreExisting: true });
        const payload = `${JSON.stringify({ version: 1, records: [...this.records.values()] }, null, 2)}
`;
        this.dirty = false;
        await ioUtils.writeUTF8(this.getFilePath(), payload, { tmpPath: this.getFilePath() + ".tmp" });
        if (this.saveFailed) {
          this.saveFailed = false;
          for (const fn of this.statusListeners) {
            try {
              fn();
            } catch {
            }
          }
        }
        return true;
      } catch {
        this.dirty = true;
        this.saveFailed = true;
        for (const fn of this.statusListeners) {
          try {
            fn();
          } catch {
          }
        }
        return false;
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
    writePayload(html, text2, plainOnly = false) {
      const cleanText = String(text2 || "").trim();
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
            transferable.setTransferData("text/html", htmlStr, cleanHtml.length * 2);
          }
          if (cleanText) {
            const textStr = hostCc["@mozilla.org/supports-string;1"].createInstance(hostCi.nsISupportsString);
            textStr.data = cleanText;
            transferable.addDataFlavor("text/plain");
            transferable.setTransferData("text/plain", textStr, cleanText.length * 2);
          }
          const clipboard = hostCc["@mozilla.org/widget/clipboard;1"].getService(hostCi.nsIClipboard);
          clipboard.setData(transferable, null, hostCi.nsIClipboard.kGlobalClipboard);
          return true;
        } catch {
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
      try {
        const formatted = await this.csl.formatItems(items, {
          styleID: options.styleID,
          asCitation: options.asCitation
        });
        if (!formatted.text && !formatted.html) return false;
        const ok = this.writePayload(formatted.html, formatted.text, Boolean(options.plainOnly));
        if (ok) {
          this.emitCopied(items, formatted.styleID, formatted.html, formatted.text, options.source, Boolean(options.asCitation));
        }
        return ok;
      } catch {
        return false;
      }
    }
    copyRendered(rawItems, payload, options) {
      const { items } = deduplicateRegularItems(rawItems);
      if (!items.length || !payload.text && !payload.html) return false;
      const ok = this.writePayload(payload.html, payload.text, Boolean(options.plainOnly));
      if (ok) {
        this.emitCopied(items, payload.styleID, payload.html, payload.text, options.source, Boolean(options.asCitation));
      }
      return ok;
    }
    emitCopied(items, styleID, html, text2, source, asCitation) {
      const rawText = text2.trim();
      const canRecord = !asCitation || rawText.length >= 8 && !/^\[?\d+(?:[,\s\u2010-\u2015-]+\d+)*\]?$/.test(rawText);
      if (!canRecord) return;
      this.bus.emit("citation:copied", {
        itemIDs: items.map((it) => Number(it.id || 0)).filter((n) => n > 0),
        styleID,
        html,
        text: text2,
        source
      });
    }
  };

  // src/services/csl-engine.ts
  function createCslPreviewError(code, message) {
    return Object.assign(new Error(message), { previewCode: code });
  }
  var CslFormattingEngine = class {
    cache = /* @__PURE__ */ new Map();
    bytes = 0;
    styleInitialization;
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
    resolveFormatConfig(item, overrideStyle) {
      const custom = (overrideStyle ?? this.prefs.get("inspector.cslPreview.citationstyle")).trim();
      const host2 = globalThis.Zotero;
      const qc = host2?.QuickCopy;
      if (typeof qc?.unserializeSetting === "function") {
        let format = {};
        try {
          let rawSetting = "";
          if (!custom) {
            let url = "";
            if (item?.isField?.("url")) {
              try {
                url = item.getField("url", true, true) || "";
              } catch {
                url = "";
              }
            }
            try {
              rawSetting = qc.getFormatFromURL?.(url) || "";
            } catch {
              rawSetting = host2?.Prefs?.get?.("export.quickCopy.setting") || "";
            }
          } else {
            rawSetting = host2?.Prefs?.get?.("export.quickCopy.setting") || "";
          }
          format = { ...qc.unserializeSetting(rawSetting) };
        } catch (error) {
          if (!custom) {
            throw createCslPreviewError("no-style", error instanceof Error ? error.message : String(error));
          }
        }
        if (custom) Object.assign(format, { id: custom, mode: "bibliography" });
        if (format.mode !== "bibliography" || !format.id) {
          throw createCslPreviewError("no-style", "No bibliography style configured");
        }
        if (host2?.Styles?.get && !host2.Styles.get(format.id)) {
          throw createCslPreviewError("style-missing", `Citation style not installed: ${format.id}`);
        }
        format.locale = format.locale || host2?.Prefs?.get?.("export.quickCopy.locale");
        const asHTML = format.contentType === "html";
        format.contentType = "text";
        return { format, styleID: format.id, asHTML };
      }
      const styleID = this.resolveStyleID(overrideStyle);
      return { format: `bibliography=${styleID}`, styleID, asHTML: false };
    }
    buildCacheKey(items, styleID, asCitation) {
      const itemPart = items.map((it) => `${it.id || 0}:${it.dateModified || it.version || 0}`).join(",");
      return `${asCitation ? "cite" : "bib"}|${styleID}|${itemPart}`;
    }
    async formatItems(items, options = {}) {
      const host2 = globalThis.Zotero;
      if (host2?.Styles?.init) {
        this.styleInitialization ??= this.initializeStyles(host2.Styles);
        await this.styleInitialization;
      }
      const { format, styleID } = this.resolveFormatConfig(items[0], options.styleID);
      const asCitation = Boolean(options.asCitation);
      if (!items.length) return { html: "", text: "", styleID };
      const locale = typeof format === "string" ? "" : format.locale || "";
      const key = JSON.stringify([this.buildCacheKey(items, styleID, asCitation), locale]);
      const cached = this.getCached(key);
      if (cached) return cached;
      let html = "";
      let text2 = "";
      if (host2?.QuickCopy?.getContentFromItems) {
        const res = host2.QuickCopy.getContentFromItems(items, format, null, asCitation);
        if (res === null || res === void 0 || typeof res.html !== "string" || typeof res.text !== "string") {
          throw createCslPreviewError("quickcopy-unavailable", `QuickCopy returned incomplete ${asCitation ? "citation" : "bibliography"}`);
        }
        html = res.html;
        text2 = res.text.trim();
      } else {
        text2 = items.map((it) => String(it.getField?.("title") || it.title || "")).filter(Boolean).join("\n");
        html = text2;
      }
      const result = { html, text: text2, styleID };
      this.setCached(key, result, items.map((it) => Number(it.id || 0)).filter((n) => n > 0));
      return result;
    }
    async initializeStyles(styles) {
      let timer;
      try {
        await Promise.race([
          Promise.resolve().then(() => styles.init()),
          new Promise((resolve) => {
            timer = setTimeout(() => {
              this.styleInitialization = void 0;
              resolve();
            }, 1e4);
          })
        ]);
      } catch (error) {
        this.styleInitialization = void 0;
        throw error;
      } finally {
        if (timer !== void 0) clearTimeout(timer);
      }
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
  function normalizeWordTitleForMatch(rawTitle) {
    const cleaned = String(rawTitle || "").replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\uFEFF]/g, " ").replace(/\s+/g, " ").trim();
    if (!cleaned) return "";
    const wordSuffixRe = /\s+[-–—]\s+(?:Microsoft\s+)?Word(?:\s*\([^)]*\))?$/i;
    if (!wordSuffixRe.test(cleaned)) return cleaned;
    let body = cleaned.replace(wordSuffixRe, "").trim();
    const extMatch = body.match(/^(.+?\.(?:docx|docm|doc|dotx|dotm|rtf|odt))(?:\s*\[[^\]]*\]|\s+[-–—]\s+.*)*$/i);
    if (extMatch) return extMatch[1].trim();
    const statusRe = /(?:\s*\[(?:兼容模式|Compatibility Mode|只读|Read-Only|受保护的视图|Protected View|自动保存|AutoSave)[^\]]*\]|\s+[-–—]\s+(?:已保存.*|正在保存.*|上次保存.*|只读|兼容模式|受保护的视图|未保存|Saved.*|Saving.*|Last saved.*|Read-Only|Compatibility Mode|Protected View|Unsaved))\s*$/i;
    let prev = "";
    while (body && body !== prev) {
      prev = body;
      body = body.replace(statusRe, "").trim();
    }
    return body || cleaned;
  }
  var Win32BridgeService = class {
    cached = null;
    lastDroppedWordWindow = null;
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
        const title = this.readWindowTitle(api, target);
        if (title) this.lastDroppedWordWindow = { title, at: Date.now() };
        return { status: "word-confirmed", windowTitle: title };
      } catch {
        return { status: "unknown", windowTitle: "" };
      }
    }
    clearLastDroppedWordTarget() {
      this.lastDroppedWordWindow = null;
    }
    setLastDroppedWordTargetForTest(title, at = Date.now()) {
      this.lastDroppedWordWindow = title ? { title, at } : null;
    }
    verifyDroppedWordTarget(overrideActiveTitle) {
      const recorded = this.lastDroppedWordWindow;
      if (recorded?.title && Date.now() - recorded.at <= 15e3) {
        let activeTitle = overrideActiveTitle;
        if (activeTitle === void 0) {
          const probed = this.probeWordWindowTitles();
          activeTitle = probed.foregroundTitle || probed.visibleTitles[0] || "";
        }
        if (activeTitle) {
          const matches = normalizeWordTitleForMatch(activeTitle) === normalizeWordTitleForMatch(recorded.title);
          if (!matches) {
            this.lastDroppedWordWindow = null;
            return false;
          }
          return true;
        }
      }
      if (!this.supportsNativeWin32()) return true;
      const cursor = this.probeCursorWordDropTarget();
      if (cursor.status === "word-confirmed") return true;
      return Boolean(this.probeForegroundWordTitle());
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
          if (ids.length) {
            this.csl.invalidateItems(ids);
            invalidateResolvedItemCache(ids);
          }
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
    visualNotes;
    _ftlRegistered = false;
    constructor(options = {}) {
      this.kernel = new PluginKernel(options);
      this.services = new ServiceContainer(this.kernel);
      this.workspace = new WorkspaceDomainModule(this.kernel, this.services);
      this.inspector = new InspectorDomainModule(this.kernel, this.services);
      this.wordCite = new WordCiteDomainModule(this.kernel, this.services);
      this.visualNotes = new VisualNotesDomainModule(this.kernel, this.services);
      this.kernel.registerDomain(this.workspace);
      this.kernel.registerDomain(this.inspector);
      this.kernel.registerDomain(this.wordCite);
      this.kernel.registerDomain(this.visualNotes);
      this.kernel.registerBridge(new CopyHistoryBridge(this.kernel, this.services));
      this.kernel.registerBridge(new CiteBadgeBridge(this.kernel, this.workspace));
      this.kernel.registerBridge(new SpotlightFusionBridge(this.kernel, this.workspace, this.wordCite));
      this.kernel.registerBridge(new LookupWorkspaceBridge(this.kernel, this.workspace));
      this.kernel.registerBridge(new VisualNotesBridge(this.kernel, this.workspace, this.visualNotes));
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
