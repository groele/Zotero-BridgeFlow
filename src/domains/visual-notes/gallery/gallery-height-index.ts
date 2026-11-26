export interface VirtualItemSpec<T> {
	readonly id: number;
	readonly key: string;
	readonly data: T;
}

export interface VirtualColumnSpec<T> {
	readonly value: string;
	readonly items: readonly VirtualItemSpec<T>[];
	readonly createShell: () => { root: HTMLElement; list: HTMLElement; headingHeight?: number };
}

export class GalleryHeightIndex {
	public readonly length: number;
	public readonly gap: number;
	private readonly heights: Float64Array;
	private readonly tree: Float64Array;

	constructor(length: number, estimate: number, gap: number) {
		this.length = Math.max(0, length);
		this.gap = gap;
		this.heights = new Float64Array(this.length).fill(estimate);
		this.tree = new Float64Array(this.length + 1);
		for (let i = 1; i <= this.length; i++) {
			this.tree[i] += estimate + gap;
			const parent = i + (i & -i);
			if (parent <= this.length) this.tree[parent] += this.tree[i];
		}
	}

	height(index: number): number {
		return this.heights[index] ?? 0;
	}

	offset(end: number): number {
		let sum = 0;
		for (let i = Math.min(this.length, Math.max(0, end)); i > 0; i -= i & -i) {
			sum += this.tree[i];
		}
		return sum;
	}

	get total(): number {
		return this.length ? Math.max(0, this.offset(this.length) - this.gap) : 0;
	}

	measure(index: number, height: number): boolean {
		if (index < 0 || index >= this.length || !Number.isFinite(height) || height <= 0) return false;
		const delta = height - this.heights[index];
		if (Math.abs(delta) < 0.5) return false;
		this.heights[index] = height;
		for (let i = index + 1; i <= this.length; i += i & -i) {
			this.tree[i] += delta;
		}
		return true;
	}

	at(offset: number): number {
		if (!this.length) return 0;
		let index = 0;
		let sum = 0;
		for (let bit = 2 ** Math.floor(Math.log2(this.length || 1)); bit >= 1; bit = Math.floor(bit / 2)) {
			const next = index + bit;
			if (next <= this.length && sum + this.tree[next] <= offset) {
				index = next;
				sum += this.tree[next];
			}
		}
		return Math.min(index, Math.max(0, this.length - 1));
	}

	range(top: number, bottom: number): [number, number] {
		if (!this.length) return [0, 0];
		const start = this.at(Math.max(0, top));
		const end = Math.min(this.length, this.at(Math.max(0, bottom)) + 1);
		return [start, Math.max(start, end)];
	}
}

export function moveGalleryKeys<T>(order: readonly T[], moved: readonly T[], before?: T): T[] {
	const set = new Set(moved);
	const rest = order.filter((k) => !set.has(k));
	const idx = before === undefined ? rest.length : rest.indexOf(before);
	const insertAt = idx < 0 ? rest.length : idx;
	return [...rest.slice(0, insertAt), ...moved, ...rest.slice(insertAt)];
}

export function computeMasonryColumnCount(viewportWidth: number, cardMinWidth: number, gap = 12): number {
	if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 1;
	const minW = Math.max(120, cardMinWidth);
	return Math.max(1, Math.floor((viewportWidth + gap) / (minW + gap)));
}
