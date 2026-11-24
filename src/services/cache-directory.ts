/** Resolve the configured BridgeFlow storage root. */
export function cacheDirectory(custom?: string): string {
	if (typeof custom === "string" && custom.trim()) return custom.trim();
	const host = globalThis as any;
	const data = host.Zotero?.DataDirectory?.dir;
	return data ? cacheFile(data, 'bridgeflow-cache') : 'bridgeflow-cache';
}

export function cacheFile(directory: string, name: string): string {
	return (globalThis as any).PathUtils?.join(directory, name) ?? directory + '/' + name;
}


export function cacheSection(section: string, custom?: string): string {
	return cacheFile(cacheDirectory(custom), section);
}

/** Prefer the configured root and its older layout before consulting the default root. */
export function cacheReadPaths(section: string, file: string, backup: string, custom?: string): string[] {
	const roots = new Set([cacheDirectory(custom), cacheDirectory()]);
	return [...roots].flatMap(root => {
		const folder = cacheFile(root, section);
		return [cacheFile(folder, file), cacheFile(folder, backup), cacheFile(root, file), cacheFile(root, backup)];
	});
}
