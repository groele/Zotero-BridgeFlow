import {
	collectItemAnnotations,
	normalizeHexColor,
	parseColorSemantics,
	type CollectedAnnotation,
} from './annotation-utils.ts';

export interface AnnotationMatrixRow {
	readonly itemID: number;
	readonly title: string;
	readonly creatorYear: string;
	readonly cells: Readonly<Record<string, readonly CollectedAnnotation[]>>;
}

export interface AnnotationMatrix {
	readonly columns: readonly string[];
	readonly rows: readonly AnnotationMatrixRow[];
	readonly totalAnnotations: number;
}

export interface AnnotationFilterOptions {
	readonly query?: string;
	readonly colorLabel?: string;
	readonly tag?: string;
}

export function matchesAnnotationQuery(ann: CollectedAnnotation, rawQuery: string): boolean {
	const query = String(rawQuery || '').trim().toLowerCase();
	if (!query) return true;
	const hay = `${ann.text} ${ann.comment} ${ann.itemTitle} ${ann.colorLabel} ${ann.tags.join(' ')}`.toLowerCase();
	const orClauses = query.split('||').map((s) => s.trim()).filter(Boolean);
	if (!orClauses.length) return true;
	return orClauses.some((clause) => {
		const andTerms = clause.split('&&').map((s) => s.trim()).filter(Boolean);
		return andTerms.length > 0 && andTerms.every((term) => hay.includes(term));
	});
}

export function filterCollectedAnnotations(
	list: readonly CollectedAnnotation[],
	opts: AnnotationFilterOptions = {},
): CollectedAnnotation[] {
	const wantedColor = String(opts.colorLabel || '').trim().toLowerCase();
	const wantedTag = String(opts.tag || '').trim().toLowerCase();
	return list.filter((ann) => {
		if (wantedColor && ann.colorLabel.toLowerCase() !== wantedColor && normalizeHexColor(ann.color) !== wantedColor) {
			return false;
		}
		if (wantedTag && !ann.tags.some((t) => t.toLowerCase() === wantedTag || t.toLowerCase().includes(wantedTag))) {
			return false;
		}
		return matchesAnnotationQuery(ann, opts.query || '');
	});
}

export function buildAnnotationMatrix(
	items: readonly any[],
	colorLabelsJson?: string | null,
	opts: AnnotationFilterOptions = {},
): AnnotationMatrix {
	const semantics = parseColorSemantics(colorLabelsJson);
	const all = collectItemAnnotations(items, semantics);
	const filtered = filterCollectedAnnotations(all, opts);

	const colOrder: string[] = [];
	const colSeen = new Set<string>();
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

	const byItem = new Map<number, { title: string; creatorYear: string; list: CollectedAnnotation[] }>();
	for (const raw of items) {
		const id = Number(raw?.id || 0);
		if (!id || raw?.deleted) continue;
		const title = String(raw.getField?.('title') || raw.title || `文献 #${id}`);
		const creator = String(raw.firstCreator || '').trim();
		const year = String(raw.getField?.('year') || raw.getField?.('date') || '').slice(0, 4);
		byItem.set(id, { title, creatorYear: [creator, year].filter(Boolean).join(' '), list: [] });
	}
	for (const a of filtered) {
		let bucket = byItem.get(a.itemID);
		if (!bucket) {
			bucket = { title: a.itemTitle, creatorYear: a.creatorYear, list: [] };
			byItem.set(a.itemID, bucket);
		}
		bucket.list.push(a);
	}

	const rows: AnnotationMatrixRow[] = [];
	for (const [itemID, entry] of byItem.entries()) {
		if (filtered.length > 0 && entry.list.length === 0 && (opts.query || opts.colorLabel || opts.tag)) continue;
		const cells: Record<string, CollectedAnnotation[]> = {};
		for (const col of colOrder) cells[col] = [];
		for (const a of entry.list) {
			if (!cells[a.colorLabel]) cells[a.colorLabel] = [];
			cells[a.colorLabel].push(a);
		}
		rows.push({ itemID, title: entry.title, creatorYear: entry.creatorYear, cells });
	}

	return { columns: colOrder, rows, totalAnnotations: filtered.length };
}

function formatAnnotationCellText(list: readonly CollectedAnnotation[]): string {
	return list.map((a) => {
		const page = a.pageLabel ? `[p.${a.pageLabel}] ` : '';
		const body = a.comment && a.text ? `${a.text}（评注：${a.comment}）` : (a.comment || a.text);
		return `${page}${body}`;
	}).join('；');
}

export function renderMatrixMarkdown(matrix: AnnotationMatrix, heading = '文献对比矩阵'): string {
	const cols = ['文献', ...matrix.columns];
	const header = `| ${cols.join(' | ')} |`;
	const sep = `| ${cols.map(() => '---').join(' | ')} |`;
	const lines = [`## ${heading}`, '', header, sep];
	for (const row of matrix.rows) {
		const meta = row.creatorYear ? `${row.title} (${row.creatorYear})` : row.title;
		const cells = [
			meta.replace(/\|/g, '\\|'),
			...matrix.columns.map((c) => formatAnnotationCellText(row.cells[c] || []).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')),
		];
		lines.push(`| ${cells.join(' | ')} |`);
	}
	return lines.join('\n');
}

function csvCell(val: string): string {
	const s = String(val || '');
	return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function renderMatrixCsv(matrix: AnnotationMatrix): string {
	const header = ['文献', '作者年份', ...matrix.columns].map(csvCell).join(',');
	const rows = matrix.rows.map((row) => [
		row.title,
		row.creatorYear,
		...matrix.columns.map((c) => formatAnnotationCellText(row.cells[c] || [])),
	].map(csvCell).join(','));
	return [header, ...rows].join('\n');
}

function escHtml(s: string): string {
	return String(s || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export function renderMatrixHtmlNote(matrix: AnnotationMatrix, heading = 'BridgeFlow 文献对比矩阵'): string {
	const ths = ['文献', ...matrix.columns].map((c) => `<th>${escHtml(c)}</th>`).join('');
	const trs = matrix.rows.map((row) => {
		const meta = row.creatorYear ? `${escHtml(row.title)}<br/><small>${escHtml(row.creatorYear)}</small>` : escHtml(row.title);
		const tds = matrix.columns.map((c) => `<td>${escHtml(formatAnnotationCellText(row.cells[c] || []))}</td>`).join('');
		return `<tr><td>${meta}</td>${tds}</tr>`;
	}).join('');
	return `<h2>${escHtml(heading)}</h2><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

export async function saveMatrixAsZoteroNote(
	matrix: AnnotationMatrix,
	heading: string,
	libraryID?: number,
): Promise<number | null> {
	const ZoteroObj = (globalThis as any).Zotero;
	const ItemCtor = ZoteroObj?.Item;
	if (typeof ItemCtor !== 'function') return null;
	try {
		const note = new ItemCtor('note');
		note.libraryID = libraryID || Number(ZoteroObj?.Libraries?.userLibraryID || 1);
		note.setNote(renderMatrixHtmlNote(matrix, heading));
		const id = await note.saveTx?.();
		return Number(id || note.id || 0) || null;
	} catch {
		return null;
	}
}
