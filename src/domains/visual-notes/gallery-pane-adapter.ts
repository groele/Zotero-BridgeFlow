export interface GallerySourceSnapshot {
	readonly context: string;
	readonly ids: readonly number[];
}

export function sameGallerySourceSnapshot(a: GallerySourceSnapshot | undefined, b: GallerySourceSnapshot): boolean {
	if (!a || a.context !== b.context || a.ids.length !== b.ids.length) return false;
	for (let i = 0; i < a.ids.length; i++) {
		if (a.ids[i] !== b.ids[i]) return false;
	}
	return true;
}

export function getGallerySourceSnapshot(win: Window): GallerySourceSnapshot {
	const pane = (win as any)?.ZoteroPane;
	const view = pane?.itemsView;
	const colRow = pane?.getCollectionTreeRow?.();
	const searchText = typeof pane?.getSearchFilterBoxValue === 'function' ? pane.getSearchFilterBoxValue() : '';
	const context = `${colRow?.id ?? colRow?.type ?? 'root'}|${view?.sortColumnId ?? ''}|${view?.sortDirection ?? ''}|${searchText ?? ''}`;
	const ids: number[] = [];
	const rowCount = Math.min(Number(view?.rowCount || 0), 20_000);
	for (let i = 0; i < rowCount; i++) {
		const ref = view?.getRow?.(i)?.ref;
		const id = Number(ref?.id || 0);
		if (id > 0) ids.push(id);
	}
	return { context, ids };
}

function wrapObjectMethods(target: any, names: readonly string[], afterCall: () => void): () => void {
	if (!target || typeof target !== 'object') return () => {};
	const restores: Array<() => void> = [];
	for (const name of names) {
		const orig = target[name];
		if (typeof orig !== 'function') continue;
		const wrapped = function (this: any, ...args: any[]) {
			const res = orig.apply(this, args);
			if (res && typeof res.then === 'function') {
				void res.then(() => afterCall(), () => {});
			} else {
				afterCall();
			}
			return res;
		};
		try {
			target[name] = wrapped;
			restores.push(() => { if (target[name] === wrapped) target[name] = orig; });
		} catch { /* frozen or getter-only */ }
	}
	return () => { for (const fn of restores.reverse()) fn(); };
}

export interface ZoteroPaneGalleryAdapter {
	rebind(): void;
	destroy(): void;
	getSelectedIDs(): number[];
	onRefresh(fn: () => void): () => void;
	onSelection(fn: () => void): () => void;
}

export function createZoteroPaneGalleryAdapter(win: Window): ZoteroPaneGalleryAdapter {
	let active = true;
	let boundItemsView: any = null;
	let boundCollectionsView: any = null;
	let boundProvider: any = null;
	let snapshot: GallerySourceSnapshot | undefined;
	let cleanups: Array<() => void> = [];
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	const refreshListeners = new Set<() => void>();
	const selectionListeners = new Set<() => void>();

	const emit = (set: Set<() => void>) => {
		for (const fn of [...set]) {
			if (!active || !set.has(fn)) continue;
			try { fn(); } catch { /* ignore */ }
		}
	};

	const scheduleSourceCheck = () => {
		if (!active) return;
		if (debounceTimer !== null) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			if (!active) return;
			const next = getGallerySourceSnapshot(win);
			if (sameGallerySourceSnapshot(snapshot, next)) return;
			snapshot = next;
			rebind();
			emit(refreshListeners);
		}, 32);
	};

	const detach = () => {
		for (const fn of cleanups) fn();
		cleanups = [];
		boundItemsView = null;
		boundCollectionsView = null;
		boundProvider = null;
	};

	const rebind = () => {
		if (!active) return;
		const pane = (win as any)?.ZoteroPane;
		const nextItems = pane?.itemsView;
		const nextCols = pane?.collectionsView;
		const nextProv = nextItems?.rowProvider;
		if (nextItems === boundItemsView && nextCols === boundCollectionsView && nextProv === boundProvider) return;
		detach();
		boundItemsView = nextItems;
		boundCollectionsView = nextCols;
		boundProvider = nextProv;
		if (snapshot === undefined) snapshot = getGallerySourceSnapshot(win);

		if (nextItems) {
			cleanups.push(wrapObjectMethods(nextItems, [
				'refresh', 'sort', 'setFilter', 'refreshAndMaintainSelection',
				'changeCollectionTreeRow', 'changeCollectionTreeRows', 'notify',
			], scheduleSourceCheck));
			const onSel = () => { if (active) emit(selectionListeners); };
			if (typeof nextItems.onSelect?.addListener === 'function') {
				nextItems.onSelect.addListener(onSel);
				cleanups.push(() => nextItems.onSelect?.removeListener?.(onSel));
			}
			const treeDom = win.document?.getElementById('zotero-items-tree');
			if (treeDom) {
				treeDom.addEventListener('select', onSel);
				cleanups.push(() => treeDom.removeEventListener('select', onSel));
			}
		}
		if (nextCols) {
			const onColSel = () => { if (active) { rebind(); scheduleSourceCheck(); } };
			if (typeof nextCols.onSelect?.addListener === 'function') {
				nextCols.onSelect.addListener(onColSel);
				cleanups.push(() => nextCols.onSelect?.removeListener?.(onColSel));
			}
			const colDom = win.document?.getElementById('zotero-collections-tree');
			if (colDom) {
				colDom.addEventListener('click', onColSel);
				colDom.addEventListener('keyup', onColSel);
				cleanups.push(() => {
					colDom.removeEventListener('click', onColSel);
					colDom.removeEventListener('keyup', onColSel);
				});
			}
		}
	};

	rebind();

	return {
		rebind,
		destroy() {
			if (!active) return;
			active = false;
			if (debounceTimer !== null) { clearTimeout(debounceTimer); debounceTimer = null; }
			detach();
			refreshListeners.clear();
			selectionListeners.clear();
		},
		getSelectedIDs(): number[] {
			const sel = (win as any)?.ZoteroPane?.getSelectedItems?.() || [];
			return sel.map((it: any) => Number(it?.id || 0)).filter((n: number) => n > 0);
		},
		onRefresh(fn) {
			if (!active) return () => {};
			refreshListeners.add(fn);
			return () => refreshListeners.delete(fn);
		},
		onSelection(fn) {
			if (!active) return () => {};
			selectionListeners.add(fn);
			return () => selectionListeners.delete(fn);
		},
	};
}

export function createGalleryVisibilityGuard(
	win: Window,
	itemsPane: HTMLElement,
	galleryPanel: HTMLElement,
	onChildListChanged?: () => void,
) {
	interface SavedNodeState {
		visibility: [string, string];
		inert: string | null;
		ariaHidden: string | null;
	}
	const saved = new Map<HTMLElement, SavedNodeState>();
	let active = true;
	let enabled = false;

	const collectNativeNodes = (): HTMLElement[] => {
		const out = new Set<HTMLElement>();
		for (const child of Array.from(itemsPane.children)) {
			if (child !== galleryPanel && !child.contains(galleryPanel)) {
				out.add(child as HTMLElement);
			}
		}
		for (const sel of ['#zotero-items-tree', '#item-tree-main-default', '#item-tree-main', '[id^="item-tree-main-"]', '#zotero-items-pane .virtualized-table']) {
			itemsPane.querySelectorAll(sel).forEach((n) => {
				if (n !== galleryPanel && !galleryPanel.contains(n) && !n.contains(galleryPanel)) out.add(n as HTMLElement);
			});
		}
		return [...out];
	};

	const restoreNode = (node: HTMLElement) => {
		const st = saved.get(node);
		if (!st) return;
		saved.delete(node);
		if (st.visibility[0]) node.style.setProperty('visibility', st.visibility[0], st.visibility[1]);
		else node.style.removeProperty('visibility');
		if (st.inert === null) node.removeAttribute('inert');
		else node.setAttribute('inert', st.inert);
		if (st.ariaHidden === null) node.removeAttribute('aria-hidden');
		else node.setAttribute('aria-hidden', st.ariaHidden);
	};

	const restoreAll = () => {
		for (const n of [...saved.keys()]) restoreNode(n);
	};

	const refresh = () => {
		if (!active) return;
		const wantDisplay = enabled ? 'flex' : 'none';
		if (galleryPanel.style.getPropertyValue('display') !== wantDisplay || galleryPanel.style.getPropertyPriority('display') !== 'important') {
			galleryPanel.style.setProperty('display', wantDisplay, 'important');
		}
		if (!enabled) {
			itemsPane.removeAttribute('data-zbf-gallery');
			restoreAll();
			return;
		}
		itemsPane.setAttribute('data-zbf-gallery', 'true');
		const nodes = new Set(collectNativeNodes());
		for (const prev of [...saved.keys()]) {
			if (!nodes.has(prev)) restoreNode(prev);
		}
		for (const node of nodes) {
			if (!saved.has(node)) {
				saved.set(node, {
					visibility: [node.style.getPropertyValue('visibility'), node.style.getPropertyPriority('visibility')],
					inert: node.getAttribute('inert'),
					ariaHidden: node.getAttribute('aria-hidden'),
				});
			}
			if (node.style.getPropertyValue('visibility') !== 'hidden') node.style.setProperty('visibility', 'hidden', 'important');
			if (node.getAttribute('inert') === null) node.setAttribute('inert', '');
			if (node.getAttribute('aria-hidden') !== 'true') node.setAttribute('aria-hidden', 'true');
		}
	};

	const MutationObs = (win as any)?.MutationObserver || (globalThis as any).MutationObserver;
	const observer = MutationObs ? new MutationObs((records: MutationRecord[]) => {
		if (!active) return;
		const external = records.filter((r) => r.target !== galleryPanel && !galleryPanel.contains(r.target as Node));
		if (!external.length) return;
		if (enabled) refresh();
		if (external.some((r) => r.type === 'childList')) onChildListChanged?.();
	}) : null;
	observer?.observe(itemsPane, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'id'] });

	return {
		setEnabled(next: boolean) {
			if (!active) return;
			enabled = next;
			refresh();
			if (!next) {
				const tree = (win as any)?.ZoteroPane?.itemsView?.tree;
				try { tree?.invalidate?.(); tree?.render?.(); } catch { /* ignore */ }
			}
		},
		refresh,
		destroy() {
			if (!active) return;
			active = false;
			enabled = false;
			observer?.disconnect();
			itemsPane.removeAttribute('data-zbf-gallery');
			restoreAll();
		},
	};
}

export async function selectZoteroGalleryItems(win: Window, ids: readonly number[]): Promise<void> {
	const view = (win as any)?.ZoteroPane?.itemsView;
	if (!view) return;
	try {
		if (!ids.length) {
			await view.selection?.clearSelection?.();
			return;
		}
		if (typeof view.selectItems === 'function') {
			await view.selectItems([...ids], true, true);
		} else if (typeof view.selectItem === 'function') {
			await view.selectItem(ids[0]);
		}
	} catch { /* ignore */ }
}

export async function openZoteroItemContextMenu(win: Window, event: MouseEvent): Promise<void> {
	const pane = (win as any)?.ZoteroPane;
	if (!pane) return;
	try {
		if (typeof pane.onItemsContextMenuOpen === 'function') {
			await pane.onItemsContextMenuOpen.call(pane, event);
			return;
		}
		if (typeof pane.buildItemContextMenu === 'function') {
			await pane.buildItemContextMenu.call(pane);
			const menu = win.document?.getElementById('zotero-itemmenu') as any;
			menu?.openPopupAtScreen?.(event.screenX + 1, event.screenY + 1, true);
		}
	} catch { /* ignore */ }
}

export async function openZoteroGalleryItem(
	win: Window,
	item: any,
	event?: MouseEvent | KeyboardEvent,
	fallbackOpenItem?: (itemID: number) => void,
): Promise<void> {
	const pane = (win as any)?.ZoteroPane;
	if (!item) return;
	try {
		if (item.isNote?.() && typeof pane?.openNoteWindow === 'function') {
			await pane.openNoteWindow(item.id);
			return;
		}
		if (item.isAnnotation?.() && item.parentID && typeof pane?.viewAttachment === 'function') {
			await pane.viewAttachment(item.parentID, event, false, { location: { annotationID: item.key } });
			return;
		}
		if (typeof pane?.viewItems === 'function') {
			await pane.viewItems([item], event);
			return;
		}
	} catch { /* fallback below */ }
	if (item.id) fallbackOpenItem?.(Number(item.id));
}
