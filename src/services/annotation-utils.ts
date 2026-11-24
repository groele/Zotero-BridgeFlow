export const DEFAULT_ANNOTATION_COLORS: Readonly<Record<string, string>> = {
	'#ffd400': '背景',
	'#ff6666': '方法',
	'#5fb236': '不足',
	'#2ea8e5': '创新',
	'#a28ae5': '结论',
	'#e56eee': '引用',
	'#f19837': '数据',
	'#aaaaaa': '备注',
};

export interface CollectedAnnotation {
	readonly itemID: number;
	readonly itemTitle: string;
	readonly creatorYear: string;
	readonly annotationID: number;
	readonly color: string;
	readonly colorLabel: string;
	readonly text: string;
	readonly comment: string;
	readonly pageLabel: string;
	readonly tags: readonly string[];
}

export function normalizeHexColor(color: string | null | undefined): string {
	const clean = String(color || '').trim().toLowerCase();
	if (/^#[0-9a-f]{6}$/.test(clean)) return clean;
	if (/^#[0-9a-f]{3}$/.test(clean)) {
		return `#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`;
	}
	return clean;
}

export function parseColorSemantics(rawJson?: string | null): Record<string, string> {
	const merged: Record<string, string> = { ...DEFAULT_ANNOTATION_COLORS };
	const raw = String(rawJson || '').trim();
	if (!raw) return merged;
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			for (const [k, v] of Object.entries(parsed)) {
				const hex = normalizeHexColor(k);
				const label = String(v || '').trim();
				if (hex && label) merged[hex] = label;
			}
		} else if (Array.isArray(parsed)) {
			for (const entry of parsed) {
				if (!Array.isArray(entry) || entry.length < 2) continue;
				const a = String(entry[0] || '').trim();
				const b = String(entry[1] || '').trim();
				const aHex = /^#[0-9a-f]{3,6}$/i.test(a);
				const bHex = /^#[0-9a-f]{3,6}$/i.test(b);
				if (aHex && b) merged[normalizeHexColor(a)] = b;
				else if (bHex && a) merged[normalizeHexColor(b)] = a;
			}
		}
	} catch { /* fallback to defaults */ }
	return merged;
}

export function resolveColorLabel(color: string | null | undefined, semantics: Readonly<Record<string, string>>): string {
	const hex = normalizeHexColor(color);
	return (hex && semantics[hex]) || hex || '未分类';
}

function joinAnnotationText(parts: readonly string[]): string {
	let acc = '';
	for (const raw of parts) {
		const piece = String(raw || '').trim();
		if (!piece) continue;
		if (!acc) {
			acc = piece;
		} else if (acc.endsWith('-') && /^[a-zA-Z]/.test(piece)) {
			acc = acc.slice(0, -1) + piece;
		} else {
			acc = `${acc} ${piece}`;
		}
	}
	return acc;
}

function compareAnnotationsByOrder(a: any, b: any): number {
	const sa = String(a?.annotationSortIndex || '');
	const sb = String(b?.annotationSortIndex || '');
	if (sa && sb && sa !== sb) return sa.localeCompare(sb);
	const pa = Number(a?.annotationPageLabel || 0);
	const pb = Number(b?.annotationPageLabel || 0);
	if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
	return Number(a?.id || 0) - Number(b?.id || 0);
}

export function mergeAnnotationPayloads(annotations: readonly any[]): {
	mergedText: string;
	mergedComment: string;
	mergedPosition: string;
} {
	const sorted = [...annotations].sort(compareAnnotationsByOrder);
	const texts: string[] = [];
	const comments: string[] = [];
	const commentSeen = new Set<string>();
	let basePos: Record<string, any> | null = null;
	const allRects: any[] = [];

	for (const ann of sorted) {
		const t = String(ann?.annotationText ?? ann?.getField?.('annotationText') ?? '').trim();
		if (t) texts.push(t);
		const c = String(ann?.annotationComment ?? ann?.getField?.('annotationComment') ?? '').trim();
		if (c && !commentSeen.has(c)) {
			commentSeen.add(c);
			comments.push(c);
		}
		const posRaw = ann?.annotationPosition ?? ann?.getField?.('annotationPosition');
		if (typeof posRaw === 'string' && posRaw.trim()) {
			try {
				const parsed = JSON.parse(posRaw);
				if (parsed && typeof parsed === 'object') {
					if (!basePos) basePos = { ...parsed };
					if (basePos && Array.isArray(parsed.rects) && parsed.pageIndex === basePos.pageIndex) {
						allRects.push(...parsed.rects);
					}
				}
			} catch { /* ignore invalid position JSON */ }
		}
	}

	if (basePos && allRects.length) {
		basePos.rects = allRects;
	}
	return {
		mergedText: joinAnnotationText(texts),
		mergedComment: comments.join('\n'),
		mergedPosition: basePos ? JSON.stringify(basePos) : '',
	};
}

export async function mergeAnnotationsByIDs(ids: readonly number[]): Promise<{
	ok: boolean;
	keptID: number;
	removedCount: number;
}> {
	const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
	if (unique.length < 2) return { ok: false, keptID: 0, removedCount: 0 };
	const hostItems = (globalThis as any).Zotero?.Items;
	if (!hostItems) return { ok: false, keptID: 0, removedCount: 0 };

	const loaded: any[] = [];
	for (const id of unique) {
		const it = hostItems.get?.(id) || (hostItems.getAsync ? await hostItems.getAsync(id).catch(() => null) : null);
		if (it && !it.deleted && (it.isAnnotation?.() || it.itemType === 'annotation')) {
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
	if (typeof primary.saveTx === 'function') await primary.saveTx();
	else if (typeof primary.save === 'function') await primary.save();

	const restIDs = rest.map((r) => Number(r.id)).filter((id) => id > 0);
	if (restIDs.length && typeof hostItems.trashTx === 'function') {
		await hostItems.trashTx(restIDs);
	} else {
		for (const r of rest) {
			r.deleted = true;
			if (typeof r.saveTx === 'function') await r.saveTx();
		}
	}
	return { ok: true, keptID: Number(primary.id || 0), removedCount: rest.length };
}

export function collectItemAnnotations(
	items: readonly any[],
	semantics: Readonly<Record<string, string>>,
): CollectedAnnotation[] {
	const hostItems = (globalThis as any).Zotero?.Items;
	const out: CollectedAnnotation[] = [];
	const seenAnn = new Set<number>();

	for (const rawItem of items) {
		if (!rawItem || rawItem.deleted) continue;
		const itemID = Number(rawItem.id || 0);
		const itemTitle = String(rawItem.getField?.('title') || rawItem.title || `文献 #${itemID}`);
		const creator = String(rawItem.firstCreator || '').trim();
		const year = String(rawItem.getField?.('year') || rawItem.getField?.('date') || '').slice(0, 4);
		const creatorYear = [creator, year].filter(Boolean).join(' ');

		const canHaveAnnotations = (it: any): boolean => {
			if (!it || it.deleted || typeof it.getAnnotations !== 'function') return false;
			if (typeof it.isFileAttachment === 'function') return Boolean(it.isFileAttachment());
			if (typeof it.isAttachment === 'function' && !it.isAttachment()) return false;
			return true;
		};
		const attachments: any[] = [];
		if (canHaveAnnotations(rawItem)) attachments.push(rawItem);
		const attIDs: number[] = typeof rawItem.getAttachments === 'function' ? (rawItem.getAttachments() || []) : [];
		for (const aid of attIDs) {
			const att = hostItems?.get?.(aid);
			if (canHaveAnnotations(att)) attachments.push(att);
		}

		for (const att of attachments) {
			let anns: any[] = [];
			try { anns = att.getAnnotations?.() || []; } catch { anns = []; }
			for (const ann of [...anns].sort(compareAnnotationsByOrder)) {
				const annID = Number(ann?.id || 0);
				if (!ann || ann.deleted || (annID > 0 && seenAnn.has(annID))) continue;
				if (annID > 0) seenAnn.add(annID);
				const color = normalizeHexColor(ann.annotationColor || ann.color);
				const text = String(ann.annotationText || '').trim();
				const comment = String(ann.annotationComment || '').trim();
				if (!text && !comment) continue;
				const tags = typeof ann.getTags === 'function'
					? (ann.getTags() || []).map((t: any) => String(t?.tag || t || '').trim()).filter(Boolean)
					: [];
				out.push({
					itemID,
					itemTitle,
					creatorYear,
					annotationID: annID,
					color,
					colorLabel: resolveColorLabel(color, semantics),
					text,
					comment,
					pageLabel: String(ann.annotationPageLabel || ''),
					tags,
				});
			}
		}
	}
	return out;
}
