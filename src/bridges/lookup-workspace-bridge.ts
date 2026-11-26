import type { WorkspaceDomainModule } from '../domains/workspace/module.ts';
import { DisposableStack } from '../kernel/disposable.ts';
import type { PluginKernel } from '../kernel/plugin-kernel.ts';
import type { BridgeModule } from '../kernel/types.ts';

/**
 * Bridge 4: Reverse Lookup / PDF Compare -> Smart Workspace Tab Focus or Grouped Open.
 */
export class LookupWorkspaceBridge implements BridgeModule {
	public readonly id = 'lookup-workspace-bridge';
	public readonly requires = ['workspace'] as const;
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
				const payload = {
					...req,
					preferExistingTab: req.preferExistingTab ?? this.kernel.prefs.get('fusion.lookupJumpExistingTab'),
				};
				const port = this.kernel.ports.get('workspace');
				if (port) {
					await port.focusOrOpenItem(payload);
				} else if (this.workspace.isActive()) {
					await this.workspace.focusOrOpenItem(payload);
				}
			}),
		);
	}

	stop(): void {
		this.disposables.disposeAll();
	}
}
