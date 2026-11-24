/**
 * Lightweight runtime locale helper for imperative UI strings (dialogs, generated labels, fallbacks)
 * that cannot be driven directly by Fluent `data-l10n-id`.
 */
export function isChineseLocale(doc?: Document | null): boolean {
	const host = (globalThis as any).Zotero;
	const rawLocale = String(
		host?.locale ||
			(doc?.defaultView as any)?.Zotero?.locale ||
			doc?.documentElement?.getAttribute?.('lang') ||
			'',
	).trim();
	if (!rawLocale) return true;
	return rawLocale.toLowerCase().startsWith('zh');
}

export function tLocale(zh: string, en: string, doc?: Document | null): string {
	return isChineseLocale(doc) ? zh : en;
}
