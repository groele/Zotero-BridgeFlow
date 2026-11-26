import { createWorkspaceElement } from '../workspace-elements.ts';
import type { SpotlightItemResult } from '../../../kernel/types.ts';
import type { WorkspaceSpotlightEngine } from './spotlight-engine.ts';
import { createWorkspaceIcon, type WorkspaceIconName } from '../workspace-icons.ts';

interface SectionGroup {
	key: string;
	title: string;
	items: SpotlightItemResult[];
}

export class WorkspaceSpotlightPanel {
	private readonly win: Window;
	private readonly doc: Document;
	private readonly engine: WorkspaceSpotlightEngine;
	private panelEl: HTMLElement | null = null;
	private inputEl: HTMLInputElement | null = null;
	private listEl: HTMLElement | null = null;
	private results: SpotlightItemResult[] = [];
	private activeIndex = 0;
	private rows: HTMLElement[] = [];
	private timer = 0;
	private readonly dismissOutside = (event: Event) => {
		if (this.panelEl && !event.composedPath().includes(this.panelEl)
			&& !event.composedPath().some(node => (node as Element).getAttribute?.('data-action') === 'search')) this.close();
	};
	private readonly onResize = () => {
		if (this.isOpen()) this.positionNearAnchor();
	};

	private scheduleResults(delay: number): void {
		this.win.clearTimeout(this.timer);
		this.timer = this.win.setTimeout(() => {
			this.timer = 0;
			if (this.inputEl) this.renderResults(this.inputEl.value);
		}, delay);
	}
	private readonly collapsedSections = new Set<string>(['groups']);

	constructor(win: Window, engine: WorkspaceSpotlightEngine) {
		this.win = win;
		this.doc = win.document;
		this.engine = engine;
	}

	isOpen(): boolean {
		return Boolean(this.panelEl?.isConnected);
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

		const panel = createWorkspaceElement(this.doc, 'div');
		panel.id = 'zbf-spotlight-panel';

		const inputWrap = createWorkspaceElement(this.doc, 'div');
		inputWrap.className = 'zbf-spot-input-wrap';
		inputWrap.appendChild(createWorkspaceIcon(this.doc, 'search', 14));

		const input = createWorkspaceElement(this.doc, 'input') as HTMLInputElement;
		input.id = 'zbf-spotlight-input';
		input.type = 'search';
		input.placeholder = '查找打开的标签、备注、分组或会话；输入 > 查看命令…';
		input.value = initialQuery;
		const clearBtn = createWorkspaceElement(this.doc, 'button') as HTMLButtonElement;
		clearBtn.type = 'button';
		clearBtn.className = 'zbf-spot-clear';
		clearBtn.textContent = '✕';
		clearBtn.title = '清空搜索';
		clearBtn.hidden = !initialQuery;
		clearBtn.addEventListener('click', () => {
			input.value = '';
			clearBtn.hidden = true;
			this.activeIndex = 0;
			this.renderResults('');
			input.focus();
		});
		input.addEventListener('input', () => {
			clearBtn.hidden = !input.value;
			this.activeIndex = 0;
			this.scheduleResults(75);
		});
		input.addEventListener('keydown', (e) => this.handleKeydown(e as KeyboardEvent));
		inputWrap.append(input, clearBtn);

		const list = createWorkspaceElement(this.doc, 'div');
		list.id = 'zbf-spotlight-list';

		const footer = createWorkspaceElement(this.doc, 'div');
		footer.className = 'zbf-spot-footer';
		footer.textContent = '↑↓ 选择 · Enter 打开/执行 · > 命令模式 · Esc 关闭';

		panel.append(inputWrap, list, footer);
		host.appendChild(panel);

		this.panelEl = panel;
		this.inputEl = input;
		this.listEl = list;
		this.positionNearAnchor(anchor);
		input.focus();
		input.select();
		this.doc.addEventListener('pointerdown', this.dismissOutside, true);
		this.win.addEventListener?.('resize', this.onResize);
		this.scheduleResults(16);
	}

	toggle(anchor?: HTMLElement | null): void {
		if (this.isOpen()) this.close();
		else this.open('', anchor);
	}

	close(): void {
		this.doc.removeEventListener('pointerdown', this.dismissOutside, true);
		this.win.removeEventListener?.('resize', this.onResize);
		this.win.clearTimeout(this.timer);
		this.panelEl?.remove();
		this.panelEl = null;
		this.inputEl = null;
		this.listEl = null;
		this.results = [];
		this.rows = [];
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

		let top = 44;
		let left = Math.max(12, Math.round(winW - panelW - 16));
		if (anchor && typeof anchor.getBoundingClientRect === 'function') {
			const rect = anchor.getBoundingClientRect();
			if (rect.width > 0 || rect.height > 0) {
				top = Math.max(8, Math.min(Math.round(rect.bottom + 6), Math.max(8, winH - 220)));
				left = Math.max(12, Math.min(Math.round(rect.right - panelW), winW - panelW - 12));
			}
		}
		this.panelEl.style.top = `${top}px`;
		this.panelEl.style.left = `${left}px`;
		if (this.listEl) this.listEl.style.maxHeight = `${Math.max(140, Math.min(440, winH - top - 82))}px`;
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
			else if (it.id.startsWith('lib:') || it.id.startsWith('recent-added:')) library.push(it);
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
		if (item.category === 'citation' || item.id.startsWith('word-cite')) return 'word';
		if (item.category === 'command' || item.id.startsWith('cmd:')) return 'layers';
		if (item.badge?.includes('虚拟')) return 'virtual';
		if (item.badge?.includes('笔记')) return 'note';
		return 'pdf';
	}

	private renderResults(rawQuery: string): void {
		if (!this.listEl) return;
		const fragment = this.doc.createDocumentFragment();
		const all = this.engine.query(rawQuery, this.win);
		const hasQuery = rawQuery.trim().length > 0;
		const sections = this.partitionSections(all);

		if (!sections.length) {
			this.results = [];
			this.rows = [];
			const empty = createWorkspaceElement(this.doc, 'div');
			empty.className = 'zbf-spotlight-empty';
			empty.textContent = hasQuery ? '没有匹配项。搜索整库请使用 Zotero 主文库搜索框。' : '当前没有打开的阅读标签。输入分组、会话名称，或输入 > 查看命令。';
			this.listEl.replaceChildren(empty);
			return;
		}

		const visible: SpotlightItemResult[] = [];
		this.rows = [];
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
			fragment.appendChild(secHead);

			if (collapsed) continue;
			for (const item of sec.items) {
				const idx = rowIdx++;
				visible.push(item);

				const row = createWorkspaceElement(this.doc, 'div');
				row.setAttribute('role', 'option');
				row.className = 'zbf-spot-row';
				row.addEventListener('mouseenter', () => this.setActive(idx, false));
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
				fragment.appendChild(row);
				this.rows.push(row);
			}
		}
		this.listEl.replaceChildren(fragment);
		this.results = visible;
		this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.results.length - 1));
		this.rows[this.activeIndex]?.classList.add('active');
	}

	private setActive(idx: number, scroll = true): void {
		if (!this.results.length || !this.listEl) return;
		const next = (idx + this.results.length) % this.results.length;
		if (next !== this.activeIndex) {
			this.rows[this.activeIndex]?.classList.remove('active');
			this.rows[next]?.classList.add('active');
			this.activeIndex = next;
		}
		if (scroll) this.rows[next]?.scrollIntoView?.({ block: 'nearest' });
	}

	private handleKeydown(e: KeyboardEvent): void {
		if (e.isComposing) return;
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
