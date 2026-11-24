const HEX_RE = /^#[\da-f]{6}$/i;
const customColors = new Map<string, string>();
let onChangedHook: ((serialized: string) => void) | null = null;

function normHex(raw: unknown): string {
	const s = String(raw || '').trim().toLowerCase();
	if (HEX_RE.test(s)) return s;
	if (/^#[\da-f]{3}$/i.test(s)) {
		return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
	}
	return '';
}

export function bindCustomStatusColorPersistence(onChanged: ((serialized: string) => void) | null): void {
	onChangedHook = onChanged;
}

export function loadCustomStatusColors(rawJson: string | null | undefined): void {
	customColors.clear();
	const clean = String(rawJson || '').trim();
	if (!clean) return;
	try {
		const parsed = JSON.parse(clean);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			for (const [k, v] of Object.entries(parsed)) {
				const tag = String(k || '').trim().toLowerCase();
				const hex = normHex(v);
				if (tag.startsWith('/') && hex) customColors.set(tag, hex);
			}
		}
	} catch { /* ignore malformed JSON */ }
}

export function serializeCustomStatusColors(): string {
	if (!customColors.size) return '';
	return JSON.stringify(Object.fromEntries(customColors.entries()));
}

export function getCustomStatusColor(tag: string): string {
	return customColors.get(String(tag || '').trim().toLowerCase()) || '';
}

export function rememberCustomStatusColor(tag: string, color: string): void {
	const key = String(tag || '').trim().toLowerCase();
	const hex = normHex(color);
	if (!key.startsWith('/') || !hex) return;
	if (customColors.get(key) === hex) return;
	customColors.set(key, hex);
	onChangedHook?.(serializeCustomStatusColors());
}

export async function purgeZoteroStatusTagColors(
	isStatusTag: (tagName: string, excludedTag?: string) => boolean,
	excludedTag = '/Citations',
): Promise<number> {
	const zotero = (globalThis as any).Zotero;
	const zTags = zotero?.Tags;
	if (typeof zTags?.getColors !== 'function' || typeof zTags?.setColor !== 'function') return 0;

	const libs: Array<{ libraryID?: number }> = zotero?.Libraries?.getAll?.()
		|| [{ libraryID: Number(zotero?.Libraries?.userLibraryID || 1) }];
	let removed = 0;
	for (const lib of libs) {
		const libID = Number(lib?.libraryID || 0);
		if (!Number.isInteger(libID) || libID <= 0) continue;
		let entries: Array<[string, any]> = [];
		try {
			const colors = zTags.getColors(libID);
			if (colors instanceof Map || typeof colors?.entries === 'function') {
				entries = [...colors.entries()];
			} else if (Array.isArray(colors)) {
				entries = colors.map((c: any) => [String(c?.name || ''), c]);
			}
		} catch {
			entries = [];
		}
		for (const [rawName, val] of entries) {
			const name = String(rawName || '').trim();
			if (!isStatusTag(name, excludedTag)) continue;
			const hex = typeof val === 'string' ? val : val?.color;
			if (hex) rememberCustomStatusColor(name, hex);
			try {
				await zTags.setColor(libID, name, false);
				removed++;
			} catch { /* ignore read-only group library */ }
		}
	}
	if (removed > 0) {
		for (const w of (zotero?.getMainWindows?.() || [])) {
			try { w?.ZoteroPane?.itemsView?.tree?.invalidate?.(); } catch { /* ignore */ }
		}
	}
	return removed;
}

export async function restoreZoteroStatusTagColors(
	isStatusTag: (tagName: string, excludedTag?: string) => boolean,
	resolveColor: (libraryID: number | undefined, tag: string) => string,
	excludedTag = '/Citations',
): Promise<number> {
	const zotero = (globalThis as any).Zotero;
	const zTags = zotero?.Tags;
	if (typeof zTags?.setColor !== 'function') return 0;

	const seenByLib = new Map<number, Set<string>>();
	for (const w of (zotero?.getMainWindows?.() || [])) {
		const view = w?.ZoteroPane?.itemsView;
		const rows = Math.min(Number(view?.rowCount || 0), 500);
		for (let i = 0; i < rows; i++) {
			const item = view?.getRow?.(i)?.ref;
			const libID = Number(item?.libraryID || 0);
			if (!libID || typeof item?.getTags !== 'function') continue;
			for (const entry of item.getTags() || []) {
				const t = String(entry?.tag || '').trim();
				if (!isStatusTag(t, excludedTag)) continue;
				if (!seenByLib.has(libID)) seenByLib.set(libID, new Set());
				seenByLib.get(libID)!.add(t);
			}
		}
	}
	let applied = 0;
	for (const [libID, tags] of seenByLib.entries()) {
		let usedSlots = Number(zTags.getColors?.(libID)?.size || 0);
		for (const tag of tags) {
			if (usedSlots >= 9) break;
			if (zTags.getColor?.(libID, tag)) continue;
			try {
				await zTags.setColor(libID, tag, resolveColor(libID, tag));
				usedSlots++;
				applied++;
			} catch { /* ignore Zotero 9-color cap or read-only lib */ }
		}
	}
	if (applied > 0) {
		for (const w of (zotero?.getMainWindows?.() || [])) {
			try { w?.ZoteroPane?.itemsView?.tree?.invalidate?.(); } catch { /* ignore */ }
		}
	}
	return applied;
}
