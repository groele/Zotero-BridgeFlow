import type { VirtualColumnSpec, VirtualItemSpec } from './gallery-height-index.ts';
export type { VirtualColumnSpec, VirtualItemSpec } from './gallery-height-index.ts';
import { computeMasonryColumnCount, GalleryHeightIndex, moveGalleryKeys } from './gallery-height-index.ts';
import {
	buildMasonrySpecs, buildVirtualColumn, computeVirtualOrder, findAdjacentVirtualItemID,
	type InternalVirtualColumn, type InternalVirtualEntry,
} from './gallery-kanban-layout.ts';
import { galEl } from './gallery-styles.ts';

export { computeMasonryColumnCount, GalleryHeightIndex, moveGalleryKeys };

export interface GalleryVirtualLayoutController {
	readonly orderIDs: readonly number[];
	refresh(): void;
	ensureItemVisible(itemID: number): HTMLElement | undefined;
	adjacentItemID(currentID: number, key: string): number | undefined;
	getMountedCards(): HTMLElement[];
	setDragging(dragging: boolean): void;
	destroy(): void;
}

export function createGalleryVirtualLayout<T>(options: {
	doc: Document;
	scroll: HTMLElement;
	content: HTMLElement;
	board: boolean;
	cardMinWidth: number;
	gap: number;
	estimateHeight: number;
	overscan?: number;
	items?: readonly VirtualItemSpec<T>[];
	columns?: readonly VirtualColumnSpec<T>[];
	measurements?: Map<string, number>;
	createCard: (entry: { id: number; key: string; data: T; columnValue: string }) => HTMLElement;
	onCardMounted?: (card: HTMLElement, entry: { id: number; data: T }) => void;
	onCardUnmounted?: (card: HTMLElement) => void;
	onVisibleChanged?: (cards: HTMLElement[]) => void;
}): GalleryVirtualLayoutController {
	const { doc, scroll, content, board, gap, estimateHeight } = options;
	const win = doc.defaultView;
	const overscan = options.overscan ?? 360;
	const measured = options.measurements ?? new Map<string, number>();
	const entries = new Map<string, InternalVirtualEntry<T>>();
	const mounted = new Map<string, HTMLElement>();
	let byID = new Map<number, InternalVirtualEntry<T>[]>();
	let columns: InternalVirtualColumn<T>[] = [];
	let order: InternalVirtualEntry<T>[] = [];
	let orderIDs: number[] = [];
	let active = true;
	let dragging = false;
	let rafId = 0;
	let lastWidth = -1;
	let forcedToken: string | undefined;

	const makeSpacer = (px: number): HTMLElement => {
		const s = galEl(doc, 'div');
		s.className = 'zbf-gal-virtual-spacer';
		s.setAttribute('aria-hidden', 'true');
		s.style.cssText = `flex:none;pointer-events:none;height:${Math.max(0, Math.round(px))}px;`;
		return s;
	};

	const clearSpacers = (parent: HTMLElement) => {
		for (const ch of Array.from(parent.children)) {
			if (ch.classList.contains('zbf-gal-virtual-spacer')) ch.remove();
		}
	};

	const rebuildOrder = () => {
		const res = computeVirtualOrder(columns, board);
		order = res.order;
		orderIDs = res.orderIDs;
		byID = res.byID;
	};

	const forgetCard = (token: string, card: HTMLElement) => {
		resizeObs?.unobserve(card);
		options.onCardUnmounted?.(card);
		card.remove();
		mounted.delete(token);
	};

	const ResizeObsCtor = (win as any)?.ResizeObserver || (globalThis as any).ResizeObserver;
	const resizeObs = ResizeObsCtor ? new ResizeObsCtor((records: any[]) => {
		if (!active || dragging) return;
		let dirty = false;
		for (const rec of records) {
			if (rec.target === scroll) { schedule(); continue; }
			const card = rec.target as HTMLElement;
			const entry = entries.get(card.dataset?.virtualKey || '');
			if (!entry || !card.isConnected) continue;
			const h = rec.borderBoxSize?.[0]?.blockSize ?? card.offsetHeight;
			if (h > 0 && columns[entry.colIndex]?.heights.measure(entry.row, h)) {
				columns[entry.colIndex].visibleRows = undefined;
				measured.set(entry.token, h);
				dirty = true;
			}
		}
		if (dirty) schedule();
	}) : null;

	const schedule = () => {
		if (!active || rafId) return;
		if (typeof win?.requestAnimationFrame === 'function') {
			rafId = win.requestAnimationFrame(() => { rafId = 0; refresh(); });
		} else {
			refresh();
		}
	};

	const rebuildMasonryColumns = (colCount: number) => {
		for (const [tok, card] of [...mounted.entries()]) forgetCard(tok, card);
		entries.clear();
		content.replaceChildren();
		const specs = buildMasonrySpecs(doc, colCount, options.items || []);
		columns = specs.map((spec, idx) => buildVirtualColumn(spec, idx, board, estimateHeight, gap, measured, entries));
		rebuildOrder();
		content.style.gridTemplateColumns = `repeat(${colCount}, minmax(0, 1fr))`;
	};

	if (board) {
		columns = (options.columns || []).map((spec, idx) => buildVirtualColumn(spec, idx, board, estimateHeight, gap, measured, entries));
		rebuildOrder();
	} else {
		const initialW = Math.max(260, (scroll.clientWidth || 960) - 24);
		lastWidth = initialW;
		rebuildMasonryColumns(computeMasonryColumnCount(initialW, options.cardMinWidth, gap));
	}

	function refresh(): void {
		if (!active) return;
		if (!board) {
			const availW = Math.max(240, scroll.clientWidth ? scroll.clientWidth - 24 : lastWidth);
			if (Math.abs(availW - lastWidth) > 2) {
				lastWidth = availW;
				const nextCount = computeMasonryColumnCount(availW, options.cardMinWidth, gap);
				if (nextCount !== columns.length) rebuildMasonryColumns(nextCount);
			}
		}

		const wanted = new Set<string>();
		for (const [tok, card] of mounted.entries()) {
			if (card.contains(doc.activeElement) || (dragging && card.getAttribute('data-dragging') === 'true')) wanted.add(tok);
		}
		if (forcedToken && entries.has(forcedToken)) wanted.add(forcedToken);

		for (const col of columns) {
			if (!col.root) {
				const shell = col.createShell();
				col.root = shell.root;
				col.list = shell.list;
				if (shell.headingHeight !== undefined) col.headingHeight = shell.headingHeight;
				content.appendChild(col.root);
				if (board && col.list !== scroll) col.list.addEventListener('scroll', schedule, { passive: true });
			}
			const vScrollHost = board && col.list && col.list !== col.root ? col.list : scroll;
			const vTop = vScrollHost.scrollTop || 0;
			const vHeight = Math.max(420, vScrollHost.clientHeight || scroll.clientHeight || 680);
			const headOff = vScrollHost === scroll ? col.headingHeight : 0;
			const [start, end] = col.heights.range(vTop - headOff - overscan, vTop + vHeight - headOff + overscan);
			for (let r = start; r < end; r++) if (col.items[r]) wanted.add(col.items[r].token);
		}

		for (const [tok, card] of [...mounted.entries()]) if (!wanted.has(tok)) forgetCard(tok, card);

		const visibleByColumn = columns.map(() => [] as InternalVirtualEntry<T>[]);
		for (const token of wanted) {
			const entry = entries.get(token);
			if (entry) visibleByColumn[entry.colIndex].push(entry);
		}
		for (const col of columns) {
			const list = col.list!;
			const vis = visibleByColumn[col.colIndex].sort((a, b) => a.row - b.row);
			const rows = vis.map((entry) => entry.row).join(',');
			if (col.visibleRows === rows) continue;
			col.visibleRows = rows;
			clearSpacers(list);
			let nextNode = list.firstElementChild;
			for (const entry of vis) {
				let card = mounted.get(entry.token);
				const isNew = !card;
				if (!card) {
					card = options.createCard({ id: entry.id, key: entry.key, data: entry.data, columnValue: col.value });
					card.dataset.virtualKey = entry.token;
					card.dataset.itemId = String(entry.id);
					mounted.set(entry.token, card);
				}
				if (card === nextNode) nextNode = card.nextElementSibling;
				else list.insertBefore(card, nextNode);
				if (isNew) {
					resizeObs?.observe(card, { box: 'border-box' });
					options.onCardMounted?.(card, { id: entry.id, data: entry.data });
				}
			}
			let cursor = 0;
			for (const child of Array.from(list.children)) {
				const entry = entries.get((child as HTMLElement).dataset?.virtualKey || '');
				if (!entry || entry.row < cursor) continue;
				if (entry.row > cursor) {
					const spH = col.heights.offset(entry.row) - col.heights.offset(cursor) - gap;
					if (spH > 0.5) list.insertBefore(makeSpacer(spH), child);
				}
				cursor = entry.row + 1;
			}
			if (cursor < col.items.length) {
				const tailH = col.heights.offset(col.items.length) - col.heights.offset(cursor) - gap;
				if (tailH > 0.5) list.appendChild(makeSpacer(tailH));
			}
		}
		options.onVisibleChanged?.([...mounted.values()]);
	}

	scroll.style.overflowAnchor = 'none';
	content.style.overflowAnchor = 'none';
	scroll.addEventListener('scroll', schedule, { passive: true });
	resizeObs?.observe(scroll);
	if (scroll.isConnected) refresh();

	return {
		get orderIDs() { return orderIDs; },
		refresh,
		ensureItemVisible(itemID: number): HTMLElement | undefined {
			const entry = byID.get(itemID)?.[0];
			if (!entry) return undefined;
			const col = columns[entry.colIndex];
			if (!col) return undefined;
			forcedToken = entry.token;
			const vHost = board && col.list && col.list !== col.root ? col.list : scroll;
			const y = col.heights.offset(entry.row) + (vHost === scroll ? col.headingHeight : 0);
			const h = col.heights.height(entry.row);
			if (y < vHost.scrollTop) vHost.scrollTop = Math.max(0, y - 12);
			else if (y + h > vHost.scrollTop + (vHost.clientHeight || 600)) {
				vHost.scrollTop = Math.max(0, y + h - (vHost.clientHeight || 600) + 12);
			}
			refresh();
			forcedToken = undefined;
			return mounted.get(entry.token);
		},
		adjacentItemID(currentID: number, key: string): number | undefined {
			return findAdjacentVirtualItemID(byID, order, columns, currentID, key);
		},
		getMountedCards: () => [...mounted.values()],
		setDragging(val: boolean) {
			dragging = val;
			if (!val) schedule();
		},
		destroy() {
			if (!active) return;
			active = false;
			if (rafId && typeof win?.cancelAnimationFrame === 'function') win.cancelAnimationFrame(rafId);
			scroll.removeEventListener('scroll', schedule);
			resizeObs?.disconnect();
			for (const col of columns) {
				if (board && col.list && col.list !== scroll) col.list.removeEventListener('scroll', schedule);
			}
			for (const [tok, card] of [...mounted.entries()]) forgetCard(tok, card);
			entries.clear();
			byID.clear();
			columns = [];
			order = [];
			orderIDs = [];
		},
	};
}
