export type HostCapabilityId =
	| 'readerInPlaceSwap'
	| 'readerToolbarEvent'
	| 'tabsCollection'
	| 'contextPane'
	| 'itemsViewCellHook'
	| 'collectionsViewTreeHook'
	| 'wordIntegrationHook';

export interface HostCapabilityStatus {
	id: HostCapabilityId;
	available: boolean;
	degradedReason?: string;
}

export interface HostCapabilitiesSnapshot {
	hostVersion: string;
	checkedAt: number;
	capabilities: Record<HostCapabilityId, HostCapabilityStatus>;
	degradedIds: HostCapabilityId[];
}

const CAPABILITY_ORDER: readonly HostCapabilityId[] = [
	'readerInPlaceSwap',
	'readerToolbarEvent',
	'tabsCollection',
	'contextPane',
	'itemsViewCellHook',
	'collectionsViewTreeHook',
	'wordIntegrationHook',
];

function safeRead<T>(getter: () => T, fallback: T): T {
	try {
		return getter();
	} catch {
		return fallback;
	}
}

function makeStatus(id: HostCapabilityId, missingReasons: string[]): HostCapabilityStatus {
	if (missingReasons.length === 0) {
		return { id, available: true };
	}
	return {
		id,
		available: false,
		degradedReason: missingReasons.join('; '),
	};
}

function probeReaderInPlaceSwap(zotero: any, targetWin: any): HostCapabilityStatus {
	const missing: string[] = [];
	if (safeRead(() => typeof zotero?.Reader?.open !== 'function', true)) {
		missing.push('missing Zotero.Reader.open');
	}
	if (safeRead(() => !Array.isArray(targetWin?.Zotero_Tabs?._tabs), true)) {
		missing.push('missing Zotero_Tabs._tabs');
	}
	if (safeRead(() => typeof targetWin?.document?.getElementById !== 'function', true)) {
		missing.push('missing document.getElementById');
	}
	return makeStatus('readerInPlaceSwap', missing);
}

function probeReaderToolbarEvent(zotero: any): HostCapabilityStatus {
	const missing: string[] = [];
	if (safeRead(() => typeof zotero?.Reader?.registerEventListener !== 'function', true)) {
		missing.push('missing Zotero.Reader.registerEventListener');
	}
	return makeStatus('readerToolbarEvent', missing);
}

function probeTabsCollection(targetWin: any): HostCapabilityStatus {
	const missing: string[] = [];
	if (safeRead(() => !Array.isArray(targetWin?.Zotero_Tabs?._tabs), true)) {
		missing.push('missing Zotero_Tabs._tabs');
	}
	if (safeRead(() => typeof targetWin?.Zotero_Tabs?.select !== 'function', true)) {
		missing.push('missing Zotero_Tabs.select');
	}
	return makeStatus('tabsCollection', missing);
}

function probeContextPane(targetWin: any): HostCapabilityStatus {
	const missing: string[] = [];
	if (safeRead(() => !Boolean(targetWin?.ZoteroContextPane?.context?._getItemContext), true)) {
		missing.push('missing ZoteroContextPane.context._getItemContext');
	}
	return makeStatus('contextPane', missing);
}

function probeItemsViewCellHook(targetWin: any): HostCapabilityStatus {
	const missing: string[] = [];
	if (safeRead(() => typeof targetWin?.ZoteroPane?.itemsView?._renderCell !== 'function', true)) {
		missing.push('missing ZoteroPane.itemsView._renderCell');
	}
	return makeStatus('itemsViewCellHook', missing);
}

function probeCollectionsViewTreeHook(targetWin: any): HostCapabilityStatus {
	const missing: string[] = [];
	if (safeRead(() => typeof targetWin?.ZoteroPane?.collectionsView?._getIcon !== 'function', true)) {
		missing.push('missing ZoteroPane.collectionsView._getIcon');
	}
	if (safeRead(() => typeof targetWin?.ZoteroPane?.collectionsView?._expandRow !== 'function', true)) {
		missing.push('missing ZoteroPane.collectionsView._expandRow');
	}
	if (safeRead(() => typeof targetWin?.ZoteroPane?.collectionsView?._addSortedRow !== 'function', true)) {
		missing.push('missing ZoteroPane.collectionsView._addSortedRow');
	}
	return makeStatus('collectionsViewTreeHook', missing);
}

function probeWordIntegrationHook(zotero: any): HostCapabilityStatus {
	const hasExec = safeRead(() => typeof zotero?.Integration?.execCommand === 'function', false);
	const hasSession = safeRead(() => typeof zotero?.Integration?.getSession === 'function', false);
	return makeStatus(
		'wordIntegrationHook',
		hasExec || hasSession ? [] : ['missing Zotero.Integration.execCommand/getSession'],
	);
}

/**
 * Safely inspect Zotero host runtime and window surfaces without throwing.
 */
export function probeHostCapabilities(win?: Window | null): HostCapabilitiesSnapshot {
	const zotero = safeRead(() => (globalThis as any).Zotero, undefined);
	const targetWin = win ?? safeRead(() => zotero?.getMainWindow?.(), null);
	const rawVersion = safeRead(() => zotero?.version, '');
	const hostVersion = typeof rawVersion === 'string' && rawVersion.trim() ? rawVersion.trim() : 'unknown';

	const capabilities: Record<HostCapabilityId, HostCapabilityStatus> = {
		readerInPlaceSwap: probeReaderInPlaceSwap(zotero, targetWin),
		readerToolbarEvent: probeReaderToolbarEvent(zotero),
		tabsCollection: probeTabsCollection(targetWin),
		contextPane: probeContextPane(targetWin),
		itemsViewCellHook: probeItemsViewCellHook(targetWin),
		collectionsViewTreeHook: probeCollectionsViewTreeHook(targetWin),
		wordIntegrationHook: probeWordIntegrationHook(zotero),
	};

	const degradedIds: HostCapabilityId[] = [];
	for (const id of CAPABILITY_ORDER) {
		if (!capabilities[id].available) {
			degradedIds.push(id);
		}
	}

	return {
		hostVersion,
		checkedAt: Date.now(),
		capabilities,
		degradedIds,
	};
}

/**
 * Format a compact single-line diagnostic summary of probed host capabilities.
 */
export function formatCapabilitiesSummary(snapshot: HostCapabilitiesSnapshot): string {
	const total = CAPABILITY_ORDER.length;
	const availableCount = CAPABILITY_ORDER.filter((id) => snapshot.capabilities[id]?.available).length;
	const header = `Zotero ${snapshot.hostVersion} (${availableCount}/${total} capabilities available)`;
	if (snapshot.degradedIds.length === 0) {
		return `${header} [all OK]`;
	}
	const details = snapshot.degradedIds.map((id) => {
		const reason = snapshot.capabilities[id]?.degradedReason;
		return reason ? `${id}: ${reason}` : id;
	});
	return `${header} [degraded: ${details.join(' | ')}]`;
}
