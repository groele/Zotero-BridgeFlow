import { probeHostCapabilities } from './host-capabilities.ts';
import {
	activateWarmReaderFromDeck, claimWarmOrPrestagingReader, clearWarmReaderDecks, disposeReaderInstance,
	evictTabDeck, getExistingTabDeck, getOrCreateTabDeck, parkReaderInDeck,
	setReaderDomVisibility, stageInPlaceSwapStyle, waitForReaderReady,
} from './reader-tab-deck.ts';

export { clearWarmReaderDecks };

export interface ReaderSwapOptions { keepWarm?: boolean; }

const pendingReaderNavigation = new WeakSet<object>();

async function syncContextPaneForTab(owner: Window, zotero: any, tabID: string, itemID: number, tabType: string): Promise<void> {
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
		sourceTab.onClose = prevOnClose;
		return await reader.open(itemID, location, {
			openInWindow: false,
			openInBackground: true,
			preventJumpback: true,
			allowDuplicate: true,
		});
	}
}

async function finalizeTabSwapCommit(
	owner: Window,
	zotero: any,
	tabs: any,
	sourceTab: any,
	activeReader: any,
	tabID: string,
	itemID: number,
	location?: { pageIndex: number },
	onCommit?: () => void,
): Promise<void> {
	sourceTab.type = 'reader';
	sourceTab.data = { ...(sourceTab.data || {}), itemID };
	delete sourceTab.data.icon;
	delete sourceTab.data.secondViewState;
	delete sourceTab.audioStatus;
	onCommit?.();

	if (location) {
		try { void activeReader.navigate?.(location); } catch { /* ignore */ }
	}
	if (!tabs.selectedID || tabs.selectedID === tabID) {
		zotero?.Notifier?.trigger?.('select', 'tab', [tabID], { [tabID]: { type: sourceTab.type } }, true);
		try { activeReader._updateLayout?.(); } catch { /* ignore */ }
		(owner as any).ZoteroContextPane?.update?.();
		try { void activeReader.focus?.(); } catch { /* ignore */ }
	} else {
		try { activeReader._updateDocShellActivity?.(); } catch { /* ignore */ }
	}
	zotero?.Session?.debounceSave?.();

	await Promise.all([
		typeof tabs.rename === 'function' ? Promise.resolve(tabs.rename(tabID)) : Promise.resolve(tabs._update?.()),
		syncContextPaneForTab(owner, zotero, tabID, itemID, sourceTab.type),
	]);
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
	keepWarm = false,
): Promise<boolean> {
	const tabID = String(sourceTab.id);
	const oldReader = reader.getByTabID?.(tabID) ?? null;

	// Fast path: instant <3ms swap if target sibling reader is already warm-parked or pre-staging in this tab.
	const existingDeck = keepWarm
		? getOrCreateTabDeck(sourceTab, reader, oldReader)
		: getExistingTabDeck(sourceTab);
	if (!keepWarm && existingDeck) evictTabDeck(sourceTab);

	if (keepWarm && existingDeck) {
		const warmReader = await claimWarmOrPrestagingReader(existingDeck, itemID, zotero);
		if (warmReader) {
			const stillExists = Array.isArray(tabs._tabs) && tabs._tabs.some((row: { id: string }) => row.id === tabID);
			if (!stillExists) {
				disposeReaderInstance(reader, warmReader);
				return false;
			}
			if (oldReader && oldReader !== warmReader) {
				parkReaderInDeck(existingDeck, oldReader, zotero);
			}
			activateWarmReaderFromDeck(existingDeck, warmReader);
			await finalizeTabSwapCommit(owner, zotero, tabs, sourceTab, warmReader, tabID, itemID, location, onCommit);
			return true;
		}
	}

	const hasDomLookup = typeof owner.document?.getElementById === 'function';
	const tabContainer = hasDomLookup ? (owner.document.getElementById(tabID) ?? null) : null;
	const prevOnClose = sourceTab.onClose;
	const cleanupStaging = stageInPlaceSwapStyle(owner, tabID, tabContainer, oldReader?._iframe ?? null);
	let stagedReader: any = null;
	let fallbackTabID: string | undefined;
	try {
		if (oldReader?._readAloudPlaying) {
			try { oldReader.toggleReadAloudPaused?.(true); } catch { /* ignore */ }
		}
		sourceTab.onClose = undefined;
		const opened = await openReaderWithFallback(reader, tabs, sourceTab, prevOnClose, tabID, itemID, location);
		if (!opened?.tabID || (opened._window && opened._window !== owner)) {
			sourceTab.onClose = keepWarm && existingDeck ? existingDeck.deckOnClose : prevOnClose;
			if (opened && opened !== oldReader) disposeReaderInstance(reader, opened);
			return false;
		}
		if (opened.tabID !== tabID) {
			sourceTab.onClose = keepWarm && existingDeck ? existingDeck.deckOnClose : prevOnClose;
			fallbackTabID = opened.tabID;
			await waitForReaderReady(opened);
			if (tabs.selectedID && tabs.selectedID !== tabID) return false;
			evictTabDeck(sourceTab);
			tabs.select?.(fallbackTabID, true);
			if (tabs._tabs?.some((row: { id: string }) => row.id === tabID)) tabs.close?.(tabID);
			fallbackTabID = undefined;
			onCommit?.();
			return true;
		}
		stagedReader = opened;
		const nextOnClose = sourceTab.onClose;
		sourceTab.onClose = keepWarm && existingDeck
			? existingDeck.deckOnClose
			: () => {
				prevOnClose?.call(sourceTab);
				nextOnClose?.call(sourceTab);
			};
		await waitForReaderReady(opened);
		const stillExists = Array.isArray(tabs._tabs) && tabs._tabs.some((row: { id: string }) => row.id === tabID);
		if (!stillExists) return false;

		if (keepWarm && existingDeck) {
			if (oldReader && oldReader !== opened) parkReaderInDeck(existingDeck, oldReader, zotero);
			activateWarmReaderFromDeck(existingDeck, opened);
		} else {
			sourceTab.onClose = nextOnClose;
			if (oldReader && oldReader !== opened) disposeReaderInstance(reader, oldReader);
		}
		cleanupStaging();
		stagedReader = null;

		await finalizeTabSwapCommit(owner, zotero, tabs, sourceTab, opened, tabID, itemID, undefined, onCommit);
		return true;
	} catch (error) {
		sourceTab.onClose = keepWarm && existingDeck ? existingDeck.deckOnClose : prevOnClose;
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

/** Pre-stage a sibling attachment invisibly inside the current tab so subsequent switch is instant (<3ms). */
export function prestageAttachmentInReaderTab(
	win: Window | null | undefined,
	itemID: number,
	tabID: string,
): Promise<boolean> {
	const zotero = (globalThis as any).Zotero;
	const main = zotero?.getMainWindow?.();
	const owner = win ?? main;
	const tabs = (owner as any)?.Zotero_Tabs;
	const reader = zotero?.Reader;
	if (!tabs || !reader?.open || !itemID || !tabID || (main && main !== owner) || pendingReaderNavigation.has(tabs)) {
		return Promise.resolve(false);
	}
	const rows: any[] = tabs._tabs ?? [];
	if (rows.some((row) => Number(row.data?.itemID) === itemID)) return Promise.resolve(false);
	const sourceTab = rows.find((row) => row.id === tabID);
	const activeReader = reader.getByTabID?.(tabID);
	if (!sourceTab || !activeReader?._iframe || typeof owner?.document?.getElementById !== 'function') {
		return Promise.resolve(false);
	}
	const tabContainer = owner.document.getElementById(tabID);
	if (!tabContainer) return Promise.resolve(false);

	const deck = getOrCreateTabDeck(sourceTab, reader, activeReader);
	if (deck.parked.has(itemID)) return Promise.resolve(true);
	const existingJob = deck.prestaging.get(itemID);
	if (existingJob) return existingJob.then(Boolean);

	const job = (async (): Promise<any | null> => {
		const cleanupStaging = stageInPlaceSwapStyle(owner, tabID, tabContainer, activeReader._iframe);
		let staged: any = null;
		try {
			sourceTab.onClose = undefined;
			staged = await reader.open(itemID, undefined, {
				tabID,
				openInWindow: false,
				openInBackground: true,
				preventJumpback: true,
				allowDuplicate: true,
			});
			sourceTab.onClose = deck.deckOnClose;
			if (!staged || staged.tabID !== tabID || (staged._window && staged._window !== owner)) {
				if (staged && staged !== activeReader) disposeReaderInstance(reader, staged);
				return null;
			}
			if (Array.isArray(reader._readers)) {
				const idx = reader._readers.indexOf(staged);
				if (idx >= 0) reader._readers.splice(idx, 1);
			}
			staged._zbfParkedTabID = tabID;
			staged.tabID = '';
			setReaderDomVisibility(staged, 'prestage');
			cleanupStaging();

			await waitForReaderReady(staged);
			const tabAlive = Array.isArray(tabs._tabs) && tabs._tabs.some((r: { id: string }) => r.id === tabID);
			if (!tabAlive || staged._isTabClosed || staged._isUninitialized) {
				disposeReaderInstance(reader, staged);
				return null;
			}
			if (deck.claimedPrestageIDs.has(itemID)) return staged;
			return parkReaderInDeck(deck, staged, zotero) ? staged : null;
		} catch {
			sourceTab.onClose = deck.deckOnClose;
			if (staged && staged !== activeReader) disposeReaderInstance(reader, staged);
			return null;
		} finally {
			cleanupStaging();
			deck.prestaging.delete(itemID);
		}
	})();

	deck.prestaging.set(itemID, job);
	return job.then(Boolean);
}

/** Open a native reader tab in the action's Zotero window, or swap in-place inside the current tab without creating a new tab. */
export async function showAttachmentInReaderTab(
	win: Window | null | undefined,
	itemID: number,
	replaceTabID?: string,
	location?: { pageIndex: number },
	onCommit?: () => void,
	options?: ReaderSwapOptions,
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
				if (tabs.selectedID !== existing.id) tabs.select(existing.id);
				if (location) void loaded.navigate(location);
			} else {
				await tabs.select(existing.id, false, { location });
				await reader.getByTabID?.(existing.id)?._waitForReader?.();
			}
			if (replaceTabID && replaceTabID !== existing.id) {
				const sourceStillOpen = tabs._tabs?.some((row: { id: string }) => row.id === replaceTabID);
				if (sourceStillOpen) {
					evictTabDeck(rows[sourceIndex]);
					tabs.move?.(existing.id, sourceIndex + 1);
					tabs.close(replaceTabID);
				}
			}
			onCommit?.();
			return true;
		}
		if (replaceTabID) {
			return await replaceAttachmentInCurrentTab(
				owner, zotero, tabs, reader, rows[sourceIndex], itemID, location, onCommit, Boolean(options?.keepWarm),
			);
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
	prestageAttachmentInReaderTab,
	clearWarmReaderDecks,
	canSwapInPlace(win?: Window | null): boolean {
		return probeHostCapabilities(win).capabilities.readerInPlaceSwap.available;
	},
} as const;
