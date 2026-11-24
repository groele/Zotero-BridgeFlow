import {
	collectItemAnnotations,
	type CollectedAnnotation,
} from '../../services/annotation-utils.ts';
import {
	buildReadingHeatmapBuckets,
	formatReadingProgress,
	type TabReadingProgress,
} from '../../services/reading-stats.ts';
import {
	VISUAL_COL_POPOVER_ID,
	closeVisualColumnPopover,
	ensureVisualColumnStyles,
	findPeakReadingPage,
	formatSubMinuteDuration,
	isVisualColumnPopoverOpenFor,
	mountAnchoredPopover,
	openItemPdfAtPage,
	vcEl,
} from './column-popover-styles.ts';

export {
	VISUAL_COL_POPOVER_ID,
	closeVisualColumnPopover,
	ensureVisualColumnStyles,
	findPeakReadingPage,
	formatSubMinuteDuration,
	isVisualColumnPopoverOpenFor,
	openItemPdfAtPage,
};

export function openReadingInsightsPopover(options: {
	win: Window;
	anchor: HTMLElement;
	item: any;
	progress: TabReadingProgress;
	zh: boolean;
	heatColor?: string;
	onOpenItem?: (itemID: number) => void;
}): void {
	const { win, anchor, item, progress, zh, heatColor = '#0d9488', onOpenItem } = options;
	const doc = win.document;
	if (!doc) return;
	const key = `read:${Number(item?.id || 0)}`;
	if (isVisualColumnPopoverOpenFor(doc, key)) {
		closeVisualColumnPopover(doc);
		return;
	}
	ensureVisualColumnStyles(doc);
	const pop = vcEl(doc, 'div');
	pop.id = VISUAL_COL_POPOVER_ID;
	pop.className = 'zbf-vc-pop';

	const titleStr = String(item.getField?.('title') || item.title || `#${item.id}`);
	const fmt = formatReadingProgress(progress);
	const durText = formatSubMinuteDuration(progress.readSeconds) || (zh ? '刚翻阅' : 'Started');
	const peak = findPeakReadingPage(progress);
	const pct = fmt.ratio != null ? `${Math.round(fmt.ratio * 100)}%` : '—';
	const stage = progress.readSeconds >= 900
		? (zh ? '深度精读' : 'Deep Read')
		: progress.readSeconds >= 180
			? (zh ? '持续研读' : 'Reading')
			: (zh ? '初步浏览' : 'Skimming');

	const head = vcEl(doc, 'div');
	head.className = 'zbf-vc-head';
	const titleEl = vcEl(doc, 'div');
	titleEl.className = 'zbf-vc-title';
	titleEl.textContent = titleStr;
	const badge = vcEl(doc, 'span');
	badge.className = 'zbf-vc-badge';
	badge.textContent = stage;
	head.append(titleEl, badge);
	pop.appendChild(head);

	const metrics = vcEl(doc, 'div');
	metrics.className = 'zbf-vc-metrics';
	const addMetric = (k: string, v: string) => {
		const box = vcEl(doc, 'div');
		box.className = 'zbf-vc-metric';
		const ke = vcEl(doc, 'div');
		ke.className = 'zbf-vc-metric-k';
		ke.textContent = k;
		const ve = vcEl(doc, 'div');
		ve.className = 'zbf-vc-metric-v';
		ve.textContent = v;
		box.append(ke, ve);
		metrics.appendChild(box);
	};
	addMetric(zh ? '累计时长' : 'Duration', durText);
	addMetric(zh ? '阅读进度' : 'Progress', progress.lastPage ? `p.${progress.lastPage}${progress.totalPages ? `/${progress.totalPages}` : ''} (${pct})` : pct);
	addMetric(zh ? '峰值停留' : 'Peak Page', peak ? `p.${peak.page} · ${formatSubMinuteDuration(peak.seconds)}` : '—');
	pop.appendChild(metrics);

	const totalPages = Math.max(Number(progress.totalPages || 0), peak?.page || 0, Number(progress.lastPage || 0));
	const buckets = buildReadingHeatmapBuckets(progress, totalPages > 0 && totalPages <= 16 ? totalPages : 16);
	let closePop = () => {};
	if (buckets.length) {
		const bars = vcEl(doc, 'div');
		bars.className = 'zbf-vc-heatbars';
		buckets.forEach((ratio, idx) => {
			const pageEst = Math.max(1, Math.round(((idx + 0.5) / buckets.length) * Math.max(1, totalPages)));
			const bar = vcEl(doc, 'button');
			bar.type = 'button';
			bar.className = 'zbf-vc-hbar';
			bar.style.height = `${Math.max(14, Math.round(ratio * 100))}%`;
			bar.style.background = ratio > 0 ? heatColor : 'rgba(148,163,184,0.22)';
			bar.style.opacity = ratio > 0 ? String((0.32 + ratio * 0.68).toFixed(2)) : '0.45';
			bar.title = zh ? `点击跳转至约第 ${pageEst} 页` : `Jump near page ${pageEst}`;
			bar.addEventListener('click', () => {
				closePop();
				openItemPdfAtPage(item, pageEst);
			});
			bars.appendChild(bar);
		});
		const hint = vcEl(doc, 'div');
		hint.className = 'zbf-vc-hint';
		hint.textContent = zh ? '页级停留热力柱（点击任意柱体直跳对应 PDF 页码）' : 'Page dwell heatbar (click any bar to jump to PDF page)';
		pop.append(bars, hint);
	}

	const actions = vcEl(doc, 'div');
	actions.className = 'zbf-vc-actions';
	const resumeBtn = vcEl(doc, 'button');
	resumeBtn.type = 'button';
	resumeBtn.className = 'zbf-vc-btn zbf-vc-btn-primary';
	resumeBtn.textContent = progress.lastPage
		? (zh ? `继续阅读 p.${progress.lastPage}` : `Resume p.${progress.lastPage}`)
		: (zh ? '打开 PDF 阅读器' : 'Open PDF Reader');
	resumeBtn.addEventListener('click', () => {
		closePop();
		if (progress.lastPage) openItemPdfAtPage(item, progress.lastPage);
		else if (onOpenItem && item.id) onOpenItem(Number(item.id));
		else openItemPdfAtPage(item);
	});
	actions.appendChild(resumeBtn);

	if (peak && peak.page !== progress.lastPage) {
		const peakBtn = vcEl(doc, 'button');
		peakBtn.type = 'button';
		peakBtn.className = 'zbf-vc-btn';
		peakBtn.textContent = zh ? `跳转峰值页 p.${peak.page}` : `Peak p.${peak.page}`;
		peakBtn.addEventListener('click', () => {
			closePop();
			openItemPdfAtPage(item, peak.page);
		});
		actions.appendChild(peakBtn);
	}
	pop.appendChild(actions);
	closePop = mountAnchoredPopover(win, anchor, pop, key);
}

export function openAnnotationBreakdownPopover(options: {
	win: Window;
	anchor: HTMLElement;
	item: any;
	selectedItemIDs: readonly number[];
	semantics: Readonly<Record<string, string>>;
	zh: boolean;
	onOpenMatrix?: (win: Window, title: string, itemIDs: readonly number[]) => void;
	onOpenHub?: (win: Window) => void;
}): void {
	const { win, anchor, item, selectedItemIDs, semantics, zh, onOpenMatrix, onOpenHub } = options;
	const doc = win.document;
	if (!doc) return;
	const key = `ann:${Number(item?.id || 0)}`;
	if (isVisualColumnPopoverOpenFor(doc, key)) {
		closeVisualColumnPopover(doc);
		return;
	}
	ensureVisualColumnStyles(doc);
	const collected = collectItemAnnotations([item], semantics);
	if (!collected.length) return;

	const pop = vcEl(doc, 'div');
	pop.id = VISUAL_COL_POPOVER_ID;
	pop.className = 'zbf-vc-pop';

	const titleStr = String(item.getField?.('title') || item.title || `#${item.id}`);
	const head = vcEl(doc, 'div');
	head.className = 'zbf-vc-head';
	const titleEl = vcEl(doc, 'div');
	titleEl.className = 'zbf-vc-title';
	titleEl.textContent = titleStr;
	const badge = vcEl(doc, 'span');
	badge.className = 'zbf-vc-badge';
	badge.textContent = zh ? `共 ${collected.length} 条标注` : `${collected.length} annotations`;
	head.append(titleEl, badge);
	pop.appendChild(head);

	const byColor = new Map<string, { hex: string; label: string; count: number }>();
	for (const a of collected) {
		const k = `${a.colorLabel}|${a.color || '#64748b'}`;
		const prev = byColor.get(k);
		if (prev) prev.count++;
		else byColor.set(k, { hex: a.color || '#64748b', label: a.colorLabel, count: 1 });
	}
	const dist = [...byColor.values()].sort((a, b) => b.count - a.count);
	const distList = vcEl(doc, 'div');
	distList.className = 'zbf-vc-dist-list';
	for (const d of dist.slice(0, 6)) {
		const row = vcEl(doc, 'div');
		row.className = 'zbf-vc-dist-row';
		const lbl = vcEl(doc, 'span');
		lbl.className = 'zbf-vc-dist-lbl';
		const dot = vcEl(doc, 'span');
		dot.className = 'zbf-ann-dot';
		dot.style.background = d.hex;
		const txt = vcEl(doc, 'span');
		txt.textContent = d.label;
		lbl.append(dot, txt);
		const track = vcEl(doc, 'div');
		track.className = 'zbf-vc-dist-track';
		const fill = vcEl(doc, 'div');
		fill.className = 'zbf-vc-dist-fill';
		fill.style.width = `${Math.max(8, Math.round((d.count / collected.length) * 100))}%`;
		fill.style.background = d.hex;
		track.appendChild(fill);
		const cnt = vcEl(doc, 'span');
		cnt.className = 'zbf-vc-dist-cnt';
		cnt.textContent = String(d.count);
		row.append(lbl, track, cnt);
		distList.appendChild(row);
	}
	pop.appendChild(distList);

	let closePop = () => {};
	const snippets = vcEl(doc, 'div');
	snippets.className = 'zbf-vc-snippets';
	for (const a of collected.slice(0, 4) as CollectedAnnotation[]) {
		const btn = vcEl(doc, 'button');
		btn.type = 'button';
		btn.className = 'zbf-vc-snippet';
		const dot = vcEl(doc, 'span');
		dot.className = 'zbf-ann-dot';
		dot.style.background = a.color || '#64748b';
		dot.style.marginTop = '5px';
		const txt = vcEl(doc, 'span');
		txt.className = 'zbf-vc-snippet-txt';
		txt.textContent = a.comment ? `${a.comment}${a.text ? ` — ${a.text}` : ''}` : a.text;
		const pg = vcEl(doc, 'span');
		pg.className = 'zbf-vc-snippet-pg';
		pg.textContent = a.pageLabel ? `p.${a.pageLabel}` : '';
		btn.append(dot, txt, pg);
		btn.title = zh ? '点击直跳该标注所在 PDF 位置' : 'Jump to annotation in PDF reader';
		btn.addEventListener('click', () => {
			closePop();
			openItemPdfAtPage(item, Number(a.pageLabel) || undefined, a.annotationID);
		});
		snippets.appendChild(btn);
	}
	pop.appendChild(snippets);

	const actions = vcEl(doc, 'div');
	actions.className = 'zbf-vc-actions';
	if (onOpenMatrix) {
		const matrixIDs = selectedItemIDs.length > 1 && selectedItemIDs.includes(Number(item.id))
			? selectedItemIDs
			: [Number(item.id)];
		const mBtn = vcEl(doc, 'button');
		mBtn.type = 'button';
		mBtn.className = 'zbf-vc-btn zbf-vc-btn-primary';
		mBtn.textContent = matrixIDs.length > 1
			? (zh ? `对比矩阵（已选 ${matrixIDs.length} 篇）` : `Matrix (${matrixIDs.length} items)`)
			: (zh ? '打开批注矩阵' : 'Annotation Matrix');
		mBtn.addEventListener('click', () => {
			closePop();
			onOpenMatrix(win, matrixIDs.length > 1 ? (zh ? `已选 ${matrixIDs.length} 篇文献` : `${matrixIDs.length} Selected`) : titleStr, matrixIDs);
		});
		actions.appendChild(mBtn);
	}
	if (onOpenHub) {
		const hBtn = vcEl(doc, 'button');
		hBtn.type = 'button';
		hBtn.className = 'zbf-vc-btn';
		hBtn.textContent = zh ? '笔记与标注中心' : 'Notes Hub';
		hBtn.addEventListener('click', () => {
			closePop();
			onOpenHub(win);
		});
		actions.appendChild(hBtn);
	}
	if (actions.childNodes.length) pop.appendChild(actions);
	closePop = mountAnchoredPopover(win, anchor, pop, key);
}
