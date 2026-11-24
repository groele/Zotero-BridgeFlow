import { filterCollectedAnnotations, matchesAnnotationQuery } from './annotation-matrix.ts';
import { collectItemAnnotations, parseColorSemantics, type CollectedAnnotation } from './annotation-utils.ts';

export type HubScopeMode = 'collection' | 'selected' | 'tabs';

export interface ChildNoteSummary {
	readonly noteID: number;
	readonly heading: string;
	readonly snippet: string;
	readonly dateModified: string;
}

export interface ItemNotesAggregate {
	readonly item: any;
	readonly itemID: number;
	readonly title: string;
	readonly creatorYear: string;
	readonly briefNote: string;
	readonly childNotes: readonly ChildNoteSummary[];
}

const FIG_TABLE_RE = /^(?:fig(?:ure)?|tab(?:le|el)?|图|表)\b/i;

export function isFigureOrTableAnnotation(ann: CollectedAnnotation): boolean {
	for (const t of ann.tags) {
		if (FIG_TABLE_RE.test(String(t || '').trim())) return true;
	}
	return FIG_TABLE_RE.test(String(ann.comment || '').trim());
}

export function stripNoteHtml(rawHtml: string): { heading: string; snippet: string } {
	const raw = String(rawHtml || '');
	if (!raw.trim()) return { heading: '', snippet: '' };
	const withBreaks = raw
		.replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/<\/?(?:sub|sup|i|b|strong|em)>/gi, '');
	const lines = withBreaks
		.split(/\r?\n/)
		.map((l) => l.replace(/\s+/g, ' ').trim())
		.filter(Boolean);
	const heading = (lines[0] || '').slice(0, 80);
	const body = lines.join(' · ').slice(0, 360);
	return { heading, snippet: body };
}

function resolveRegularParent(raw: any): any {
	if (!raw || raw.deleted) return null;
	const hostItems = (globalThis as any).Zotero?.Items;
	if (typeof raw.isRegularItem === 'function') {
		if (raw.isRegularItem()) return raw;
		if (raw.parentItemID) {
			const parent = hostItems?.get?.(raw.parentItemID);
			if (parent && !parent.deleted && parent.isRegularItem?.()) return parent;
		}
		return null;
	}
	if (raw.parentItemID && hostItems?.get) {
		return hostItems.get(raw.parentItemID) || raw;
	}
	return raw;
}

export function resolveHubScopeItems(win: Window, mode: HubScopeMode, zh = true): {
	scopeTitle: string;
	items: any[];
	libraryID?: number;
	collectionID?: number;
} {
	const pane = (win as any)?.ZoteroPane;
	const seen = new Set<number>();
	const items: any[] = [];
	const push = (raw: any) => {
		const reg = resolveRegularParent(raw);
		const id = Number(reg?.id || 0);
		if (id > 0 && !seen.has(id)) {
			seen.add(id);
			items.push(reg);
		}
	};

	let collectionID: number | undefined;
	let libraryID: number | undefined;
	try {
		const treeRow = pane?.getCollectionTreeRow?.();
		if (treeRow?.isCollection?.() && treeRow.ref?.id) {
			collectionID = Number(treeRow.ref.id);
			libraryID = Number(treeRow.ref.libraryID || 1);
		} else if (treeRow?.ref?.libraryID) {
			libraryID = Number(treeRow.ref.libraryID);
		}
	} catch { /* ignore */ }

	if (mode === 'selected') {
		for (const it of pane?.getSelectedItems?.() || []) push(it);
		return {
			scopeTitle: zh ? '当前选中文献' : 'Selected Items',
			items,
			libraryID: libraryID || items[0]?.libraryID,
			collectionID,
		};
	}

	if (mode === 'tabs') {
		const hostItems = (globalThis as any).Zotero?.Items;
		for (const t of (win as any)?.Zotero_Tabs?._tabs || []) {
			const id = Number(t?.data?.itemID || 0);
			if (id > 0) push(hostItems?.get?.(id) || { id });
		}
		return {
			scopeTitle: zh ? '已打开阅读标签' : 'Open Reader Tabs',
			items,
			libraryID: libraryID || items[0]?.libraryID,
			collectionID,
		};
	}

	const view = pane?.itemsView;
	const rowCount = Math.min(Number(view?.rowCount || 0), 2500);
	for (let i = 0; i < rowCount; i++) {
		push(view?.getRow?.(i)?.ref);
	}
	const colName = String(pane?.getSelectedCollections?.()?.[0]?.name || pane?.getCollectionTreeRow?.()?.ref?.name || '').trim();
	const scopeTitle = colName || (zh ? '当前视图全部文献' : 'Current Library View');
	return {
		scopeTitle,
		items,
		libraryID: libraryID || items[0]?.libraryID,
		collectionID,
	};
}

export function collectHubAnnotations(
	items: readonly any[],
	colorLabelsJson: string | null | undefined,
	opts: { query?: string; colorLabel?: string; ignoreFigureTable?: boolean } = {},
): {
	totalBeforeFilter: number;
	annotations: CollectedAnnotation[];
	colorCounts: Map<string, number>;
	colorHexByLabel: Map<string, string>;
} {
	const semantics = parseColorSemantics(colorLabelsJson);
	const colorHexByLabel = new Map<string, string>();
	for (const [hex, lbl] of Object.entries(semantics)) {
		if (!colorHexByLabel.has(lbl)) colorHexByLabel.set(lbl, hex);
	}
	let base = collectItemAnnotations(items, semantics);
	if (opts.ignoreFigureTable) {
		base = base.filter((a) => !isFigureOrTableAnnotation(a));
	}
	const colorCounts = new Map<string, number>();
	for (const a of base) {
		colorCounts.set(a.colorLabel, (colorCounts.get(a.colorLabel) || 0) + 1);
	}
	const annotations = filterCollectedAnnotations(base, {
		query: opts.query,
		colorLabel: opts.colorLabel,
	});
	return {
		totalBeforeFilter: base.length,
		annotations,
		colorCounts,
		colorHexByLabel,
	};
}

function matchesBooleanText(haystack: string, rawQuery: string): boolean {
	const q = String(rawQuery || '').trim().toLowerCase();
	if (!q) return true;
	const hay = haystack.toLowerCase();
	const orParts = q.split('||').map((s) => s.trim()).filter(Boolean);
	if (!orParts.length) return true;
	return orParts.some((clause) => {
		const andTerms = clause.split('&&').map((s) => s.trim()).filter(Boolean);
		return andTerms.length > 0 && andTerms.every((t) => hay.includes(t));
	});
}

export function collectHubNotes(
	items: readonly any[],
	getBriefNote: (item: any) => string,
	query = '',
): { entries: ItemNotesAggregate[]; totalChildNotes: number; totalBriefNotes: number } {
	const hostItems = (globalThis as any).Zotero?.Items;
	const entries: ItemNotesAggregate[] = [];
	let totalChildNotes = 0;
	let totalBriefNotes = 0;

	for (const item of items) {
		const itemID = Number(item?.id || 0);
		if (!itemID || item?.deleted) continue;
		const title = String(item.getField?.('title') || item.title || `#${itemID}`);
		const creator = String(item.firstCreator || '').trim();
		const year = String(item.getField?.('year') || item.getField?.('date') || '').slice(0, 4);
		const creatorYear = [creator, year].filter(Boolean).join(' ');
		const briefNote = String(getBriefNote(item) || '').trim();

		const childNotes: ChildNoteSummary[] = [];
		const noteIDs: number[] = typeof item.getNotes === 'function' ? (item.getNotes() || []) : [];
		for (const nid of noteIDs) {
			const noteItem = hostItems?.get?.(nid);
			if (!noteItem || noteItem.deleted) continue;
			const rawHtml = String(noteItem.getNote?.() || noteItem.note || '');
			const parsed = stripNoteHtml(rawHtml);
			if (!parsed.snippet) continue;
			childNotes.push({
				noteID: Number(nid),
				heading: parsed.heading || '笔记',
				snippet: parsed.snippet,
				dateModified: String(noteItem.dateModified || '').slice(0, 10),
			});
		}

		const hay = [title, creatorYear, briefNote, ...childNotes.map((n) => `${n.heading} ${n.snippet}`)].join(' ');
		if (!matchesBooleanText(hay, query)) continue;
		if (query.trim() && !briefNote && !childNotes.length && !matchesBooleanText(`${title} ${creatorYear}`, query)) {
			continue;
		}
		if (briefNote) totalBriefNotes++;
		totalChildNotes += childNotes.length;
		entries.push({ item, itemID, title, creatorYear, briefNote, childNotes });
	}
	return { entries, totalChildNotes, totalBriefNotes };
}

export function formatHubAnnotationBody(ann: CollectedAnnotation, preferCommentOverQuote: boolean): string {
	const page = ann.pageLabel ? `[p.${ann.pageLabel}] ` : '';
	if (preferCommentOverQuote && ann.comment) {
		return `${page}${ann.comment}`;
	}
	if (ann.comment && ann.text) {
		return `${page}${ann.text}（评注：${ann.comment}）`;
	}
	return `${page}${ann.comment || ann.text}`;
}

export function renderCollectionHubMarkdown(
	heading: string,
	notes: readonly ItemNotesAggregate[],
	annotations: readonly CollectedAnnotation[],
	preferCommentOverQuote = false,
): string {
	const byItemAnn = new Map<number, CollectedAnnotation[]>();
	for (const a of annotations) {
		const arr = byItemAnn.get(a.itemID) || [];
		arr.push(a);
		byItemAnn.set(a.itemID, arr);
	}
	const lines: string[] = [`# ${heading}`, ''];
	for (const entry of notes) {
		const anns = byItemAnn.get(entry.itemID) || [];
		if (!entry.briefNote && !entry.childNotes.length && !anns.length) continue;
		lines.push(`## ${entry.title}${entry.creatorYear ? ` (${entry.creatorYear})` : ''}`);
		if (entry.briefNote) lines.push(`- **简记**：${entry.briefNote}`);
		for (const cn of entry.childNotes) {
			lines.push(`- **子笔记**${cn.dateModified ? ` [${cn.dateModified}]` : ''}：${cn.snippet}`);
		}
		for (const ann of anns) {
			lines.push(`- **[${ann.colorLabel}]** ${formatHubAnnotationBody(ann, preferCommentOverQuote)}`);
		}
		lines.push('');
	}
	return lines.join('\n').trim();
}

function escHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function saveCollectionHubAsZoteroNote(options: {
	heading: string;
	notes: readonly ItemNotesAggregate[];
	annotations: readonly CollectedAnnotation[];
	preferCommentOverQuote?: boolean;
	libraryID?: number;
	collectionID?: number;
}): Promise<number | null> {
	const ZoteroObj = (globalThis as any).Zotero;
	const ItemCtor = ZoteroObj?.Item;
	if (typeof ItemCtor !== 'function') return null;
	const byItemAnn = new Map<number, CollectedAnnotation[]>();
	for (const a of options.annotations) {
		const arr = byItemAnn.get(a.itemID) || [];
		arr.push(a);
		byItemAnn.set(a.itemID, arr);
	}
	const sections: string[] = [`<h2>${escHtml(options.heading)}</h2>`];
	for (const entry of options.notes) {
		const anns = byItemAnn.get(entry.itemID) || [];
		if (!entry.briefNote && !entry.childNotes.length && !anns.length) continue;
		sections.push(`<h3>${escHtml(entry.title)}${entry.creatorYear ? ` <small>(${escHtml(entry.creatorYear)})</small>` : ''}</h3><ul>`);
		if (entry.briefNote) sections.push(`<li><strong>简记：</strong>${escHtml(entry.briefNote)}</li>`);
		for (const cn of entry.childNotes) {
			sections.push(`<li><strong>子笔记：</strong>${escHtml(cn.snippet)}</li>`);
		}
		for (const ann of anns) {
			sections.push(`<li><strong>[${escHtml(ann.colorLabel)}]</strong> ${escHtml(formatHubAnnotationBody(ann, Boolean(options.preferCommentOverQuote)))}</li>`);
		}
		sections.push('</ul>');
	}
	try {
		const note = new ItemCtor('note');
		note.libraryID = options.libraryID || Number(ZoteroObj?.Libraries?.userLibraryID || 1);
		note.setNote(sections.join(''));
		if (options.collectionID && typeof note.addToCollection === 'function') {
			note.addToCollection(options.collectionID);
		}
		const id = await note.saveTx?.();
		return Number(id || note.id || 0) || null;
	} catch {
		return null;
	}
}

export { matchesAnnotationQuery };
