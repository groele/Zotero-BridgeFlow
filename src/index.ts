import { CiteBadgeBridge } from './bridges/cite-badge-bridge.ts';
import { CopyHistoryBridge } from './bridges/copy-history-bridge.ts';
import { LookupWorkspaceBridge } from './bridges/lookup-workspace-bridge.ts';
import { SpotlightFusionBridge } from './bridges/spotlight-fusion-bridge.ts';
import { InspectorDomainModule } from './domains/inspector/module.ts';
import { WordCiteDomainModule } from './domains/word-cite/module.ts';
import { WorkspaceDomainModule } from './domains/workspace/module.ts';
import { PluginKernel } from './kernel/plugin-kernel.ts';
import type { HostPrefsAdapter } from './kernel/pref-service.ts';
import type { PluginInfo } from './kernel/types.ts';
import { ServiceContainer } from './services/service-container.ts';

export class BridgeFlowApp {
	public readonly kernel: PluginKernel;
	public readonly services: ServiceContainer;
	public readonly workspace: WorkspaceDomainModule;
	public readonly inspector: InspectorDomainModule;
	public readonly wordCite: WordCiteDomainModule;
	public _ftlRegistered = false;

	constructor(options: { prefAdapter?: HostPrefsAdapter } = {}) {
		this.kernel = new PluginKernel(options);
		this.services = new ServiceContainer(this.kernel);

		this.workspace = new WorkspaceDomainModule(this.kernel, this.services);
		this.inspector = new InspectorDomainModule(this.kernel, this.services);
		this.wordCite = new WordCiteDomainModule(this.kernel, this.services);

		this.kernel.registerDomain(this.workspace);
		this.kernel.registerDomain(this.inspector);
		this.kernel.registerDomain(this.wordCite);

		this.kernel.registerBridge(new CopyHistoryBridge(this.kernel, this.services));
		this.kernel.registerBridge(new CiteBadgeBridge(this.kernel, this.workspace));
		this.kernel.registerBridge(new SpotlightFusionBridge(this.kernel, this.workspace, this.wordCite));
		this.kernel.registerBridge(new LookupWorkspaceBridge(this.kernel, this.workspace));
	}

	init(info: PluginInfo): void {
		this.kernel.init(info);
	}

	async start(): Promise<void> {
		await this.services.init();
		await this.kernel.start();
	}

	onMainWindowLoad(win: Window): void {
		this.kernel.onMainWindowLoad(win);
	}

	onMainWindowUnload(win: Window): void {
		this.kernel.onMainWindowUnload(win);
	}

	shutdown(): void {
		this.kernel.shutdown();
		this.services.dispose();
	}
}

const host = (globalThis as any).Zotero;
if (host && !host.zoterobridgeflow) {
	host.zoterobridgeflow = new BridgeFlowApp();
}
