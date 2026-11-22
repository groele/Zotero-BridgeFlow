import type { SpotlightItemResult } from '../../kernel/types.ts';
import type { SpotlightEngine } from './spotlight-engine.ts';

export class SpotlightPanelController {
	private panel: any = null;
	private input: HTMLInputElement | null = null;
	private resultsEl: HTMLElement | null = null;
	private entries: SpotlightItemResult[] = [];
	private activeIndex = 0;
	private readonly win: Window;
	private readonly doc: Document;
	private readonly engine: SpotlightEngine;

	constructor(win: Window, doc: Document, engine: SpotlightEngine) {
		this.win = win;
		this.doc = doc;
		this.engine = engine;
	}

	open(anchor?: Element): void {
		this.ensureMounted();
		if (!this.panel || !this.input) return;
		this.input.value = '';
		this.activeIndex = 0;
		this.renderResults();
		try {
			if (anchor && typeof this.panel.openPopup === 'function') {
				this.panel.openPopup(anchor, 'bottomleft topleft', 0, 4, false, false);
			} else if (typeof this.panel.openPopupAtScreen === 'function') {
				const x = Math.round((this.win.screenX || 0) + (this.win.outerWidth || 1000) / 2 - 240);
				const y = Math.round((this.win.screenY || 0) + 120);
				this.panel.openPopupAtScreen(x, y, false);
			}
		} catch { /* ignore in headless env */ }
	}

	close(): void {
		try { this.panel?.hidePopup?.(); } catch { /* ignore */ }
	}

	toggle(anchor?: Element): void {
		if (this.panel?.state === 'open') this.close();
		else this.open(anchor);
	}

	dispose(): void {
		this.close();
		this.panel?.remove?.();
		this.panel = null;
		this.input = null;
		this.resultsEl = null;
	}

	private ensureMounted(): void {
		if (this.panel) return;
		const popupset = this.doc.getElementById('mainPopupSet') || this.doc.querySelector('popupset');
		if (!popupset) return;
		const xul = (this.doc as any).createXULElement
			? (this.doc as any).createXULElement('panel')
			: this.doc.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', 'panel');
		xul.id = 'zbf-spotlight-panel';
		xul.setAttribute('orient', 'vertical');

		const box = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
		box.className = 'zbf-spot-box';

		const input = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'input') as HTMLInputElement;
		input.type = 'search';
		input.className = 'zbf-spot-input';
		input.placeholder = 'Search tabs, remarks, Word citations, or commands...';

		const results = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
		results.className = 'zbf-spot-results';

		box.append(input, results);
		xul.append(box);
		popupset.append(xul);

		xul.addEventListener('popupshown', () => { input.focus(); input.select(); });
		input.addEventListener('input', () => {
			this.activeIndex = 0;
			this.renderResults();
		});
		box.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.isComposing) return;
			if (e.key === 'Escape') { e.preventDefault(); this.close(); }
			else if (e.key === 'ArrowDown') {
				e.preventDefault();
				this.activeIndex = Math.min(Math.max(0, this.entries.length - 1), this.activeIndex + 1);
				this.highlightActive();
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				this.activeIndex = Math.max(0, this.activeIndex - 1);
				this.highlightActive();
			} else if (e.key === 'Enter') {
				e.preventDefault();
				const item = this.entries[this.activeIndex];
				if (item) {
					void item.action();
					this.close();
				}
			}
		});

		this.panel = xul;
		this.input = input;
		this.resultsEl = results;
	}

	private renderResults(): void {
		if (!this.resultsEl || !this.input) return;
		this.entries = this.engine.query(this.input.value, this.win);
		this.resultsEl.textContent = '';

		if (!this.entries.length) {
			const empty = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
			empty.style.cssText = 'padding:10px;opacity:0.65;text-align:center;';
			empty.textContent = 'No matching tabs or commands';
			this.resultsEl.append(empty);
			return;
		}

		this.entries.forEach((entry, idx) => {
			const row = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
			row.type = 'button';
			row.className = `zbf-spot-row${idx === this.activeIndex ? ' active' : ''}`;
			const title = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'span') as HTMLElement;
			title.textContent = entry.title;
			row.append(title);
			if (entry.badge) {
				const badge = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'span') as HTMLElement;
				badge.className = 'zbf-spot-badge';
				badge.textContent = entry.badge;
				row.append(badge);
			}
			row.addEventListener('click', () => {
				void entry.action();
				this.close();
			});
			this.resultsEl!.append(row);
		});
	}

	private highlightActive(): void {
		if (!this.resultsEl) return;
		Array.from(this.resultsEl.children).forEach((el, idx) => {
			el.classList.toggle('active', idx === this.activeIndex);
		});
	}
}
