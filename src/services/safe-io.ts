/** Shared helpers that distinguish "file missing" from "file unreadable" so persistence never overwrites recoverable data. */
export type ReadOutcome =
	| { status: 'ok'; text: string }
	| { status: 'missing' }
	| { status: 'error'; error: unknown };

export async function readTextOutcome(path: string): Promise<ReadOutcome> {
	const ioUtils = (globalThis as any).IOUtils;
	if (!ioUtils?.exists || !ioUtils?.readUTF8) return { status: 'missing' };
	try {
		if (!(await ioUtils.exists(path))) return { status: 'missing' };
	} catch (error) {
		return { status: 'error', error };
	}
	try {
		return { status: 'ok', text: String(await ioUtils.readUTF8(path)) };
	} catch (error) {
		return { status: 'error', error };
	}
}

/** Keep a timestamped copy of an unparsable file instead of silently overwriting it. */
export async function quarantineFile(path: string): Promise<boolean> {
	const ioUtils = (globalThis as any).IOUtils;
	if (typeof ioUtils?.copy !== 'function') return false;
	try {
		await ioUtils.copy(path, `${path}.corrupt-${Date.now()}`);
		return true;
	} catch {
		return false;
	}
}
