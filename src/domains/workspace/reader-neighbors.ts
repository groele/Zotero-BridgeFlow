import type { TypedEventBus } from '../../kernel/event-bus.ts';
import type { ReaderNeighborRef, ReaderNeighborsPayload } from '../../kernel/types.ts';
import type { TrackedTab } from './types.ts';

function toNeighborRef(tab: TrackedTab): ReaderNeighborRef {
	return {
		tabID: tab.tabID,
		itemID: tab.itemID,
		parentItemID: tab.parentItemID,
		title: tab.shortTitle || tab.title || tab.filename || `文献 #${tab.itemID}`,
	};
}

export function computeReaderNeighbors(win: Window, tracked: readonly TrackedTab[]): ReaderNeighborsPayload {
	const activeTabID = String((win as any).Zotero_Tabs?.selectedID || '');
	if (!activeTabID || activeTabID === 'zotero-pane') {
		return { activeTabID };
	}
	const readers = tracked.filter((t) => !t.virtual && t.tabID && t.itemID > 0 && t.type.startsWith('reader'));
	const idx = readers.findIndex((t) => t.tabID === activeTabID);
	if (idx < 0) return { activeTabID };
	return {
		activeTabID,
		left: idx > 0 ? toNeighborRef(readers[idx - 1]) : undefined,
		right: idx + 1 < readers.length ? toNeighborRef(readers[idx + 1]) : undefined,
	};
}

export function neighborFingerprint(payload: ReaderNeighborsPayload): string {
	return [
		payload.activeTabID,
		payload.left ? `${payload.left.tabID}:${payload.left.itemID}` : '',
		payload.right ? `${payload.right.tabID}:${payload.right.itemID}` : '',
	].join('|');
}

export class ReaderNeighborPublisher {
	private lastFp = '';
	private readonly bus: TypedEventBus;

	constructor(bus: TypedEventBus) {
		this.bus = bus;
	}

	publish(win: Window | null, tracked: readonly TrackedTab[], force = false): void {
		if (!win) return;
		const payload = computeReaderNeighbors(win, tracked);
		const fp = neighborFingerprint(payload);
		if (!force && fp === this.lastFp) return;
		this.lastFp = fp;
		this.bus.emit('workspace:reader-neighbors-updated', payload);
	}

	reset(): void {
		this.lastFp = '';
	}
}
