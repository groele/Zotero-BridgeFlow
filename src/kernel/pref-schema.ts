export const PREF_PREFIX = 'extensions.zotero.bridgeflow.';

export interface PrefDescriptor<T extends boolean | number | string = boolean | number | string> {
	readonly defaultValue: T;

	readonly min?: number;
	readonly max?: number;
	readonly enumValues?: readonly string[];
	readonly resettable?: boolean;
}

export const PREF_SCHEMA = {
	// === Core Module & Fusion Master Switches ===
	'modules.workspace.enable': { defaultValue: true },
	'modules.inspector.enable': { defaultValue: true },
	'modules.wordCite.enable': { defaultValue: true },
	'modules.visualNotes.enable': { defaultValue: true },
	'fusion.copyToLookupHistory': { defaultValue: true },
	'fusion.sidebarCiteBadge': { defaultValue: true },
	'fusion.spotlightCrossDomain': { defaultValue: true },
	'fusion.lookupJumpExistingTab': { defaultValue: true },
	'debug': {
		defaultValue: false,
	},

	// === Domain A: Workspace (Tabs, Groups, Sessions, Sleep, Spotlight) ===
	'workspace.enableHorizontalGroups': { defaultValue: true },
	'workspace.horizontalTabCompactMode': {
		defaultValue: 'auto',
		enumValues: ['auto', 'compact', 'normal'],
	},
	'workspace.compactTopBar': { defaultValue: false },
	'workspace.enableVerticalSidebar': { defaultValue: true },
	'workspace.enableBatchSelection': { defaultValue: true },
	'workspace.enablePinnedTabs': { defaultValue: true },
	'workspace.pinnedIconOnly': { defaultValue: false },
	'workspace.enableVirtualMembers': { defaultValue: true },
	'workspace.newTabMode': {
		defaultValue: 'independent',
		enumValues: ['independent', 'collection'],
	},
	'workspace.multiCollectionStrategy': {
		defaultValue: 'active',
		enumValues: ['active', 'existing', 'first'],
	},
	'workspace.enableTabRemarks': { defaultValue: true },
	'workspace.syncRemarkToExtra': { defaultValue: true },
	'workspace.remarkColumn.enable': { defaultValue: true },
	'workspace.readingColumn.enable': { defaultValue: true },
	'workspace.readingTitleHeatmap.enable': { defaultValue: true },
	'workspace.readingHeatmap.color': { defaultValue: '#0d9488' },
	'workspace.readingHeatmap.opacity': { defaultValue: 42, min: 10, max: 90 },
	'workspace.annotationColumn.enable': { defaultValue: true },
	'visualNotes.infoBriefNote.enable': { defaultValue: true },
	'workspace.remarkDisplayMode': {
		defaultValue: 'both',
		enumValues: ['both', 'remark', 'title'],
	},
	'workspace.verticalTabTitleMode': {
		defaultValue: 'title',
		enumValues: ['title', 'shortTitle', 'filename'],
	},
	'workspace.verticalTabSubtitleMode': {
		defaultValue: 'source',
		enumValues: ['source', 'creatorYear', 'collection', 'lastViewed', 'none'],
	},
	'workspace.verticalTabRowHeight': { defaultValue: 42, min: 28, max: 72 },
	'workspace.verticalTabFontSize': { defaultValue: 13, min: 11, max: 18 },
	'workspace.verticalSidebarWidth': { defaultValue: 276, min: 200, max: 440 },
	'workspace.verticalSidebarCollapsed': { defaultValue: false },
	'workspace.enableHoverPreview': { defaultValue: true },
	'workspace.enableSpotlight': { defaultValue: true },
	'workspace.enableAnnotationMatrix': { defaultValue: true },
	'workspace.enableSessions': { defaultValue: true },
	'workspace.enableRollingSnapshots': { defaultValue: true },
	'workspace.enableTabSleep': { defaultValue: true },
	'workspace.autoSleepMinutes': { defaultValue: 0, min: 0, max: 1440 },
	'workspace.activeReaderBudget': { defaultValue: 0, min: 0, max: 100 },
	'workspace.enableStaleSuggestions': { defaultValue: true },
	'workspace.staleSuggestDays': { defaultValue: 7, min: 1, max: 3650 },
	'workspace.enableTabContextMenu': { defaultValue: true },
	'workspace.enableCopyReference': { defaultValue: true },
	'workspace.enableShowInFilesystem': { defaultValue: true },
	'workspace.enableReloadTab': { defaultValue: true },
	'workspace.document': { defaultValue: '', resettable: false },

	// === Domain B: Inspector (CSL Preview, Citation Lookup, PDF Preview & Folder) ===
	'inspector.cslPreview.enable': { defaultValue: true },
	'inspector.cslPreview.citationstyle': { defaultValue: '' },
	'inspector.cslPreview.position': {
		defaultValue: 'zotero-item-pane-header',
		enumValues: ['zotero-item-pane-header', 'zotero-editpane-item-box', 'zotero-editpane-related'],
	},
	'inspector.cslPreview.whatToShow': {
		defaultValue: 'zpboth',
		enumValues: ['zpboth', 'zpcite', 'zpbib'],
	},
	'inspector.cslPreview.fontsize': { defaultValue: '1' },
	'inspector.cslPreview.spacing': { defaultValue: '1.5' },
	'inspector.cslPreview.maxPreviewItems': { defaultValue: 100, min: 1, max: 500 },
	'inspector.lookup.enable': { defaultValue: true },
	'inspector.lookup.historyEnable': { defaultValue: true },
	'inspector.lookup.cacheDirectory': { defaultValue: '' },
	'inspector.lookup.cacheMaxEntries': { defaultValue: 2000, min: 100, max: 100000 },
	'inspector.lookup.cacheTtlDays': { defaultValue: 90, min: 7, max: 3650 },
	'inspector.pdfPreview.enable': { defaultValue: true },
	'inspector.pdfPreview.position': {
		defaultValue: 'zotero-editpane-related',
		enumValues: ['zotero-item-pane-header', 'zotero-editpane-item-box', 'zotero-editpane-related'],
	},
	'inspector.pdfPreview.mode': {
		defaultValue: 'section',
		enumValues: ['section', 'full'],
	},
	'inspector.pdfPreview.defaultZoom': { defaultValue: 100, min: 60, max: 200 },
	'inspector.pdfPreview.doubleClickOpen': { defaultValue: true },
	'inspector.pdfPreview.showPageBadge': { defaultValue: true },
	'inspector.pdfPreview.neighborCompareEnable': { defaultValue: true },
	'inspector.annotations.mergeEnable': { defaultValue: true },
	'inspector.annotations.popupLabelsEnable': { defaultValue: true },
	'inspector.annotations.colorLabels': { defaultValue: '' },
	'inspector.pdfFolder.enable': { defaultValue: true },
	'inspector.pdfFolder.position': {
		defaultValue: 'zotero-editpane-related',
		enumValues: ['zotero-item-pane-header', 'zotero-editpane-item-box', 'zotero-editpane-related'],
	},
	'inspector.pdfFolder.openMode': {
		defaultValue: 'reveal',
		enumValues: ['reveal', 'folder'],
	},
	'inspector.wordCite.enable': { defaultValue: true },
	'inspector.wordCite.position': {
		defaultValue: 'zotero-editpane-related',
		enumValues: [
			'zotero-item-pane-header', 'zotero-editpane-item-box', 'zotero-editpane-abstract',
			'zotero-editpane-attachments', 'zotero-editpane-notes', 'zotero-editpane-related',
		],
	},
	'inspector.wordCite.showDocSwitcher': { defaultValue: true },
	'inspector.wordCite.showSummaryCounts': { defaultValue: true },
	'inspector.wordCite.showGroupSynergy': { defaultValue: true },
	'inspector.wordCite.showCollectionLink': { defaultValue: true },

	// === Domain C: Word Citation Tracking & Governance ===
	'wordCite.column.enable': { defaultValue: true },
	'wordCite.dragCite.enable': { defaultValue: true },
	'wordCite.tabContextMenu.enable': { defaultValue: true },
	'wordCite.collections.enable': { defaultValue: true },
	'wordCite.citationTags.enable': { defaultValue: true },
	'wordCite.citationTags.text': { defaultValue: '/Citations' },
	'wordCite.citationTagDebounceMs': { defaultValue: 150, min: 0, max: 2000 },
	'wordCite.itemsViewRefreshDebounceMs': { defaultValue: 120, min: 0, max: 2000 },
	'wordCite.healthWindowMs': { defaultValue: 300000, min: 10000, max: 3600000 },
	'wordCite.perfSlowThresholdMs': { defaultValue: 50, min: 5, max: 5000 },
} as const satisfies Record<string, PrefDescriptor>;

type WidenLiteral<T> = T extends boolean ? boolean : T extends number ? number : T extends string ? string : T;

export type PrefKey = keyof typeof PREF_SCHEMA;
export type PrefValue<K extends PrefKey> = WidenLiteral<(typeof PREF_SCHEMA)[K]['defaultValue']>;
