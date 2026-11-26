/** Capture offsets before replacing the viewport. Restore once virtual spacers and columns exist. */
export function captureGalleryScroll(panel: HTMLElement): (viewport: HTMLElement) => boolean {
	const previous = panel.querySelector('.zbf-gal-viewport');
	const top = previous?.scrollTop || 0;
	const left = previous?.scrollLeft || 0;
	const boardLeft = previous?.querySelector('.zbf-gal-board')?.scrollLeft || 0;
	const columns = new Map<string, number>();
	previous?.querySelectorAll<HTMLElement>('.zbf-gal-col[data-col-key]').forEach(column => {
		const offset = column.querySelector('.zbf-gal-col-body')?.scrollTop;
		if (offset && column.dataset.colKey) columns.set(column.dataset.colKey, offset);
	});

	return viewport => {
		if (left) viewport.scrollLeft = left;
		if (top) viewport.scrollTop = top;
		if (boardLeft) {
			const board = viewport.querySelector('.zbf-gal-board');
			if (board) board.scrollLeft = boardLeft;
		}
		if (columns.size) {
			viewport.querySelectorAll<HTMLElement>('.zbf-gal-col[data-col-key]').forEach(column => {
				const offset = columns.get(column.dataset.colKey || '');
				const body = column.querySelector('.zbf-gal-col-body');
				if (offset && body) body.scrollTop = offset;
			});
		}
		return Boolean(top || columns.size);
	};
}
