import { DisposableStack } from '../../kernel/disposable.ts';
import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { DomainModule } from '../../kernel/types.ts';
import type { ServiceContainer } from '../../services/service-container.ts';
import { CitationColumnController } from './citation-column.ts';
import { DragCiteController } from './drag-cite-controller.ts';
import { WordSessionTracker } from './session-tracker.ts';
import { CitationTagGovernance } from './tag-governance.ts';

export class WordCiteDomainModule implements DomainModule {
	public readonly id = 'word-cite' as const;
	public readonly enabledPref = 'modules.wordCite.enable';
	public readonly tracker: WordSessionTracker;
	public readonly tagGovernance: CitationTagGovernance;
	public readonly dragCite: DragCiteController;

	private readonly column: CitationColumnController;
	private readonly disposables = new DisposableStack();
	private active = false;

	private readonly kernel: PluginKernel;

	constructor(kernel: PluginKernel, services: ServiceContainer) {
		this.kernel = kernel;
		this.tracker = new WordSessionTracker(kernel.bus, services.win32);
		this.tagGovernance = new CitationTagGovernance(kernel.prefs);
		this.dragCite = new DragCiteController(kernel, services.win32);
		this.column = new CitationColumnController(kernel, this.tracker);
	}

	isActive(): boolean {
		return this.active;
	}

	start(): void {
		if (this.active) return;
		this.active = true;
		this.disposables.reset();
		this.column.register();

		this.disposables.add(
			this.kernel.bus.on('citation:snapshot-updated', () => {
				void this.tagGovernance.syncCitedItems(this.tracker.getUnionCitedItemIDs());
			}),
		);

		this.disposables.add(
			this.kernel.prefs.observeKeys(
				['wordCite.citationTags.enable', 'wordCite.citationTags.text'],
				() => {
					void this.tagGovernance.syncCitedItems(this.tracker.getUnionCitedItemIDs());
				},
			),
		);
	}

	onMainWindowLoad(win: Window): void {
		if (!this.active) return;
		this.dragCite.attachWindow(win);
	}

	onMainWindowUnload(win: Window): void {
		this.dragCite.detachWindow(win);
	}

	stop(): void {
		if (!this.active) return;
		this.active = false;
		this.column.unregister();
		this.dragCite.disposeAll();
		this.tracker.clear();
		this.disposables.disposeAll();
	}
}
