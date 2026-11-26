export type Disposable = () => void;

export interface PluginInfo {
	id: string;
	version: string;
	rootURI: string;
}

export interface OrphanCitationInfo {
	readonly key: string;
	readonly kind: 'trashed' | 'missing';
	readonly ordinal: number;
	readonly shortText: string;
	readonly title: string;
	readonly authorYear?: string;
	readonly itemID?: number;
	readonly uris?: readonly string[];
	readonly itemData?: Record<string, unknown>;
}

export interface CitationBadgeInfo {
	itemID: number;
	ordinal: number;
	occurrences?: number;
	shortText: string;
	documentName: string;
	sessionID: string;
}

export interface CitationSessionSummary {
	readonly sessionID: string;
	readonly documentName: string;
	readonly totalCitedCount: number;
	readonly byItemID: ReadonlyMap<number, CitationBadgeInfo>;
	readonly orphans?: readonly OrphanCitationInfo[];
}

export interface CitationSnapshotPayload {
	readonly activeSessionID: string | null;
	readonly activeDocumentName: string;
	readonly byItemID: ReadonlyMap<number, CitationBadgeInfo>;
	readonly citedItemIDs: readonly number[];
	readonly totalCitedCount: number;
	readonly sessions?: readonly CitationSessionSummary[];
	readonly orphans?: readonly OrphanCitationInfo[];
}

export interface WorkspaceGroupSummary {
	readonly groupId: string;
	readonly groupName: string;
	readonly itemIDs: readonly number[];
}

export interface CitationCopiedPayload {
	readonly itemIDs: readonly number[];
	readonly styleID: string;
	readonly html: string;
	readonly text: string;
	readonly source: 'preview' | 'tab-menu' | 'spotlight' | 'api';
}

export interface NotifierEventPayload {
	readonly event: string;
	readonly type: string;
	readonly ids: readonly (string | number)[];
	readonly extraData?: Record<string, unknown>;
}

export interface OpenItemRequestPayload {
	readonly itemID: number;
	readonly attachmentID?: number;
	readonly preferExistingTab?: boolean;
	readonly assignToActiveGroup?: boolean;
}

export interface ReaderNeighborRef {
	readonly tabID: string;
	readonly itemID: number;
	readonly parentItemID: number;
	readonly title: string;
}

export interface ReaderNeighborsPayload {
	readonly activeTabID: string;
	readonly left?: ReaderNeighborRef;
	readonly right?: ReaderNeighborRef;
}

export interface SpotlightItemResult {
	readonly id: string;
	readonly category: 'tab' | 'collection' | 'citation' | 'command';
	readonly title: string;
	readonly subtitle?: string;
	readonly badge?: string;
	readonly action: () => void | Promise<void>;
}

export interface SpotlightProvider {
	readonly id: string;
	readonly priority: number;
	query(term: string, win: Window, mode?: 'commands'): readonly SpotlightItemResult[];
}

export interface WordInsertResultPayload {
	readonly requestId?: string;
	readonly status: 'inserted' | 'busy' | 'non-word' | 'cancelled' | 'unavailable' | 'invalid-selection' | 'field-conflict' | 'uncertain-write';
	readonly documentName: string;
	readonly itemCount: number;
}

export interface WordRefreshResultPayload {
	readonly requestId?: string;
	readonly ok: boolean;
	readonly documentName: string;
}

export interface WordRecoverOrphansResultPayload {
	readonly requestId?: string;
	readonly restoredCount: number;
	readonly importedCount: number;
	readonly skippedCount: number;
	readonly ambiguousCount?: number;
	/** Orphans whose DOI or exact title+author+year already exists in the library, so no duplicate item was created. */
	readonly existingCount?: number;
	/** Orphans for which same-library `dc:replaces` relink relation was attached (for automatic Word refresh relinking). */
	readonly relinkedCount?: number;
	/** Orphans skipped from `dc:replaces` binding because the source URI belongs to another user/library. */
	readonly foreignSkippedCount?: number;
	/** Whether the active Word document was automatically refreshed right after recovery. */
	readonly refreshed?: boolean;
	/** Zotero item IDs of all restored, newly imported, or matched items for 1-click inspection. */
	readonly recoveredItemIDs?: readonly number[];
	readonly sessionID?: string;
	readonly collectionName?: string;
	readonly error?: string;
}

export interface BridgeFlowEventMap {
	'prefs:changed': { readonly key: string; readonly value: unknown };
	'notifier:event': NotifierEventPayload;
	'citation:snapshot-updated': CitationSnapshotPayload;
	'citation:copied': CitationCopiedPayload;
	'workspace:open-item-request': OpenItemRequestPayload;
	'workspace:groups-updated': { readonly groups: readonly WorkspaceGroupSummary[] };
	'workspace:groups-query': { readonly requester?: string };
	'workspace:reader-neighbors-updated': ReaderNeighborsPayload;
	'workspace:reader-neighbors-query': { readonly win?: Window };
	'visual-notes:open-matrix': { readonly win: Window; readonly title: string; readonly itemIDs: readonly number[] };
	'visual-notes:open-hub': { readonly win: Window; readonly initialTab?: 'annotations' | 'notes' };
	'visual-notes:toggle-gallery': { readonly win: Window; readonly mode?: 'gallery' | 'board' };
	'word:insert-items-request': { readonly itemIDs: readonly number[]; readonly win?: Window; readonly requestId?: string };
	'word:insert-result': WordInsertResultPayload;
	'word:refresh-request': { readonly sessionID?: string; readonly requestId?: string; readonly win?: Window };
	'word:refresh-result': WordRefreshResultPayload;
	'word:snapshot-query': { readonly requester?: string };
	'word:switch-session-request': { readonly sessionID: string };
	'word:select-collection-request': { readonly sessionID?: string; readonly win?: Window };
	'word:recover-orphans-request': { readonly sessionID?: string; readonly keys?: readonly string[]; readonly requestId?: string; readonly source?: 'panel' | 'spotlight'; readonly win?: Window };
	'word:recover-orphans-result': WordRecoverOrphansResultPayload;
	'inspector:lookup-clipboard': { readonly win?: Window };
	'inspector:clear-cache': { readonly target: 'memory' | 'disk' | 'all' };
}

export type BridgeFlowEventName = keyof BridgeFlowEventMap;

export type DomainId = 'workspace' | 'inspector' | 'word-cite' | 'visual-notes';

export interface DomainModule {
	readonly id: DomainId;
	readonly enabledPref: string;
	start(): void | Promise<void>;
	stop(): void;
	onMainWindowLoad?(win: Window): void;
	onMainWindowUnload?(win: Window): void;
	isActive(): boolean;
}

export interface BridgeModule {
	readonly id: string;
	readonly requires?: readonly DomainId[];
	start(): void;
	stop(): void;
}
