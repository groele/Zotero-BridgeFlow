import { filterCollectedAnnotations } from '../../services/annotation-matrix.ts';
import { collectItemAnnotations, parseColorSemantics, type CollectedAnnotation } from '../../services/annotation-utils.ts';
import {
	collectHubNotes,
	isFigureOrTableAnnotation,
	matchesAnnotationQuery,
	resolveHubScopeItems,
	type HubScopeMode,
	type ItemNotesAggregate,
} from '../../services/collection-notes.ts';

function matchesNotesQuery(haystack: string, rawQuery: string): boolean {
	const q = String(rawQuery || '').trim().toLowerCase();
	if (!q) return true;
	const hay = haystack.toLowerCase();
	const orParts = q.split('||').map((s) => s.trim()).filter(Boolean);
	return !orParts.length || orParts.some((clause) => {
		const andTerms = clause.split('&&').map((s) => s.trim()).filter(Boolean);
		return andTerms.length > 0 && andTerms.every((t) => hay.includes(t));
	});
}

export function createHubScopeMemo(opts: {
	win: Window;
	zh: boolean;
	getColorJson: () => string | null | undefined;
	getBriefNote: (item: any) => string;
}) {
	let cachedMode: HubScopeMode | null = null;
	let cachedColorRaw = '';
	let scopeRes = resolveHubScopeItems(opts.win, 'collection', opts.zh);
	let rawAnnotations: CollectedAnnotation[] = [];
	let colorHexByLabel = new Map<string, string>();
	let rawNoteRecords: Array<{ entry: ItemNotesAggregate; hay: string; metaHay: string }> = [];

	const invalidate = () => { cachedMode = null; };

	const ensureScope = (mode: HubScopeMode) => {
		const colorRaw = String(opts.getColorJson() || '');
		if (cachedMode === mode && cachedColorRaw === colorRaw) return;
		cachedMode = mode;
		cachedColorRaw = colorRaw;
		scopeRes = resolveHubScopeItems(opts.win, mode, opts.zh);
		const semantics = parseColorSemantics(colorRaw);
		colorHexByLabel = new Map<string, string>();
		for (const [hex, lbl] of Object.entries(semantics)) {
			if (!colorHexByLabel.has(lbl)) colorHexByLabel.set(lbl, hex);
		}
		rawAnnotations = collectItemAnnotations(scopeRes.items, semantics);
		const allNotes = collectHubNotes(scopeRes.items, opts.getBriefNote, '');
		rawNoteRecords = allNotes.entries.map((entry) => ({
			entry,
			hay: [entry.title, entry.creatorYear, entry.briefNote, ...entry.childNotes.map((n) => `${n.heading} ${n.snippet}`)].join(' '),
			metaHay: `${entry.title} ${entry.creatorYear}`,
		}));
	};

	const compute = (mode: HubScopeMode, query: string, colorLabel: string, ignoreFigureTable: boolean) => {
		ensureScope(mode);
		const base = ignoreFigureTable ? rawAnnotations.filter((a) => !isFigureOrTableAnnotation(a)) : rawAnnotations;
		const colorCounts = new Map<string, number>();
		for (const a of base) colorCounts.set(a.colorLabel, (colorCounts.get(a.colorLabel) || 0) + 1);
		const annotations = filterCollectedAnnotations(base, { query, colorLabel });

		const qTrim = query.trim();
		const entries: ItemNotesAggregate[] = [];
		let totalBriefNotes = 0;
		let totalChildNotes = 0;
		for (const rec of rawNoteRecords) {
			if (qTrim) {
				if (!matchesNotesQuery(rec.hay, qTrim)) continue;
				if (!rec.entry.briefNote && !rec.entry.childNotes.length && !matchesNotesQuery(rec.metaHay, qTrim)) continue;
			}
			if (rec.entry.briefNote) totalBriefNotes++;
			totalChildNotes += rec.entry.childNotes.length;
			entries.push(rec.entry);
		}
		return {
			scope: scopeRes,
			annData: { totalBeforeFilter: base.length, annotations, colorCounts, colorHexByLabel },
			notesData: { entries, totalChildNotes, totalBriefNotes },
		};
	};

	return { compute, invalidate, matchesAnnotationQuery };
}

/** Walks up attachment / annotation parents so Notifier item modifications invalidate their owning regular items. */
export function resolveAffectedVisualItemIDs(rawIDs: readonly (string | number)[]): Set<number> {
	const out = new Set<number>();
	const hostItems = (globalThis as any).Zotero?.Items;
	for (const raw of rawIDs) {
		let curID = Number(raw || 0);
		for (let hop = 0; hop < 3 && Number.isInteger(curID) && curID > 0; hop++) {
			out.add(curID);
			const obj = hostItems?.get?.(curID);
			const nextParent = Number(obj?.parentItemID || obj?.parentID || 0);
			if (!nextParent || nextParent === curID) break;
			curID = nextParent;
		}
	}
	return out;
}
