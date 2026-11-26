import { extractIdentifier } from '../services/citation-identifier.ts';
import { DisposableStack } from '../kernel/disposable.ts';
import type { PluginKernel } from '../kernel/plugin-kernel.ts';
import type { BridgeModule } from '../kernel/types.ts';
import { isItemTrashedOrDeleted, safeGetItemField, stripItemTitleMarkup } from '../services/item-resolution.ts';
import type { ServiceContainer } from '../services/service-container.ts';

function normalizeProbe(s: string): string {
	return stripItemTitleMarkup(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function describeItem(item: any) {
	const doi = extractIdentifier(safeGetItemField(item, 'DOI')).doi;
	const title = normalizeProbe(safeGetItemField(item, 'title') || String(item?.title || ''));
	const creator = String(item?.firstCreator || item?.getCreators?.()?.[0]?.lastName || '').trim().toLowerCase();
	const year = (safeGetItemField(item, 'year') || safeGetItemField(item, 'date')).match(/\b(?:18|19|20)\d{2}\b/)?.[0];
	return { doi, title, surname: creator.split(/[\s,]+/)[0], year };
}

function scoreLineForItem(line: string, normalized: string, doi: string | undefined, item: ReturnType<typeof describeItem>): number {
	if (doi) return doi === item.doi ? 100 : 0;
	if (item.title.length >= 10 && normalized.includes(item.title)) return 65;
	if (item.surname.length >= 2 && item.year && line.includes(item.surname) && line.includes(item.year)) return 40;
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
					if (isItemTrashedOrDeleted(item)) return;
					recordItemLine(ev.text, itemID, item);
					return;
				}

				const lines = ev.text.split(/\r?\n+/).map((l) => l.trim()).filter((l) => l.length >= 12);
				const candidates: Array<{ itemID: number; item: any; info: ReturnType<typeof describeItem> }> = [];
				const seenIDs = new Set<number>();
				for (const itemID of ev.itemIDs) {
					if (!Number.isSafeInteger(itemID) || itemID <= 0 || seenIDs.has(itemID)) continue;
					const item = (globalThis as any).Zotero?.Items?.get?.(itemID);
					if (isItemTrashedOrDeleted(item)) continue;
					seenIDs.add(itemID);
					candidates.push({ itemID, item, info: describeItem(item) });
				}
				if (!lines.length || !candidates.length) return;

				const usedLines = new Set<number>();
				const usedCands = new Set<number>();
				const scoredPairs: Array<{ li: number; ci: number; score: number }> = [];
				for (let li = 0; li < lines.length; li++) {
					const line = lines[li].toLowerCase();
					const normalized = normalizeProbe(line);
					const doi = extractIdentifier(line).doi;
					let bestCi = -1;
					let bestScore = 0;
					let tied = false;
					for (let ci = 0; ci < candidates.length; ci++) {
						const sc = scoreLineForItem(line, normalized, doi, candidates[ci].info);
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
			}),
		);
	}

	stop(): void {
		this.disposables.disposeAll();
	}
}
