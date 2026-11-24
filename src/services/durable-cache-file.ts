import { cacheFile, cacheReadPaths, cacheSection } from './cache-directory.ts';
import { quarantineFile, readTextOutcome } from './safe-io.ts';

/** Serialized atomic writes with a validated recovery baseline. */
export class DurableCacheFile {
	private writes = Promise.resolve(true);
	private previous = '';
	private backedUpAt: number | undefined;
	private writeBlocked = false;
	private loading: Promise<unknown> | undefined;
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
		const reading = this.read(parse, legacyPaths);
		this.loading = reading;
		return reading;
	}

	private async read<T>(parse: (text: string, path: string) => T, legacyPaths: readonly string[]): Promise<T | null> {
		this.writeBlocked = false;
		this.needsMigration = false;
		this.previous = '';
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
				this.needsMigration = path !== this.path;
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
			await this.loading;
			const io = (globalThis as any).IOUtils;
			if (!io?.writeUTF8) return true;
			if (this.writeBlocked) return false;
			try {
				const text = serialize();
				if (text === this.previous && !replaceBackup) return true;
				await io.makeDirectory?.(this.directory, { ignoreExisting: true, createAncestors: true });
				if (replaceBackup || (this.previous && (this.backedUpAt === undefined || Date.now() - this.backedUpAt >= backupInterval))) {
					await io.writeUTF8(this.backup, replaceBackup ? text : this.previous, { tmpPath: this.backup + '.tmp' });
					this.backedUpAt = Date.now();
				}
				await io.writeUTF8(this.path, text, { tmpPath: this.path + '.tmp' });
				this.previous = text;
				this.needsMigration = false;
				this.lastError = '';
				return true;
			} catch (err) {
				this.lastError = String(err);
				return false;
			}
		};
		this.writes = this.writes.then(run, run);
		return this.writes;
	}
}
