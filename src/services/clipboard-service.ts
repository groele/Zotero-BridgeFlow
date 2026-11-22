import type { TypedEventBus } from '../kernel/event-bus.ts';
import type { CitationCopiedPayload } from '../kernel/types.ts';
import type { CslFormattingEngine } from './csl-engine.ts';
import { deduplicateRegularItems } from './item-resolution.ts';

export interface ClipboardCopyOptions {
	readonly styleID?: string;
	readonly asCitation?: boolean;
	readonly plainOnly?: boolean;
	readonly source: CitationCopiedPayload['source'];
}

/**
 * Unified Fail-Closed XPCOM clipboard writer shared across ViewFlow preview,
 * TabFlow context menus, and Spotlight quick-copy actions.
 */
export class UnifiedClipboardService {
	private readonly csl: CslFormattingEngine;
	private readonly bus: TypedEventBus;

	constructor(csl: CslFormattingEngine, bus: TypedEventBus) {
		this.csl = csl;
		this.bus = bus;
	}

	writePayload(html: string, text: string, plainOnly = false): boolean {
		const cleanText = String(text || '').trim();
		const cleanHtml = plainOnly ? '' : String(html || '');
		if (!cleanText && !cleanHtml) return false;

		const hostCc = (globalThis as any).Cc;
		const hostCi = (globalThis as any).Ci;
		if (hostCc && hostCi) {
			try {
				const transferable = hostCc['@mozilla.org/widget/transferable;1'].createInstance(hostCi.nsITransferable);
				transferable.init?.(null);
				if (cleanHtml) {
					const htmlStr = hostCc['@mozilla.org/supports-string;1'].createInstance(hostCi.nsISupportsString);
					htmlStr.data = cleanHtml;
					transferable.addDataFlavor('text/html');
					transferable.setTransferData('text/html', htmlStr);
				}
				if (cleanText) {
					const textStr = hostCc['@mozilla.org/supports-string;1'].createInstance(hostCi.nsISupportsString);
					textStr.data = cleanText;
					transferable.addDataFlavor('text/plain');
					transferable.setTransferData('text/plain', textStr);
				}
				const clipboard = hostCc['@mozilla.org/widget/clipboard;1'].getService(hostCi.nsIClipboard);
				clipboard.setData(transferable, null, hostCi.nsIClipboard.kGlobalClipboard);
				return true;
			} catch {
				return false;
			}
		}

		// Headless/browser fallback
		const clipHelper = (globalThis as any).Zotero?.Utilities?.Internal?.copyTextToClipboard;
		if (typeof clipHelper === 'function') {
			clipHelper(cleanText);
			return true;
		}
		return false;
	}

	async copyItems(rawItems: readonly any[], options: ClipboardCopyOptions): Promise<boolean> {
		const { items } = deduplicateRegularItems(rawItems);
		if (!items.length) return false;
		const formatted = await this.csl.formatItems(items, {
			styleID: options.styleID,
			asCitation: options.asCitation,
		});
		if (!formatted.text && !formatted.html) return false;
		const ok = this.writePayload(formatted.html, formatted.text, Boolean(options.plainOnly));
		if (ok) {
			this.bus.emit('citation:copied', {
				itemIDs: items.map((it) => Number(it.id || 0)).filter((n) => n > 0),
				styleID: formatted.styleID,
				html: formatted.html,
				text: formatted.text,
				source: options.source,
			});
		}
		return ok;
	}
}
