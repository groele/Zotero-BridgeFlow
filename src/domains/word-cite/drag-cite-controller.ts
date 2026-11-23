import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../kernel/types.ts';
import { deduplicateRegularItems } from '../../services/item-resolution.ts';
import type { Win32BridgeService } from '../../services/win32-bridge.ts';
import { insertItemsIntoWord, type WordInsertResult } from './word-inserter.ts';

/**
 * Word citation inserter:
 * 1. Native drag-to-Word from Zotero itemsView (preserving `zotero/item` while stripping HTML/plain text).
 * 2. Right-click item menu action "插入引文到当前 Word 光标" for click-to-cite workflow.
 */
export class DragCiteController {
	private readonly windowDisposers = new Map<Window, Disposable>();
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
		if (this.windowDisposers.has(win)) return;
		const tryBind = (attempt = 0): void => {
			if ((win as any).closed || this.windowDisposers.has(win)) return;
			const itemsView = (win as any).ZoteroPane?.itemsView;
			if (!itemsView && attempt < 120 && typeof win.setTimeout === 'function') {
				win.setTimeout(() => tryBind(attempt + 1), 50);
				return;
			}
			this.bindWindowImmediate(win, itemsView);
		};
		tryBind();
	}

	private bindWindowImmediate(win: Window, itemsView: any): void {
		if (this.windowDisposers.has(win)) return;
		const disposers: Disposable[] = [];

		if (itemsView && typeof itemsView.onDragStart === 'function' && (this.win32.supportsNativeWin32() || (globalThis as any).Zotero?.isMac)) {
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

		// Also add right-click context menu entry "插入引文到 Word 当前光标处"
		const doc = win.document;
		const itemMenu = doc?.getElementById?.('zotero-itemmenu');
		if (doc && itemMenu) {
			const mi = (doc as any).createXULElement
				? (doc as any).createXULElement('menuitem')
				: doc.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', 'menuitem');
			mi.id = 'zbf-item-insert-word-cite';
			mi.setAttribute('label', 'BridgeFlow：插入引文到 Word 当前光标');
			const onShowing = () => {
				const selected = (win as any).ZoteroPane?.getSelectedItems?.() || [];
				const valid = deduplicateRegularItems(selected).items;
				mi.hidden = !this.kernel.prefs.get('wordCite.dragCite.enable');
				if (!valid.length) mi.setAttribute('disabled', 'true');
				else mi.removeAttribute('disabled');
			};
			const onCommand = () => {
				const selected = (win as any).ZoteroPane?.getSelectedItems?.() || [];
				void this.insertItems(selected);
			};
			itemMenu.addEventListener('popupshowing', onShowing);
			mi.addEventListener('command', onCommand);
			itemMenu.appendChild(mi);
			disposers.push(() => {
				itemMenu.removeEventListener('popupshowing', onShowing);
				mi.removeEventListener('command', onCommand);
				mi.remove();
			});
		}

		this.windowDisposers.set(win, () => {
			for (const fn of disposers.reverse()) {
				try { fn(); } catch { /* ignore */ }
			}
		});
	}

	detachWindow(win: Window): void {
		const disposer = this.windowDisposers.get(win);
		if (!disposer) return;
		this.windowDisposers.delete(win);
		disposer();
	}

	async handleDropEnd(items: readonly any[]): Promise<WordInsertResult> {
		if (!this.kernel.prefs.get('wordCite.dragCite.enable')) return 'unavailable';
		const probe = this.win32.probeCursorWordDropTarget();
		if (probe.status !== 'word-confirmed' && !(globalThis as any).Zotero?.isMac) {
			if (probe.status === 'unknown') {
				this.notifyHint('未检测到 Microsoft Word 窗口目标，请确认将文献拖拽至 Word 文档编辑区内。');
			}
			return 'non-word';
		}
		return insertItemsIntoWord(this.kernel, this.win32, items, {
			verifyCursor: true,
			onCommitted: this.onInserted,
		});
	}

	async insertItems(items: readonly any[]): Promise<WordInsertResult> {
		if (!this.kernel.prefs.get('wordCite.dragCite.enable')) return 'unavailable';
		const result = await insertItemsIntoWord(this.kernel, this.win32, items, {
			verifyCursor: false,
			onCommitted: this.onInserted,
		});
		if (result === 'unavailable') {
			this.notifyHint('插入 Word 引文失败：请先打开 Microsoft Word 文档并将光标置于正文需要插入引文的位置。');
		}
		return result;
	}

	disposeAll(): void {
		for (const disposer of this.windowDisposers.values()) disposer();
		this.windowDisposers.clear();
	}

	private notifyHint(message: string): void {
		try {
			const pw = new (globalThis as any).Zotero.ProgressWindow();
			pw.changeHeadline('Zotero BridgeFlow · Word 引用');
			pw.addDescription(message);
			pw.show();
			pw.startCloseTimer(4000);
		} catch { /* headless safe */ }
	}
}
