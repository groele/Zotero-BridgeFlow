import { GalleryHeightIndex, type VirtualColumnSpec, type VirtualItemSpec } from './gallery-height-index.ts';
import { galEl } from './gallery-styles.ts';

export interface InternalVirtualEntry<T> {
	readonly id: number;
	readonly key: string;
	readonly data: T;
	readonly token: string;
	readonly colIndex: number;
	readonly row: number;
	position: number;
}

export interface InternalVirtualColumn<T> {
	readonly value: string;
	readonly colIndex: number;
	readonly createShell: () => { root: HTMLElement; list: HTMLElement; headingHeight?: number };
	readonly heights: GalleryHeightIndex;
	items: InternalVirtualEntry<T>[];
	headingHeight: number;
	visibleRows?: string;
	root?: HTMLElement;
	list?: HTMLElement;
}

export function buildVirtualColumn<T>(
	spec: VirtualColumnSpec<T>,
	colIndex: number,
	board: boolean,
	estimateHeight: number,
	gap: number,
	measured: Map<string, number>,
	entries: Map<string, InternalVirtualEntry<T>>,
): InternalVirtualColumn<T> {
	const heights = new GalleryHeightIndex(spec.items.length, estimateHeight, gap);
	const col: InternalVirtualColumn<T> = {
		value: spec.value,
		colIndex,
		createShell: spec.createShell,
		heights,
		items: [],
		headingHeight: board ? 44 : 0,
	};
	col.items = spec.items.map((it, row) => {
		const token = `${board ? spec.value : colIndex}::${it.key}`;
		const entry: InternalVirtualEntry<T> = { id: it.id, key: it.key, data: it.data, token, colIndex, row, position: 0 };
		entries.set(token, entry);
		const m = measured.get(token);
		if (m) heights.measure(row, m);
		return entry;
	});
	return col;
}

export function buildMasonrySpecs<T>(
	doc: Document,
	colCount: number,
	items: readonly VirtualItemSpec<T>[],
): VirtualColumnSpec<T>[] {
	const buckets = Array.from({ length: colCount }, () => [] as VirtualItemSpec<T>[]);
	items.forEach((item, index) => buckets[index % colCount].push(item));
	return Array.from({ length: colCount }, (_, idx) => ({
		value: String(idx),
		items: buckets[idx],
		createShell: () => {
			const colNode = galEl(doc, 'div');
			colNode.className = 'zbf-gal-masonry-col';
			return { root: colNode, list: colNode, headingHeight: 0 };
		},
	}));
}

export function computeVirtualOrder<T>(columns: readonly InternalVirtualColumn<T>[], board: boolean): {
	order: InternalVirtualEntry<T>[];
	orderIDs: number[];
	byID: Map<number, InternalVirtualEntry<T>[]>;
} {
	let order: InternalVirtualEntry<T>[];
	if (board) {
		order = columns.flatMap((c) => c.items);
	} else {
		order = [];
		const maxRows = Math.max(0, ...columns.map((c) => c.items.length));
		for (let r = 0; r < maxRows; r++) {
			for (const c of columns) {
				if (c.items[r]) order.push(c.items[r]);
			}
		}
	}
	const orderIDs = order.map((e) => e.id);
	const byID = new Map<number, InternalVirtualEntry<T>[]>();
	order.forEach((e, idx) => {
		e.position = idx;
		const arr = byID.get(e.id) || [];
		arr.push(e);
		byID.set(e.id, arr);
	});
	return { order, orderIDs, byID };
}

export function findAdjacentVirtualItemID<T>(
	byID: ReadonlyMap<number, InternalVirtualEntry<T>[]>,
	order: readonly InternalVirtualEntry<T>[],
	columns: readonly InternalVirtualColumn<T>[],
	currentID: number,
	key: string,
): number | undefined {
	const entry = byID.get(currentID)?.[0];
	if (!entry) return order[0]?.id;
	if (key === 'Home') return order[0]?.id;
	if (key === 'End') return order[order.length - 1]?.id;
	const col = columns[entry.colIndex];
	if (key === 'ArrowUp' || key === 'ArrowDown') {
		return col?.items[entry.row + (key === 'ArrowUp' ? -1 : 1)]?.id;
	}
	const dir = key === 'ArrowLeft' ? -1 : 1;
	const centerY = col.heights.offset(entry.row) + col.heights.height(entry.row) / 2;
	for (let cIdx = entry.colIndex + dir; cIdx >= 0 && cIdx < columns.length; cIdx += dir) {
		const targetCol = columns[cIdx];
		if (!targetCol.items.length) continue;
		const approx = targetCol.heights.at(centerY);
		return targetCol.items[approx]?.id;
	}
	return undefined;
}
