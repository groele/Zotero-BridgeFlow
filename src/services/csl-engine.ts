import type { UnifiedPrefService } from '../kernel/pref-service.ts';

export interface CslFormatResult {
	readonly html: string;
	readonly text: string;
	readonly styleID: string;
}

export type CslPreviewErrorCode = 'no-style' | 'style-missing' | 'quickcopy-unavailable';

export function createCslPreviewError(code: CslPreviewErrorCode, message: string): Error & { previewCode: CslPreviewErrorCode } {
	return Object.assign(new Error(message), { previewCode: code });
}

interface CacheEntry {
	value: CslFormatResult;
	bytes: number;
	itemIDs: number[];
	timestamp: number;
}

interface ResolvedQuickCopyFormat {
	id?: string;
	mode?: string;
	locale?: string;
	contentType?: string;
}

export class CslFormattingEngine {
	private readonly cache = new Map<string, CacheEntry>();
	private bytes = 0;
	private styleInitialization?: Promise<void>;
	private readonly limit: number;
	private readonly byteLimit: number;
	private readonly ttlMs: number;
	private readonly prefs: UnifiedPrefService;

	constructor(
		prefs: UnifiedPrefService,
		options: { limit?: number; byteLimit?: number; ttlMs?: number } = {},
	) {
		this.prefs = prefs;
		this.limit = options.limit ?? 64;
		this.byteLimit = options.byteLimit ?? 2 * 1024 * 1024;
		this.ttlMs = options.ttlMs ?? 60_000;
	}

	resolveStyleID(overrideStyle?: string): string {
		const custom = (overrideStyle ?? this.prefs.get('inspector.cslPreview.citationstyle')).trim();
		if (custom) return custom;
		try {
			const quickCopy = String((globalThis as any).Zotero?.Prefs?.get?.('export.quickCopy.setting') || '');
			const match = quickCopy.match(/^bibliography=(.+)$/);
			if (match?.[1]) return match[1].trim();
		} catch { /* ignore */ }
		return 'http://www.zotero.org/styles/apa';
	}

	resolveFormatConfig(item?: any, overrideStyle?: string): { format: ResolvedQuickCopyFormat | string; styleID: string; asHTML: boolean } {
		const custom = (overrideStyle ?? this.prefs.get('inspector.cslPreview.citationstyle')).trim();
		const host = (globalThis as any).Zotero;
		const qc = host?.QuickCopy;
		if (typeof qc?.unserializeSetting === 'function') {
			let format: ResolvedQuickCopyFormat = {};
			try {
				let rawSetting = '';
				if (!custom) {
					let url = '';
					if (item?.isField?.('url')) {
						try { url = item.getField('url', true, true) || ''; } catch { url = ''; }
					}
					try {
						rawSetting = qc.getFormatFromURL?.(url) || '';
					} catch {
						rawSetting = host?.Prefs?.get?.('export.quickCopy.setting') || '';
					}
				} else {
					rawSetting = host?.Prefs?.get?.('export.quickCopy.setting') || '';
				}
				format = { ...qc.unserializeSetting(rawSetting) };
			} catch (error) {
				if (!custom) {
					throw createCslPreviewError('no-style', error instanceof Error ? error.message : String(error));
				}
			}
			if (custom) Object.assign(format, { id: custom, mode: 'bibliography' });
			if (format.mode !== 'bibliography' || !format.id) {
				throw createCslPreviewError('no-style', 'No bibliography style configured');
			}
			if (host?.Styles?.get && !host.Styles.get(format.id)) {
				throw createCslPreviewError('style-missing', `Citation style not installed: ${format.id}`);
			}
			format.locale = format.locale || host?.Prefs?.get?.('export.quickCopy.locale');
			const asHTML = format.contentType === 'html';
			format.contentType = 'text';
			return { format, styleID: format.id, asHTML };
		}
		const styleID = this.resolveStyleID(overrideStyle);
		return { format: `bibliography=${styleID}`, styleID, asHTML: false };
	}

	buildCacheKey(items: readonly any[], styleID: string, asCitation: boolean): string {
		const itemPart = items
			.map((it) => `${it.id || 0}:${it.dateModified || it.version || 0}`)
			.join(',');
		return `${asCitation ? 'cite' : 'bib'}|${styleID}|${itemPart}`;
	}

	async formatItems(
		items: readonly any[],
		options: { styleID?: string; asCitation?: boolean } = {},
	): Promise<CslFormatResult> {
		const host = (globalThis as any).Zotero;
		if (host?.Styles?.init) {
			this.styleInitialization ??= this.initializeStyles(host.Styles);
			await this.styleInitialization;
		}

		const { format, styleID } = this.resolveFormatConfig(items[0], options.styleID);
		const asCitation = Boolean(options.asCitation);
		if (!items.length) return { html: '', text: '', styleID };

		const locale = typeof format === 'string' ? '' : format.locale || '';
		const key = JSON.stringify([this.buildCacheKey(items, styleID, asCitation), locale]);
		const cached = this.getCached(key);
		if (cached) return cached;

		let html = '';
		let text = '';
		if (host?.QuickCopy?.getContentFromItems) {
			const res = host.QuickCopy.getContentFromItems(items, format, null, asCitation);
			if (res === null || res === undefined || typeof res.html !== 'string' || typeof res.text !== 'string') {
				throw createCslPreviewError('quickcopy-unavailable', `QuickCopy returned incomplete ${asCitation ? 'citation' : 'bibliography'}`);
			}
			html = res.html;
			text = res.text.trim();
		} else {
			text = items.map((it) => String(it.getField?.('title') || it.title || '')).filter(Boolean).join('\n');
			html = text;
		}

		const result: CslFormatResult = { html, text, styleID };
		this.setCached(key, result, items.map((it) => Number(it.id || 0)).filter((n) => n > 0));
		return result;
	}

	private async initializeStyles(styles: { init(): Promise<unknown> }): Promise<void> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				Promise.resolve().then(() => styles.init()),
				new Promise<void>((resolve) => {
					timer = setTimeout(() => { this.styleInitialization = undefined; resolve(); }, 10_000);
				}),
			]);
		} catch (error) {
			this.styleInitialization = undefined;
			throw error;
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
	}

	invalidateItems(itemIDs: Iterable<number>): void {
		const target = new Set(itemIDs);
		if (!target.size) return;
		for (const [key, entry] of this.cache.entries()) {
			if (entry.itemIDs.some((id) => target.has(id))) {
				this.bytes = Math.max(0, this.bytes - entry.bytes);
				this.cache.delete(key);
			}
		}
	}

	clearCache(): void {
		this.cache.clear();
		this.bytes = 0;
	}

	get cacheSize(): number {
		return this.cache.size;
	}

	private getCached(key: string): CslFormatResult | null {
		const entry = this.cache.get(key);
		if (!entry) return null;
		if (Date.now() - entry.timestamp > this.ttlMs) {
			this.bytes = Math.max(0, this.bytes - entry.bytes);
			this.cache.delete(key);
			return null;
		}
		this.cache.delete(key);
		this.cache.set(key, entry);
		return entry.value;
	}

	private setCached(key: string, value: CslFormatResult, itemIDs: number[]): void {
		const bytes = (value.html.length + value.text.length) * 2;
		if (bytes > this.byteLimit) return;
		const existing = this.cache.get(key);
		if (existing) {
			this.bytes = Math.max(0, this.bytes - existing.bytes);
			this.cache.delete(key);
		}
		while (this.cache.size >= this.limit || this.bytes + bytes > this.byteLimit) {
			const oldestKey = this.cache.keys().next().value;
			if (!oldestKey) break;
			const oldest = this.cache.get(oldestKey);
			if (oldest) this.bytes = Math.max(0, this.bytes - oldest.bytes);
			this.cache.delete(oldestKey);
		}
		this.cache.set(key, { value, bytes, itemIDs, timestamp: Date.now() });
		this.bytes += bytes;
	}
}
