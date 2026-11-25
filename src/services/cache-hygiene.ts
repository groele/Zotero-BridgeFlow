import { cacheDirectory, cacheFile } from './cache-directory.ts';
import { triggerCoverCacheSweep } from './pdf-cover-service.ts';

const LEGACY_ROOT_MIGRATION_PAIRS: ReadonlyArray<readonly [legacyFile: string, migratedSection: string, migratedFile: string]> = [
	['citation-history.json', 'citations', 'citation-history.json'],
	['citation-history.bak.json', 'citations', 'citation-history.bak.json'],
	['item-ratings.json', 'ratings', 'item-ratings.json'],
	['item-ratings.bak.json', 'ratings', 'item-ratings.bak.json'],
	['brief-notes.json', 'reading', 'brief-notes.json'],
	['brief-notes.bak.json', 'reading', 'brief-notes.bak.json'],
	['reading-progress.json', 'reading', 'reading-progress.json'],
	['reading-progress.bak.json', 'reading', 'reading-progress.bak.json'],
	['reading-notes.json', 'reading', 'reading-progress.json'],
	['reading-notes.bak.json', 'reading', 'reading-progress.bak.json'],
	['workspace-snapshots.json', 'workspace', 'workspace-snapshots.json'],
	['workspace-snapshots.bak.json', 'workspace', 'workspace-snapshots.bak.json'],
];

const STALE_TMP_AGE_MS = 3_600_000;

// Ignore layout whitespace only. Keep quoted strings, duplicate keys and number literals intact.
function jsonContents(text: string): string {
	const value = JSON.parse(text);
	if (value === null || typeof value !== 'object') throw new Error('Invalid cache document');
	return text.replace(/"(?:\\.|[^"\\])*"|[\t\r\n ]+/g, token => token.startsWith('"') ? token : '');
}

/** Only discard redundant migration copies and temporary files owned by BridgeFlow. */
export async function sweepBridgeFlowCacheDirectory(customDir = ''): Promise<number> {
	const ioUtils = (globalThis as any).IOUtils || (globalThis as any).Zotero?.getMainWindow?.()?.IOUtils;
	if (!ioUtils?.exists || !ioUtils?.readUTF8 || typeof ioUtils.remove !== 'function') return 0;

	let removedCount = 0;
	const roots = [...new Set([cacheDirectory(customDir), cacheDirectory()].filter(Boolean))];
	const temporaryFiles = new Set<string>();
	const sections = new Set(['citations', 'ratings', 'reading', 'workspace']);
	for (const root of roots) {
		for (const [legacyName, section, targetName] of LEGACY_ROOT_MIGRATION_PAIRS) {
			temporaryFiles.add(cacheFile(root, legacyName + '.tmp'));
			temporaryFiles.add(cacheFile(cacheFile(root, section), targetName + '.tmp'));
		}
		for (const name of ['ignored-reminders.json.tmp', 'ignored-reminders.bak.json.tmp']) {
			temporaryFiles.add(cacheFile(cacheFile(root, 'citations'), name));
		}
	}

	for (const root of roots) {
		for (const [legacyName, sec, targetName] of LEGACY_ROOT_MIGRATION_PAIRS) {
			const legacyPath = cacheFile(root, legacyName);
			try {
				if (!(await ioUtils.exists(legacyPath))) continue;
				const targetPath = cacheFile(cacheFile(root, sec), targetName);
				if (!(await ioUtils.exists(targetPath))) continue;
				const target = jsonContents(await ioUtils.readUTF8(targetPath));
				if (target === jsonContents(await ioUtils.readUTF8(legacyPath))) {
					await ioUtils.remove(legacyPath, { ignoreAbsent: true });
					removedCount += 1;
				}
			} catch { /* ignore individual locked file */ }
		}

		if (typeof ioUtils.getChildren === 'function' && typeof ioUtils.stat === 'function') {
			const now = Date.now();
			const dirs = [root, ...[...sections].map((s) => cacheFile(root, s))];
			for (const dir of dirs) {
				const children: string[] = await ioUtils.getChildren(dir).catch(() => []);
				for (const childPath of children) {
					if (!temporaryFiles.has(childPath)) continue;
					try {
						const st = await ioUtils.stat(childPath);
						if (st?.type === 'regular' && st.lastModified > 0 && now - st.lastModified > STALE_TMP_AGE_MS) {
							await ioUtils.remove(childPath, { ignoreAbsent: true });
							removedCount += 1;
						}
					} catch { /* ignore */ }
				}
			}
		}
	}

	triggerCoverCacheSweep(true);
	return removedCount;
}
