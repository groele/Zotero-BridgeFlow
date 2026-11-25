import { DisposableStack } from '../kernel/disposable.ts';
import type { PluginKernel } from '../kernel/plugin-kernel.ts';
import type { BridgeModule } from '../kernel/types.ts';
import { isItemTrashedOrDeleted, safeGetItemField, stripItemTitleMarkup } from '../services/item-resolution.ts';
import type { ServiceContainer } from '../services/service-container.ts';

function normalizeProbe(s: string): string {
	return stripItemTitleMarkup(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function scoreLineForItem(line: string, item: any): number {
	const lowerLine = line.toLowerCase();
	const doi = safeGetItemField(item, 'DOI').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase();
	if (doi.length >= 7 && lowerLine.includes(doi)) return 100;
	const normLine = normalizeProbe(line);
	const rawTitle = safeGetItemField(item, 'title') || String(item?.title || '');
	const normTitle = normalizeProbe(rawTitle);
	if (normTitle.length >= 10 && normLine.includes(normTitle.slice(0, Math.min(normTitle.length, 42)))) {
		return 65;
	}
	const creator = String(item?.firstCreator || item?.getCreators?.()?.[0]?.lastName || '').trim().toLowerCase();
	const year = (safeGetItemField(item, 'year') || safeGetItemField(item, 'date')).match(/\b(19|20)\d{2}\b/)?.[0] || '';
	const surname = creator.split(/\s+|,/)[0] || '';
	if (surname.length >= 2 && year && lowerLine.includes(surname) && lowerLine.includes(year)) {
		return 40;
	}
	return 0;
}

/**
 * Bridge 1: All-Entry Copy -> Reverse Lookup History Loop.
 * Any citation copied from CSL Preview, Tab Context Menu, or Spotlight
 * is automatically indexed in the shared CitationHistoryStore.
 */
export class CopyHistoryBridge implements BridgeModule {
	public readonly id = 'copy-history-bridge';
	private readonly disposables = new DisposableStack();

	private readonly kernel: PluginKernel;
	private readonly services: ServiceContainer;

	constructor(kernel: PluginKernel, services: ServiceContainer) {
		this.kernel = kernel;
		this.services = services;
	}

	start(): void {
		this.disposables.reset();
		this.disposables.add(
			this.kernel.bus.on('citation:copied', (ev) => {
				if (!this.kernel.prefs.get('fusion.copyToLookupHistory')) return;
				if (!this.kernel.prefs.get('inspector.lookup.historyEnable')) return;
				if (!ev.text || !ev.itemIDs.length) return;

				const recordItemLine = (text: string, itemID: number, item: any) => {
					this.services.history.record({
						text,
						libraryID: Number(item?.libraryID || 1),
						itemKey: String(item?.key || ''),
						itemID,
						title: String(safeGetItemField(item, 'title') || item?.title || text.slice(0, 80)),
						style: ev.styleID,
					});
				};

				if (ev.itemIDs.length === 1) {
					const itemID = ev.itemIDs[0];
					if (!Number.isSafeInteger(itemID) || itemID <= 0) return;
					const item = (globalThis as any).Zotero?.Items?.get?.(itemID);
					if (item && isItemTrashedOrDeleted(item)) return;
					recordItemLine(ev.text, itemID, item);
					return;
				}

				const lines = ev.text.split(/\r?\n+/).map((l) => l.trim()).filter((l) => l.length >= 12);
				const candidates: Array<{ itemID: number; item: any }> = [];
				const seenIDs = new Set<number>();
				for (const itemID of ev.itemIDs) {
					if (!Number.isSafeInteger(itemID) || itemID <= 0 || seenIDs.has(itemID)) continue;
					const item = (globalThis as any).Zotero?.Items?.get?.(itemID);
					if (item && isItemTrashedOrDeleted(item)) continue;
					seenIDs.add(itemID);
					candidates.push({ itemID, item });
				}
				if (!lines.length || !candidates.length) return;

				const usedLines = new Set<number>();
				const usedCands = new Set<number>();
				const scoredPairs: Array<{ li: number; ci: number; score: number }> = [];
				for (let li = 0; li < lines.length; li++) {
					let bestCi = -1;
					let bestScore = 0;
					let tied = false;
					for (let ci = 0; ci < candidates.length; ci++) {
						const sc = scoreLineForItem(lines[li], candidates[ci].item);
						if (sc > bestScore) { bestScore = sc; bestCi = ci; tied = false; }
						else if (sc > 0 && sc === bestScore) tied = true;
					}
					if (bestCi >= 0 && bestScore >= 40 && !tied) {
						scoredPairs.push({ li, ci: bestCi, score: bestScore });
					}
				}
				scoredPairs.sort((a, b) => b.score - a.score);
				for (const p of scoredPairs) {
					if (usedLines.has(p.li) || usedCands.has(p.ci)) continue;
					usedLines.add(p.li);
					usedCands.add(p.ci);
					recordItemLine(lines[p.li], candidates[p.ci].itemID, candidates[p.ci].item);
				}

				const remLines = lines.map((_, i) => i).filter((i) => !usedLines.has(i));
				const remCands = candidates.map((_, i) => i).filter((i) => !usedCands.has(i));
				if (remLines.length === remCands.length && (usedLines.size === 0 || remLines.length === 1)) {
					for (let i = 0; i < remLines.length; i++) {
						const cand = candidates[remCands[i]];
						recordItemLine(lines[remLines[i]], cand.itemID, cand.item);
					}
				}
			}),
		);
	}

	stop(): void {
		this.disposables.disposeAll();
	}
}
