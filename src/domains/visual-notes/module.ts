import { closeHubPage } from './hub-page.ts';
import { closeVisualColumnPopover } from './column-popover-styles.ts';
import { closeStatusPickerPopover } from './status-rating-popover.ts';
import { DisposableStack } from '../../kernel/disposable.ts';
import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { DomainModule } from '../../kernel/types.ts';
import { syncNativeStatusTagDots } from '../../services/item-status-rating.ts';
import type { ServiceContainer } from '../../services/service-container.ts';
import { bindCustomStatusColorPersistence, loadCustomStatusColors } from '../../services/status-tag-colors.ts';
import { openAnnotationMatrixModal } from './annotation-matrix-modal.ts';
import { ReaderAnnotationTools } from './annotation-tools.ts';
import { openCollectionNotesHubModal } from './collection-notes-hub.ts';
import type { VisualNotesDataSource } from './data-source.ts';
import { GalleryBoardController } from './gallery-view.ts';
import { InfoBriefNoteController } from './info-brief-note.ts';
import { ReadingColumnsController, RemarkColumnController } from './library-columns.ts';
import { StatusRatingColumnsController } from './status-rating-columns.ts';
import { TitleHeatmapController } from './title-heatmap.ts';

export class VisualNotesDomainModule implements DomainModule {
	public readonly id = 'visual-notes' as const;
	public readonly enabledPref = 'modules.visualNotes.enable' as const;

	public readonly infoBriefNote: InfoBriefNoteController;
	public readonly remarkColumn: RemarkColumnController;
	public readonly readingColumns: ReadingColumnsController;
	public readonly statusRatingColumns: StatusRatingColumnsController;
	public readonly galleryBoard: GalleryBoardController;
	public readonly titleHeatmap: TitleHeatmapController;
	public readonly annotationTools: ReaderAnnotationTools;

	private readonly kernel: PluginKernel;
	private readonly services: ServiceContainer;
	private readonly disposables = new DisposableStack();
	private readonly windows = new Set<Window>();
	private dataSource?: VisualNotesDataSource;
	private active = false;
	private refreshTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(kernel: PluginKernel, services: ServiceContainer) {
		this.kernel = kernel;
		this.services = services;
		this.remarkColumn = new RemarkColumnController(kernel);
		this.readingColumns = new ReadingColumnsController(kernel, undefined, {
			onOpenItem: (itemID) => {
				this.kernel.bus.emit('workspace:open-item-request', { itemID, preferExistingTab: true });
			},
			onOpenMatrix: (win, title, itemIDs) => {
				this.openMatrixModal(win, title, itemIDs);
			},
			onOpenHub: (win) => {
				this.openCollectionHub(win, 'annotations');
			},
		});
		this.statusRatingColumns = new StatusRatingColumnsController(kernel, () => {
			this.galleryBoard.refreshWindows();
		});
		this.infoBriefNote = new InfoBriefNoteController(kernel, () => {
			this.remarkColumn.refresh();
			this.galleryBoard.refreshWindows();
		});
		this.titleHeatmap = new TitleHeatmapController(kernel, (item) => this.readingColumns.getReadProgressForItem(item));
		this.galleryBoard = new GalleryBoardController({
			kernel,
			getReadProgress: (item) => this.readingColumns.getReadProgressForItem(item),
			onOpenHub: (win) => this.openCollectionHub(win),
			onMutated: () => {
				this.statusRatingColumns.refreshColumns();
				this.remarkColumn.refresh();
			},
		});
		this.annotationTools = new ReaderAnnotationTools(kernel);
	}

	setDataSource(source?: VisualNotesDataSource): void {
		this.dataSource = source;
		this.infoBriefNote.setDataSource(source);
		this.remarkColumn.setDataSource(source);
		this.readingColumns.setDataSource(source);
		this.galleryBoard.setDataSource(source);
	}

	isActive(): boolean {
		return this.active;
	}

	start(): void {
		if (this.active) return;
		this.active = true;
		this.disposables.reset();

		loadCustomStatusColors(this.kernel.prefs.get('visualNotes.statusCustomColors'));
		bindCustomStatusColorPersistence((json) => {
			if (this.kernel.prefs.get('visualNotes.statusCustomColors') !== json) {
				this.kernel.prefs.set('visualNotes.statusCustomColors', json);
			}
		});

		this.syncFeatureStates();
		this.annotationTools.register();
		if (!this.kernel.prefs.get('visualNotes.statusSyncZoteroTagColor')) {
			this.runStatusTagDotSync(false);
			const uiReady = (globalThis as any).Zotero?.uiReadyPromise;
			if (uiReady && typeof uiReady.then === 'function') {
				void uiReady.then(() => {
					if (this.active && !this.kernel.prefs.get('visualNotes.statusSyncZoteroTagColor')) {
						this.runStatusTagDotSync(false);
					}
				}).catch(() => {});
			}
		}

		this.disposables.add(
			this.kernel.prefs.observeKeys(
				[
					'visualNotes.infoBriefNote.enable', 'visualNotes.showTitleTagDots',
					'visualNotes.statusColumn.enable', 'visualNotes.statusSyncZoteroTagColor',
					'visualNotes.statusCustomColors',
					'visualNotes.ratingColumn.enable',
					'visualNotes.ratingStorage',
					'visualNotes.gallery.enable',
					'visualNotes.gallery.defaultMode',
					'visualNotes.gallery.groupBy',
					'visualNotes.gallery.cardDensity',
					'visualNotes.gallery.cardWidth',
					'visualNotes.gallery.coverHeight',
					'visualNotes.gallery.showBriefNote',
					'visualNotes.collectionHub.enable',
					'workspace.remarkColumn.enable',
					'workspace.readingColumn.enable',
					'workspace.readingTitleHeatmap.enable',
					'workspace.readingHeatmap.color',
					'workspace.readingHeatmap.opacity',
					'workspace.annotationColumn.enable',
					'inspector.annotations.popupLabelsEnable',
					'inspector.annotations.colorLabels',
					'inspector.annotations.enabledColors',
				],
				(key) => {
					if (!this.active) return;
					this.syncFeatureStates();
					if (key === 'visualNotes.statusCustomColors') {
						loadCustomStatusColors(this.kernel.prefs.get('visualNotes.statusCustomColors'));
						this.statusRatingColumns.refreshColumns();
						this.galleryBoard.refreshWindows();
					}
					if (key === 'visualNotes.statusSyncZoteroTagColor') {
						this.runStatusTagDotSync(Boolean(this.kernel.prefs.get('visualNotes.statusSyncZoteroTagColor')));
					}
					if (key === 'inspector.annotations.popupLabelsEnable' || key === 'inspector.annotations.colorLabels' || key === 'inspector.annotations.enabledColors') {
						this.annotationTools.popupLabels.sync();
					}
					if (key === 'inspector.annotations.colorLabels') {
						this.readingColumns.refreshColumns();
					}
					if (key === 'visualNotes.collectionHub.enable' && !this.kernel.prefs.get(key)) {
						for (const win of this.windows) closeHubPage(win);
					}
					if (key === 'visualNotes.ratingStorage') {
						this.statusRatingColumns.refreshColumns();
					}
				},
			),
		);

		this.disposables.add(
			this.kernel.bus.on('visual-notes:open-matrix', ({ win, title, itemIDs }) => {
				if (!this.active || !this.kernel.prefs.get('workspace.enableAnnotationMatrix')) return;
				openAnnotationMatrixModal({
					win,
					title,
					itemIDs,
					prefs: this.kernel.prefs,
					bus: this.kernel.bus,
					clipboard: this.services.clipboard,
				});
			}),
		);

		this.disposables.add(
			this.kernel.bus.on('visual-notes:open-hub', ({ win, initialTab }) => {
				if (this.active) this.openCollectionHub(win, initialTab);
			}),
		);

		this.disposables.add(
			this.kernel.bus.on('visual-notes:toggle-gallery', ({ win, mode }) => {
				if (this.active && this.kernel.prefs.get('visualNotes.gallery.enable')) {
					this.galleryBoard.toggleWindowGallery(win, mode);
				}
			}),
		);

		this.disposables.add(
			this.kernel.bus.on('visual-notes:reading-updated', () => {
				if (this.active) this.scheduleLibraryRefresh();
			}),
		);

		this.disposables.add(
			this.kernel.notifier.subscribe(['item'], ({ event }) => {
				if (!this.active) return;
				if (event === 'modify' || event === 'add' || event === 'trash' || event === 'restore') {
					this.scheduleLibraryRefresh();
				}
			}),
		);

		for (const win of this.getMainWindows()) {
			this.onMainWindowLoad(win);
		}
	}

	onMainWindowLoad(win: Window): void {
		if (!this.active || !win) return;
		this.windows.add(win);
		this.titleHeatmap.attachWindow(win);
		this.galleryBoard.attachWindow(win);
		if (!this.kernel.prefs.get('visualNotes.statusSyncZoteroTagColor')) {
			this.runStatusTagDotSync(false);
		}
	}

	onMainWindowUnload(win: Window): void {
		closeHubPage(win);
		closeStatusPickerPopover(win?.document);
		closeVisualColumnPopover(win?.document);
		this.windows.delete(win);
		this.titleHeatmap.detachWindow(win);
		this.galleryBoard.detachWindow(win);
	}

	scheduleLibraryRefresh(delayMs = 50): void {
		if (!this.active) return;
		if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = null;
			if (this.active) this.refreshLibraryViews();
		}, delayMs);
	}

	refreshLibraryViews(): void {
		if (!this.active) return;
		if (this.refreshTimer !== null) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.readingColumns.refreshColumns();
		this.statusRatingColumns.refreshColumns();
		this.remarkColumn.refresh();
		this.infoBriefNote.refresh();
		this.titleHeatmap.refreshWindows();
		this.galleryBoard.refreshWindows();
	}

	openCollectionHub(win: Window, initialTab?: 'annotations' | 'notes'): void {
		if (!this.active || !win || !this.kernel.prefs.get('visualNotes.collectionHub.enable')) return;
		openCollectionNotesHubModal({
			win,
			prefs: this.kernel.prefs,
			bus: this.kernel.bus,
			clipboard: this.services.clipboard,
			dataSource: this.dataSource,
			initialTab,
			onRemarkMutated: () => {
				this.remarkColumn.refresh();
				this.infoBriefNote.refresh();
				this.galleryBoard.refreshWindows();
			},
		});
	}

	openMatrixModal(win: Window, title: string, itemIDs: readonly number[]): void {
		if (!this.active) return;
		openAnnotationMatrixModal({
			win,
			title,
			itemIDs,
			prefs: this.kernel.prefs,
			bus: this.kernel.bus,
			clipboard: this.services.clipboard,
		});
	}

	openCurrentMatrix(win: Window): void {
		if (!this.active || !win) return;
		const ids: number[] = [];
		const seen = new Set<number>();
		const pushItem = (raw: any) => {
			if (!raw) return;
			const pid = Number(raw.parentItemID || raw.id || 0);
			if (pid > 0 && !seen.has(pid)) { seen.add(pid); ids.push(pid); }
		};
		const selected = (win as any).ZoteroPane?.getSelectedItems?.() || [];
		for (const item of selected) pushItem(item);
		const tabs: any[] = (win as any).Zotero_Tabs?._tabs || [];
		const hostItems = (globalThis as any).Zotero?.Items;
		for (const t of tabs) {
			const itemID = Number(t?.data?.itemID || 0);
			if (itemID > 0) pushItem(hostItems?.get?.(itemID) || { id: itemID });
		}
		this.openMatrixModal(win, selected.length ? '已选与已开文献' : '已开文献', ids);
	}

	stop(): void {
		if (!this.active) return;
		this.active = false;
		bindCustomStatusColorPersistence(null);
		if (this.refreshTimer !== null) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.infoBriefNote.unregister();
		this.remarkColumn.unregister();
		this.readingColumns.unregisterAll();
		this.statusRatingColumns.unregisterAll();
		this.galleryBoard.disposeAll();
		this.titleHeatmap.disposeAll();
		this.annotationTools.unregister();
		for (const win of this.windows) closeHubPage(win);
		this.windows.clear();
		this.disposables.disposeAll();
	}

	private runStatusTagDotSync(enable: boolean): void {
		const excluded = String(this.kernel.prefs.get('wordCite.citationTags.text') || '/Citations');
		void syncNativeStatusTagDots(enable, excluded).then((changed) => {
			if (this.active && changed > 0) this.refreshLibraryViews();
		}).catch(() => {});
	}

	private syncFeatureStates(): void {
		if (this.kernel.prefs.get('visualNotes.infoBriefNote.enable')) this.infoBriefNote.register();
		else this.infoBriefNote.unregister();

		if (this.kernel.prefs.get('workspace.remarkColumn.enable')) this.remarkColumn.register();
		else this.remarkColumn.unregister();

		this.readingColumns.syncColumns();
		this.statusRatingColumns.syncColumns();
		this.titleHeatmap.sync(this.windows);
		this.galleryBoard.sync(this.windows);
	}

	private getMainWindows(): Window[] {
		const wins = (globalThis as any).Zotero?.getMainWindows?.();
		return Array.isArray(wins) ? wins : [];
	}
}
