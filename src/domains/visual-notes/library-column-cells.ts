import { formatReadingProgress, type TabReadingProgress } from '../../services/reading-stats.ts';
import {
	ensureVisualColumnStyles,
	findPeakReadingPage,
	formatSubMinuteDuration,
	vcEl,
} from './column-popover-styles.ts';
import {
	openAnnotationBreakdownPopover,
	openReadingInsightsPopover,
} from './column-popovers.ts';
import { closeStatusPickerPopover } from './status-rating-popover.ts';

export interface AnnotationSummaryRecord {
	readonly total: number;
	readonly formatted: string;
	readonly buckets: readonly { hex: string; label: string; count: number }[];
}

export interface ReadingColumnCallbacks {
	onOpenItem?: (itemID: number) => void;
	onOpenMatrix?: (win: Window, title: string, itemIDs: readonly number[]) => void;
	onOpenHub?: (win: Window) => void;
}

function stopTreePointer(el: HTMLElement): void {
	el.addEventListener('mousedown', (ev) => {
		if (ev.button !== 0) return;
		ev.stopPropagation();
		ev.preventDefault();
	});
	el.addEventListener('dblclick', (ev) => {
		ev.stopPropagation();
		ev.preventDefault();
	});
}

export function buildReadTimeCell(opts: {
	win: Window | null;
	doc: Document;
	item: any;
	prog?: TabReadingProgress;
	className?: string;
	zh: boolean;
	heatColor: string;
	callbacks?: ReadingColumnCallbacks;
}): HTMLElement {
	const { win, doc, item, prog, className, zh, heatColor, callbacks } = opts;
	ensureVisualColumnStyles(doc);
	const cell = vcEl(doc, 'span');
	cell.className = `cell ${className || ''} zbf-read-cell`.trim();
	if (!item || !prog || (!prog.readSeconds && !prog.lastPage)) return cell;

	const fmt = formatReadingProgress(prog);
	const durText = formatSubMinuteDuration(prog.readSeconds);
	const pageText = prog.lastPage ? (prog.totalPages ? `p.${prog.lastPage}/${prog.totalPages}` : `p.${prog.lastPage}`) : '';
	if (!durText && !pageText) return cell;

	const chip = vcEl(doc, 'span');
	chip.className = 'zbf-read-chip';
	const row = vcEl(doc, 'span');
	row.className = 'zbf-read-row';
	if (durText) {
		const dur = vcEl(doc, 'span');
		dur.className = 'zbf-read-dur';
		dur.textContent = durText;
		row.appendChild(dur);
	}
	if (pageText) {
		const pg = vcEl(doc, 'span');
		pg.className = 'zbf-read-page';
		pg.textContent = pageText;
		row.appendChild(pg);
	}
	chip.appendChild(row);

	const ratio = fmt.ratio ?? Math.min(1, Math.max(0.08, prog.readSeconds / 1200));
	const bar = vcEl(doc, 'span');
	bar.className = 'zbf-read-bar';
	const fill = vcEl(doc, 'span');
	fill.className = 'zbf-read-bar-fill';
	fill.style.width = `${Math.max(8, Math.round(ratio * 100))}%`;
	fill.style.background = prog.readSeconds >= 900 ? '#d97706' : prog.readSeconds >= 180 ? '#2563eb' : '#0d9488';
	bar.appendChild(fill);
	chip.appendChild(bar);

	const peak = findPeakReadingPage(prog);
	const tipParts = [durText || (zh ? '已翻阅' : 'Opened')];
	if (pageText) tipParts.push(fmt.ratio != null ? `${pageText} (${Math.round(fmt.ratio * 100)}%)` : pageText);
	if (peak) tipParts.push(zh ? `最常停留 p.${peak.page} (${formatSubMinuteDuration(peak.seconds)})` : `Peak p.${peak.page} (${formatSubMinuteDuration(peak.seconds)})`);
	chip.title = `${tipParts.join(' · ')}\n${zh ? '点击查看页级停留热力柱并直跳 PDF 页码' : 'Click for page heatbar & quick PDF jump'}`;
	stopTreePointer(chip);
	chip.addEventListener('click', (ev) => {
		ev.stopPropagation();
		if (!win) return;
		closeStatusPickerPopover(win.document);
		openReadingInsightsPopover({
			win,
			anchor: chip,
			item,
			progress: prog,
			zh,
			heatColor,
			onOpenItem: callbacks?.onOpenItem,
		});
	});
	cell.appendChild(chip);
	return cell;
}

export function buildAnnotationCell(opts: {
	win: Window | null;
	doc: Document;
	item: any;
	summary: AnnotationSummaryRecord | null;
	className?: string;
	zh: boolean;
	semantics: Readonly<Record<string, string>>;
	callbacks?: ReadingColumnCallbacks;
}): HTMLElement {
	const { win, doc, item, summary, className, zh, semantics, callbacks } = opts;
	ensureVisualColumnStyles(doc);
	const cell = vcEl(doc, 'span');
	cell.className = `cell ${className || ''} zbf-ann-cell`.trim();
	if (!item || !summary || !summary.total) return cell;

	const chip = vcEl(doc, 'span');
	chip.className = 'zbf-ann-chip';
	const totalEl = vcEl(doc, 'span');
	totalEl.className = 'zbf-ann-total';
	totalEl.textContent = String(summary.total);
	const stack = vcEl(doc, 'span');
	stack.className = 'zbf-ann-stack';
	for (const b of summary.buckets.slice(0, 5)) {
		const seg = vcEl(doc, 'span');
		seg.className = 'zbf-ann-seg';
		seg.style.flexGrow = String(b.count);
		seg.style.background = b.hex;
		stack.appendChild(seg);
	}
	const dots = vcEl(doc, 'span');
	dots.className = 'zbf-ann-dots';
	for (const b of summary.buckets.slice(0, 2)) {
		const dItem = vcEl(doc, 'span');
		dItem.className = 'zbf-ann-dot-item';
		const dot = vcEl(doc, 'span');
		dot.className = 'zbf-ann-dot';
		dot.style.background = b.hex;
		const cnt = vcEl(doc, 'span');
		cnt.textContent = String(b.count);
		dItem.append(dot, cnt);
		dots.appendChild(dItem);
	}
	chip.append(totalEl, stack, dots);
	const detail = summary.buckets.map((b) => `${b.label} ${b.count}`).join(' · ');
	chip.title = `${zh ? `共 ${summary.total} 条标注：` : `${summary.total} annotations: `}${detail}\n${zh ? '点击展开色彩分布、预览并跳转 PDF / 对比矩阵' : 'Click for breakdown, PDF jump & matrix'}`;
	stopTreePointer(chip);
	chip.addEventListener('click', (ev) => {
		ev.stopPropagation();
		if (!win) return;
		closeStatusPickerPopover(win.document);
		const selected = ((win as any).ZoteroPane?.getSelectedItems?.() || [])
			.map((it: any) => Number(it?.parentItemID || it?.id || 0))
			.filter((n: number) => n > 0);
		openAnnotationBreakdownPopover({
			win,
			anchor: chip,
			item,
			selectedItemIDs: [...new Set<number>(selected)],
			semantics,
			zh,
			onOpenMatrix: callbacks?.onOpenMatrix,
			onOpenHub: callbacks?.onOpenHub,
		});
	});
	cell.appendChild(chip);
	return cell;
}
