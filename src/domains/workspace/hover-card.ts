import { createWorkspaceElement } from './workspace-elements.ts';
import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import type { CitationBadgeInfo } from '../../kernel/types.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import { buildReadingHeatmapBuckets, formatReadingProgress } from '../../services/reading-stats.ts';
import type { TrackedTab } from './types.ts';

export function formatRelativeTimeZh(ts: number): string {
	if (!ts) return '';
	const diffMin = Math.max(0, Math.floor((Date.now() - ts) / 60_000));
	if (diffMin < 1) return '刚刚';
	if (diffMin < 60) return `${diffMin} 分钟前`;
	const diffHours = Math.floor(diffMin / 60);
	if (diffHours < 24) return `${diffHours} 小时前`;
	const diffDays = Math.floor(diffHours / 24);
	return `${diffDays} 天前`;
}

export class WorkspaceHoverCard {
	private readonly doc: Document;
	private readonly prefs: UnifiedPrefService;
	private readonly store: WorkspaceStateStore;
	private cardEl: HTMLElement | null = null;
	private showTimer = 0;
	private hideTimer = 0;
	private wordCiteMap = new Map<number, CitationBadgeInfo>();

	constructor(doc: Document, prefs: UnifiedPrefService, store: WorkspaceStateStore) {
		this.doc = doc;
		this.prefs = prefs;
		this.store = store;
	}

	setWordCitationBadges(badges: ReadonlyMap<number, CitationBadgeInfo>): void {
		this.wordCiteMap = new Map(badges);
	}

	attach(target: HTMLElement, tab: TrackedTab): void {
		target.addEventListener('mouseenter', () => {
			if (!this.prefs.get('workspace.enableHoverPreview')) return;
			this.clearTimers();
			const win = this.doc.defaultView || (globalThis as any);
			this.showTimer = win.setTimeout(() => this.show(target, tab), 260);
		});
		target.addEventListener('mouseleave', () => {
			this.clearTimers();
			const win = this.doc.defaultView || (globalThis as any);
			this.hideTimer = win.setTimeout(() => this.hide(), 90);
		});
		target.addEventListener('mousedown', () => this.hide());
	}

	show(anchor: HTMLElement, tab: TrackedTab): void {
		this.hide();
		const host = this.doc.documentElement || this.doc.body;
		if (!host) return;

		const card = createWorkspaceElement(this.doc, 'div');
		card.className = 'zbf-hover-card';
		card.setAttribute('data-zbf-hover-card', '1');

		const titleEl = createWorkspaceElement(this.doc, 'div');
		titleEl.className = 'zbf-hc-title';
		titleEl.textContent = tab.title;
		card.appendChild(titleEl);

		const subParts = [tab.creatorYear, tab.source].filter(Boolean);
		if (subParts.length) {
			const subEl = createWorkspaceElement(this.doc, 'div');
			subEl.className = 'zbf-hc-meta';
			subEl.textContent = subParts.join(' · ');
			card.appendChild(subEl);
		}

		if (tab.remark) {
			const remarkEl = createWorkspaceElement(this.doc, 'div');
			remarkEl.className = 'zbf-hc-note';
			remarkEl.textContent = `备注：${tab.remark}`;
			card.appendChild(remarkEl);
		}

		const group = tab.groupId ? this.store.state.groups.find((g) => g.id === tab.groupId) : null;
		const statusParts: string[] = [];
		if (group) statusParts.push(`分组：${group.name}`);
		if (tab.collection) statusParts.push(`集合：${tab.collection}`);
		const citeInfo = this.wordCiteMap.get(tab.parentItemID) || this.wordCiteMap.get(tab.itemID);
		if (citeInfo) statusParts.push(`Word [${citeInfo.ordinal}] (${citeInfo.documentName})`);
		if (tab.pinned) statusParts.push('已固定');
		if (tab.sleeping) statusParts.push('已休眠');
		if (tab.virtual) statusParts.push('虚拟成员');
		const rel = formatRelativeTimeZh(tab.lastViewedAt);
		if (rel) statusParts.push(`上次阅读：${rel}`);

		const reader = !tab.virtual && tab.tabID ? (globalThis as any).Zotero?.Reader?.getByTabID?.(tab.tabID) : null;
		const ir = reader?._internalReader;
		const app = ir?._primaryView?._iframeWindow?.PDFViewerApplication;
		const pageIdx = typeof app?.page === 'number' && app.page > 0
			? app.page - 1
			: (ir?._state?.primaryViewStats?.pageIndex ?? ir?._state?.primaryViewState?.pageIndex ?? reader?.state?.pageIndex);
		const numPages = app?.pagesCount || ir?._state?.primaryViewStats?.pagesCount || reader?._internalReader?._pdfDocument?.numPages || reader?.pagesCount;
		const storedProg = this.store.state.readingProgress[tab.key];
		const prog = formatReadingProgress(storedProg);
		if (typeof pageIdx === 'number' && pageIdx >= 0) {
			const total = typeof numPages === 'number' && numPages > 0 ? numPages : (storedProg?.totalPages || 0);
			const dur = storedProg?.readSeconds && storedProg.readSeconds > 0 ? ` · ${prog.text.split(' · ')[0]}` : '';
			statusParts.push((total > 0 ? `第 ${pageIdx + 1} / ${total} 页` : `第 ${pageIdx + 1} 页`) + dur);
		} else if (prog.text) {
			statusParts.push(prog.text);
		}
		let peakNote = '';
		if (storedProg?.pageSeconds) {
			let peakPage = '';
			let peakSec = 0;
			for (const [p, sec] of Object.entries(storedProg.pageSeconds)) {
				if (sec > peakSec) { peakSec = sec; peakPage = p; }
			}
			if (peakPage && peakSec > 0) {
				peakNote = `最常停留 P${peakPage} (${Math.round(peakSec)}s)`;
				statusParts.push(peakNote);
			}
		}
		const itemObj = tab.itemID > 0 ? (globalThis as any).Zotero?.Items?.get?.(tab.itemID) : null;
		let annots: number | undefined;
		try {
			const isFile = itemObj?.isFileAttachment ? itemObj.isFileAttachment() : itemObj?.isAttachment?.();
			if (isFile && typeof itemObj?.getAnnotations === 'function') {
				annots = itemObj.getAnnotations()?.length;
			}
		} catch { /* ignore linked URL attachments */ }
		if (typeof annots === 'number' && annots > 0) {
			statusParts.push(`批注 ${annots} 条`);
		}

		if (statusParts.length) {
			const footEl = createWorkspaceElement(this.doc, 'div');
			footEl.className = 'zbf-hc-meta';
			footEl.textContent = statusParts.join(' · ');
			card.appendChild(footEl);
		}
		const bucketCount = storedProg?.totalPages && storedProg.totalPages < 16 ? storedProg.totalPages : 16;
		const heat = buildReadingHeatmapBuckets(storedProg, bucketCount);
		if (heat.length) {
			const bar = createWorkspaceElement(this.doc, 'div');
			bar.className = 'zbf-hc-heatbar';
			bar.style.gridTemplateColumns = `repeat(${heat.length}, 1fr)`;
			const heatColor = String(this.prefs.get('workspace.readingHeatmap.color') || '').trim();
			const heatOpacity = Math.max(20, Math.min(95, Number(this.prefs.get('workspace.readingHeatmap.opacity') || 42))) / 100;
			if (heatColor) bar.style.setProperty('--zbf-heat-accent', heatColor);
			bar.title = peakNote ? `按页阅读热力分布 · ${peakNote}` : '按页阅读时长热力分布';
			for (const ratio of heat) {
				const cell = createWorkspaceElement(this.doc, 'span');
				cell.className = 'zbf-hc-heatcell';
				cell.style.opacity = String(ratio > 0 ? Math.max(0.24, Math.min(1, ratio * (0.45 + heatOpacity * 0.85))) : 0.12);
				if (ratio > 0) cell.setAttribute('data-active', 'true');
				bar.appendChild(cell);
			}
			card.appendChild(bar);
		}

		host.appendChild(card);
		const rect = anchor.getBoundingClientRect();
		const winW = this.doc.defaultView?.innerWidth || 1200;
		const winH = this.doc.defaultView?.innerHeight || 800;
		const cardW = card.offsetWidth || 320;
		const cardH = card.offsetHeight || 110;
		const left = Math.max(12, Math.min(rect.left, winW - cardW - 14));
		const top = rect.bottom + 8 + cardH <= winH
			? rect.bottom + 8
			: Math.max(12, rect.top - cardH - 8);
		card.style.left = `${left}px`;
		card.style.top = `${top}px`;
		this.cardEl = card;
	}

	hide(): void {
		this.clearTimers();
		this.cardEl?.remove();
		this.cardEl = null;
	}

	destroy(): void {
		this.hide();
	}

	private clearTimers(): void {
		const win = this.doc.defaultView || (globalThis as any);
		if (this.showTimer) win.clearTimeout(this.showTimer);
		if (this.hideTimer) win.clearTimeout(this.hideTimer);
		this.showTimer = 0;
		this.hideTimer = 0;
	}
}
