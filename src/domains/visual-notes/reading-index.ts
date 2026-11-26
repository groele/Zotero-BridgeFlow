import { renderRichTitleNodes } from './gallery/gallery-icons.ts';
import { galEl } from './gallery/gallery-styles.ts';

export interface ReadingSelection { itemID: number }

interface ReadingEntry { id: number; title: string; meta: string; count: number; weight?: number }

function resolveMasonryCols(width: number): number {
	if (width >= 1680) return 4;
	if (width >= 1120) return 3;
	if (width >= 740) return 2;
	return 1;
}

const activeRootDisposers = new WeakMap<HTMLElement, () => void>();

export function mountReadingIndex<T extends ReadingEntry>(
	root: HTMLElement,
	entries: T[],
	zh: boolean,
	selection: ReadingSelection | undefined,
	render: (entry: T, container: HTMLElement) => void,
): void {
	activeRootDisposers.get(root)?.();
	activeRootDisposers.delete(root);
	if (!entries.length) return;
	const doc = root.ownerDocument;
	const layout = galEl(doc, 'section');
	layout.className = 'zbf-reading-layout';
	const nav = galEl(doc, 'nav');
	nav.className = 'zbf-reading-index';
	const label = zh ? '文献目录' : 'Documents';
	nav.setAttribute('aria-label', label);
	const heading = galEl(doc, 'header');
	heading.textContent = `${label} · ${entries.length}`;
	nav.appendChild(heading);

	const select = galEl(doc, 'select');
	select.className = 'zbf-reading-select';
	select.setAttribute('aria-label', label);

	const page = galEl(doc, 'article');
	page.className = 'zbf-reading-page';

	const buttons = new Map<number, HTMLButtonElement>();
	const showAllOption = entries.length > 1;
	const totalCount = entries.reduce((sum, e) => sum + e.count, 0);
	let active: HTMLButtonElement | undefined;
	let resizeObs: ResizeObserver | null = null;
	let masonryRaf = 0;

	const disposeObserver = () => {
		if (masonryRaf && typeof doc.defaultView?.cancelAnimationFrame === 'function') {
			doc.defaultView.cancelAnimationFrame(masonryRaf);
		}
		masonryRaf = 0;
		try { resizeObs?.disconnect(); } catch { /* ignore */ }
		resizeObs = null;
	};
	activeRootDisposers.set(root, disposeObserver);

	const renderMasonryAll = () => {
		disposeObserver();
		page.setAttribute('data-view-mode', 'all');
		const grid = galEl(doc, 'div');
		grid.className = 'zbf-reading-grid';
		const renderedItems: Array<{ node: HTMLElement; weight: number }> = [];
		let cols: HTMLElement[] = [];
		let heights: number[] = [];
		let currentCols = 0;

		const placeItem = (item: { node: HTMLElement; weight: number }) => {
			if (!cols.length) return;
			let best = 0;
			for (let i = 1; i < cols.length; i++) {
				if (heights[i] < heights[best]) best = i;
			}
			cols[best].appendChild(item.node);
			heights[best] += item.weight;
		};

		const distribute = (colCount: number) => {
			const nextCols = Math.max(1, Math.min(colCount, entries.length));
			if (nextCols === currentCols) return;
			currentCols = nextCols;
			grid.replaceChildren();
			cols = [];
			heights = [];
			for (let i = 0; i < nextCols; i++) {
				const col = galEl(doc, 'div');
				col.className = 'zbf-masonry-col';
				cols.push(col);
				heights.push(0);
				grid.appendChild(col);
			}
			for (const item of renderedItems) placeItem(item);
		};

		page.appendChild(grid);
		const initWidth = page.clientWidth || (doc.defaultView?.innerWidth ? doc.defaultView.innerWidth - 280 : 1200);
		distribute(resolveMasonryCols(initWidth));

		const raf = doc.defaultView?.requestAnimationFrame?.bind(doc.defaultView);
		const initialBatch = raf ? Math.min(entries.length, 24) : entries.length;
		let cursor = 0;
		const appendBatch = (limit: number) => {
			const stop = Math.min(entries.length, cursor + limit);
			for (; cursor < stop; cursor++) {
				const entry = entries[cursor];
				const holder = galEl(doc, 'div');
				render(entry, holder);
				const cardNode = (holder.firstElementChild as HTMLElement) || holder;
				const weight = entry.weight ?? (1.6 + Math.max(1, entry.count) * 2.4);
				const item = { node: cardNode, weight };
				renderedItems.push(item);
				placeItem(item);
			}
		};
		appendBatch(initialBatch);
		const pumpRemaining = () => {
			masonryRaf = 0;
			if (!grid.isConnected || cursor >= entries.length) return;
			appendBatch(28);
			if (cursor < entries.length && raf) masonryRaf = raf(pumpRemaining);
		};
		if (cursor < entries.length && raf) masonryRaf = raf(pumpRemaining);

		const RO = (doc.defaultView as any)?.ResizeObserver || (globalThis as any).ResizeObserver;
		if (typeof RO === 'function') {
			const obs = new RO((recs: any[]) => {
				if (!page.isConnected) { disposeObserver(); return; }
				const w = recs[0]?.contentRect?.width || page.clientWidth || 0;
				if (w > 0) distribute(resolveMasonryCols(w));
			}) as ResizeObserver;
			obs.observe(page);
			resizeObs = obs;
		}
	};

	const chooseId = (targetId: number) => {
		active?.removeAttribute('aria-current');
		active = buttons.get(targetId);
		active?.setAttribute('aria-current', 'true');
		select.value = String(targetId);
		if (selection) selection.itemID = targetId;
		disposeObserver();
		page.replaceChildren();
		if (targetId === 0 && showAllOption) {
			renderMasonryAll();
		} else {
			const picked = entries.find((e) => e.id === targetId) || entries[0];
			page.setAttribute('data-view-mode', 'single');
			const wrap = galEl(doc, 'div');
			wrap.className = 'zbf-reading-single';
			render(picked, wrap);
			page.appendChild(wrap);
		}
		page.scrollTop = 0;
	};

	if (showAllOption) {
		const allBtn = galEl(doc, 'button');
		allBtn.type = 'button';
		allBtn.className = 'zbf-reading-all-btn';
		const rowTop = galEl(doc, 'div');
		rowTop.className = 'zbf-idx-row';
		const title = galEl(doc, 'span');
		title.textContent = zh ? '全部文献汇总' : 'All Documents';
		const badge = galEl(doc, 'em');
		badge.className = 'zbf-idx-badge';
		badge.textContent = String(totalCount);
		rowTop.append(title, badge);
		const meta = galEl(doc, 'small');
		meta.textContent = zh ? `共 ${entries.length} 篇 · 瀑布流全览` : `${entries.length} items · Masonry`;
		allBtn.append(rowTop, meta);
		allBtn.addEventListener('click', () => chooseId(0));
		nav.appendChild(allBtn);
		buttons.set(0, allBtn);

		const allOpt = galEl(doc, 'option');
		allOpt.value = '0';
		allOpt.textContent = zh ? `全部文献汇总 (${entries.length} 篇 / ${totalCount} 条)` : `All Documents (${entries.length} / ${totalCount})`;
		select.appendChild(allOpt);
	}

	for (const entry of entries) {
		const btn = galEl(doc, 'button');
		btn.type = 'button';
		const rowTop = galEl(doc, 'div');
		rowTop.className = 'zbf-idx-row';
		const title = galEl(doc, 'span');
		renderRichTitleNodes(doc, title, entry.title);
		const badge = galEl(doc, 'em');
		badge.className = 'zbf-idx-badge';
		badge.textContent = String(entry.count);
		rowTop.append(title, badge);
		btn.title = title.textContent || '';
		const meta = galEl(doc, 'small');
		meta.textContent = entry.meta || (zh ? `${entry.count} 条` : `${entry.count}`);
		btn.append(rowTop, meta);
		btn.addEventListener('click', () => chooseId(entry.id));
		nav.appendChild(btn);
		buttons.set(entry.id, btn);

		const opt = galEl(doc, 'option');
		opt.value = String(entry.id);
		opt.textContent = `${btn.title} (${entry.count})`;
		select.appendChild(opt);
	}

	select.addEventListener('change', () => chooseId(Number(select.value) || 0));
	layout.append(nav, select, page);
	root.appendChild(layout);

	const initialId = selection?.itemID && entries.some((e) => e.id === selection.itemID)
		? selection.itemID
		: (showAllOption ? 0 : entries[0].id);
	chooseId(initialId);
}
