import { getHostTabs, resolveReaderOwnerWindow } from '../../../services/host/host-queries.ts';

export function collectOpenAttIDs(reader: any): Set<number> {
	const open = new Set<number>();
	const win = resolveReaderOwnerWindow(reader);
	for (const t of getHostTabs(win)) {
		const id = Number(t?.data?.itemID || 0);
		if (id > 0) open.add(id);
	}
	return open;
}

export function resolveOwnerWindow(reader: any): Window | null {
	return resolveReaderOwnerWindow(reader);
}
