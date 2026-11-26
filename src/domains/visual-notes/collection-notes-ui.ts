import { mountReadingIndex, type ReadingSelection } from './reading-index.ts';
import { READING_LAYOUT_CSS } from './reading-layout.ts';
import type { CollectedAnnotation } from '../../services/annotation-utils.ts';
import type { UnifiedClipboardService } from '../../services/clipboard-service.ts';
import { formatHubAnnotationBody, type ItemNotesAggregate } from '../../services/collection-notes.ts';
import { renderHighlightedSnippet, writeMatrixClipboard } from './annotation-matrix-ui.ts';
import { openItemPdfAtPage } from './column-popover-styles.ts';
import { readItemRemarkWithFallback, writeItemRemarkWithSync, type VisualNotesDataSource } from './data-source.ts';
import { createGallerySvgIcon, renderRichTitleNodes, resolvePastelTagStyle } from './gallery-icons.ts';

const HUB_STYLE_ID = 'zbf-collection-hub-style';

export const COLLECTION_HUB_CSS = `
.zbf-notebook-backdrop { display: flex; flex: 1 1 auto; width: 100%; height: 100%; min-height: 0; min-width: 0; }
.zbf-notebook-dialog { box-sizing: border-box; width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; background: light-dark(#ffffff, #131c2e); color: light-dark(#0f172a, #e2e8f0); font: 13px/1.48 system-ui, "Microsoft YaHei UI", sans-serif; }
.zbf-notebook-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-bottom: 4px; }
.zbf-notebook-title-wrap { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.zbf-notebook-title { font-size: 15.5px; font-weight: 650; letter-spacing: -0.01em; }
.zbf-notebook-seg { display: inline-flex; padding: 3px; border-radius: 9px; background: light-dark(#f1f5f9, #1e293b); gap: 2px; }
.zbf-notebook-seg-btn { border: 0; border-radius: 6px; padding: 4px 11px; background: transparent; color: light-dark(#64748b, #94a3b8); font-family: inherit; font-size: 12px; font-weight: 500; line-height: 1.25; cursor: pointer; transition: background-color 0.14s, color 0.14s, box-shadow 0.14s; }
.zbf-notebook-seg-btn:hover { color: light-dark(#0f172a, #f8fafc); }
.zbf-notebook-seg-btn[data-active="true"] { background: light-dark(#ffffff, #334155); color: light-dark(#0f172a, #ffffff); font-weight: 600; box-shadow: 0 1px 3px rgba(15,23,42,0.08); }

.zbf-notebook-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.zbf-notebook-search { flex: 1 1 240px; min-width: 180px; height: 32px; padding: 0 12px; border-radius: 8px; border: 1px solid light-dark(rgba(15,23,42,0.1), rgba(148,163,184,0.22)); background: light-dark(#f8fafc, #0f172a); color: inherit; font: inherit; transition: border-color 0.14s, background-color 0.14s; }
.zbf-notebook-search:focus { outline: none; background: light-dark(#ffffff, #0f172a); border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.12); }
.zbf-notebook-toggles { display: inline-flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 12px; color: light-dark(#475569, #cbd5e1); }
.zbf-notebook-check { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; user-select: none; }
.zbf-notebook-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.zbf-notebook-scroll { flex: 1 1 auto; overflow-y: auto; border: 1px solid light-dark(rgba(15,23,42,0.065), rgba(148,163,184,0.14)); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 10px; background: light-dark(#fafafa, #0d1320); }
.zbf-notebook-card { padding: 12px 14px; border-radius: 12px; background: light-dark(#ffffff, #162032); border: 1px solid light-dark(rgba(15,23,42,0.07), rgba(148,163,184,0.14)); box-shadow: 0 1px 2px rgba(15,23,42,0.025); display: flex; flex-direction: column; gap: 8px; transition: box-shadow 0.14s ease; }
.zbf-notebook-card:hover { box-shadow: 0 6px 18px rgba(15,23,42,0.05); }
.zbf-notebook-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.zbf-notebook-item-btn { display: inline-flex; align-items: flex-start; gap: 6px; border: 0; padding: 0; background: transparent; color: light-dark(#0f172a, #f1f5f9); font-family: inherit; font-size: 13.2px; font-weight: 600; line-height: 1.4; text-align: left; cursor: pointer; }
.zbf-notebook-item-btn:hover { color: light-dark(#2563eb, #60a5fa); }
.zbf-notebook-item-btn sub, .zbf-notebook-item-btn sup { font-size: 0.74em; line-height: 0; }
.zbf-notebook-meta { font-size: 11.5px; color: light-dark(#94a3b8, #64748b); flex: none; white-space: nowrap; }

.zbf-notebook-ann-row { padding: 7px 10px; border-radius: 7px; border-left: 3px solid #3b82f6; background: light-dark(#f8fafc, rgba(255,255,255,0.035)); cursor: pointer; display: flex; flex-direction: column; gap: 4px; font-size: 12.4px; line-height: 1.5; transition: background-color 0.12s; }
.zbf-notebook-ann-row:hover { background: light-dark(#eff6ff, rgba(96,165,250,0.12)); }
.zbf-notebook-ann-tags { display: inline-flex; gap: 5px; flex-wrap: wrap; }
.zbf-notebook-ann-tag { padding: 1px 6px; border-radius: 4px; font-size: 10.8px; font-weight: 500; }

.zbf-notebook-brief-row { display: flex; align-items: center; gap: 8px; }
.zbf-notebook-brief-lbl { padding: 2px 7px; border-radius: 5px; font-size: 11px; font-weight: 600; background: light-dark(#dcfce7, rgba(34,197,94,0.18)); color: light-dark(#166534, #86efac); flex: none; }
.zbf-notebook-brief-input { flex: 1 1 auto; height: 28px; padding: 0 9px; border-radius: 7px; border: 1px solid light-dark(rgba(15,23,42,0.08), rgba(148,163,184,0.18)); background: light-dark(#f8fafc, #0f172a); color: inherit; font-family: inherit; font-size: 12.2px; line-height: 1.2; transition: border-color 0.14s, background-color 0.14s; }
.zbf-notebook-brief-input:focus { outline: none; background: light-dark(#ffffff, #0f172a); border-color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,0.12); }

.zbf-notebook-note-box { padding: 8px 10px; border-radius: 8px; background: light-dark(#f8fafc, rgba(255,255,255,0.035)); border: 1px solid light-dark(rgba(15,23,42,0.06), rgba(148,163,184,0.12)); font-size: 12.2px; line-height: 1.52; color: light-dark(#334155, #cbd5e1); }
.zbf-notebook-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding-top: 2px; }
`;

export function hubEl<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K): HTMLElementTagNameMap[K] {
	return doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K];
}

export function ensureCollectionHubStyles(doc: Document): void {
	if (!doc) return;
	const existing = doc.getElementById(HUB_STYLE_ID);
	if (existing) {
		if (existing.textContent !== COLLECTION_HUB_CSS + READING_LAYOUT_CSS) existing.textContent = COLLECTION_HUB_CSS + READING_LAYOUT_CSS;
		return;
	}
	const style = hubEl(doc, 'style');
	style.id = HUB_STYLE_ID;
	style.textContent = COLLECTION_HUB_CSS + READING_LAYOUT_CSS;
	(doc.head || doc.documentElement)?.appendChild(style);
}

export function renderHubAnnotationsList(opts: {
	doc: Document;
	scroll: HTMLElement;
	selection?: ReadingSelection;
	annotations: readonly CollectedAnnotation[];
	colorHexByLabel: ReadonlyMap<string, string>;
	preferComment: boolean;
	terms: readonly string[];
	zh: boolean;
	clipboard?: UnifiedClipboardService;
	onStatus: (msg: string) => void;
	onOpenItem: (itemID: number) => void;
}): void {
	const { doc, scroll, annotations, colorHexByLabel, preferComment, terms, zh } = opts;
	if (!annotations.length) {
		const empty = hubEl(doc, 'div');
		empty.className = 'zbf-matrix-empty';
		empty.textContent = zh ? '当前范围与筛选条件下暂无标注。' : 'No matching annotations in this scope.';
		scroll.appendChild(empty);
		return;
	}
	const byItem = new Map<number, CollectedAnnotation[]>();
	for (const a of annotations) {
		const list = byItem.get(a.itemID) || [];
		list.push(a);
		byItem.set(a.itemID, list);
	}
	mountReadingIndex(scroll, Array.from(byItem, ([id, list]) => {
		const weight = 2.2 + list.reduce((sum, a) => sum + 1.8 + Math.ceil((a.text.length + a.comment.length) / 90) * 0.9, 0);
		return { id, title: list[0].itemTitle, meta: list[0].creatorYear, count: list.length, weight, list };
	}), zh, opts.selection, ({ id: itemID, list }, page) => {
		const card = hubEl(doc, 'div');
		card.className = 'zbf-notebook-card';
		const head = hubEl(doc, 'div');
		head.className = 'zbf-notebook-card-head';
		const headMain = hubEl(doc, 'div');
		headMain.className = 'zbf-notebook-item-head-main';
		const itemBtn = hubEl(doc, 'button');
		itemBtn.type = 'button';
		itemBtn.className = 'zbf-notebook-item-btn';
		itemBtn.appendChild(createGallerySvgIcon(doc, 'doc', 15));
		const titleSpan = hubEl(doc, 'span');
		renderRichTitleNodes(doc, titleSpan, list[0].itemTitle);
		itemBtn.appendChild(titleSpan);
		itemBtn.addEventListener('click', () => {
			void openItemPdfAtPage({ id: itemID }).then((ok) => { if (!ok) opts.onOpenItem(itemID); });
		});
		const meta = hubEl(doc, 'span');
		meta.className = 'zbf-notebook-meta';
		meta.textContent = [list[0].creatorYear, zh ? `${list.length} 条标注` : `${list.length} notes`].filter(Boolean).join(' · ');
		headMain.append(itemBtn, meta);
		const openBtn = hubEl(doc, 'button');
		openBtn.type = 'button';
		openBtn.className = 'zbf-reading-open-pill';
		openBtn.textContent = zh ? '打开文献' : 'Open';
		openBtn.addEventListener('click', () => {
			void openItemPdfAtPage({ id: itemID }).then((ok) => { if (!ok) opts.onOpenItem(itemID); });
		});
		head.append(headMain, openBtn);
		card.appendChild(head);

		const annGrid = hubEl(doc, 'div');
		annGrid.className = 'zbf-notebook-ann-grid';
		if (list.length > 1) annGrid.setAttribute('data-multi', 'true');

		for (const ann of list) {
			const row = hubEl(doc, 'div');
			row.className = 'zbf-notebook-ann-row';
			const accent = colorHexByLabel.get(ann.colorLabel) || ann.color || '#3b82f6';
			row.style.borderInlineStartColor = accent;
			const body = formatHubAnnotationBody(ann, preferComment);
			const bar = hubEl(doc, 'div');
			bar.className = 'zbf-reading-ref';
			const refLeft = hubEl(doc, 'div');
			refLeft.className = 'zbf-reading-ref-left';
			const badge = hubEl(doc, 'span');
			badge.className = 'zbf-ann-badge';
			const dot = hubEl(doc, 'span');
			dot.className = 'zbf-ann-badge-dot';
			dot.style.background = accent;
			const lbl = hubEl(doc, 'span');
			lbl.textContent = ann.colorLabel || 'Note';
			badge.append(dot, lbl);
			refLeft.appendChild(badge);
			if (ann.pageLabel) {
				const pg = hubEl(doc, 'span');
				pg.className = 'zbf-ann-page';
				pg.textContent = `p. ${ann.pageLabel}`;
				refLeft.appendChild(pg);
			}
			const refActs = hubEl(doc, 'div');
			refActs.className = 'zbf-reading-ref-actions';
			const jump = hubEl(doc, 'button');
			jump.type = 'button';
			jump.textContent = zh ? '跳至 PDF' : 'Open PDF';
			jump.addEventListener('click', () => {
				void openItemPdfAtPage({ id: itemID }, Number(ann.pageLabel) || undefined, ann.annotationID).then((ok) => {
					if (!ok) opts.onOpenItem(itemID);
				});
			});
			const copy = hubEl(doc, 'button');
			copy.type = 'button';
			const defaultCopyLabel = zh ? '复制' : 'Copy';
			copy.textContent = defaultCopyLabel;
			copy.addEventListener('click', () => {
				const ok = writeMatrixClipboard(body, opts.clipboard);
				copy.textContent = ok ? (zh ? '✓ 已复制' : '✓ Copied') : (zh ? '复制失败' : 'Copy failed');
				if (ok) copy.setAttribute('data-copied', 'true');
				opts.onStatus(copy.textContent);
				doc.defaultView?.setTimeout?.(() => {
					if (copy.isConnected) {
						copy.textContent = defaultCopyLabel;
						copy.removeAttribute('data-copied');
					}
				}, 1600);
			});
			refActs.append(jump, copy);
			bar.append(refLeft, refActs);
			row.appendChild(bar);
			if (ann.text && !(preferComment && ann.comment)) {
				const quote = hubEl(doc, 'blockquote');
				renderHighlightedSnippet(doc, quote, ann.text, terms);
				row.appendChild(quote);
			}
			if (ann.comment) {
				const comment = hubEl(doc, 'p');
				comment.className = 'zbf-reading-comment';
				const label = hubEl(doc, 'strong');
				label.textContent = zh ? '评注' : 'Comment';
				const content = hubEl(doc, 'span');
				renderHighlightedSnippet(doc, content, ann.comment, terms);
				comment.append(label, content);
				row.appendChild(comment);
			}
			if (ann.tags.length) {
				const tagRow = hubEl(doc, 'div');
				tagRow.className = 'zbf-notebook-ann-tags';
				for (const t of ann.tags) {
					const pill = hubEl(doc, 'span');
					pill.className = 'zbf-notebook-ann-tag';
					const pal = resolvePastelTagStyle(t);
					pill.style.background = `light-dark(${pal.bg}, ${pal.darkBg})`;
					pill.style.color = `light-dark(${pal.fg}, ${pal.darkFg})`;
					pill.textContent = t;
					tagRow.appendChild(pill);
				}
				row.appendChild(tagRow);
			}
			annGrid.appendChild(row);
		}
		card.appendChild(annGrid);
		page.appendChild(card);
	});
}

export function renderHubNotesList(opts: {
	doc: Document;
	win: Window;
	scroll: HTMLElement;
	selection?: ReadingSelection;
	entries: readonly ItemNotesAggregate[];
	syncExtra: boolean;
	dataSource?: VisualNotesDataSource;
	terms: readonly string[];
	zh: boolean;
	onRemarkMutated?: () => void;
	onStatus: (msg: string) => void;
	onOpenItem?: (itemID: number) => void;
}): void {
	const { doc, win, scroll, entries, syncExtra, dataSource, terms, zh } = opts;
	if (!entries.length) {
		const empty = hubEl(doc, 'div');
		empty.className = 'zbf-matrix-empty';
		empty.textContent = zh ? '当前范围下暂无匹配的文献或笔记。' : 'No matching items or notes.';
		scroll.appendChild(empty);
		return;
	}
	mountReadingIndex(scroll, entries.map(entry => ({
		id: entry.itemID, title: entry.title, meta: entry.creatorYear,
		count: entry.childNotes.length + Number(Boolean(entry.briefNote)),
		weight: 2.2 + entry.childNotes.length * 1.6 + (entry.briefNote ? 0.6 : 0),
		entry,
	})), zh, opts.selection, ({ entry }, page) => {
		const card = hubEl(doc, 'div');
		card.className = 'zbf-notebook-card';
		const head = hubEl(doc, 'div');
		head.className = 'zbf-notebook-card-head';
		const headMain = hubEl(doc, 'div');
		headMain.className = 'zbf-notebook-item-head-main';
		const itemBtn = hubEl(doc, 'button');
		itemBtn.type = 'button';
		itemBtn.className = 'zbf-notebook-item-btn';
		itemBtn.appendChild(createGallerySvgIcon(doc, 'doc', 15));
		const titleSpan = hubEl(doc, 'span');
		renderRichTitleNodes(doc, titleSpan, entry.title);
		itemBtn.appendChild(titleSpan);
		const openEntry = () => {
			if (opts.onOpenItem) opts.onOpenItem(entry.itemID);
			else (win as any).ZoteroPane?.itemsView?.selectItem?.(entry.itemID);
		};
		itemBtn.addEventListener('click', openEntry);
		const meta = hubEl(doc, 'span');
		meta.className = 'zbf-notebook-meta';
		meta.textContent = entry.creatorYear;
		headMain.append(itemBtn, meta);
		const openBtn = hubEl(doc, 'button');
		openBtn.type = 'button';
		openBtn.className = 'zbf-reading-open-pill';
		openBtn.textContent = zh ? '打开文献' : 'Open';
		openBtn.addEventListener('click', openEntry);
		head.append(headMain, openBtn);

		const briefRow = hubEl(doc, 'div');
		briefRow.className = 'zbf-notebook-brief-row';
		const briefLbl = hubEl(doc, 'span');
		briefLbl.className = 'zbf-notebook-brief-lbl';
		briefLbl.textContent = zh ? '简记' : 'Brief';
		const briefInput = hubEl(doc, 'input');
		briefInput.type = 'text';
		briefInput.className = 'zbf-notebook-brief-input';
		briefInput.value = entry.briefNote;
		briefInput.placeholder = zh ? '添加简记…' : 'Add a brief note…';
		briefInput.setAttribute('aria-label', briefLbl.textContent);
		const commitBrief = async () => {
			const nextVal = briefInput.value.trim();
			if (nextVal === readItemRemarkWithFallback(entry.item, dataSource)) return;
			writeItemRemarkWithSync(entry.item, nextVal, syncExtra, dataSource);
			opts.onRemarkMutated?.();
			const saved = await dataSource?.persistRemarks?.().catch(() => false);
			opts.onStatus(saved
				? (zh ? '✓ 简记已保存至 brief-notes.json' : '✓ Brief note saved')
				: (zh ? '简记未能确认写入磁盘。' : 'Brief note could not be confirmed on disk.'));
		};
		briefInput.addEventListener('blur', commitBrief);
		briefInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); briefInput.blur(); }
		});
		briefRow.append(briefLbl, briefInput);
		card.append(head, briefRow);

		for (const cn of entry.childNotes) {
			const noteBox = hubEl(doc, 'details');
			const summary = hubEl(doc, 'summary');
			summary.textContent = cn.heading;
			const excerpt = hubEl(doc, 'p');
			noteBox.className = 'zbf-notebook-note-box';
			renderHighlightedSnippet(doc, excerpt, `${cn.dateModified ? `[${cn.dateModified}] ` : ''}${cn.snippet}`, terms);
			const open = hubEl(doc, 'button');
			open.type = 'button';
			open.textContent = zh ? '打开完整笔记' : 'Open full note';
			open.addEventListener('click', () => (win as any).ZoteroPane?.openNote?.(cn.noteID, { openInWindow: false }));
			noteBox.append(summary, excerpt, open);
			card.appendChild(noteBox);
		}
		page.appendChild(card);
	});
}
