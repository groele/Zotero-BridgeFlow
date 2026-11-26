import { isItemWritable } from './item-resolution.ts';

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

export function compareAnnotationsByOrder(a: any, b: any): number {
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
	if (parentID <= 0) return { ok: false, keptID: 0, removedCount: 0 };
	const sameParent = loaded.filter((it) => Number(it.parentID || it.parentItemID || 0) === parentID);
	if (sameParent.length < 2) return { ok: false, keptID: 0, removedCount: 0 };

	const sorted = [...sameParent].sort(compareAnnotationsByOrder);
	if (!sorted.every((it) => isItemWritable(it))) return { ok: false, keptID: 0, removedCount: 0 };
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
