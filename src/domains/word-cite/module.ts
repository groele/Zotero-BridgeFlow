import { DisposableStack } from '../../kernel/disposable.ts';
import { tLocale } from '../../kernel/locale.ts';
import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { CitationSnapshotPayload, DomainModule } from '../../kernel/types.ts';
import type { ServiceContainer } from '../../services/service-container.ts';
import type { Win32BridgeService } from '../../services/win32-bridge.ts';
import { WordCitationCollectionManager } from './governance/citation-collections.ts';
import { CitationColumnController } from './governance/citation-column.ts';
import { DragCiteController } from './ipc/drag-cite-controller.ts';
import { clearRelinkedItemUris } from './orphan/orphan-identity.ts';
import { WordSessionTracker } from './ipc/session-tracker.ts';
import { CitationTagGovernance } from './governance/tag-governance.ts';
import { registerWordCiteBusHandlers } from './word-cite-bus.ts';
import { resolveActiveSelectionForWord } from './ipc/word-inserter.ts';
import { WordIntegrationPoller } from './ipc/word-poller.ts';

export class WordCiteDomainModule implements DomainModule {
	public readonly id = 'word-cite' as const;
	public readonly enabledPref = 'modules.wordCite.enable';
	public readonly tracker: WordSessionTracker;
	public readonly tagGovernance: CitationTagGovernance;
	public readonly dragCite: DragCiteController;
	public readonly collections: WordCitationCollectionManager;

	private readonly column: CitationColumnController;
	private readonly poller: WordIntegrationPoller;
	private readonly win32: Win32BridgeService;
	private readonly disposables = new DisposableStack();
	private readonly notifiedOrphanSigs = new Map<string, string>();
	private tagDebounceTimer: number | null = null;
	private recoveringOrphans = false;
	private active = false;

	private readonly kernel: PluginKernel;

	constructor(kernel: PluginKernel, services: ServiceContainer) {
		this.kernel = kernel;
		this.win32 = services.win32;
		this.tracker = new WordSessionTracker(kernel.bus, services.win32);
		this.tagGovernance = new CitationTagGovernance(kernel.prefs);
		this.collections = new WordCitationCollectionManager(kernel);
		this.poller = new WordIntegrationPoller(kernel, this.tracker, services.win32);
		this.dragCite = new DragCiteController(kernel, services.win32, (session) => {
			void this.poller.notifyCommittedSession(session).catch((err) => this.kernel.logger.error('word-cite:poll', err));
		});
		this.column = new CitationColumnController(kernel, this.tracker, this.collections);
	}

	isActive(): boolean { return this.active; }

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
		this.notifiedOrphanSigs.clear();
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
			this.kernel.bus.on('citation:snapshot-updated', (snap) => {
				this.scheduleTagSync();
				this.collections.sync(this.tracker.getAllSessions());
				this.notifyOrphansIfNeeded(snap);
			}),
		);

		this.disposables.add(
			this.kernel.prefs.observeKeys(['wordCite.citationTags.enable', 'wordCite.citationTags.text'], () => this.scheduleTagSync()),
		);

		this.disposables.add(
			this.kernel.prefs.observeKeys(['wordCite.collections.enable'], () => this.collections.sync(this.tracker.getAllSessions())),
		);

		registerWordCiteBusHandlers(
			{
				kernel: this.kernel,
				tracker: this.tracker,
				collections: this.collections,
				poller: this.poller,
				dragCite: this.dragCite,
				win32: this.win32,
				isActive: () => this.active,
				isRecovering: () => this.recoveringOrphans,
				setRecovering: (v) => { this.recoveringOrphans = v; },
				resyncNow: () => this.resyncNow(),
			},
			this.disposables,
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
		this.recoveringOrphans = false;
		this.notifiedOrphanSigs.clear();
		clearRelinkedItemUris();
		this.disposables.disposeAll();
		this.poller.stop();
		this.column.unregister();
		this.dragCite.disposeAll();
		void this.collections.clearAll();
		if (!this.kernel.prefs.get('modules.wordCite.enable')) {
			void this.tagGovernance.stripAllManagedTags();
		}
		this.tracker.clear();
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

	private notifyOrphansIfNeeded(snap: CitationSnapshotPayload): void {
		if (!this.active || this.recoveringOrphans || !this.kernel.prefs.get('wordCite.orphans.toastEnable')) return;
		const sessions = snap.sessions || [];
		const openIDs = new Set(sessions.map((s) => s.sessionID));
		for (const sid of this.notifiedOrphanSigs.keys()) {
			if (!openIDs.has(sid)) this.notifiedOrphanSigs.delete(sid);
		}
		for (const ses of sessions) {
			const orphans = ses.orphans || [];
			if (!orphans.length) {
				this.notifiedOrphanSigs.delete(ses.sessionID);
				continue;
			}
			const sig = orphans.map((o) => `${o.key}:${o.kind}`).sort().join('|');
			if (this.notifiedOrphanSigs.get(ses.sessionID) === sig) continue;
			this.notifiedOrphanSigs.set(ses.sessionID, sig);
			try {
				const PW = (globalThis as any).Zotero?.ProgressWindow;
				if (typeof PW !== 'function') continue;
				const ordText = orphans.slice(0, 4).map((o) => `[${o.ordinal}]`).join(' ') + (orphans.length > 4 ? '…' : '');
				const pw = new PW();
				pw.changeHeadline(tLocale('Zotero BridgeFlow · 缺失引文提示', 'Zotero BridgeFlow · Missing Citations'));
				pw.addDescription(tLocale(
					`「${ses.documentName}」检测到 ${orphans.length} 篇缺失/回收站引文（${ordText}），可在右侧「Word 引用」面板或按 Ctrl+P（输入 >）一键找回并重连。`,
					`"${ses.documentName}" has ${orphans.length} broken citation(s) (${ordText}). Recover via Word Cite panel or Ctrl+P (>).`,
				));
				pw.show();
				pw.startCloseTimer(5500);
			} catch { /* headless safe */ }
		}
	}
}
