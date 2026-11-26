import type { PluginKernel } from '../../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../../kernel/types.ts';
import type { WorkspaceStateStore } from '../store/state-store.ts';
import {
	buildSwitcherButtonDom,
	createSectionWrapper,
	ensureSwitcherStyleSheet,
	openSiblingAttachmentMenu,
	READER_ATT_BACKDROP_ID,
	READER_ATT_BTN_CLASS,
	READER_ATT_MENU_ID,
	READER_ATT_STYLE_ID,
	resolveSiblingAttachments,
	type SiblingAttachmentEntry,
} from './reader-attachment-switcher-ui.ts';

interface ReaderSlot {
	reader: any;
	doc: Document;
	wrap: HTMLDivElement;
	sectionWrap: HTMLDivElement | null;
	btn: HTMLButtonElement;
	labelEl: HTMLSpanElement;
	parentID: number;
	items: SiblingAttachmentEntry[];
}

export class ReaderAttachmentSwitcher {
	private readonly kernel: PluginKernel;
	private readonly store: WorkspaceStateStore;
	private readonly slots = new Map<Document, ReaderSlot>();
	private readonly pendingReaders = new WeakSet<object>();
	private unregisterToolbar: Disposable | null = null;
	private unsubNotifier: Disposable | null = null;
	private refreshTimer: ReturnType<typeof setTimeout> | null = null;
	private closeActiveMenu: (() => void) | null = null;
	private active = false;

	constructor(kernel: PluginKernel, store: WorkspaceStateStore) {
		this.kernel = kernel;
		this.store = store;
	}

	start(): void {
		if (this.active) return;
		this.active = true;
		this.registerToolbarHook();
		this.unsubNotifier = this.kernel.notifier.subscribe(['item', 'tab'], ({ event, type }) => {
			if (!this.active) return;
			if (type === 'tab' && (event === 'add' || event === 'select' || event === 'close')) {
				if (event === 'select') this.closeMenu();
				this.scheduleRefresh(40);
			} else if (type === 'item' && (event === 'add' || event === 'modify' || event === 'trash' || event === 'restore' || event === 'delete')) {
				this.scheduleRefresh(40);
			}
		});
		if (this.isEnabled()) this.scanOpenReaders();
	}

	stop(): void {
		if (!this.active) return;
		this.active = false;
		if (this.refreshTimer !== null) { clearTimeout(this.refreshTimer); this.refreshTimer = null; }
		this.unsubNotifier?.();
		this.unsubNotifier = null;
		this.unregisterToolbar?.();
		this.unregisterToolbar = null;
		this.unmountAll();
	}

	syncPref(): void {
		if (!this.active) return;
		if (!this.isEnabled()) { this.unmountAll(); return; }
		this.scanOpenReaders();
		this.refreshAllMounted();
	}

	mountReaderToolbar(reader: any, doc: Document, append?: (...els: Element[]) => void): void {
		if (!this.active || !this.isEnabled() || !reader || !doc) return;
		this.pruneClosedSlots();
		const existing = this.slots.get(doc);
		if (existing && existing.wrap.isConnected !== false) {
			existing.reader = reader;
			this.refreshSlot(existing);
			return;
		}
		ensureSwitcherStyleSheet(doc);
		doc.querySelectorAll?.(`.${READER_ATT_BTN_CLASS}`)?.forEach?.((n: Element) => {
			const parentSec = n.parentElement;
			n.remove();
			if (parentSec?.classList?.contains?.('section') && parentSec.childElementCount === 0) parentSec.remove();
		});

		const { wrap, btn, labelEl } = buildSwitcherButtonDom(doc);
		let sectionWrap: HTMLDivElement | null = null;
		if (typeof append === 'function') {
			append(wrap);
		} else {
			const container = doc.querySelector?.('.toolbar .custom-sections') || doc.querySelector?.('.toolbar .end');
			if (!container) return;
			if (container.classList?.contains?.('custom-sections')) {
				sectionWrap = createSectionWrapper(doc, wrap);
				container.appendChild(sectionWrap);
			} else {
				container.appendChild(wrap);
			}
		}

		const slot: ReaderSlot = { reader, doc, wrap, sectionWrap, btn, labelEl, parentID: 0, items: [] };
		btn.addEventListener('click', (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			this.toggleMenu(slot);
		});
		this.slots.set(doc, slot);
		this.refreshSlot(slot);
	}

	private isEnabled(): boolean {
		return Boolean(this.kernel.prefs.get('workspace.enableReaderAttachmentSwitcher'));
	}

	private registerToolbarHook(): void {
		if (this.unregisterToolbar) return;
		const readerApi = (globalThis as any).Zotero?.Reader;
		if (typeof readerApi?.registerEventListener !== 'function') return;
		const handler = (event: any) => {
			if (!this.active || !this.isEnabled()) return;
			if (event?.reader && event?.doc) this.mountReaderToolbar(event.reader, event.doc, event.append);
		};
		try {
			readerApi.registerEventListener('renderToolbar', handler, this.kernel.info.id);
			this.unregisterToolbar = () => {
				try { readerApi.unregisterEventListener?.('renderToolbar', handler); } catch { /* ignore */ }
			};
		} catch {
			this.unregisterToolbar = null;
		}
	}

	private scanOpenReaders(): void {
		const readers: any[] = (globalThis as any).Zotero?.Reader?._readers || [];
		for (const reader of readers) {
			if (!reader || reader._isTabClosed || reader._isUninitialized) continue;
			const doc = reader._iframeWindow?.document as Document | undefined;
			if (doc?.querySelector?.('.toolbar .custom-sections')) {
				this.mountReaderToolbar(reader, doc);
			} else if (!this.pendingReaders.has(reader)) {
				this.pendingReaders.add(reader);
				const waitReady = reader._waitForReader?.() ?? reader._initPromise ?? Promise.resolve();
				void Promise.resolve(waitReady).then(() => {
					this.pendingReaders.delete(reader);
					if (!this.active || !this.isEnabled() || reader._isTabClosed) return;
					const readyDoc = reader._iframeWindow?.document as Document | undefined;
					if (readyDoc?.querySelector?.('.toolbar .custom-sections')) this.mountReaderToolbar(reader, readyDoc);
				}).catch(() => { this.pendingReaders.delete(reader); });
			}
		}
	}

	private scheduleRefresh(delayMs: number): void {
		if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = null;
			if (!this.active) return;
			if (this.isEnabled()) this.scanOpenReaders();
			this.refreshAllMounted();
		}, delayMs);
	}

	private refreshAllMounted(): void {
		this.pruneClosedSlots();
		for (const slot of this.slots.values()) this.refreshSlot(slot);
	}

	private syncSlotVisibility(slot: ReaderSlot, hidden: boolean): void {
		slot.wrap.hidden = hidden;
		const sec = slot.sectionWrap || (slot.wrap.parentElement?.classList?.contains?.('section') ? slot.wrap.parentElement as HTMLDivElement : null);
		if (sec && sec.childElementCount <= 1) sec.hidden = hidden;
	}

	private refreshSlot(slot: ReaderSlot): void {
		if (!this.isEnabled()) { this.syncSlotVisibility(slot, true); return; }
		const attID = Number(slot.reader?.itemID || 0);
		const { parentID, items } = resolveSiblingAttachments(attID);
		slot.parentID = parentID;
		slot.items = items;
		if (items.length < 2) { this.syncSlotVisibility(slot, true); return; }
		const zh = Boolean((globalThis as any).Zotero?.locale?.startsWith?.('zh'));
		slot.labelEl.textContent = zh ? `共 ${items.length} 个版本` : `${items.length} versions`;
		slot.btn.title = zh
			? `切换当前文献的其他附件版本（共 ${items.length} 个）`
			: `Switch attachment version (${items.length} total)`;
		this.syncSlotVisibility(slot, false);
	}

	private toggleMenu(slot: ReaderSlot): void {
		const hadMenu = Boolean(slot.doc.getElementById?.(READER_ATT_MENU_ID));
		this.closeMenu();
		if (hadMenu) return;
		this.refreshSlot(slot);
		if (slot.items.length < 2) return;
		const zh = Boolean((globalThis as any).Zotero?.locale?.startsWith?.('zh'));
		const curAttID = Number(slot.reader?.itemID || 0);
		this.closeActiveMenu = openSiblingAttachmentMenu({
			doc: slot.doc,
			hostWin: this.resolveOwnerWindow(slot.reader),
			anchorBtn: slot.btn,
			items: slot.items,
			currentAttID: curAttID,
			openAttIDs: this.collectOpenAttIDs(slot.reader),
			zh,
			onSelect: (entry, ev, forceBackground) => {
				void this.switchToAttachment(slot.reader, slot.parentID, entry, ev, forceBackground);
			},
			onClose: () => { this.closeActiveMenu = null; },
		});
	}

	private collectOpenAttIDs(reader: any): Set<number> {
		const open = new Set<number>();
		const win = this.resolveOwnerWindow(reader);
		const tabs: any[] = Array.isArray((win as any)?.Zotero_Tabs?._tabs) ? (win as any).Zotero_Tabs._tabs : [];
		for (const t of tabs) {
			const id = Number(t?.data?.itemID || 0);
			if (id > 0) open.add(id);
		}
		return open;
	}

	private resolveOwnerWindow(reader: any): Window | null {
		const tabID = String(reader?.tabID || '');
		const wins: Window[] = (globalThis as any).Zotero?.getMainWindows?.() || [];
		if (tabID) {
			const matched = wins.find((w: any) => Array.isArray(w?.Zotero_Tabs?._tabs) && w.Zotero_Tabs._tabs.some((t: any) => t?.id === tabID));
			if (matched) return matched;
		}
		return (globalThis as any).Zotero?.getMainWindow?.() || wins[0] || null;
	}

	async switchToAttachment(
		reader: any,
		parentID: number,
		target: SiblingAttachmentEntry,
		ev?: MouseEvent | KeyboardEvent,
		forceBackground = false,
	): Promise<boolean> {
		const currentAttID = Number(reader?.itemID || 0);
		if (!target?.id || target.id === currentAttID) return false;
		const win = this.resolveOwnerWindow(reader) as any;
		const zotero = (globalThis as any).Zotero;
		const tabsApi = win?.Zotero_Tabs;
		const nativeTabs: any[] = Array.isArray(tabsApi?._tabs) ? tabsApi._tabs : [];
		const curTabID = String(reader?.tabID || '');
		const curIdx = curTabID ? nativeTabs.findIndex((t) => t?.id === curTabID) : -1;
		const bg = Boolean(forceBackground || (ev && (ev.ctrlKey || ev.metaKey)));
		const replaceCur = Boolean(!bg && ev && ev.altKey && curTabID);
		const groupId = this.store.groupOfKey(`item:${currentAttID}`)
			|| (parentID > 0 ? this.store.groupOfKey(`item:${parentID}`) : '')
			|| '';

		const existing = nativeTabs.find((t) => Number(t?.data?.itemID || 0) === target.id);
		if (existing) {
			if (!bg) tabsApi?.select?.(existing.id);
			this.store.removeVirtualMember(`item:${target.id}`);
			if (groupId && !this.store.groupOfKey(`item:${target.id}`)) this.store.assignToGroup(`item:${target.id}`, groupId);
			if (replaceCur && existing.id !== curTabID) tabsApi?.close?.(curTabID);
			return true;
		}

		let opened = false;
		if (target.readerCapable && typeof zotero?.Reader?.open === 'function') {
			try {
				await zotero.Reader.open(target.id, undefined, {
					tabIndex: curIdx >= 0 ? curIdx + 1 : undefined,
					openInBackground: bg,
				});
				opened = true;
			} catch { /* fall back to viewAttachment */ }
		}
		if (!opened && typeof win?.ZoteroPane?.viewAttachment === 'function') {
			try {
				await win.ZoteroPane.viewAttachment(target.id, ev);
				opened = true;
			} catch { /* ignore */ }
		}
		if (!opened) return false;

		this.store.removeVirtualMember(`item:${target.id}`);
		if (groupId) this.store.assignToGroup(`item:${target.id}`, groupId);
		if (replaceCur) tabsApi?.close?.(curTabID);
		return true;
	}

	private closeMenu(): void {
		try { this.closeActiveMenu?.(); } catch { /* ignore */ }
		this.closeActiveMenu = null;
	}

	private removeSlotDom(slot: ReaderSlot): void {
		slot.wrap.remove();
		if (slot.sectionWrap && slot.sectionWrap.childElementCount === 0) slot.sectionWrap.remove();
	}

	private pruneClosedSlots(): void {
		for (const [doc, slot] of [...this.slots.entries()]) {
			if (!doc.defaultView || (doc.defaultView as any).closed || slot.reader?._isTabClosed) {
				this.removeSlotDom(slot);
				this.slots.delete(doc);
			}
		}
	}

	private unmountAll(): void {
		this.closeMenu();
		for (const [doc, slot] of [...this.slots.entries()]) {
			this.removeSlotDom(slot);
			doc.getElementById?.(READER_ATT_STYLE_ID)?.remove();
			doc.getElementById?.(READER_ATT_MENU_ID)?.remove();
			doc.getElementById?.(READER_ATT_BACKDROP_ID)?.remove();
		}
		this.slots.clear();
	}
}
