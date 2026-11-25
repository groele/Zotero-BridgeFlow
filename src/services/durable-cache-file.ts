import { cacheFile, cacheReadPaths, cacheSection } from './cache-directory.ts';
import { quarantineFile, readTextOutcome } from './safe-io.ts';

/** Serialized atomic writes with a validated recovery baseline. */
export class DurableCacheFile {
	private operations: Promise<unknown> = Promise.resolve();
	private previous = '';
	private backedUpAt: number | undefined;
	private writeBlocked = false;
	private replaceBackupPending = false;
	readonly directory: string;
	readonly path: string;
	readonly backup: string;
	readonly paths: readonly string[];
	needsMigration = false;
	lastError = '';

	constructor(section: string, name: string, root?: string) {
		const file = `${name}.json`, backup = `${name}.bak.json`;
		this.directory = cacheSection(section, root);
		this.path = cacheFile(this.directory, file);
		this.backup = cacheFile(this.directory, backup);
		this.paths = cacheReadPaths(section, file, backup, root);
	}

	load<T>(parse: (text: string, path: string) => T, legacyPaths: readonly string[] = []): Promise<T | null> {
		const reading = this.operations.then(() => this.read(parse, legacyPaths));
		this.operations = reading.catch(() => {});
		return reading;
	}

	private async read<T>(parse: (text: string, path: string) => T, legacyPaths: readonly string[]): Promise<T | null> {
		this.writeBlocked = false;
		this.needsMigration = false;
		this.previous = '';
		this.lastError = '';
		this.backedUpAt = undefined;
		for (const path of new Set([...this.paths, ...legacyPaths])) {
			const outcome = await readTextOutcome(path);
			if (outcome.status === 'missing') continue;
			if (outcome.status === 'error') {
				this.writeBlocked = true;
				this.lastError = 'Cache could not be read';
				continue;
			}
			try {
				const value = parse(outcome.text, path);
				if (path === this.path) this.previous = outcome.text;
				const unformatted = path === this.path && outcome.text.length > 24 && !outcome.text.trimEnd().includes('\n');
				this.needsMigration = path !== this.path || unformatted;
				if (!this.writeBlocked) this.lastError = '';
				return value;
			} catch {
				if (path === this.path && !(await quarantineFile(path))) {
					this.writeBlocked = true;
					this.lastError = 'Damaged cache could not be preserved';
				}
			}
		}
		return null;
	}

	write(serialize: () => string, backupInterval = 0, replaceBackup = false): Promise<boolean> {
		const run = async () => {
			this.replaceBackupPending ||= replaceBackup;
			const replaceRecoveryCopy = this.replaceBackupPending;
			const io = (globalThis as any).IOUtils;
			if (!io?.writeUTF8) {
				this.lastError = 'Cache storage is unavailable';
				return false;
			}
			if (this.writeBlocked) return false;
			try {
				const text = serialize();
				if (text === this.previous && !replaceRecoveryCopy) {
					this.lastError = '';
					return true;
				}
				await io.makeDirectory?.(this.directory, { ignoreExisting: true, createAncestors: true });
				if (!replaceRecoveryCopy && this.previous && (this.backedUpAt === undefined || Date.now() - this.backedUpAt >= backupInterval)) {
					await io.writeUTF8(this.backup, this.previous, { tmpPath: this.backup + '.tmp' });
					this.backedUpAt = Date.now();
				}
				await io.writeUTF8(this.path, text, { tmpPath: this.path + '.tmp' });
				this.previous = text;
				if (replaceRecoveryCopy) {
					await io.writeUTF8(this.backup, text, { tmpPath: this.backup + '.tmp' });
					this.replaceBackupPending = false;
					this.backedUpAt = Date.now();
				}
				this.needsMigration = false;
				this.lastError = '';
				return true;
			} catch (err) {
				this.lastError = String(err);
				return false;
			}
		};
		const writing = this.operations.then(run);
		this.operations = writing.catch(() => {});
		return writing;
	}
}
