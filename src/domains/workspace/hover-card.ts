import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import type { CitationBadgeInfo } from '../../kernel/types.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import { formatReadingProgress } from './tab-actions-helpers.ts';
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

		const card = this.doc.createElement('div');
		card.className = 'zbf-hover-card';
		card.setAttribute('data-zbf-hover-card', '1');

		const titleEl = this.doc.createElement('div');
		titleEl.className = 'zbf-hc-title';
		titleEl.textContent = tab.title;
		card.appendChild(titleEl);

		const subParts = [tab.creatorYear, tab.source].filter(Boolean);
		if (subParts.length) {
			const subEl = this.doc.createElement('div');
			subEl.className = 'zbf-hc-meta';
			subEl.textContent = subParts.join(' · ');
			card.appendChild(subEl);
		}

		if (tab.remark) {
			const remarkEl = this.doc.createElement('div');
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
		const pageIdx = reader?.state?.pageIndex;
		const numPages = reader?._internalReader?._pdfDocument?.numPages || reader?.pagesCount;
		const prog = formatReadingProgress(this.store.state.readingProgress[tab.key]);
		if (typeof pageIdx === 'number' && pageIdx >= 0) {
			statusParts.push(typeof numPages === 'number' && numPages > 0 ? `第 ${pageIdx + 1} / ${numPages} 页` : `第 ${pageIdx + 1} 页`);
		} else if (prog.text) {
			statusParts.push(prog.text);
		}
		const itemObj = tab.itemID > 0 ? (globalThis as any).Zotero?.Items?.get?.(tab.itemID) : null;
		const annots = itemObj?.isAttachment?.() && typeof itemObj?.getAnnotations === 'function' ? itemObj.getAnnotations()?.length : undefined;
		if (typeof annots === 'number' && annots > 0) {
			statusParts.push(`批注 ${annots} 条`);
		}

		if (statusParts.length) {
			const footEl = this.doc.createElement('div');
			footEl.className = 'zbf-hc-meta';
			footEl.textContent = statusParts.join(' · ');
			card.appendChild(footEl);
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
