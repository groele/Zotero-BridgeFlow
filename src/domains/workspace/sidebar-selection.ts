import type { UnifiedPrefService } from '../../kernel/pref-service.ts';
import type { WorkspaceStateStore } from './state-store.ts';
import type { TrackedTab } from './types.ts';

export class SidebarSelection {
	private active = false;
	private readonly selected = new Set<string>();
	private tracked: TrackedTab[] = [];
	private readonly toggleBtn: HTMLButtonElement;
	private readonly controls: HTMLDivElement;
	private readonly countEl: HTMLSpanElement;
	private readonly selectAllBtn: HTMLButtonElement;
	private readonly groupSelect: HTMLSelectElement;
	private readonly pinBtn: HTMLButtonElement;
	private readonly unpinBtn: HTMLButtonElement;
	private readonly copyRefsBtn: HTMLButtonElement;
	private readonly citeWordBtn: HTMLButtonElement;
	private readonly closeBtn: HTMLButtonElement;
	private readonly doc: Document;
	private readonly prefs: UnifiedPrefService;
	private readonly store: WorkspaceStateStore;
	private readonly list: HTMLElement;
	private readonly onChange: () => void;
	private readonly onCloseSelected: (tabIDs: string[]) => void;
	private readonly onCopySelected?: (itemIDs: number[]) => void;
	private readonly onCiteSelected?: (itemIDs: number[]) => void;

	constructor(
		doc: Document,
		prefs: UnifiedPrefService,
		store: WorkspaceStateStore,
		headerActions: HTMLElement,
		aside: HTMLElement,
		list: HTMLElement,
		onChange: () => void,
		onCloseSelected: (tabIDs: string[]) => void,
		onCopySelected?: (itemIDs: number[]) => void,
		onCiteSelected?: (itemIDs: number[]) => void,
	) {
		this.doc = doc;
		this.prefs = prefs;
		this.store = store;
		this.list = list;
		this.onChange = onChange;
		this.onCloseSelected = onCloseSelected;
		this.onCopySelected = onCopySelected;
		this.onCiteSelected = onCiteSelected;

		this.toggleBtn = this.btn('多选', () => {
			this.active = !this.active;
			this.selected.clear();
			this.onChange();
		});
		this.toggleBtn.setAttribute('data-batch-toggle', 'true');
		headerActions.prepend(this.toggleBtn);

		this.controls = this.h('div');
		this.controls.className = 'zbf-batch-controls';
		this.controls.hidden = true;
		this.countEl = this.h('span');
		this.selectAllBtn = this.btn('全选可见', () => {
			for (const cb of this.visibleCheckboxes()) {
				this.selected.add(cb.value);
				cb.checked = true;
			}
			this.updateControls();
		});
		this.groupSelect = this.h('select');
		this.groupSelect.onchange = () => {
			if (this.groupSelect.selectedIndex > 0) {
				const targetGroupId = this.groupSelect.value;
				for (const key of this.selectedKeys()) {
					this.store.assignToGroup(key, targetGroupId);
				}
				this.onChange();
			}
			this.groupSelect.selectedIndex = 0;
		};
		this.pinBtn = this.btn('固定', () => {
			for (const key of this.selectedKeys()) this.store.setPinned(key, true);
			this.onChange();
		});
		this.unpinBtn = this.btn('取消固定', () => {
			for (const key of this.selectedKeys()) this.store.setPinned(key, false);
			this.onChange();
		});
		this.copyRefsBtn = this.btn('复制引文', () => {
			this.onCopySelected?.(this.selectedItemIDs());
		});
		this.citeWordBtn = this.btn('插入Word', () => {
			this.onCiteSelected?.(this.selectedItemIDs());
		});
		this.closeBtn = this.btn('关闭', () => {
			const ids = [...this.selected];
			this.selected.clear();
			this.onCloseSelected(ids);
		});
		this.controls.append(this.countEl, this.selectAllBtn, this.groupSelect, this.pinBtn, this.unpinBtn, this.copyRefsBtn, this.citeWordBtn, this.closeBtn);
		aside.insertBefore(this.controls, list);
	}

	beginRender(tracked: TrackedTab[]): void {
		const enabled = this.prefs.get('workspace.enableBatchSelection');
		if (!enabled) {
			this.active = false;
			this.selected.clear();
		}
		this.tracked = tracked;
		const open = new Set(tracked.map((t) => t.tabID).filter(Boolean));
		for (const id of this.selected) if (!open.has(id)) this.selected.delete(id);
		this.toggleBtn.hidden = !enabled;
		this.toggleBtn.setAttribute('aria-pressed', String(this.active));
		this.controls.hidden = !this.active;
		if (!this.active) return;

		const placeholder = this.h('option');
		placeholder.disabled = true;
		placeholder.selected = true;
		placeholder.textContent = '移到分组…';
		this.groupSelect.replaceChildren(placeholder);
		for (const group of this.store.state.groups) {
			const opt = this.h('option');
			opt.value = group.id;
			opt.textContent = group.name;
			this.groupSelect.append(opt);
		}
	}

	updateControls(): void {
		if (!this.active) return;
		const count = this.selected.size;
		this.countEl.textContent = `已选 ${count}`;
		this.selectAllBtn.disabled = !this.visibleCheckboxes().some((cb) => !cb.checked);
		this.groupSelect.disabled = !count || !this.store.state.groups.length;
		const pinOn = this.prefs.get('workspace.enablePinnedTabs');
		this.pinBtn.hidden = !pinOn;
		this.unpinBtn.hidden = !pinOn;
		this.pinBtn.disabled = !count;
		this.unpinBtn.disabled = !count;
		this.copyRefsBtn.hidden = !this.onCopySelected || !this.prefs.get('workspace.enableCopyReference');
		this.copyRefsBtn.disabled = !count;
		this.citeWordBtn.hidden = !this.onCiteSelected || !this.prefs.get('modules.wordCite.enable') || !this.prefs.get('wordCite.dragCite.enable');
		this.citeWordBtn.disabled = !count;
		this.closeBtn.disabled = !count;
	}

	addCheckbox(row: HTMLElement, tab: TrackedTab): void {
		if (!this.active || !tab.tabID) return;
		const label = this.h('label');
		label.className = 'zbf-batch-target';
		const check = this.h('input');
		check.className = 'zbf-batch-check';
		check.type = 'checkbox';
		check.value = tab.tabID;
		check.checked = this.selected.has(tab.tabID);
		check.setAttribute('aria-label', tab.title);
		check.onchange = () => {
			if (check.checked) this.selected.add(tab.tabID);
			else this.selected.delete(tab.tabID);
			this.updateControls();
		};
		label.onclick = (e) => e.stopPropagation();
		label.append(check);
		row.prepend(label);
	}

	private visibleCheckboxes(): HTMLInputElement[] {
		return (Array.from(this.list.querySelectorAll('.zbf-batch-check')) as HTMLInputElement[])
			.filter((cb) => !cb.closest('[hidden]'));
	}

	private selectedKeys(): string[] {
		return [...new Set(this.tracked.filter((t) => this.selected.has(t.tabID)).map((t) => t.key))];
	}

	private selectedItemIDs(): number[] {
		return [...new Set(this.tracked.filter((t) => this.selected.has(t.tabID)).map((t) => t.parentItemID || t.itemID).filter((id) => id > 0))];
	}

	private h<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
		return this.doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K];
	}

	private btn(label: string, onClick: () => void): HTMLButtonElement {
		const b = this.h('button');
		b.type = 'button';
		b.textContent = label;
		b.onclick = onClick;
		return b;
	}
}
