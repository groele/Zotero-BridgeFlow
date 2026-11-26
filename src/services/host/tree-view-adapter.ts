import type { NativeRuntime } from '../../kernel/native-runtime.ts';
import type { Disposable } from '../../kernel/types.ts';

export type HostTreeMethod = (this: any, ...args: unknown[]) => any;
export type HostTreeMethodWrapper = (orig: HostTreeMethod) => HostTreeMethod;

export interface CollectionsViewHooks {
	getIcon?: HostTreeMethodWrapper;
	expandRow?: HostTreeMethodWrapper;
	addSortedRow?: HostTreeMethodWrapper;
}

/**
 * Safely patch `itemsView._renderCell` through NativeRuntime.
 * Returns `null` when the host surface is unavailable so callers can defer or degrade gracefully.
 */
export function patchItemsViewRenderCell(
	runtime: NativeRuntime,
	itemsView: any,
	wrapper: HostTreeMethodWrapper,
): Disposable | null {
	if (!itemsView || typeof itemsView !== 'object' || typeof itemsView._renderCell !== 'function') {
		return null;
	}
	return runtime.patch(itemsView, '_renderCell', 'itemsView', (orig) => wrapper(orig as HostTreeMethod));
}

/**
 * Safely patch `collectionsView` private hooks (`_getIcon`, `_expandRow`, `_addSortedRow`)
 * through NativeRuntime, returning an idempotent composite disposer.
 */
export function patchCollectionsViewHooks(
	runtime: NativeRuntime,
	collectionsView: any,
	hooks: CollectionsViewHooks,
): Disposable {
	if (!collectionsView || typeof collectionsView !== 'object') {
		return () => {};
	}
	const disposers: Disposable[] = [];
	const bindHook = (methodName: '_getIcon' | '_expandRow' | '_addSortedRow', wrapper?: HostTreeMethodWrapper) => {
		if (!wrapper || typeof collectionsView[methodName] !== 'function') return;
		disposers.push(
			runtime.patch(collectionsView, methodName, 'collectionsView', (orig) => wrapper(orig as HostTreeMethod)),
		);
	};

	bindHook('_getIcon', hooks.getIcon);
	bindHook('_expandRow', hooks.expandRow);
	bindHook('_addSortedRow', hooks.addSortedRow);

	let disposed = false;
	return () => {
		if (disposed) return;
		disposed = true;
		for (const dispose of disposers.reverse()) {
			try { dispose(); } catch { /* ignore */ }
		}
	};
}
