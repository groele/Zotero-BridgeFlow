export {
	formatCapabilitiesSummary,
	probeHostCapabilities,
	type HostCapabilitiesSnapshot,
	type HostCapabilityId,
	type HostCapabilityStatus,
} from './host-capabilities.ts';

export {
	findHostTab,
	getEffectiveReaderTabID,
	getHostReaders,
	getHostRecentlyClosedTabs,
	getHostTabs,
	getReaderDocument,
	getReaderPrimaryDocument,
	getReaderPrimaryWindow,
	isHostTabBusy,
	isReaderClosedOrUninitialized,
	openAttachmentReaderTab,
	readReaderPageMetricsByTabID,
	resolveActivePaneLibraryID,
	resolveReaderOwnerWindow,
	scanPendingReaders,
	type HostTabRecord,
} from './host-queries.ts';
export {
	clearWarmReaderDecks,
	prestageAttachmentInReaderTab,
	ReaderTabAdapter,
	showAttachmentInReaderTab,
	type ReaderSwapOptions,
} from './reader-tab-adapter.ts';

export {
	patchCollectionsViewHooks,
	patchItemsViewRenderCell,
	type CollectionsViewHooks,
	type HostTreeMethod,
	type HostTreeMethodWrapper,
} from './tree-view-adapter.ts';
