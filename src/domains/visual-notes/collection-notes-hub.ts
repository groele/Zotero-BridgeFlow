import { openHubPage } from './hub-page.ts';
import type { TypedEventBus } from '../../kernel/event-bus.ts';
import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import type { UnifiedClipboardService } from '../../services/clipboard-service.ts';
import {
	collectHubAnnotations,
	collectHubNotes,
	renderCollectionHubMarkdown,
	resolveHubScopeItems,
	saveCollectionHubAsZoteroNote,
	type HubScopeMode,
} from '../../services/collection-notes.ts';
import { openAnnotationMatrixModal } from './annotation-matrix-modal.ts';
import { ensureMatrixStyles, extractQueryTerms, writeMatrixClipboard } from './annotation-matrix-ui.ts';
import {
	ensureCollectionHubStyles,
	hubEl,
	renderHubAnnotationsList,
	renderHubNotesList,
} from './collection-notes-ui.ts';
import { createGallerySvgIcon } from './gallery-icons.ts';
import { readItemRemarkWithFallback, type VisualNotesDataSource } from './data-source.ts';

interface HubOptions {
	win: Window;
	prefs: UnifiedPrefService;
	bus?: TypedEventBus;
	clipboard?: UnifiedClipboardService;
	dataSource?: VisualNotesDataSource;
	initialTab?: 'annotations' | 'notes';
	initialScope?: HubScopeMode;
	onRemarkMutated?: () => void;
}

export function openCollectionNotesHubModal(options: HubOptions): void {
	const zh = Boolean((globalThis as any).Zotero?.locale?.startsWith?.('zh'));
	openHubPage(options.win, Boolean(options.prefs.get('visualNotes.collectionHub.separateWindow')),
		zh ? '文献笔记与标注中心' : 'Notes & Annotations', (container, close) => renderHub(options, container, close));
}

function renderHub(options: HubOptions, container: HTMLElement, close: () => void): void {
	const doc = container.ownerDocument;
	if (!doc) return;
	ensureMatrixStyles(doc);
	ensureCollectionHubStyles(doc);

	const zh = Boolean((globalThis as any).Zotero?.locale?.startsWith?.('zh'));
	let activeTab: 'annotations' | 'notes' = options.initialTab || 'annotations';
	let activeScope: HubScopeMode = options.initialScope || 'collection';
	let activeColor = '';
	const selection = { itemID: 0 };
	let ignoreFigTable = Boolean(options.prefs.get('visualNotes.collectionHub.ignoreFigureTable'));
	let preferComment = Boolean(options.prefs.get('visualNotes.collectionHub.preferCommentOverQuote'));

	const backdrop = hubEl(doc, 'div');
	backdrop.id = 'zbf-notebook-backdrop';
	backdrop.className = 'zbf-notebook-backdrop';
	const dialog = hubEl(doc, 'div');
	dialog.className = 'zbf-notebook-dialog';

	const topRow = hubEl(doc, 'div');
	topRow.className = 'zbf-notebook-top';
	const titleWrap = hubEl(doc, 'div');
	titleWrap.className = 'zbf-notebook-title-wrap';
	const titleEl = hubEl(doc, 'div');
	titleEl.className = 'zbf-notebook-title';

	const tabSeg = hubEl(doc, 'div');
	tabSeg.className = 'zbf-notebook-seg';
	const btnTabAnn = hubEl(doc, 'button');
	btnTabAnn.type = 'button';
	btnTabAnn.className = 'zbf-notebook-seg-btn';
	const btnTabNotes = hubEl(doc, 'button');
	btnTabNotes.type = 'button';
	btnTabNotes.className = 'zbf-notebook-seg-btn';
	tabSeg.append(btnTabAnn, btnTabNotes);

	const scopeSeg = hubEl(doc, 'div');
	scopeSeg.className = 'zbf-notebook-seg';
	const scopeDefs: Array<[HubScopeMode, string]> = [
		['collection', zh ? '当前分类/视图' : 'Current View'],
		['selected', zh ? '已选文献' : 'Selected'],
		['tabs', zh ? '已开标签' : 'Open Tabs'],
	];
	const scopeBtns = new Map<HubScopeMode, HTMLButtonElement>();
	for (const [mode, label] of scopeDefs) {
		const b = hubEl(doc, 'button');
		b.type = 'button';
		b.className = 'zbf-notebook-seg-btn';
		b.textContent = label;
		b.addEventListener('click', () => { activeScope = mode; activeColor = ''; renderAll(); });
		scopeBtns.set(mode, b);
		scopeSeg.appendChild(b);
	}

	const closeBtn = hubEl(doc, 'button');
	closeBtn.type = 'button';
	closeBtn.className = 'zbf-matrix-close';
	closeBtn.textContent = '✕';
	titleWrap.append(titleEl, tabSeg);
	const rightTop = hubEl(doc, 'div');
	rightTop.className = 'zbf-notebook-title-wrap';
	rightTop.append(scopeSeg, closeBtn);
	topRow.append(titleWrap, rightTop);

	const toolbar = hubEl(doc, 'div');
	toolbar.className = 'zbf-notebook-toolbar';
	const searchWrap = hubEl(doc, 'div');
	searchWrap.className = 'zbf-nb-search-wrap';
	const searchIcon = hubEl(doc, 'span');
	searchIcon.className = 'zbf-nb-search-icon';
	searchIcon.appendChild(createGallerySvgIcon(doc, 'search', 13));
	const searchInput = hubEl(doc, 'input');
	searchInput.type = 'text';
	searchInput.className = 'zbf-notebook-search';
	searchInput.placeholder = zh ? '搜索标题、原文或评注…' : 'Filter (supports A && B || C)...';
	const clearSearchBtn = hubEl(doc, 'button');
	clearSearchBtn.type = 'button';
	clearSearchBtn.className = 'zbf-nb-search-clear';
	clearSearchBtn.textContent = '×';
	clearSearchBtn.title = zh ? '清空搜索' : 'Clear search';
	searchWrap.append(searchIcon, searchInput, clearSearchBtn);

	const togglesWrap = hubEl(doc, 'div');
	togglesWrap.className = 'zbf-notebook-toggles';
	const makeCheck = (label: string, initial: boolean, onChange: (checked: boolean) => void) => {
		const lbl = hubEl(doc, 'label');
		lbl.className = 'zbf-notebook-check';
		const cb = hubEl(doc, 'input');
		cb.type = 'checkbox';
		cb.checked = initial;
		cb.addEventListener('change', () => onChange(cb.checked));
		const txt = hubEl(doc, 'span');
		txt.textContent = label;
		lbl.append(cb, txt);
		return lbl;
	};
	togglesWrap.append(
		makeCheck(zh ? '忽略图/表标注' : 'Ignore Fig/Table', ignoreFigTable, (v) => {
			ignoreFigTable = v; options.prefs.set('visualNotes.collectionHub.ignoreFigureTable', v); renderAll();
		}),
		makeCheck(zh ? '有评注时仅显示评注' : 'Prefer comment', preferComment, (v) => {
			preferComment = v; options.prefs.set('visualNotes.collectionHub.preferCommentOverQuote', v); renderAll();
		}),
	);


	const chipsBar = hubEl(doc, 'div');
	chipsBar.className = 'zbf-notebook-chips';
	toolbar.append(searchWrap, chipsBar, togglesWrap);
	const scroll = hubEl(doc, 'div');
	scroll.className = 'zbf-notebook-scroll';
	const statusEl = hubEl(doc, 'span');
	statusEl.className = 'zbf-matrix-status';

	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	let composing = false;
	const safeClose = () => {
		if (searchTimer !== null) { clearTimeout(searchTimer); searchTimer = null; }
		close();
	};
	const scheduleRender = () => {
		if (searchTimer !== null) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => { searchTimer = null; renderAll(); }, 100);
	};

	closeBtn.addEventListener('click', safeClose);
	backdrop.addEventListener('keydown', (ev) => {
		if (ev.key === 'Escape') { ev.preventDefault(); safeClose(); }
	});

	btnTabAnn.addEventListener('click', () => { activeTab = 'annotations'; renderAll(); });
	btnTabNotes.addEventListener('click', () => { activeTab = 'notes'; renderAll(); });
	const syncClearBtn = () => {
		clearSearchBtn.style.display = searchInput.value ? 'inline-flex' : 'none';
	};
	clearSearchBtn.addEventListener('click', () => {
		searchInput.value = '';
		syncClearBtn();
		if (searchTimer !== null) { clearTimeout(searchTimer); searchTimer = null; }
		renderAll();
		searchInput.focus?.();
	});
	searchInput.addEventListener('compositionstart', () => { composing = true; });
	searchInput.addEventListener('compositionend', () => { composing = false; syncClearBtn(); scheduleRender(); });
	searchInput.addEventListener('input', () => { syncClearBtn(); if (!composing) scheduleRender(); });
	syncClearBtn();

	let latestScope = resolveHubScopeItems(options.win, activeScope, zh);
	const computeCurrent = () => {
		latestScope = resolveHubScopeItems(options.win, activeScope, zh);
		const colorJson = options.prefs.get('inspector.annotations.colorLabels');
		const annData = collectHubAnnotations(latestScope.items, colorJson, {
			query: searchInput.value,
			colorLabel: activeColor,
			ignoreFigureTable: ignoreFigTable,
		});
		const notesData = collectHubNotes(
			latestScope.items,
			(it) => readItemRemarkWithFallback(it, options.dataSource),
			searchInput.value,
		);
		return { annData, notesData };
	};

	const renderAll = () => {
		const { annData, notesData } = computeCurrent();
		btnTabAnn.setAttribute('data-active', String(activeTab === 'annotations'));
		btnTabNotes.setAttribute('data-active', String(activeTab === 'notes'));
		btnTabAnn.textContent = zh ? `标注汇总 (${annData.annotations.length})` : `Annotations (${annData.annotations.length})`;
		btnTabNotes.textContent = zh
			? `笔记与简记 (${notesData.totalChildNotes + notesData.totalBriefNotes})`
			: `Notes & Briefs (${notesData.totalChildNotes + notesData.totalBriefNotes})`;
		for (const [m, b] of scopeBtns) b.setAttribute('data-active', String(m === activeScope));

		titleEl.textContent = zh
			? `文献笔记与标注中心 · ${latestScope.scopeTitle} (${latestScope.items.length} 篇)`
			: `Notes & Annotations Hub · ${latestScope.scopeTitle} (${latestScope.items.length})`;
		togglesWrap.style.display = activeTab === 'annotations' ? 'inline-flex' : 'none';
		chipsBar.style.display = activeTab === 'annotations' ? 'flex' : 'none';

		chipsBar.textContent = '';
		if (activeTab === 'annotations') {
			const makeChip = (lbl: string, val: string, count: number, hex?: string) => {
				const c = hubEl(doc, 'button');
				c.type = 'button';
				c.className = 'zbf-matrix-chip';
				if (activeColor === val) c.setAttribute('data-active', 'true');
				if (hex) {
					const dot = hubEl(doc, 'span');
					dot.className = 'zbf-matrix-dot';
					dot.style.background = hex;
					c.appendChild(dot);
				}
				const s = hubEl(doc, 'span');
				s.textContent = `${lbl} (${count})`;
				c.appendChild(s);
				c.addEventListener('click', () => { activeColor = val; renderAll(); });
				chipsBar.appendChild(c);
			};
			makeChip(zh ? '全部维度' : 'All', '', annData.totalBeforeFilter);
			for (const [colLbl, cnt] of annData.colorCounts) {
				makeChip(colLbl, colLbl, cnt, annData.colorHexByLabel.get(colLbl));
			}
		}

		scroll.textContent = '';
		const terms = extractQueryTerms(searchInput.value);
		const onStatus = (msg: string) => { statusEl.textContent = msg; };
		const onOpenItem = (itemID: number) => {
			options.win.focus?.();
			options.bus?.emit('workspace:open-item-request', { itemID, preferExistingTab: true });
		};
		if (activeTab === 'annotations') {
			const matchedCount = new Set(annData.annotations.map((ann) => ann.itemID)).size;
			statusEl.textContent = zh
				? `共匹配 ${annData.annotations.length} 条标注（来自 ${matchedCount} 篇文献）`
				: `${annData.annotations.length} annotations across ${matchedCount} items`;
			renderHubAnnotationsList({
				doc, scroll, selection, annotations: annData.annotations, colorHexByLabel: annData.colorHexByLabel,
				preferComment, terms, zh, clipboard: options.clipboard, onStatus, onOpenItem,
			});
		} else {
			statusEl.textContent = zh
				? `共 ${notesData.entries.length} 篇文献 · ${notesData.totalBriefNotes} 条简记 · ${notesData.totalChildNotes} 篇独立子笔记`
				: `${notesData.entries.length} items · ${notesData.totalBriefNotes} brief notes · ${notesData.totalChildNotes} child notes`;
			renderHubNotesList({
				doc, win: options.win, scroll, selection, entries: notesData.entries,
				syncExtra: Boolean(options.prefs.get('workspace.syncRemarkToExtra')),
				dataSource: options.dataSource, terms, zh, onRemarkMutated: options.onRemarkMutated, onStatus, onOpenItem,
			});
		}
	};

	const foot = hubEl(doc, 'div');
	foot.className = 'zbf-notebook-foot';
	const actions = hubEl(doc, 'div');
	actions.className = 'zbf-matrix-actions';
	const flashBtn = (btn: HTMLButtonElement, tempText: string) => {
		const orig = btn.dataset.origLabel || btn.textContent || '';
		btn.dataset.origLabel = orig;
		btn.textContent = tempText;
		doc.defaultView?.setTimeout?.(() => {
			if (btn.isConnected) btn.textContent = orig;
		}, 1800);
	};
	const addBtn = (lbl: string, primary: boolean, fn: (btn: HTMLButtonElement) => void) => {
		const b = hubEl(doc, 'button');
		b.type = 'button';
		b.className = primary ? 'zbf-matrix-btn primary' : 'zbf-matrix-btn';
		b.textContent = lbl;
		b.addEventListener('click', () => fn(b));
		actions.appendChild(b);
	};

	addBtn(zh ? '打开文献对比矩阵' : 'Open Matrix View', false, () => {
		computeCurrent();
		const ids = latestScope.items.map((it) => Number(it.id)).filter((id) => id > 0);
		openAnnotationMatrixModal({
			win: options.win, title: latestScope.scopeTitle, itemIDs: ids,
			prefs: options.prefs, bus: options.bus, clipboard: options.clipboard,
		});
	});

	addBtn(zh ? '复制 Markdown 综述汇总' : 'Copy Markdown Synthesis', false, (btn) => {
		const { annData, notesData } = computeCurrent();
		if (!annData.annotations.length && !notesData.totalBriefNotes && !notesData.totalChildNotes) {
			statusEl.textContent = zh ? '当前范围暂无可复制的笔记或标注' : 'Nothing to copy in current scope';
			flashBtn(btn, zh ? '暂无内容' : 'Empty');
			return;
		}
		const md = renderCollectionHubMarkdown(`${latestScope.scopeTitle} · 笔记与标注汇总`, notesData.entries, annData.annotations, preferComment);
		const ok = writeMatrixClipboard(md, options.clipboard);
		statusEl.textContent = ok ? (zh ? `✓ 已复制 Markdown 综述（${md.length} 字）` : `✓ Copied Markdown (${md.length} chars)`) : '✕ Copy failed';
		flashBtn(btn, ok ? (zh ? '✓ 已复制到剪贴板' : '✓ Copied!') : '✕ 失败');
	});

	let savingNote = false;
	addBtn(zh ? '保存为当前分类 Zotero 笔记' : 'Save as Zotero Note', true, (btn) => {
		if (savingNote) return;
		const { annData, notesData } = computeCurrent();
		if (!annData.annotations.length && !notesData.totalBriefNotes && !notesData.totalChildNotes) {
			statusEl.textContent = zh ? '当前范围暂无可汇总的笔记或标注' : 'No notes or annotations to save';
			flashBtn(btn, zh ? '暂无可保存内容' : 'Nothing to save');
			return;
		}
		savingNote = true;
		statusEl.textContent = zh ? '正在生成 Zotero 汇总笔记…' : 'Saving Zotero note…';
		void saveCollectionHubAsZoteroNote({
			heading: `${latestScope.scopeTitle} · 笔记与标注汇总`, notes: notesData.entries, annotations: annData.annotations,
			preferCommentOverQuote: preferComment, libraryID: latestScope.libraryID, collectionID: latestScope.collectionID,
		}).then(async (nid) => {
			if (!nid) { statusEl.textContent = '✕ Failed to save note'; return; }
			statusEl.textContent = zh ? `✓ 已生成并打开汇总笔记 (#${nid})` : `✓ Saved & opened Note (#${nid})`;
			flashBtn(btn, zh ? `✓ 已打开笔记 #${nid}` : `✓ Opened #${nid}`);
			const zNotes = (globalThis as any).Zotero?.Notes;
			if (typeof zNotes?.open === 'function') {
				try { await zNotes.open(nid, undefined, { openInWindow: false }); return; } catch { /* fallback below */ }
			}
			(options.win as any).Zotero_Tabs?.select?.('zotero-pane');
			await (options.win as any).ZoteroPane?.selectItem?.(nid);
		}).catch(() => {
			statusEl.textContent = zh ? '✕ 保存汇总笔记失败' : '✕ Failed to save note';
		}).finally(() => { savingNote = false; });
	});

	foot.append(statusEl, actions);
	dialog.append(topRow, toolbar, scroll, foot);
	backdrop.appendChild(dialog);
	container.appendChild(backdrop);
	renderAll();
	searchInput.focus?.();
}
