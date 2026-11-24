import { cacheDirectory, cacheFile } from './cache-directory.ts';
export interface CitationHistoryRecord {
	readonly key: string;
	readonly text: string;
	readonly libraryID: number;
	readonly itemKey: string;
	readonly itemID: number;
	readonly title: string;
	readonly style: string;
	readonly copiedAt: number;
	lastAccessedAt: number;
	hitCount: number;
}

export interface CitationHistoryConfig {
	maxEntries: number;
	ttlDays: number;
	customDir?: string;
}

export function normalizeCitationKey(text: string): string {
	return String(text || '')
		.replace(/[\u2010-\u2015\u2212]/g, '-')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/**
 * Persistent local citation copy history used by reverse lookup.
 * Supports LRU+Hit eviction, TTL self-healing, and backward reading of legacy viewflow-cache.
 */
export class CitationHistoryStore {
	private readonly records = new Map<string, CitationHistoryRecord>();
	private config: CitationHistoryConfig = { maxEntries: 2000, ttlDays: 90 };
	private initialized = false;
	private dirty = false;
	private writes = Promise.resolve(true);
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	public saveFailed = false;
	private readonly statusListeners = new Set<() => void>();

	onStatusChange(listener: () => void): () => void {
		this.statusListeners.add(listener);
		return () => this.statusListeners.delete(listener);
	}

	async retrySave(): Promise<boolean> {
		return this.flushToDisk();
	}

	configure(partial: Partial<CitationHistoryConfig>): void {
		if (typeof partial.maxEntries === 'number' && Number.isFinite(partial.maxEntries)) {
			this.config.maxEntries = Math.max(100, Math.min(100_000, Math.floor(partial.maxEntries)));
		}
		if (typeof partial.ttlDays === 'number' && Number.isFinite(partial.ttlDays)) {
			this.config.ttlDays = Math.max(7, Math.min(3650, Math.floor(partial.ttlDays)));
		}
		if (!this.initialized && partial.customDir !== undefined) {
			this.config.customDir = partial.customDir.trim() || undefined;
		}
		this.pruneExpired();
		this.enforceEviction();
	}

	get count(): number {
		return this.records.size;
	}

	getDirectoryPath(): string { return cacheDirectory(this.config.customDir); }

	getFilePath(): string { return cacheFile(this.getDirectoryPath(), 'citation-history.json'); }

	record(entry: Omit<CitationHistoryRecord, 'key' | 'copiedAt' | 'lastAccessedAt' | 'hitCount'>): CitationHistoryRecord | null {
		const key = normalizeCitationKey(entry.text);
		if (!key) return null;
		const now = Date.now();
		const existing = this.records.get(key);
		const record: CitationHistoryRecord = {
			...entry,
			key,
			copiedAt: existing?.copiedAt ?? now,
			lastAccessedAt: now,
			hitCount: (existing?.hitCount ?? 0) + 1,
		};
		this.records.delete(key);
		this.records.set(key, record);
		this.dirty = true;
		this.enforceEviction();
		this.scheduleSave();
		return record;
	}

	lookupExact(query: string): CitationHistoryRecord | null {
		const key = normalizeCitationKey(query);
		if (!key) return null;
		const rec = this.records.get(key);
		if (!rec) return null;
		if (Date.now() - (rec.lastAccessedAt || rec.copiedAt) >= this.config.ttlDays * 86_400_000) {
			this.records.delete(key);
			return null;
		}
		rec.lastAccessedAt = Date.now();
		rec.hitCount += 1;
		this.dirty = true;
		this.scheduleSave();
		return rec;
	}

	searchFuzzy(query: string, limit = 5): CitationHistoryRecord[] {
		const norm = normalizeCitationKey(query);
		if (!norm) return [];
		const qTokens = norm.split(/[^a-z0-9\u4e00-\u9fff]+/i).filter((t) => t.length >= 2);
		const scored: Array<{ rec: CitationHistoryRecord; score: number }> = [];
		for (const rec of this.records.values()) {
			if (rec.key === norm) {
				scored.push({ rec, score: 100 });
			} else if (rec.key.includes(norm) || norm.includes(rec.key)) {
				scored.push({ rec, score: 70 });
			} else if (qTokens.length >= 3) {
				let hits = 0;
				for (const tok of qTokens) if (rec.key.includes(tok)) hits++;
				const ratio = hits / qTokens.length;
				if (hits >= 3 && ratio >= 0.6) scored.push({ rec, score: Math.round(45 + ratio * 20) });
			}
		}
		scored.sort((a, b) => b.score - a.score || b.rec.hitCount - a.rec.hitCount);
		return scored.slice(0, limit).map((s) => s.rec);
	}

	clear(): void {
		this.records.clear();
		this.dirty = true;
		this.scheduleSave();
	}

	async init(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;
		const ioUtils = (globalThis as any).IOUtils;
		if (!ioUtils?.exists || !ioUtils?.readUTF8) return;

		const paths = [this.getFilePath()];
		if (this.config.customDir) paths.push(cacheFile(cacheDirectory(), 'citation-history.json'));
		const dataDir = (globalThis as any).Zotero?.DataDirectory?.dir;
		const pathUtils = (globalThis as any).PathUtils;
		if (!this.config.customDir && dataDir && pathUtils?.join) {
			paths.push(pathUtils.join(dataDir, 'viewflow-cache', 'viewflow-history.json'));
		}

		for (const filePath of paths) {
			try {
				if (!(await ioUtils.exists(filePath))) continue;
				const parsed = JSON.parse(await ioUtils.readUTF8(filePath));
				const list = Array.isArray(parsed?.records) ? parsed.records : Array.isArray(parsed) ? parsed : [];
				for (const raw of list) {
					if (!raw?.text || !raw?.itemID) continue;
					const key = normalizeCitationKey(raw.text);
					if (!this.records.has(key)) {
						this.records.set(key, {
							key,
							text: String(raw.text),
							libraryID: Number(raw.libraryID || 1),
							itemKey: String(raw.itemKey || ''),
							itemID: Number(raw.itemID),
							title: String(raw.title || ''),
							style: String(raw.style || ''),
							copiedAt: Number(raw.copiedAt || Date.now()),
							lastAccessedAt: Number(raw.lastAccessedAt || raw.copiedAt || Date.now()),
							hitCount: Number(raw.hitCount || 1),
						});
					}
				}
				if (filePath !== paths[0]) { this.dirty = true; this.scheduleSave(); }
				break;
			} catch { /* self-heal corrupted file */ }
		}
		this.pruneExpired();
		this.enforceEviction();
	}

	dispose(): void {
		if (this.dirty) void this.flushToDisk();
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
	}

	private pruneExpired(): void {
		const now = Date.now();
		const ttlMs = this.config.ttlDays * 86_400_000;
		for (const [k, rec] of this.records.entries()) {
			if (now - (rec.lastAccessedAt || rec.copiedAt) >= ttlMs) {
				this.records.delete(k);
			}
		}
	}

	private enforceEviction(): void {
		if (this.records.size <= this.config.maxEntries) return;
		const entries = [...this.records.values()];
		entries.sort((a, b) => {
			const scoreA = a.lastAccessedAt + a.hitCount * 3_600_000;
			const scoreB = b.lastAccessedAt + b.hitCount * 3_600_000;
			return scoreA - scoreB;
		});
		const overflow = this.records.size - this.config.maxEntries;
		for (let i = 0; i < overflow; i++) {
			this.records.delete(entries[i].key);
		}
	}

	private scheduleSave(): void {
		const ioUtils = (globalThis as any).IOUtils;
		if (!ioUtils?.writeUTF8 || !this.dirty) return;
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			void this.flushToDisk();
		}, 400);
	}

	private flushToDisk(): Promise<boolean> {
		this.writes = this.writes.then(() => this.writeRecords());
		return this.writes;
	}

	private async writeRecords(): Promise<boolean> {
		const ioUtils = (globalThis as any).IOUtils;
		if (!ioUtils?.writeUTF8) return true;
		try {
			await ioUtils.makeDirectory?.(this.getDirectoryPath(), { ignoreExisting: true });
			const payload = `${JSON.stringify({ version: 1, records: [...this.records.values()] }, null, 2)}\n`;
			this.dirty = false;
			await ioUtils.writeUTF8(this.getFilePath(), payload, { tmpPath: this.getFilePath() + '.tmp' });
			if (this.saveFailed) {
				this.saveFailed = false;
				for (const fn of this.statusListeners) { try { fn(); } catch { /* ignore */ } }
			}
			return true;
		} catch {
			this.dirty = true;
			this.saveFailed = true;
			for (const fn of this.statusListeners) { try { fn(); } catch { /* ignore */ } }
			return false;
		}
	}
}
