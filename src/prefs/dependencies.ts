import type { UnifiedPrefService } from '../kernel/pref-service.ts';

export function setSubtreeDisabled(el: Element | null, disabled: boolean): void {
	if (!el) return;
	el.setAttribute('data-disabled', disabled ? 'true' : 'false');
	el.querySelectorAll('checkbox, menulist, input, button').forEach((ctrl: Element) => {
		try { (ctrl as any).disabled = disabled; } catch { /* ignore */ }
		if (disabled) ctrl.setAttribute('disabled', 'true');
		else ctrl.removeAttribute('disabled');
	});
}

export function setControlDisabled(el: Element | null, disabled: boolean): void {
	if (!el) return;
	try { (el as any).disabled = disabled; } catch { /* ignore */ }
	if (disabled) el.setAttribute('disabled', 'true');
	else el.removeAttribute('disabled');
}

export function syncMenulistLabels(doc: Document): void {
	doc.querySelectorAll('#zotero-prefpane-zotero-bridgeflow menulist').forEach((ml: Element) => {
		const hostMl = ml as any;
		const val = String(hostMl.value ?? ml.getAttribute('value') ?? '');
		const items = Array.from(ml.querySelectorAll('menuitem')) as Element[];
		const matched = items.find((it) => it.getAttribute('value') === val) || hostMl.selectedItem || items[0];
		if (matched) {
			try { hostMl.selectedItem = matched; } catch { /* ignore */ }
			const lbl = matched.getAttribute('label') || (matched.textContent || '').trim();
			if (lbl) ml.setAttribute('label', lbl);
		}
	});
}

export function setStatusFeedback(doc: Document, l10nId: string, fallbackText: string): void {
	const statusEl = doc.getElementById('zbf-prefs-status');
	if (!statusEl) return;
	statusEl.setAttribute('data-l10n-id', l10nId);
	statusEl.textContent = fallbackText;
}

export function updatePreferenceDependencies(doc: Document, prefs: UnifiedPrefService): void {
	prefs.invalidate();
	const wsOn = Boolean(prefs.get('modules.workspace.enable'));
	const insOn = Boolean(prefs.get('modules.inspector.enable'));
	const wcOn = Boolean(prefs.get('modules.wordCite.enable'));
	const vnOn = Boolean(prefs.get('modules.visualNotes.enable'));
	const vSideOn = wsOn && Boolean(prefs.get('workspace.enableVerticalSidebar'));

	const modMap: Array<[string, boolean]> = [
		['workspace', wsOn],
		['visualnotes', vnOn],
		['inspector', insOn],
		['wordcite', wcOn],
	];
	for (const [slug, enabled] of modMap) {
		const offBanner = doc.getElementById(`zbf-off-${slug}`) as HTMLElement | null;
		if (offBanner) offBanner.hidden = enabled;
	}

	setSubtreeDisabled(doc.getElementById('zbf-group-workspace'), !wsOn);
	setSubtreeDisabled(doc.getElementById('zbf-group-visualnotes'), !vnOn);
	setSubtreeDisabled(doc.getElementById('zbf-sub-reading-heatmap'), !vnOn || !prefs.get('workspace.readingTitleHeatmap.enable'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-rating-cfg'), !vnOn || !prefs.get('visualNotes.ratingColumn.enable'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-gallery-cfg'), !vnOn || !prefs.get('visualNotes.gallery.enable'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-hub-cfg'), !vnOn || !prefs.get('visualNotes.collectionHub.enable'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-status-cfg'), !vnOn || !prefs.get('visualNotes.statusColumn.enable'));
	setSubtreeDisabled(doc.getElementById('zbf-group-inspector'), !insOn);
	setSubtreeDisabled(doc.getElementById('zbf-group-pdf'), !insOn);
	setSubtreeDisabled(doc.getElementById('zbf-group-wordcite'), !wcOn);
	setSubtreeDisabled(doc.getElementById('zbf-group-word-perf'), !wcOn);

	setSubtreeDisabled(doc.getElementById('zbf-sub-hcompact'), !wsOn || !prefs.get('workspace.enableHorizontalGroups'));
	setSubtreeDisabled(
		doc.getElementById('zbf-sub-hcompact-threshold'),
		!wsOn || !prefs.get('workspace.enableHorizontalGroups') || prefs.get('workspace.horizontalTabCompactMode') !== 'auto',
	);
	setSubtreeDisabled(doc.getElementById('zbf-sub-compactTop'), !vSideOn || !prefs.get('workspace.enableHorizontalGroups'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-vsidebar-cfg'), !vSideOn);
	setSubtreeDisabled(doc.getElementById('zbf-sub-vsidebar-typo'), !vSideOn);
	setSubtreeDisabled(doc.getElementById('zbf-sub-pinnedIcon'), !wsOn || !prefs.get('workspace.enablePinnedTabs'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-multicol'), !wsOn || prefs.get('workspace.newTabMode') !== 'collection');
	setSubtreeDisabled(doc.getElementById('zbf-session-actions'), !wsOn || !prefs.get('workspace.enableSessions'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-rolling'), !wsOn || !prefs.get('workspace.enableSessions'));
	setSubtreeDisabled(
		doc.getElementById('zbf-sub-rolling-interval'),
		!wsOn || !prefs.get('workspace.enableSessions') || !prefs.get('workspace.enableRollingSnapshots'),
	);
	setSubtreeDisabled(doc.getElementById('zbf-sub-reading-tracker-cfg'), !wsOn || !prefs.get('workspace.enableReadingTracker'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-sleep-cfg'), !wsOn || !prefs.get('workspace.enableTabSleep'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-stale-days'), !wsOn || !prefs.get('workspace.enableStaleSuggestions'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-remark-cfg'), !wsOn || !prefs.get('workspace.enableTabRemarks'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-hover-cfg'), !wsOn || !prefs.get('workspace.enableHoverPreview'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-reader-switcher-cfg'), !wsOn || !prefs.get('workspace.enableReaderAttachmentSwitcher'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-spotlight-cfg'), !wsOn || !prefs.get('workspace.enableSpotlight'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-tabmenu'), !wsOn || !prefs.get('workspace.enableTabContextMenu'));

	setControlDisabled(doc.getElementById('zbf-btn-open-matrix'), !vnOn || !prefs.get('workspace.enableAnnotationMatrix'));
	setControlDisabled(doc.getElementById('zbf-btn-open-collection-hub'), !vnOn || !prefs.get('visualNotes.collectionHub.enable'));

	const cslOn = insOn && Boolean(prefs.get('inspector.cslPreview.enable'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-csl'), !cslOn);
	setSubtreeDisabled(doc.getElementById('zbf-sub-csl-layout'), !cslOn);
	const lookupOn = insOn && Boolean(prefs.get('inspector.lookup.enable'));
	const historyOn = lookupOn && Boolean(prefs.get('inspector.lookup.historyEnable'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-lookup-history'), !lookupOn);
	setSubtreeDisabled(doc.getElementById('zbf-sub-lookup-quota'), !historyOn);
	setSubtreeDisabled(doc.getElementById('zbf-sub-pdf-preview'), !insOn || !prefs.get('inspector.pdfPreview.enable'));
	setSubtreeDisabled(doc.getElementById('zbf-card-annotations'), !vnOn);
	setSubtreeDisabled(doc.getElementById('zbf-sub-pdf-folder'), !insOn || !prefs.get('inspector.pdfFolder.enable'));

	setControlDisabled(doc.getElementById('zbf-chk-wc-children'), !wcOn || !prefs.get('wordCite.column.enable'));
	const wordPanelOn = wcOn && insOn && Boolean(prefs.get('inspector.wordCite.enable'));
	setSubtreeDisabled(doc.getElementById('zbf-sub-word-panel-card'), !wcOn || !insOn);
	setSubtreeDisabled(doc.getElementById('zbf-sub-word-panel'), !wordPanelOn);
	setControlDisabled(doc.getElementById('zbf-chk-orphan-expand'), !wordPanelOn || !prefs.get('inspector.wordCite.showOrphanRecovery'));

	const remCardOn = wordPanelOn && Boolean(prefs.get('inspector.wordCite.showMetadataReminders'));
	setSubtreeDisabled(doc.getElementById('zbf-card-word-reminders'), !wordPanelOn);
	setSubtreeDisabled(doc.getElementById('zbf-sub-word-reminders'), !remCardOn);
	setControlDisabled(doc.getElementById('zbf-chk-rem-strict-online'), !remCardOn || !prefs.get('inspector.wordCite.reminderCheckPagination'));

	setSubtreeDisabled(doc.getElementById('zbf-sub-wc-tag-text'), !wcOn || !prefs.get('wordCite.citationTags.enable'));

	syncMenulistLabels(doc);
}
