/** Both durable stores resolve their root once per plugin startup. */
export function cacheDirectory(custom?: string): string {
	if (typeof custom === "string" && custom.trim()) return custom.trim();
	const host = globalThis as any;
	const data = host.Zotero?.DataDirectory?.dir;
	return data ? cacheFile(data, 'bridgeflow-cache') : 'bridgeflow-cache';
}

export function cacheFile(directory: string, name: string): string {
	return (globalThis as any).PathUtils?.join(directory, name) ?? directory + '/' + name;
}
