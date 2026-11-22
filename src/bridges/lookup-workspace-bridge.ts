import type { WorkspaceDomainModule } from '../domains/workspace/module.ts';
import { DisposableStack } from '../kernel/disposable.ts';
import type { PluginKernel } from '../kernel/plugin-kernel.ts';
import type { BridgeModule } from '../kernel/types.ts';

/**
 * Bridge 4: Reverse Lookup / PDF Compare -> Smart Workspace Tab Focus or Grouped Open.
 */
export class LookupWorkspaceBridge implements BridgeModule {
	public readonly id = 'lookup-workspace-bridge';
	private readonly disposables = new DisposableStack();

	private readonly kernel: PluginKernel;
	private readonly workspace: WorkspaceDomainModule;

	constructor(kernel: PluginKernel, workspace: WorkspaceDomainModule) {
		this.kernel = kernel;
		this.workspace = workspace;
	}

	start(): void {
		this.disposables.reset();
		this.disposables.add(
			this.kernel.bus.on('workspace:open-item-request', async (req) => {
				if (!this.workspace.isActive()) return;
				await this.workspace.focusOrOpenItem({
					...req,
					preferExistingTab: req.preferExistingTab ?? this.kernel.prefs.get('fusion.lookupJumpExistingTab'),
				});
			}),
		);
	}

	stop(): void {
		this.disposables.disposeAll();
	}
}
