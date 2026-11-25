import { PREF_PREFIX, PREF_SCHEMA, type PrefDescriptor, type PrefKey, type PrefValue } from './pref-schema.ts';
import type { TypedEventBus } from './event-bus.ts';
import type { Disposable } from './types.ts';

export interface HostPrefsAdapter {
	get(key: string, global?: boolean): unknown;
	set(key: string, value: unknown, global?: boolean): void;
	clear?(key: string, global?: boolean): void;
	registerObserver?(key: string, handler: () => void, global?: boolean): symbol | string | number;
	unregisterObserver?(id: symbol | string | number): void;
}

function resolveDefaultAdapter(): HostPrefsAdapter | null {
	const host = (globalThis as any).Zotero?.Prefs;
	return host && typeof host.get === 'function' ? host : null;
}

export function normalizePrefValue<K extends PrefKey>(key: K, raw: unknown): PrefValue<K> {
	const desc = PREF_SCHEMA[key] as PrefDescriptor;
	const def = desc.defaultValue;
	if (raw === undefined || raw === null || raw === 'undefined' || raw === 'null') return def as PrefValue<K>;
	if (typeof def === 'boolean') {
		if (typeof raw === 'boolean') return raw as PrefValue<K>;
		if (raw === 'true' || raw === 1 || raw === '1') return true as PrefValue<K>;
		if (raw === 'false' || raw === 0 || raw === '0') return false as PrefValue<K>;
		return def as PrefValue<K>;
	}
	if (typeof def === 'number') {
		const n = typeof raw === 'number' ? raw : Number(raw);
		if (!Number.isFinite(n)) return def as PrefValue<K>;
		let clamped = Math.round(n);
		if (typeof desc.min === 'number') clamped = Math.max(desc.min, clamped);
		if (typeof desc.max === 'number') clamped = Math.min(desc.max, clamped);
		return clamped as PrefValue<K>;
	}
	const str = String(raw);
	if (key === 'inspector.cslPreview.fontsize') {
		const num = Number(str);
		if (!Number.isFinite(num) || num <= 0) return def as PrefValue<K>;
		return String(Math.min(3, Math.max(0.4, num))) as PrefValue<K>;
	}
	if (key === 'inspector.cslPreview.spacing') {
		const num = Number(str);
		if (!Number.isFinite(num) || num <= 0) return def as PrefValue<K>;
		return String(Math.min(3, Math.max(0.8, num))) as PrefValue<K>;
	}
	if (key === 'workspace.readingHeatmap.color') {
		const hex = str.trim().toLowerCase();
		if (/^#[0-9a-f]{6}$/.test(hex)) return hex as PrefValue<K>;
		if (/^#[0-9a-f]{3}$/.test(hex)) {
			return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` as PrefValue<K>;
		}
		return def as PrefValue<K>;
	}
	if (desc.enumValues && !desc.enumValues.includes(str)) {
		return def as PrefValue<K>;
	}
	return str as PrefValue<K>;
}

export class UnifiedPrefService {
	private readonly cache = new Map<PrefKey, unknown>();
	private readonly cacheWatchedKeys = new Set<PrefKey>();
	private readonly observerIDs: Array<symbol | string | number> = [];
	private readonly bus?: TypedEventBus;
	private readonly adapterOverride?: HostPrefsAdapter;

	constructor(options: { bus?: TypedEventBus; adapter?: HostPrefsAdapter } = {}) {
		this.bus = options.bus;
		this.adapterOverride = options.adapter;
	}

	private get adapter(): HostPrefsAdapter | null {
		return this.adapterOverride ?? resolveDefaultAdapter();
	}

	private ensureCacheInvalidationObserver(key: PrefKey): void {
		if (this.cacheWatchedKeys.has(key)) return;
		const adapter = this.adapter;
		if (!adapter?.registerObserver) return;
		this.cacheWatchedKeys.add(key);
		try {
			const token = adapter.registerObserver(this.fullKey(key), () => {
				this.invalidate(key);
			}, true);
			this.observerIDs.push(token);
		} catch {
			this.cacheWatchedKeys.delete(key);
		}
	}

	fullKey(key: PrefKey): string {
		return PREF_PREFIX + key;
	}

	get<K extends PrefKey>(key: K): PrefValue<K> {
		this.ensureCacheInvalidationObserver(key);
		if (this.cache.has(key)) return this.cache.get(key) as PrefValue<K>;
		const raw = this.readRaw(this.fullKey(key));
		const normalized = normalizePrefValue(key, raw);
		this.cache.set(key, normalized);
		return normalized;
	}

	set<K extends PrefKey>(key: K, value: PrefValue<K>): PrefValue<K> {
		this.ensureCacheInvalidationObserver(key);
		const normalized = normalizePrefValue(key, value);
		this.cache.set(key, normalized);
		try {
			this.adapter?.set(this.fullKey(key), normalized, true);
		} catch { /* ignore in mock/headless env */ }
		this.bus?.emit('prefs:changed', { key, value: normalized });
		return normalized;
	}

	readRaw(fullKey: string): unknown {
		try {
			return this.adapter?.get(fullKey, true);
		} catch {
			return undefined;
		}
	}

	invalidate(key?: PrefKey): void {
		if (key) this.cache.delete(key);
		else this.cache.clear();
	}

	resetAllDefaults(): void {
		for (const key of Object.keys(PREF_SCHEMA) as PrefKey[]) {
			const desc = PREF_SCHEMA[key] as PrefDescriptor;
			if (desc.resettable === false) continue;
			this.set(key, desc.defaultValue as PrefValue<typeof key>);
		}
	}

	seedDefaults(): void {
		const adapter = this.adapter;
		if (!adapter) return;
		for (const key of Object.keys(PREF_SCHEMA) as PrefKey[]) {
			const full = this.fullKey(key);
			const existing = this.readRaw(full);
			const desc = PREF_SCHEMA[key] as PrefDescriptor;
			const normalized = normalizePrefValue(key, existing);
			if (existing === undefined || existing === 'undefined' || existing === 'null' || existing !== normalized) {
				try {
					adapter.set(full, normalized ?? desc.defaultValue, true);
				} catch { /* ignore */ }
			}
		}
	}

	observeKeys(keys: readonly PrefKey[], onChange: (key: PrefKey, value: unknown) => void): Disposable {
		const localTokens: Array<symbol | string | number> = [];
		const adapter = this.adapter;
		if (adapter?.registerObserver) {
			for (const key of keys) {
				const token = adapter.registerObserver(this.fullKey(key), () => {
					this.invalidate(key);
					const next = this.get(key);
					this.bus?.emit('prefs:changed', { key, value: next });
					onChange(key, next);
				}, true);
				this.observerIDs.push(token);
				localTokens.push(token);
			}
		}
		return () => {
			if (!adapter?.unregisterObserver) return;
			for (const token of localTokens) {
				try { adapter.unregisterObserver(token); } catch { /* ignore */ }
				const idx = this.observerIDs.indexOf(token);
				if (idx >= 0) this.observerIDs.splice(idx, 1);
			}
		};
	}

	dispose(): void {
		const adapter = this.adapter;
		if (adapter?.unregisterObserver) {
			for (const token of this.observerIDs) {
				try { adapter.unregisterObserver(token); } catch { /* ignore */ }
			}
		}
		this.observerIDs.length = 0;
		this.cacheWatchedKeys.clear();
		this.cache.clear();
	}
}
