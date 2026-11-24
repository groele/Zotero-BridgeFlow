import { DisposableStack } from '../../kernel/disposable.ts';
import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { DomainModule } from '../../kernel/types.ts';
import { deduplicateRegularItems } from '../../services/item-resolution.ts';
import type { ServiceContainer } from '../../services/service-container.ts';
import { WordCitationCollectionManager } from './citation-collections.ts';
import { CitationColumnController } from './citation-column.ts';
import { DragCiteController } from './drag-cite-controller.ts';
import { WordSessionTracker } from './session-tracker.ts';
import { CitationTagGovernance } from './tag-governance.ts';
import { refreshActiveWordDocument, resolveActiveSelectionForWord } from './word-inserter.ts';
import { WordIntegrationPoller } from './word-poller.ts';

export class WordCiteDomainModule implements DomainModule {
	public readonly id = 'word-cite' as const;
	public readonly enabledPref = 'modules.wordCite.enable';
	public readonly tracker: WordSessionTracker;
	public readonly tagGovernance: CitationTagGovernance;
	public readonly dragCite: DragCiteController;
	public readonly collections: WordCitationCollectionManager;

	private readonly column: CitationColumnController;
	private readonly poller: WordIntegrationPoller;
	private readonly disposables = new DisposableStack();
	private tagDebounceTimer: number | null = null;
	private active = false;

	private readonly kernel: PluginKernel;

	constructor(kernel: PluginKernel, services: ServiceContainer) {
		this.kernel = kernel;
		this.tracker = new WordSessionTracker(kernel.bus, services.win32);
		this.tagGovernance = new CitationTagGovernance(kernel.prefs);
		this.collections = new WordCitationCollectionManager(kernel);
		this.poller = new WordIntegrationPoller(kernel, this.tracker, services.win32);
		this.dragCite = new DragCiteController(kernel, services.win32, (session) => {
			void this.poller.notifyCommittedSession(session).catch((err) => this.kernel.logger.error('word-cite:poll', err));
		});
		this.column = new CitationColumnController(kernel, this.tracker, this.collections);
	}

	isActive(): boolean {
		return this.active;
	}

	async citeCurrentSelection(win?: Window): Promise<void> {
		const items = resolveActiveSelectionForWord(win);
		if (items.length) await this.dragCite.insertItems(items);
	}

	async resyncNow(): Promise<boolean> {
		if (!this.active) return false;
		const ok = await this.poller.notifyCommittedSession();
		this.tracker.emitCurrentSnapshot();
		return ok;
	}

	start(): void {
		if (this.active) return;
		this.active = true;
		this.disposables.reset();
		void this.collections.purgeStaleCollections();
		if (this.kernel.prefs.get('wordCite.column.enable')) this.column.register();
		this.poller.start();

		this.disposables.add(
			this.kernel.prefs.observeKeys(['wordCite.column.enable'], () => {
				if (!this.active) return;
				if (this.kernel.prefs.get('wordCite.column.enable')) this.column.register();
				else this.column.unregister();
			}),
		);

		this.disposables.add(
			this.kernel.bus.on('citation:snapshot-updated', () => {
				this.scheduleTagSync();
				this.collections.sync(this.tracker.getAllSessions());
			}),
		);

		this.disposables.add(
			this.kernel.prefs.observeKeys(
				['wordCite.citationTags.enable', 'wordCite.citationTags.text'],
				() => this.scheduleTagSync(),
			),
		);

		this.disposables.add(
			this.kernel.prefs.observeKeys(
				['wordCite.collections.enable'],
				() => this.collections.sync(this.tracker.getAllSessions()),
			),
		);

		this.disposables.add(
			this.kernel.bus.on('word:insert-items-request', async ({ itemIDs, requestId }) => {
				if (!this.active) return;
				let itemCount = 0;
				let documentName = '';
				let status: Awaited<ReturnType<DragCiteController['insertItems']>> = 'unavailable';
				try {
					const hostItems = (globalThis as any).Zotero?.Items;
					const { items } = deduplicateRegularItems(itemIDs.map((id) => hostItems?.get?.(id)));
					itemCount = items.length;
					status = await this.dragCite.insertItems(items, (sessionID) => {
						documentName = this.tracker.getAllSessions().find((session) => session.sessionID === sessionID)?.displayName || '';
					});
				} catch (err) {
					this.kernel.logger.error('word-cite:insert-request', err);
				}
				this.kernel.bus.emit('word:insert-result', { requestId, status, documentName, itemCount });
			}),
		);

		this.disposables.add(
			this.kernel.bus.on('word:refresh-request', async ({ requestId }) => {
				if (!this.active) return;
				const docName = this.tracker.getActiveSession()?.displayName || '';
				const ok = await refreshActiveWordDocument(this.kernel);
				if (ok) {
					void this.poller.notifyCommittedSession().catch((err) => this.kernel.logger.error('word-cite:poll', err));
				}
				this.kernel.bus.emit('word:refresh-result', { requestId, ok, documentName: docName });
			}),
		);

		this.disposables.add(
			this.kernel.bus.on('word:snapshot-query', () => {
				if (this.active) this.tracker.emitCurrentSnapshot();
			}),
		);

		this.disposables.add(
			this.kernel.bus.on('word:switch-session-request', ({ sessionID }) => {
				if (this.active && !this.tracker.setActiveSession(sessionID)) {
					this.tracker.emitCurrentSnapshot();
				}
			}),
		);

		this.disposables.add(
			this.kernel.bus.on('word:select-collection-request', ({ sessionID, win }) => {
				if (!this.active) return;
				const sid = sessionID || this.tracker.getActiveSession()?.sessionID || null;
				this.collections.selectSessionCollection(win, sid);
			}),
		);
	}

	onMainWindowLoad(win: Window): void {
		if (!this.active) return;
		this.dragCite.attachWindow(win);
		this.collections.attachWindow(win);
	}

	onMainWindowUnload(win: Window): void {
		this.dragCite.detachWindow(win);
		this.collections.detachWindow(win);
	}

	stop(): void {
		if (!this.active) return;
		this.active = false;
		if (this.tagDebounceTimer !== null) {
			clearTimeout(this.tagDebounceTimer);
			this.tagDebounceTimer = null;
		}
		this.poller.stop();
		this.column.unregister();
		this.dragCite.disposeAll();
		void this.collections.clearAll();
		this.tracker.clear();
		this.disposables.disposeAll();
	}

	private scheduleTagSync(): void {
		if (this.tagDebounceTimer !== null) clearTimeout(this.tagDebounceTimer);
		const delay = this.kernel.prefs.get('wordCite.citationTagDebounceMs');
		this.tagDebounceTimer = setTimeout(() => {
			this.tagDebounceTimer = null;
			if (!this.active) return;
			void this.tagGovernance.syncCitedItems(this.tracker.getUnionCitedItemIDs());
		}, Math.max(0, delay));
	}
}
