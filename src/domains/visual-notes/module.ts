import { DisposableStack } from '../../kernel/disposable.ts';
import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { DomainModule } from '../../kernel/types.ts';
import type { ServiceContainer } from '../../services/service-container.ts';
import { openAnnotationMatrixModal } from './annotation-matrix-modal.ts';
import { ReaderAnnotationTools } from './annotation-tools.ts';
import type { VisualNotesDataSource } from './data-source.ts';
import { InfoBriefNoteController } from './info-brief-note.ts';
import { ReadingColumnsController, RemarkColumnController } from './library-columns.ts';
import { TitleHeatmapController } from './title-heatmap.ts';

export class VisualNotesDomainModule implements DomainModule {
	public readonly id = 'visual-notes' as const;
	public readonly enabledPref = 'modules.visualNotes.enable' as const;

	public readonly infoBriefNote: InfoBriefNoteController;
	public readonly remarkColumn: RemarkColumnController;
	public readonly readingColumns: ReadingColumnsController;
	public readonly titleHeatmap: TitleHeatmapController;
	public readonly annotationTools: ReaderAnnotationTools;

	private readonly kernel: PluginKernel;
	private readonly services: ServiceContainer;
	private readonly disposables = new DisposableStack();
	private readonly windows = new Set<Window>();
	private active = false;
	private refreshTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(kernel: PluginKernel, services: ServiceContainer) {
		this.kernel = kernel;
		this.services = services;
		this.remarkColumn = new RemarkColumnController(kernel);
		this.readingColumns = new ReadingColumnsController(kernel);
		this.infoBriefNote = new InfoBriefNoteController(kernel, () => {
			this.remarkColumn.refresh();
		});
		this.titleHeatmap = new TitleHeatmapController(kernel, (item) => this.readingColumns.getReadProgressForItem(item));
		this.annotationTools = new ReaderAnnotationTools(kernel);
	}

	setDataSource(source?: VisualNotesDataSource): void {
		this.infoBriefNote.setDataSource(source);
		this.remarkColumn.setDataSource(source);
		this.readingColumns.setDataSource(source);
	}

	isActive(): boolean {
		return this.active;
	}

	start(): void {
		if (this.active) return;
		this.active = true;
		this.disposables.reset();

		this.syncFeatureStates();
		this.annotationTools.register();

		this.disposables.add(
			this.kernel.prefs.observeKeys(
				[
					'visualNotes.infoBriefNote.enable',
					'workspace.remarkColumn.enable',
					'workspace.readingColumn.enable',
					'workspace.readingTitleHeatmap.enable',
					'workspace.readingHeatmap.color',
					'workspace.readingHeatmap.opacity',
					'workspace.annotationColumn.enable',
					'inspector.annotations.popupLabelsEnable',
					'inspector.annotations.colorLabels',
				],
				(key) => {
					if (!this.active) return;
					this.syncFeatureStates();
					if (key === 'inspector.annotations.popupLabelsEnable' || key === 'inspector.annotations.colorLabels') {
						this.annotationTools.popupLabels.sync();
					}
					if (key === 'inspector.annotations.colorLabels') {
						this.readingColumns.refreshColumns();
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
	}

	onMainWindowUnload(win: Window): void {
		this.windows.delete(win);
		this.titleHeatmap.detachWindow(win);
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
		this.remarkColumn.refresh();
		this.infoBriefNote.refresh();
		this.titleHeatmap.refreshWindows();
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
		if (this.refreshTimer !== null) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.infoBriefNote.unregister();
		this.remarkColumn.unregister();
		this.readingColumns.unregisterAll();
		this.titleHeatmap.disposeAll();
		this.annotationTools.unregister();
		this.windows.clear();
		this.disposables.disposeAll();
	}

	private syncFeatureStates(): void {
		if (this.kernel.prefs.get('visualNotes.infoBriefNote.enable')) this.infoBriefNote.register();
		else this.infoBriefNote.unregister();

		if (this.kernel.prefs.get('workspace.remarkColumn.enable')) this.remarkColumn.register();
		else this.remarkColumn.unregister();

		this.readingColumns.syncColumns();
		this.titleHeatmap.sync(this.windows);
	}

	private getMainWindows(): Window[] {
		const wins = (globalThis as any).Zotero?.getMainWindows?.();
		return Array.isArray(wins) ? wins : [];
	}
}
