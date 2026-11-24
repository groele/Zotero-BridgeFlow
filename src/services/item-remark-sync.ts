const REMARK_PREFIX = 'BridgeFlow-Remark:';
const REMARK_LINE_RE = /^BridgeFlow-Remark:\s*(.*)$/i;

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
	if (!item || typeof item.getField !== 'function') return '';
	try {
		return readRemarkFromExtra(String(item.getField('extra') || ''));
	} catch {
		return '';
	}
}

const pendingSyncByItemID = new Map<number, Promise<boolean>>();

async function performExtraSync(itemOrID: any, remark: string): Promise<boolean> {
	try {
		const hostItems = (globalThis as any).Zotero?.Items;
		let item = typeof itemOrID === 'number'
			? (hostItems?.get?.(itemOrID) || (hostItems?.getAsync ? await hostItems.getAsync(itemOrID) : null))
			: itemOrID;
		if (!item || item.deleted) return false;
		if (item.isAttachment?.() && item.parentItemID) {
			const parent = hostItems?.get?.(item.parentItemID)
				|| (hostItems?.getAsync ? await hostItems.getAsync(item.parentItemID) : null);
			if (parent && !parent.deleted) item = parent;
		}
		if (!item?.isRegularItem?.() || typeof item.getField !== 'function' || typeof item.setField !== 'function') {
			return false;
		}
		const prevExtra = String(item.getField('extra') || '');
		const nextExtra = upsertRemarkInExtra(prevExtra, remark);
		if (prevExtra === nextExtra) return true;
		item.setField('extra', nextExtra);
		if (typeof item.saveTx === 'function') {
			await item.saveTx();
		} else if (typeof item.save === 'function') {
			await item.save();
		}
		return true;
	} catch {
		return false;
	}
}

export function syncItemRemarkToExtra(itemOrID: any, remark: string): Promise<boolean> {
	const rawID = typeof itemOrID === 'number' ? itemOrID : Number(itemOrID?.id || 0);
	if (rawID <= 0) return performExtraSync(itemOrID, remark);
	const prev = pendingSyncByItemID.get(rawID) || Promise.resolve(true);
	const next = prev.then(() => performExtraSync(itemOrID, remark));
	pendingSyncByItemID.set(rawID, next);
	void next.finally(() => {
		if (pendingSyncByItemID.get(rawID) === next) pendingSyncByItemID.delete(rawID);
	});
	return next;
}
