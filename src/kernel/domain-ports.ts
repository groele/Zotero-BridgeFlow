import type {
	CitationBadgeInfo,
	CitationSnapshotPayload,
	Disposable,
	OpenItemRequestPayload,
	ReaderNeighborsPayload,
	SpotlightProvider,
	WordInsertResultPayload,
	WordRecoverOrphansResultPayload,
	WordRefreshResultPayload,
	WorkspaceGroupSummary,
} from './types.ts';

export interface WorkspacePort {
	focusOrOpenItem(req: OpenItemRequestPayload, preferredWin?: Window): Promise<'focused' | 'opened' | 'not-found'>;
	groupOpenTabsByItemIDs(groupName: string, itemIDs: readonly number[], preferredWin?: Window): { groupId: string; count: number } | null;
	setCitationBadges(badges: ReadonlyMap<number, CitationBadgeInfo>): void;
	getGroupSummaries(): readonly WorkspaceGroupSummary[];
	getReaderNeighbors(win?: Window): ReaderNeighborsPayload | null;
	registerSpotlightProvider(provider: SpotlightProvider): Disposable;
}

export interface WordCitePort {
	getSnapshot(): CitationSnapshotPayload | null;
	citeCurrentSelection(win?: Window): Promise<void>;
	insertItems(itemIDs: readonly number[], win?: Window, requestId?: string): Promise<WordInsertResultPayload>;
	refreshActiveDocument(sessionID?: string, requestId?: string): Promise<WordRefreshResultPayload>;
	switchSession(sessionID: string): void;
	selectCollection(sessionID?: string, win?: Window): void;
	recoverOrphans(opts: {
		sessionID?: string;
		keys?: readonly string[];
		requestId?: string;
		source?: 'panel' | 'spotlight';
		win?: Window;
	}): Promise<WordRecoverOrphansResultPayload>;
}

export interface VisualNotesPort {
	openMatrix(win: Window, title: string, itemIDs: readonly number[]): void;
	openHub(win: Window, initialTab?: 'annotations' | 'notes'): void;
	toggleGallery(win: Window, mode?: 'gallery' | 'board'): void;
	refreshLibraryViews(affectedIDs?: Iterable<number>, readingOnly?: boolean): void;
}

export interface InspectorPort {
	clearCache(target: 'memory' | 'disk' | 'all'): void;
}

export interface DomainPortMap {
	workspace: WorkspacePort;
	'word-cite': WordCitePort;
	'visual-notes': VisualNotesPort;
	inspector: InspectorPort;
}

export type DomainPortId = keyof DomainPortMap;

export class DomainPortRegistry {
	private readonly ports = new Map<DomainPortId, DomainPortMap[DomainPortId]>();

	register<K extends DomainPortId>(id: K, port: DomainPortMap[K]): Disposable {
		this.ports.set(id, port);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			if (this.ports.get(id) === port) this.ports.delete(id);
		};
	}

	get<K extends DomainPortId>(id: K): DomainPortMap[K] | undefined {
		return this.ports.get(id) as DomainPortMap[K] | undefined;
	}

	has(id: DomainPortId): boolean {
		return this.ports.has(id);
	}

	clear(): void {
		this.ports.clear();
	}
}
