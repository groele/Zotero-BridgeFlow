export function visibleNavItems(list: HTMLElement | null): HTMLElement[] {
	if (!list) return [];
	return Array.from(list.querySelectorAll('[data-zbf-nav]')).filter(
		(el): el is HTMLElement => Boolean(el) && typeof (el as any).focus === 'function' && !(el as any).closest?.('[hidden]'),
	);
}

export function bindSidebarKeyboardNavigation(
	aside: HTMLElement,
	list: HTMLElement,
	searchInput: HTMLInputElement,
	onClearSearch: () => void,
): void {
	aside.addEventListener('keydown', (ev) => {
		const e = ev as KeyboardEvent;
		if ((e as any).isComposing || e.keyCode === 229) return;
		const target = e.target as HTMLElement | null;

		if (target === searchInput) {
			if (e.key === 'ArrowDown') {
				const first = visibleNavItems(list)[0];
				if (first) {
					e.preventDefault();
					first.focus();
					first.scrollIntoView({ block: 'nearest' });
				}
			} else if (e.key === 'Escape' && searchInput.value) {
				e.preventDefault();
				onClearSearch();
			}
			return;
		}

		if (target && (target.matches('input, textarea, select') || target.isContentEditable)) return;

		if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
			e.preventDefault();
			searchInput.focus();
			searchInput.select();
			return;
		}

		const items = visibleNavItems(list);
		if (!items.length) return;
		const current = target?.closest('[data-zbf-nav]') as HTMLElement | null;
		const idx = current ? items.indexOf(current) : -1;

		let nextIdx = -1;
		if (e.key === 'ArrowDown') nextIdx = idx < 0 ? 0 : Math.min(items.length - 1, idx + 1);
		else if (e.key === 'ArrowUp') nextIdx = idx <= 0 ? 0 : idx - 1;
		else if (e.key === 'Home') nextIdx = 0;
		else if (e.key === 'End') nextIdx = items.length - 1;

		if (nextIdx >= 0 && items[nextIdx]) {
			e.preventDefault();
			items[nextIdx].focus();
			items[nextIdx].scrollIntoView({ block: 'nearest' });
			return;
		}

		if (current && e.key === 'Enter' && target === current) {
			e.preventDefault();
			current.click();
		}
	});
}
