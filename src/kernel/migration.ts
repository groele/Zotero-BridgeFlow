import { PREF_SCHEMA, type PrefDescriptor, type PrefKey, type PrefValue } from './pref-schema.ts';
import { normalizePrefValue, type UnifiedPrefService } from './pref-service.ts';

export const CURRENT_MIGRATION_VERSION = 1;

export interface MigrationReport {
	readonly skipped: boolean;
	readonly migratedKeys: readonly PrefKey[];
	readonly sourcesDetected: readonly string[];
}

function detectSourcePlugin(legacyKey: string): string {
	if (legacyKey.startsWith('extensions.zotero.tabflow.')) return 'TabFlow';
	if (legacyKey.startsWith('extensions.zoteropreview.')) return 'ViewFlow';
	if (legacyKey.startsWith('extensions.zotero.zoterocitation.')) return 'CiteFlow';
	return 'Legacy';
}

/**
 * Idempotent one-time migration from legacy TabFlow / ViewFlow / CiteFlow prefs.
 * Never deletes or mutates legacy preference keys so users can safely roll back.
 */
export function runLegacyPrefMigration(prefs: UnifiedPrefService): MigrationReport {
	const currentVersion = prefs.get('migrationVersion');
	if (currentVersion >= CURRENT_MIGRATION_VERSION) {
		return { skipped: true, migratedKeys: [], sourcesDetected: [] };
	}

	const migratedKeys: PrefKey[] = [];
	const sources = new Set<string>();

	for (const key of Object.keys(PREF_SCHEMA) as PrefKey[]) {
		const desc = PREF_SCHEMA[key] as PrefDescriptor;
		if (!desc.legacyKeys || desc.legacyKeys.length === 0) continue;

		// Preserve any value already explicitly written to BridgeFlow
		const existingNew = prefs.readRaw(prefs.fullKey(key));
		if (existingNew !== undefined && existingNew !== desc.defaultValue) {
			continue;
		}

		for (const legacyKey of desc.legacyKeys) {
			const legacyRaw = prefs.readRaw(legacyKey);
			if (legacyRaw === undefined || legacyRaw === null) continue;
			const normalized = normalizePrefValue(key, legacyRaw);
			if (normalized !== desc.defaultValue) {
				prefs.set(key, normalized as PrefValue<typeof key>);
				migratedKeys.push(key);
				sources.add(detectSourcePlugin(legacyKey));
				break;
			}
		}
	}

	prefs.set('migrationVersion', CURRENT_MIGRATION_VERSION);
	return {
		skipped: false,
		migratedKeys,
		sourcesDetected: [...sources],
	};
}
