import type { CitationBadgeInfo } from '../../kernel/types.ts';
import type { TrackedTab } from './types.ts';

export class HoverCardController {
	private card: HTMLElement | null = null;
	private showTimer: number | null = null;
	private readonly win: Window;
	private readonly doc: Document;

	constructor(win: Window, doc: Document) {
		this.win = win;
		this.doc = doc;
	}

	scheduleShow(anchor: HTMLElement, tab: TrackedTab, groupName: string, badge?: CitationBadgeInfo): void {
		this.hide();
		this.showTimer = this.win.setTimeout?.(() => {
			this.showTimer = null;
			this.show(anchor, tab, groupName, badge);
		}, 380) ?? null;
	}

	hide(): void {
		if (this.showTimer !== null) {
			this.win.clearTimeout?.(this.showTimer);
			this.showTimer = null;
		}
		if (this.card) this.card.hidden = true;
	}

	dispose(): void {
		this.hide();
		this.card?.remove();
		this.card = null;
	}

	private ensureCard(): HTMLElement | null {
		if (this.card?.isConnected) return this.card;
		const root = this.doc?.documentElement;
		if (!root) return null;
		const el = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
		el.id = 'zbf-hover-card';
		el.className = 'zbf-hover-card';
		el.hidden = true;
		root.append(el);
		this.card = el;
		return el;
	}

	private show(anchor: HTMLElement, tab: TrackedTab, groupName: string, badge?: CitationBadgeInfo): void {
		const card = this.ensureCard();
		if (!card) return;
		card.textContent = '';

		const title = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
		title.className = 'zbf-hc-title';
		title.textContent = tab.title;
		card.append(title);

		const lines: string[] = [];
		if (tab.creatorYear) lines.push(tab.creatorYear);
		if (tab.source) lines.push(tab.source);
		if (tab.collection) lines.push(`Collection: ${tab.collection}`);
		if (groupName) lines.push(`Group: ${groupName}`);
		if (tab.remark) lines.push(`Note: ${tab.remark}`);
		if (badge) lines.push(`Word [${badge.ordinal}] · ${badge.documentName}`);
		if (tab.lastViewedAt > 0) {
			lines.push(`Viewed: ${new Date(tab.lastViewedAt).toLocaleString()}`);
		}

		for (const line of lines) {
			const row = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
			row.className = 'zbf-hc-meta';
			row.textContent = line;
			card.append(row);
		}

		const rect = anchor.getBoundingClientRect();
		card.style.left = `${Math.min((this.win.innerWidth || 900) - 300, Math.max(8, rect.right + 8))}px`;
		card.style.top = `${Math.min((this.win.innerHeight || 700) - 180, Math.max(8, rect.top))}px`;
		card.hidden = false;
	}
}
