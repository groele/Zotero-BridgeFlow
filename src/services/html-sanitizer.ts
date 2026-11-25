/**
 * Allow-list HTML sanitizer for citation markup produced by the host (QuickCopy / citeproc).
 * Rebuilds the markup as a string so only known tags, a few safe attributes and safe link schemes survive.
 */
const ALLOWED_TAGS = new Set([
	'a', 'b', 'i', 'u', 'em', 'strong', 'sub', 'sup', 'small', 'span', 'div', 'p', 'br', 'ol', 'ul', 'li',
]);
const VOID_TAGS = new Set(['br']);
const SAFE_HREF_RE = /^(?:https?:|doi:|mailto:)/i;
const ALLOWED_STYLE_PROPS = new Set([
	'font-style', 'font-weight', 'font-variant', 'text-decoration', 'vertical-align',
	'text-indent', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom',
	'padding-left', 'padding-right', 'line-height', 'display', 'float', 'clear', 'width',
]);
const SAFE_STYLE_VAL_RE = /^[a-z0-9\s.,%+-]+$/i;
const FORBIDDEN_STYLE_TOKEN_RE = /url\s*\(|expression\s*\(|var\s*\(|calc\s*\(|-moz-|-webkit-|javascript:|\\/i;

function sanitizeInlineStyle(raw: string): string {
	if (!raw) return '';
	const kept: string[] = [];
	for (const decl of raw.split(';')) {
		if (FORBIDDEN_STYLE_TOKEN_RE.test(decl)) continue;
		const colonIdx = decl.indexOf(':');
		if (colonIdx <= 0) continue;
		const prop = decl.slice(0, colonIdx).trim().toLowerCase();
		const val = decl.slice(colonIdx + 1).replace(/!important/gi, '').trim();
		if (!ALLOWED_STYLE_PROPS.has(prop) || !val || !SAFE_STYLE_VAL_RE.test(val)) continue;
		const lowerVal = val.toLowerCase();
		if (prop === 'display' && lowerVal !== 'inline' && lowerVal !== 'inline-block' && lowerVal !== 'block') continue;
		if (prop === 'float' && lowerVal !== 'left' && lowerVal !== 'right' && lowerVal !== 'none') continue;
		if (prop === 'clear' && lowerVal !== 'both' && lowerVal !== 'left' && lowerVal !== 'right' && lowerVal !== 'none') continue;
		if (prop === 'width') {
			const m = lowerVal.match(/^(\d+(?:\.\d+)?)(em|rem|ch|px)$/);
			if (!m) continue;
			const num = Number(m[1]);
			if ((m[2] === 'px' && num > 160) || (m[2] !== 'px' && num > 24)) continue;
		}
		kept.push(`${prop}: ${val}`);
	}
	return kept.join('; ');
}

export function escapeHtmlText(value: string): string {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
	return escapeHtmlText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function serializeNode(node: Node, out: string[]): void {
	if (node.nodeType === 3) {
		out.push(escapeHtmlText(node.textContent || ''));
		return;
	}
	if (node.nodeType !== 1) return;
	const el = node as Element;
	const tag = el.localName.toLowerCase();
	if (!ALLOWED_TAGS.has(tag)) {
		// Drop the unknown element but keep its readable text (script/style content is never kept).
		if (tag === 'script' || tag === 'style' || tag === 'iframe' || tag === 'object' || tag === 'embed') return;
		for (const child of Array.from(el.childNodes)) serializeNode(child, out);
		return;
	}
	let attrs = '';
	const className = el.getAttribute('class');
	if (className && /^[\w\s-]+$/.test(className)) attrs += ` class="${escapeAttribute(className)}"`;
	const style = sanitizeInlineStyle(el.getAttribute('style') || '');
	if (style) {
		attrs += ` style="${escapeAttribute(style)}"`;
	}
	if (tag === 'a') {
		const href = (el.getAttribute('href') || '').trim();
		if (SAFE_HREF_RE.test(href)) attrs += ` href="${escapeAttribute(href)}" rel="noreferrer"`;
	}
	if (VOID_TAGS.has(tag)) {
		out.push(`<${tag}${attrs}/>`);
		return;
	}
	out.push(`<${tag}${attrs}>`);
	for (const child of Array.from(el.childNodes)) serializeNode(child, out);
	out.push(`</${tag}>`);
}

/** Returns sanitized markup, or escaped plain text when no DOM parser is available. */
export function sanitizeCitationHtml(doc: Document | null | undefined, html: string): string {
	const source = String(html || '');
	if (!source) return '';
	const Parser = doc?.defaultView?.DOMParser || (globalThis as any).DOMParser;
	if (!Parser) return escapeHtmlText(source.replace(/<[^>]*>/g, ''));
	try {
		const parsed = new Parser().parseFromString(source, 'text/html');
		const out: string[] = [];
		for (const child of Array.from(parsed?.body?.childNodes || []) as Node[]) serializeNode(child, out);
		return out.join('');
	} catch {
		return escapeHtmlText(source.replace(/<[^>]*>/g, ''));
	}
}
