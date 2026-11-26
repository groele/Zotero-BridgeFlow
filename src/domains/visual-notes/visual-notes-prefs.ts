import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { PrefKey } from '../../kernel/pref-schema.ts';
import { loadCustomStatusColors } from '../../services/status-tag-colors.ts';
import type { ReaderAnnotationTools } from './reader/annotation-tools.ts';
import { clearGalleryCardCache } from './gallery/gallery-board-helpers.ts';
import type { GalleryBoardController } from './gallery/gallery-view.ts';
import { closeHubPage } from './hub/hub-page.ts';
import type { ReadingColumnsController } from './columns/library-columns.ts';
import type { StatusRatingColumnsController } from './columns/status-rating-columns.ts';

export const VISUAL_NOTES_WATCHED_PREFS: readonly PrefKey[] = [
	'visualNotes.infoBriefNote.enable', 'visualNotes.showTitleTagDots', 'visualNotes.statusColumn.enable', 'visualNotes.statusSyncZoteroTagColor',
	'visualNotes.statusCustomColors', 'visualNotes.ratingColumn.enable', 'visualNotes.ratingStorage', 'visualNotes.gallery.enable',
	'visualNotes.gallery.defaultMode', 'visualNotes.gallery.groupBy', 'visualNotes.gallery.defaultSort', 'visualNotes.gallery.cardDensity',
	'visualNotes.gallery.cardWidth', 'visualNotes.gallery.coverHeight', 'visualNotes.gallery.showBriefNote', 'visualNotes.gallery.showRatingStars',
	'visualNotes.gallery.showTags', 'visualNotes.gallery.showReadTime', 'visualNotes.collectionHub.enable',
	'visualNotes.collectionHub.ignoreFigureTable', 'visualNotes.collectionHub.preferCommentOverQuote', 'workspace.remarkColumn.enable',
	'workspace.readingColumn.enable', 'workspace.readingTitleHeatmap.enable', 'workspace.readingHeatmap.color', 'workspace.readingHeatmap.opacity',
	'workspace.annotationColumn.enable', 'inspector.annotations.popupLabelsEnable', 'inspector.annotations.colorLabels',
	'inspector.annotations.enabledColors', 'wordCite.citationTags.text',
];

export interface VisualNotesPrefContext {
	kernel: PluginKernel;
	windows: ReadonlySet<Window>;
	readingColumns: ReadingColumnsController;
	statusRatingColumns: StatusRatingColumnsController;
	galleryBoard: GalleryBoardController;
	annotationTools: ReaderAnnotationTools;
	syncFeatureStates: () => void;
	runStatusTagDotSync: (enable: boolean) => void;
}

export function handleVisualNotesPrefChange(ctx: VisualNotesPrefContext, key: PrefKey): void {
	ctx.syncFeatureStates();
	if (key === 'visualNotes.statusCustomColors') {
		loadCustomStatusColors(ctx.kernel.prefs.get('visualNotes.statusCustomColors'));
		clearGalleryCardCache();
		ctx.statusRatingColumns.refreshColumns();
		ctx.galleryBoard.refreshWindows();
	}
	if (key === 'visualNotes.statusSyncZoteroTagColor') {
		ctx.runStatusTagDotSync(Boolean(ctx.kernel.prefs.get('visualNotes.statusSyncZoteroTagColor')));
	}
	if (key === 'inspector.annotations.popupLabelsEnable' || key === 'inspector.annotations.colorLabels' || key === 'inspector.annotations.enabledColors') {
		ctx.annotationTools.popupLabels.sync();
	}
	if (key === 'inspector.annotations.colorLabels') ctx.readingColumns.refreshColumns();
	if (key === 'workspace.readingHeatmap.color') ctx.readingColumns.syncPrefs();
	if (key === 'visualNotes.collectionHub.enable' && !ctx.kernel.prefs.get(key)) {
		for (const win of ctx.windows) closeHubPage(win);
	}
	if (key === 'visualNotes.ratingStorage' || key === 'wordCite.citationTags.text' || key === 'visualNotes.statusSyncZoteroTagColor') {
		ctx.statusRatingColumns.refreshPrefs();
	}
	if (key === 'visualNotes.ratingStorage' || key === 'wordCite.citationTags.text') {
		clearGalleryCardCache();
		ctx.statusRatingColumns.refreshColumns();
		ctx.galleryBoard.refreshWindows();
	}
	if (key === 'visualNotes.gallery.defaultSort') {
		ctx.galleryBoard.syncDefaultSort();
	}
	if (key === 'visualNotes.collectionHub.ignoreFigureTable' || key === 'visualNotes.collectionHub.preferCommentOverQuote') {
		ctx.galleryBoard.refreshWindows();
	}
}
