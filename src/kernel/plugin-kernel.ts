import { DisposableStack } from './disposable.ts';
import { TypedEventBus } from './event-bus.ts';
import { KernelLogger } from './logger.ts';
import { NativeRuntime } from './native-runtime.ts';
import { UnifiedNotifierHub } from './notifier-hub.ts';
import type { PrefKey } from './pref-schema.ts';
import { UnifiedPrefService, type HostPrefsAdapter } from './pref-service.ts';
import type { BridgeModule, DomainModule, PluginInfo } from './types.ts';

export class PluginKernel {
	public info: PluginInfo = { id: 'bridgeflow@groele', version: '0.0.1', rootURI: '' };
	public readonly logger = new KernelLogger();
	public readonly bus: TypedEventBus;
	public readonly prefs: UnifiedPrefService;
	public readonly runtime = new NativeRuntime();
	public readonly notifier: UnifiedNotifierHub;
	public readonly disposables = new DisposableStack();
	public _ftlRegistered = false;

	private readonly domains = new Map<DomainModule['id'], DomainModule>();
	private readonly bridges: BridgeModule[] = [];
	private readonly openWindows = new Set<Window>();
	private initialized = false;
	private started = false;

	constructor(options: { prefAdapter?: HostPrefsAdapter } = {}) {
		this.bus = new TypedEventBus((event, err) => this.logger.error(`bus:${event}`, err));
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
		if (this.started) return;
		this.started = true;
		this.prefs.seedDefaults();
		this.syncLoggerConfig();
		this.notifier.start();

		const watchedKeys: PrefKey[] = [
			'debug',
			'wordCite.perfSlowThresholdMs',
			'modules.workspace.enable',
			'modules.inspector.enable',
			'modules.wordCite.enable',
		];
		this.disposables.add(
			this.prefs.observeKeys(watchedKeys, (key) => {
				if (key === 'debug' || key === 'wordCite.perfSlowThresholdMs') {
					this.syncLoggerConfig();
					return;
				}
				void this.syncDomainStates();
			}),
		);

		await this.syncDomainStates();
		for (const bridge of this.bridges) {
			try {
				bridge.start();
			} catch (err) {
				this.logger.error(`bridge:${bridge.id}`, err);
			}
		}

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

	async syncDomainStates(): Promise<void> {
		for (const domain of this.domains.values()) {
			const shouldEnable = Boolean(this.prefs.get(domain.enabledPref as PrefKey));
			const currentlyActive = domain.isActive();
			if (shouldEnable && !currentlyActive) {
				try {
					await domain.start();
					for (const win of this.openWindows) domain.onMainWindowLoad?.(win);
				} catch (err) {
					this.logger.error(`domain:start:${domain.id}`, err);
				}
			} else if (!shouldEnable && currentlyActive) {
				try {
					for (const win of this.openWindows) domain.onMainWindowUnload?.(win);
					domain.stop();
				} catch (err) {
					this.logger.error(`domain:stop:${domain.id}`, err);
				}
			}
		}
	}

	onMainWindowLoad(win: Window): void {
		if (!win || this.openWindows.has(win)) return;
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
		for (const bridge of [...this.bridges].reverse()) {
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
		this.bus.clear();
		this.started = false;
		this.initialized = false;
	}

	private syncLoggerConfig(): void {
		this.logger.configure({
			debug: this.prefs.get('debug'),
			slowThresholdMs: this.prefs.get('wordCite.perfSlowThresholdMs'),
		});
	}
}
