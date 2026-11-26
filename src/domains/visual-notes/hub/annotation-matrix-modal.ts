import type { UnifiedPrefService } from '../../../kernel/pref-service.ts';
import type { TypedEventBus } from '../../../kernel/event-bus.ts';
import type { UnifiedClipboardService } from '../../../services/clipboard-service.ts';
import {
	buildAnnotationMatrixFromCollected,
	type AnnotationMatrix,
} from '../../../services/annotation-matrix.ts';
import { collectItemAnnotations, parseColorSemantics } from '../../../services/annotation-utils.ts';
import { mountAnnotationMatrixFooterActions } from './annotation-matrix-actions.ts';
import {
	ensureMatrixStyles,
	extractQueryTerms,
	matrixEl as el,
	renderHighlightedSnippet,
	writeMatrixClipboard,
} from './annotation-matrix-ui.ts';
import { renderRichTitleNodes } from '../gallery/gallery-icons.ts';

const closeByDocument = new WeakMap<Document, () => void>();

export function openAnnotationMatrixModal(options: {
	win: Window;
	title: string;
	itemIDs: readonly number[];
	prefs: UnifiedPrefService;
	bus?: TypedEventBus;
	clipboard?: UnifiedClipboardService;
	mountRoot?: HTMLElement | null;
}): void {
	const doc = options.mountRoot?.ownerDocument || options.win.document;
	if (!doc) return;
	ensureMatrixStyles(doc);
	closeByDocument.get(doc)?.();

	const hostItems = (globalThis as any).Zotero?.Items;
	const items = [...new Set(options.itemIDs)]
		.map((id) => hostItems?.get?.(id))
		.filter((it) => it && !it.deleted);

	const colorJson = options.prefs.get('inspector.annotations.colorLabels');
	const semantics = parseColorSemantics(colorJson);
	const colorByLabel = new Map<string, string>();
	for (const [hex, lbl] of Object.entries(semantics)) {
		if (!colorByLabel.has(lbl)) colorByLabel.set(lbl, hex);
	}
	const baseAnnotations = collectItemAnnotations(items, semantics);
	const fullMatrix = buildAnnotationMatrixFromCollected(items, semantics, baseAnnotations);
	const countsByCol = new Map<string, number>();
	for (const col of fullMatrix.columns) {
		let total = 0;
		for (const r of fullMatrix.rows) total += (r.cells[col] || []).length;
		countsByCol.set(col, total);
	}

	const backdrop = el(doc, 'div');
	backdrop.id = 'zbf-matrix-backdrop';
	backdrop.className = 'zbf-matrix-backdrop';
	const dialog = el(doc, 'div');
	dialog.className = 'zbf-matrix-dialog';

	const head = el(doc, 'div');
	head.className = 'zbf-matrix-head';
	const heading = el(doc, 'div');
	heading.className = 'zbf-matrix-title';
	heading.textContent = `文献对比矩阵 · ${options.title} (${items.length} 篇 / ${fullMatrix.totalAnnotations} 条标注)`;
	const closeBtn = el(doc, 'button') as HTMLButtonElement;
	closeBtn.type = 'button';
	closeBtn.className = 'zbf-matrix-close';
	closeBtn.textContent = '✕';
	head.append(heading, closeBtn);

	const controls = el(doc, 'div');
	controls.className = 'zbf-matrix-controls';
	const searchWrap = el(doc, 'div');
	searchWrap.className = 'zbf-matrix-search-wrap';
	const queryInput = el(doc, 'input') as HTMLInputElement;
	queryInput.type = 'text';
	queryInput.className = 'zbf-matrix-input';
	queryInput.placeholder = '筛选标注（支持 方法 && 对照 或 局限 || 不足）...';
	const clearBtn = el(doc, 'button') as HTMLButtonElement;
	clearBtn.type = 'button';
	clearBtn.className = 'zbf-matrix-clear';
	clearBtn.textContent = '✕';
	clearBtn.title = '清空筛选条件';
	searchWrap.append(queryInput, clearBtn);
	controls.appendChild(searchWrap);

	let activeColor = '';
	const chipButtons: HTMLButtonElement[] = [];
	const addChip = (label: string, value: string, count: number) => {
		const btn = el(doc, 'button') as HTMLButtonElement;
		btn.type = 'button';
		btn.className = 'zbf-matrix-chip';
		const dotHex = value ? colorByLabel.get(value) : '';
		if (dotHex) {
			const dot = el(doc, 'span');
			dot.className = 'zbf-matrix-dot';
			dot.style.background = dotHex;
			btn.appendChild(dot);
		}
		const txt = el(doc, 'span');
		txt.textContent = count > 0 ? `${label} (${count})` : label;
		btn.appendChild(txt);
		if (!value) btn.setAttribute('data-active', 'true');
		btn.addEventListener('click', () => {
			activeColor = value;
			for (const b of chipButtons) b.removeAttribute('data-active');
			btn.setAttribute('data-active', 'true');
			renderTable();
		});
		chipButtons.push(btn);
		controls.appendChild(btn);
	};
	addChip('全部维度', '', fullMatrix.totalAnnotations);
	for (const col of fullMatrix.columns) addChip(col, col, countsByCol.get(col) || 0);

	const scroll = el(doc, 'div');
	scroll.className = 'zbf-matrix-scroll';
	const statusEl = el(doc, 'span');
	statusEl.className = 'zbf-matrix-status';

	const selectedIDs = new Set<number>(items.map((it) => Number(it.id)));
	let currentMatrix: AnnotationMatrix = fullMatrix;
	const updateStatus = () => {
		const visibleSelected = currentMatrix.rows.filter((r) => selectedIDs.has(r.itemID)).length;
		statusEl.textContent = `当前显示 ${currentMatrix.rows.length} 篇 / ${currentMatrix.totalAnnotations} 条标注 · 已勾选 ${visibleSelected} 篇`;
	};

	let filterTimer: ReturnType<typeof setTimeout> | null = null;
	let composing = false;
	const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault?.(); close(); } };
	const close = () => {
		if (filterTimer !== null) { clearTimeout(filterTimer); filterTimer = null; }
		doc.removeEventListener?.('keydown', onKey, true);
		backdrop.remove();
		closeByDocument.delete(doc);
	};

	const renderTable = () => {
		if (filterTimer !== null) { clearTimeout(filterTimer); filterTimer = null; }
		clearBtn.style.display = queryInput.value ? 'inline-flex' : 'none';
		currentMatrix = !queryInput.value && !activeColor ? fullMatrix : buildAnnotationMatrixFromCollected(items, semantics, baseAnnotations, {
			query: queryInput.value,
			colorLabel: activeColor,
		});
		scroll.textContent = '';
		updateStatus();
		if (!currentMatrix.rows.length || !currentMatrix.columns.length) {
			const empty = el(doc, 'div');
			empty.className = 'zbf-matrix-empty';
			empty.textContent = items.length
				? '当前筛选条件下没有匹配的标注，请尝试调整关键词或颜色维度。'
				: '未检测到可对比的文献。请先在阅读器中打开文献，或在主文库选中多篇带标注的文献后重试。';
			scroll.appendChild(empty);
			return;
		}
		const terms = extractQueryTerms(queryInput.value);
		const table = el(doc, 'table');
		table.className = 'zbf-matrix-table';
		const thead = el(doc, 'thead');
		const trHead = el(doc, 'tr');
		const firstTh = el(doc, 'th');
		firstTh.style.width = '220px';
		const allCb = el(doc, 'input') as HTMLInputElement;
		allCb.type = 'checkbox';
		const syncAllCheckbox = () => {
			const total = currentMatrix.rows.length;
			const checkedCount = currentMatrix.rows.filter((r) => selectedIDs.has(r.itemID)).length;
			allCb.checked = total > 0 && checkedCount === total;
			allCb.indeterminate = checkedCount > 0 && checkedCount < total;
		};
		syncAllCheckbox();
		allCb.style.marginRight = '6px';
		allCb.title = '全选 / 取消当前列表文献';
		const rowCbs: HTMLInputElement[] = [];
		allCb.addEventListener('change', () => {
			allCb.indeterminate = false;
			for (const r of currentMatrix.rows) {
				if (allCb.checked) selectedIDs.add(r.itemID);
				else selectedIDs.delete(r.itemID);
			}
			for (const cb of rowCbs) cb.checked = allCb.checked;
			updateStatus();
		});
		const headTitle = el(doc, 'span');
		headTitle.textContent = `文献 (${currentMatrix.rows.length})`;
		firstTh.append(allCb, headTitle);
		trHead.appendChild(firstTh);
		for (const col of currentMatrix.columns) {
			const th = el(doc, 'th');
			const dotHex = colorByLabel.get(col);
			if (dotHex) {
				const dot = el(doc, 'span');
				dot.className = 'zbf-matrix-dot';
				dot.style.background = dotHex;
				dot.style.marginRight = '5px';
				th.appendChild(dot);
			}
			const lbl = el(doc, 'span');
			lbl.textContent = col;
			th.appendChild(lbl);
			trHead.appendChild(th);
		}
		thead.appendChild(trHead);
		table.appendChild(thead);

		const tbody = el(doc, 'tbody');
		for (const row of currentMatrix.rows) {
			const tr = el(doc, 'tr');
			const tdTitle = el(doc, 'td');
			const cb = el(doc, 'input') as HTMLInputElement;
			cb.type = 'checkbox';
			cb.checked = selectedIDs.has(row.itemID);
			cb.style.marginRight = '6px';
			rowCbs.push(cb);
			cb.addEventListener('change', () => {
				if (cb.checked) selectedIDs.add(row.itemID);
				else selectedIDs.delete(row.itemID);
				syncAllCheckbox();
				updateStatus();
			});
			const link = el(doc, 'button') as HTMLButtonElement;
			link.type = 'button';
			link.className = 'zbf-matrix-item-link';
			renderRichTitleNodes(doc, link, row.title);
			link.title = '打开并聚焦此文献阅读器';
			link.addEventListener('click', () => {
				close();
				options.bus?.emit('workspace:open-item-request', { itemID: row.itemID, preferExistingTab: true });
			});
			tdTitle.append(cb, link);
			if (row.creatorYear) {
				const sub = el(doc, 'div');
				sub.style.opacity = '0.72';
				sub.style.fontSize = '11px';
				sub.textContent = row.creatorYear;
				tdTitle.appendChild(sub);
			}
			tr.appendChild(tdTitle);
			for (const col of currentMatrix.columns) {
				const td = el(doc, 'td');
				const colColor = colorByLabel.get(col) || '';
				for (const ann of row.cells[col] || []) {
					const block = el(doc, 'div');
					block.className = 'zbf-matrix-ann';
					if (colColor) block.style.borderLeftColor = colColor;
					const page = ann.pageLabel ? `[p.${ann.pageLabel}] ` : '';
					const snippet = ann.comment && ann.text
						? `${page}${ann.text}（评注：${ann.comment}）`
						: `${page}${ann.comment || ann.text}`;
					renderHighlightedSnippet(doc, block, snippet, terms);
					block.title = '点击复制此条标注内容';
					block.addEventListener('click', () => {
						statusEl.textContent = writeMatrixClipboard(snippet, options.clipboard) ? '✓ 已复制单条标注内容' : '✕ 复制失败';
					});
					td.appendChild(block);
				}
				tr.appendChild(td);
			}
			tbody.appendChild(tr);
		}
		table.appendChild(tbody);
		scroll.appendChild(table);
	};

	const scheduleFilterRender = () => {
		clearBtn.style.display = queryInput.value ? 'inline-flex' : 'none';
		if (filterTimer !== null) clearTimeout(filterTimer);
		filterTimer = setTimeout(() => {
			filterTimer = null;
			renderTable();
		}, 80);
	};
	clearBtn.addEventListener('click', () => {
		if (filterTimer !== null) { clearTimeout(filterTimer); filterTimer = null; }
		queryInput.value = '';
		renderTable();
		queryInput.focus?.();
	});
	queryInput.addEventListener('compositionstart', () => { composing = true; });
	queryInput.addEventListener('compositionend', () => { composing = false; scheduleFilterRender(); });
	queryInput.addEventListener('input', () => {
		clearBtn.style.display = queryInput.value ? 'inline-flex' : 'none';
		if (!composing) scheduleFilterRender();
	});
	renderTable();

	const foot = el(doc, 'div');
	foot.className = 'zbf-matrix-foot';
	const actions = mountAnnotationMatrixFooterActions({
		doc, win: options.win, title: options.title, libraryID: items[0]?.libraryID,
		prefs: options.prefs, bus: options.bus, clipboard: options.clipboard, statusEl, selectedIDs,
		getCurrentMatrix: () => currentMatrix,
		flushFilterIfPending: () => { if (filterTimer !== null) renderTable(); },
	});

	foot.append(statusEl, actions);
	dialog.append(head, controls, scroll, foot);
	backdrop.appendChild(dialog);
	closeByDocument.set(doc, close);
	doc.addEventListener?.('keydown', onKey, true);
	closeBtn.addEventListener('click', close);
	backdrop.addEventListener('click', (e: MouseEvent) => { if (e.target === backdrop) close(); });
	(options.mountRoot || doc.body || doc.documentElement)?.appendChild(backdrop);
	queryInput.focus?.();
}
