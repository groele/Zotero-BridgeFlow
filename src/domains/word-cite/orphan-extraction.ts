import type { OrphanCitationInfo } from '../../kernel/types.ts';

const VALID_INDEX_KEY_RE = /^(?:0|[1-9]\d*)$/;

export interface ExtractedCitationEntry {
	itemID: number;
	ordinal: number;
	shortText: string;
	occurrences: number;
}

export interface ExtractedSessionCitations {
	citations: ExtractedCitationEntry[];
	orphans: OrphanCitationInfo[];
}

export function cleanCitationText(raw: unknown): string {
	return String(raw || '').replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatCslAuthorYear(itemData: Record<string, unknown> | undefined): string {
	if (!itemData) return '';
	const authors = Array.isArray(itemData.author) ? itemData.author : Array.isArray(itemData.editor) ? itemData.editor : [];
	const first = authors[0] as Record<string, unknown> | undefined;
	const name = String(first?.family || first?.literal || first?.given || '').trim();
	const issued = itemData.issued as { 'date-parts'?: unknown[][]; literal?: string; raw?: string } | undefined;
	const yearPart = issued?.['date-parts']?.[0]?.[0] ?? issued?.literal ?? issued?.raw ?? '';
	const year = String(yearPart || '').match(/\d{4}/)?.[0] || '';
	return [name, year].filter(Boolean).join(', ');
}

function buildOrphanKey(itemID: number, uris: readonly string[], itemData: Record<string, unknown> | undefined, fallbackText: string): string {
	if (Number.isSafeInteger(itemID) && itemID > 0) return `id:${itemID}`;
	if (uris.length > 0) return `uri:${uris[0]}`;
	const cslId = itemData?.id !== undefined ? String(itemData.id).trim() : '';
	if (cslId) return `csl:${cslId}`;
	const title = String(itemData?.title || '').trim();
	if (title) return `title:${title.toLowerCase()}`;
	return `raw:${fallbackText || 'unknown'}`;
}

function buildOrphanMetadata(
	ci: any,
	zotItem: any,
	itemID: number,
	shortText: string,
	ordinal: number,
	kind: 'trashed' | 'missing',
): OrphanCitationInfo {
	const rawData = ci?.itemData && typeof ci.itemData === 'object' ? (ci.itemData as Record<string, unknown>) : undefined;
	const uris = Array.isArray(ci?.uris) ? ci.uris.map((u: unknown) => String(u || '').trim()).filter(Boolean) : [];
	const itemTitle = typeof zotItem?.getField === 'function' ? String(zotItem.getField('title') || '').trim() : '';
	const dataTitle = String(rawData?.title || rawData?.['container-title'] || '').trim();
	const title = itemTitle || dataTitle || (shortText ? `Citation ${shortText}` : `#${ordinal}`);
	const authorYear = formatCslAuthorYear(rawData);
	const key = buildOrphanKey(itemID, uris, rawData, `${ordinal}:${shortText}`);
	return {
		key,
		kind,
		ordinal,
		shortText,
		title,
		...(authorYear ? { authorYear } : {}),
		...(Number.isSafeInteger(itemID) && itemID > 0 ? { itemID } : {}),
		...(uris.length ? { uris } : {}),
		...(rawData ? { itemData: rawData } : {}),
	};
}

/**
 * Extracts unique valid cited items AND orphan/trashed citations in exact document appearance order.
 * Orphan/trashed citations reserve their true document ordinal so subsequent valid citations never shift left.
 */
export function extractSessionCitationsWithOrphans(session: any): ExtractedSessionCitations {
	const hostItems = (globalThis as any).Zotero?.Items;
	const hasItemLookup = typeof hostItems?.get === 'function';
	const ordinalMap = new Map<number, { ordinal: number; occurrences: number; labels: string[] }>();
	const orphanMap = new Map<string, OrphanCitationInfo>();
	const orphanItemIDs = new Set<number>();
	const statusCache = new Map<number, { status: 'valid' | 'trashed' | 'missing'; zotItem: any }>();
	let nextOrdinal = 1;

	const inspectItemStatus = (itemID: number): { status: 'valid' | 'trashed' | 'missing'; zotItem: any } => {
		if (!Number.isSafeInteger(itemID) || itemID <= 0) return { status: 'missing', zotItem: null };
		if (!hasItemLookup) return { status: 'valid', zotItem: null };
		const cached = statusCache.get(itemID);
		if (cached !== undefined) return cached;
		const zotItem = hostItems.get(itemID);
		if (!zotItem) {
			const res = { status: 'missing' as const, zotItem: null };
			statusCache.set(itemID, res);
			return res;
		}
		const inTrash = typeof zotItem.inTrash === 'function' ? zotItem.inTrash() === true : zotItem.inTrash === true;
		const trashed = zotItem.deleted === true || inTrash;
		const res = { status: (trashed ? 'trashed' : 'valid') as 'trashed' | 'valid', zotItem };
		statusCache.set(itemID, res);
		return res;
	};

	const recordValidHit = (itemID: number, shortText: unknown, explicitItemOrdinal?: number, countOcc = false) => {
		if (!Number.isSafeInteger(itemID) || itemID <= 0) return;
		if (orphanItemIDs.has(itemID)) return;
		const { status } = inspectItemStatus(itemID);
		if (status !== 'valid') return;

		const label = cleanCitationText(shortText);
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

	const recordOrphanHit = (ci: any, zotItem: any, itemID: number, kind: 'trashed' | 'missing', shortText: string, explicitOrdinal?: number) => {
		const rawData = ci?.itemData && typeof ci.itemData === 'object' ? (ci.itemData as Record<string, unknown>) : undefined;
		const uris = Array.isArray(ci?.uris) ? ci.uris.map((u: unknown) => String(u || '').trim()).filter(Boolean) : [];
		const key = buildOrphanKey(itemID, uris, rawData, shortText || String(nextOrdinal));
		if (Number.isSafeInteger(itemID) && itemID > 0) orphanItemIDs.add(itemID);
		if (orphanMap.has(key)) return;
		const assigned = explicitOrdinal && explicitOrdinal > 0 ? explicitOrdinal : nextOrdinal;
		nextOrdinal = Math.max(nextOrdinal + 1, assigned + 1);
		orphanMap.set(key, buildOrphanMetadata(ci, zotItem, itemID, shortText, assigned, kind));
	};

	const byIndex = session?.citationsByIndex;
	if (byIndex && typeof byIndex === 'object') {
		const sortedKeys = Object.keys(byIndex)
			.filter((k) => VALID_INDEX_KEY_RE.test(k))
			.sort((a, b) => Number(a) - Number(b));

		for (const key of sortedKeys) {
			const cit = byIndex[key];
			const cItems: any[] = Array.isArray(cit?.citationItems) ? cit.citationItems : [];
			const shortText = cit?.properties?.plainCitation ?? cit?.properties?.formattedCitation ?? cit?.text ?? '';
			const cleanedShort = cleanCitationText(shortText);
			for (const ci of cItems) {
				if (!ci || typeof ci !== 'object') continue;
				const itemID = Number(ci?.id ?? ci?.itemID ?? 0);
				const explicitOrdinal = Number(ci?.ordinal ?? ci?.citationNumber ?? 0);
				const expOrd = explicitOrdinal > 0 ? explicitOrdinal : undefined;
				const { status, zotItem } = inspectItemStatus(itemID);
				if (status === 'valid') {
					recordValidHit(itemID, cleanedShort, expOrd, true);
				} else {
					recordOrphanHit(ci, zotItem, itemID, status, cleanedShort, expOrd);
				}
			}
		}
	}

	const byItem = session?.citationsByItemID;
	if (byItem && typeof byItem === 'object') {
		for (const [rawID, list] of Object.entries(byItem)) {
			const itemID = Number(rawID);
			const entries = Array.isArray(list) ? list : [list];
			for (const entry of entries) {
				if (!entry) continue;
				const shortText = entry.properties?.plainCitation ?? entry.properties?.formattedCitation ?? entry.text ?? '';
				recordValidHit(itemID, shortText);
			}
		}
	}

	return {
		citations: [...ordinalMap.entries()].map(([itemID, info]) => ({
			itemID,
			ordinal: info.ordinal,
			shortText: info.labels.join(', '),
			occurrences: info.occurrences,
		})),
		orphans: [...orphanMap.values()],
	};
}
