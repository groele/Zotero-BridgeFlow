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

export function isCitationCollectionRef(
	ref: any,
	activeKeys: ReadonlySet<string>,
	activeNames?: ReadonlySet<string>,
): boolean {
	if (!ref || typeof ref !== 'object') return false;
	if (ref._isBridgeFlowCollection === true || ref._isCiteFlowCollection === true) return true;
	if (typeof ref.key === 'string' && ref.key && activeKeys.has(ref.key)) return true;
	const name = String(ref.name || '');
	if (name && (activeNames?.has(name) || /\.(?:docx|docm|doc|dotx|rtf)\s*(?:\([^)]+\))?$/i.test(name))) return true;
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
	activeNames?: ReadonlySet<string>,
): boolean {
	if (!Array.isArray(rows) || startIndex < 0 || endIndex <= startIndex || endIndex > rows.length) return false;
	const beforeBlocks: any[][] = [], citationBlocks: any[][] = [], afterBlocks: any[][] = [];
	let i = startIndex, reachedBottomVirtual = false;

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
			&& isCitationCollectionRef(head?.ref, activeKeys, activeNames),
		);
		if (isCitation) citationBlocks.push(block);
		else if (reachedBottomVirtual || isBottomVirtualRow(head)) { reachedBottomVirtual = true; afterBlocks.push(block); }
		else beforeBlocks.push(block);
	}

	if (!citationBlocks.length) return false;
	citationBlocks.sort((a, b) => compareCollectionNames(a[0]?.ref?.name, b[0]?.ref?.name));
	const reordered = [...beforeBlocks.flat(), ...citationBlocks.flat(), ...afterBlocks.flat()];
	if (reordered.length !== endIndex - startIndex) return false;
	if (reordered.every((item, idx) => rows[startIndex + idx] === item)) return false;
	rows.splice(startIndex, endIndex - startIndex, ...reordered);
	return true;
}

export function reorderViewCollections(cv: any, activeKeys: ReadonlySet<string>, activeNames?: ReadonlySet<string>): boolean {
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
				if (reorderCitationRowsInSlice(rows, i + 1, endIndex, libLevel + 1, activeKeys, activeNames)) {
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
		if (reorderCitationRowsInSlice(rows, 0, rows.length, baseLevel, activeKeys, activeNames)) {
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

const WORD_COLLECTION_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="16" height="16" fill="none" style="width:16px;height:16px;display:block;flex-shrink:0;pointer-events:none;"><defs><linearGradient id="msWordTop" x1="36" y1="12" x2="118" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#41A5EE"/><stop offset="100%" stop-color="#2B7CD3"/></linearGradient><linearGradient id="msWordTile" x1="10" y1="32" x2="72" y2="96" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#2368C4"/><stop offset="50%" stop-color="#185ABD"/><stop offset="100%" stop-color="#114694"/></linearGradient></defs><path d="M 38 22 C 38 15.4 43.4 10 50 10 H 106 C 112.6 10 118 15.4 118 22 V 37 H 38 Z" fill="url(#msWordTop)"/><rect x="38" y="36" width="80" height="28" fill="#2B7CD3"/><rect x="38" y="63" width="80" height="28" fill="#185ABD"/><path d="M 38 90 H 118 V 106 C 118 112.6 112.6 118 106 118 H 50 C 43.4 118 38 112.6 38 106 Z" fill="#103F91"/><rect x="13" y="36" width="62" height="62" rx="13" fill="#0B2559" fill-opacity="0.32"/><rect x="10" y="33" width="62" height="62" rx="13" fill="url(#msWordTile)"/><path d="M 20.5 47 H 28.5 L 33.5 72.5 L 40 47 H 46.8 L 53.2 72.5 L 58.2 47 H 66 L 57.5 82 H 49.8 L 43.4 58.2 L 37 82 H 29.2 Z" fill="#FFFFFF"/></svg>`;
const WORD_COLLECTION_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(WORD_COLLECTION_SVG)}`;

export function patchCollectionsViewForWindow(
	win: Window,
	runtime: NativeRuntime,
	getActiveKeys: () => ReadonlySet<string>,
	wordIconURI?: string,
	getActiveNames?: () => ReadonlySet<string>,
): Disposable {
	const cv = (win as any)?.ZoteroPane?.collectionsView;
	if (!cv) return () => {};
	const disposers: Disposable[] = [];
	const iconStates = new Map<HTMLElement, { bg: string; bgSize: string; bgPos: string; bgRepeat: string; hadSearch: boolean; hadCol: boolean; hadPub: boolean; children: Node[] }>();
	const resolvedURI = wordIconURI || WORD_COLLECTION_DATA_URI;
	const doc = win.document;
	let styleEl = doc?.getElementById?.('zbf-word-collection-style') as HTMLStyleElement | null;
	if (doc && !styleEl) {
		styleEl = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style') as HTMLStyleElement;
		styleEl.id = 'zbf-word-collection-style';
		styleEl.textContent = `.cell-icon.zbf-word-collection-icon::before, .cell-icon.zbf-word-collection-icon::after { display: none !important; content: none !important; } .cell-icon.zbf-word-collection-icon > svg:not(.zbf-word-svg) { display: none !important; }`;
		(doc.head || doc.documentElement)?.appendChild(styleEl);
		disposers.push(() => styleEl?.remove());
	}

	const restoreIcon = (node: HTMLElement) => {
		const st = iconStates.get(node);
		if (!st) return;
		iconStates.delete(node);
		node.style.backgroundImage = st.bg;
		node.style.backgroundSize = st.bgSize;
		node.style.backgroundPosition = st.bgPos;
		node.style.backgroundRepeat = st.bgRepeat;
		node.classList?.remove('zbf-word-collection-icon');
		node.classList?.toggle('icon-search', st.hadSearch);
		node.classList?.toggle('icon-collection', st.hadCol);
		node.classList?.toggle('icon-publications', st.hadPub);
		if (typeof node.replaceChildren === 'function') {
			node.replaceChildren(...st.children);
		}
	};

	const applyWordIcon = (iconNode: HTMLElement) => {
		if (!iconStates.has(iconNode)) {
			iconStates.set(iconNode, {
				bg: iconNode.style?.backgroundImage || '', bgSize: iconNode.style?.backgroundSize || '',
				bgPos: iconNode.style?.backgroundPosition || '', bgRepeat: iconNode.style?.backgroundRepeat || '',
				hadSearch: iconNode.classList?.contains('icon-search') === true,
				hadCol: iconNode.classList?.contains('icon-collection') === true,
				hadPub: iconNode.classList?.contains('icon-publications') === true,
				children: Array.from(iconNode.childNodes || []),
			});
		}
		iconNode.classList?.remove('icon-search', 'icon-collection', 'icon-css');
		iconNode.classList?.add('icon-publications', 'zbf-word-collection-icon');
		iconNode.style.backgroundImage = `url("${resolvedURI}")`;
		iconNode.style.backgroundSize = '16px 16px';
		iconNode.style.backgroundPosition = 'center';
		iconNode.style.backgroundRepeat = 'no-repeat';
		const ownerDoc = iconNode.ownerDocument;
		const Parser = (ownerDoc?.defaultView as any)?.DOMParser || (globalThis as any).DOMParser;
		if (ownerDoc && Parser && typeof iconNode.replaceChildren === 'function') {
			try {
				const parsed = new Parser().parseFromString(WORD_COLLECTION_SVG, 'image/svg+xml');
				if (parsed?.documentElement) {
					const svgEl = ownerDoc.importNode(parsed.documentElement, true) as Element;
					svgEl.classList?.add('zbf-word-svg');
					iconNode.replaceChildren(svgEl);
				}
			} catch { /* fallback to backgroundImage */ }
		}
	};

	const isCiteRow = (row: any): boolean =>
		Boolean((row?.isCollection?.() || row?.type === 'collection') && isCitationCollectionRef(row?.ref, getActiveKeys(), getActiveNames?.()));

	const syncLiveRowIcons = (): void => {
		if (!doc?.querySelectorAll) return;
		const rows: any[] = cv._rows || [];
		const rowNodes = Array.from(doc.querySelectorAll('#zotero-collections-tree .virtualized-table-body .row, #zotero-collections-tree .row')) as HTMLElement[];
		for (const rowEl of rowNodes) {
			const iconNode = rowEl.querySelector?.('.cell-icon') as HTMLElement | null;
			if (!iconNode) continue;
			const label = (rowEl.querySelector?.('.cell-text, .label')?.textContent || rowEl.textContent || '').trim();
			const matchedCite = rows.some((r) => isCiteRow(r) && String(r?.ref?.name || '').trim() === label)
				|| (label && (getActiveNames?.().has(label) || /\.(?:docx|docm|doc|dotx|rtf)\s*(?:\([^)]+\))?$/i.test(label)));
			if (matchedCite) applyWordIcon(iconNode);
			else if (iconStates.has(iconNode)) restoreIcon(iconNode);
		}
	};

	if (typeof cv.renderItem === 'function') {
		disposers.push(
			runtime.patch(cv, 'renderItem', 'collectionsView', (orig) => function (this: any, ...args: unknown[]) {
				const [index, , oldDiv] = args as [number, unknown, HTMLElement | null];
				const prevIcon = oldDiv?.querySelector?.('.cell-icon') as HTMLElement | null;
				if (prevIcon && iconStates.has(prevIcon)) restoreIcon(prevIcon);
				const div = orig.apply(this, args) as HTMLElement | null;
				try {
					const row = this.getRow?.(index) ?? this._rows?.[index];
					const iconNode = div?.querySelector?.('.cell-icon') as HTMLElement | null;
					if (isCiteRow(row) && iconNode) {
						applyWordIcon(iconNode);
					} else if (iconNode && iconStates.has(iconNode)) {
						restoreIcon(iconNode);
					}
				} catch { /* ignore */ }
				return div;
			}),
		);
	}
	syncLiveRowIcons();

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
