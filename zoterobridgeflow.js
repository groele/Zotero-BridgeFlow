/* Zotero BridgeFlow v0.0.9 - Unified Reading Workspace, Inspector & Word Citation Tracking for Zotero 10-12. */
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
            if (this.wordCite.isActive() && this.kernel.prefs.get("wordCite.dragCite.enable")) {
              const insertLabel = "插入当前文献到 Word 光标处";
              if (!term || insertLabel.toLowerCase().includes(term) || "word".includes(term) || "cite".includes(term)) {
                out.push({
                  id: "cmd:cite-selected-word",
                  category: "command",
                  title: `> ${insertLabel}`,
                  subtitle: "在当前 Word 光标处生成原生 Zotero 可编辑引文域",
                  badge: "WORD",
                  action: async () => {
                    await this.wordCite.citeCurrentSelection(win);
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
  function formatCreatorYear(item) {
    if (!item) return "";
    const first = String(item.firstCreator || "");
    const date = String(item.getField?.("year") || item.getField?.("date") || "").slice(0, 4);
    return [first, date].filter(Boolean).join(", ");
  }
  function resolvePrimaryCollectionName(item) {
    if (!item || typeof item.getCollections !== "function") return "";
    const ids = item.getCollections() || [];
    if (!ids.length) return "";
    const col = globalThis.Zotero?.Collections?.get?.(ids[0]);
    return String(col?.name || "");
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
  function stripAuthorPrefix(text) {
    const quoteMatch = text.match(/^(.+?)[,.\s]+["\u201c].+?["\u201d][,.\s]+(.+)$/);
    if (quoteMatch) {
      return { authors: quoteMatch[1].trim(), rest: quoteMatch[2].replace(/^in\s+/i, "").trim() };
    }
    const gbtMatch = text.match(/^([^.]+?)\.\s*.+?\[J\][.,\s]+(.+)$/i);
    if (gbtMatch) {
      return { authors: gbtMatch[1].trim(), rest: gbtMatch[2].trim() };
    }
    const etAlMatch = text.match(/^(.+?\bet\s+al\.?),?\s+(.+)$/i);
    if (etAlMatch) {
      return { authors: etAlMatch[1].trim(), rest: etAlMatch[2].trim() };
    }
    const semiMatch = text.match(/^([^;]+(?:;\s*[^;]+)+)[,;]\s+([A-Z].+)$/);
    if (semiMatch) {
      return { authors: semiMatch[1].trim(), rest: semiMatch[2].trim() };
    }
    return { rest: text };
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
    if (!host2?.Search || !host2?.Items?.getAsync) return [];
    const runSearch = async (libID) => {
      const s = new host2.Search(libID !== void 0 ? { libraryID: libID } : void 0);
      if (parsed.doi) {
        s.addCondition("DOI", "is", parsed.doi);
      } else if (parsed.arxiv && !parsed.journalText) {
        s.addCondition("quicksearch-everything", "contains", parsed.arxiv.replace(/v\d+$/, ""));
      } else {
        s.addCondition("itemType", "is", "journalArticle");
        if (parsed.year) s.addCondition("date", "contains", String(parsed.year));
        if (parsed.volume) s.addCondition("volume", "is", parsed.volume);
      }
      return await s.search() || [];
    };
    let ids = await runSearch(libraryID);
    if (!ids.length && libraryID !== void 0) ids = await runSearch(void 0);
    return ids.length ? host2.Items.getAsync(ids) : [];
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
        const itemDoi = String(item.getField?.("DOI") || "").trim().toLowerCase();
        return itemDoi === parsed.doi.toLowerCase();
      }
      if (parsed.arxiv && !parsed.journalText) {
        const [, qBase = "", qVer] = parsed.arxiv.toLowerCase().match(/^(\d{4}\.\d{4,5})(?:v(\d+))?$/) || [
          "",
          parsed.arxiv.toLowerCase().replace(/v\d+$/, ""),
          void 0
        ];
        const fields = ["archiveID", "extra", "DOI", "url", "callNumber"].map((f) => String(item.getField?.(f) || "").toLowerCase());
        return fields.some((val) => {
          for (const m of val.matchAll(/(?:^|[^0-9])(\d{4}\.\d{4,5})(?:v(\d+))?(?=$|[^0-9])/g)) {
            if (m[1] === qBase && (!qVer || !m[2] || m[2] === qVer)) return true;
          }
          return false;
        });
      }
      const rawPages = String(item.getField?.("pages") || "").replace(/[\u2010-\u2015\u2212]/g, "-").trim();
      const [first, last] = rawPages.split("-");
      const normItemLast = expandEndPage(first, last);
      const normParsedLast = expandEndPage(parsed.firstPage, parsed.lastPage);
      if (parsed.firstPage && first !== parsed.firstPage) return false;
      if (normParsedLast && normItemLast !== normParsedLast) return false;
      if (parsed.issue && String(item.getField?.("issue") || "") !== parsed.issue) return false;
      const pubTitle = String(item.getField?.("publicationTitle") || "");
      const abbr = String(item.getField?.("journalAbbreviation") || "");
      return isJournalMatch(parsed.journalText, pubTitle, abbr);
    });
    if (matched.length > 1 && parsed.authorPrefix) {
      const surname = parsed.authorPrefix.replace(/\bet\s+al\.?/i, "").trim().split(/[,;\s]+/)[0]?.toLowerCase();
      if (surname && surname.length >= 2) {
        const byAuthor = matched.filter((it) => {
          const creators = it.getCreators?.() || [];
          const firstCreator = String(it.getField?.("firstCreator") || "").toLowerCase();
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
        return { parsed, historyMatched: false, candidates: [] };
      }
      const weighted = await this.weightedSearch(query, options.libraryItems);
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
    async weightedSearch(query, libraryItems) {
      const candidates = libraryItems ?? await this.fetchLocalLibraryItems();
      const targetDoi = extractDoi(query);
      const targetYear = extractYear(query);
      const lowerQuery = query.toLowerCase();
      const results = [];
      const seen = /* @__PURE__ */ new Set();
      for (const item of candidates) {
        if (!isRegularValidItem(item)) continue;
        const id = Number(item.id || 0);
        if (!id || seen.has(id)) continue;
        const title = String(item.getField?.("title") || item.title || "");
        const doi = String(item.getField?.("DOI") || item.DOI || "").trim().toLowerCase();
        if (targetDoi && doi && doi === targetDoi) {
          seen.add(id);
          results.push({ itemID: id, title, score: 98, source: "doi", item });
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
        if (title && title.length >= 8 && lowerQuery.includes(title.toLowerCase().slice(0, 24))) score += 45;
        if (score >= 45) {
          seen.add(id);
          results.push({ itemID: id, title, score: Math.min(95, score), source: "library-weighted", item });
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
      if (owner.skipRender) return;
      const groups = {
        "zotero-item-pane-header": [],
        "zotero-editpane-item-box": [],
        "zotero-editpane-related": []
      };
      const independent = [...this.targets.values()].filter((s) => !s.anchorAfterSectionID);
      const anchored = [...this.targets.values()].filter((s) => Boolean(s.anchorAfterSectionID));
      for (const spec of independent) {
        groups[spec.getPosition()].push(spec);
      }
      for (const spec of anchored) {
        const pos = spec.getPosition();
        const list = groups[pos];
        const anchorIdx = list.findIndex((item) => item.sectionID === spec.anchorAfterSectionID);
        if (anchorIdx >= 0) list.splice(anchorIdx + 1, 0, spec);
        else list.push(spec);
      }
      for (const position of ["zotero-item-pane-header", "zotero-editpane-item-box", "zotero-editpane-related"]) {
        await this.alignGroup(owner, position, groups[position]);
      }
    }
    async alignGroup(owner, position, group) {
      const presentIDs = group.map((s) => s.sectionID).filter((id) => owner.getPanes().some((p) => p.dataset.pane === id));
      if (!presentIDs.length) return;
      const panes = owner.getPanes();
      const startIdx = this.computeGroupStartIndex(panes, position, presentIDs.length);
      const slice = panes.slice(startIdx, startIdx + presentIDs.length).map((p) => p.dataset.pane);
      if (slice.length === presentIDs.length && presentIDs.every((id, idx) => slice[idx] === id)) {
        return;
      }
      await this.moveSectionToPosition(owner, presentIDs[0], position);
      for (let i = 1; i < presentIDs.length; i++) {
        await this.moveSectionAfter(owner, presentIDs[i], presentIDs[i - 1]);
      }
    }
    computeGroupStartIndex(panes, position, groupSize) {
      if (position === "zotero-item-pane-header") return 0;
      if (position === "zotero-editpane-related") return Math.max(0, panes.length - groupSize);
      const info = panes.findIndex((p) => p.dataset.pane === "info");
      return info < 0 ? 0 : info + 1;
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
.viewflow-lookup-input {
	display: block;
	box-sizing: border-box;
	width: 100%;
	min-width: 0;
	height: 28px;
	padding: 3px 7px;
	border: 1px solid var(--material-border, light-dark(#d1d1d1, #555));
	border-radius: 3px;
	background: var(--material-background, light-dark(#fff, #242424));
	color: inherit;
	font: inherit;
}
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
    renderLookupTitle(head, String(target?.getField?.("title") || candidate.title || ""));
    card.appendChild(head);
    const meta = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    meta.className = "viewflow-lookup-card-meta";
    const journal = target?.getField?.("publicationTitle") || target?.getField?.("journalAbbreviation") || "";
    const year = target?.getField?.("year") || target?.getField?.("date") || "";
    meta.textContent = `${journal} (${year}) · Vol.${target?.getField?.("volume") || "-"} · pp.${target?.getField?.("pages") || "-"}`;
    card.appendChild(meta);
    const actRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    actRow.className = "viewflow-lookup-actions";
    const locateBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
    locateBtn.type = "button";
    setLookupL10n(locateBtn, "zbf-lookup-locate", "定位条目");
    locateBtn.onclick = async () => {
      const ok = await cb.onLocate(candidate.itemID);
      if (cb.isActive()) {
        setLookupL10n(
          stateEl,
          ok ? "zbf-lookup-status-located" : "zbf-lookup-status-locate-failed",
          ok ? "已定位" : "定位失败，请重试"
        );
      }
    };
    const pdfBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
    pdfBtn.type = "button";
    setLookupL10n(pdfBtn, "zbf-lookup-open-pdf", "打开 PDF");
    pdfBtn.onclick = async () => {
      const opened = await cb.onOpenPdf(target || candidate.itemID);
      if (cb.isActive() && !opened) {
        setLookupL10n(stateEl, "zbf-lookup-status-no-pdf", "未找到 PDF 附件");
      }
    };
    actRow.append(locateBtn, pdfBtn);
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
      const j = tObj?.getField?.("journalAbbreviation") || tObj?.getField?.("publicationTitle") || "";
      const y = tObj?.getField?.("year") || tObj?.getField?.("date") || "";
      const suffix = j || y ? ` (${[j, y].filter(Boolean).join(", ")})` : "";
      renderLookupTitle(btn, String(tObj?.getField?.("title") || c.title || ""));
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
      const input = doc.createElementNS("http://www.w3.org/1999/xhtml", "input");
      input.type = "text";
      input.className = "viewflow-lookup-input";
      input.setAttribute("data-l10n-id", "zbf-lookup-input");
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
      container.append(input, btnRow, cacheNotice, statusDiv);
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
      input.oninput = () => {
        request++;
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
          if (input.value.trim()) void executeLookup(input.value);
        }, 0);
      };
      input.onkeydown = (e) => {
        const key = e.key;
        if (key === "Enter") {
          cancelPaste();
          void executeLookup(input.value);
        } else if (key === "Escape") {
          cancelPaste();
          request++;
          input.value = "";
          clearLookupResult(statusDiv);
        }
      };
      clipBtn.onclick = () => {
        const clipText = readSystemClipboardText();
        if (clipText) {
          input.value = clipText;
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

  // src/domains/inspector/pdf-folder-section.ts
  var FOLDER_ICON = 'item-pane-sidenav .btn[data-l10n-id="zbf-pane-pdf-folder-sidenav"]';
  var FOLDER_ACTION = `${FOLDER_ICON}, button.ztf-pdf-folder-action`;
  function folderActionTarget(event) {
    return event.composedPath?.().find(
      (node) => node.matches?.(FOLDER_ACTION) === true
    );
  }
  var PdfFolderSectionController = class {
    unregisterFn = null;
    states = /* @__PURE__ */ new Map();
    listeners = /* @__PURE__ */ new Map();
    openingFolders = /* @__PURE__ */ new WeakSet();
    lastLaunched = /* @__PURE__ */ new Map();
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
        onInit: ({ doc, body, item, setEnabled }) => {
          this.initBody(doc || body.ownerDocument, body, item, setEnabled);
          this.services.panePositions.observeAndQueue(body);
        },
        onDestroy: ({ doc, body }) => {
          this.onDestroy(doc || body.ownerDocument, body);
        },
        onItemChange: ({ body, item, setEnabled }) => {
          this.updateState(body, item, setEnabled);
          this.services.panePositions.observeAndQueue(body);
          return this.kernel.prefs.get("inspector.pdfFolder.enable") && Boolean(item);
        },
        onRender: ({ body, item, setEnabled }) => {
          this.updateState(body, item, setEnabled);
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
      this.lastLaunched.clear();
      for (const controller of this.listeners.values()) controller.abort();
      this.listeners.clear();
      this.unregisterFn?.();
      this.unregisterFn = null;
      this.states.clear();
    }
    initBody(doc, body, item, setEnabled) {
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
      const meta = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      meta.style.cssText = "opacity:0.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      const btn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
      btn.type = "button";
      btn.className = "ztf-pdf-folder-action";
      btn.setAttribute("data-l10n-id", "zbf-pdf-folder-open");
      btn.textContent = "打开文件夹并选中 PDF";
      btn.style.cssText = "justify-self:start;min-inline-size:0;max-inline-size:100%;box-sizing:border-box;padding:5px 10px;border-radius:5px;border:1px solid color-mix(in srgb,currentColor 20%,transparent);background:transparent;color:inherit;font:inherit;white-space:normal;overflow-wrap:anywhere;text-align:start;cursor:pointer;";
      btn.disabled = true;
      wrap.append(meta, btn);
      body.append(wrap);
      this.states.set(body, { body, item: null, btn, meta });
      this.updateState(body, item, setEnabled);
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
        const activated = target && (event.detail === 0 ? keyed : pressed) === target;
        keyed = pressed = void 0;
        if (!activated || !event.isTrusted || event.button !== 0 || event.detail > 1) return;
        if (!this.kernel.prefs.get("inspector.pdfFolder.enable")) return;
        const sidenav = target.closest("item-pane-sidenav");
        const item = sidenav ? sidenav.container?.item ?? [...this.states.values()].find((s) => s.body.ownerDocument === doc && s.item)?.item ?? win.ZoteroPane?.getSelectedItems?.()?.[0] : [...this.states.values()].find((state) => state.btn === target && !state.btn.disabled)?.item;
        if (item && !signal.aborted && !this.openingFolders.has(win)) {
          this.openingFolders.add(win);
          void this.revealAttachmentFolder(item, win).finally(() => this.openingFolders.delete(win));
        }
      }, options);
    }
    onDestroy(doc, body) {
      this.states.delete(body);
      if (!doc || [...this.states.keys()].some((other) => other.ownerDocument === doc)) return;
      this.listeners.get(doc)?.abort();
      this.listeners.delete(doc);
    }
    updateState(body, item, setEnabled) {
      const enabled = this.kernel.prefs.get("inspector.pdfFolder.enable") && Boolean(item);
      setEnabled?.(enabled);
      const st = this.states.get(body);
      if (!st) return;
      st.item = enabled ? item : null;
      void this.refreshMeta(st);
    }
    async refreshMeta(st) {
      const item = st.item;
      st.btn.disabled = true;
      st.btn.style.opacity = "0.5";
      st.meta.textContent = "";
      st.meta.removeAttribute("title");
      st.meta.removeAttribute("data-l10n-id");
      if (!item) return;
      const att = await this.resolveFileAttachment(item).catch(() => null);
      if (this.states.get(st.body) !== st || st.item !== item) return;
      if (!att) {
        st.meta.setAttribute("data-l10n-id", "zbf-pdf-folder-unavailable");
        st.meta.textContent = "当前条目没有文件附件";
        return;
      }
      st.meta.textContent = String(att.attachmentFilename || att.getField?.("title") || "附件文件");
      st.meta.title = st.meta.textContent;
      st.btn.disabled = false;
      st.btn.style.opacity = "1";
    }
    async resolveFileAttachment(item) {
      return resolveBestFileAttachment(item);
    }
  };

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
.ztf-pdf-compare-bar {
	display: flex; align-items: center; gap: 3px; flex: 1 1 100%; min-inline-size: 0;
	padding-top: 3px; margin-top: 2px;
	border-top: 1px dashed var(--fill-quinary, color-mix(in srgb, currentColor 8%, transparent));
}
.ztf-pdf-compare-btn { font-size: 11px !important; padding: 0 6px !important; flex-shrink: 0; }
.ztf-pdf-compare-btn[data-active="true"] {
	color: var(--accent-blue, #4072e5) !important;
	background: var(--accent-blue10, rgba(64, 114, 229, 0.14)) !important;
	border-color: var(--accent-blue30, rgba(64, 114, 229, 0.35)) !important;
}
.ztf-pdf-compare-select {
	flex: 1 1 auto; min-inline-size: 0; block-size: 20px; padding: 0 5px; border-radius: 4px;
	border: 1px solid var(--fill-quarternary, rgba(127, 127, 127, 0.22));
	background: var(--material-background, transparent); color: var(--fill-primary, inherit);
	font: 500 11px/1.2 system-ui, sans-serif; cursor: pointer;
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
	gap: 8px; max-block-size: calc(100vh - 170px);
	overflow-y: auto; overflow-x: auto; padding: 2px 0 4px; background: transparent;
	scrollbar-width: thin; outline: none;
	scrollbar-color: var(--color-scrollbar, rgba(127, 127, 127, 0.38)) transparent;
}
.ztf-pdf-page-card {
	position: relative; flex: 0 0 auto; flex-shrink: 0; display: block;
	inline-size: 100%; box-sizing: border-box; background: #fff;
	border-radius: 5px; border: 1px solid var(--fill-quarternary, rgba(0, 0, 0, 0.12));
	box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); overflow: hidden; cursor: pointer;
	transition: border-color 0.14s ease, box-shadow 0.14s ease;
}
.ztf-pdf-page-card:hover {
	border-color: var(--accent-blue50, rgba(64, 114, 229, 0.45));
	box-shadow: 0 2px 6px rgba(0, 0, 0, 0.09);
}
.ztf-pdf-page-card[data-unrendered="true"] {
	aspect-ratio: 1 / 1.4142; min-block-size: 320px;
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
[data-ztf-pdf-full-hidden="true"], [data-ztf-pdf-full-stack="true"] > :not([data-ztf-pdf-full-section="true"]) { display: none !important; }
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
  function createToolBtn(doc, text, l10nId, extraClass = "", iconKey) {
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
      if (text && iconKey === "openReader") {
        const span = createXhtmlEl(doc, "span");
        span.textContent = text;
        btn.append(span);
      }
    } else if (text) btn.textContent = text;
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
  function ensureSectionConnected(body, root, savedSection, savedCollapsible) {
    if (!body.contains(root)) body.replaceChildren(root);
    let owner = body.closest?.("collapsible-section") || (body.parentElement?.localName === "collapsible-section" ? body.parentElement : null);
    if (!owner) {
      const doc = body.ownerDocument;
      let hostSection = body.closest?.("item-pane-custom-section") || savedSection || null;
      if ((!hostSection || hostSection.isConnected === false) && doc?.querySelectorAll) {
        const candidates = Array.from(doc.querySelectorAll('item-pane-custom-section[data-pane*="bridgeflow-pdf-preview"]'));
        hostSection = candidates.find((c) => c._body === body) || candidates.find((c) => !c.querySelector('[data-type="body"]')) || hostSection;
      }
      const liveCollapsible = hostSection?.querySelector?.("collapsible-section") || (savedCollapsible?.isConnected ? savedCollapsible : null);
      if (liveCollapsible) {
        const existingBody = liveCollapsible.querySelector?.('[data-type="body"]');
        if (!existingBody) liveCollapsible.append(body);
        else if (existingBody !== body) {
          existingBody.replaceWith(body);
          if (hostSection) hostSection._body = body;
        }
        owner = liveCollapsible;
      }
    }
    if (!owner) return null;
    owner.removeAttribute?.("empty");
    if ("empty" in owner) owner.empty = false;
    if (!owner.hasAttribute?.("data-zbf-pdf-ready")) {
      owner.setAttribute?.("data-zbf-pdf-ready", "true");
      owner.open = true;
    }
    owner.style?.setProperty?.("--open-height", "auto");
    return owner;
  }
  function applyPreviewLayoutMode(body, root, savedSection, fullActive) {
    root.setAttribute("data-layout-mode", fullActive ? "full" : "section");
    const hostSection = body.closest?.("item-pane-custom-section") || savedSection;
    const stack = hostSection?.parentElement;
    if (!hostSection) return;
    if (fullActive) {
      hostSection.setAttribute("data-ztf-pdf-full-section", "true");
      stack?.setAttribute("data-ztf-pdf-full-stack", "true");
      for (const child of Array.from(stack?.parentElement?.children || [])) {
        const tag = (child.localName || child.tagName || "").toLowerCase();
        if (child !== stack && tag !== "item-pane-sidenav" && !child.querySelector?.("item-pane-sidenav")) {
          child.setAttribute("data-ztf-pdf-full-hidden", "true");
        }
      }
    } else {
      hostSection.removeAttribute("data-ztf-pdf-full-section");
      stack?.removeAttribute("data-ztf-pdf-full-stack");
      body.ownerDocument?.querySelectorAll?.("[data-ztf-pdf-full-hidden]").forEach((el) => el.removeAttribute("data-ztf-pdf-full-hidden"));
    }
  }
  function bindPreviewSidenavClick(doc, signal, isFullMode, onFullModeChange) {
    if (typeof doc.addEventListener !== "function") return;
    doc.addEventListener("click", (event) => {
      if (event.button !== 0) return;
      const btn = event.target?.closest?.("item-pane-sidenav .btn[data-pane]");
      const paneID = btn?.getAttribute?.("data-pane") || "";
      if (!btn || btn.hasAttribute?.("disabled")) return;
      if (!paneID.includes("bridgeflow-pdf-preview")) {
        onFullModeChange(false);
        return;
      }
      if (isFullMode()) onFullModeChange(true);
      const sidenav = btn.closest?.("item-pane-sidenav");
      const container = sidenav?.container;
      const section = container?.getEnabledPane?.(paneID) || doc.querySelector?.(`item-pane-custom-section[data-pane="${paneID}"]`);
      const collapsible = section?.querySelector?.("collapsible-section");
      if (collapsible) {
        collapsible.removeAttribute?.("empty");
        collapsible.open = true;
        collapsible.style?.setProperty?.("--open-height", "auto");
      }
      if (container?.scrollToPane) void container.scrollToPane(paneID, "smooth");
    }, { capture: true, signal });
  }
  function createCompareBar(doc, signal, getState, onChange) {
    const bar = createXhtmlEl(doc, "div");
    bar.className = "ztf-pdf-compare-bar";
    bar.style.display = "none";
    const selfBtn = createXhtmlEl(doc, "button");
    selfBtn.type = "button";
    selfBtn.className = "ztf-pdf-btn ztf-pdf-compare-btn";
    selfBtn.textContent = "自身";
    selfBtn.setAttribute("data-l10n-id", "zbf-pdf-compare-self");
    const selectEl = createXhtmlEl(doc, "select");
    selectEl.className = "ztf-pdf-compare-select";
    selectEl.setAttribute("data-l10n-id", "zbf-pdf-compare-select");
    selfBtn.addEventListener("click", () => {
      const cur = getState();
      onChange(cur.mode === "self" ? "sibling" : "self", null);
    }, { signal });
    selectEl.addEventListener("change", () => {
      const val = Number(selectEl.value || 0);
      if (!val) return;
      const cur = getState();
      onChange(val === cur.currentAttachmentID ? "self" : "sibling", val);
    }, { signal });
    bar.append(selfBtn, selectEl);
    return { bar, selfBtn, selectEl };
  }
  function syncCompareBar(ui, st, entries, activeAttachmentID) {
    const visible = st.tabType === "reader" && entries.length > 1;
    ui.bar.style.display = visible ? "flex" : "none";
    if (!visible) return;
    const isSelf = st.mode === "self" || st.currentAttachmentID > 0 && activeAttachmentID === st.currentAttachmentID;
    if (isSelf) ui.selfBtn.setAttribute("data-active", "true");
    else ui.selfBtn.removeAttribute("data-active");
    const doc = ui.bar.ownerDocument;
    if (!doc) return;
    ui.selectEl.textContent = "";
    entries.forEach((entry, idx) => {
      const opt = createXhtmlEl(doc, "option");
      opt.value = String(entry.id);
      const isCurrent = st.currentAttachmentID > 0 && entry.id === st.currentAttachmentID;
      opt.textContent = isCurrent ? `● ${idx + 1}. ${entry.title}` : `${idx + 1}. ${entry.title}`;
      ui.selectEl.append(opt);
    });
    if (activeAttachmentID) ui.selectEl.value = String(activeAttachmentID);
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
  function getAttachmentTitle(att, index) {
    const raw = String(att?.getField?.("title") || att?.attachmentFilename || "").trim();
    return raw || `PDF ${index + 1}`;
  }
  async function resolveAllPdfAttachments(item) {
    if (!item || item.deleted || item.isTrashed?.()) return [];
    if (isPdfAttachment(item)) {
      return [{ id: Number(item.id) || 0, title: getAttachmentTitle(item, 0), attachment: item }];
    }
    const target = !item.isRegularItem?.() && item.parentItem ? item.parentItem : item;
    if (isPdfAttachment(target)) {
      return [{ id: Number(target.id) || 0, title: getAttachmentTitle(target, 0), attachment: target }];
    }
    const results = [];
    const seen = /* @__PURE__ */ new Set();
    const pushIfPdf = (att) => {
      if (!isPdfAttachment(att)) return;
      const id = Number(att.id) || results.length + 1;
      if (seen.has(id)) return;
      seen.add(id);
      results.push({ id, title: getAttachmentTitle(att, results.length), attachment: att });
    };
    const best = await target.getBestAttachment?.().catch(() => null);
    pushIfPdf(best);
    const ids = target.getAttachments?.() || [];
    const hostItems = globalThis.Zotero?.Items;
    if (ids.length && hostItems?.getAsync) {
      const attachments = await hostItems.getAsync(ids).catch(() => []);
      for (const att of attachments) pushIfPdf(att);
    }
    return results;
  }
  async function resolveSameItemPdfContext(item) {
    if (!item || item.deleted || item.isTrashed?.()) {
      return { currentAttachmentID: 0, entries: [] };
    }
    const isAtt = Boolean(item.isAttachment?.() || item.isPDFAttachment?.() || item.itemType === "attachment");
    const currentAttachmentID = isAtt ? Number(item.id) || 0 : 0;
    let container = item;
    if (isAtt) {
      if (item.parentItem) {
        container = item.parentItem;
      } else {
        const parentID = Number(item.parentID || item.parentItemID || 0);
        const hostItems = globalThis.Zotero?.Items;
        if (parentID && hostItems) {
          container = await (hostItems.getAsync ? hostItems.getAsync(parentID) : hostItems.get?.(parentID)).catch(() => null) || item;
        }
      }
    }
    const entries = await resolveAllPdfAttachments(container);
    if (!entries.length && isAtt) {
      return { currentAttachmentID, entries: await resolveAllPdfAttachments(item) };
    }
    return { currentAttachmentID, entries };
  }
  function pickCompareAttachment(ctx, mode, explicitAttachmentID) {
    if (!ctx.entries.length) return null;
    if (ctx.entries.length === 1) return ctx.entries[0];
    if (explicitAttachmentID) {
      const exact = ctx.entries.find((e) => e.id === explicitAttachmentID);
      if (exact) return exact;
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
    const location = typeof pageNumber === "number" && pageNumber > 1 ? { pageIndex: pageNumber - 1 } : void 0;
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

  // src/domains/inspector/pdf-viewport-manager.ts
  function disposePreviewDocument(state, clearAttachments = false) {
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
    state.setSectionSummary?.(hasDoc ? pageText : "");
    state.prevBtn.disabled = !hasDoc || state.currentPage <= 1;
    state.nextBtn.disabled = !hasDoc || state.currentPage >= state.numPages;
    state.openBtn.disabled = !state.attachment;
  }
  async function renderPageSlot(state, slot, gen, onError) {
    if (!state.pdfDoc || state.generation !== gen || slot.rendering || slot.renderedZoom === state.zoom) return;
    slot.rendering = true;
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
        () => state.generation !== gen,
        (c) => {
          slot.cancelTask = c;
        }
      );
      if (state.generation === gen && m.height > 0) {
        slot.lastHeight = m.height;
        slot.card.removeAttribute("data-unrendered");
        slot.card.style.minBlockSize = "0";
        slot.renderedZoom = state.zoom;
      }
    } catch (error) {
      if (state.generation === gen) onError(error);
    } finally {
      slot.rendering = false;
      slot.cancelTask = void 0;
    }
  }
  function invalidateVisibleSlots(state, onError) {
    for (const slot of state.slots) {
      slot.cancelTask?.();
      slot.renderedZoom = null;
    }
    const startIdx = Math.max(0, state.currentPage - 1);
    for (let i = startIdx; i < Math.min(state.slots.length, startIdx + 2); i++) {
      void renderPageSlot(state, state.slots[i], state.generation, onError);
    }
  }
  function jumpToPreviewPage(state, pageNumber, onError) {
    if (!state.numPages) return;
    const target = Math.max(1, Math.min(state.numPages, pageNumber));
    state.currentPage = target;
    syncPreviewControls(state);
    const slot = state.slots[target - 1];
    if (!slot) return;
    state.viewportEl.scrollTop = Math.max(0, slot.card.offsetTop - (state.slots[0]?.card.offsetTop || 0));
    void renderPageSlot(state, slot, state.generation, onError);
    evictDistantPageCanvases(state.slots, state.currentPage);
  }
  async function loadAttachmentPreviewDoc(state, att, isDblClickOpenEnabled, onError) {
    disposePreviewDocument(state, false);
    const gen = state.generation;
    state.loading = true;
    state.attachment = att;
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
      state.currentPage = state.numPages > 0 ? 1 : 0;
      ensureSectionConnected(state.body, state.root, state.customSection, state.collapsible);
      if (!state.numPages) {
        applyStatusMessage(state.statusEl, "zbf-pdf-preview-unavailable");
        return;
      }
      applyStatusMessage(state.statusEl, "");
      buildSlots(state, gen, isDblClickOpenEnabled, onError);
      syncPreviewControls(state);
    } catch (error) {
      if (state.generation === gen) {
        state.loading = false;
        onError(error);
        applyStatusMessage(state.statusEl, "zbf-pdf-preview-error");
      }
    }
  }
  async function loadItemPreviewAttachments(state, item, isDblClickOpenEnabled, onError) {
    disposePreviewDocument(state, true);
    const gen = state.generation;
    if (!item) {
      applyStatusMessage(state.statusEl, "zbf-pdf-preview-unavailable");
      return;
    }
    state.loading = true;
    applyStatusMessage(state.statusEl, "zbf-pdf-preview-loading");
    const isReader = state.compare.tabType === "reader";
    const ctx = isReader ? await resolveSameItemPdfContext(item) : { currentAttachmentID: 0, entries: await resolveAllPdfAttachments(item) };
    if (state.generation !== gen) return;
    const entries = ctx.entries;
    state.attachments = entries;
    state.compare.currentAttachmentID = ctx.currentAttachmentID;
    const chosen = isReader && entries.length > 1 ? pickCompareAttachment(ctx, state.compare.mode, state.compare.pickedAttachmentID) : entries[0] ?? null;
    syncCompareBar(state.compareUI, state.compare, entries, chosen?.id || 0);
    if (!isReader && entries.length > 1) {
      state.attSelect.textContent = "";
      entries.forEach((entry, idx) => {
        const opt = createXhtmlEl(state.doc, "option");
        opt.value = String(entry.id);
        opt.textContent = `${idx + 1}. ${entry.title}`;
        state.attSelect.append(opt);
      });
      state.attSelect.style.display = "block";
    } else state.attSelect.style.display = "none";
    if (!chosen) {
      state.loading = false;
      ensureSectionConnected(state.body, state.root, state.customSection, state.collapsible);
      applyStatusMessage(state.statusEl, "zbf-pdf-preview-unavailable");
      return;
    }
    await loadAttachmentPreviewDoc(state, chosen.attachment, isDblClickOpenEnabled, onError);
  }
  function buildSlots(state, gen, isDblClickOpenEnabled, onError) {
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
      card.addEventListener("dblclick", (e) => {
        if (state.attachment && isDblClickOpenEnabled()) {
          e.preventDefault?.();
          e.stopPropagation?.();
          void openPdfInReader(state.attachment, state.win, p);
        }
      });
      card.append(canvas, badge);
      frag.append(card);
      state.slots.push({ pageNumber: p, card, canvas, renderedZoom: null, rendering: false, lastHeight: 0 });
    }
    state.viewportEl.append(frag);
    const Observer = state.win.IntersectionObserver;
    if (Observer) {
      state.observer = new Observer((entries) => {
        if (state.generation !== gen) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const slot = state.slots.find((s) => s.card === entry.target);
            if (slot) void renderPageSlot(state, slot, gen, onError);
          }
        }
      }, { root: state.viewportEl, rootMargin: "320px 0px", threshold: 0.01 });
      for (const slot of state.slots) state.observer.observe(slot.card);
    }
    if (state.slots[0]) void renderPageSlot(state, state.slots[0], gen, onError);
    if (state.slots[1]) void renderPageSlot(state, state.slots[1], gen, onError);
  }

  // src/domains/inspector/pdf-preview-section.ts
  var MIN_ZOOM = 0.6;
  var MAX_ZOOM = 2;
  var ZOOM_STEP = 0.2;
  var PdfPreviewSectionController = class {
    unregisterFn = null;
    prefSub = null;
    states = /* @__PURE__ */ new Map();
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
      if (!this.prefSub) {
        this.prefSub = this.kernel.prefs.observeKeys(
          ["inspector.pdfPreview.mode", "inspector.pdfPreview.defaultZoom", "inspector.pdfPreview.showPageBadge", "inspector.pdfPreview.enable"],
          (changedKey) => {
            const isFull = this.kernel.prefs.get("inspector.pdfPreview.mode") === "full" && this.kernel.prefs.get("inspector.pdfPreview.enable");
            const showBadge = this.kernel.prefs.get("inspector.pdfPreview.showPageBadge");
            const defaultZoom = Math.round(this.kernel.prefs.get("inspector.pdfPreview.defaultZoom")) / 100;
            for (const st of this.states.values()) {
              st.fullActive = isFull;
              st.root.setAttribute("data-show-badge", showBadge ? "true" : "false");
              if (changedKey === "inspector.pdfPreview.defaultZoom") st.zoom = defaultZoom;
              applyPreviewLayoutMode(st.body, st.root, st.customSection, isFull);
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
      this.listeners.get(body)?.abort();
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
      const modeBtn = createToolBtn(doc, "", "zbf-pdf-preview-toggle-mode", "", "toggleMode");
      const openBtn = createToolBtn(doc, "在阅读器中打开", "zbf-pdf-preview-open-reader", "ztf-pdf-open-btn", "openReader");
      zoomGroup.append(zoomOutBtn, zoomLabel, zoomInBtn, modeBtn, openBtn);
      const attSelect = createXhtmlEl(doc, "select", "display:none");
      attSelect.className = "ztf-pdf-att-select";
      const compare = { mode: "sibling", pickedAttachmentID: null, currentAttachmentID: 0, tabType: tabType || "library" };
      const compareUI = createCompareBar(doc, controller.signal, () => state.compare, (nextMode, nextPickedID) => {
        state.compare.mode = nextMode;
        state.compare.pickedAttachmentID = nextPickedID;
        const chosen = pickCompareAttachment({ currentAttachmentID: state.compare.currentAttachmentID, entries: state.attachments }, nextMode, nextPickedID);
        syncCompareBar(compareUI, state.compare, state.attachments, chosen?.id || 0);
        if (chosen && chosen.attachment !== state.attachment) {
          void loadAttachmentPreviewDoc(state, chosen.attachment, this.isDblClickOpen, this.onRenderError);
        }
      });
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
        attachment: null,
        attachments: [],
        pdfDoc: null,
        loading: false,
        generation: 0,
        fullActive: this.kernel.prefs.get("inspector.pdfPreview.mode") === "full",
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
      applyPreviewLayoutMode(body, root, customSection, state.fullActive);
      bindPreviewSidenavClick(
        doc,
        controller.signal,
        () => this.kernel.prefs.get("inspector.pdfPreview.mode") === "full",
        (active) => {
          state.fullActive = active;
          applyPreviewLayoutMode(state.body, state.root, state.customSection, active);
        }
      );
      this.bindToolbar(state, zoomOutBtn, zoomInBtn, modeBtn, controller.signal);
      this.setupResizeObserver(state);
      syncPreviewControls(state);
      this.renderSection(props);
    }
    isSectionEnabled(tabType) {
      return Boolean(this.kernel.prefs.get("inspector.pdfPreview.enable") && (!tabType || tabType === "library" || tabType === "reader"));
    }
    bindToolbar(state, zoomOutBtn, zoomInBtn, modeBtn, signal) {
      const opts = { signal };
      state.prevBtn.addEventListener("click", () => jumpToPreviewPage(state, state.currentPage - 1, this.onRenderError), opts);
      state.nextBtn.addEventListener("click", () => jumpToPreviewPage(state, state.currentPage + 1, this.onRenderError), opts);
      zoomOutBtn.addEventListener("click", () => this.setZoom(state, state.zoom - ZOOM_STEP), opts);
      zoomInBtn.addEventListener("click", () => this.setZoom(state, state.zoom + ZOOM_STEP), opts);
      state.zoomLabel.addEventListener("click", () => this.setZoom(state, 1), opts);
      modeBtn.addEventListener("click", () => {
        const next = this.kernel.prefs.get("inspector.pdfPreview.mode") === "full" ? "section" : "full";
        this.kernel.prefs.set("inspector.pdfPreview.mode", next);
        state.fullActive = next === "full";
        applyPreviewLayoutMode(state.body, state.root, state.customSection, state.fullActive);
        invalidateVisibleSlots(state, this.onRenderError);
      }, opts);
      state.openBtn.addEventListener("click", () => state.attachment && void openPdfInReader(state.attachment, state.win, state.currentPage || 1), opts);
      state.attSelect.addEventListener("change", () => {
        const chosen = state.attachments.find((entry) => String(entry.id) === state.attSelect.value);
        if (chosen && chosen.attachment !== state.attachment) {
          void loadAttachmentPreviewDoc(state, chosen.attachment, this.isDblClickOpen, this.onRenderError);
        }
      }, opts);
      state.pageLabel.addEventListener("click", () => openPageJumpInput(state.doc, state.pageLabel, state.currentPage, state.numPages, (p) => jumpToPreviewPage(state, p, this.onRenderError)), opts);
      state.viewportEl.addEventListener("scroll", () => this.updateCurrentPageFromScroll(state), opts);
      state.viewportEl.addEventListener("dblclick", (event) => {
        if (!state.attachment || !this.isDblClickOpen()) return;
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
          jumpToPreviewPage(state, state.currentPage + 1, this.onRenderError);
        } else if (k === "PageUp" || k === "ArrowLeft") {
          event.preventDefault?.();
          jumpToPreviewPage(state, state.currentPage - 1, this.onRenderError);
        } else if (k === "Home" || k === "End") {
          event.preventDefault?.();
          jumpToPreviewPage(state, k === "Home" ? 1 : state.numPages, this.onRenderError);
        } else if ((event.ctrlKey || event.metaKey) && k === "0") {
          event.preventDefault?.();
          this.setZoom(state, 1);
        }
      }, opts);
      state.viewportEl.addEventListener("wheel", (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.setZoom(state, state.zoom + (e.deltaY < 0 ? 0.1 : -0.1));
        }
      }, opts);
    }
    setupResizeObserver(state) {
      const RO = state.win.ResizeObserver;
      if (!RO) return;
      state.resizeObserver = new RO(() => {
        const width = state.viewportEl.clientWidth || state.body.clientWidth || 0;
        if (!width || !state.pdfDoc || Math.abs(width - state.lastWidth) < 8) return;
        state.lastWidth = width;
        if (state.resizeTimer !== null) state.win.clearTimeout(state.resizeTimer);
        state.resizeTimer = state.win.setTimeout(() => {
          state.resizeTimer = null;
          invalidateVisibleSlots(state, this.onRenderError);
        }, 120);
      });
      state.resizeObserver.observe(state.viewportEl);
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
      applyPreviewLayoutMode(state.body, state.root, state.customSection, state.fullActive && this.kernel.prefs.get("inspector.pdfPreview.mode") === "full");
      const nextTabType = tabType || "library";
      const itemChanged = item !== state.item || nextTabType !== state.compare.tabType;
      state.compare.tabType = nextTabType;
      if (!itemChanged && item && (state.pdfDoc || state.loading)) return true;
      state.compare.mode = "sibling";
      state.compare.pickedAttachmentID = null;
      state.compare.currentAttachmentID = 0;
      syncCompareBar(state.compareUI, state.compare, [], 0);
      state.item = item ?? null;
      void loadItemPreviewAttachments(state, state.item, this.isDblClickOpen, this.onRenderError);
      return enabled;
    }
    setZoom(state, nextZoom) {
      const clamped = Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom)) * 100) / 100;
      if (clamped === state.zoom) return;
      state.zoom = clamped;
      syncPreviewControls(state);
      invalidateVisibleSlots(state, this.onRenderError);
    }
    updateCurrentPageFromScroll(state) {
      if (!state.slots.length) return;
      const top = state.viewportEl.scrollTop + (state.slots[0]?.card.offsetTop || 0);
      let best = 1;
      let bestDist = Infinity;
      for (const slot of state.slots) {
        const dist = Math.abs(slot.card.offsetTop - top);
        if (dist < bestDist) {
          bestDist = dist;
          best = slot.pageNumber;
        }
      }
      if (best !== state.currentPage) {
        state.currentPage = best;
        syncPreviewControls(state);
        evictDistantPageCanvases(state.slots, state.currentPage);
      }
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

  // src/domains/word-cite/citation-collections.ts
  var TEMP_COLLECTION_RELATION = "http://zotero.org/relations/temporary-citation-collection";
  var TEMP_COLLECTION_MARKER = "BridgeFlow";
  var WordCitationCollectionManager = class {
    sessionCollections = /* @__PURE__ */ new Map();
    syncQueue = Promise.resolve();
    kernel;
    constructor(kernel) {
      this.kernel = kernel;
    }
    getSessionIdByCollectionKey(collectionKey) {
      if (!collectionKey) return null;
      for (const [sid, col] of this.sessionCollections.entries()) {
        if (col?.key === collectionKey) return sid;
      }
      return null;
    }
    resolveSelectedCollectionSessionID(win) {
      const targetWin = win?.ZoteroPane ? win : globalThis.Zotero?.getMainWindow?.();
      const pane = targetWin?.ZoteroPane;
      const selected = pane?.getSelectedCollections?.() || pane?.collectionsView?.getSelectedCollections?.() || (pane?.getSelectedCollection?.() ? [pane.getSelectedCollection()] : []);
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
      for (const col of all) {
        if (!col || activeKeys.has(col.key)) continue;
        try {
          await col.loadDataType?.("relations");
          const rels = col.getRelationsByPredicate?.(TEMP_COLLECTION_RELATION) || [];
          if (rels.includes(TEMP_COLLECTION_MARKER)) {
            await col.eraseTx?.();
          }
        } catch (err) {
          this.kernel.logger.error("word-cite:purge-collection", err);
        }
      }
    }
    sync(sessions) {
      this.syncQueue = this.syncQueue.then(() => this.runSync(sessions)).catch((err) => this.kernel.logger.error("word-cite:collections", err));
    }
    async clearAll() {
      await this.syncQueue;
      for (const col of this.sessionCollections.values()) {
        try {
          await col?.eraseTx?.();
        } catch (err) {
          this.kernel.logger.error("word-cite:erase-collection", err);
        }
      }
      this.sessionCollections.clear();
    }
    async runSync(sessions) {
      const enabled = this.kernel.prefs.get("wordCite.collections.enable");
      const ZoteroObj = globalThis.Zotero;
      if (!ZoteroObj?.Collection || !ZoteroObj?.Libraries?.userLibraryID) return;
      if (!enabled) {
        for (const [sid, col] of this.sessionCollections) {
          try {
            await col?.eraseTx?.();
          } catch {
          }
          this.sessionCollections.delete(sid);
        }
        return;
      }
      const activeIDs = new Set(sessions.map((s) => s.sessionID));
      for (const [sid, col] of this.sessionCollections) {
        if (!activeIDs.has(sid)) {
          try {
            await col?.eraseTx?.();
          } catch {
          }
          this.sessionCollections.delete(sid);
        }
      }
      for (const ses of sessions) {
        let col = this.sessionCollections.get(ses.sessionID);
        const colName = `📝 ${ses.displayName}`;
        if (!col || col.deleted) {
          col = new ZoteroObj.Collection();
          col.libraryID = ZoteroObj.Libraries.userLibraryID;
          col.name = colName;
          try {
            col.addRelation?.(TEMP_COLLECTION_RELATION, TEMP_COLLECTION_MARKER);
          } catch {
          }
          await col.saveTx?.({ skipSelect: true });
          this.sessionCollections.set(ses.sessionID, col);
          this.refreshCollectionsView(ZoteroObj);
        } else if (col.name !== colName) {
          col.name = colName;
          await col.saveTx?.({ skipSelect: true });
          this.refreshCollectionsView(ZoteroObj);
        }
        const targetIDs = [...ses.itemCitations.keys()].filter((id) => Number.isSafeInteger(id) && id > 0);
        const existingRaw = col.getChildItems?.(true) || [];
        const existingIDs = existingRaw.map((x) => typeof x === "number" ? x : Number(x?.id || 0)).filter((id) => id > 0);
        const targetSet = new Set(targetIDs);
        const currentSet = new Set(existingIDs);
        const toRemove = existingIDs.filter((id) => !targetSet.has(id));
        const toAdd = targetIDs.filter((id) => !currentSet.has(id));
        if (!toRemove.length && !toAdd.length) continue;
        if (typeof ZoteroObj.DB?.executeTransaction === "function") {
          await ZoteroObj.DB.executeTransaction(async () => {
            if (toRemove.length) await col.removeItems?.(toRemove);
            if (toAdd.length) await col.addItems?.(toAdd);
          });
        } else {
          if (toRemove.length) await col.removeItems?.(toRemove);
          if (toAdd.length) await col.addItems?.(toAdd);
        }
      }
    }
    refreshCollectionsView(zoteroObj) {
      const wins = zoteroObj?.getMainWindows?.() || [];
      const activeKeys = new Set([...this.sessionCollections.values()].map((c) => c?.key).filter(Boolean));
      for (const win of wins) {
        try {
          const cv = win?.ZoteroPane?.collectionsView;
          cv?.refresh?.();
          this.repositionInCollectionsView(cv, activeKeys);
        } catch {
        }
      }
    }
    repositionInCollectionsView(cv, activeKeys) {
      const rows = cv?._rows;
      if (!Array.isArray(rows) || rows.length < 3 || !activeKeys.size) return;
      const isCitationRow = (r) => Boolean(r?.ref?.key && activeKeys.has(r.ref.key));
      const isBottomVirtual = (r) => {
        const t = r?.type;
        return t === "publications" || t === "duplicates" || t === "unfiled" || t === "retracted" || t === "trash" || Boolean(r?.isPublications?.() || r?.isDuplicates?.() || r?.isUnfiled?.() || r?.isTrash?.());
      };
      const regular = [];
      const citation = [];
      const bottom = [];
      let hitBottom = false;
      for (const row of rows) {
        if (isCitationRow(row)) citation.push(row);
        else if (hitBottom || isBottomVirtual(row)) {
          hitBottom = true;
          bottom.push(row);
        } else regular.push(row);
      }
      if (!citation.length) return;
      const reordered = [...regular, ...citation, ...bottom];
      if (reordered.length === rows.length && reordered.some((r, idx) => r !== rows[idx])) {
        rows.splice(0, rows.length, ...reordered);
        cv._refreshRowMap?.();
        cv.tree?.invalidate?.();
      }
    }
  };

  // src/domains/word-cite/citation-column.ts
  var CitationColumnController = class {
    columnID = false;
    kernel;
    tracker;
    collections;
    constructor(kernel, tracker, collections) {
      this.kernel = kernel;
      this.tracker = tracker;
      this.collections = collections;
    }
    register() {
      if (this.columnID) return;
      const manager = globalThis.Zotero?.ItemTreeManager;
      if (!manager?.registerColumn) return;
      this.columnID = manager.registerColumn({
        dataKey: "bridgeflowCitation",
        label: globalThis.Zotero?.locale?.startsWith?.("zh") ? "引用" : "Citation",
        enabledTreeIDs: ["main"],
        zoteroPersist: ["width", "hidden", "sortDirection"],
        pluginID: this.kernel.info.id,
        dataProvider: (item) => {
          const id = Number(item?.id || 0);
          if (!id) return "";
          const selectedSessionID = this.collections?.resolveSelectedCollectionSessionID();
          return this.tracker.getCitationDisplayForItem(id, selectedSessionID);
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

  // src/domains/word-cite/word-inserter.ts
  var insertInFlight = false;
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
    if (insertInFlight) return "busy";
    const { items } = deduplicateRegularItems(rawItems);
    const selectedIDs = [...new Set(items.map((item) => Number(item?.id || 0)).filter((id) => Number.isSafeInteger(id) && id > 0))];
    if (!selectedIDs.length) return "unavailable";
    const host2 = globalThis.Zotero;
    const integration = host2?.Integration;
    const origCite = integration?.Session?.prototype?.cite;
    if (typeof origCite !== "function" || typeof integration?.execCommand !== "function") {
      return "unavailable";
    }
    const isMac = host2?.isMac === true;
    if (!isMac && options.verifyCursor && !win32.verifyDroppedWordTarget()) {
      return "non-word";
    }
    insertInFlight = true;
    const origGetApp = integration.getApplication;
    let wrappedGetApp = null;
    const patchedApps = /* @__PURE__ */ new Map();
    const restoreApps = () => {
      for (const [app, origFn] of patchedApps) {
        try {
          app.getActiveDocument = origFn;
        } catch {
        }
      }
      patchedApps.clear();
    };
    if (!isMac && typeof origGetApp === "function") {
      wrappedGetApp = function(...args) {
        const app = Reflect.apply(origGetApp, this, args);
        if (args[0] === "WinWord" && typeof app?.getDocument === "function" && typeof app?.getActiveDocument === "function") {
          if (!patchedApps.has(app)) patchedApps.set(app, app.getActiveDocument);
          app.getActiveDocument = function() {
            return this.getDocument("");
          };
        }
        return app;
      };
      integration.getApplication = wrappedGetApp;
    }
    const patchedCite = async function(field) {
      if (typeof this._insertCitingResult !== "function" || typeof this.addCitation !== "function" || typeof integration.CitationEditInterface !== "function") {
        return Reflect.apply(origCite, this, arguments);
      }
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
        let fieldIndexPromise;
        let citationsByItemIDPromise;
        if (!this.data?.prefs?.delayCitationUpdates || !Object.keys(this.citationsByItemID || {}).length || this._sessionUpToDate) {
          fieldIndexPromise = this.getFields().then(async (fieldsList) => {
            for (let i = 0, n = fieldsList.length; i < n; i++) {
              if (await fieldsList[i].equals(activeField?._field)) {
                activeField = new integration.CitationField(fieldsList[i]);
                return i;
              }
            }
            return -1;
          });
          citationsByItemIDPromise = this.updateFromDocument(0).then(() => this.citationsByItemID);
        } else {
          fieldIndexPromise = Promise.resolve(-1);
          citationsByItemIDPromise = Promise.resolve(this.citationsByItemID);
        }
        const io = new integration.CitationEditInterface(
          citation,
          Boolean(this.style?.opt?.sort_citations),
          fieldIndexPromise,
          citationsByItemIDPromise
        );
        for (const id of selectedIDs) {
          if (!io.citation.citationItems.some((c) => Number(c.id) === id)) {
            io.citation.citationItems.push({ id });
          }
        }
        if (!io.citation.citationItems.length) {
          throw new host2.Exception.UserCancelled("inserting citation");
        }
        const [fieldIndex] = await Promise.all([fieldIndexPromise, citationsByItemIDPromise]);
        const citations = await this._insertCitingResult(fieldIndex, activeField, io.citation);
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
        committed = true;
        try {
          options.onCommitted?.();
        } catch {
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
    integration.Session.prototype.cite = patchedCite;
    try {
      if (isMac) {
        await integration.execCommand("MacWord16", "addEditCitation", "/Applications/Microsoft Word.app/", 2);
      } else {
        if (options.verifyCursor && !win32.verifyDroppedWordTarget()) {
          return "non-word";
        }
        await integration.execCommand("WinWord", "addEditCitation", null, 1);
      }
      return "inserted";
    } catch (err) {
      const name = String(err?.name || "");
      if (name.includes("UserCancelled")) return "cancelled";
      kernel.logger.error("word-cite:insert", err);
      return "unavailable";
    } finally {
      win32.clearLastDroppedWordTarget();
      restoreApps();
      if (wrappedGetApp && integration.getApplication === wrappedGetApp) {
        integration.getApplication = origGetApp;
      }
      if (integration.Session.prototype.cite === patchedCite) {
        integration.Session.prototype.cite = origCite;
      }
      insertInFlight = false;
    }
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
      const disposers = [];
      const itemsView = win.ZoteroPane?.itemsView;
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
        const doc2 = win.document;
        if (doc2?.addEventListener) {
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
          doc2.addEventListener("dragend", onDragEnd, true);
          disposers.push(() => doc2.removeEventListener("dragend", onDragEnd, true));
        }
      }
      const doc = win.document;
      const itemMenu = doc?.getElementById?.("zotero-itemmenu");
      if (doc && itemMenu) {
        const mi = doc.createXULElement ? doc.createXULElement("menuitem") : doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "menuitem");
        mi.id = "zbf-item-insert-word-cite";
        mi.setAttribute("label", "BridgeFlow：插入引文到 Word 当前光标");
        const onShowing = () => {
          const selected = win.ZoteroPane?.getSelectedItems?.() || [];
          const valid = deduplicateRegularItems(selected).items;
          mi.hidden = !this.kernel.prefs.get("wordCite.dragCite.enable");
          if (!valid.length) mi.setAttribute("disabled", "true");
          else mi.removeAttribute("disabled");
        };
        const onCommand = () => {
          const selected = win.ZoteroPane?.getSelectedItems?.() || [];
          void this.insertItems(selected);
        };
        itemMenu.addEventListener("popupshowing", onShowing);
        mi.addEventListener("command", onCommand);
        itemMenu.appendChild(mi);
        disposers.push(() => {
          itemMenu.removeEventListener("popupshowing", onShowing);
          mi.removeEventListener("command", onCommand);
          mi.remove();
        });
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
    async insertItems(items) {
      if (!this.kernel.prefs.get("wordCite.dragCite.enable")) return "unavailable";
      const result = await insertItemsIntoWord(this.kernel, this.win32, items, {
        verifyCursor: false,
        onCommitted: this.onInserted
      });
      if (result === "unavailable") {
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
  var MANAGED_TAG_IDS_PREF = "extensions.zotero.bridgeflow.wordCite.managedTagItemIDs";
  var CitationTagGovernance = class {
    managedItemIDs = /* @__PURE__ */ new Set();
    activeTagText;
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
        this.savePersistedIDs();
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
      this.savePersistedIDs();
      return { added, removed };
    }
  };

  // src/domains/word-cite/word-poller.ts
  var VALID_INDEX_KEY_RE = /^(?:0|[1-9]\d*)$/;
  var WordIntegrationPoller = class {
    timer = null;
    viewRefreshTimer = null;
    unpatchExec = null;
    running = false;
    polling = false;
    execDepth = 0;
    idleRounds = 0;
    emptyStreakBySession = /* @__PURE__ */ new Map();
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
      this.unpatchExec?.();
      this.unpatchExec = null;
      this.emptyStreakBySession.clear();
    }
    async pollOnce() {
      if (this.polling || this.execDepth > 0) return false;
      const integration = globalThis.Zotero?.Integration;
      const sessionsMap = integration?.sessions;
      if (!sessionsMap) return false;
      this.polling = true;
      try {
        const entries = sessionsMap instanceof Map ? [...sessionsMap.entries()] : Object.entries(sessionsMap);
        const activeIDs = /* @__PURE__ */ new Set();
        const rawSessions = [];
        for (const [sessionID, session] of entries) {
          if (!session) continue;
          const agent = String(session.agent || "WinWord");
          if (!/(WinWord|MacWord|Word)/i.test(agent)) continue;
          activeIDs.add(String(sessionID));
          if ((!session.citationsByIndex || !session.citationsByItemID) && typeof session.updateFromDocument === "function") {
            try {
              await session.updateFromDocument(0);
            } catch {
            }
          }
          const parsed = this.extractSessionCitations(session);
          const prevTracked = this.tracker.getAllSessions().find((s) => s.sessionID === String(sessionID));
          if (!parsed.length && prevTracked && prevTracked.itemCitations.size > 0) {
            const streak = (this.emptyStreakBySession.get(sessionID) ?? 0) + 1;
            this.emptyStreakBySession.set(sessionID, streak);
            if (streak < 2) {
              rawSessions.push({
                sessionID: String(sessionID),
                documentPath: prevTracked.documentPath,
                citations: [...prevTracked.itemCitations.entries()].map(([itemID, info]) => ({
                  itemID,
                  ordinal: info.ordinal,
                  shortText: info.shortText
                }))
              });
              continue;
            }
          } else if (parsed.length > 0) {
            this.emptyStreakBySession.delete(sessionID);
          }
          const docPath = String(
            session.doc?.filePath || session.filePath || session.documentPath || session.doc?._docId || session.name || sessionID
          );
          rawSessions.push({ sessionID: String(sessionID), documentPath: docPath, citations: parsed });
        }
        for (const key of this.emptyStreakBySession.keys()) {
          if (!activeIDs.has(key)) this.emptyStreakBySession.delete(key);
        }
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
    extractSessionCitations(session) {
      const hostItems = globalThis.Zotero?.Items;
      const ordinalMap = /* @__PURE__ */ new Map();
      const recordHit = (itemID, ordinal, shortText) => {
        if (!Number.isSafeInteger(itemID) || itemID <= 0) return;
        const zotItem = hostItems?.get?.(itemID);
        if (zotItem && (zotItem.deleted === true || zotItem.inTrash?.() === true)) return;
        const existing = ordinalMap.get(itemID);
        if (!existing) {
          ordinalMap.set(itemID, { ordinal, ordinals: [ordinal], shortText });
        } else {
          if (!existing.ordinals.includes(ordinal)) existing.ordinals.push(ordinal);
          if (!existing.shortText && shortText) existing.shortText = shortText;
        }
      };
      const byIndex = session.citationsByIndex;
      if (byIndex && typeof byIndex === "object") {
        const sortedKeys = Object.keys(byIndex).filter((k) => VALID_INDEX_KEY_RE.test(k)).sort((a, b) => Number(a) - Number(b));
        for (let idx = 0; idx < sortedKeys.length; idx++) {
          const cit = byIndex[sortedKeys[idx]];
          const cItems = Array.isArray(cit?.citationItems) ? cit.citationItems : [];
          const rawOrdinal = Number(cit?.citationIndex ?? cit?.index ?? Number(sortedKeys[idx]) + 1);
          const ordinal = rawOrdinal > 0 ? rawOrdinal : idx + 1;
          const shortText = String(cit?.properties?.plainCitation || cit?.properties?.formattedCitation || cit?.text || "").trim();
          for (const ci of cItems) {
            recordHit(Number(ci?.id || ci?.itemID || 0), ordinal, shortText);
          }
        }
      }
      const byItem = session.citationsByItemID;
      if (byItem && typeof byItem === "object") {
        for (const [rawID, list] of Object.entries(byItem)) {
          const itemID = Number(rawID);
          if (ordinalMap.has(itemID)) continue;
          const entries = Array.isArray(list) ? list : [list];
          for (const entry of entries) {
            if (!entry) continue;
            const ordinal = Number(entry.citationIndex ?? entry.index ?? 1);
            const shortText = String(entry.properties?.plainCitation || entry.properties?.formattedCitation || entry.text || "").trim();
            recordHit(itemID, ordinal > 0 ? ordinal : 1, shortText);
          }
        }
      }
      return [...ordinalMap.entries()].map(([itemID, info]) => {
        const extraRefs = info.ordinals.length > 1 ? ` (${info.ordinals.join(",")})` : "";
        const cleanShort = info.shortText || "";
        return {
          itemID,
          ordinal: info.ordinal,
          shortText: cleanShort ? `${cleanShort}${extraRefs}` : extraRefs.trim()
        };
      });
    }
    scheduleItemsViewRefresh() {
      if (this.viewRefreshTimer !== null) return;
      const delay = this.kernel.prefs.get("wordCite.itemsViewRefreshDebounceMs");
      this.viewRefreshTimer = setTimeout(() => {
        this.viewRefreshTimer = null;
        const wins = globalThis.Zotero?.getMainWindows?.() || [];
        for (const win of wins) {
          try {
            win.ZoteroPane?.itemsView?.refresh?.();
          } catch {
          }
        }
      }, Math.max(20, delay));
    }
    installHooks() {
      const integration = globalThis.Zotero?.Integration;
      if (!integration || typeof integration.execCommand !== "function" || this.unpatchExec) return;
      this.unpatchExec = this.kernel.runtime.patch(
        integration,
        "execCommand",
        "Zotero.Integration",
        (orig) => async (...args) => {
          this.execDepth++;
          try {
            return await Promise.resolve(orig.apply(integration, args));
          } finally {
            this.execDepth = Math.max(0, this.execDepth - 1);
            this.idleRounds = 0;
            setTimeout(() => {
              if (this.running) void this.pollOnce();
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
      this.poller = new WordIntegrationPoller(kernel, this.tracker);
      this.dragCite = new DragCiteController(kernel, services.win32, () => {
        this.poller.pollOnce();
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
    start() {
      if (this.active) return;
      this.active = true;
      this.disposables.reset();
      void this.collections.purgeStaleCollections();
      this.column.register();
      this.poller.start();
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

  // src/domains/workspace/spotlight-library.ts
  var SpotlightLibraryIndex = class {
    entries = [];
    loaded = false;
    loading = null;
    tabs;
    constructor(tabs) {
      this.tabs = tabs;
    }
    warmUp(win) {
      if (this.loaded || this.loading) return;
      this.loading = this.build(win).finally(() => {
        this.loading = null;
      });
    }
    invalidate() {
      this.loaded = false;
    }
    query(needle, win, openItemIDs, limit = 15, minLen = 2) {
      if (!needle || needle.length < minLen) return [];
      if (!this.loaded && !this.loading) this.warmUp(win);
      const out = [];
      for (const item of this.entries) {
        if (openItemIDs.has(item.id)) continue;
        if (!item.searchText.includes(needle)) continue;
        out.push({
          id: `lib:${item.key}`,
          category: "tab",
          title: item.title,
          subtitle: item.hint || "文库文献（点击在阅读器中打开）",
          badge: "文库",
          action: async () => {
            await this.tabs.openVirtualOrItem(win, item.id);
          }
        });
        if (out.length >= limit) break;
      }
      return out;
    }
    async build(win) {
      const ZoteroObj = globalThis.Zotero;
      const itemsApi = ZoteroObj?.Items;
      if (typeof itemsApi?.getAll !== "function") return;
      const libsApi = ZoteroObj?.Libraries;
      const libs = libsApi?.getAll?.();
      const libIDs = Array.isArray(libs) ? [...new Set(libs.map((l) => Number(l?.libraryID || 0)).filter((id) => id > 0))] : [Number(libsApi?.userLibraryID || 1)];
      const next = [];
      for (const libraryID of libIDs) {
        try {
          const items = await itemsApi.getAll(libraryID, true, false, false);
          if (!Array.isArray(items)) continue;
          const libName = String(libsApi?.getName?.(libraryID) || "");
          for (let i = 0; i < items.length; i++) {
            if (i > 0 && i % 250 === 0 && win?.setTimeout) {
              await new Promise((r) => win.setTimeout(r, 0));
            }
            const item = items[i];
            if (!item?.isRegularItem?.() || item.deleted) continue;
            const rawTitle = String(item.getField?.("title") || item.key || "");
            const title = rawTitle.replace(/<[^>]+>/g, "").trim();
            if (!title) continue;
            const author = String(item.firstCreator || "");
            const year = String(item.getField?.("year") || item.getField?.("date") || "").slice(0, 4);
            const pub = String(item.getField?.("publicationTitle") || item.getField?.("proceedingsTitle") || "");
            next.push({
              id: Number(item.id),
              key: `${libraryID}:${item.key}`,
              title,
              hint: [libName, author, year, pub].filter(Boolean).join(" · "),
              searchText: `${title} ${author} ${year} ${pub} ${libName}`.toLowerCase()
            });
          }
        } catch {
        }
      }
      this.entries = next;
      this.loaded = true;
    }
  };

  // src/domains/workspace/spotlight-engine.ts
  var WorkspaceSpotlightEngine = class {
    providers = /* @__PURE__ */ new Set();
    prefs;
    store;
    tabs;
    libraryIndex;
    wordCitedBadges = /* @__PURE__ */ new Map();
    constructor(prefs, store, tabs) {
      this.prefs = prefs;
      this.store = store;
      this.tabs = tabs;
      this.libraryIndex = new SpotlightLibraryIndex(tabs);
    }
    invalidateLibraryIndex() {
      this.libraryIndex.invalidate();
    }
    setWordCitationBadges(badges) {
      this.wordCitedBadges = new Map(badges);
    }
    registerProvider(provider) {
      this.providers.add(provider);
      return () => {
        this.providers.delete(provider);
      };
    }
    query(rawTerm, win) {
      const trimmed = rawTerm.trim();
      const isCommand = trimmed.startsWith(">");
      const isLibrary = trimmed.startsWith("@");
      const needle = (isCommand || isLibrary ? trimmed.slice(1) : trimmed).trim().toLowerCase();
      const scored = [];
      const tracked = this.tabs.buildTrackedTabs(win);
      if (isCommand) {
        if (needle === "tabs" || needle === "recent") {
          const sorted = [...tracked].sort((a, b) => (b.lastViewedAt || 0) - (a.lastViewedAt || 0));
          for (const tab of sorted) {
            const groupName = this.store.state.groups.find((g) => g.id === tab.groupId)?.name;
            scored.push({
              score: 100,
              item: {
                id: `recent:${tab.key}`,
                category: "tab",
                title: this.tabs.getDisplayTitle(tab),
                subtitle: [groupName, tab.creatorYear].filter(Boolean).join(" · "),
                badge: tab.virtual ? "虚拟" : tab.sleeping ? "休眠" : "最近",
                action: () => {
                  if (tab.virtual) void this.tabs.openVirtualOrItem(win, tab.itemID, tab.groupId);
                  else this.tabs.selectTab(win, tab.tabID);
                }
              }
            });
          }
        }
        for (const cmd of this.buildBuiltInCommands(win)) {
          if (!needle || needle === "tabs" || `${cmd.title} ${cmd.subtitle || ""}`.toLowerCase().includes(needle)) {
            scored.push({ score: 90, item: cmd });
          }
        }
      }
      for (const provider of [...this.providers].sort((a, b) => b.priority - a.priority)) {
        try {
          for (const item of provider.query(needle, win)) {
            scored.push({ score: 80 + (provider.priority || 0) * 0.1, item });
          }
        } catch {
        }
      }
      if (isLibrary) {
        const openIDs = /* @__PURE__ */ new Set();
        for (const libItem of this.libraryIndex.query(needle, win, openIDs, 20, 1)) {
          scored.push({ score: 95, item: libItem });
        }
      } else if (!isCommand) {
        for (const group of this.store.state.groups) {
          if (!needle || group.name.toLowerCase().includes(needle)) {
            const firstOpen = tracked.find((t) => t.groupId === group.id && !t.virtual);
            scored.push({
              score: needle ? 85 : 58,
              item: {
                id: `group:${group.id}`,
                category: "collection",
                title: `分组：${group.name}`,
                subtitle: `${group.memberKeys.length} 个成员${firstOpen ? " · 点击定位首篇文献" : ""}`,
                badge: "分组",
                action: () => {
                  this.store.setCollapsed(group.id, false);
                  if (firstOpen) this.tabs.selectTab(win, firstOpen.tabID);
                }
              }
            });
          }
        }
        for (const tab of tracked) {
          const groupName = this.store.state.groups.find((g) => g.id === tab.groupId)?.name || "";
          const displayTitle = this.tabs.getDisplayTitle(tab);
          const hay = `${displayTitle} ${tab.title} ${tab.shortTitle} ${tab.creatorYear} ${tab.source} ${tab.collection} ${tab.remark} ${groupName}`.toLowerCase();
          if (needle && !hay.includes(needle)) continue;
          const citeInfo = this.wordCitedBadges.get(tab.parentItemID) || this.wordCitedBadges.get(tab.itemID);
          const tags = [];
          if (groupName) tags.push(groupName);
          if (tab.pinned) tags.push("已固定");
          if (tab.sleeping) tags.push("已休眠");
          if (tab.virtual) tags.push("虚拟");
          if (citeInfo) tags.push(`Word [${citeInfo.ordinal}]`);
          scored.push({
            score: displayTitle.toLowerCase().startsWith(needle) ? 95 : 75,
            item: {
              id: `tab:${tab.key}`,
              category: "tab",
              title: displayTitle,
              subtitle: [tab.creatorYear, tab.collection].filter(Boolean).join(" · ") || "已打开阅读标签页",
              badge: tags.join(" · ") || void 0,
              action: () => {
                if (tab.virtual) void this.tabs.openVirtualOrItem(win, tab.itemID, tab.groupId);
                else this.tabs.selectTab(win, tab.tabID);
              }
            }
          });
        }
        for (const closed of this.tabs.getRecentlyClosed(win)) {
          if (needle && !closed.title.toLowerCase().includes(needle)) continue;
          scored.push({
            score: 62,
            item: {
              id: `closed:${closed.key}`,
              category: "tab",
              title: closed.title,
              subtitle: "重新打开最近关闭的文献标签页",
              badge: "最近关闭",
              action: () => {
                void this.tabs.openVirtualOrItem(win, closed.itemID, closed.groupId || void 0);
              }
            }
          });
        }
        if (this.prefs.get("workspace.enableSessions")) {
          for (const ses of this.store.state.sessions.slice(0, 6)) {
            if (needle && !ses.name.toLowerCase().includes(needle)) continue;
            scored.push({
              score: 52,
              item: {
                id: `session:${ses.id}`,
                category: "collection",
                title: `工作区：${ses.name}`,
                subtitle: `${ses.groups.length} 个分组 · 点击合并恢复此工作区`,
                badge: ses.isTemplate ? "模板" : "会话",
                action: () => {
                  void this.tabs.restoreSession(win, ses, true);
                }
              }
            });
          }
        }
        if (needle.length >= 2) {
          const openIDs = /* @__PURE__ */ new Set();
          for (const t of tracked) {
            if (t.itemID > 0) openIDs.add(t.itemID);
            if (t.parentItemID > 0) openIDs.add(t.parentItemID);
          }
          for (const libItem of this.libraryIndex.query(needle, win, openIDs, 15, 2)) {
            scored.push({ score: 45, item: libItem });
          }
        }
      }
      return scored.sort((a, b) => b.score - a.score).slice(0, 40).map((s) => s.item);
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
            this.store.saveSession(`快照 ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`);
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
        }
      ];
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
      remarkModes: {},
      lastViewedAt: {},
      readingProgress: {},
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
          remarkModes: parsed?.remarkModes && typeof parsed.remarkModes === "object" ? parsed.remarkModes : {},
          lastViewedAt: parsed?.lastViewedAt && typeof parsed.lastViewedAt === "object" ? parsed.lastViewedAt : {},
          readingProgress: parsed?.readingProgress && typeof parsed.readingProgress === "object" ? parsed.readingProgress : {},
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
      const trimmed = name.trim() || "新分组";
      const id = `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const chosen = color || GROUP_PALETTE[this.state.groups.length % GROUP_PALETTE.length];
      const group = { id, name: trimmed, color: chosen, memberKeys: [] };
      this.state.groups.push(group);
      this.save();
      return group;
    }
    assignKeyRelative(key, groupId, anchorKey, after) {
      for (const g of this.state.groups) {
        g.memberKeys = g.memberKeys.filter((k) => k !== key);
      }
      if (groupId) {
        const target = this.state.groups.find((g) => g.id === groupId);
        if (target) {
          const idx = target.memberKeys.indexOf(anchorKey);
          if (idx >= 0) {
            target.memberKeys.splice(after ? idx + 1 : idx, 0, key);
          } else {
            target.memberKeys.push(key);
          }
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
    restoreSessionLayout(session, merge = false) {
      if (!merge) {
        if (this.state.groups.length || this.state.pinnedKeys.length) {
          this.saveSession(`恢复前备份 · ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`, { kind: "pre-replace", rolling: true });
        }
        this.state.groups = session.groups.map((g) => ({ ...g, memberKeys: [...g.memberKeys] }));
        this.state.pinnedKeys = [...session.pinnedKeys];
        this.state.remarks = { ...this.state.remarks, ...session.remarks };
        this.save();
        return;
      }
      for (const sg of session.groups) {
        let existing = this.state.groups.find((g) => g.id === sg.id || g.name === sg.name);
        if (!existing) {
          existing = { id: sg.id, name: sg.name, color: sg.color, memberKeys: [] };
          this.state.groups.push(existing);
        }
        for (const key of sg.memberKeys) {
          if (!existing.memberKeys.includes(key)) existing.memberKeys.push(key);
        }
      }
      const pins = /* @__PURE__ */ new Set([...this.state.pinnedKeys, ...session.pinnedKeys]);
      this.state.pinnedKeys = [...pins];
      this.state.remarks = { ...this.state.remarks, ...session.remarks };
      this.save();
    }
    collapseOtherGroups(activeGroupId) {
      this.state.collapsed = this.state.groups.filter((g) => g.id !== activeGroupId).map((g) => g.id);
      this.save();
    }
    setRemarkMode(key, mode) {
      if (mode) this.state.remarkModes[key] = mode;
      else delete this.state.remarkModes[key];
      this.save();
    }
    updateSession(sessionId) {
      const ses = this.state.sessions.find((s) => s.id === sessionId);
      if (!ses) return false;
      ses.createdAt = Date.now();
      ses.groups = this.state.groups.map((g) => ({ ...g, memberKeys: ses.isTemplate ? [] : [...g.memberKeys] }));
      ses.pinnedKeys = ses.isTemplate ? [] : [...this.state.pinnedKeys];
      ses.remarks = ses.isTemplate ? {} : { ...this.state.remarks };
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
    updateReadingProgress(key, deltaSeconds, lastPage, totalPages) {
      const prev = this.state.readingProgress[key] ?? { readSeconds: 0 };
      const next = {
        readSeconds: Math.max(0, (prev.readSeconds || 0) + Math.max(0, deltaSeconds)),
        ...lastPage && lastPage > 0 ? { lastPage } : prev.lastPage ? { lastPage: prev.lastPage } : {},
        ...totalPages && totalPages > 0 ? { totalPages } : prev.totalPages ? { totalPages: prev.totalPages } : {}
      };
      this.state.readingProgress[key] = next;
      return next;
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
        kind: options.kind ?? (options.isTemplate ? "template" : options.rolling ? "rolling" : "manual"),
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
      const item = itemID > 0 ? hostItems?.get?.(itemID) : null;
      if (!item || item.deleted) return false;
      const isNote = item.isNote?.() === true;
      const target = isNote || item.isAttachment?.() ? item : await item.getBestAttachment?.();
      if (!target || target.deleted) return false;
      const key = `item:${target.id}`;
      const altKey = `item:${item.id}`;
      const nativeTabs = Array.isArray(win.Zotero_Tabs?._tabs) ? win.Zotero_Tabs._tabs : [];
      const existing = nativeTabs.find((t) => Number(t?.data?.itemID || 0) === target.id);
      if (existing) {
        if (!openInBackground) win.Zotero_Tabs?.select?.(existing.id);
      } else if (isNote) {
        await globalThis.Zotero?.Notes?.open?.(target.id, void 0, { openInBackground });
      } else {
        if (target.isFileAttachment?.() && typeof target.fileExists === "function" && !await target.fileExists()) {
          return false;
        }
        await globalThis.Zotero?.Reader?.open?.(target.id, void 0, { openInBackground });
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
    const text = [dur, pageText].filter(Boolean).join(" · ");
    const ratio = page > 0 && total > 0 ? Math.max(0, Math.min(1, page / total)) : null;
    return { text, ratio };
  }
  function trackActiveReaderProgress(win, store, tracked, elapsedSeconds) {
    const doc = win.document;
    if (typeof doc?.hasFocus === "function" && !doc.hasFocus()) return false;
    const selectedID = String(win.Zotero_Tabs?.selectedID || "");
    if (!selectedID || selectedID === "zotero-pane") return false;
    const current = tracked.find((t) => !t.virtual && t.tabID === selectedID);
    if (!current || current.key.startsWith("tab:") || !current.type.startsWith("reader")) return false;
    const prevText = formatReadingProgress(store.state.readingProgress[current.key]).text;
    const reader = globalThis.Zotero?.Reader?.getByTabID?.(selectedID);
    const pdfApp = reader?._iframeWindow?.PDFViewerApplication;
    const page = Number(pdfApp?.page || (reader?.state?.pageIndex != null ? Number(reader.state.pageIndex) + 1 : 0)) || 0;
    const total = Number(pdfApp?.pagesCount || reader?._internalReader?._pdfDocument?.numPages || reader?.pagesCount || 0) || 0;
    store.touchViewed(current.key);
    const next = store.updateReadingProgress(current.key, elapsedSeconds, page, total);
    return formatReadingProgress(next).text !== prevText;
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
  function formatCreatorYear2(item) {
    return formatCreatorYear(item);
  }
  function resolvePrimaryCollectionName2(item) {
    return resolvePrimaryCollectionName(item);
  }
  function autoGroupTrackedByCollection(win, store, strategy, tracked) {
    const pane = win.ZoteroPane;
    const activeCol = pane?.getSelectedCollections?.()?.[0] || pane?.getSelectedCollection?.();
    const activeColName = String(activeCol?.name || "");
    const hostItems = globalThis.Zotero?.Items;
    const hostCols = globalThis.Zotero?.Collections;
    let grouped = 0;
    for (const tab of tracked) {
      if (tab.virtual || tab.groupId) continue;
      const item = hostItems?.get?.(tab.parentItemID || tab.itemID);
      const colIDs = item?.getCollections?.() || [];
      const colNames = colIDs.map((id) => String(hostCols?.get?.(id)?.name || "")).filter(Boolean);
      if (!colNames.length) continue;
      let chosen = "";
      if (strategy === "active" && activeColName && colNames.includes(activeColName)) chosen = activeColName;
      else if (strategy === "existing") chosen = colNames.find((n) => store.state.groups.some((g) => g.name === n)) || colNames[0];
      else chosen = colNames[0];
      if (!chosen) continue;
      const group = store.state.groups.find((g) => g.name === chosen) ?? store.createGroup(chosen);
      store.assignToGroup(tab.key, group.id);
      grouped++;
    }
    return grouped;
  }
  async function restoreSessionTabsAndLayout(win, store, session, openLimit = 10) {
    const keysToOpen = [];
    const seen = /* @__PURE__ */ new Set();
    for (const g of session.groups) {
      for (const k of g.memberKeys) {
        if (!seen.has(k)) {
          seen.add(k);
          keysToOpen.push({ key: k, groupId: g.id });
        }
      }
    }
    for (const k of session.pinnedKeys) {
      if (!seen.has(k)) {
        seen.add(k);
        keysToOpen.push({ key: k });
      }
    }
    let opened = 0;
    for (const entry of keysToOpen) {
      if (opened >= openLimit) break;
      const match = /^item:(\d+)$/.exec(entry.key);
      if (match) {
        const id = Number(match[1]);
        if (await openItemAttachmentOrNote(win, store, id, entry.groupId, true)) opened++;
      }
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
    const reader = globalThis.Zotero?.Reader;
    const targetAttachmentID = req.attachmentID || req.itemID;
    if (typeof reader?.open === "function" && targetAttachmentID > 0) {
      await reader.open(targetAttachmentID);
      store.removeVirtualMember(`item:${targetAttachmentID}`);
      store.removeVirtualMember(`item:${req.itemID}`);
      if (req.assignToActiveGroup) {
        const selectedID = String(win.Zotero_Tabs?.selectedID || "");
        const activeTab = tracked.find((t) => t.tabID === selectedID);
        if (activeTab?.groupId) store.assignToGroup(`item:${targetAttachmentID}`, activeTab.groupId);
      }
      return "opened";
    }
    return "not-found";
  }

  // src/domains/workspace/tab-controller.ts
  var WorkspaceTabController = class {
    prefs;
    store;
    clipboard;
    closedStack = [];
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
        const creatorYear = formatCreatorYear2(displayItem);
        const collection = resolvePrimaryCollectionName2(displayItem);
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
          sleeping: this.store.isSleeping(key) || String(tab.type || "").endsWith("-unloaded"),
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
          this.store.saveVirtualMember(buildVirtualMetaFromTracked(t));
        }
        if (t.itemID > 0) {
          this.closedStack.push({ key: t.key, itemID: t.itemID, groupId: t.groupId, title: t.title, closedAt: Date.now() });
          if (this.closedStack.length > 20) this.closedStack.shift();
        }
        toClose.push(id);
      }
      if (!toClose.length) return 0;
      tabsApi.close(toClose.length === 1 ? toClose[0] : toClose);
      return toClose.length;
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
      const last = this.closedStack.pop();
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
      if (typeof tabsApi?.unload === "function") {
        tabsApi.unload(tabID);
      }
      this.store.setSleeping(tracked.key, true);
      return true;
    }
    sleepInactiveTabs(win) {
      if (!this.prefs.get("workspace.enableTabSleep")) return 0;
      const selectedID = String(win.Zotero_Tabs?.selectedID || "");
      let count = 0;
      for (const tab of this.buildTrackedTabs(win)) {
        if (!tab.virtual && !tab.pinned && !tab.sleeping && tab.tabID !== selectedID) {
          if (this.sleepTab(win, tab.tabID)) count++;
        }
      }
      return count;
    }
    sleepIdleTabs(win, now = Date.now()) {
      const minutes = this.prefs.get("workspace.autoSleepMinutes");
      if (!this.prefs.get("workspace.enableTabSleep") || minutes <= 0) return 0;
      const selectedID = String(win.Zotero_Tabs?.selectedID || "");
      const cutoff = now - minutes * 6e4;
      let count = 0;
      for (const tab of this.buildTrackedTabs(win)) {
        if (tab.virtual || tab.pinned || tab.sleeping || tab.tabID === selectedID) continue;
        if (tab.lastViewedAt > 0 && tab.lastViewedAt < cutoff) {
          if (this.sleepTab(win, tab.tabID)) count++;
        }
      }
      return count;
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
    async restoreSession(win, session, merge = true) {
      this.store.restoreSessionLayout(session, merge);
      return restoreSessionTabsAndLayout(win, this.store, session);
    }
    getRecentlyClosed(win) {
      const openKeys = new Set(this.buildTrackedTabs(win).filter((t) => !t.virtual).map((t) => t.key));
      return collectRecentlyClosed(win, this.closedStack, openKeys);
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
      const group = this.store.state.groups.find((g) => g.id === groupId);
      if (!group) return 0;
      const ids = this.buildTrackedTabs(win).filter((t) => t.groupId === groupId && t.tabID).map((t) => t.tabID);
      this.store.saveSession(group.name);
      return this.closeTabs(win, ids, { preserveVirtual: true, protectPinned: true });
    }
    autoGroupByCollection(win) {
      return autoGroupTrackedByCollection(
        win,
        this.store,
        this.prefs.get("workspace.multiCollectionStrategy"),
        this.buildTrackedTabs(win)
      );
    }
    collectionToGroup(win, collectionName) {
      const targetCols = this.buildTrackedTabs(win).filter((t) => (t.collection || "未分类") === collectionName);
      if (!targetCols.length) return 0;
      const group = this.store.state.groups.find((g) => g.name === collectionName) ?? this.store.createGroup(collectionName);
      for (const tab of targetCols) {
        this.store.assignToGroup(tab.key, group.id);
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
      const group = this.store.state.groups.find((g) => g.name === groupName) ?? this.store.createGroup(groupName);
      for (const tab of matching) this.store.assignToGroup(tab.key, group.id);
      return { groupId: group.id, count: matching.length };
    }
    findStaleTabs(win, now = Date.now()) {
      const days = this.prefs.get("workspace.staleSuggestDays");
      const cutoff = now - days * 864e5;
      return this.buildTrackedTabs(win).filter(
        (t) => !t.virtual && !t.pinned && t.lastViewedAt > 0 && t.lastViewedAt < cutoff
      );
    }
    trackReadingProgress(win, elapsedSeconds) {
      return trackActiveReaderProgress(win, this.store, this.buildTrackedTabs(win), elapsedSeconds);
    }
  };

  // src/domains/workspace/popup-menu-helpers.ts
  function createFloatingPopup(doc, anchor, event, minWidth = 210) {
    const host2 = doc.documentElement || doc.body;
    if (!host2) return null;
    const pop = doc.createElement("div");
    pop.className = "zbf-popup-menu";
    pop.style.minWidth = `${minWidth}px`;
    host2.appendChild(pop);
    const rect = anchor.getBoundingClientRect();
    const rawX = event?.clientX && event.clientX > 0 ? event.clientX : rect.left;
    const rawY = event?.clientY && event.clientY > 0 ? event.clientY : rect.bottom + 4;
    const winW = doc.defaultView?.innerWidth || 1200;
    const winH = doc.defaultView?.innerHeight || 800;
    const popW = pop.offsetWidth || minWidth;
    const left = Math.max(8, Math.min(rawX, winW - popW - 12));
    const top = Math.max(8, Math.min(rawY, winH - 280));
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    return pop;
  }
  function addPopupButton(doc, pop, label, onClick, closePopup, options = {}) {
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = `zbf-popup-item${options.danger ? " danger" : ""}`;
    btn.textContent = label;
    if (options.disabled) btn.disabled = true;
    btn.addEventListener("click", () => {
      closePopup();
      onClick();
    });
    pop.appendChild(btn);
    return btn;
  }
  function addPopupSeparator(doc, pop) {
    const sep = doc.createElement("div");
    sep.className = "zbf-popup-sep";
    pop.appendChild(sep);
  }
  function openTextPromptModal(win, title, placeholder, initialValue, onConfirm) {
    const doc = win.document;
    const host2 = doc.documentElement || doc.body;
    if (!host2) return;
    const backdrop = doc.createElement("div");
    backdrop.id = "zbf-hub-backdrop";
    backdrop.style.zIndex = "100020";
    const modal = doc.createElement("div");
    modal.className = "zbf-hub-box";
    modal.style.maxWidth = "420px";
    const head = doc.createElement("div");
    head.className = "zbf-hub-head";
    const h3 = doc.createElement("div");
    h3.className = "zbf-hub-title";
    h3.textContent = title;
    const closeBtn = doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "zbf-hub-close";
    closeBtn.textContent = "✕";
    const input = doc.createElement("input");
    input.type = "text";
    input.className = "zbf-hub-input";
    input.placeholder = placeholder;
    input.value = initialValue;
    const actions = doc.createElement("div");
    actions.className = "zbf-hub-actions";
    actions.style.justifyContent = "flex-end";
    const cancelBtn = doc.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "zbf-hub-btn";
    cancelBtn.textContent = "取消";
    const okBtn = doc.createElement("button");
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

  // src/domains/workspace/workspace-icons.ts
  var SVG_NS2 = "http://www.w3.org/2000/svg";
  var ICON_PATHS = {
    bridge: "M2 11 C4 4, 12 4, 14 11 M1.5 11 H14.5 M5.5 7.5 V11 M8 5.5 V11 M10.5 7.5 V11",
    plus: "M8 3 V13 M3 8 H13",
    folder: "M2 4.5 C2 3.7 2.7 3 3.5 3 H6.5 L8 4.5 H12.5 C13.3 4.5 14 5.2 14 6 V11.5 C14 12.3 13.3 13 12.5 13 H3.5 C2.7 13 2 12.3 2 11.5 Z",
    sleep: "M11.5 10.5 A4.5 4.5 0 0 1 5.5 4.5 A5 5 0 1 0 11.5 10.5 Z",
    sidebar: "M2.5 3 H13.5 V13 H2.5 Z M6 3 V13",
    topbar: "M2.5 3 H13.5 V13 H2.5 Z M2.5 6.5 H13.5",
    search: "M7 11.5 A4.5 4.5 0 1 1 7 2.5 A4.5 4.5 0 0 1 7 11.5 Z M10.5 10.5 L14 14",
    pin: "M5 3 H11 L10 7.5 L12 9.5 H8 V13.5 M8 9.5 H4 L6 7.5 Z",
    close: "M4 4 L12 12 M12 4 L4 12",
    archive: "M2.5 3.5 H13.5 V6 H2.5 Z M3.5 6 V12.5 H12.5 V6 M6.5 8.5 H9.5",
    clock: "M8 2.5 A5.5 5.5 0 1 1 8 13.5 A5.5 5.5 0 1 1 8 2.5 Z M8 5 V8.2 L10.2 9.5",
    pdf: "M4 2.5 H9.5 L12.5 5.5 V13.5 H4 Z M9 2.5 V6 H12.5 M6 9 H10.5 M6 11.2 H9.5",
    note: "M3.5 2.5 H12.5 V11 L10 13.5 H3.5 Z M5.5 6 H10.5 M5.5 8.5 H9",
    virtual: "M8 2.5 A5.5 5.5 0 1 1 7.9 2.5 Z"
  };
  function createWorkspaceIcon(doc, name, size = 14) {
    const svg = doc.createElementNS(SVG_NS2, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "none");
    svg.setAttribute("class", "zbf-tb-icon");
    const path = doc.createElementNS(SVG_NS2, "path");
    path.setAttribute("d", ICON_PATHS[name]);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    if (name === "virtual") path.setAttribute("stroke-dasharray", "2.5 2.2");
    svg.append(path);
    return svg;
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
      const strip = this.doc.createElement("div");
      strip.className = "zbf-pinned-strip";
      const maxVisible = 5;
      const iconOnly = this.prefs.get("workspace.pinnedIconOnly");
      const visible = pinnedTabs.slice(0, maxVisible);
      const overflow = pinnedTabs.slice(maxVisible);
      for (const tab of visible) {
        const chip = this.doc.createElement("button");
        chip.type = "button";
        chip.className = `zbf-pinned-chip${iconOnly ? " icon-only" : ""}${tab.tabID === selectedID ? " selected" : ""}`;
        chip.title = tab.title;
        chip.appendChild(createWorkspaceIcon(this.doc, "pin", 12));
        if (!iconOnly) {
          const span = this.doc.createElement("span");
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
        const moreBtn = this.doc.createElement("button");
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
    render() {
      this.toolbar.render();
      const tabBar = this.doc.getElementById("tab-bar-container");
      const inner = tabBar?.querySelector(".tab-bar-inner-container");
      if (!tabBar || !inner) return;
      const sidebarHealthy = this.prefs.get("workspace.enableVerticalSidebar") && !this.prefs.get("workspace.verticalSidebarCollapsed");
      const compactTop = this.prefs.get("workspace.compactTopBar") && sidebarHealthy;
      const enabled = this.prefs.get("workspace.enableHorizontalGroups") && !compactTop;
      if (!enabled) {
        tabBar.toggleAttribute("data-zbf-inline", compactTop);
        this.inlineEl?.setAttribute("hidden", "true");
        return;
      }
      tabBar.setAttribute("data-zbf-inline", "1");
      if (!this.inlineEl || !this.inlineEl.isConnected) {
        this.doc.getElementById("zbf-inline")?.remove();
        const inline = this.doc.createElement("div");
        inline.id = "zbf-inline";
        inline.addEventListener("wheel", (e) => {
          const we = e;
          if (we.ctrlKey || inline.scrollWidth <= inline.clientWidth) return;
          we.preventDefault();
          inline.scrollLeft += we.deltaX || we.deltaY;
        }, { passive: false });
        inner.appendChild(inline);
        this.inlineEl = inline;
      }
      this.inlineEl.removeAttribute("hidden");
      this.inlineEl.textContent = "";
      const selectedID = String(this.win.Zotero_Tabs?.selectedID || "");
      const tracked = this.tabs.buildTrackedTabs(this.win);
      const pinnedTabs = tracked.filter((t) => !t.virtual && t.pinned);
      const unpinned = tracked.filter((t) => t.virtual || !t.pinned);
      this.pinnedStrip.render(this.inlineEl, pinnedTabs, selectedID);
      const compactMode = this.prefs.get("workspace.horizontalTabCompactMode");
      const compactInactive = compactMode === "compact" || compactMode === "auto" && unpinned.length > 5;
      for (const group of this.store.state.groups) {
        const members = unpinned.filter((t) => t.groupId === group.id);
        if (!members.length && !this.store.state.groups.length) continue;
        this.inlineEl.appendChild(this.buildGroupSection(group, members, selectedID, compactInactive));
      }
      const ungrouped = unpinned.filter((t) => !t.groupId);
      if (ungrouped.length) {
        const sec = this.doc.createElement("div");
        sec.className = "zbf-hsection";
        for (const tab of ungrouped) {
          sec.appendChild(this.buildTabChip(tab, selectedID, compactInactive));
        }
        this.inlineEl.appendChild(sec);
      }
      const addBtn = this.doc.createElement("button");
      addBtn.type = "button";
      addBtn.className = "zbf-add-group";
      addBtn.title = "新建标签页分组（或拖放标签到此处建组）";
      addBtn.appendChild(createWorkspaceIcon(this.doc, "plus", 14));
      addBtn.addEventListener("click", () => {
        openTextPromptModal(this.win, "新建分组", "输入分组名称...", "新分组", (name) => {
          if (!name.trim()) return;
          this.store.createGroup(name);
          this.onRefresh();
        });
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
    buildGroupSection(group, members, selectedID, compactInactive) {
      const sec = this.doc.createElement("div");
      sec.className = "zbf-hsection";
      sec.setAttribute("data-grouped", "true");
      sec.style.setProperty("--zbf-gcolor", group.color);
      const isCollapsed = this.store.state.collapsed.includes(group.id);
      const head = this.doc.createElement("button");
      head.type = "button";
      head.className = "zbf-hheading";
      head.title = `${group.name} (${members.length}) · 单击折叠/展开，双击重命名，右键管理`;
      const dot = this.doc.createElement("span");
      dot.className = "zbf-sb-group-dot";
      dot.style.background = group.color;
      const nameSpan = this.doc.createElement("span");
      nameSpan.textContent = `${isCollapsed ? "▸ " : ""}${group.name} (${members.length})`;
      head.append(dot, nameSpan);
      head.addEventListener("click", () => {
        if (this.headingClickTimer) this.win.clearTimeout(this.headingClickTimer);
        this.headingClickTimer = this.win.setTimeout(() => {
          this.headingClickTimer = 0;
          this.store.setCollapsed(group.id, !this.store.state.collapsed.includes(group.id));
          this.onRefresh();
        }, 210);
      });
      head.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        if (this.headingClickTimer) {
          this.win.clearTimeout(this.headingClickTimer);
          this.headingClickTimer = 0;
        }
        this.startInlineRename(head, group);
      });
      head.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.menus.openGroupMenu(head, group, e);
      });
      this.bindDropToGroup(head, group.id);
      sec.appendChild(head);
      if (!isCollapsed) {
        const body = this.doc.createElement("div");
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
      const chip = this.doc.createElement("div");
      chip.className = `zbf-htab${isSelected ? " selected" : ""}${tab.sleeping ? " sleeping" : ""}${tab.virtual ? " virtual" : ""}${collapsed ? " zbf-chip-collapsed" : ""}`;
      chip.title = this.tabs.getDisplayTitle(tab);
      if (!tab.virtual) {
        chip.draggable = true;
        chip.addEventListener("dragstart", (e) => beginTabDrag(e.dataTransfer, tab.key, tab.tabID));
      }
      const titleEl = this.doc.createElement("span");
      titleEl.className = "zbf-htab-title";
      titleEl.textContent = collapsed ? "···" : this.tabs.getDisplayTitle(tab);
      chip.appendChild(titleEl);
      if (!tab.virtual && !collapsed) {
        const closeBtn = this.doc.createElement("button");
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
    startInlineRename(head, group) {
      const input = this.doc.createElement("input");
      input.type = "text";
      input.className = "zbf-inline-edit";
      input.value = group.name;
      head.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const finish = (commit) => {
        if (done) return;
        done = true;
        if (commit && input.value.trim()) this.store.renameGroup(group.id, input.value);
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
    tabs;
    popover;
    onToggleSpotlight;
    onRefresh;
    hostEl = null;
    constructor(win, prefs, tabs, popover, onToggleSpotlight, onRefresh) {
      this.win = win;
      this.doc = win.document;
      this.prefs = prefs;
      this.tabs = tabs;
      this.popover = popover;
      this.onToggleSpotlight = onToggleSpotlight;
      this.onRefresh = onRefresh;
    }
    render() {
      const bar = this.doc.getElementById("zotero-tabs-toolbar");
      if (!bar) return;
      if (!this.hostEl || !this.hostEl.isConnected) {
        this.doc.getElementById("zbf-toolbar-actions")?.remove();
        const wrap = this.doc.createElement("div");
        wrap.id = "zbf-toolbar-actions";
        bar.prepend(wrap);
        this.hostEl = wrap;
      }
      this.hostEl.textContent = "";
      const compact = this.prefs.get("workspace.compactTopBar");
      const sidebarOn = this.prefs.get("workspace.enableVerticalSidebar") && !this.prefs.get("workspace.verticalSidebarCollapsed");
      const showStale = this.prefs.get("workspace.enableStaleSuggestions");
      const staleCount = showStale ? this.tabs.findStaleTabs(this.win).length : 0;
      this.addBtn("topbar", compact ? "展开横版分栏" : "切换为精简顶栏", () => {
        this.prefs.set("workspace.compactTopBar", !compact);
        this.onRefresh();
      }, { pressed: compact });
      this.addBtn("sidebar", "展开/收起左侧竖版文献工作区", () => {
        const cur = this.prefs.get("workspace.enableVerticalSidebar") && !this.prefs.get("workspace.verticalSidebarCollapsed");
        if (!this.prefs.get("workspace.enableVerticalSidebar")) {
          this.prefs.set("workspace.enableVerticalSidebar", true);
          this.prefs.set("workspace.verticalSidebarCollapsed", false);
        } else {
          this.prefs.set("workspace.verticalSidebarCollapsed", cur);
        }
        this.onRefresh();
      }, { pressed: sidebarOn });
      this.addBtn("folder", "按所属 Zotero 集合自动分组当前标签页", () => {
        this.tabs.autoGroupByCollection(this.win);
        this.onRefresh();
      });
      if (this.prefs.get("workspace.enableSessions")) {
        this.addBtn("bridge", "打开工作区快照、模板与 JSON 备份中心", (btn) => {
          this.popover.openHub(btn);
        });
      }
      if (this.prefs.get("workspace.enableSpotlight")) {
        this.addBtn("search", "打开快速查找与命令面板 (Ctrl+P)", () => {
          this.onToggleSpotlight();
        });
      }
      if (this.prefs.get("workspace.enableTabSleep")) {
        this.addBtn("sleep", "休眠所有后台非固定标签页以释放内存", () => {
          this.tabs.sleepInactiveTabs(this.win);
          this.onRefresh();
        });
      }
      if (showStale && staleCount > 0) {
        this.addBtn("clock", `查看超过阈值天数的陈旧标签页（${staleCount} 篇）`, (btn, ev) => {
          this.popover.openStaleMenu(btn, ev);
        }, { count: staleCount, attention: true });
      }
    }
    destroy() {
      this.hostEl?.remove();
      this.hostEl = null;
    }
    addBtn(icon, tooltip, onClick, opts = {}) {
      if (!this.hostEl) return;
      const btn = this.doc.createElement("button");
      btn.type = "button";
      btn.className = `zbf-tb-btn${opts.attention ? " attention" : ""}`;
      btn.title = tooltip;
      btn.setAttribute("aria-label", tooltip);
      if (opts.pressed !== void 0) btn.setAttribute("aria-pressed", String(opts.pressed));
      btn.appendChild(createWorkspaceIcon(this.doc, icon, 15));
      if (opts.count !== void 0 && opts.count > 0) {
        const badge = this.doc.createElement("span");
        badge.className = "zbf-tb-count";
        badge.textContent = opts.count > 99 ? "99+" : String(opts.count);
        btn.appendChild(badge);
      }
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick(btn, e);
      });
      this.hostEl.appendChild(btn);
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
      const card = this.doc.createElement("div");
      card.className = "zbf-hover-card";
      card.setAttribute("data-zbf-hover-card", "1");
      const titleEl = this.doc.createElement("div");
      titleEl.className = "zbf-hc-title";
      titleEl.textContent = tab.title;
      card.appendChild(titleEl);
      const subParts = [tab.creatorYear, tab.source].filter(Boolean);
      if (subParts.length) {
        const subEl = this.doc.createElement("div");
        subEl.className = "zbf-hc-meta";
        subEl.textContent = subParts.join(" · ");
        card.appendChild(subEl);
      }
      if (tab.remark) {
        const remarkEl = this.doc.createElement("div");
        remarkEl.className = "zbf-hc-note";
        remarkEl.textContent = `备注：${tab.remark}`;
        card.appendChild(remarkEl);
      }
      const group = tab.groupId ? this.store.state.groups.find((g) => g.id === tab.groupId) : null;
      const statusParts = [];
      if (group) statusParts.push(`分组：${group.name}`);
      if (tab.collection) statusParts.push(`集合：${tab.collection}`);
      const citeInfo = this.wordCiteMap.get(tab.parentItemID) || this.wordCiteMap.get(tab.itemID);
      if (citeInfo) statusParts.push(`Word [${citeInfo.ordinal}] (${citeInfo.documentName})`);
      if (tab.pinned) statusParts.push("已固定");
      if (tab.sleeping) statusParts.push("已休眠");
      if (tab.virtual) statusParts.push("虚拟成员");
      const rel = formatRelativeTimeZh(tab.lastViewedAt);
      if (rel) statusParts.push(`上次阅读：${rel}`);
      const reader = !tab.virtual && tab.tabID ? globalThis.Zotero?.Reader?.getByTabID?.(tab.tabID) : null;
      const pageIdx = reader?.state?.pageIndex;
      const numPages = reader?._internalReader?._pdfDocument?.numPages || reader?.pagesCount;
      const prog = formatReadingProgress(this.store.state.readingProgress[tab.key]);
      if (typeof pageIdx === "number" && pageIdx >= 0) {
        statusParts.push(typeof numPages === "number" && numPages > 0 ? `第 ${pageIdx + 1} / ${numPages} 页` : `第 ${pageIdx + 1} 页`);
      } else if (prog.text) {
        statusParts.push(prog.text);
      }
      const itemObj = tab.itemID > 0 ? globalThis.Zotero?.Items?.get?.(tab.itemID) : null;
      const annots = itemObj?.isAttachment?.() && typeof itemObj?.getAnnotations === "function" ? itemObj.getAnnotations()?.length : void 0;
      if (typeof annots === "number" && annots > 0) {
        statusParts.push(`批注 ${annots} 条`);
      }
      if (statusParts.length) {
        const footEl = this.doc.createElement("div");
        footEl.className = "zbf-hc-meta";
        footEl.textContent = statusParts.join(" · ");
        card.appendChild(footEl);
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
        const fallback = String(selected[0]?.getField?.("title") || "新分组").slice(0, 30);
        openTextPromptModal(this.win, "打开到新分组", "输入分组名称...", fallback, (name) => {
          const g = this.store.createGroup(name || fallback);
          void this.openIntoGroup(selected, g.id);
        });
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
  var WorkspaceSpotlightPanel = class {
    win;
    doc;
    engine;
    backdrop = null;
    inputEl = null;
    listEl = null;
    results = [];
    activeIndex = 0;
    constructor(win, engine) {
      this.win = win;
      this.doc = win.document;
      this.engine = engine;
    }
    isOpen() {
      return Boolean(this.backdrop?.isConnected);
    }
    open(initialQuery = "") {
      if (this.isOpen()) {
        if (this.inputEl && initialQuery) {
          this.inputEl.value = initialQuery;
          this.renderResults(initialQuery);
        }
        this.inputEl?.focus();
        return;
      }
      const host2 = this.doc.documentElement || this.doc.body;
      if (!host2) return;
      const backdrop = this.doc.createElement("div");
      backdrop.id = "zbf-spotlight-backdrop";
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) this.close();
      });
      const panel = this.doc.createElement("div");
      panel.id = "zbf-spotlight-panel";
      const input = this.doc.createElement("input");
      input.id = "zbf-spotlight-input";
      input.type = "text";
      input.placeholder = "搜索已打开文献、分组、备注，或输入 > 执行命令（>tabs 按最近阅读）...";
      input.value = initialQuery;
      input.addEventListener("input", () => this.renderResults(input.value));
      input.addEventListener("keydown", (e) => this.handleKeydown(e));
      const list = this.doc.createElement("div");
      list.id = "zbf-spotlight-list";
      panel.appendChild(input);
      panel.appendChild(list);
      backdrop.appendChild(panel);
      host2.appendChild(backdrop);
      this.backdrop = backdrop;
      this.inputEl = input;
      this.listEl = list;
      this.renderResults(initialQuery);
      this.win.setTimeout(() => input.focus(), 10);
    }
    toggle() {
      if (this.isOpen()) this.close();
      else this.open();
    }
    close() {
      this.backdrop?.remove();
      this.backdrop = null;
      this.inputEl = null;
      this.listEl = null;
      this.results = [];
    }
    destroy() {
      this.close();
    }
    renderResults(rawQuery) {
      if (!this.listEl) return;
      this.listEl.textContent = "";
      this.results = this.engine.query(rawQuery, this.win);
      this.activeIndex = 0;
      if (!this.results.length) {
        const empty = this.doc.createElement("div");
        empty.className = "zbf-spotlight-empty";
        empty.textContent = "没有匹配的结果。试试输入 > 查看全部工作区命令，或输入文献标题/备注。";
        this.listEl.appendChild(empty);
        return;
      }
      for (let i = 0; i < this.results.length; i++) {
        const item = this.results[i];
        const row = this.doc.createElement("button");
        row.type = "button";
        row.className = `zbf-spotlight-item${i === this.activeIndex ? " active" : ""}`;
        row.addEventListener("mouseenter", () => this.setActive(i));
        row.addEventListener("click", () => {
          this.close();
          void Promise.resolve(item.action());
        });
        const title = this.doc.createElement("div");
        title.className = "zbf-spotlight-title";
        title.textContent = item.title;
        row.appendChild(title);
        if (item.subtitle) {
          const sub = this.doc.createElement("div");
          sub.className = "zbf-spotlight-sub";
          sub.textContent = item.subtitle;
          row.appendChild(sub);
        }
        this.listEl.appendChild(row);
      }
    }
    setActive(idx) {
      if (!this.results.length) return;
      this.activeIndex = (idx + this.results.length) % this.results.length;
      const children = this.listEl?.children;
      if (!children) return;
      for (let i = 0; i < children.length; i++) {
        children[i].classList.toggle("active", i === this.activeIndex);
      }
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
    openTabMenu(anchor, tab, event) {
      if (tab.virtual) {
        this.openVirtualMenu(anchor, tab, event);
        return;
      }
      this.close();
      const pop = createFloatingPopup(this.doc, anchor, event, 215);
      if (!pop) return;
      const close = () => this.close();
      addPopupButton(this.doc, pop, "➕ 新建分组并加入", () => {
        openTextPromptModal(this.win, "新建分组", "输入分组名称...", "新分组", (name) => {
          if (!name.trim()) return;
          const grp = this.store.createGroup(name);
          this.store.assignToGroup(tab.key, grp.id);
          this.onRefresh();
        });
      }, close);
      for (const group of this.store.state.groups) {
        const inThis = tab.groupId === group.id;
        addPopupButton(this.doc, pop, `${inThis ? "✓ " : "   "}加入分组：${group.name}`, () => {
          this.store.assignToGroup(tab.key, group.id);
          this.onRefresh();
        }, close);
      }
      if (tab.groupId) {
        addPopupButton(this.doc, pop, "从当前分组移出", () => {
          this.store.assignToGroup(tab.key, null);
          this.onRefresh();
        }, close);
      }
      addPopupSeparator(this.doc, pop);
      if (this.prefs.get("workspace.enablePinnedTabs")) {
        addPopupButton(this.doc, pop, tab.pinned ? "📌 取消固定标签" : "📌 固定此标签", () => {
          this.store.setPinned(tab.key, !tab.pinned);
          this.onRefresh();
        }, close);
      }
      if (this.prefs.get("workspace.enableTabSleep") && !tab.pinned) {
        addPopupButton(this.doc, pop, tab.sleeping ? "⚡ 唤醒并重新加载" : "🌙 休眠释放内存", () => {
          if (tab.sleeping) void this.tabs.reloadTab(this.win, tab.tabID);
          else this.tabs.sleepTab(this.win, tab.tabID);
          this.onRefresh();
        }, close);
      }
      if (this.prefs.get("workspace.enableTabRemarks")) {
        addPopupButton(this.doc, pop, tab.remark ? "✎ 编辑标签页备注" : "✎ 添加标签页备注", () => {
          openTextPromptModal(this.win, "设置标签页备注", "输入简短备注（留空清除）...", tab.remark || "", (val) => {
            this.store.setRemark(tab.key, val);
            this.onRefresh();
          });
        }, close);
        if (tab.remark) {
          const curMode = this.store.state.remarkModes[tab.key] || "";
          for (const [m, lbl] of [["", "显示：跟随全局"], ["both", "显示：备注+标题"], ["remark", "显示：仅备注"], ["title", "显示：仅标题"]]) {
            addPopupButton(this.doc, pop, `${curMode === m ? "✓ " : "   "}${lbl}`, () => {
              this.store.setRemarkMode(tab.key, m);
              this.onRefresh();
            }, close);
          }
        }
      }
      addPopupSeparator(this.doc, pop);
      if (this.prefs.get("workspace.enableCopyReference")) {
        addPopupButton(this.doc, pop, "📋 复制标准引文（并记入反查）", () => {
          void this.tabs.copyTabCitation(this.win, tab.tabID);
        }, close);
      }
      if (tab.itemID > 0) {
        addPopupButton(this.doc, pop, "📚 在文献库中定位", () => {
          void this.tabs.showInLibrary(this.win, tab.itemID, false);
        }, close);
        addPopupButton(this.doc, pop, "🗂 在集合树中定位所属集合", () => {
          void this.tabs.showInLibrary(this.win, tab.itemID, true);
        }, close);
        if (this.prefs.get("workspace.enableShowInFilesystem")) {
          addPopupButton(this.doc, pop, "📂 在文件管理器中显示", () => {
            void this.tabs.revealTabAttachment(this.win, tab.itemID);
          }, close);
        }
      }
      if (this.prefs.get("workspace.enableReloadTab")) {
        addPopupButton(this.doc, pop, "🔄 重新加载此标签页", () => {
          void this.tabs.reloadTab(this.win, tab.tabID).then(() => this.onRefresh());
        }, close);
      }
      addPopupButton(this.doc, pop, "↩ 恢复最近关闭的标签页", () => {
        this.tabs.undoCloseTab(this.win);
        this.onRefresh();
      }, close);
      addPopupSeparator(this.doc, pop);
      addPopupButton(this.doc, pop, "关闭右侧标签页", () => {
        const open = this.tabs.buildTrackedTabs(this.win).filter((t) => !t.virtual);
        const idx = open.findIndex((t) => t.tabID === tab.tabID);
        if (idx >= 0) void this.tabs.closeTabs(this.win, open.slice(idx + 1).map((t) => t.tabID), { protectPinned: true });
      }, close);
      addPopupButton(this.doc, pop, "关闭其他未固定标签页", () => {
        const others = this.tabs.buildTrackedTabs(this.win).filter((t) => !t.virtual && t.tabID !== tab.tabID).map((t) => t.tabID);
        void this.tabs.closeTabs(this.win, others, { protectPinned: true });
      }, close);
      if (this.prefs.get("workspace.enableVirtualMembers") && tab.groupId) {
        addPopupButton(this.doc, pop, "关闭标签（保留在分组）", () => {
          void this.tabs.closeTabs(this.win, [tab.tabID], { preserveVirtual: true });
        }, close);
      }
      addPopupButton(this.doc, pop, "彻底关闭标签页", () => {
        void this.tabs.closeTabs(this.win, [tab.tabID], { preserveVirtual: false });
      }, close, { danger: true });
      this.bindPopup(pop);
    }
    openVirtualMenu(anchor, tab, event) {
      this.close();
      const pop = createFloatingPopup(this.doc, anchor, event, 200);
      if (!pop) return;
      const close = () => this.close();
      addPopupButton(this.doc, pop, "📖 加载并打开文献", () => {
        void this.tabs.openVirtualOrItem(this.win, tab.itemID, tab.groupId).then(() => this.onRefresh());
      }, close);
      if (tab.itemID > 0) {
        addPopupButton(this.doc, pop, "📚 在文献库中定位", () => {
          void this.tabs.showInLibrary(this.win, tab.itemID, true);
        }, close);
      }
      addPopupButton(this.doc, pop, "🗑 从分组移除虚拟成员", () => {
        this.store.removeVirtualMember(tab.key);
        this.store.assignToGroup(tab.key, null);
        this.onRefresh();
      }, close, { danger: true });
      this.bindPopup(pop);
    }
    openGroupMenu(anchor, group, event) {
      this.close();
      const pop = createFloatingPopup(this.doc, anchor, event, 210);
      if (!pop) return;
      const close = () => this.close();
      const isCollapsed = this.store.state.collapsed.includes(group.id);
      addPopupButton(this.doc, pop, isCollapsed ? "▾ 展开此分组" : "▸ 折叠此分组", () => {
        this.store.setCollapsed(group.id, !isCollapsed);
        this.onRefresh();
      }, close);
      addPopupButton(this.doc, pop, "✎ 重命名分组", () => {
        openTextPromptModal(this.win, "重命名分组", "输入新的分组名称...", group.name, (val) => {
          if (this.store.renameGroup(group.id, val)) this.onRefresh();
        });
      }, close);
      const swatchRow = this.doc.createElement("div");
      swatchRow.className = "zbf-color-row";
      for (const color of GROUP_PALETTE) {
        const swatch = this.doc.createElement("button");
        swatch.type = "button";
        swatch.className = `zbf-color-swatch${color === group.color ? " active" : ""}`;
        swatch.style.background = color;
        swatch.title = color;
        swatch.addEventListener("click", () => {
          this.store.setGroupColor(group.id, color);
          this.close();
          this.onRefresh();
        });
        swatchRow.appendChild(swatch);
      }
      pop.appendChild(swatchRow);
      addPopupButton(this.doc, pop, "🎨 自定义十六进制颜色...", () => {
        openTextPromptModal(this.win, "自定义分组颜色", "例如 #3b82f6", group.color, (hex) => {
          if (/^#[0-9a-fA-F]{3,8}$/.test(hex.trim())) {
            this.store.setGroupColor(group.id, hex.trim());
            this.onRefresh();
          }
        });
      }, close);
      const hasVirtual = this.tabs.buildTrackedTabs(this.win).some((t) => t.virtual && t.groupId === group.id);
      if (hasVirtual) {
        addPopupButton(this.doc, pop, "📖 打开组内全部虚拟文献", () => {
          void this.tabs.openGroupVirtuals(this.win, group.id).then(() => this.onRefresh());
        }, close);
      }
      addPopupSeparator(this.doc, pop);
      addPopupButton(this.doc, pop, "折叠其他分组", () => {
        this.store.collapseOtherGroups(group.id);
        this.onRefresh();
      }, close);
      if (this.prefs.get("workspace.enableSessions")) {
        addPopupButton(this.doc, pop, "📦 归档为快照并关闭组内标签", () => {
          void this.tabs.archiveAndCloseGroup(this.win, group.id).then(() => this.onRefresh());
        }, close);
      }
      addPopupButton(this.doc, pop, "仅保留本组（关闭其他标签）", () => {
        const ids = this.tabs.buildTrackedTabs(this.win).filter((t) => !t.virtual && t.groupId !== group.id).map((t) => t.tabID);
        void this.tabs.closeTabs(this.win, ids, { preserveVirtual: true, protectPinned: true }).then(() => this.onRefresh());
      }, close);
      addPopupButton(this.doc, pop, "关闭组内所有已开标签", () => {
        const ids = this.tabs.buildTrackedTabs(this.win).filter((t) => !t.virtual && t.groupId === group.id).map((t) => t.tabID);
        void this.tabs.closeTabs(this.win, ids, { preserveVirtual: true, protectPinned: true }).then(() => this.onRefresh());
      }, close);
      addPopupButton(this.doc, pop, "解散分组（保留已打开标签）", () => {
        this.store.removeGroup(group.id);
        this.onRefresh();
      }, close, { danger: true });
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
    const row = doc.createElement("div");
    row.className = `zbf-vtab-row${isSelected ? " selected" : ""}${tab.sleeping ? " sleeping" : ""}${tab.virtual ? " virtual" : ""}`;
    row.tabIndex = 0;
    row.setAttribute("data-zbf-nav", "row");
    row.title = tab.title;
    const rowH = prefs.get("workspace.verticalTabRowHeight");
    if (rowH >= 28 && rowH <= 72) row.style.minHeight = `${rowH}px`;
    selection.addCheckbox(row, tab);
    const iconName = tab.pinned ? "pin" : tab.sleeping ? "sleep" : tab.virtual ? "virtual" : tab.type.includes("note") ? "note" : "pdf";
    row.appendChild(createWorkspaceIcon(doc, iconName, 13));
    const main = doc.createElement("div");
    main.className = "zbf-vtab-main";
    const titleEl = doc.createElement("div");
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
    const prog = formatReadingProgress(store.state.readingProgress[tab.key]);
    const subText = [subBase, prog.text].filter(Boolean).join(" · ");
    if (subText) {
      const subEl = doc.createElement("div");
      subEl.className = "zbf-vtab-sub";
      subEl.textContent = subText;
      main.appendChild(subEl);
    }
    if (prog.ratio !== null && prog.ratio > 0) {
      const bar = doc.createElement("div");
      bar.className = "zbf-vtab-progress";
      const fill = doc.createElement("span");
      fill.className = "zbf-vtab-progress-fill";
      fill.style.width = `${Math.round(prog.ratio * 100)}%`;
      bar.appendChild(fill);
      main.appendChild(bar);
    }
    row.appendChild(main);
    const right = doc.createElement("div");
    right.className = "zbf-vtab-right";
    const citeInfo = wordCiteMap.get(tab.parentItemID) || wordCiteMap.get(tab.itemID);
    if (citeInfo) {
      const badge = doc.createElement("span");
      badge.className = "zbf-cite-badge";
      badge.textContent = `[${citeInfo.ordinal}]`;
      badge.title = `${citeInfo.documentName}: ${citeInfo.shortText}`;
      right.appendChild(badge);
    }
    if (!tab.virtual && tab.itemID > 0 && prefs.get("workspace.enableShowInFilesystem")) {
      const folderBtn = doc.createElement("button");
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
      const sleepBtn = doc.createElement("button");
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
    const closeBtn = doc.createElement("button");
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
        const w = Math.round(aside.getBoundingClientRect().width || 276);
        prefs.set("workspace.verticalSidebarWidth", Math.max(200, Math.min(440, w)));
        doc.removeEventListener("mousemove", onMove);
        doc.removeEventListener("mouseup", onUp);
      };
      doc.addEventListener("mousemove", onMove);
      doc.addEventListener("mouseup", onUp);
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
    const box = doc.createElement("div");
    box.className = "zbf-sb-empty";
    const msg = doc.createElement("div");
    msg.textContent = hasAnyTabs ? "未找到匹配的文献标签页" : "当前没有打开的文献标签页";
    box.appendChild(msg);
    if (hasAnyTabs) {
      const clearBtn = doc.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "zbf-sb-empty-btn";
      clearBtn.textContent = "清除搜索条件";
      clearBtn.addEventListener("click", onClearSearch);
      box.appendChild(clearBtn);
    } else {
      const libBtn = doc.createElement("button");
      libBtn.type = "button";
      libBtn.className = "zbf-sb-empty-btn";
      libBtn.textContent = "返回「我的文库」";
      libBtn.addEventListener("click", () => win.Zotero_Tabs?.select?.("zotero-pane"));
      const sesBtn = doc.createElement("button");
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
    const counts = doc.createElement("span");
    counts.textContent = `活动 ${active} · 休眠 ${sleeping} · 虚拟 ${virtual}`;
    statusEl.appendChild(counts);
    const budget = prefs.get("workspace.activeReaderBudget");
    if (budget > 0 && active > budget && prefs.get("workspace.enableTabSleep")) {
      const warn = doc.createElement("button");
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
    const head = doc.createElement("div");
    head.className = "zbf-sb-group-head";
    head.tabIndex = 0;
    head.setAttribute("data-zbf-nav", "head");
    const dot = doc.createElement("span");
    dot.className = "zbf-sb-group-dot";
    dot.style.background = color;
    const span = doc.createElement("span");
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
      const rowHead = doc.createElement("div");
      rowHead.className = "zbf-sb-group-head-row";
      const h = doc.createElement("div");
      h.className = "zbf-sb-group-head";
      h.textContent = `📁 ${colName} (${colTabs.length})`;
      rowHead.appendChild(h);
      if (colName !== "未分类") {
        const toGrp = doc.createElement("button");
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
    closeBtn;
    doc;
    prefs;
    store;
    list;
    onChange;
    onCloseSelected;
    constructor(doc, prefs, store, headerActions, aside, list, onChange, onCloseSelected) {
      this.doc = doc;
      this.prefs = prefs;
      this.store = store;
      this.list = list;
      this.onChange = onChange;
      this.onCloseSelected = onCloseSelected;
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
      this.closeBtn = this.btn("关闭", () => {
        const ids = [...this.selected];
        this.selected.clear();
        this.onCloseSelected(ids);
      });
      this.controls.append(this.countEl, this.selectAllBtn, this.groupSelect, this.pinBtn, this.unpinBtn, this.closeBtn);
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
      for (const group of this.store.state.groups) {
        const opt = this.h("option");
        opt.value = group.id;
        opt.textContent = group.name;
        this.groupSelect.append(opt);
      }
    }
    updateControls() {
      if (!this.active) return;
      const count = this.selected.size;
      this.countEl.textContent = `已选 ${count}`;
      this.selectAllBtn.disabled = !this.visibleCheckboxes().some((cb) => !cb.checked);
      this.groupSelect.disabled = !count || !this.store.state.groups.length;
      const pinOn = this.prefs.get("workspace.enablePinnedTabs");
      this.pinBtn.hidden = !pinOn;
      this.unpinBtn.hidden = !pinOn;
      this.pinBtn.disabled = !count;
      this.unpinBtn.disabled = !count;
      this.closeBtn.disabled = !count;
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
    render() {
      const mainDeck = this.doc.getElementById("zotero-main-window-deck") || this.doc.querySelector("#main-deck, #zotero-pane-stack")?.parentElement || this.doc.getElementById("zotero-pane")?.parentElement;
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
      this.renderList();
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
      const aside = this.doc.createElement("aside");
      aside.id = "zbf-sidebar";
      const header = this.doc.createElement("div");
      header.className = "zbf-sb-header";
      const title = this.doc.createElement("div");
      title.className = "zbf-sb-title";
      title.appendChild(createWorkspaceIcon(this.doc, "bridge", 14));
      const titleText = this.doc.createElement("span");
      titleText.textContent = "BridgeFlow 文献工作区";
      title.appendChild(titleText);
      const actions = this.doc.createElement("div");
      actions.className = "zbf-sb-actions";
      header.append(title, actions);
      aside.appendChild(header);
      const searchWrap = this.doc.createElement("div");
      searchWrap.className = "zbf-sb-search-wrap";
      const searchInput = this.doc.createElement("input");
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
      const views = this.doc.createElement("div");
      views.className = "zbf-sb-views";
      for (const [mode, label] of [["groups", "分组"], ["collections", "集合"], ["status", "状态"]]) {
        const vBtn = this.doc.createElement("button");
        vBtn.type = "button";
        vBtn.className = "zbf-sb-view-btn";
        vBtn.textContent = label;
        vBtn.addEventListener("click", () => {
          this.viewMode = mode;
          this.render();
        });
        this.viewButtons.set(mode, vBtn);
        views.appendChild(vBtn);
      }
      aside.appendChild(views);
      const list = this.doc.createElement("div");
      list.className = "zbf-sb-list";
      aside.appendChild(list);
      const status = this.doc.createElement("div");
      status.className = "zbf-sb-status";
      aside.appendChild(status);
      const splitter = this.doc.createElement("div");
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
        (ids) => void this.tabs.closeTabs(this.win, ids, { preserveVirtual: true })
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
      this.addHeaderBtn(actions, "folder", "按集合自动分组", () => {
        this.tabs.autoGroupByCollection(this.win);
        this.onRefresh();
      });
      if (this.prefs.get("workspace.enableSpotlight")) {
        this.addHeaderBtn(actions, "search", "打开快速查找 (Ctrl+P)", () => this.onToggleSpotlight());
      }
      if (this.prefs.get("workspace.enableSessions")) {
        this.addHeaderBtn(actions, "archive", "打开工作区快照中心", (btn) => this.popover.openHub(btn));
      }
      this.addHeaderBtn(actions, "close", "收起文献工作区侧栏", () => {
        this.prefs.set("workspace.verticalSidebarCollapsed", true);
        this.onRefresh();
      });
      mainDeck.parentElement?.insertBefore(aside, mainDeck);
      this.asideEl = aside;
      this.listEl = list;
      this.statusEl = status;
    }
    renderList() {
      if (!this.listEl || !this.selection) return;
      this.listEl.textContent = "";
      const needle = this.searchTerm.trim().toLowerCase();
      const allTracked = this.tabs.buildTrackedTabs(this.win);
      const filtered = needle ? allTracked.filter((t) => `${t.title} ${t.shortTitle} ${t.creatorYear} ${t.collection} ${t.remark}`.toLowerCase().includes(needle)) : allTracked;
      this.selection.beginRender(filtered);
      const selectedID = String(this.win.Zotero_Tabs?.selectedID || "");
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
      if (!filtered.length) {
        this.renderEmptyState(allTracked.length > 0);
      } else if (this.viewMode === "groups") {
        const pinned = filtered.filter((t) => !t.virtual && t.pinned);
        if (pinned.length) this.appendSimpleSection("已固定标签", "#f59e0b", pinned, rowDeps);
        for (const grp of this.store.state.groups) {
          const members = filtered.filter((t) => (t.virtual || !t.pinned) && t.groupId === grp.id);
          const collapsed = this.store.state.collapsed.includes(grp.id);
          const head = this.doc.createElement("button");
          head.type = "button";
          head.className = "zbf-sb-group-head";
          head.tabIndex = 0;
          head.setAttribute("data-zbf-nav", "head");
          const dot = this.doc.createElement("span");
          dot.className = "zbf-sb-group-dot";
          dot.style.background = grp.color;
          const label = this.doc.createElement("span");
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
      const btn = this.doc.createElement("button");
      btn.type = "button";
      btn.className = "zbf-sb-icon-btn";
      btn.title = title;
      btn.appendChild(createWorkspaceIcon(this.doc, icon, 14));
      btn.addEventListener("click", () => onClick(btn));
      container.appendChild(btn);
    }
  };

  // src/domains/workspace/workspace-hub-helpers.ts
  async function exportWorkspaceJson(win, store) {
    const json = store.exportJson();
    const ZoteroObj = globalThis.Zotero;
    try {
      const fp = ZoteroObj?.File?.FilePicker ? new ZoteroObj.File.FilePicker() : null;
      if (fp?.init) {
        fp.init(win, "导出工作区备份 (JSON)", fp.modeSave ?? 1);
        fp.appendFilter("JSON 文件", "*.json");
        fp.defaultString = `BridgeFlow-Workspace-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
        const rv = await fp.show();
        if (rv !== void 0 && fp.file) {
          await ZoteroObj.File.putContentsAsync(fp.file, json);
          return "已导出工作区 JSON 文件";
        }
        return "";
      }
    } catch {
    }
    try {
      await win.navigator.clipboard?.writeText?.(json);
      return "已复制工作区 JSON 到剪贴板";
    } catch {
      openTextPromptModal(win, "工作区 JSON 备份（请全选复制）", "", json, () => {
      });
      return "";
    }
  }
  async function importWorkspaceJsonInteractive(win, store, onImported) {
    const ZoteroObj = globalThis.Zotero;
    try {
      const fp = ZoteroObj?.File?.FilePicker ? new ZoteroObj.File.FilePicker() : null;
      if (fp?.init) {
        fp.init(win, "导入工作区备份 (JSON)", fp.modeOpen ?? 0);
        fp.appendFilter("JSON 文件", "*.json");
        const rv = await fp.show();
        if (rv !== void 0 && fp.file) {
          const content = await ZoteroObj.File.getContentsAsync(fp.file);
          if (content && store.importJson(String(content))) onImported();
          return;
        }
        return;
      }
    } catch {
    }
    openTextPromptModal(win, "导入工作区 JSON", "请在此粘贴工作区 JSON 内容...", "", (raw) => {
      if (raw && store.importJson(raw)) onImported();
    });
  }
  function renderPublicationSuggestionsSection(doc, store, suggestions, onApplied) {
    if (!suggestions.length) return null;
    const wrap = doc.createElement("div");
    wrap.className = "zbf-hub-section";
    const heading = doc.createElement("div");
    heading.className = "zbf-hub-section-title";
    heading.textContent = `期刊 / 会议智能分组建议 (${suggestions.length})`;
    wrap.appendChild(heading);
    for (const sug of suggestions.slice(0, 5)) {
      const card = doc.createElement("div");
      card.className = "zbf-hub-card";
      const info = doc.createElement("div");
      info.className = "zbf-hub-card-info";
      const nameEl = doc.createElement("div");
      nameEl.className = "zbf-hub-card-name";
      nameEl.textContent = `📚 ${sug.venue}`;
      const metaEl = doc.createElement("div");
      metaEl.className = "zbf-hub-card-meta";
      metaEl.textContent = `${sug.keys.length} 篇同源未分组文献`;
      info.append(nameEl, metaEl);
      const applyBtn = doc.createElement("button");
      applyBtn.type = "button";
      applyBtn.className = "zbf-hub-btn primary";
      applyBtn.textContent = "一键归组";
      applyBtn.addEventListener("click", () => {
        const group = store.state.groups.find((g) => g.name === sug.venue) ?? store.createGroup(sug.venue);
        for (const k of sug.keys) store.assignToGroup(k, group.id);
        onApplied();
      });
      card.append(info, applyBtn);
      wrap.appendChild(card);
    }
    return wrap;
  }
  function renderSessionSection(doc, titleText, sessions, emptyText, handlers) {
    const wrap = doc.createElement("div");
    wrap.className = "zbf-hub-section";
    const heading = doc.createElement("div");
    heading.className = "zbf-hub-section-title";
    heading.textContent = `${titleText} (${sessions.length})`;
    wrap.appendChild(heading);
    if (!sessions.length) {
      const empty = doc.createElement("div");
      empty.className = "zbf-hub-empty";
      empty.textContent = emptyText;
      wrap.appendChild(empty);
      return wrap;
    }
    const { win, store, isRolling, onRestore, onChanged } = handlers;
    for (const session of sessions) {
      const card = doc.createElement("div");
      card.className = "zbf-hub-card";
      const info = doc.createElement("div");
      info.className = "zbf-hub-card-info";
      const icon = session.isTemplate ? "📐 " : session.kind === "pre-replace" ? "↩ " : isRolling ? "🕒 " : "💾 ";
      const nameEl = doc.createElement("div");
      nameEl.className = "zbf-hub-card-name";
      nameEl.textContent = `${icon}${session.name}`;
      const metaEl = doc.createElement("div");
      metaEl.className = "zbf-hub-card-meta";
      const dt = new Date(session.createdAt || Date.now()).toLocaleString();
      metaEl.textContent = `${dt} · ${session.groups.length} 个分组 · ${session.pinnedKeys.length} 个固定`;
      info.append(nameEl, metaEl);
      const btns = doc.createElement("div");
      btns.className = "zbf-hub-card-actions";
      const mergeBtn = doc.createElement("button");
      mergeBtn.type = "button";
      mergeBtn.className = "zbf-hub-btn primary";
      mergeBtn.textContent = "合并恢复";
      mergeBtn.title = "保留当前已打开文献与分组，合并会话布局并后台补开缺失文献";
      mergeBtn.addEventListener("click", () => onRestore(session, true));
      const replaceBtn = doc.createElement("button");
      replaceBtn.type = "button";
      replaceBtn.className = "zbf-hub-btn";
      replaceBtn.textContent = "替换";
      replaceBtn.title = "自动先保存恢复前备份，再替换为该快照布局";
      replaceBtn.addEventListener("click", () => onRestore(session, false));
      btns.append(mergeBtn, replaceBtn);
      if (isRolling) {
        const promoteBtn = doc.createElement("button");
        promoteBtn.type = "button";
        promoteBtn.className = "zbf-hub-btn";
        promoteBtn.textContent = "转存";
        promoteBtn.addEventListener("click", () => {
          if (store.promoteRollingSession(session.id)) onChanged();
        });
        btns.appendChild(promoteBtn);
      } else if (session.kind !== "pre-replace") {
        const updateBtn = doc.createElement("button");
        updateBtn.type = "button";
        updateBtn.className = "zbf-hub-btn";
        updateBtn.textContent = "更新";
        updateBtn.addEventListener("click", () => {
          if (store.updateSession(session.id)) onChanged();
        });
        const renameBtn = doc.createElement("button");
        renameBtn.type = "button";
        renameBtn.className = "zbf-hub-btn";
        renameBtn.textContent = "重命名";
        renameBtn.addEventListener("click", () => {
          openTextPromptModal(win, "重命名快照", "输入新名称...", session.name, (val) => {
            if (store.renameSession(session.id, val)) onChanged();
          });
        });
        btns.append(updateBtn, renameBtn);
      }
      const delBtn = doc.createElement("button");
      delBtn.type = "button";
      delBtn.className = "zbf-hub-btn";
      delBtn.textContent = "删除";
      delBtn.addEventListener("click", () => {
        if (store.deleteSession(session.id)) onChanged();
      });
      btns.appendChild(delBtn);
      card.append(info, btns);
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
    openHub(_anchor) {
      this.close();
      const host2 = this.doc.documentElement || this.doc.body;
      if (!host2) return;
      const backdrop = this.doc.createElement("div");
      backdrop.id = "zbf-hub-backdrop";
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) this.close();
      });
      const modal = this.doc.createElement("div");
      modal.className = "zbf-hub-box";
      const header = this.doc.createElement("div");
      header.className = "zbf-hub-head";
      const title = this.doc.createElement("div");
      title.className = "zbf-hub-title";
      title.textContent = "工作区与会话快照中心";
      const closeBtn = this.doc.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "zbf-hub-close";
      closeBtn.textContent = "✕";
      closeBtn.addEventListener("click", () => this.close());
      header.append(title, closeBtn);
      const nameInput = this.doc.createElement("input");
      nameInput.type = "text";
      nameInput.className = "zbf-hub-input";
      nameInput.placeholder = "输入工作区快照或模板名称（如：论文修改轮次）...";
      const statusEl = this.doc.createElement("div");
      statusEl.className = "zbf-hub-status";
      const actions = this.doc.createElement("div");
      actions.className = "zbf-hub-actions";
      const saveBtn = this.doc.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "zbf-hub-btn primary";
      saveBtn.textContent = "保存当前快照";
      saveBtn.addEventListener("click", () => {
        const name = nameInput.value.trim() || `快照 ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`;
        this.store.saveSession(name, { isTemplate: false });
        nameInput.value = "";
        statusEl.textContent = `已保存工作区快照「${name}」`;
        renderLists();
      });
      const tplBtn = this.doc.createElement("button");
      tplBtn.type = "button";
      tplBtn.className = "zbf-hub-btn";
      tplBtn.textContent = "存为分组模板";
      tplBtn.addEventListener("click", () => {
        const name = nameInput.value.trim() || `模板 ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`;
        this.store.saveSession(name, { isTemplate: true });
        nameInput.value = "";
        statusEl.textContent = `已保存结构模板「${name}」`;
        renderLists();
      });
      const exportBtn = this.doc.createElement("button");
      exportBtn.type = "button";
      exportBtn.className = "zbf-hub-btn";
      exportBtn.textContent = "导出 JSON";
      exportBtn.addEventListener("click", async () => {
        const msg = await exportWorkspaceJson(this.win, this.store);
        if (msg) statusEl.textContent = msg;
      });
      const importBtn = this.doc.createElement("button");
      importBtn.type = "button";
      importBtn.className = "zbf-hub-btn";
      importBtn.textContent = "导入 JSON";
      importBtn.addEventListener("click", async () => {
        await importWorkspaceJsonInteractive(this.win, this.store, () => {
          statusEl.textContent = "已导入工作区状态";
          renderLists();
          this.onRefresh();
        });
      });
      actions.append(saveBtn, tplBtn, exportBtn, importBtn);
      const listsWrap = this.doc.createElement("div");
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
          onChanged: () => renderLists()
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
      this.activeBackdrop = backdrop;
      this.win.setTimeout(() => nameInput.focus(), 10);
    }
    openStaleMenu(anchor, event) {
      this.close();
      const pop = createFloatingPopup(this.doc, anchor, event, 280);
      if (!pop) return;
      const days = this.prefs.get("workspace.staleSuggestDays");
      const stale = this.tabs.findStaleTabs(this.win);
      const title = this.doc.createElement("div");
      title.className = "zbf-popup-header";
      title.textContent = `建议清理的标签页（超过 ${days} 天未查看：${stale.length} 篇）`;
      pop.appendChild(title);
      if (!stale.length) {
        const empty = this.doc.createElement("div");
        empty.className = "zbf-popup-empty";
        empty.textContent = "当前没有长期未查看的陈旧标签页。";
        pop.appendChild(empty);
      } else {
        for (const tab of stale.slice(0, 12)) {
          const row = this.doc.createElement("div");
          row.className = "zbf-stale-row";
          const label = this.doc.createElement("span");
          label.className = "zbf-stale-title";
          label.textContent = this.tabs.getDisplayTitle(tab);
          label.addEventListener("click", () => {
            this.close();
            this.tabs.selectTab(this.win, tab.tabID);
            this.onRefresh();
          });
          const sleepBtn = this.doc.createElement("button");
          sleepBtn.type = "button";
          sleepBtn.className = "zbf-mini-btn";
          sleepBtn.textContent = "休眠";
          sleepBtn.addEventListener("click", () => {
            this.tabs.sleepTab(this.win, tab.tabID);
            this.close();
            this.onRefresh();
          });
          const closeBtn = this.doc.createElement("button");
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
        const footer = this.doc.createElement("div");
        footer.className = "zbf-stale-footer";
        const sleepAll = this.doc.createElement("button");
        sleepAll.type = "button";
        sleepAll.className = "zbf-mini-btn";
        sleepAll.textContent = "全部休眠";
        sleepAll.addEventListener("click", () => {
          for (const t of stale) this.tabs.sleepTab(this.win, t.tabID);
          this.close();
          this.onRefresh();
        });
        const closeAll = this.doc.createElement("button");
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

  // src/domains/workspace/workspace-ui.ts
  var WorkspaceWindowUI = class {
    win;
    doc;
    prefs;
    tabs;
    styleEl = null;
    hoverCard = null;
    tabMenu = null;
    itemMenu = null;
    popover = null;
    toolbar = null;
    horizontal = null;
    sidebar = null;
    spotlightPanel = null;
    tabObserver = null;
    renderTimer = 0;
    destroyed = false;
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
      this.scheduleRender(80);
    };
    constructor(win, prefs, store, tabs, spotlightEngine) {
      this.win = win;
      this.doc = win.document;
      this.prefs = prefs;
      this.tabs = tabs;
      if (!this.doc) return;
      this.mountStyle();
      const refresh = () => this.render();
      this.hoverCard = new WorkspaceHoverCard(this.doc, prefs, store);
      this.popover = new WorkspacePopover(win, prefs, store, tabs, refresh);
      this.spotlightPanel = new WorkspaceSpotlightPanel(win, spotlightEngine);
      this.tabMenu = new WorkspaceTabContextMenu(win, prefs, store, tabs, refresh);
      this.itemMenu = new ItemContextMenuController(win, this.doc, prefs, store, tabs, refresh);
      this.toolbar = new WorkspaceToolbarActions(win, prefs, tabs, this.popover, () => this.spotlightPanel?.toggle(), refresh);
      this.horizontal = new WorkspaceHorizontalBar(win, prefs, store, tabs, this.tabMenu, this.hoverCard, this.toolbar, refresh);
      this.sidebar = new WorkspaceVerticalSidebar(win, prefs, store, tabs, this.tabMenu, this.hoverCard, this.popover, () => this.spotlightPanel?.toggle(), refresh);
      this.itemMenu.attach();
      this.attachObservers();
      this.doc.addEventListener("keydown", this.onKeydown, true);
      this.win.addEventListener("resize", this.onResize);
      this.render();
    }
    setCitationBadges(badges) {
      this.hoverCard?.setWordCitationBadges(badges);
      this.sidebar?.setWordCitationBadges(badges);
      this.render();
    }
    render() {
      if (this.destroyed || !this.doc) return;
      try {
        this.horizontal?.render();
        this.sidebar?.render();
      } catch {
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
      this.doc?.removeEventListener("keydown", this.onKeydown, true);
      this.win.removeEventListener?.("resize", this.onResize);
      this.horizontal?.destroy();
      this.sidebar?.destroy();
      this.tabMenu?.destroy();
      this.itemMenu?.dispose();
      this.popover?.destroy();
      this.hoverCard?.destroy();
      this.spotlightPanel?.destroy();
      this.styleEl?.remove();
      this.styleEl = null;
    }
    mountStyle() {
      if (!this.doc) return;
      this.doc.getElementById("zbf-workspace-style")?.remove();
      const style = this.doc.createElement("style");
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
      return Boolean(el.closest("#zbf-inline, #zbf-toolbar-actions"));
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
    disposables = new DisposableStack();
    windows = /* @__PURE__ */ new Map();
    active = false;
    latestBadges = /* @__PURE__ */ new Map();
    maintenanceTimer = null;
    readingTimer = null;
    autoGroupTimer = null;
    lastRollingAt = 0;
    viewedDirty = false;
    constructor(kernel, services) {
      this.kernel = kernel;
      this.store = new WorkspaceStateStore(kernel.prefs);
      this.tabs = new WorkspaceTabController(kernel.prefs, this.store, services.clipboard);
      this.spotlight = new WorkspaceSpotlightEngine(kernel.prefs, this.store, this.tabs);
    }
    async start() {
      if (this.active) return;
      this.active = true;
      this.disposables.reset();
      this.store.load();
      this.disposables.add(this.store.onChange(() => this.refreshAllWindows()));
      this.disposables.add(
        this.kernel.prefs.observeKeys([...WATCHED_WORKSPACE_PREFS], () => this.refreshAllWindows())
      );
      this.disposables.add(
        this.kernel.notifier.subscribe(["tab", "collection", "item"], ({ event, type, ids }) => {
          if (type === "tab") {
            this.handleTabEvent(event, ids.map(String));
          } else if (event === "modify" || event === "add" || event === "delete") {
            if (type === "item") this.spotlight.invalidateLibraryIndex();
            this.refreshAllWindows();
          }
        })
      );
      for (const win of this.getMainWindows()) {
        this.onMainWindowLoad(win);
      }
      this.maintenanceTimer = setInterval(() => this.runPeriodicMaintenance(), 6e4);
      this.readingTimer = setInterval(() => {
        let updated = false;
        for (const win of this.windows.keys()) {
          if (this.tabs.trackReadingProgress(win, 15)) {
            this.viewedDirty = true;
            updated = true;
          }
        }
        if (updated) this.refreshAllWindows();
      }, 15e3);
    }
    stop() {
      if (!this.active) return;
      this.active = false;
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
      for (const ui of this.windows.values()) {
        ui.destroy();
      }
      this.windows.clear();
      this.disposables.disposeAll();
    }
    isActive() {
      return this.active;
    }
    onMainWindowLoad(win) {
      if (!this.active || this.windows.has(win)) return;
      const ui = new WorkspaceWindowUI(win, this.kernel.prefs, this.store, this.tabs, this.spotlight);
      ui.setCitationBadges(this.latestBadges);
      this.windows.set(win, ui);
    }
    onMainWindowUnload(win) {
      const ui = this.windows.get(win);
      if (!ui) return;
      ui.destroy();
      this.windows.delete(win);
    }
    refreshAllWindows() {
      for (const ui of this.windows.values()) {
        ui.render();
      }
    }
    setCitationBadges(badges) {
      this.latestBadges = new Map(badges);
      this.spotlight.setWordCitationBadges(badges);
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
      for (const win of this.windows.keys()) {
        const tracked = this.tabs.buildTrackedTabs(win);
        for (const id of tabIDs) {
          const tab = tracked.find((t) => t.tabID === id);
          if (!tab) continue;
          if (event === "select" || event === "add") {
            this.store.touchViewed(tab.key);
            this.viewedDirty = true;
            this.store.removeVirtualMember(tab.key);
            if (tab.sleeping) this.store.setSleeping(tab.key, false);
            if (tab.groupId && this.store.state.collapsed.includes(tab.groupId)) {
              this.store.setCollapsed(tab.groupId, false);
            }
          }
        }
      }
      if (event === "add" && this.kernel.prefs.get("workspace.newTabMode") === "collection") {
        if (this.autoGroupTimer !== null) clearTimeout(this.autoGroupTimer);
        this.autoGroupTimer = setTimeout(() => {
          this.autoGroupTimer = null;
          for (const win of this.windows.keys()) this.tabs.autoGroupByCollection(win);
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
      if (this.viewedDirty) {
        this.viewedDirty = false;
        this.store.save();
      }
      if (this.kernel.prefs.get("workspace.enableRollingSnapshots") && Date.now() - this.lastRollingAt > 9e5) {
        if (this.store.state.groups.length > 0 || this.store.state.pinnedKeys.length > 0) {
          this.store.saveSession(`自动滚动快照 ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`, { rolling: true });
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
      this.prefs.seedDefaults();
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
      if (!ioUtils?.writeUTF8) return true;
      try {
        await ioUtils.makeDirectory?.(this.getDirectoryPath(), { ignoreExisting: true });
        const payload = JSON.stringify({ version: 1, records: [...this.records.values()] });
        await ioUtils.writeUTF8(this.getFilePath(), payload);
        this.dirty = false;
        if (this.saveFailed) {
          this.saveFailed = false;
          for (const fn of this.statusListeners) fn();
        }
        return true;
      } catch {
        this.saveFailed = true;
        for (const fn of this.statusListeners) fn();
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
        this.emitCopied(items, formatted.styleID, formatted.html, formatted.text, options.source, Boolean(options.asCitation));
      }
      return ok;
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
    emitCopied(items, styleID, html, text, source, asCitation) {
      const rawText = text.trim();
      const canRecord = !asCitation || rawText.length >= 8 && !/^\[?\d+(?:[,\s\u2010-\u2015-]+\d+)*\]?$/.test(rawText);
      if (!canRecord) return;
      this.bus.emit("citation:copied", {
        itemIDs: items.map((it) => Number(it.id || 0)).filter((n) => n > 0),
        styleID,
        html,
        text,
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
          let url = "";
          if (item?.isField?.("url")) {
            try {
              url = item.getField("url", true, true) || "";
            } catch {
              url = "";
            }
          }
          let rawSetting = "";
          try {
            rawSetting = qc.getFormatFromURL?.(url) || "";
          } catch {
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
      const itemPart = items.map((it) => `${it.id || 0}:${it.getField?.("dateModified") || it.dateModified || it.version || 0}`).join(",");
      return `${asCitation ? "cite" : "bib"}|${styleID}|${itemPart}`;
    }
    async formatItems(items, options = {}) {
      const host2 = globalThis.Zotero;
      if (host2?.Styles?.init) {
        await Promise.race([
          host2.Styles.init(),
          new Promise((resolve) => setTimeout(resolve, 1e4))
        ]);
      }
      const { format, styleID } = this.resolveFormatConfig(items[0], options.styleID);
      const asCitation = Boolean(options.asCitation);
      if (!items.length) return { html: "", text: "", styleID };
      const key = this.buildCacheKey(items, styleID, asCitation);
      const cached = this.getCached(key);
      if (cached) return cached;
      let html = "";
      let text = "";
      if (host2?.QuickCopy?.getContentFromItems) {
        const res = host2.QuickCopy.getContentFromItems(items, format, null, asCitation);
        if (res === null || res === void 0 || typeof res.html !== "string" || typeof res.text !== "string") {
          throw createCslPreviewError("quickcopy-unavailable", `QuickCopy returned incomplete ${asCitation ? "citation" : "bibliography"}`);
        }
        html = res.html;
        text = res.text.trim();
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
