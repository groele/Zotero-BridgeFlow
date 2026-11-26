import { probeHostCapabilities } from './host-capabilities.ts';

const pendingReaderNavigation = new WeakSet<object>();
const SWAP_KEEP_ATTR = 'data-zbf-swap-keep';
const SAFE_TAB_ID_RE = /^[a-zA-Z0-9_-]+$/;

function stageInPlaceSwapStyle(
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

async function waitForReaderView(opened: any): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const ready = async () => {
			await opened._initPromise;
			await opened._waitForReader?.();
			await opened._internalReader?._primaryView?.initializedPromise;
		};
		await Promise.race([ready(), new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error('Replacement reader did not become ready')), 15_000);
		})]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

function disposeReaderInstance(readerApi: any, instance: any): void {
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
		// Neutralize residual tab-content listeners bound to the replaced ReaderTab instance.
		instance._internalReader = null;
		instance._iframe = null;
		instance._iframeWindow = null;
		instance._popupset = null;
		instance.setBottomPlaceholderHeight = () => Promise.resolve();
		instance.setContextPaneOpen = () => Promise.resolve();
		instance._updateLayout = () => {};
	} catch { /* ignore */ }
}

async function syncContextPaneForTab(
	owner: Window,
	zotero: any,
	tabID: string,
	itemID: number,
	tabType: string,
): Promise<void> {
	const contextPane = (owner as any).ZoteroContextPane?.context;
	if (!contextPane?._getItemContext) return;
	const itemDetails = contextPane._getItemContext(tabID);
	if (!itemDetails) return;
	const item = zotero?.Items?.get?.(itemID);
	const nextTargetID = item?.isNote?.() ? itemID : Number(item?.parentID || item?.parentItemID || itemID);
	const prevTargetID = Number(itemDetails?.item?.id || itemDetails?.parentID || 0);
	if (nextTargetID > 0 && prevTargetID !== nextTargetID) {
		try {
			contextPane._removeItemContext?.(tabID);
			await contextPane._addItemContext?.(tabID, itemID, tabType);
		} catch { /* ignore */ }
	}
}

async function openReaderWithFallback(
	reader: any,
	tabs: any,
	sourceTab: any,
	prevOnClose: unknown,
	tabID: string,
	itemID: number,
	location?: { pageIndex: number },
): Promise<any> {
	try {
		return await reader.open(itemID, location, {
			tabID,
			openInWindow: false,
			openInBackground: true,
			preventJumpback: true,
			allowDuplicate: true,
		});
	} catch (inPlaceError) {
		if (typeof tabs.close !== 'function') throw inPlaceError;
		// Degrade cleanly if a future host rejects the tabID option before creating a reader.
		sourceTab.onClose = prevOnClose;
		return await reader.open(itemID, location, {
			openInWindow: false,
			openInBackground: true,
			preventJumpback: true,
			allowDuplicate: true,
		});
	}
}

async function replaceAttachmentInCurrentTab(
	owner: Window,
	zotero: any,
	tabs: any,
	reader: any,
	sourceTab: any,
	itemID: number,
	location?: { pageIndex: number },
	onCommit?: () => void,
): Promise<boolean> {
	const tabID = String(sourceTab.id);
	const hasDomLookup = typeof owner.document?.getElementById === 'function';
	const tabContainer = hasDomLookup ? (owner.document.getElementById(tabID) ?? null) : null;
	const oldReader = reader.getByTabID?.(tabID) ?? null;
	const prevOnClose = sourceTab.onClose;
	const cleanupStaging = stageInPlaceSwapStyle(owner, tabID, tabContainer, oldReader?._iframe ?? null);
	let stagedReader: any = null;
	let fallbackTabID: string | undefined;
	try {
		// Detach previous onClose before ReaderTab wraps it, avoiding unbounded closure chains.
		sourceTab.onClose = undefined;
		const opened = await openReaderWithFallback(reader, tabs, sourceTab, prevOnClose, tabID, itemID, location);
		if (!opened?.tabID || (opened._window && opened._window !== owner)) {
			sourceTab.onClose = prevOnClose;
			if (opened && opened !== oldReader) disposeReaderInstance(reader, opened);
			return false;
		}
		if (opened.tabID !== tabID) {
			sourceTab.onClose = prevOnClose;
			fallbackTabID = opened.tabID;
			await waitForReaderView(opened);
			if (tabs.selectedID && tabs.selectedID !== tabID) return false;
			tabs.select?.(fallbackTabID, true);
			if (tabs._tabs?.some((row: { id: string }) => row.id === tabID)) tabs.close?.(tabID);
			fallbackTabID = undefined;
			onCommit?.();
			return true;
		}
		stagedReader = opened;
		const nextOnClose = sourceTab.onClose;
		sourceTab.onClose = () => {
			prevOnClose?.call(sourceTab);
			nextOnClose?.call(sourceTab);
		};
		await waitForReaderView(opened);
		const stillExists = Array.isArray(tabs._tabs) && tabs._tabs.some((row: { id: string }) => row.id === tabID);
		if (!stillExists) return false;

		sourceTab.onClose = nextOnClose;
		if (oldReader && oldReader !== opened) disposeReaderInstance(reader, oldReader);
		cleanupStaging();
		stagedReader = null;

		sourceTab.type = 'reader';
		sourceTab.data = { ...(sourceTab.data || {}), itemID };
		delete sourceTab.data.icon;
		delete sourceTab.data.secondViewState;
		delete sourceTab.audioStatus;
		onCommit?.();

		if (typeof tabs.rename === 'function') await tabs.rename(tabID);
		else tabs._update?.();
		zotero?.Session?.debounceSave?.();
		await syncContextPaneForTab(owner, zotero, tabID, itemID, sourceTab.type);

		if (!tabs.selectedID || tabs.selectedID === tabID) {
			zotero?.Notifier?.trigger?.('select', 'tab', [tabID], { [tabID]: { type: sourceTab.type } }, true);
			opened._updateLayout?.();
			(owner as any).ZoteroContextPane?.update?.();
			void opened.focus?.();
		} else {
			opened._updateDocShellActivity?.();
		}
		return true;
	} catch (error) {
		sourceTab.onClose = prevOnClose;
		zotero?.logError?.(error);
		return false;
	} finally {
		try {
			if (stagedReader && stagedReader !== oldReader) disposeReaderInstance(reader, stagedReader);
			if (fallbackTabID && tabs._tabs?.some((row: { id: string }) => row.id === fallbackTabID)) tabs.close?.(fallbackTabID);
		} finally {
			cleanupStaging();
		}
	}
}

/** Open a native reader tab in the action's Zotero window, or swap in-place inside the current tab without creating a new tab. */
export async function showAttachmentInReaderTab(
	win: Window | null | undefined,
	itemID: number,
	replaceTabID?: string,
	location?: { pageIndex: number },
	onCommit?: () => void,
): Promise<boolean> {
	const zotero = (globalThis as any).Zotero;
	const main = zotero?.getMainWindow?.();
	const owner = win ?? main;
	const tabs = (owner as any)?.Zotero_Tabs;
	const reader = zotero?.Reader;
	if (!tabs || !reader?.open || (main && main !== owner) || pendingReaderNavigation.has(tabs)) return false;

	const rows: any[] = tabs._tabs ?? [];
	const sourceIndex = replaceTabID ? rows.findIndex((row) => row.id === replaceTabID) : -1;
	if (replaceTabID && sourceIndex < 0) return false;
	const existing = rows.find((row) => Number(row.data?.itemID) === itemID);
	pendingReaderNavigation.add(tabs);
	try {
		if (existing) {
			const loaded = reader.getByTabID?.(existing.id);
			if (loaded) {
				if (location) await loaded.navigate(location);
				if (tabs.selectedID !== existing.id) tabs.select(existing.id);
			} else {
				// Let the native tab loader apply the location when waking an unloaded tab.
				await tabs.select(existing.id, false, { location });
				await reader.getByTabID?.(existing.id)?._waitForReader?.();
			}
			if (replaceTabID && replaceTabID !== existing.id) {
				const sourceStillOpen = tabs._tabs?.some((row: { id: string }) => row.id === replaceTabID);
				if (sourceStillOpen) {
					tabs.move?.(existing.id, sourceIndex + 1);
					tabs.close(replaceTabID);
				}
			}
			onCommit?.();
			return true;
		}
		if (replaceTabID) {
			return await replaceAttachmentInCurrentTab(owner, zotero, tabs, reader, rows[sourceIndex], itemID, location, onCommit);
		}
		const opened = await reader.open(itemID, location, {
			openInWindow: false,
			allowDuplicate: true,
		});
		if (!opened?.tabID || (opened._window && opened._window !== owner)) return false;
		await opened._waitForReader?.();
		onCommit?.();
		return true;
	} catch (error) {
		zotero?.logError?.(error);
		return false;
	} finally {
		pendingReaderNavigation.delete(tabs);
	}
}

export const ReaderTabAdapter = {
	showAttachmentInReaderTab,
	canSwapInPlace(win?: Window | null): boolean {
		return probeHostCapabilities(win).capabilities.readerInPlaceSwap.available;
	},
} as const;
