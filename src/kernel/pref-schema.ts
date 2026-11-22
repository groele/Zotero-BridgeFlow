export const PREF_PREFIX = 'extensions.zotero.bridgeflow.';

export interface PrefDescriptor<T extends boolean | number | string = boolean | number | string> {
	readonly defaultValue: T;
	readonly legacyKeys?: readonly string[];
	readonly min?: number;
	readonly max?: number;
	readonly enumValues?: readonly string[];
	readonly resettable?: boolean;
}

export const PREF_SCHEMA = {
	// === Core Module & Fusion Master Switches ===
	'modules.workspace.enable': { defaultValue: true },
	'modules.inspector.enable': { defaultValue: true },
	'modules.wordCite.enable': { defaultValue: true, legacyKeys: ['extensions.zotero.zoterocitation.enable'] },
	'fusion.copyToLookupHistory': { defaultValue: true },
	'fusion.sidebarCiteBadge': { defaultValue: true },
	'fusion.spotlightCrossDomain': { defaultValue: true },
	'fusion.lookupJumpExistingTab': { defaultValue: true },
	'debug': {
		defaultValue: false,
		legacyKeys: [
			'extensions.zotero.tabflow.debug',
			'extensions.zoteropreview.debug',
			'extensions.zotero.zoterocitation.debug',
		],
	},
	'migrationVersion': { defaultValue: 0, resettable: false },

	// === Domain A: Workspace (Tabs, Groups, Sessions, Sleep, Spotlight) ===
	'workspace.enableHorizontalGroups': { defaultValue: true, legacyKeys: ['extensions.zotero.tabflow.enableHorizontalGroups'] },
	'workspace.horizontalTabCompactMode': {
		defaultValue: 'auto',
		enumValues: ['auto', 'compact', 'normal'],
		legacyKeys: ['extensions.zotero.tabflow.horizontalTabCompactMode'],
	},
	'workspace.compactTopBar': { defaultValue: false, legacyKeys: ['extensions.zotero.tabflow.compactTopBar'] },
	'workspace.enableVerticalSidebar': { defaultValue: true, legacyKeys: ['extensions.zotero.tabflow.enableVerticalSidebar'] },
	'workspace.enableBatchSelection': { defaultValue: true, legacyKeys: ['extensions.zotero.tabflow.enableBatchSelection'] },
	'workspace.enablePinnedTabs': { defaultValue: true, legacyKeys: ['extensions.zotero.tabflow.enablePinnedTabs'] },
	'workspace.pinnedIconOnly': { defaultValue: false, legacyKeys: ['extensions.zotero.tabflow.pinnedIconOnly'] },
	'workspace.enableVirtualMembers': { defaultValue: true, legacyKeys: ['extensions.zotero.tabflow.enableVirtualMembers'] },
	'workspace.newTabMode': {
		defaultValue: 'independent',
		enumValues: ['independent', 'collection'],
		legacyKeys: ['extensions.zotero.tabflow.newTabMode'],
	},
	'workspace.multiCollectionStrategy': {
		defaultValue: 'active',
		enumValues: ['active', 'existing', 'first'],
		legacyKeys: ['extensions.zotero.tabflow.multiCollectionStrategy'],
	},
	'workspace.enableTabRemarks': { defaultValue: true, legacyKeys: ['extensions.zotero.tabflow.enableTabRemarks'] },
	'workspace.remarkDisplayMode': {
		defaultValue: 'both',
		enumValues: ['both', 'remark', 'title'],
		legacyKeys: ['extensions.zotero.tabflow.remarkDisplayMode'],
	},
	'workspace.verticalTabTitleMode': {
		defaultValue: 'title',
		enumValues: ['title', 'shortTitle', 'filename'],
		legacyKeys: ['extensions.zotero.tabflow.verticalTabTitleMode'],
	},
	'workspace.verticalTabSubtitleMode': {
		defaultValue: 'source',
		enumValues: ['source', 'creatorYear', 'collection', 'none'],
		legacyKeys: ['extensions.zotero.tabflow.verticalTabSubtitleMode'],
	},
	'workspace.verticalTabRowHeight': { defaultValue: 42, min: 28, max: 72, legacyKeys: ['extensions.zotero.tabflow.verticalTabRowHeight'] },
	'workspace.verticalTabFontSize': { defaultValue: 13, min: 11, max: 18, legacyKeys: ['extensions.zotero.tabflow.verticalTabFontSize'] },
	'workspace.verticalSidebarWidth': { defaultValue: 276, min: 200, max: 440, legacyKeys: ['extensions.zotero.tabflow.verticalSidebarWidth'] },
	'workspace.verticalSidebarCollapsed': { defaultValue: false, legacyKeys: ['extensions.zotero.tabflow.verticalSidebarCollapsed'] },
	'workspace.enableHoverPreview': { defaultValue: true, legacyKeys: ['extensions.zotero.tabflow.enableHoverPreview'] },
	'workspace.enableSpotlight': { defaultValue: true, legacyKeys: ['extensions.zotero.tabflow.enableSpotlight'] },
	'workspace.enableSessions': { defaultValue: true, legacyKeys: ['extensions.zotero.tabflow.enableSessions'] },
	'workspace.enableRollingSnapshots': { defaultValue: true, legacyKeys: ['extensions.zotero.tabflow.enableRollingSnapshots'] },
	'workspace.enableTabSleep': { defaultValue: true, legacyKeys: ['extensions.zotero.tabflow.enableTabSleep'] },
	'workspace.autoSleepMinutes': { defaultValue: 0, min: 0, max: 1440, legacyKeys: ['extensions.zotero.tabflow.autoSleepMinutes'] },
	'workspace.activeReaderBudget': { defaultValue: 0, min: 0, max: 100, legacyKeys: ['extensions.zotero.tabflow.activeReaderBudget'] },
	'workspace.enableStaleSuggestions': { defaultValue: true, legacyKeys: ['extensions.zotero.tabflow.enableStaleSuggestions'] },
	'workspace.staleSuggestDays': { defaultValue: 7, min: 1, max: 3650, legacyKeys: ['extensions.zotero.tabflow.staleSuggestDays'] },
	'workspace.enableTabContextMenu': { defaultValue: true, legacyKeys: ['extensions.zotero.tabflow.enableTabContextMenu'] },
	'workspace.enableItemContextMenu': { defaultValue: true, legacyKeys: ['extensions.zotero.tabflow.enableItemContextMenu'] },
	'workspace.enableCopyReference': { defaultValue: true, legacyKeys: ['extensions.zotero.tabflow.enableCopyReference'] },
	'workspace.enableShowInFilesystem': { defaultValue: true, legacyKeys: ['extensions.zotero.tabflow.enableShowInFilesystem'] },
	'workspace.enableReloadTab': { defaultValue: true, legacyKeys: ['extensions.zotero.tabflow.enableReloadTab'] },
	'workspace.state': { defaultValue: '', resettable: false, legacyKeys: ['extensions.zotero.tabflow.state'] },

	// === Domain B: Inspector (CSL Preview, Citation Lookup, PDF Preview & Folder) ===
	'inspector.cslPreview.enable': { defaultValue: true },
	'inspector.cslPreview.citationstyle': { defaultValue: '', legacyKeys: ['extensions.zoteropreview.citationstyle'] },
	'inspector.cslPreview.position': {
		defaultValue: 'zotero-item-pane-header',
		enumValues: ['zotero-item-pane-header', 'zotero-editpane-item-box', 'zotero-editpane-related'],
		legacyKeys: ['extensions.zoteropreview.position'],
	},
	'inspector.cslPreview.whatToShow': {
		defaultValue: 'zpboth',
		enumValues: ['zpboth', 'zpcite', 'zpbib'],
		legacyKeys: ['extensions.zoteropreview.whatToShow'],
	},
	'inspector.cslPreview.fontsize': { defaultValue: '1', legacyKeys: ['extensions.zoteropreview.fontsize'] },
	'inspector.cslPreview.spacing': { defaultValue: '1.5', legacyKeys: ['extensions.zoteropreview.spacing'] },
	'inspector.cslPreview.maxPreviewItems': { defaultValue: 100, min: 1, max: 500, legacyKeys: ['extensions.zoteropreview.maxPreviewItems'] },
	'inspector.lookup.enable': { defaultValue: true, legacyKeys: ['extensions.zoteropreview.lookupEnabled'] },
	'inspector.lookup.historyEnable': { defaultValue: true, legacyKeys: ['extensions.zoteropreview.lookupHistoryEnabled'] },
	'inspector.lookup.cacheDirectory': { defaultValue: '', legacyKeys: ['extensions.zoteropreview.cacheDirectory'] },
	'inspector.lookup.cacheMaxEntries': { defaultValue: 2000, min: 100, max: 100000, legacyKeys: ['extensions.zoteropreview.cacheMaxEntries'] },
	'inspector.lookup.cacheTtlDays': { defaultValue: 90, min: 7, max: 3650, legacyKeys: ['extensions.zoteropreview.cacheTtlDays'] },
	'inspector.pdfPreview.enable': { defaultValue: true, legacyKeys: ['extensions.zotero.tabflow.enablePdfPreviewSidenav'] },
	'inspector.pdfPreview.position': {
		defaultValue: 'zotero-editpane-related',
		enumValues: ['zotero-item-pane-header', 'zotero-editpane-item-box', 'zotero-editpane-related'],
	},
	'inspector.pdfPreview.mode': {
		defaultValue: 'section',
		enumValues: ['section', 'full'],
		legacyKeys: ['extensions.zotero.tabflow.pdfPreviewMode'],
	},
	'inspector.pdfPreview.defaultZoom': { defaultValue: 100, min: 60, max: 200, legacyKeys: ['extensions.zotero.tabflow.pdfPreviewDefaultZoom'] },
	'inspector.pdfPreview.doubleClickOpen': { defaultValue: true, legacyKeys: ['extensions.zotero.tabflow.pdfPreviewDoubleClickOpen'] },
	'inspector.pdfPreview.showPageBadge': { defaultValue: true, legacyKeys: ['extensions.zotero.tabflow.pdfPreviewShowPageBadge'] },
	'inspector.pdfFolder.enable': { defaultValue: true, legacyKeys: ['extensions.zotero.tabflow.enablePdfFolderSidenav'] },
	'inspector.pdfFolder.position': {
		defaultValue: 'zotero-editpane-related',
		enumValues: ['zotero-item-pane-header', 'zotero-editpane-item-box', 'zotero-editpane-related'],
	},
	'inspector.pdfFolder.openMode': {
		defaultValue: 'reveal',
		enumValues: ['reveal', 'folder'],
		legacyKeys: ['extensions.zotero.tabflow.pdfFolderOpenMode'],
	},

	// === Domain C: Word Citation Tracking & Governance ===
	'wordCite.dragCite.enable': { defaultValue: true, legacyKeys: ['extensions.zotero.zoterocitation.dragCite.enable'] },
	'wordCite.collections.enable': { defaultValue: true, legacyKeys: ['extensions.zotero.zoterocitation.collections.enable'] },
	'wordCite.citationTags.enable': { defaultValue: true, legacyKeys: ['extensions.zotero.zoterocitation.citationTags.enable'] },
	'wordCite.citationTags.text': { defaultValue: '/Citations', legacyKeys: ['extensions.zotero.zoterocitation.citationTags.text'] },
	'wordCite.citationTagDebounceMs': { defaultValue: 150, min: 0, max: 2000, legacyKeys: ['extensions.zotero.zoterocitation.citationTagDebounceMs'] },
	'wordCite.itemsViewRefreshDebounceMs': { defaultValue: 120, min: 0, max: 2000, legacyKeys: ['extensions.zotero.zoterocitation.itemsViewRefreshDebounceMs'] },
	'wordCite.healthWindowMs': { defaultValue: 300000, min: 10000, max: 3600000, legacyKeys: ['extensions.zotero.zoterocitation.healthWindowMs'] },
	'wordCite.perfSlowThresholdMs': { defaultValue: 50, min: 5, max: 5000, legacyKeys: ['extensions.zotero.zoterocitation.perfSlowThresholdMs'] },
} as const satisfies Record<string, PrefDescriptor>;

type WidenLiteral<T> = T extends boolean ? boolean : T extends number ? number : T extends string ? string : T;

export type PrefKey = keyof typeof PREF_SCHEMA;
export type PrefValue<K extends PrefKey> = WidenLiteral<(typeof PREF_SCHEMA)[K]['defaultValue']>;
