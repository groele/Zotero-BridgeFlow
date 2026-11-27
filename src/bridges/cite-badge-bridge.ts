import { DisposableStack } from '../kernel/disposable.ts';
import type { WorkspacePort } from '../kernel/domain-ports.ts';
import type { PluginKernel } from '../kernel/plugin-kernel.ts';
import type { BridgeModule, CitationBadgeInfo, CitationSnapshotPayload } from '../kernel/types.ts';

export type CiteBadgeWorkspacePort = Pick<WorkspacePort, 'setCitationBadges'>;

/**
 * Bridge 2: Word Citation State -> Workspace Sidebar Live Ordinal Badges.
 */
export class CiteBadgeBridge implements BridgeModule {
	public readonly id = 'cite-badge-bridge';
	public readonly requires = ['workspace', 'word-cite'] as const;
	private readonly disposables = new DisposableStack();
	private lastSnapshot: CitationSnapshotPayload | null = null;

	private readonly kernel: PluginKernel;
	private readonly workspace?: CiteBadgeWorkspacePort;

	constructor(kernel: PluginKernel, workspace?: CiteBadgeWorkspacePort) {
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
		const initial = this.kernel.ports.get('word-cite')?.getSnapshot() ?? null;
		if (initial) {
			this.lastSnapshot = initial;
			this.pushBadges();
		}
	}

	stop(): void {
		this.disposables.disposeAll();
		this.applyBadges(new Map());
		this.lastSnapshot = null;
	}

	private pushBadges(): void {
		if (!this.kernel.prefs.get('fusion.sidebarCiteBadge') || !this.lastSnapshot) {
			this.applyBadges(new Map());
			return;
		}
		this.applyBadges(this.lastSnapshot.byItemID);
	}

	private applyBadges(badges: ReadonlyMap<number, CitationBadgeInfo>): void {
		const port = this.kernel.ports.get('workspace');
		if (port) port.setCitationBadges(badges);
		else this.workspace?.setCitationBadges(badges);
	}
}
