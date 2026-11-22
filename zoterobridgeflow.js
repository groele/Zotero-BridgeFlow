/* Zotero BridgeFlow v0.0.4 - Unified Reading Workspace, Inspector & Word Citation Tracking for Zotero 10-12. */
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
      container.append(input, btnRow, statusDiv);
      body.append(container);
      let request = 0;
      let pasteTimer;
      const cancelPaste = () => {
        if (pasteTimer !== void 0) clearTimeout(pasteTimer);
        pasteTimer = void 0;
      };
      this.cleanups.set(body, () => {
        request++;
        cancelPaste();
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
      const win = globalThis.Zotero?.getMainWindow?.();
      if (!win?.ZoteroPane) return false;
      try {
        win.Zotero_Tabs?.select?.("zotero-pane");
        const ok = await win.ZoteroPane.selectItem(itemID);
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
  var RECENT_LAUNCH_INTERVAL_MS = 500;
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
      if (!item) return false;
      const att = await this.resolveFileAttachment(item);
      if (!att) return false;
      const zotero = globalThis.Zotero;
      try {
        const filePath = await att.getFilePathAsync?.().catch(() => null) || att.getFilePath?.();
        const nsFile = filePath ? zotero?.File?.pathToFile?.(filePath) : null;
        const folder = nsFile?.parent?.path;
        const cacheKey = filePath || folder || String(att.id || "");
        if (cacheKey) {
          const now = Date.now();
          if (now - (this.lastLaunched.get(cacheKey) ?? 0) < RECENT_LAUNCH_INTERVAL_MS) return true;
          this.lastLaunched.set(cacheKey, now);
        }
        try {
          const openMode = this.kernel.prefs.get("inspector.pdfFolder.openMode");
          if (openMode === "folder" && folder && zotero?.launchFile) {
            await zotero.launchFile(folder);
            return true;
          }
          if (nsFile && nsFile.exists?.() !== false && typeof nsFile.reveal === "function") {
            await Promise.resolve(nsFile.reveal());
            return true;
          }
          const targetWin = fallbackWin?.ZoteroPane ? fallbackWin : zotero?.getMainWindow?.();
          if (targetWin?.ZoteroPane?.showAttachmentInFilesystem) {
            await targetWin.ZoteroPane.showAttachmentInFilesystem(att.id);
            return true;
          }
          if (folder && zotero?.launchFile) {
            await zotero.launchFile(folder);
            return true;
          }
        } catch (err) {
          if (cacheKey) this.lastLaunched.delete(cacheKey);
          throw err;
        }
      } catch (error) {
        this.kernel.logger.error("inspector:pdf-folder", error);
      }
      return false;
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
      if (!item) return null;
      if (item.isFileAttachment?.()) return item;
      const best = await item.getBestAttachment?.().catch(() => null);
      if (best?.isFileAttachment?.()) return best;
      const owner = await normalizeToRegularItemAsync(item);
      const pdfs = await resolvePdfAttachments(owner || item);
      return pdfs[0]?.item ?? null;
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
        label: globalThis.Zotero?.locale?.startsWith?.("zh") ? "引用" : "Citation",
        enabledTreeIDs: ["main"],
        zoteroPersist: ["width", "hidden", "sortDirection"],
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
  var SVG_NS2 = "http://www.w3.org/2000/svg";
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
