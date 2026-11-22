export const BRIDGEFLOW_TAB_MIME = 'application/x-zotero-bridgeflow-tab';

export function hasBridgeFlowDraggedTab(dt: DataTransfer | null | undefined): boolean {
	if (!dt?.types) return false;
	return Array.from(dt.types).includes(BRIDGEFLOW_TAB_MIME);
}

export function hasZoteroDraggedItems(dt: DataTransfer | null | undefined): boolean {
	if (!dt?.types) return false;
	const types = Array.from(dt.types);
	return types.includes('zotero/item') || types.includes('text/x-moz-url');
}

export function parseZoteroDraggedItemIDs(dt: DataTransfer | null | undefined): number[] {
	if (!dt) return [];
	const raw = dt.getData('zotero/item') || '';
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return parsed.map((v) => Number(typeof v === 'object' ? v?.id : v)).filter((n) => Number.isFinite(n) && n > 0);
		}
	} catch { /* fallback text parse */ }
	return raw
		.split(/[\s,;]+/)
		.map((s) => Number(s.trim()))
		.filter((n) => Number.isFinite(n) && n > 0);
}

export function beginTabDrag(
	dt: DataTransfer | null | undefined,
	key: string,
	tabID: string,
): void {
	if (!dt) return;
	try {
		dt.effectAllowed = 'move';
		dt.setData(BRIDGEFLOW_TAB_MIME, JSON.stringify({ key, tabID }));
		dt.setData('text/plain', key);
	} catch { /* ignore */ }
}

export function readTabDragPayload(dt: DataTransfer | null | undefined): { key: string; tabID: string } | null {
	if (!dt) return null;
	try {
		const raw = dt.getData(BRIDGEFLOW_TAB_MIME);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (parsed?.key) return { key: String(parsed.key), tabID: String(parsed.tabID || '') };
		}
	} catch { /* fallback */ }
	const plain = dt.getData('text/plain');
	if (plain && (plain.startsWith('item:') || plain.startsWith('tab:'))) {
		return { key: plain, tabID: '' };
	}
	return null;
}
