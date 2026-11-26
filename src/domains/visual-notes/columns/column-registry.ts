import type { TabReadingProgress } from '../../../services/reading-stats.ts';
import type { VisualNotesDataSource } from '../data-source.ts';

export interface StoreLike {
	state: {
		remarks?: Record<string, string>;
		readingProgress?: Record<string, TabReadingProgress>;
	};
}

export function makeSourceFromStore(store?: StoreLike): VisualNotesDataSource | undefined {
	if (!store) return undefined;
	return {
		getReadingProgress: (id) => store.state.readingProgress?.[`item:${id}`],
		getRemark: (id) => store.state.remarks?.[`item:${id}`] || '',
		setRemark: () => {},
	};
}

export function registerTreeColumn(
	registeredKeys: Set<string>,
	descriptor: Record<string, unknown>,
	isActive: () => boolean,
	onFailed?: () => void,
): boolean {
	const manager = (globalThis as any).Zotero?.ItemTreeManager;
	const regFn = manager?.registerColumn || manager?.registerColumns;
	if (typeof regFn !== 'function') return false;
	try {
		const res = regFn.call(manager, descriptor);
		const recordKey = (val: unknown) => {
			let added = false;
			for (const k of Array.isArray(val) ? val : [val]) {
				if (typeof k === 'string' && k) { registeredKeys.add(k); added = true; }
			}
			if (!added) onFailed?.();
			else if (!isActive() && registeredKeys.size) flushUnregisterColumns(registeredKeys);
		};
		if (res && typeof (res as Promise<unknown>).then === 'function') {
			void (res as Promise<unknown>).then(recordKey, () => onFailed?.());
		} else {
			if (typeof res !== 'string' || !res) return false;
			registeredKeys.add(res);
		}
		return true;
	} catch {
		return false;
	}
}

export function flushUnregisterColumns(registeredKeys: Set<string>): void {
	if (!registeredKeys.size) return;
	const keys = [...registeredKeys];
	registeredKeys.clear();
	const manager = (globalThis as any).Zotero?.ItemTreeManager;
	try {
		if (typeof manager?.unregisterColumn === 'function') {
			for (const k of keys) void Promise.resolve(manager.unregisterColumn(k)).catch(() => {});
		} else if (typeof manager?.unregisterColumns === 'function') {
			void Promise.resolve(manager.unregisterColumns(keys)).catch(() => {});
		}
	} catch { /* ignore */ }
}

export function resolveTreeRowContext(index: number, treeDoc?: Document): { win: Window | null; doc: Document | null; item: any } {
	const win: Window | null = treeDoc?.defaultView || (globalThis as any).Zotero?.getMainWindow?.() || null;
	const doc = win?.document || null;
	const item = (win as any)?.ZoteroPane?.itemsView?.getRow?.(index)?.ref || null;
	return { win, doc, item };
}
