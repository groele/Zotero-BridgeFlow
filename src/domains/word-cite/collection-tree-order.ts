import type { NativeRuntime } from '../../kernel/native-runtime.ts';
import type { Disposable } from '../../kernel/types.ts';

export const TEMP_COLLECTION_RELATION = 'dc:relation';
export const TEMP_COLLECTION_MARKER = 'https://github.com/groele/Zotero-BridgeFlow#temporary-collection';
export const TEMP_COLLECTION_KEYS_PREF = 'extensions.zotero.bridgeflow.wordCite.temporaryCollectionKeys';

const RECOGNIZED_MARKERS = new Set([
	TEMP_COLLECTION_MARKER,
	'https://github.com/groele/Zotero-CiteFlow#temporary-collection',
	'https://github.com/MuiseDestiny/zotero-citation#temporary-collection',
	'BridgeFlow',
]);

export function isCitationCollectionRef(ref: any, activeKeys: ReadonlySet<string>): boolean {
	if (!ref || typeof ref !== 'object') return false;
	if (ref._isBridgeFlowCollection === true || ref._isCiteFlowCollection === true) return true;
	if (typeof ref.key === 'string' && ref.key && activeKeys.has(ref.key)) return true;
	try {
		const rels = ref.getRelationsByPredicate?.(TEMP_COLLECTION_RELATION) || [];
		if (Array.isArray(rels) && rels.some((r) => RECOGNIZED_MARKERS.has(r))) return true;
	} catch { /* ignore */ }
	return false;
}

export function isBottomVirtualRow(row: any): boolean {
	if (!row || typeof row !== 'object') return false;
	const t = row.type;
	return t === 'publications' || t === 'duplicates' || t === 'unfiled' || t === 'retracted' || t === 'trash'
		|| Boolean(row.isPublications?.() || row.isDuplicates?.() || row.isUnfiled?.() || row.isRetracted?.() || row.isTrash?.());
}

export function compareCollectionNames(nameA?: string, nameB?: string): number {
	const a = String(nameA ?? '');
	const b = String(nameB ?? '');
	const zot = (globalThis as any).Zotero;
	return typeof zot?.localeCompare === 'function' ? zot.localeCompare(a, b) : a.localeCompare(b);
}

export function reorderCitationRowsInSlice(
	rows: any[],
	startIndex: number,
	endIndex: number,
	targetLevel: number,
	activeKeys: ReadonlySet<string>,
): boolean {
	if (!Array.isArray(rows) || startIndex < 0 || endIndex <= startIndex || endIndex > rows.length) return false;
	const beforeBlocks: any[][] = [];
	const citationBlocks: any[][] = [];
	const afterBlocks: any[][] = [];
	let i = startIndex;
	let reachedBottomVirtual = false;

	while (i < endIndex) {
		const head = rows[i];
		const block = [head];
		i += 1;
		while (i < endIndex && (rows[i]?.level ?? targetLevel) > targetLevel) {
			block.push(rows[i]);
			i += 1;
		}
		const isCitation = Boolean(
			(head?.isCollection?.() || head?.type === 'collection' || head?.ref?.key)
			&& isCitationCollectionRef(head?.ref, activeKeys),
		);
		if (isCitation) {
			citationBlocks.push(block);
		} else if (reachedBottomVirtual || isBottomVirtualRow(head)) {
			reachedBottomVirtual = true;
			afterBlocks.push(block);
		} else {
			beforeBlocks.push(block);
		}
	}

	if (!citationBlocks.length) return false;
	citationBlocks.sort((a, b) => compareCollectionNames(a[0]?.ref?.name, b[0]?.ref?.name));
	const reordered = [...beforeBlocks.flat(), ...citationBlocks.flat(), ...afterBlocks.flat()];
	if (reordered.length !== endIndex - startIndex) return false;

	let changed = false;
	for (let k = 0; k < reordered.length; k++) {
		if (rows[startIndex + k] !== reordered[k]) {
			changed = true;
			break;
		}
	}
	if (!changed) return false;
	rows.splice(startIndex, endIndex - startIndex, ...reordered);
	return true;
}

export function reorderViewCollections(cv: any, activeKeys: ReadonlySet<string>): boolean {
	const rows: any[] = cv?._rows;
	if (!cv || !Array.isArray(rows) || rows.length < 2) return false;

	const focusedID = cv.getRow?.(cv.selection?.focused)?.id;
	const pivotID = cv.getRow?.(cv.selection?.pivot)?.id;
	const selectedIDs = cv.selection?.selected instanceof Set
		? [...cv.selection.selected].map((idx: number) => cv.getRow?.(idx)?.id).filter(Boolean)
		: [];

	let anyChanged = false;
	let sawLibraryRow = false;
	let i = 0;

	while (i < rows.length) {
		const row = rows[i];
		const isLib = Boolean(row?.isLibrary?.(true) || row?.type === 'library' || row?.type === 'group');
		if (isLib) {
			sawLibraryRow = true;
			if (typeof cv.isContainerOpen !== 'function' || cv.isContainerOpen(i)) {
				const libLevel = typeof cv.getLevel === 'function' ? cv.getLevel(i) : (row.level ?? 0);
				let endIndex = i + 1;
				while (endIndex < rows.length) {
					const nextLevel = typeof cv.getLevel === 'function' ? cv.getLevel(endIndex) : (rows[endIndex]?.level ?? 0);
					if (nextLevel <= libLevel) break;
					endIndex += 1;
				}
				if (reorderCitationRowsInSlice(rows, i + 1, endIndex, libLevel + 1, activeKeys)) {
					anyChanged = true;
				}
				i = endIndex;
				continue;
			}
		}
		i += 1;
	}

	if (!sawLibraryRow) {
		const baseLevel = typeof cv.getLevel === 'function' ? cv.getLevel(0) : (rows[0]?.level ?? 0);
		if (reorderCitationRowsInSlice(rows, 0, rows.length, baseLevel, activeKeys)) {
			anyChanged = true;
		}
	}

	if (!anyChanged) return false;
	cv._refreshRowMap?.();
	if (cv.selection && cv._rowMap) {
		if (focusedID && typeof cv._rowMap[focusedID] === 'number') cv.selection.focused = cv._rowMap[focusedID];
		if (pivotID && typeof cv._rowMap[pivotID] === 'number') cv.selection.pivot = cv._rowMap[pivotID];
		if (cv.selection.selected instanceof Set && selectedIDs.length) {
			cv.selection.selected = new Set(
				selectedIDs.map((id: string) => cv._rowMap[id]).filter((idx: unknown) => typeof idx === 'number'),
			);
		}
	}
	cv.tree?.invalidate?.();
	return true;
}

export function insertCitationRowAbovePublications(
	cv: any,
	col: any,
	activeKeys: ReadonlySet<string>,
): number | false {
	const startRow = cv?._rowMap?.['L' + col?.libraryID];
	if (startRow === undefined || (typeof cv.isContainerOpen === 'function' && !cv.isContainerOpen(startRow))) {
		return false;
	}
	const libLevel = typeof cv.getLevel === 'function' ? cv.getLevel(startRow) : (cv._rows?.[startRow]?.level ?? 0);
	const level = libLevel + 1;
	let beforeRow = startRow + 1;
	if (typeof cv.isContainerEmpty !== 'function' || !cv.isContainerEmpty(startRow)) {
		for (let i = startRow + 1; i < (cv._rows?.length || 0); i++) {
			const rowLevel = typeof cv.getLevel === 'function' ? cv.getLevel(i) : (cv._rows[i]?.level ?? 0);
			if (rowLevel < level) { beforeRow = i; break; }
			if (rowLevel === level) {
				const treeRow = cv.getRow?.(i) ?? cv._rows[i];
				if (isBottomVirtualRow(treeRow)) { beforeRow = i; break; }
				if ((treeRow?.isCollection?.() || treeRow?.type === 'collection')
					&& isCitationCollectionRef(treeRow.ref, activeKeys)
					&& compareCollectionNames(treeRow.ref?.name, col.name) > 0) {
					beforeRow = i;
					break;
				}
			}
			beforeRow = i + 1;
		}
	}
	const RowCtor = (globalThis as any).Zotero?.CollectionTreeRow
		|| cv?._rows?.find?.((r: any) => (r?.isCollection?.() || r?.type === 'collection') && typeof r?.constructor === 'function' && r.constructor !== Object)?.constructor;
	if (typeof RowCtor !== 'function' || typeof cv._addRow !== 'function') {
		return false;
	}
	if (typeof cv._includedInTree !== 'function' || cv._includedInTree(col)) {
		cv._addRow(new RowCtor(cv, 'collection', col, level), beforeRow);
	}
	return beforeRow;
}

export function patchCollectionsViewForWindow(
	win: Window,
	runtime: NativeRuntime,
	getActiveKeys: () => ReadonlySet<string>,
	wordIconURI?: string,
): Disposable {
	const cv = (win as any)?.ZoteroPane?.collectionsView;
	if (!cv) return () => {};
	const disposers: Disposable[] = [];
	const iconStates = new Map<HTMLElement, { bg: string; hadSearch: boolean; hadCol: boolean; hadPub: boolean }>();

	const restoreIcon = (node: HTMLElement) => {
		const st = iconStates.get(node);
		if (!st) return;
		iconStates.delete(node);
		if (String(node.style?.backgroundImage || '').includes('word.svg')) {
			node.style.backgroundImage = st.bg;
		}
		node.classList?.toggle('icon-search', st.hadSearch);
		node.classList?.toggle('icon-collection', st.hadCol);
		node.classList?.toggle('icon-publications', st.hadPub);
	};

	if (wordIconURI && typeof cv.renderItem === 'function') {
		disposers.push(
			runtime.patch(cv, 'renderItem', 'collectionsView', (orig) => function (this: any, ...args: unknown[]) {
				const [index, , oldDiv] = args as [number, unknown, HTMLElement | null];
				const prevIcon = oldDiv?.querySelector?.('.cell-icon') as HTMLElement | null;
				if (prevIcon && iconStates.has(prevIcon)) restoreIcon(prevIcon);
				const div = orig.apply(this, args) as HTMLElement | null;
				try {
					const row = this.getRow?.(index) ?? this._rows?.[index];
					const isCite = Boolean((row?.isCollection?.() || row?.type === 'collection') && isCitationCollectionRef(row?.ref, getActiveKeys()));
					const iconNode = div?.querySelector?.('.cell-icon') as HTMLElement | null;
					if (isCite && iconNode) {
						if (!iconStates.has(iconNode)) {
							iconStates.set(iconNode, {
								bg: iconNode.style?.backgroundImage || '',
								hadSearch: iconNode.classList?.contains('icon-search') === true,
								hadCol: iconNode.classList?.contains('icon-collection') === true,
								hadPub: iconNode.classList?.contains('icon-publications') === true,
							});
						}
						iconNode.style.backgroundImage = `url(${wordIconURI})`;
						iconNode.classList?.remove('icon-search', 'icon-collection');
						iconNode.classList?.add('icon-publications');
					} else if (iconNode && iconStates.has(iconNode)) {
						restoreIcon(iconNode);
					}
				} catch { /* ignore */ }
				return div;
			}),
		);
	}

	if (typeof cv._expandRow === 'function') {
		disposers.push(
			runtime.patch(cv, '_expandRow', 'collectionsView', (orig) => async function (this: any, ...args: unknown[]) {
				const [rows, row] = args as [any[], number];
				const added = await orig.apply(this, args);
				if (typeof added === 'number' && added > 0 && rows?.[row]?.isLibrary?.(true)) {
					const libLevel = typeof this.getLevel === 'function' && rows === this._rows ? this.getLevel(row) : (rows[row]?.level ?? 0);
					if (reorderCitationRowsInSlice(rows, row + 1, row + 1 + added, libLevel + 1, getActiveKeys())) {
						this._refreshRowMap?.();
						this.tree?.invalidate?.();
					}
				}
				return added;
			}),
		);
	}

	if (typeof cv._addSortedRow === 'function') {
		disposers.push(
			runtime.patch(cv, '_addSortedRow', 'collectionsView', (orig) => async function (this: any, ...args: unknown[]) {
				const [objectType, id] = args as [string, number];
				const activeKeys = getActiveKeys();
				if (objectType === 'collection') {
					const zotCols = (globalThis as any).Zotero?.Collections;
					const col = zotCols?.get?.(id) || await zotCols?.getAsync?.(id);
					if (col && !col.parentID && isCitationCollectionRef(col, activeKeys)) {
						const inserted = insertCitationRowAbovePublications(this, col, activeKeys);
						if (inserted !== false) return inserted;
						const res = await orig.apply(this, args);
						reorderViewCollections(this, activeKeys);
						return res;
					}
				}
				const masked: Array<{ row: any; hasOwn: boolean; original: unknown }> = [];
				for (const row of this._rows || []) {
					if ((row?.isCollection?.() || row?.type === 'collection') && isCitationCollectionRef(row?.ref, activeKeys)) {
						const hasOwn = Object.prototype.hasOwnProperty.call(row, 'isCollection');
						const original = row.isCollection;
						row.isCollection = () => false;
						masked.push({ row, hasOwn, original });
					}
				}
				try {
					return await orig.apply(this, args);
				} finally {
					for (const { row, hasOwn, original } of masked) {
						if (hasOwn) row.isCollection = original;
						else delete row.isCollection;
					}
				}
			}),
		);
	}

	return () => {
		for (const node of iconStates.keys()) {
			try { restoreIcon(node); } catch { /* ignore */ }
		}
		iconStates.clear();
		for (const fn of disposers.reverse()) {
			try { fn(); } catch { /* ignore */ }
		}
	};
}
