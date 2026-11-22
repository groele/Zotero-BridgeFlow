import type { TypedEventBus } from './event-bus.ts';
import type { Disposable, NotifierEventPayload } from './types.ts';

type NotifierCallback = (payload: NotifierEventPayload) => void;

/**
 * Single global Zotero.Notifier registration shared across all domains.
 * Eliminates 3x duplicate Zotero.Notifier observers across TabFlow, ViewFlow, and CiteFlow.
 */
export class UnifiedNotifierHub {
	private notifierID: string | null = null;
	private readonly listeners = new Map<string, Set<NotifierCallback>>();
	private readonly bus: TypedEventBus;

	constructor(bus: TypedEventBus) {
		this.bus = bus;
	}

	start(): void {
		if (this.notifierID) return;
		const notifier = (globalThis as any).Zotero?.Notifier;
		if (!notifier?.registerObserver) return;
		this.notifierID = notifier.registerObserver(
			{
				notify: (
					event: string,
					type: string,
					ids: Array<string | number>,
					extraData?: Record<string, unknown>,
				) => {
					const payload: NotifierEventPayload = { event, type, ids: [...ids], extraData };
					this.dispatch(payload);
				},
			},
			['item', 'tab', 'collection', 'item-tag'],
			'zotero-bridgeflow',
		);
	}

	subscribe(types: readonly string[], callback: NotifierCallback): Disposable {
		for (const t of types) {
			let set = this.listeners.get(t);
			if (!set) {
				set = new Set();
				this.listeners.set(t, set);
			}
			set.add(callback);
		}
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			for (const t of types) {
				const set = this.listeners.get(t);
				set?.delete(callback);
				if (set && set.size === 0) this.listeners.delete(t);
			}
		};
	}

	dispatch(payload: NotifierEventPayload): void {
		const set = this.listeners.get(payload.type);
		if (set) {
			for (const cb of [...set]) {
				try { cb(payload); } catch { /* isolate subscriber error */ }
			}
		}
		this.bus.emit('notifier:event', payload);
	}

	stop(): void {
		if (this.notifierID) {
			try {
				(globalThis as any).Zotero?.Notifier?.unregisterObserver?.(this.notifierID);
			} catch { /* ignore */ }
			this.notifierID = null;
		}
		this.listeners.clear();
	}
}
