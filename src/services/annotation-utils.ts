import { isRegularValidItem } from './item-resolution.ts';
import { compareAnnotationsByOrder } from './annotation-merge.ts';
export { mergeAnnotationPayloads, mergeAnnotationsByIDs } from './annotation-merge.ts';
export const DEFAULT_ANNOTATION_COLORS: Readonly<Record<string, string>> = {
	'#ffd400': 'Context',
	'#ff6666': 'Method',
	'#5fb236': 'Gap',
	'#2ea8e5': 'Finding',
	'#a28ae5': 'Evidence',
	'#e56eee': 'Quote',
	'#f19837': 'Idea',
	'#aaaaaa': 'Note',
};

export const DEFAULT_ENABLED_ANNOTATION_COLORS: readonly string[] = [
	'#ffd400',
	'#ff6666',
	'#5fb236',
	'#2ea8e5',
	'#a28ae5',
];

export const ANNOTATION_COLOR_PRESETS: Readonly<Record<'3' | '5' | '8', readonly string[]>> = {
	'3': ['#ffd400', '#ff6666', '#2ea8e5'],
	'5': DEFAULT_ENABLED_ANNOTATION_COLORS,
	'8': Object.keys(DEFAULT_ANNOTATION_COLORS),
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

const FOUR_DIGIT_YEAR_RE = /\b(1[89]\d{2}|20\d{2})\b/;

export function extractFourDigitYear(raw: unknown): string {
	const text = String(raw ?? '').trim();
	if (!text) return '';
	const m = FOUR_DIGIT_YEAR_RE.exec(text);
	return m ? m[1] : (/^\d{4}/.test(text) ? text.slice(0, 4) : '');
}

export function normalizeHexColor(color: string | null | undefined): string {
	const clean = String(color || '').trim().toLowerCase();
	if (/^#[0-9a-f]{6}$/.test(clean)) return clean;
	if (/^#[0-9a-f]{3}$/.test(clean)) {
		return `#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`;
	}
	return '';
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

export function parseEnabledAnnotationColors(raw?: string | null): Set<string> {
	const clean = String(raw || '').trim();
	if (!clean) return new Set(DEFAULT_ENABLED_ANNOTATION_COLORS);
	const out = new Set<string>();
	const pushHex = (val: unknown) => {
		const hex = normalizeHexColor(String(val || ''));
		if (/^#[0-9a-f]{6}$/.test(hex)) out.add(hex);
	};
	if (clean.startsWith('[')) {
		try {
			const parsed = JSON.parse(clean);
			if (Array.isArray(parsed)) parsed.forEach(pushHex);
		} catch { /* fallback */ }
	} else {
		for (const token of clean.split(/[\s,;]+/)) pushHex(token);
	}
	return out.size ? out : new Set(DEFAULT_ENABLED_ANNOTATION_COLORS);
}

export function serializeEnabledAnnotationColors(colors: Iterable<string>): string {
	const unique: string[] = [];
	const seen = new Set<string>();
	for (const raw of colors) {
		const hex = normalizeHexColor(raw);
		if (/^#[0-9a-f]{6}$/.test(hex) && !seen.has(hex)) {
			seen.add(hex);
			unique.push(hex);
		}
	}
	if (!unique.length) return '';
	const isDefault = unique.length === DEFAULT_ENABLED_ANNOTATION_COLORS.length
		&& DEFAULT_ENABLED_ANNOTATION_COLORS.every((hex) => seen.has(hex));
	return isDefault ? '' : unique.join(',');
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
		const year = extractFourDigitYear(rawItem.getField?.('year') || rawItem.getField?.('date'));
		const creatorYear = [creator, year].filter(Boolean).join(' ');

		const canHaveAnnotations = (it: any): boolean => {
			if (!it || it.deleted || typeof it.getAnnotations !== 'function') return false;
			if (typeof it.isFileAttachment === 'function') return Boolean(it.isFileAttachment());
			if (typeof it.isAttachment === 'function' && !it.isAttachment()) return false;
			return true;
		};
		const attachments: any[] = [];
		if (canHaveAnnotations(rawItem)) attachments.push(rawItem);
		const attIDs: number[] = isRegularValidItem(rawItem) && typeof rawItem.getAttachments === 'function' ? (rawItem.getAttachments() || []) : [];
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
				const color = normalizeHexColor(ann.annotationColor || ann.color) || '#ffd400';
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

export interface AnnotationColorBucket {
	hex: string;
	label: string;
	count: number;
}

export function summarizeItemAnnotationColors(
	rawItem: any,
	semantics: Readonly<Record<string, string>>,
): { total: number; buckets: AnnotationColorBucket[] } {
	if (!rawItem || rawItem.deleted) return { total: 0, buckets: [] };
	const hostItems = (globalThis as any).Zotero?.Items;
	const seenAnn = new Set<number>();
	const counts = new Map<string, AnnotationColorBucket>();
	let total = 0;
	const canHave = (it: any) => Boolean(
		it && !it.deleted && typeof it.getAnnotations === 'function' &&
		(typeof it.isFileAttachment === 'function' ? it.isFileAttachment() : (typeof it.isAttachment !== 'function' || it.isAttachment())),
	);
	const scanAtt = (att: any) => {
		if (!canHave(att)) return;
		let anns: any[] = [];
		try { anns = att.getAnnotations?.() || []; } catch { anns = []; }
		for (const ann of anns) {
			const annID = Number(ann?.id || 0);
			if (!ann || ann.deleted || (annID > 0 && seenAnn.has(annID))) continue;
			if (annID > 0) seenAnn.add(annID);
			if (!String(ann.annotationText || '').trim() && !String(ann.annotationComment || '').trim()) continue;
			total += 1;
			const color = normalizeHexColor(ann.annotationColor || ann.color) || '#ffd400';
			const label = resolveColorLabel(color, semantics);
			const prev = counts.get(label);
			if (prev) prev.count += 1;
			else counts.set(label, { hex: color || '#64748b', label, count: 1 });
		}
	};
	scanAtt(rawItem);
	if (isRegularValidItem(rawItem) && typeof rawItem.getAttachments === 'function') {
		for (const aid of rawItem.getAttachments() || []) scanAtt(hostItems?.get?.(aid));
	}
	return { total, buckets: [...counts.values()].sort((a, b) => b.count - a.count) };
}
