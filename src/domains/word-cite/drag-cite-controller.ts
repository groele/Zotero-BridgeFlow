import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../kernel/types.ts';
import { deduplicateRegularItems } from '../../services/item-resolution.ts';
import type { Win32BridgeService } from '../../services/win32-bridge.ts';

/**
 * Windows native drag-to-Word citation inserter.
 * Preserves native `zotero/item` internal drag payload while confirming WINWORD.EXE drop target.
 */
export class DragCiteController {
	private busy = false;
	private readonly windowDisposers = new Map<Window, Disposable>();

	private readonly kernel: PluginKernel;
	private readonly win32: Win32BridgeService;

	constructor(kernel: PluginKernel, win32: Win32BridgeService) {
		this.kernel = kernel;
		this.win32 = win32;
	}

	attachWindow(win: Window): void {
		if (!this.win32.supportsNativeWin32() || this.windowDisposers.has(win)) return;
		const itemsView = (win as any).ZoteroPane?.itemsView;
		if (!itemsView || typeof itemsView.onDragStart !== 'function') return;

		const unpatch = this.kernel.runtime.patch(
			itemsView,
			'onDragStart',
			'itemsView',
			(orig) => (event: any, ...rest: unknown[]) => {
				const res = orig.call(itemsView, event, ...rest);
				if (!this.kernel.prefs.get('wordCite.dragCite.enable')) return res;
				const selected = (win as any).ZoteroPane?.getSelectedItems?.() || [];
				const { items } = deduplicateRegularItems(selected);
				if (!items.length) return res;

				try {
					event?.dataTransfer?.clearData?.('text/html');
					event?.dataTransfer?.setData?.('text/plain', '');
				} catch { /* ignore */ }

				const onDragEnd = (): void => {
					win.removeEventListener?.('dragend', onDragEnd as EventListener, true);
					void this.handleDropEnd(items);
				};
				win.addEventListener?.('dragend', onDragEnd as EventListener, { once: true, capture: true });
				return res;
			},
		);

		this.windowDisposers.set(win, unpatch);
	}

	detachWindow(win: Window): void {
		const disposer = this.windowDisposers.get(win);
		if (!disposer) return;
		this.windowDisposers.delete(win);
		disposer();
	}

	async handleDropEnd(items: readonly any[]): Promise<'inserted' | 'busy' | 'non-word' | 'unavailable'> {
		if (!this.kernel.prefs.get('wordCite.dragCite.enable')) return 'unavailable';
		const probe = this.win32.probeCursorWordDropTarget();
		if (probe.status !== 'word-confirmed') return 'non-word';
		if (this.busy) return 'busy';

		this.busy = true;
		try {
			const integration = (globalThis as any).Zotero?.Integration;
			if (!integration?.execCommand) return 'unavailable';
			await integration.execCommand('WinWord', 'addEditCitation', items.map((i) => i.id));
			return 'inserted';
		} catch (err) {
			this.kernel.logger.error('word-cite:drag', err);
			return 'unavailable';
		} finally {
			this.busy = false;
		}
	}

	disposeAll(): void {
		for (const disposer of this.windowDisposers.values()) disposer();
		this.windowDisposers.clear();
	}
}
