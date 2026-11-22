import type { Disposable } from './types.ts';

/**
 * LIFO resource disposer stack.
 * Guarantees idempotent cleanup and isolates per-disposer failures.
 */
export class DisposableStack {
	private readonly items: Disposable[] = [];
	private disposed = false;

	add(disposer: Disposable | null | undefined): Disposable {
		if (!disposer) return () => {};
		if (this.disposed) {
			try { disposer(); } catch { /* ignore late dispose error */ }
			return () => {};
		}
		let active = true;
		const wrapped: Disposable = () => {
			if (!active) return;
			active = false;
			const idx = this.items.indexOf(wrapped);
			if (idx >= 0) this.items.splice(idx, 1);
			disposer();
		};
		this.items.push(wrapped);
		return wrapped;
	}

	get size(): number {
		return this.items.length;
	}

	disposeAll(onError?: (error: unknown) => void): void {
		if (this.disposed) return;
		this.disposed = true;
		while (this.items.length > 0) {
			const fn = this.items.pop();
			if (!fn) continue;
			try {
				fn();
			} catch (error) {
				onError?.(error);
			}
		}
	}

	reset(): void {
		this.disposeAll();
		this.disposed = false;
	}
}
