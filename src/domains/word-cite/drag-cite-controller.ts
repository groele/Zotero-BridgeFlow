import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import { tLocale } from '../../kernel/locale.ts';
import type { Disposable } from '../../kernel/types.ts';
import { deduplicateRegularItems } from '../../services/item-resolution.ts';
import type { Win32BridgeService } from '../../services/win32-bridge.ts';
import { insertItemsIntoWord, type WordInsertResult } from './word-inserter.ts';

/**
 * Word citation inserter:
 * Native drag-to-Word from Zotero itemsView (preserving `zotero/item` while stripping HTML/plain text)
 * and programmatic item insertion via `insertItems`.
 */
export class DragCiteController {
	private readonly windowDisposers = new Map<Window, Disposable>();
	private readonly pendingTimers = new Map<Window, ReturnType<typeof setTimeout>>();
	private activeDragItems: any[] | null = null;
	private activeDragStartedAt = 0;

	private readonly kernel: PluginKernel;
	private readonly win32: Win32BridgeService;
	private readonly onInserted: (session?: unknown) => void;

	constructor(kernel: PluginKernel, win32: Win32BridgeService, onInserted: (session?: unknown) => void = () => {}) {
		this.kernel = kernel;
		this.win32 = win32;
		this.onInserted = onInserted;
	}

	attachWindow(win: Window): void {
		if (this.windowDisposers.has(win) || this.pendingTimers.has(win)) return;
		const tryBind = (attempt = 0): void => {
			this.pendingTimers.delete(win);
			if ((win as any).closed || this.windowDisposers.has(win)) return;
			const itemsView = (win as any).ZoteroPane?.itemsView;
			if (!itemsView && attempt < 120 && typeof win.setTimeout === 'function') {
				this.pendingTimers.set(win, win.setTimeout(() => tryBind(attempt + 1), 50));
				return;
			}
			this.bindWindowImmediate(win, itemsView);
		};
		tryBind();
	}

	private bindWindowImmediate(win: Window, itemsView: any): void {
		if (this.windowDisposers.has(win)) return;
		const disposers: Disposable[] = [];

		if (itemsView && typeof itemsView.onDragStart === 'function' && this.win32.supportsNativeWin32()) {
			const unpatch = this.kernel.runtime.patch(
				itemsView,
				'onDragStart',
				'itemsView',
				(orig) => (event: any, ...rest: unknown[]) => {
					const row = rest[0];
					this.activeDragItems = null;
					this.activeDragStartedAt = 0;
					this.win32.clearLastDroppedWordTarget();
					const dragEnabled = this.kernel.prefs.get('wordCite.dragCite.enable');
					const selection = itemsView.selection;
					if (dragEnabled && typeof row === 'number' && Number.isInteger(row) && selection && !selection.isSelected?.(row)) {
						selection.select?.(row);
					}
					const res = orig.call(itemsView, event, ...rest);
					if (res === false || !dragEnabled) return res;

					const selected = (win as any).ZoteroPane?.getSelectedItems?.() || [];
					const { items } = deduplicateRegularItems(selected);
					if (!items.length) return res;

					this.activeDragItems = items;
					this.activeDragStartedAt = Date.now();
					try {
						event?.dataTransfer?.clearData?.('text/html');
						event?.dataTransfer?.setData?.('text/plain', '');
					} catch { /* ignore */ }
					return res;
				},
			);
			disposers.push(unpatch);

			const doc = win.document;
			if (doc?.addEventListener) {
				const onDragEnd = (ev: Event) => {
					const items = this.activeDragItems;
					const startedAt = this.activeDragStartedAt;
					this.activeDragItems = null;
					this.activeDragStartedAt = 0;
					if (!items?.length || !this.kernel.prefs.get('wordCite.dragCite.enable')) return;
					const dt = (ev as DragEvent).dataTransfer as (DataTransfer & { mozUserCancelled?: boolean }) | null;
					if (dt?.mozUserCancelled) return;
					if (startedAt > 0 && Date.now() - startedAt > 60_000) return;
					void this.handleDropEnd(items);
				};
				doc.addEventListener('dragend', onDragEnd, true);
				disposers.push(() => doc.removeEventListener('dragend', onDragEnd, true));
			}
		}

		this.windowDisposers.set(win, () => {
			for (const fn of disposers.reverse()) {
				try { fn(); } catch { /* ignore */ }
			}
		});
	}

	detachWindow(win: Window): void {
		const timer = this.pendingTimers.get(win);
		if (timer !== undefined) {
			this.pendingTimers.delete(win);
			try { win.clearTimeout?.(timer); } catch { /* ignore */ }
		}
		const disposer = this.windowDisposers.get(win);
		if (!disposer) return;
		this.windowDisposers.delete(win);
		disposer();
	}

	async handleDropEnd(items: readonly any[]): Promise<WordInsertResult> {
		if (!this.kernel.prefs.get('wordCite.dragCite.enable')) return 'unavailable';
		const probe = this.win32.probeCursorWordDropTarget();
		if (probe.status !== 'word-confirmed') {
			if (probe.status === 'unknown') {
				this.notifyHint(tLocale(
					'未检测到 Microsoft Word 窗口目标，请确认将文献拖拽至 Word 文档编辑区内。',
					'Microsoft Word window not detected. Please drop the item inside a Word document editor.',
				));
			}
			return 'non-word';
		}
		return insertItemsIntoWord(this.kernel, this.win32, items, {
			verifyCursor: true,
			onCommitted: this.onInserted,
		});
	}

	async insertItems(items: readonly any[], onInserted?: (sessionID: string) => void): Promise<WordInsertResult> {
		if (!this.kernel.prefs.get('modules.wordCite.enable')) return 'unavailable';
		const result = await insertItemsIntoWord(this.kernel, this.win32, items, {
			verifyCursor: false,
			onCommitted: (session) => {
				this.onInserted?.(session);
				onInserted?.((session as { sessionID?: string } | undefined)?.sessionID || '');
			},
		});
		if (result === 'unavailable' && !onInserted) {
			this.notifyHint(tLocale(
				'插入 Word 引文失败：请先打开 Microsoft Word 文档并将光标置于正文需要插入引文的位置。',
				'Failed to insert Word citation: please open a Microsoft Word document and place the cursor where you want to cite.',
			));
		}
		return result;
	}

	disposeAll(): void {
		for (const [win, timer] of this.pendingTimers.entries()) {
			try { win.clearTimeout?.(timer); } catch { /* ignore */ }
		}
		this.pendingTimers.clear();
		for (const disposer of this.windowDisposers.values()) disposer();
		this.windowDisposers.clear();
	}

	private notifyHint(message: string): void {
		try {
			const pw = new (globalThis as any).Zotero.ProgressWindow();
			pw.changeHeadline(tLocale('Zotero BridgeFlow · Word 引用', 'Zotero BridgeFlow · Word Cite'));
			pw.addDescription(message);
			pw.show();
			pw.startCloseTimer(4000);
		} catch { /* headless safe */ }
	}
}
