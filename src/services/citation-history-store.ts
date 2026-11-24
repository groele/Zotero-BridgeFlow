import { cacheFile } from './cache-directory.ts';
import { DurableCacheFile } from './durable-cache-file.ts';
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
	private file?: DurableCacheFile;
	private writes = Promise.resolve(true);
	private clearRevision = 0;
	private savedClearRevision = 0;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	public saveFailed = false;
	private readonly statusListeners = new Set<() => void>();

	onStatusChange(listener: () => void): () => void {
		this.statusListeners.add(listener);
		return () => this.statusListeners.delete(listener);
	}

	async retrySave(): Promise<boolean> {
		if (this.saveFailed) {
			await this.writes;
			await this.loadFromDisk();
			this.pruneExpired();
			this.enforceEviction();
		}
		this.dirty = true;
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
			this.file = undefined;
		}
		this.pruneExpired();
		this.enforceEviction();
	}

	get count(): number {
		return this.records.size;
	}

	private get disk(): DurableCacheFile {
		return this.file ??= new DurableCacheFile('citations', 'citation-history', this.config.customDir);
	}
	getDirectoryPath(): string { return this.disk.directory; }
	getFilePath(): string { return this.disk.path; }
	getBackupFilePath(): string { return this.disk.backup; }

	record(entry: Omit<CitationHistoryRecord, 'key' | 'copiedAt' | 'lastAccessedAt' | 'hitCount'>): CitationHistoryRecord | null {
		const key = normalizeCitationKey(entry.text);
		if (!key) return null;
		const now = Date.now();
		const id = `${entry.libraryID}:${key}`;
		const existing = this.records.get(id);
		const record: CitationHistoryRecord = {
			...entry,
			key,
			copiedAt: existing?.copiedAt ?? now,
			lastAccessedAt: now,
			hitCount: (existing?.hitCount ?? 0) + 1,
		};
		this.records.delete(id);
		this.records.set(id, record);
		this.dirty = true;
		this.enforceEviction();
		this.scheduleSave();
		return record;
	}

	lookupExact(query: string, libraryID?: number): CitationHistoryRecord | null {
		const key = normalizeCitationKey(query);
		if (!key) return null;
		let record: CitationHistoryRecord | undefined;
		if (libraryID !== undefined) record = this.records.get(`${libraryID}:${key}`);
		else {
			for (const candidate of this.records.values()) {
				if (candidate.key === key && (!record || candidate.lastAccessedAt >= record.lastAccessedAt)) record = candidate;
			}
		}
		if (!record) return null;
		const id = `${record.libraryID}:${key}`;
		this.records.delete(id);
		if (this.isExpired(record)) return null;
		record.lastAccessedAt = Date.now();
		record.hitCount++;
		this.records.set(id, record);
		// Reads update in-memory ordering, and are persisted with the next data write.
		return record;
	}

	private *rankFuzzy(query: string, limit: number, libraryID?: number) {
		const norm = normalizeCitationKey(query);
		const best: Array<{ rec: CitationHistoryRecord; score: number }> = [];
		if (!norm || limit <= 0) return [];
		const tokens = norm.split(/[^a-z0-9\u4e00-\u9fff]+/i).filter(token => token.length >= 2);
		const oldest = Date.now() - this.config.ttlDays * 86_400_000;
		let count = 0;
		for (const rec of this.records.values()) {
			if (++count % 256 === 0) yield;
			if ((libraryID !== undefined && libraryID !== rec.libraryID) || rec.lastAccessedAt <= oldest) continue;
			let score = 0;
			if (rec.key === norm) score = 100;
			else if (rec.key.includes(norm) || norm.includes(rec.key)) score = 70;
			else if (tokens.length >= 3) {
				let hits = 0;
				for (const token of tokens) if (rec.key.includes(token)) hits++;
				if (hits >= 3 && hits / tokens.length >= 0.6) score = Math.round(45 + hits / tokens.length * 20);
			}
			if (!score) continue;
			const index = best.findIndex(hit => score > hit.score || (score === hit.score && rec.hitCount > hit.rec.hitCount));
			if (index >= 0) best.splice(index, 0, { rec, score });
			else if (best.length < limit) best.push({ rec, score });
			if (best.length > limit) best.pop();
		}
		return best.map(hit => hit.rec);
	}

	searchFuzzy(query: string, limit = 5, libraryID?: number): CitationHistoryRecord[] {
		const search = this.rankFuzzy(query, limit, libraryID);
		while (true) {
			const step = search.next();
			if (step.done) return step.value;
		}
	}

	async searchFuzzyAsync(query: string, limit: number, libraryID?: number, signal?: AbortSignal): Promise<CitationHistoryRecord[]> {
		const search = this.rankFuzzy(query, limit, libraryID);
		let start = performance.now();
		while (!signal?.aborted) {
			const step = search.next();
			if (step.done) return step.value;
			if (performance.now() - start >= 6) {
				await new Promise<void>(resolve => setTimeout(resolve, 0));
				start = performance.now();
			}
		}
		return [];
	}

	clear(): void {
		this.records.clear();
		this.clearRevision++;
		this.dirty = true;
		this.scheduleSave();
	}

	private async loadFromDisk(): Promise<void> {
		const dataDir = (globalThis as any).Zotero?.DataDirectory?.dir;
		const legacy = dataDir ? [cacheFile(cacheFile(dataDir, 'viewflow-cache'), 'viewflow-history.json')] : [];
		const diskRecords = await this.disk.load(text => {
			const parsed = JSON.parse(text);
			const list = Array.isArray(parsed) ? parsed : parsed?.records;
			if (!Array.isArray(list)) throw new Error('Invalid citation cache');
			return list;
		}, legacy);
		if (!this.clearRevision) {
			for (const raw of diskRecords || []) {
				const itemID = Number(raw?.itemID);
				const libraryID = Number(raw?.libraryID ?? 1);
				if (typeof raw?.text !== 'string' || !Number.isSafeInteger(itemID) || itemID <= 0
					|| !Number.isSafeInteger(libraryID) || libraryID <= 0) continue;
				const key = normalizeCitationKey(raw.text);
				const id = `${libraryID}:${key}`;
				if (!key || this.records.has(id)) continue;
				this.records.set(id, {
					key, libraryID, itemID, text: raw.text,
					itemKey: String(raw.itemKey || ''),
					title: String(raw.title || ''),
					style: String(raw.style || ''),
					copiedAt: Number(raw.copiedAt) || Date.now(),
					lastAccessedAt: Number(raw.lastAccessedAt) || Number(raw.copiedAt) || Date.now(),
					hitCount: Number(raw.hitCount) || 1,
				});
			}
		}
		if (this.disk.needsMigration) {
			this.dirty = true;
			this.scheduleSave();
		}
	}

	async init(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;
		const ioUtils = (globalThis as any).IOUtils;
		if (!ioUtils?.exists || !ioUtils?.readUTF8) return;
		await this.loadFromDisk();
		this.pruneExpired();
		this.enforceEviction();
		if (this.disk.needsMigration) await this.flushToDisk();
	}

	dispose(): void {
		if (this.dirty) void this.flushToDisk();
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
	}

	private isExpired(record: CitationHistoryRecord): boolean {
		return Date.now() - record.lastAccessedAt >= this.config.ttlDays * 86_400_000;
	}

	private pruneExpired(): void {
		for (const [id, record] of this.records) if (this.isExpired(record)) this.records.delete(id);
	}

	private enforceEviction(): void {
		while (this.records.size > this.config.maxEntries) {
			const oldest = this.records.keys().next().value;
			if (oldest === undefined) break;
			this.records.delete(oldest);
		}
	}

	private scheduleSave(delayMs = 400): void {
		const ioUtils = (globalThis as any).IOUtils;
		if (!ioUtils?.writeUTF8 || !this.dirty) return;
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			void this.flushToDisk();
		}, delayMs);
	}

	private flushToDisk(): Promise<boolean> {
		this.writes = this.writes.then(() => this.writeRecords());
		return this.writes;
	}

	private async writeRecords(): Promise<boolean> {
		if (!this.dirty) return true;
		this.dirty = false;
		const revision = this.clearRevision;
		const ok = await this.disk.write(() => JSON.stringify({ version: 1, records: [...this.records.values()] }),
			600_000, revision !== this.savedClearRevision);
		if (!ok) this.dirty = true;
		else this.savedClearRevision = revision;
		if (this.saveFailed === ok) {
			this.saveFailed = !ok;
			for (const fn of this.statusListeners) { try { fn(); } catch { /* ignore */ } }
		}
		return ok;
	}
}
