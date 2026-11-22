export type Disposable = () => void;

export interface PluginInfo {
	id: string;
	version: string;
	rootURI: string;
}

export interface CitationBadgeInfo {
	itemID: number;
	ordinal: number;
	shortText: string;
	documentName: string;
	sessionID: string;
}

export interface CitationSnapshotPayload {
	readonly activeSessionID: string | null;
	readonly activeDocumentName: string;
	readonly byItemID: ReadonlyMap<number, CitationBadgeInfo>;
	readonly citedItemIDs: readonly number[];
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
	query(term: string, win: Window): readonly SpotlightItemResult[];
}

export interface BridgeFlowEventMap {
	'prefs:changed': { readonly key: string; readonly value: unknown };
	'notifier:event': NotifierEventPayload;
	'citation:snapshot-updated': CitationSnapshotPayload;
	'citation:copied': CitationCopiedPayload;
	'workspace:tabs-updated': { readonly windowCount: number; readonly openItemIDs: readonly number[] };
	'workspace:open-item-request': OpenItemRequestPayload;
	'inspector:lookup-clipboard': { readonly win?: Window };
	'inspector:clear-cache': { readonly target: 'memory' | 'disk' | 'all' };
}

export type BridgeFlowEventName = keyof BridgeFlowEventMap;

export interface DomainModule {
	readonly id: 'workspace' | 'inspector' | 'word-cite';
	readonly enabledPref: string;
	start(): void | Promise<void>;
	stop(): void;
	onMainWindowLoad?(win: Window): void;
	onMainWindowUnload?(win: Window): void;
	isActive(): boolean;
}

export interface BridgeModule {
	readonly id: string;
	start(): void;
	stop(): void;
}
