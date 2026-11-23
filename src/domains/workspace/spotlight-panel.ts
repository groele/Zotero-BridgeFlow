import { createWorkspaceElement } from './workspace-elements.ts';
import type { SpotlightItemResult } from '../../kernel/types.ts';
import type { WorkspaceSpotlightEngine } from './spotlight-engine.ts';
import { createWorkspaceIcon, type WorkspaceIconName } from './workspace-icons.ts';

interface SectionGroup {
	key: string;
	title: string;
	items: SpotlightItemResult[];
}

export class WorkspaceSpotlightPanel {
	private readonly win: Window;
	private readonly doc: Document;
	private readonly engine: WorkspaceSpotlightEngine;
	private backdrop: HTMLElement | null = null;
	private panelEl: HTMLElement | null = null;
	private inputEl: HTMLInputElement | null = null;
	private listEl: HTMLElement | null = null;
	private results: SpotlightItemResult[] = [];
	private activeIndex = 0;
	private readonly collapsedSections = new Set<string>(['groups']);

	constructor(win: Window, engine: WorkspaceSpotlightEngine) {
		this.win = win;
		this.doc = win.document;
		this.engine = engine;
	}

	isOpen(): boolean {
		return Boolean(this.backdrop?.isConnected);
	}

	open(initialQuery = '', anchor?: HTMLElement | null): void {
		if (this.isOpen()) {
			if (this.inputEl && initialQuery) {
				this.inputEl.value = initialQuery;
				this.renderResults(initialQuery);
			}
			this.positionNearAnchor(anchor);
			this.inputEl?.focus();
			return;
		}

		const host = this.doc.documentElement || this.doc.body;
		if (!host) return;

		const backdrop = createWorkspaceElement(this.doc, 'div');
		backdrop.id = 'zbf-spotlight-backdrop';
		backdrop.addEventListener('mousedown', (e) => {
			if (e.target === backdrop) this.close();
		});

		const panel = createWorkspaceElement(this.doc, 'div');
		panel.id = 'zbf-spotlight-panel';

		const inputWrap = createWorkspaceElement(this.doc, 'div');
		inputWrap.className = 'zbf-spot-input-wrap';
		inputWrap.appendChild(createWorkspaceIcon(this.doc, 'search', 14));

		const input = createWorkspaceElement(this.doc, 'input') as HTMLInputElement;
		input.id = 'zbf-spotlight-input';
		input.type = 'search';
		input.placeholder = '查找已打开文献、备注，或输入 @ 搜全库、> 执行操作…';
		input.value = initialQuery;
		input.addEventListener('input', () => {
			this.activeIndex = 0;
			this.renderResults(input.value);
		});
		input.addEventListener('keydown', (e) => this.handleKeydown(e as KeyboardEvent));
		inputWrap.appendChild(input);

		const list = createWorkspaceElement(this.doc, 'div');
		list.id = 'zbf-spotlight-list';

		panel.append(inputWrap, list);
		backdrop.appendChild(panel);
		host.appendChild(backdrop);

		this.backdrop = backdrop;
		this.panelEl = panel;
		this.inputEl = input;
		this.listEl = list;
		this.positionNearAnchor(anchor);
		this.renderResults(initialQuery);
		this.win.setTimeout(() => { input.focus(); input.select(); }, 10);
	}

	toggle(anchor?: HTMLElement | null): void {
		if (this.isOpen()) this.close();
		else this.open('', anchor);
	}

	close(): void {
		this.backdrop?.remove();
		this.backdrop = null;
		this.panelEl = null;
		this.inputEl = null;
		this.listEl = null;
		this.results = [];
	}

	destroy(): void {
		this.close();
	}

	private positionNearAnchor(explicitAnchor?: HTMLElement | null): void {
		if (!this.panelEl) return;
		const anchor = explicitAnchor
			|| (this.doc.querySelector('#zbf-toolbar-actions [data-action="search"]') as HTMLElement | null)
			|| (this.doc.getElementById('zbf-toolbar-actions') as HTMLElement | null);
		const winW = this.win.innerWidth || 1200;
		const winH = this.win.innerHeight || 800;
		const panelW = Math.min(480, winW - 24);
		this.panelEl.style.width = `${panelW}px`;

		if (anchor && typeof anchor.getBoundingClientRect === 'function') {
			const rect = anchor.getBoundingClientRect();
			if (rect.width > 0 || rect.height > 0) {
				const top = Math.max(8, Math.min(Math.round(rect.bottom + 6), winH - 180));
				const left = Math.max(12, Math.min(Math.round(rect.right - panelW), winW - panelW - 12));
				this.panelEl.style.top = `${top}px`;
				this.panelEl.style.left = `${left}px`;
				return;
			}
		}
		this.panelEl.style.top = '44px';
		this.panelEl.style.left = `${Math.max(12, Math.round(winW - panelW - 16))}px`;
	}

	private partitionSections(items: readonly SpotlightItemResult[]): SectionGroup[] {
		const openTabs: SpotlightItemResult[] = [];
		const closedTabs: SpotlightItemResult[] = [];
		const groups: SpotlightItemResult[] = [];
		const sessions: SpotlightItemResult[] = [];
		const wordCites: SpotlightItemResult[] = [];
		const library: SpotlightItemResult[] = [];
		const commands: SpotlightItemResult[] = [];

		for (const it of items) {
			if (it.id.startsWith('closed:')) closedTabs.push(it);
			else if (it.id.startsWith('group:')) groups.push(it);
			else if (it.id.startsWith('session:')) sessions.push(it);
			else if (it.id.startsWith('lib:')) library.push(it);
			else if (it.category === 'citation' || it.id.startsWith('word-cite:')) wordCites.push(it);
			else if (it.category === 'command' || it.id.startsWith('cmd:')) commands.push(it);
			else openTabs.push(it);
		}
		return [
			{ key: 'tabs', title: '打开的标签页', items: openTabs },
			{ key: 'word', title: 'Word 正在引用的文献', items: wordCites },
			{ key: 'closed', title: '最近关闭的标签页', items: closedTabs },
			{ key: 'sessions', title: '会话与快照', items: sessions },
			{ key: 'groups', title: '标签组', items: groups },
			{ key: 'library', title: '文库文献', items: library },
			{ key: 'actions', title: '快捷操作', items: commands },
		].filter((s) => s.items.length > 0);
	}

	private pickIcon(item: SpotlightItemResult): WorkspaceIconName {
		if (item.id.startsWith('session:')) return 'workspace';
		if (item.id.startsWith('group:')) return 'folder';
		if (item.id.startsWith('closed:')) return 'clock';
		if (item.category === 'command' || item.id.startsWith('cmd:')) return 'layers';
		if (item.badge?.includes('虚拟')) return 'virtual';
		return 'pdf';
	}

	private renderResults(rawQuery: string): void {
		if (!this.listEl) return;
		this.listEl.textContent = '';
		const all = this.engine.query(rawQuery, this.win);
		const hasQuery = rawQuery.trim().length > 0;
		const sections = this.partitionSections(all);

		if (!sections.length) {
			this.results = [];
			const empty = createWorkspaceElement(this.doc, 'div');
			empty.className = 'zbf-spotlight-empty';
			empty.textContent = '没有匹配的文献或操作。试试输入 @ 搜索全部文库，或输入 > 筛选命令。';
			this.listEl.appendChild(empty);
			return;
		}

		const visible: SpotlightItemResult[] = [];
		let rowIdx = 0;

		for (const sec of sections) {
			const collapsed = !hasQuery && this.collapsedSections.has(sec.key);
			const secHead = createWorkspaceElement(this.doc, 'div');
			secHead.className = 'zbf-spot-sec-head';
			secHead.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
			const secTitle = createWorkspaceElement(this.doc, 'span');
			secTitle.textContent = `${sec.title} (${sec.items.length})`;
			const secArrow = createWorkspaceElement(this.doc, 'span');
			secArrow.className = 'zbf-spot-sec-arrow';
			secArrow.textContent = collapsed ? '▸' : '▾';
			secHead.append(secTitle, secArrow);
			secHead.addEventListener('click', () => {
				if (this.collapsedSections.has(sec.key)) this.collapsedSections.delete(sec.key);
				else this.collapsedSections.add(sec.key);
				this.renderResults(this.inputEl?.value || '');
			});
			this.listEl.appendChild(secHead);

			if (collapsed) continue;
			for (const item of sec.items) {
				const idx = rowIdx++;
				visible.push(item);

				const row = createWorkspaceElement(this.doc, 'div');
				row.setAttribute('role', 'option');
				row.className = `zbf-spot-row${idx === this.activeIndex ? ' active' : ''}`;
				row.addEventListener('mouseenter', () => this.setActive(idx));
				row.addEventListener('click', () => {
					this.close();
					void Promise.resolve(item.action());
				});

				const topLine = createWorkspaceElement(this.doc, 'div');
				topLine.className = 'zbf-spot-row-top';
				topLine.appendChild(createWorkspaceIcon(this.doc, this.pickIcon(item), 14));

				const titleEl = createWorkspaceElement(this.doc, 'span');
				titleEl.className = 'zbf-spot-main';
				titleEl.textContent = item.title.replace(/^>\s*/, '');
				topLine.appendChild(titleEl);

				if (item.badge) {
					const badgeEl = createWorkspaceElement(this.doc, 'span');
					badgeEl.className = 'zbf-spot-badge';
					badgeEl.textContent = item.badge;
					topLine.appendChild(badgeEl);
				}
				row.appendChild(topLine);

				if (item.subtitle) {
					const subEl = createWorkspaceElement(this.doc, 'div');
					subEl.className = 'zbf-spot-sub';
					subEl.textContent = item.subtitle;
					row.appendChild(subEl);
				}
				this.listEl.appendChild(row);
			}
		}
		this.results = visible;
		this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.results.length - 1));
	}

	private setActive(idx: number): void {
		if (!this.results.length || !this.listEl) return;
		this.activeIndex = (idx + this.results.length) % this.results.length;
		const rows = Array.from(this.listEl.querySelectorAll('.zbf-spot-row')) as HTMLElement[];
		for (let i = 0; i < rows.length; i++) {
			rows[i].classList.toggle('active', i === this.activeIndex);
		}
		rows[this.activeIndex]?.scrollIntoView?.({ block: 'nearest' });
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
