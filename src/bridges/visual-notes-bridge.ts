import type { VisualNotesPort } from '../kernel/domain-ports.ts';
import type { PluginKernel } from '../kernel/plugin-kernel.ts';
import type { BridgeModule, Disposable } from '../kernel/types.ts';
import { syncItemRemarkToExtra } from '../services/item-remark-sync.ts';
import {
	resolveReadingNotesFacade,
	type ReadingNotesFacadeProvider,
	type SharedReadingNotesFacade,
	type VisualNotesDataSource,
} from '../services/shared-reading-notes.ts';

export type VisualNotesBridgeTarget = Pick<VisualNotesPort, 'refreshLibraryViews'> & {
	setDataSource(source?: VisualNotesDataSource): void;
};

export class VisualNotesBridge implements BridgeModule {
	public readonly id = 'visual-notes-bridge';
	public readonly requires = ['workspace', 'visual-notes'] as const;

	private readonly kernel: PluginKernel;
	private readonly workspace: ReadingNotesFacadeProvider;
	private readonly visualNotes: VisualNotesBridgeTarget;
	private disposeFacadeListener: Disposable | null = null;
	private readingRevision = 1;
	private remarksRevision = 1;
	private active = false;

	constructor(
		kernel: PluginKernel,
		workspace: ReadingNotesFacadeProvider,
		visualNotes: VisualNotesBridgeTarget,
	) {
		this.kernel = kernel;
		this.workspace = workspace;
		this.visualNotes = visualNotes;
	}

	start(): void {
		if (this.active) return;
		this.active = true;
		const facade: SharedReadingNotesFacade = resolveReadingNotesFacade(this.workspace);

		this.visualNotes.setDataSource({
			getReadingProgress: (itemID) => facade.getReadingProgress(itemID),
			getReadingRevision: () => this.readingRevision,
			getRemark: (itemID) => facade.getRemark(itemID),
			getRemarksRevision: () => this.remarksRevision,
			persistRemarks: () => facade.persistRemarks(),
			setRemark: (itemID, remark, skipExtraObserver) => {
				facade.setRemark(itemID, remark, skipExtraObserver);
				facade.refreshWorkspaceViews();
			},
		});

		this.disposeFacadeListener = facade.subscribe((ev) => {
			if (!this.active) return;
			if (ev.kind === 'reading') {
				this.readingRevision += 1;
				this.refreshVisualNotes(undefined, true);
				return;
			}
			this.remarksRevision += 1;
			if (ev.kind === 'notes-local-clear' || ev.kind === 'import') {
				this.readingRevision += 1;
				this.refreshVisualNotes();
				return;
			}
			if (this.kernel.prefs.get('workspace.syncRemarkToExtra') && ev.syncExtraEntries?.length) {
				for (const entry of ev.syncExtraEntries) {
					void syncItemRemarkToExtra(entry.itemID, entry.remark).catch(() => {});
				}
			}
			if (ev.changedItemIDs && ev.changedItemIDs.size > 0) {
				this.refreshVisualNotes(ev.changedItemIDs);
			}
		});
	}

	stop(): void {
		if (!this.active) return;
		this.active = false;
		this.disposeFacadeListener?.();
		this.disposeFacadeListener = null;
		this.visualNotes.setDataSource(undefined);
	}

	private refreshVisualNotes(affectedIDs?: Iterable<number>, readingOnly = false): void {
		const port = this.kernel.ports.get('visual-notes');
		if (port) port.refreshLibraryViews(affectedIDs, readingOnly);
		else this.visualNotes.refreshLibraryViews(affectedIDs, readingOnly);
	}
}
