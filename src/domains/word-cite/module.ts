import { DisposableStack } from '../../kernel/disposable.ts';
import { tLocale } from '../../kernel/locale.ts';
import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { CitationSnapshotPayload, DomainModule } from '../../kernel/types.ts';
import { deduplicateRegularItems } from '../../services/item-resolution.ts';
import type { ServiceContainer } from '../../services/service-container.ts';
import { WordCitationCollectionManager } from './citation-collections.ts';
import { CitationColumnController } from './citation-column.ts';
import { DragCiteController } from './drag-cite-controller.ts';
import { clearRelinkedItemUris } from './orphan-identity.ts';
import { recoverOrphanCitations } from './orphan-recovery.ts';
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
	private readonly notifiedOrphanSigs = new Map<string, string>();
	private tagDebounceTimer: number | null = null;
	private recoveringOrphans = false;
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

		this.disposables.add(
			this.kernel.bus.on('word:recover-orphans-request', async ({ sessionID, keys, requestId }) => {
				if (!this.active) return;
				if (this.recoveringOrphans) {
					this.kernel.bus.emit('word:recover-orphans-result', {
						requestId,
						restoredCount: 0,
						importedCount: 0,
						skippedCount: 0,
						error: tLocale('正在执行缺失引文恢复，请稍候重试。', 'Citation recovery is already in progress.'),
					});
					return;
				}
				const targetSession = (sessionID ? this.tracker.getSession(sessionID) : undefined) || this.tracker.getActiveSession();
				if (!targetSession || !targetSession.orphans.length) {
					this.kernel.bus.emit('word:recover-orphans-result', {
						requestId,
						restoredCount: 0,
						importedCount: 0,
						skippedCount: 0,
					});
					return;
				}
				this.recoveringOrphans = true;
				try {
					const col = this.collections.getSessionCollection(targetSession.sessionID);
					const result = await recoverOrphanCitations(targetSession.orphans, {
						targetCollectionID: typeof col?.id === 'number' ? col.id : undefined,
						collectionName: col?.name ? String(col.name) : targetSession.displayName,
						keys,
					});
					const changed = result.restoredCount > 0
						|| result.importedCount > 0
						|| (result.existingCount ?? 0) > 0
						|| (result.relinkedCount ?? 0) > 0;
					let refreshed = false;
					if (changed) {
						if (targetSession.sessionID === this.tracker.getActiveSession()?.sessionID) {
							refreshed = await refreshActiveWordDocument(this.kernel).catch((err) => {
								this.kernel.logger.error('word-cite:recover-refresh', err);
								return false;
							});
						}
						await this.resyncNow().catch((err) => this.kernel.logger.error('word-cite:recover-resync', err));
					}
					this.kernel.bus.emit('word:recover-orphans-result', {
						...result,
						...(refreshed ? { refreshed: true } : {}),
						requestId,
					});
				} catch (err) {
					this.kernel.logger.error('word-cite:recover-orphans', err);
					this.kernel.bus.emit('word:recover-orphans-result', {
						requestId,
						restoredCount: 0,
						importedCount: 0,
						skippedCount: targetSession.orphans.length,
						error: tLocale('恢复缺失引文时发生数据库错误，事务已安全回滚。', 'Failed to recover orphan citations; transaction safely rolled back.'),
					});
				} finally {
					this.recoveringOrphans = false;
				}
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
		this.recoveringOrphans = false;
		this.notifiedOrphanSigs.clear();
		clearRelinkedItemUris();
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

	private notifyOrphansIfNeeded(snap: CitationSnapshotPayload): void {
		if (!this.active || this.recoveringOrphans) return;
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
					`「${ses.documentName}」检测到 ${orphans.length} 篇缺失/回收站引文（${ordText}），请在右侧「Word 引用」面板一键还原并重连。`,
					`"${ses.documentName}" has ${orphans.length} missing/trashed citation(s) (${ordText}). Open the Word Cite panel to recover & relink.`,
				));
				pw.show();
				pw.startCloseTimer(5500);
			} catch { /* headless safe */ }
		}
	}
}
