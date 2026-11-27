const MAX_PARKED_PER_TAB = 2;
const SWAP_KEEP_ATTR = 'data-zbf-swap-keep';
const SAFE_TAB_ID_RE = /^[a-zA-Z0-9_-]+$/;

export interface ParkedReaderEntry {
	reader: any;
	itemID: number;
	signature: string;
	parkedAt: number;
}

export interface TabReaderDeck {
	tabID: string;
	sourceTab: any;
	readerApi: any;
	baseOnClose: ((...args: any[]) => unknown) | undefined;
	deckOnClose: () => void;
	active: any | null;
	parked: Map<number, ParkedReaderEntry>;
	prestaging: Map<number, Promise<any | null>>;
	claimedPrestageIDs: Set<number>;
}

const decksBySourceTab = new WeakMap<object, TabReaderDeck>();
const liveDecks = new Set<TabReaderDeck>();

export function stageInPlaceSwapStyle(
	owner: Window,
	tabID: string,
	tabContainer: Element | null,
	oldIframe: Element | null,
): () => void {
	const kept: Element[] = [];
	const markKeep = (el: Element | null | undefined) => {
		if (!el || kept.includes(el)) return;
		el.setAttribute?.(SWAP_KEEP_ATTR, '1');
		kept.push(el);
	};
	markKeep(oldIframe);
	if (tabContainer?.querySelectorAll) {
		for (const node of Array.from(tabContainer.querySelectorAll('.reader'))) markKeep(node);
	}
	let style: HTMLStyleElement | undefined;
	if (kept.length > 0 && owner.document?.documentElement && SAFE_TAB_ID_RE.test(tabID)) {
		style = owner.document.createElementNS('http://www.w3.org/1999/xhtml', 'style') as HTMLStyleElement;
		style.textContent = `#${tabID}{position:relative!important}#${tabID}>.reader:not([${SWAP_KEEP_ATTR}="1"]){position:absolute!important;inset:0!important;width:100%!important;height:100%!important;visibility:hidden!important;pointer-events:none!important}`;
		owner.document.documentElement.appendChild(style);
	}
	return () => {
		style?.remove();
		for (const el of kept) {
			try { el.removeAttribute?.(SWAP_KEEP_ATTR); } catch { /* ignore */ }
		}
	};
}

export async function waitForReaderReady(opened: any): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const readyPromise = opened?._initPromise
			? Promise.resolve(opened._initPromise)
			: Promise.resolve(opened?._waitForReader?.());
		await Promise.race([readyPromise, new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error('Replacement reader did not become ready')), 15_000);
		})]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

export function disposeReaderInstance(readerApi: any, instance: any): void {
	if (!instance) return;
	if (Array.isArray(readerApi?._readers)) {
		const idx = readerApi._readers.indexOf(instance);
		if (idx >= 0) readerApi._readers.splice(idx, 1);
	}
	try {
		if (instance._readAloudPlaying) instance.toggleReadAloudPaused?.(true);
	} catch { /* ignore */ }
	try { instance._handleTabClose?.(); } catch { /* ignore */ }
	try { instance.uninit?.(); } catch { /* ignore */ }
	try { instance._iframe?.remove?.(); } catch { /* ignore */ }
	try { instance._popupset?.remove?.(); } catch { /* ignore */ }
	try {
		delete instance._zbfParkedTabID;
		instance._internalReader = null;
		instance._iframe = null;
		instance._iframeWindow = null;
		instance._popupset = null;
		instance.setBottomPlaceholderHeight = () => Promise.resolve();
		instance.setContextPaneOpen = () => Promise.resolve();
		instance._updateLayout = () => {};
	} catch { /* ignore */ }
}

export function computeAttachmentSignature(zotero: any, itemID: number): string | null {
	if (!itemID) return null;
	const item = zotero?.Items?.get?.(itemID);
	if (!item || item.deleted || item.isInTrash?.()) return null;
	const ver = Number(item.version ?? 0);
	let annSig = '';
	try {
		const anns = typeof item.getAnnotations === 'function' ? (item.getAnnotations() || []) : [];
		annSig = anns.map((a: any) => `${a?.id ?? 0}@${a?.version ?? 0}`).join(',');
	} catch { /* ignore non-file attachments */ }
	return `${itemID}:${ver}:${annSig}`;
}

export function setReaderDomVisibility(instance: any, mode: 'active' | 'prestage' | 'parked'): void {
	const iframe = instance?._iframe;
	const popupset = instance?._popupset;
	if (iframe) {
		if (mode === 'active') {
			iframe.hidden = false;
			if (iframe.style) {
				iframe.style.display = '';
				iframe.style.position = '';
				iframe.style.inset = '';
				iframe.style.visibility = '';
				iframe.style.pointerEvents = '';
			}
		} else if (mode === 'prestage') {
			iframe.hidden = false;
			if (iframe.style) {
				iframe.style.display = '';
				iframe.style.position = 'absolute';
				iframe.style.inset = '0';
				iframe.style.visibility = 'hidden';
				iframe.style.pointerEvents = 'none';
			}
			try { iframe.docShellIsActive = true; } catch { /* ignore */ }
		} else {
			iframe.hidden = true;
			if (iframe.style) {
				iframe.style.display = 'none';
				iframe.style.position = '';
				iframe.style.inset = '';
				iframe.style.visibility = '';
				iframe.style.pointerEvents = '';
			}
			try { iframe.docShellIsActive = false; } catch { /* ignore */ }
		}
	}
	if (popupset) popupset.hidden = mode !== 'active';
}

export function getOrCreateTabDeck(sourceTab: any, readerApi: any, currentActive: any): TabReaderDeck {
	const existing = decksBySourceTab.get(sourceTab);
	if (existing) {
		existing.readerApi = readerApi;
		if (currentActive) existing.active = currentActive;
		return existing;
	}
	const prevOnClose = sourceTab.onClose;
	const baseOnClose = prevOnClose && prevOnClose !== currentActive?._handleTabClose ? undefined : undefined;
	const deck: TabReaderDeck = {
		tabID: String(sourceTab.id),
		sourceTab,
		readerApi,
		baseOnClose,
		active: currentActive ?? null,
		parked: new Map(),
		prestaging: new Map(),
		claimedPrestageIDs: new Set(),
		deckOnClose: () => {
			liveDecks.delete(deck);
			decksBySourceTab.delete(sourceTab);
			for (const entry of deck.parked.values()) {
				disposeReaderInstance(deck.readerApi, entry.reader);
			}
			deck.parked.clear();
			deck.active?._handleTabClose?.();
			deck.active = null;
		},
	};
	sourceTab.onClose = deck.deckOnClose;
	decksBySourceTab.set(sourceTab, deck);
	liveDecks.add(deck);
	return deck;
}

export function getExistingTabDeck(sourceTab: any): TabReaderDeck | undefined {
	return sourceTab ? decksBySourceTab.get(sourceTab) : undefined;
}

export function evictTabDeck(sourceTab: any): void {
	const deck = sourceTab ? decksBySourceTab.get(sourceTab) : undefined;
	if (!deck) return;
	liveDecks.delete(deck);
	decksBySourceTab.delete(sourceTab);
	for (const entry of deck.parked.values()) {
		disposeReaderInstance(deck.readerApi, entry.reader);
	}
	deck.parked.clear();
}

export function clearWarmReaderDecks(): void {
	for (const deck of [...liveDecks]) {
		evictTabDeck(deck.sourceTab);
		if (deck.active && deck.sourceTab?.onClose === deck.deckOnClose) {
			const activeRef = deck.active;
			deck.sourceTab.onClose = () => activeRef._handleTabClose?.();
		}
	}
}

export function parkReaderInDeck(deck: TabReaderDeck, instance: any, zotero: any): boolean {
	if (!instance || !instance._iframe || instance._isTabClosed || instance._isUninitialized) {
		disposeReaderInstance(deck.readerApi, instance);
		return false;
	}
	const itemID = Number(instance.itemID || 0);
	const signature = computeAttachmentSignature(zotero, itemID);
	if (!signature) {
		disposeReaderInstance(deck.readerApi, instance);
		return false;
	}
	if (instance._readAloudPlaying) {
		try { instance.toggleReadAloudPaused?.(true); } catch { /* ignore */ }
	}
	if (Array.isArray(deck.readerApi?._readers)) {
		const idx = deck.readerApi._readers.indexOf(instance);
		if (idx >= 0) deck.readerApi._readers.splice(idx, 1);
	}
	instance._zbfParkedTabID = deck.tabID;
	instance.tabID = '';
	setReaderDomVisibility(instance, 'parked');

	const existing = deck.parked.get(itemID);
	if (existing && existing.reader !== instance) {
		disposeReaderInstance(deck.readerApi, existing.reader);
	}
	deck.parked.delete(itemID);
	while (deck.parked.size >= MAX_PARKED_PER_TAB) {
		const oldestKey = deck.parked.keys().next().value;
		if (oldestKey === undefined) break;
		const evicted = deck.parked.get(oldestKey);
		deck.parked.delete(oldestKey);
		if (evicted) disposeReaderInstance(deck.readerApi, evicted.reader);
	}
	deck.parked.set(itemID, { reader: instance, itemID, signature, parkedAt: Date.now() });
	return true;
}

export function activateWarmReaderFromDeck(deck: TabReaderDeck, instance: any): void {
	instance.tabID = deck.tabID;
	delete instance._zbfParkedTabID;
	if (Array.isArray(deck.readerApi?._readers) && !deck.readerApi._readers.includes(instance)) {
		deck.readerApi._readers.push(instance);
	}
	setReaderDomVisibility(instance, 'active');
	try {
		if (typeof deck.readerApi?._sidebarOpen === 'boolean') instance.setSidebarOpen?.(deck.readerApi._sidebarOpen);
		if (typeof deck.readerApi?._sidebarWidth === 'number') instance.setSidebarWidth?.(deck.readerApi._sidebarWidth);
	} catch { /* ignore */ }
	deck.active = instance;
	deck.sourceTab.onClose = deck.deckOnClose;
}

export async function claimWarmOrPrestagingReader(
	deck: TabReaderDeck,
	itemID: number,
	zotero: any,
): Promise<any | null> {
	const inFlight = deck.prestaging.get(itemID);
	if (inFlight) {
		deck.claimedPrestageIDs.add(itemID);
		const staged = await inFlight;
		deck.claimedPrestageIDs.delete(itemID);
		if (staged && !staged._isTabClosed && !staged._isUninitialized && computeAttachmentSignature(zotero, itemID)) {
			deck.parked.delete(itemID);
			activateWarmReaderFromDeck(deck, staged);
			return staged;
		}
		if (staged) disposeReaderInstance(deck.readerApi, staged);
	}
	const entry = deck.parked.get(itemID);
	if (!entry) return null;
	deck.parked.delete(itemID);
	const currentSig = computeAttachmentSignature(zotero, itemID);
	if (
		!currentSig
		|| currentSig !== entry.signature
		|| entry.reader._isTabClosed
		|| entry.reader._isUninitialized
		|| entry.reader._iframe?.isConnected === false
	) {
		disposeReaderInstance(deck.readerApi, entry.reader);
		return null;
	}
	activateWarmReaderFromDeck(deck, entry.reader);
	return entry.reader;
}
