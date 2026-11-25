import { DurableCacheFile } from './durable-cache-file.ts';

export interface IgnoredRemindersFilePayload {
	readonly format: 'zotero-bridgeflow-ignored-reminders';
	readonly version: 1;
	readonly ignored: readonly string[];
}

const FORMAT_ID = 'zotero-bridgeflow-ignored-reminders';

export function buildReminderItemKeys(itemOrKey: any): { primary: string; fallback: string } {
	if (typeof itemOrKey === 'string') {
		const clean = itemOrKey.trim();
		return { primary: clean, fallback: '' };
	}
	const libId = Number(itemOrKey?.libraryID || 1);
	const itemKey = typeof itemOrKey?.key === 'string' && itemOrKey.key.trim() ? itemOrKey.key.trim() : '';
	const itemId = Number(itemOrKey?.id || 0);
	const primary = itemKey ? `${libId}:${itemKey}` : (itemId > 0 ? `item:${itemId}` : '');
	const fallback = itemKey && itemId > 0 ? `item:${itemId}` : '';
	return { primary, fallback };
}

function parseIgnoredPayload(raw: string): string[] | null {
	try {
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		const list = parsed.format === FORMAT_ID && Array.isArray(parsed.ignored)
			? parsed.ignored
			: (Array.isArray(parsed.ignored) ? parsed.ignored : null);
		if (!list) return null;
		const out: string[] = [];
		const seen = new Set<string>();
		for (const entry of list) {
			const key = String(entry || '').trim();
			if (key && !seen.has(key)) {
				seen.add(key);
				out.push(key);
			}
		}
		return out;
	} catch {
		return null;
	}
}

/**
 * Durable local store for dismissed metadata-completeness reminders in the Word Citation Workspace.
 * Never mutates Zotero item fields, tags, or Word document citations.
 */
export class MetadataRemindersDiskCache {
	private readonly ignoredKeys = new Set<string>();
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private file: DurableCacheFile;
	private root: string;
	private initialized = false;

	constructor(customDir = '') {
		this.root = customDir;
		this.file = new DurableCacheFile('citations', 'ignored-reminders', customDir);
	}

	configure(customDir = ''): void {
		if (!this.initialized) {
			this.root = customDir;
			this.file = new DurableCacheFile('citations', 'ignored-reminders', customDir);
		}
	}

	async init(): Promise<boolean> {
		this.initialized = true;
		const disk = await this.file.load((text) => {
			const parsed = parseIgnoredPayload(text);
			if (!parsed) throw new Error('Invalid ignored reminders payload');
			return parsed;
		});
		if (disk) {
			for (const k of disk) this.ignoredKeys.add(k);
			if (this.file.needsMigration) await this.flushNow();
			return true;
		}
		return false;
	}

	isIgnored(itemOrKey: any): boolean {
		const { primary, fallback } = buildReminderItemKeys(itemOrKey);
		return Boolean((primary && this.ignoredKeys.has(primary)) || (fallback && this.ignoredKeys.has(fallback)));
	}

	setIgnored(itemOrKey: any, ignored: boolean, immediate = false): string {
		const { primary, fallback } = buildReminderItemKeys(itemOrKey);
		if (!primary) return '';
		let changed = false;
		if (fallback && this.ignoredKeys.has(fallback)) {
			this.ignoredKeys.delete(fallback);
			changed = true;
		}
		if (ignored) {
			if (!this.ignoredKeys.has(primary)) {
				this.ignoredKeys.add(primary);
				changed = true;
			}
		} else if (this.ignoredKeys.has(primary)) {
			this.ignoredKeys.delete(primary);
			changed = true;
		}
		if (changed) {
			if (immediate) void this.flushNow();
			else this.scheduleFlush();
		}
		return primary;
	}

	clearAll(immediate = false): void {
		if (this.ignoredKeys.size === 0) return;
		this.ignoredKeys.clear();
		if (immediate) void this.flushNow(true);
		else this.scheduleFlush();
	}

	private scheduleFlush(): void {
		if (this.flushTimer !== null) clearTimeout(this.flushTimer);
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			void this.flushNow();
		}, 180);
	}

	async flushNow(replaceBackup = false): Promise<boolean> {
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		return this.file.write(() => {
			const payload: IgnoredRemindersFilePayload = {
				format: FORMAT_ID,
				version: 1,
				ignored: [...this.ignoredKeys].sort(),
			};
			return `${JSON.stringify(payload, null, 2)}\n`;
		}, 0, replaceBackup);
	}

	dispose(): void {
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
			void this.flushNow();
		}
	}
}
