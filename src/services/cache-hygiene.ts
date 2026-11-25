import { cacheDirectory, cacheFile } from './cache-directory.ts';
import { triggerCoverCacheSweep } from './pdf-cover-service.ts';

const LEGACY_ROOT_MIGRATION_PAIRS: ReadonlyArray<readonly [legacyFile: string, migratedSection: string, migratedFile: string]> = [
	['citation-history.json', 'citations', 'citation-history.json'],
	['citation-history.bak.json', 'citations', 'citation-history.json'],
	['item-ratings.json', 'ratings', 'item-ratings.json'],
	['item-ratings.bak.json', 'ratings', 'item-ratings.json'],
	['brief-notes.json', 'reading', 'brief-notes.json'],
	['brief-notes.bak.json', 'reading', 'brief-notes.json'],
	['reading-progress.json', 'reading', 'reading-progress.json'],
	['reading-progress.bak.json', 'reading', 'reading-progress.json'],
	['reading-notes.json', 'reading', 'reading-progress.json'],
	['reading-notes.bak.json', 'reading', 'reading-progress.json'],
	['workspace-snapshots.json', 'workspace', 'workspace-snapshots.json'],
	['workspace-snapshots.bak.json', 'workspace', 'workspace-snapshots.json'],
];

const CACHE_SECTIONS = ['citations', 'covers', 'ratings', 'reading', 'workspace'] as const;
const STALE_TMP_AGE_MS = 3_600_000;

async function hasValidJsonTarget(ioUtils: any, targetPath: string): Promise<boolean> {
	try {
		if (!(await ioUtils.exists(targetPath))) return false;
		const raw = await ioUtils.readUTF8(targetPath);
		const parsed = JSON.parse(String(raw));
		return Boolean(parsed && typeof parsed === 'object');
	} catch {
		return false;
	}
}

/**
 * Safely sweeps `bridgeflow-cache/` so the folder stays clean and professional:
 * 1) Removes legacy pre-v0.6.7 root-level JSON/BAK files ONLY after confirming their categorized subfolder file exists & parses cleanly.
 * 2) Removes stale `*.tmp` files (> 1h old) in the root and section subfolders.
 * 3) Triggers cover cache sweep so legacy `cover-*.txt` files are evicted immediately.
 */
export async function sweepBridgeFlowCacheDirectory(customDir = ''): Promise<number> {
	const ioUtils = (globalThis as any).IOUtils || (globalThis as any).Zotero?.getMainWindow?.()?.IOUtils;
	if (!ioUtils?.exists || !ioUtils?.readUTF8 || typeof ioUtils.remove !== 'function') return 0;

	let removedCount = 0;
	const roots = [...new Set([cacheDirectory(customDir), cacheDirectory()].filter(Boolean))];
	const verifiedTargets = new Map<string, boolean>();

	for (const root of roots) {
		for (const [legacyName, sec, targetName] of LEGACY_ROOT_MIGRATION_PAIRS) {
			const legacyPath = cacheFile(root, legacyName);
			try {
				if (!(await ioUtils.exists(legacyPath))) continue;
				const targetPath = cacheFile(cacheFile(root, sec), targetName);
				let valid = verifiedTargets.get(targetPath);
				if (valid === undefined) {
					valid = await hasValidJsonTarget(ioUtils, targetPath);
					verifiedTargets.set(targetPath, valid);
				}
				if (valid) {
					await ioUtils.remove(legacyPath, { ignoreAbsent: true });
					removedCount += 1;
				}
			} catch { /* ignore individual locked file */ }
		}

		if (typeof ioUtils.getChildren === 'function' && typeof ioUtils.stat === 'function') {
			const now = Date.now();
			const dirs = [root, ...CACHE_SECTIONS.map((s) => cacheFile(root, s))];
			for (const dir of dirs) {
				const children: string[] = await ioUtils.getChildren(dir).catch(() => []);
				for (const childPath of children) {
					if (!childPath.endsWith('.tmp')) continue;
					try {
						const st = await ioUtils.stat(childPath);
						if (st?.type === 'regular' && now - (st.lastModified || 0) > STALE_TMP_AGE_MS) {
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
