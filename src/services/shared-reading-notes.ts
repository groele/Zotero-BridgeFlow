import type { Disposable } from '../kernel/types.ts';
import type { TabReadingProgress } from './reading-stats.ts';

export type ReadingNotesChangeKind = 'reading' | 'notes' | 'notes-local-clear' | 'import';

export interface ReadingNotesChangeEvent {
	readonly kind: ReadingNotesChangeKind;
	readonly changedItemIDs?: ReadonlySet<number>;
	readonly syncExtraEntries?: ReadonlyArray<{ readonly itemID: number; readonly remark: string }>;
}

export interface SharedReadingNotesFacade {
	getReadingProgress(itemID: number): TabReadingProgress | undefined;
	getRemark(itemID: number): string;
	setRemark(itemID: number, remark: string, skipExtraSync?: boolean): void;
	persistRemarks(): Promise<boolean>;
	subscribe(listener: (ev: ReadingNotesChangeEvent) => void): Disposable;
	refreshWorkspaceViews(): void;
}

export type RawWorkspaceStoreChange = 'layout' | 'notes' | 'session' | 'reading' | 'notes-local-clear' | 'import';

export interface ReadingNotesStoreSource {
	getReadingProgress(itemID: number): TabReadingProgress | undefined;
	getItemRemark(itemID: number): string;
	setItemRemark(itemID: number, remark: string, silent?: boolean): void;
	notifyNotesChanged(): void;
	persistBriefNotes(): Promise<boolean>;
	getRemarksSnapshot(): Readonly<Record<string, string>>;
	resolveRemarkTargetItemID(key: string): number;
	onChange(listener: (change: RawWorkspaceStoreChange) => void): Disposable;
}

export interface RemarkDiffResult {
	readonly changedItemIDs: ReadonlySet<number>;
	readonly syncExtraEntries: ReadonlyArray<{ readonly itemID: number; readonly remark: string }>;
}

export function diffRemarksSnapshot(
	prevRemarks: ReadonlyMap<string, string>,
	currentRemarks: Readonly<Record<string, string>>,
	resolveTargetItemID: (key: string) => number,
): RemarkDiffResult {
	const changedKeys: Array<{ key: string; value: string }> = [];
	for (const [k, v] of Object.entries(currentRemarks)) {
		if (prevRemarks.get(k) !== v) changedKeys.push({ key: k, value: v });
	}
	for (const k of prevRemarks.keys()) {
		if (!(k in currentRemarks)) changedKeys.push({ key: k, value: '' });
	}
	const changedItemIDs = new Set<number>();
	const syncExtraEntries: Array<{ itemID: number; remark: string }> = [];
	for (const entry of changedKeys) {
		const itemID = resolveTargetItemID(entry.key);
		if (itemID > 0) {
			changedItemIDs.add(itemID);
			syncExtraEntries.push({ itemID, remark: entry.value });
		}
	}
	return { changedItemIDs, syncExtraEntries };
}

export function createWorkspaceReadingNotesFacade(
	store: ReadingNotesStoreSource,
	onRefreshWorkspace: () => void,
): SharedReadingNotesFacade {
	const prevRemarks = new Map<string, string>();
	const listeners = new Set<(ev: ReadingNotesChangeEvent) => void>();
	let disposeStore: Disposable | null = null;

	const seedRemarks = (): void => {
		prevRemarks.clear();
		for (const [k, v] of Object.entries(store.getRemarksSnapshot())) {
			prevRemarks.set(k, v);
		}
	};

	const emit = (ev: ReadingNotesChangeEvent): void => {
		for (const listener of listeners) {
			try { listener(ev); } catch { /* isolate subscribers */ }
		}
	};

	const ensureSubscribed = (): void => {
		if (disposeStore) return;
		seedRemarks();
		disposeStore = store.onChange((change) => {
			if (change === 'session' || change === 'layout') return;
			if (change === 'reading') {
				emit({ kind: 'reading' });
				return;
			}
			if (change === 'notes-local-clear' || change === 'import') {
				seedRemarks();
				emit({ kind: change });
				return;
			}
			const current = store.getRemarksSnapshot();
			const diff = diffRemarksSnapshot(prevRemarks, current, (key) => store.resolveRemarkTargetItemID(key));
			if (diff.changedItemIDs.size > 0 || diff.syncExtraEntries.length > 0) {
				seedRemarks();
			}
			emit({
				kind: 'notes',
				changedItemIDs: diff.changedItemIDs,
				syncExtraEntries: diff.syncExtraEntries,
			});
		});
	};

	const releaseIfEmpty = (): void => {
		if (listeners.size === 0 && disposeStore) {
			disposeStore();
			disposeStore = null;
		}
	};

	return {
		getReadingProgress: (itemID) => store.getReadingProgress(itemID),
		getRemark: (itemID) => store.getItemRemark(itemID),
		setRemark: (itemID, remark, skipExtraSync) => {
			if (skipExtraSync) {
				store.setItemRemark(itemID, remark, true);
				seedRemarks();
				store.notifyNotesChanged();
			} else {
				store.setItemRemark(itemID, remark);
			}
		},
		persistRemarks: () => store.persistBriefNotes(),
		subscribe: (listener) => {
			listeners.add(listener);
			ensureSubscribed();
			return () => {
				listeners.delete(listener);
				releaseIfEmpty();
			};
		},
		refreshWorkspaceViews: () => onRefreshWorkspace(),
	};
}

export interface ReadingNotesFacadeProvider {
	getReadingNotesFacade?(): SharedReadingNotesFacade;
	refreshAllWindows?(): void;
	readonly store?: Partial<ReadingNotesStoreSource>;
}

/**
 * Resolves a SharedReadingNotesFacade from a workspace module (or minimal test double).
 */
export function resolveReadingNotesFacade(provider: ReadingNotesFacadeProvider): SharedReadingNotesFacade {
	if (typeof provider.getReadingNotesFacade === 'function') {
		return provider.getReadingNotesFacade();
	}
	const rawStore = provider.store as any;
	const source: ReadingNotesStoreSource = {
		getReadingProgress: (itemID) => (
			typeof rawStore?.getReadingProgress === 'function'
				? rawStore.getReadingProgress(itemID)
				: rawStore?.state?.readingProgress?.[`item:${itemID}`]
		),
		getItemRemark: (itemID) => (typeof rawStore?.getItemRemark === 'function' ? rawStore.getItemRemark(itemID) : ''),
		setItemRemark: (itemID, remark, silent) => rawStore?.setItemRemark?.(itemID, remark, silent),
		notifyNotesChanged: () => rawStore?.notifyNotesChanged?.(),
		persistBriefNotes: () => (
			typeof rawStore?.persistBriefNotes === 'function'
				? rawStore.persistBriefNotes()
				: rawStore?.notesCache?.flushNow?.(rawStore.state) ?? Promise.resolve(false)
		),
		getRemarksSnapshot: () => (
			typeof rawStore?.getRemarksSnapshot === 'function'
				? rawStore.getRemarksSnapshot()
				: (rawStore?.state?.remarks ?? {})
		),
		resolveRemarkTargetItemID: (key) => {
			if (typeof rawStore?.resolveRemarkTargetItemID === 'function') {
				return rawStore.resolveRemarkTargetItemID(key);
			}
			const vm = rawStore?.state?.virtualMembers?.[key];
			const match = /^item:(\d+)$/.exec(key);
			return Number(vm?.parentItemID || vm?.itemID || (match ? match[1] : 0));
		},
		onChange: (listener) => (typeof rawStore?.onChange === 'function' ? rawStore.onChange(listener) : () => {}),
	};
	return createWorkspaceReadingNotesFacade(source, () => provider.refreshAllWindows?.());
}
