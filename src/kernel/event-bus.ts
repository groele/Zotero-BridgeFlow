import type { BridgeFlowEventMap, BridgeFlowEventName, Disposable } from './types.ts';

type Listener<K extends BridgeFlowEventName> = (payload: BridgeFlowEventMap[K]) => void | Promise<void>;

export class TypedEventBus {
	private readonly listeners = new Map<BridgeFlowEventName, Set<Listener<any>>>();
	private readonly onError?: (event: string, error: unknown) => void;

	constructor(onError?: (event: string, error: unknown) => void) {
		this.onError = onError;
	}

	on<K extends BridgeFlowEventName>(event: K, listener: Listener<K>): Disposable {
		let set = this.listeners.get(event);
		if (!set) {
			set = new Set();
			this.listeners.set(event, set);
		}
		set.add(listener);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			set?.delete(listener);
			if (set && set.size === 0) this.listeners.delete(event);
		};
	}

	emit<K extends BridgeFlowEventName>(event: K, payload: BridgeFlowEventMap[K]): void {
		const set = this.listeners.get(event);
		if (!set || set.size === 0) return;
		for (const listener of [...set]) {
			try {
				const result = listener(payload);
				if (result && typeof (result as Promise<void>).catch === 'function') {
					(result as Promise<void>).catch((err) => this.onError?.(event, err));
				}
			} catch (error) {
				this.onError?.(event, error);
			}
		}
	}

	listenerCount(event?: BridgeFlowEventName): number {
		if (event) return this.listeners.get(event)?.size ?? 0;
		let total = 0;
		for (const set of this.listeners.values()) total += set.size;
		return total;
	}

	clear(): void {
		this.listeners.clear();
	}
}
