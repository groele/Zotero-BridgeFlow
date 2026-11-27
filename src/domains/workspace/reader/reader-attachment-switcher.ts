import { getEffectiveReaderTabID, getHostTabs, getReaderDocument, scanPendingReaders } from '../../../services/host/host-queries.ts';
import { clearWarmReaderDecks, prestageAttachmentInReaderTab, showAttachmentInReaderTab } from '../../../services/reader-tab-navigation.ts';
import { collectOpenAttIDs, resolveOwnerWindow } from './reader-owner-window.ts';
import type { PluginKernel } from '../../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../../kernel/types.ts';
import type { WorkspaceStateStore } from '../store/state-store.ts';
import {
	buildSwitcherButtonDom, createSectionWrapper, ensureSwitcherStyleSheet, openSiblingAttachmentMenu,
	READER_ATT_BACKDROP_ID, READER_ATT_BTN_CLASS, READER_ATT_MENU_ID, READER_ATT_STYLE_ID,
	resolveSiblingAttachments, type SiblingAttachmentEntry,
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
	dirty: boolean;
}

export class ReaderAttachmentSwitcher {
	private readonly kernel: PluginKernel;
	private readonly store: WorkspaceStateStore;
	private readonly slots = new Map<Document, ReaderSlot>();
	private readonly pendingReaders = new WeakSet<object>();
	private readonly warmedAttachmentIDs = new Set<number>();
	private unregisterToolbar: Disposable | null = null;
	private unsubNotifier: Disposable | null = null;
	private refreshTimer: ReturnType<typeof setTimeout> | null = null;
	private scanRequested = false;
	private changedIDs = new Set<number>();
	private refreshAll = false;
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
		this.unsubNotifier = this.kernel.notifier.subscribe(['item', 'tab'], ({ event, type, ids }) => {
			if (!this.active || !this.isEnabled()) return;
			if (type === 'tab' && (event === 'add' || event === 'select' || event === 'close')) {
				if (event === 'select') this.closeMenu();
				this.scanRequested = true;
				this.scheduleRefresh(40);
			} else if (type === 'item' && (event === 'add' || event === 'modify' || event === 'trash' || event === 'restore' || event === 'delete')) {
				if (!this.slots.size) return;
				if (!ids.length) this.refreshAll = true;
				for (const id of ids) this.changedIDs.add(Number(id));
				this.scheduleRefresh(40);
			}
		});
		if (this.isEnabled()) this.scanOpenReaders();
	}

	stop(): void {
		if (!this.active) return;
		this.active = false;
		if (this.refreshTimer !== null) { clearTimeout(this.refreshTimer); this.refreshTimer = null; }
		this.resetPendingRefresh();
		this.unsubNotifier?.();
		this.unsubNotifier = null;
		this.unregisterToolbar?.();
		this.unregisterToolbar = null;
		this.unmountAll();
		clearWarmReaderDecks();
	}

	syncPref(): void {
		if (!this.active) return;
		if (!this.isEnabled()) { this.unmountAll(); return; }
		this.pruneClosedSlots();
		for (const slot of this.slots.values()) {
			slot.dirty = true;
			this.refreshSlot(slot);
		}
		this.scanOpenReaders();
	}

	mountReaderToolbar(reader: any, doc: Document, append?: (...els: Element[]) => void): void {
		if (!this.active || !this.isEnabled() || !reader || !doc) return;
		this.pruneClosedSlots();
		const documentKey = getReaderDocument(reader) ?? doc;
		const existing = this.slots.get(documentKey);
		if (existing && existing.wrap.isConnected !== false) {
			existing.reader = reader;
			existing.dirty = true;
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

		const slot: ReaderSlot = { reader, doc, wrap, sectionWrap, btn, labelEl, parentID: 0, items: [], dirty: true };
		btn.addEventListener('click', (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			this.toggleMenu(slot);
		});
		this.slots.set(documentKey, slot);
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
		scanPendingReaders(
			this.pendingReaders,
			() => this.active && this.isEnabled(),
			(doc) => Boolean(doc.querySelector?.('.toolbar .custom-sections')),
			(reader, doc) => {
				if (this.slots.get(doc)?.wrap.isConnected) return;
				this.mountReaderToolbar(reader, doc);
			},
		);
	}

	private scheduleRefresh(delayMs: number): void {
		if (this.refreshTimer !== null) return;
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = null;
			if (this.active && this.isEnabled()) {
				this.pruneClosedSlots();
				const affected = this.changedIDs;
				for (const id of [...affected]) {
					try {
						const item = (globalThis as any).Zotero?.Items?.get?.(id);
						if (item?.parentItemID && (item.isAttachment?.() ?? Boolean(item.attachmentContentType))) affected.add(item.parentItemID);
					} catch { /* A deleted item can still match its previous reader slot. */ }
				}
				if (this.refreshAll || affected.size) for (const slot of this.slots.values()) {
					if (this.refreshAll || affected.has(slot.parentID) || affected.has(Number(slot.reader?.itemID))
						|| slot.items.some(item => affected.has(item.id))) {
						slot.dirty = true;
						this.refreshSlot(slot);
					}
				}
				if (this.scanRequested) this.scanOpenReaders();
			}
			this.resetPendingRefresh();
		}, delayMs);
	}

	private resetPendingRefresh(): void {
		this.scanRequested = false;
		this.refreshAll = false;
		this.changedIDs.clear();
	}

	private syncSlotVisibility(slot: ReaderSlot, hidden: boolean): void {
		slot.wrap.hidden = hidden;
		const sec = slot.sectionWrap || (slot.wrap.parentElement?.classList?.contains?.('section') ? slot.wrap.parentElement as HTMLDivElement : null);
		if (sec && sec.childElementCount <= 1) sec.hidden = hidden;
	}

	private refreshSlot(slot: ReaderSlot, force = false): void {
		if (!this.isEnabled()) { this.syncSlotVisibility(slot, true); return; }
		const attID = Number(slot.reader?.itemID || 0);
		if (force || slot.dirty || !slot.items.length) {
			const includeSnapshots = Boolean(this.kernel.prefs.get('workspace.readerSwitcherIncludeSnapshots'));
			const { parentID, items } = resolveSiblingAttachments(attID, includeSnapshots);
			slot.parentID = parentID;
			slot.items = items;
			slot.dirty = false;
		}
		if (!getEffectiveReaderTabID(slot.reader) || slot.items.length < 2) { this.syncSlotVisibility(slot, true); return; }
		const zh = Boolean((globalThis as any).Zotero?.locale?.startsWith?.('zh'));
		slot.labelEl.textContent = zh ? `共 ${slot.items.length} 个版本` : `${slot.items.length} versions`;
		slot.btn.title = zh
			? `切换当前文献的其他附件版本（共 ${slot.items.length} 个）`
			: `Switch attachment version (${slot.items.length} total)`;
		this.syncSlotVisibility(slot, false);
	}

	private warmAttachmentItem(itemID: number): void {
		if (!itemID || this.warmedAttachmentIDs.has(itemID)) return;
		this.warmedAttachmentIDs.add(itemID);
		if (this.warmedAttachmentIDs.size > 200) this.warmedAttachmentIDs.clear();
		const zotero = (globalThis as any).Zotero;
		const item = zotero?.Items?.get?.(itemID);
		if (!item) return;
		try {
			const lib = zotero?.Libraries?.get?.(item.libraryID);
			void lib?.waitForDataLoad?.('item')?.catch?.(() => {});
			void item.fileExists?.()?.catch?.(() => {});
			item.getAnnotations?.();
		} catch { /* best-effort read-only warmup */ }
	}

	private toggleMenu(slot: ReaderSlot): void {
		const hadMenu = Boolean(slot.doc.getElementById?.(READER_ATT_MENU_ID));
		this.closeMenu();
		if (hadMenu) return;
		this.refreshSlot(slot);
		if (slot.items.length < 2) return;
		const zh = Boolean((globalThis as any).Zotero?.locale?.startsWith?.('zh'));
		const curAttID = Number(slot.reader?.itemID || 0);
		const tabID = getEffectiveReaderTabID(slot.reader);
		const hostWin = resolveOwnerWindow(slot.reader);
		const openAttIDs = collectOpenAttIDs(slot.reader);
		const firstAlt = slot.items.find((i) => i.id !== curAttID && i.readerCapable && !openAttIDs.has(i.id));
		if (firstAlt && tabID) {
			this.warmAttachmentItem(firstAlt.id);
			void prestageAttachmentInReaderTab(hostWin, firstAlt.id, tabID);
		}
		const readerFrame = slot.reader?._iframe || (slot.doc.defaultView as any)?.frameElement || null;
		this.closeActiveMenu = openSiblingAttachmentMenu({
			doc: slot.doc,
			hostWin,
			readerFrame,
			anchorBtn: slot.btn,
			items: slot.items,
			currentAttID: curAttID,
			useFilename: this.kernel.prefs.get('workspace.readerSwitcherUseFilename'),
			openAttIDs,
			zh,
			onHover: (entry) => {
				if (!entry.readerCapable) return;
				this.warmAttachmentItem(entry.id);
				if (tabID && !openAttIDs.has(entry.id)) void prestageAttachmentInReaderTab(hostWin, entry.id, tabID);
			},
			onSelect: (entry) => {
				void this.switchToAttachment(slot.reader, slot.parentID, entry);
			},
			onClose: () => { this.closeActiveMenu = null; },
		});
	}

	async switchToAttachment(
		reader: any,
		parentID: number,
		target: SiblingAttachmentEntry,
	): Promise<boolean> {
		const currentAttID = Number(reader?.itemID || 0);
		if (!target?.readerCapable || target.id === currentAttID || !reader?.tabID) return false;
		const owner = resolveOwnerWindow(reader);
		const currentKey = `item:${currentAttID}`;
		const targetKey = `item:${target.id}`;
		const currentGroupId = this.store.groupOfKey(currentKey);
		const groupId = currentGroupId || (parentID > 0 ? this.store.groupOfKey(`item:${parentID}`) : '');
		const wasPinned = this.store.isPinned(currentKey);
		let handoffDone = false;
		const applyStoreHandoff = () => {
			if (handoffDone) return;
			handoffDone = true;
			const currentStillOpen = getHostTabs(owner).some((t) => Number(t?.data?.itemID || 0) === currentAttID);
			this.store.setSleeping(targetKey, false);
			this.store.removeVirtualMember(targetKey);
			if (groupId && !this.store.groupOfKey(targetKey)) {
				if (currentGroupId === groupId && !currentStillOpen) {
					this.store.assignKeyRelative(targetKey, groupId, currentKey, true);
					this.store.assignToGroup(currentKey, null);
					this.store.removeVirtualMember(currentKey);
				} else {
					this.store.assignToGroup(targetKey, groupId);
				}
			}
			if (wasPinned && !currentStillOpen) {
				this.store.setPinned(targetKey, true);
				this.store.setPinned(currentKey, false);
			}
		};
		const tabID = String(reader.tabID);
		if (!await showAttachmentInReaderTab(owner, target.id, tabID, undefined, applyStoreHandoff, { keepWarm: true })) return false;
		applyStoreHandoff();
		this.pruneClosedSlots();
		const activeDoc = getReaderDocument((globalThis as any).Zotero?.Reader?.getByTabID?.(tabID));
		const activeSlot = activeDoc ? this.slots.get(activeDoc) : undefined;
		if (activeSlot) this.refreshSlot(activeSlot);
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
			if (slot.wrap.isConnected === false || !doc.defaultView || (doc.defaultView as any).closed || slot.reader?._isTabClosed) {
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
