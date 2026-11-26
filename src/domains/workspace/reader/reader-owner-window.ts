export function collectOpenAttIDs(reader: any): Set<number> {
	const open = new Set<number>();
	const win = resolveOwnerWindow(reader);
	const tabs: any[] = Array.isArray((win as any)?.Zotero_Tabs?._tabs) ? (win as any).Zotero_Tabs._tabs : [];
	for (const t of tabs) {
		const id = Number(t?.data?.itemID || 0);
		if (id > 0) open.add(id);
	}
	return open;
}

export function resolveOwnerWindow(reader: any): Window | null {
	if (reader?._window && !reader._window.closed) return reader._window;
	const tabID = String(reader?.tabID || '');
	const wins: Window[] = (globalThis as any).Zotero?.getMainWindows?.() || [];
	if (tabID) {
		const matched = wins.find((w: any) => Array.isArray(w?.Zotero_Tabs?._tabs) && w.Zotero_Tabs._tabs.some((t: any) => t?.id === tabID));
		if (matched) return matched;
	}
	return (globalThis as any).Zotero?.getMainWindow?.() || wins[0] || null;
}
