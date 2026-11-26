import { CommandRegistry } from './command-registry.ts';
import { DisposableStack } from './disposable.ts';
import { DomainPortRegistry } from './domain-ports.ts';
import { TypedEventBus } from './event-bus.ts';
import { KernelLogger } from './logger.ts';
import { NativeRuntime } from './native-runtime.ts';
import { UnifiedNotifierHub } from './notifier-hub.ts';
import { PREF_PREFIX, PREF_SCHEMA, type PrefKey } from './pref-schema.ts';
import { UnifiedPrefService, type HostPrefsAdapter } from './pref-service.ts';
import type { BridgeModule, DomainId, DomainModule, PluginInfo } from './types.ts';

export class PluginKernel {
	public info: PluginInfo = { id: 'bridgeflow@groele', version: typeof __BRIDGEFLOW_VERSION__ === 'string' ? __BRIDGEFLOW_VERSION__ : '', rootURI: '' };
	public readonly logger = new KernelLogger();
	public readonly bus: TypedEventBus;
	public readonly commands: CommandRegistry;
	public readonly ports = new DomainPortRegistry();
	public readonly prefs: UnifiedPrefService;
	public readonly runtime = new NativeRuntime();
	public readonly notifier: UnifiedNotifierHub;
	public readonly disposables = new DisposableStack();
	public readonly prefPrefix = PREF_PREFIX;
	public readonly prefSchema = PREF_SCHEMA;
	public _ftlRegistered = false;

	private readonly domains = new Map<DomainId, DomainModule>();
	private readonly bridges: BridgeModule[] = [];
	private readonly activeBridges = new Set<BridgeModule>();
	private readonly openWindows = new Set<Window>();
	private initialized = false;
	private started = false;
	private disposed = false;
	get isDisposed(): boolean { return this.disposed; }
	private syncQueue: Promise<void> = Promise.resolve();

	constructor(options: { prefAdapter?: HostPrefsAdapter } = {}) {
		this.bus = new TypedEventBus((event, err) => this.logger.error(`bus:${event}`, err));
		this.commands = new CommandRegistry((id, err) => this.logger.error(`command:${id}`, err));
		this.prefs = new UnifiedPrefService({ bus: this.bus, adapter: options.prefAdapter });
		this.notifier = new UnifiedNotifierHub(this.bus);
	}

	init(info: PluginInfo): void {
		if (this.initialized) return;
		this.info = { ...info };
		this.initialized = true;
		this.syncLoggerConfig();
	}

	registerDomain(domain: DomainModule): void {
		this.domains.set(domain.id, domain);
	}

	registerBridge(bridge: BridgeModule): void {
		this.bridges.push(bridge);
	}

	async start(): Promise<void> {
		if (this.started || this.disposed) return;
		this.started = true;
		this.prefs.seedDefaults();
		this.syncLoggerConfig();
		this.notifier.start();

		const watchedKeys: PrefKey[] = [
			'debug',
			'wordCite.perfSlowThresholdMs',
			'wordCite.healthWindowMs',
			'modules.workspace.enable',
			'modules.visualNotes.enable',
			'modules.inspector.enable',
			'modules.wordCite.enable',
		];
		this.disposables.add(
			this.prefs.observeKeys(watchedKeys, (key) => {
				if (key === 'debug' || key === 'wordCite.perfSlowThresholdMs' || key === 'wordCite.healthWindowMs') {
					this.syncLoggerConfig();
					return;
				}
				void this.syncDomainStates();
			}),
		);

		await this.syncDomainStates();
		if (this.disposed) return;

		// Attach to already-open main windows
		const zot = (globalThis as any).Zotero;
		const existing = zot?.getMainWindows?.() as Window[] | undefined;
		if (Array.isArray(existing) && existing.length) {
			for (const win of existing) this.onMainWindowLoad(win);
		} else {
			const mainWin = zot?.getMainWindow?.() as Window | undefined;
			if (mainWin) this.onMainWindowLoad(mainWin);
		}
	}

	isBridgeActive(bridgeId: string): boolean {
		for (const bridge of this.activeBridges) {
			if (bridge.id === bridgeId) return true;
		}
		return false;
	}

	syncDomainStates(): Promise<void> {
		const next = this.syncQueue.then(() => this.runSyncDomainStates());
		this.syncQueue = next.catch(() => {});
		return next;
	}

	private shouldBridgeBeActive(bridge: BridgeModule): boolean {
		if (!this.started || this.disposed) return false;
		if (!bridge.requires?.length) return true;
		return bridge.requires.every((id) => Boolean(this.domains.get(id)?.isActive()));
	}

	private syncBridgeStates(): void {
		// Stop bridges whose required domains are no longer active first.
		for (const bridge of [...this.bridges].reverse()) {
			if (this.activeBridges.has(bridge) && !this.shouldBridgeBeActive(bridge)) {
				this.activeBridges.delete(bridge);
				try {
					bridge.stop();
				} catch (err) {
					this.logger.error(`bridge:stop:${bridge.id}`, err);
				}
			}
		}
		for (const bridge of this.bridges) {
			if (!this.activeBridges.has(bridge) && this.shouldBridgeBeActive(bridge)) {
				try {
					bridge.start();
					this.activeBridges.add(bridge);
				} catch (err) {
					this.logger.error(`bridge:${bridge.id}`, err);
				}
			}
		}
	}

	private async runSyncDomainStates(): Promise<void> {
		for (const domain of this.domains.values()) {
			if (this.disposed) return;
			const shouldEnable = Boolean(this.prefs.get(domain.enabledPref as PrefKey));
			const currentlyActive = domain.isActive();
			if (shouldEnable && !currentlyActive) {
				try {
					await domain.start();
					if (this.disposed) {
						if (domain.isActive()) domain.stop();
						return;
					}
					for (const win of this.openWindows) {
						try { domain.onMainWindowLoad?.(win); } catch (err) { this.logger.error(`windowLoad:${domain.id}`, err); }
					}
				} catch (err) {
					this.logger.error(`domain:start:${domain.id}`, err);
				}
			} else if (!shouldEnable && currentlyActive) {
				try {
					for (const win of this.openWindows) {
						try { domain.onMainWindowUnload?.(win); } catch (err) { this.logger.error(`windowUnload:${domain.id}`, err); }
					}
					domain.stop();
				} catch (err) {
					this.logger.error(`domain:stop:${domain.id}`, err);
				}
			}
		}
		if (!this.disposed) this.syncBridgeStates();
	}

	onMainWindowLoad(win: Window): void {
		if (this.disposed || !win || this.openWindows.has(win)) return;
		this.openWindows.add(win);
		for (const domain of this.domains.values()) {
			if (!domain.isActive()) continue;
			try {
				domain.onMainWindowLoad?.(win);
			} catch (err) {
				this.logger.error(`windowLoad:${domain.id}`, err);
			}
		}
	}

	onMainWindowUnload(win: Window): void {
		if (!win || !this.openWindows.has(win)) return;
		this.openWindows.delete(win);
		for (const domain of this.domains.values()) {
			if (!domain.isActive()) continue;
			try {
				domain.onMainWindowUnload?.(win);
			} catch (err) {
				this.logger.error(`windowUnload:${domain.id}`, err);
			}
		}
	}

	shutdown(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const bridge of [...this.bridges].reverse()) {
			if (!this.activeBridges.has(bridge)) continue;
			this.activeBridges.delete(bridge);
			try { bridge.stop(); } catch (err) { this.logger.error(`bridge:stop:${bridge.id}`, err); }
		}
		for (const win of [...this.openWindows]) {
			this.onMainWindowUnload(win);
		}
		for (const domain of [...this.domains.values()].reverse()) {
			if (!domain.isActive()) continue;
			try { domain.stop(); } catch (err) { this.logger.error(`domain:stop:${domain.id}`, err); }
		}
		this.notifier.stop();
		this.disposables.disposeAll((err) => this.logger.error('dispose', err));
		this.runtime.unregisterAll();
		this.prefs.dispose();
		this.commands.clear();
		this.ports.clear();
		this.bus.clear();
		this.started = false;
		this.initialized = false;
	}

	createScopedPrefs(): UnifiedPrefService {
		return new UnifiedPrefService();
	}

	private syncLoggerConfig(): void {
		this.logger.configure({
			debug: this.prefs.get('debug'),
			slowThresholdMs: this.prefs.get('wordCite.perfSlowThresholdMs'),
			healthWindowMs: this.prefs.get('wordCite.healthWindowMs'),
		});
	}
}
