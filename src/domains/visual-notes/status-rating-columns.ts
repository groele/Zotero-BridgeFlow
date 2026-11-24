import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import {
	captureBatchTargets,
	clearStatusRatingCaches,
	getItemRating,
	getItemStatus,
	normalizeRatingStorage,
	setItemRating,
	type RatingStorageLocation,
} from '../../services/item-status-rating.ts';
import {
	closeStatusPickerPopover,
	ensureStatusRatingStyle,
	openStatusPickerPopover,
	srHtmlEl,
} from './status-rating-popover.ts';

function registerColumnSafe(registeredKeys: Set<string>, descriptor: Record<string, unknown>): boolean {
	const manager = (globalThis as any).Zotero?.ItemTreeManager;
	const key = manager?.registerColumn?.(descriptor);
	if (typeof key !== 'string' || !key) return false;
	registeredKeys.add(key);
	return true;
}

function unregisterAllSafe(registeredKeys: Set<string>): void {
	if (!registeredKeys.size) return;
	const keys = [...registeredKeys];
	registeredKeys.clear();
	const manager = (globalThis as any).Zotero?.ItemTreeManager;
	try {
		if (typeof manager?.unregisterColumn === 'function') {
			for (const k of keys) void Promise.resolve(manager.unregisterColumn(k)).catch(() => {});
		} else if (typeof manager?.unregisterColumns === 'function') {
			void Promise.resolve(manager.unregisterColumns(keys)).catch(() => {});
		}
	} catch { /* ignore */ }
}

function guardPrimaryTreePointer(el: HTMLElement): void {
	el.addEventListener('mousedown', (ev) => {
		if (ev.button === 0) ev.stopPropagation();
	});
	el.addEventListener('mouseup', (ev) => {
		if (ev.button === 0) ev.stopPropagation();
	});
	el.addEventListener('dblclick', (ev) => {
		ev.stopPropagation();
		ev.preventDefault();
	});
}

function bindInstantCellPress(el: HTMLElement, handler: (ev: MouseEvent) => void): void {
	let lastPointerDownAt = 0;
	el.addEventListener('mousedown', (ev) => {
		if (ev.button !== 0) return;
		ev.stopPropagation();
		lastPointerDownAt = Date.now();
		handler(ev);
	});
	el.addEventListener('click', (ev) => {
		ev.stopPropagation();
		if (Date.now() - lastPointerDownAt < 450) return;
		handler(ev);
	});
}

export class StatusRatingColumnsController {
	private readonly registeredKeys = new Set<string>();
	private activeStatus = false;
	private activeRating = false;
	private readonly kernel: PluginKernel;
	private readonly onMutated?: () => void;

	constructor(kernel: PluginKernel, onMutated?: () => void) {
		this.kernel = kernel;
		this.onMutated = onMutated;
	}

	private isZh(): boolean {
		return Boolean((globalThis as any).Zotero?.locale?.startsWith?.('zh'));
	}

	private excludedTag(): string {
		return String(this.kernel.prefs.get('wordCite.citationTags.text') || '/Citations');
	}

	private ratingStorage(): RatingStorageLocation {
		return normalizeRatingStorage(this.kernel.prefs.get('visualNotes.ratingStorage'));
	}

	syncColumns(): void {
		const wantStatus = Boolean(this.kernel.prefs.get('visualNotes.statusColumn.enable'));
		const wantRating = Boolean(this.kernel.prefs.get('visualNotes.ratingColumn.enable'));
		if (wantStatus !== this.activeStatus || wantRating !== this.activeRating) {
			this.unregisterAll();
			if (wantStatus) this.registerStatusColumn();
			if (wantRating) this.registerRatingColumn();
		}
	}

	unregisterAll(): void {
		this.activeStatus = false;
		this.activeRating = false;
		const wins: Window[] = (globalThis as any).Zotero?.getMainWindows?.() || [];
		for (const w of wins) closeStatusPickerPopover(w?.document);
		unregisterAllSafe(this.registeredKeys);
	}

	clearCache(): void {
		clearStatusRatingCaches();
	}

	refreshColumns(): void {
		this.clearCache();
		if ((!this.activeStatus && !this.activeRating) || !this.registeredKeys.size) return;
		try {
			(globalThis as any).Zotero?.ItemTreeManager?.refreshColumns?.();
		} catch { /* ignore */ }
	}

	private resolveRowContext(index: number, treeDoc?: Document): { win: Window | null; doc: Document | null; item: any } {
		const win: Window | null = treeDoc?.defaultView || (globalThis as any).Zotero?.getMainWindow?.() || null;
		const doc = win?.document || null;
		const item = (win as any)?.ZoteroPane?.itemsView?.getRow?.(index)?.ref || null;
		return { win, doc, item };
	}

	getStatusDisplay(item: any): string {
		return getItemStatus(item, this.excludedTag())?.label || '';
	}

	getRatingDisplay(item: any): string {
		const r = getItemRating(item, this.ratingStorage());
		return r > 0 ? String(r) : '';
	}

	private notifyApplied = (): void => {
		this.refreshColumns();
		this.onMutated?.();
	};

	private registerStatusColumn(): void {
		const zh = this.isZh();
		this.activeStatus = registerColumnSafe(this.registeredKeys, {
			dataKey: 'bridgeflowStatus',
			label: zh ? '阅读状态' : 'Reading Status',
			enabledTreeIDs: ['main'],
			showInColumnPicker: true,
			columnPickerSubMenu: false,
			minWidth: 80,
			zoteroPersist: ['width', 'hidden', 'sortDirection'],
			pluginID: this.kernel.info.id,
			dataProvider: (item: any) => this.getStatusDisplay(item),
			renderCell: (index: number, _data: string, column: { className?: string }, _first: boolean, treeDoc?: Document) => {
				const { win, doc, item } = this.resolveRowContext(index, treeDoc);
				if (!doc) return {} as HTMLElement;
				ensureStatusRatingStyle(doc);
				const span = srHtmlEl(doc, 'span');
				span.className = `cell ${column?.className || ''} clickable zbf-status-cell`.trim();
				if (!item || (typeof item.isRegularItem === 'function' && !item.isRegularItem())) return span;

				const current = getItemStatus(item, this.excludedTag());
				const trigger = srHtmlEl(doc, 'span');
				if (current) {
					trigger.className = 'zbf-status-pill';
					trigger.style.borderColor = `${current.color}66`;
					trigger.style.background = `${current.color}22`;
					const dot = srHtmlEl(doc, 'span');
					dot.className = 'zbf-status-dot';
					dot.style.background = current.color;
					const txt = srHtmlEl(doc, 'span');
					txt.textContent = current.label;
					trigger.append(dot, txt);
					trigger.title = zh
						? `点击切换状态（当前：${current.tag} · 支持多选批量与数字键 1–9 快选）`
						: `Switch status (${current.tag} · supports multi-select & keys 1–9)`;
				} else {
					trigger.className = 'zbf-status-empty';
					trigger.textContent = zh ? '+ 状态' : '+ Status';
					trigger.title = zh
						? '点击设置阅读状态（支持多选批量与数字键 1–9 快选）'
						: 'Set reading status (supports multi-select & keys 1–9)';
				}
				guardPrimaryTreePointer(trigger);
				bindInstantCellPress(trigger, () => {
					if (win) {
						openStatusPickerPopover({
							win,
							anchor: trigger,
							clickedItem: item,
							current,
							zh,
							excludedTag: this.excludedTag(),
							syncZoteroTagColor: Boolean(this.kernel.prefs.get('visualNotes.statusSyncZoteroTagColor')),
							onApplied: this.notifyApplied,
						});
					}
				});
				span.appendChild(trigger);
				return span;
			},
		});
	}

	private registerRatingColumn(): void {
		const zh = this.isZh();
		this.activeRating = registerColumnSafe(this.registeredKeys, {
			dataKey: 'bridgeflowRating',
			label: zh ? '评级' : 'Rating',
			enabledTreeIDs: ['main'],
			showInColumnPicker: true,
			columnPickerSubMenu: false,
			minWidth: 84,
			zoteroPersist: ['width', 'hidden', 'sortDirection'],
			pluginID: this.kernel.info.id,
			dataProvider: (item: any) => this.getRatingDisplay(item),
			renderCell: (index: number, _data: string, column: { className?: string }, _first: boolean, treeDoc?: Document) => {
				const { win, doc, item } = this.resolveRowContext(index, treeDoc);
				if (!doc) return {} as HTMLElement;
				ensureStatusRatingStyle(doc);
				const span = srHtmlEl(doc, 'span');
				span.className = `cell ${column?.className || ''} clickable zbf-rating-cell`.trim();
				if (!item || (typeof item.isRegularItem === 'function' && !item.isRegularItem())) return span;

				let current = getItemRating(item, this.ratingStorage());
				const fit = srHtmlEl(doc, 'span');
				fit.className = 'zbf-sr-fit';
				const wrap = srHtmlEl(doc, 'span');
				wrap.className = 'zbf-rating-stars';
				wrap.setAttribute('role', 'radiogroup');
				wrap.setAttribute('aria-label', zh ? '星级评价' : 'Star rating');
				guardPrimaryTreePointer(wrap);

				const starEls: HTMLSpanElement[] = [];
				const syncVisual = (val: number) => {
					if (val === 0) wrap.setAttribute('data-unrated', 'true');
					else wrap.removeAttribute('data-unrated');
					starEls.forEach((s, idx) => {
						const k = idx + 1;
						if (k <= val) s.setAttribute('data-lit', 'true');
						else s.removeAttribute('data-lit');
						s.title = zh
							? (val === k ? `点击清除 ${k} 星评级` : `设为 ${k} 星（支持多选批量打分）`)
							: (val === k ? `Clear ${k}-star rating` : `Rate ${k} stars (multi-select aware)`);
					});
				};

				wrap.addEventListener('mouseleave', () => {
					wrap.removeAttribute('data-hover');
					wrap.removeAttribute('data-clear-hint');
				});

				for (let k = 1; k <= 5; k++) {
					const star = srHtmlEl(doc, 'span');
					star.className = 'zbf-rating-star';
					star.textContent = '⭐';
					star.addEventListener('mouseenter', () => {
						wrap.setAttribute('data-hover', String(k));
						if (current === k) wrap.setAttribute('data-clear-hint', 'true');
						else wrap.removeAttribute('data-clear-hint');
					});
					bindInstantCellPress(star, () => {
						const selected = (win as any)?.ZoteroPane?.getSelectedItems?.() || [];
						const targets = captureBatchTargets(selected, item);
						const next = current === k ? 0 : k;
						current = next;
						wrap.removeAttribute('data-hover');
						wrap.removeAttribute('data-clear-hint');
						syncVisual(next);
						const storage = this.ratingStorage();
						void (async () => {
							try {
								for (const t of targets) {
									try { await setItemRating(t, next, storage); } catch { /* isolate per-item failure */ }
								}
							} finally {
								this.notifyApplied();
							}
						})();
					});
					starEls.push(star);
					wrap.appendChild(star);
				}
				syncVisual(current);
				fit.appendChild(wrap);
				span.appendChild(fit);
				return span;
			},
		});
	}
}
