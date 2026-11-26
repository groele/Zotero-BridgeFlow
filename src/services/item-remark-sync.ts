import { isItemWritable } from './item-resolution.ts';

const REMARK_PREFIX = 'BridgeFlow-Remark:';
const REMARK_LINE_RE = /^BridgeFlow-Remark:\s*(.*)$/i;
const inFlightRemarkOverrides = new Map<number, string>();
const suppressedExtraItemIDs = new Set<number>();

export function markItemRemarkClearedLocally(itemID: number): void {
	if (itemID > 0) suppressedExtraItemIDs.add(itemID);
}

export function clearItemRemarkLocalSuppression(itemID?: number): void {
	if (itemID === undefined) suppressedExtraItemIDs.clear();
	else if (itemID > 0) suppressedExtraItemIDs.delete(itemID);
}

export function readRemarkFromExtra(extraText: string | null | undefined): string {
	const raw = String(extraText || '');
	if (!raw) return '';
	for (const line of raw.split(/\r?\n/)) {
		const m = line.match(REMARK_LINE_RE);
		if (m) return m[1].trim();
	}
	return '';
}

export function upsertRemarkInExtra(extraText: string | null | undefined, remark: string): string {
	const clean = remark.replace(/[\r\n]+/g, ' ').trim();
	const lines = String(extraText || '')
		.split(/\r?\n/)
		.filter((line) => !REMARK_LINE_RE.test(line));
	while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
	if (clean) {
		lines.push(`${REMARK_PREFIX} ${clean}`);
	}
	return lines.join('\n');
}

export function getItemBriefNote(item: any, cachedRemark = ''): string {
	const direct = String(cachedRemark || '').trim();
	if (direct) return direct;
	const itemID = Number(item?.id || 0);
	if (itemID > 0) {
		if (inFlightRemarkOverrides.has(itemID)) return inFlightRemarkOverrides.get(itemID) || '';
		if (suppressedExtraItemIDs.has(itemID)) return '';
	}
	if (!item || typeof item.getField !== 'function') return '';
	try {
		return readRemarkFromExtra(String(item.getField('extra') || ''));
	} catch {
		return '';
	}
}

const pendingSyncByItemID = new Map<number, Promise<boolean>>();

async function performExtraSync(item: any, remark: string): Promise<boolean> {
	try {
		if (!item || item.deleted || !isItemWritable(item) || !item.isRegularItem?.()
			|| typeof item.getField !== 'function' || typeof item.setField !== 'function') return false;
		const prevExtra = String(item.getField('extra') || '');
		const nextExtra = upsertRemarkInExtra(prevExtra, remark);
		if (prevExtra === nextExtra) return true;
		const save = item.saveTx ?? item.save;
		if (typeof save !== 'function') return false;
		item.setField('extra', nextExtra);
		try {
			await save.call(item);
		} catch {
			if (item.getField('extra') === nextExtra) item.setField('extra', prevExtra);
			return false;
		}
		return true;
	} catch {
		return false;
	}
}

function getHostItem(id: number): any {
	const items = (globalThis as any).Zotero?.Items;
	try {
		const item = items?.get?.(id);
		if (item) return item;
	} catch { /* Item may not have loaded yet. */ }
	return items?.getAsync?.(id);
}

function enqueueRemark(item: any, remark: string): Promise<boolean> {
	const id = Number(item?.id || 0);
	if (!id) return performExtraSync(item, remark);
	inFlightRemarkOverrides.set(id, remark);
	const previous = pendingSyncByItemID.get(id) ?? Promise.resolve(true);
	const next = previous.then(() => performExtraSync(item, remark));
	pendingSyncByItemID.set(id, next);
	void next.finally(() => {
		if (pendingSyncByItemID.get(id) === next) {
			pendingSyncByItemID.delete(id);
			inFlightRemarkOverrides.delete(id);
		}
	});
	return next;
}

// Preserve submission order while resolving cold IDs, without serializing saves across items.
let resolvingTargets = Promise.resolve();
export function syncItemRemarkToExtra(itemOrID: any, remark: string): Promise<boolean> {
	const clean = remark.replace(/[\r\n]+/g, ' ').trim();
	const queued = resolvingTargets.then(async () => {
		const item = typeof itemOrID === 'number' ? await getHostItem(itemOrID) : itemOrID;
		const target = item && !item.deleted && item.isAttachment?.() && item.parentItemID
			? await getHostItem(item.parentItemID) : item;
		return { saved: enqueueRemark(target, clean) };
	});
	resolvingTargets = queued.then(() => {}, () => {});
	return queued.then(({ saved }) => saved, () => false);
}
