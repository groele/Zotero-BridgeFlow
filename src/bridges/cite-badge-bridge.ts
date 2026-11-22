import type { WorkspaceDomainModule } from '../domains/workspace/module.ts';
import { DisposableStack } from '../kernel/disposable.ts';
import type { PluginKernel } from '../kernel/plugin-kernel.ts';
import type { BridgeModule, CitationSnapshotPayload } from '../kernel/types.ts';

/**
 * Bridge 2: Word Citation State -> Workspace Sidebar Live Ordinal Badges.
 */
export class CiteBadgeBridge implements BridgeModule {
	public readonly id = 'cite-badge-bridge';
	private readonly disposables = new DisposableStack();
	private lastSnapshot: CitationSnapshotPayload | null = null;

	private readonly kernel: PluginKernel;
	private readonly workspace: WorkspaceDomainModule;

	constructor(kernel: PluginKernel, workspace: WorkspaceDomainModule) {
		this.kernel = kernel;
		this.workspace = workspace;
	}

	start(): void {
		this.disposables.reset();
		this.disposables.add(
			this.kernel.bus.on('citation:snapshot-updated', (snapshot) => {
				this.lastSnapshot = snapshot;
				this.pushBadges();
			}),
		);
		this.disposables.add(
			this.kernel.prefs.observeKeys(['fusion.sidebarCiteBadge'], () => this.pushBadges()),
		);
	}

	stop(): void {
		this.disposables.disposeAll();
		this.workspace.setCitationBadges(new Map());
		this.lastSnapshot = null;
	}

	private pushBadges(): void {
		if (!this.kernel.prefs.get('fusion.sidebarCiteBadge') || !this.lastSnapshot) {
			this.workspace.setCitationBadges(new Map());
			return;
		}
		this.workspace.setCitationBadges(this.lastSnapshot.byItemID);
	}
}
