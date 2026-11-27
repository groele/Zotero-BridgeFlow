import { CiteBadgeBridge } from './bridges/cite-badge-bridge.ts';
import { CopyHistoryBridge } from './bridges/copy-history-bridge.ts';
import { LookupWorkspaceBridge } from './bridges/lookup-workspace-bridge.ts';
import { SpotlightFusionBridge } from './bridges/spotlight-fusion-bridge.ts';
import { VisualNotesBridge } from './bridges/visual-notes-bridge.ts';
import { InspectorDomainModule } from './domains/inspector/module.ts';
import { VisualNotesDomainModule } from './domains/visual-notes/module.ts';
import { WordCiteDomainModule } from './domains/word-cite/module.ts';
import { WorkspaceDomainModule } from './domains/workspace/module.ts';
import { PluginKernel } from './kernel/plugin-kernel.ts';
import type { HostPrefsAdapter } from './kernel/pref-service.ts';
import type { PluginInfo } from './kernel/types.ts';
import { sweepBridgeFlowCacheDirectory } from './services/cache-hygiene.ts';
import { probeHostCapabilities, type HostCapabilitiesSnapshot } from './services/host/host-capabilities.ts';
import { ServiceContainer } from './services/service-container.ts';

export class BridgeFlowApp {
	public readonly kernel: PluginKernel;
	public readonly services: ServiceContainer;
	public readonly workspace: WorkspaceDomainModule;
	public readonly inspector: InspectorDomainModule;
	public readonly wordCite: WordCiteDomainModule;
	public readonly visualNotes: VisualNotesDomainModule;
	public _ftlRegistered = false;

	constructor(options: { prefAdapter?: HostPrefsAdapter } = {}) {
		this.kernel = new PluginKernel(options);
		this.services = new ServiceContainer(this.kernel);

		this.workspace = new WorkspaceDomainModule(this.kernel, this.services);
		this.inspector = new InspectorDomainModule(this.kernel, this.services);
		this.wordCite = new WordCiteDomainModule(this.kernel, this.services);
		this.visualNotes = new VisualNotesDomainModule(this.kernel, this.services);

		this.kernel.registerDomain(this.workspace);
		this.kernel.registerDomain(this.inspector);
		this.kernel.registerDomain(this.wordCite);
		this.kernel.registerDomain(this.visualNotes);

		this.kernel.registerBridge(new CopyHistoryBridge(this.kernel, this.services));
		this.kernel.registerBridge(new CiteBadgeBridge(this.kernel, this.workspace));
		this.kernel.registerBridge(new SpotlightFusionBridge(this.kernel, this.workspace, this.wordCite));
		this.kernel.registerBridge(new LookupWorkspaceBridge(this.kernel, this.workspace));
		this.kernel.registerBridge(new VisualNotesBridge(this.kernel, this.workspace, this.visualNotes));
	}

	init(info: PluginInfo): void {
		this.kernel.init(info);
	}

	async start(): Promise<void> {
		if (this.kernel.isDisposed) return;
		await Promise.all([this.services.init(), this.workspace.initPersistence()]);
		if (this.kernel.isDisposed) return;
		void sweepBridgeFlowCacheDirectory(this.kernel.prefs.get('inspector.lookup.cacheDirectory'));
		await this.kernel.start();
	}

	onMainWindowLoad(win: Window): void {
		this.kernel.onMainWindowLoad(win);
	}

	onMainWindowUnload(win: Window): void {
		this.kernel.onMainWindowUnload(win);
	}

	getHostCapabilities(win?: Window | null): HostCapabilitiesSnapshot {
		return probeHostCapabilities(win);
	}

	shutdown(): void {
		this.kernel.shutdown();
		this.workspace.flushPendingNotes();
		this.services.dispose();
	}
}

const host = (globalThis as any).Zotero;
if (host && !host.zoterobridgeflow) {
	host.zoterobridgeflow = new BridgeFlowApp();
}
