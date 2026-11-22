import type { SpotlightItemResult } from '../../kernel/types.ts';
import type { WorkspaceSpotlightEngine } from './spotlight-engine.ts';

export class WorkspaceSpotlightPanel {
	private readonly win: Window;
	private readonly doc: Document;
	private readonly engine: WorkspaceSpotlightEngine;
	private backdrop: HTMLElement | null = null;
	private inputEl: HTMLInputElement | null = null;
	private listEl: HTMLElement | null = null;
	private results: SpotlightItemResult[] = [];
	private activeIndex = 0;

	constructor(win: Window, engine: WorkspaceSpotlightEngine) {
		this.win = win;
		this.doc = win.document;
		this.engine = engine;
	}

	isOpen(): boolean {
		return Boolean(this.backdrop?.isConnected);
	}

	open(initialQuery = ''): void {
		if (this.isOpen()) {
			if (this.inputEl && initialQuery) {
				this.inputEl.value = initialQuery;
				this.renderResults(initialQuery);
			}
			this.inputEl?.focus();
			return;
		}

		const host = this.doc.documentElement || this.doc.body;
		if (!host) return;

		const backdrop = this.doc.createElement('div');
		backdrop.id = 'zbf-spotlight-backdrop';
		backdrop.addEventListener('click', (e) => {
			if (e.target === backdrop) this.close();
		});

		const panel = this.doc.createElement('div');
		panel.id = 'zbf-spotlight-panel';

		const input = this.doc.createElement('input') as HTMLInputElement;
		input.id = 'zbf-spotlight-input';
		input.type = 'text';
		input.placeholder = '搜索已打开文献、分组、备注，或输入 > 执行命令（>tabs 按最近阅读）...';
		input.value = initialQuery;
		input.addEventListener('input', () => this.renderResults(input.value));
		input.addEventListener('keydown', (e) => this.handleKeydown(e as KeyboardEvent));

		const list = this.doc.createElement('div');
		list.id = 'zbf-spotlight-list';

		panel.appendChild(input);
		panel.appendChild(list);
		backdrop.appendChild(panel);
		host.appendChild(backdrop);

		this.backdrop = backdrop;
		this.inputEl = input;
		this.listEl = list;
		this.renderResults(initialQuery);
		this.win.setTimeout(() => input.focus(), 10);
	}

	toggle(): void {
		if (this.isOpen()) this.close();
		else this.open();
	}

	close(): void {
		this.backdrop?.remove();
		this.backdrop = null;
		this.inputEl = null;
		this.listEl = null;
		this.results = [];
	}

	destroy(): void {
		this.close();
	}

	private renderResults(rawQuery: string): void {
		if (!this.listEl) return;
		this.listEl.textContent = '';
		this.results = this.engine.query(rawQuery, this.win);
		this.activeIndex = 0;

		if (!this.results.length) {
			const empty = this.doc.createElement('div');
			empty.className = 'zbf-spotlight-empty';
			empty.textContent = '没有匹配的结果。试试输入 > 查看全部工作区命令，或输入文献标题/备注。';
			this.listEl.appendChild(empty);
			return;
		}

		for (let i = 0; i < this.results.length; i++) {
			const item = this.results[i];
			const row = this.doc.createElement('button');
			row.type = 'button';
			row.className = `zbf-spotlight-item${i === this.activeIndex ? ' active' : ''}`;
			row.addEventListener('mouseenter', () => this.setActive(i));
			row.addEventListener('click', () => {
				this.close();
				void Promise.resolve(item.action());
			});

			const title = this.doc.createElement('div');
			title.className = 'zbf-spotlight-title';
			title.textContent = item.title;
			row.appendChild(title);

			if (item.subtitle) {
				const sub = this.doc.createElement('div');
				sub.className = 'zbf-spotlight-sub';
				sub.textContent = item.subtitle;
				row.appendChild(sub);
			}
			this.listEl.appendChild(row);
		}
	}

	private setActive(idx: number): void {
		if (!this.results.length) return;
		this.activeIndex = (idx + this.results.length) % this.results.length;
		const children = this.listEl?.children;
		if (!children) return;
		for (let i = 0; i < children.length; i++) {
			children[i].classList.toggle('active', i === this.activeIndex);
		}
	}

	private handleKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			this.close();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			this.setActive(this.activeIndex + 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			this.setActive(this.activeIndex - 1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const picked = this.results[this.activeIndex];
			if (picked) {
				this.close();
				void Promise.resolve(picked.action());
			}
		}
	}
}
