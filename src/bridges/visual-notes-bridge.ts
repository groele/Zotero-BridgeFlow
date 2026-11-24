import type { VisualNotesDomainModule } from '../domains/visual-notes/module.ts';
import type { WorkspaceDomainModule } from '../domains/workspace/module.ts';
import type { PluginKernel } from '../kernel/plugin-kernel.ts';
import type { BridgeModule } from '../kernel/types.ts';
import { syncItemRemarkToExtra } from '../services/item-remark-sync.ts';

export class VisualNotesBridge implements BridgeModule {
	public readonly id = 'visual-notes-bridge';
	private readonly kernel: PluginKernel;
	private readonly workspace: WorkspaceDomainModule;
	private readonly visualNotes: VisualNotesDomainModule;
	private prevRemarks = new Map<string, string>();
	private disposeStoreListener: (() => void) | null = null;
	private active = false;

	constructor(
		kernel: PluginKernel,
		workspace: WorkspaceDomainModule,
		visualNotes: VisualNotesDomainModule,
	) {
		this.kernel = kernel;
		this.workspace = workspace;
		this.visualNotes = visualNotes;
	}

	start(): void {
		if (this.active) return;
		this.active = true;
		this.seedRemarks();

		this.visualNotes.setDataSource({
			getReadingProgress: (itemID) => this.workspace.store.state.readingProgress[`item:${itemID}`],
			getRemark: (itemID) => this.workspace.store.state.remarks[`item:${itemID}`] || '',
			setRemark: (itemID, remark) => {
				this.workspace.store.setRemark(`item:${itemID}`, remark);
				this.workspace.refreshAllWindows();
			},
		});

		this.disposeStoreListener = this.workspace.store.onChange(() => {
			if (!this.active) return;
			this.syncChangedRemarksToExtra();
			this.visualNotes.refreshLibraryViews();
		});
	}

	stop(): void {
		if (!this.active) return;
		this.active = false;
		this.disposeStoreListener?.();
		this.disposeStoreListener = null;
		this.visualNotes.setDataSource(undefined);
	}

	private seedRemarks(): void {
		this.prevRemarks.clear();
		for (const [k, v] of Object.entries(this.workspace.store.state.remarks)) {
			this.prevRemarks.set(k, v);
		}
	}

	private syncChangedRemarksToExtra(): void {
		const current = this.workspace.store.state.remarks;
		const changedKeys: Array<{ key: string; value: string }> = [];
		for (const [k, v] of Object.entries(current)) {
			if (this.prevRemarks.get(k) !== v) changedKeys.push({ key: k, value: v });
		}
		for (const k of this.prevRemarks.keys()) {
			if (!(k in current)) changedKeys.push({ key: k, value: '' });
		}
		if (!changedKeys.length) return;
		this.seedRemarks();
		if (!this.kernel.prefs.get('workspace.syncRemarkToExtra')) return;
		for (const entry of changedKeys) {
			const vm = this.workspace.store.state.virtualMembers[entry.key];
			const match = entry.key.match(/^item:(\d+)$/);
			const itemID = Number(vm?.parentItemID || vm?.itemID || (match ? match[1] : 0));
			if (itemID > 0) {
				void syncItemRemarkToExtra(itemID, entry.value).catch(() => {});
			}
		}
	}
}
