export const CLIPBOARD_ICON_SVG =
	'<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3V0H1V13H4V16H15V3H12ZM2 1H11V12H2V1ZM14 15H5V13H12V4H14V15Z" fill="#cc9200"/></svg>';

export const SUCCESS_ICON_SVG =
	'<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 1L5.5 9.5L2 6" stroke="#009900" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export const VIEWFLOW_CSS = `
.zotero-preview-root {
	box-sizing: border-box;
	min-width: 0;
	max-width: 100%;
}

item-pane-custom-section:has(.zotero-preview-root),
collapsible-section:has(> .zotero-preview-root) {
	min-inline-size: 0;
	max-inline-size: 100%;
	inline-size: 100%;
	box-sizing: border-box;
	contain: inline-size;
}

.zotero-preview-root .csl-bib-body {
	line-height: var(--zotero-preview-line-height, 1.5) !important;
}

.zotero-preview-content {
	box-sizing: border-box;
	min-width: 0;
	font-size: var(--zotero-preview-font-size, 1em);
	line-height: var(--zotero-preview-line-height, 1.5);
	padding-left: 5px;
	padding-bottom: 5px;
	overflow-wrap: anywhere;
}

.zotero-preview-block {
	min-height: 22px;
}

.zotero-preview-block + .zotero-preview-block,
.zotero-preview-separator + .zotero-preview-block {
	margin-top: 6px;
}

.zotero-preview-block-row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	column-gap: 8px;
	align-items: center;
	min-width: 0;
}

.zotero-preview-block-body {
	min-width: 0;
	user-select: text;
}

.zotero-preview-block-toolbar {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	min-width: 24px;
}

.zotero-preview-message {
	padding: 5px;
	color: var(--fill-secondary, light-dark(#555, #ccc));
	font-size: 13px;
	line-height: 1.6;
}

.zotero-preview-message-info {
	color: #666;
}

.zotero-preview-message-warning,
.zotero-preview-message-error {
	color: var(--fill-primary, light-dark(#262626, #eee));
}

.zotero-preview-message-detail {
	padding: 0 5px 4px;
	color: var(--fill-secondary, light-dark(#666, #aaa));
	font-size: 12px;
	line-height: 1.5;
	overflow-wrap: anywhere;
}

.zotero-preview-root .zotero-preview-retry {
	font: inherit;
	margin: 4px 5px;
	padding: 4px 10px;
	border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
	border-radius: 4px;
	color: inherit;
	background: color-mix(in srgb, currentColor 4%, transparent);
	cursor: pointer;
}

.zotero-preview-root .zotero-preview-retry:focus-visible {
	outline: 2px solid var(--accent-blue, #4d90fe);
	outline-offset: 2px;
}

.zotero-preview-separator {
	color: #ccc;
	width: 25%;
	margin-left: 0;
}

.zotero-preview-copy {
	cursor: pointer;
	display: inline-flex;
	appearance: none;
	border: 0;
	padding: 0;
	margin: 0;
	background: transparent;
	color: inherit;
	width: 20px;
	height: 20px;
	align-items: center;
	justify-content: center;
	vertical-align: text-bottom;
	transition: transform 0.3s ease;
}

.zotero-preview-copy:hover,
.zotero-preview-copy:focus-visible {
	background: color-mix(in srgb, currentColor 10%, transparent);
	border-radius: 3px;
	outline: none;
}

.zotero-preview-copy:focus-visible {
	box-shadow: 0 0 0 2px var(--accent-blue, #4d90fe);
}

.zotero-preview-copy-success {
	transform: scale(1.2);
}

@media (prefers-color-scheme: dark) {
	.zotero-preview-message-info {
		color: var(--fill-secondary, #aaa);
	}
	.zotero-preview-separator {
		color: var(--material-border, #555);
	}
}

@media (prefers-reduced-motion: reduce) {
	.zotero-preview-copy { transition: none; }
	.zotero-preview-copy-success { transform: none; }
}

/* Compact native styling shared with ViewFlow's citation lookup. */
item-pane-custom-section:has(.zotero-viewflow-lookup-body),
collapsible-section:has(> .zotero-viewflow-lookup-body) {
	min-inline-size: 0;
	max-inline-size: 100%;
	box-sizing: border-box;
	contain: inline-size;
}
.zotero-viewflow-lookup-body {
	box-sizing: border-box;
	min-width: 0;
	max-width: 100%;
	color: var(--fill-primary, light-dark(#222, #eee));
	font: inherit;
}
.viewflow-lookup-container {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 4px 5px 6px;
	min-width: 0;
	font-size: 13px;
	line-height: 1.5;
}
.viewflow-lookup-input {
	display: block;
	box-sizing: border-box;
	width: 100%;
	min-width: 0;
	height: 28px;
	padding: 3px 7px;
	border: 1px solid var(--material-border, light-dark(#d1d1d1, #555));
	border-radius: 3px;
	background: var(--material-background, light-dark(#fff, #242424));
	color: inherit;
	font: inherit;
}
.viewflow-lookup-input::placeholder { color: var(--fill-secondary, #888); }
.viewflow-lookup-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.viewflow-lookup-container button {
	appearance: none;
	min-height: 25px;
	margin: 0;
	padding: 2px 8px;
	border: 1px solid var(--material-border, light-dark(#d5d5d5, #555));
	border-radius: 3px;
	background: color-mix(in srgb, currentColor 3%, transparent);
	color: inherit;
	font: inherit;
	cursor: pointer;
}
.viewflow-lookup-container button:hover {
	background: color-mix(in srgb, currentColor 8%, transparent);
}
.viewflow-lookup-container button:active {
	background: color-mix(in srgb, currentColor 13%, transparent);
}
.viewflow-lookup-container .viewflow-lookup-search { font-weight: 500; }
.viewflow-lookup-container :is(button, input):focus-visible {
	outline: 2px solid var(--accent-blue, #4d90fe);
	outline-offset: 1px;
}
.viewflow-lookup-status {
	overflow-wrap: anywhere;
	color: var(--fill-secondary, light-dark(#666, #aaa));
	font-size: 12px;
}
.viewflow-lookup-status:empty { display: none; }
.viewflow-lookup-card {
	padding: 6px 0 0;
	margin-top: 2px;
	border-top: 1px solid var(--material-border, light-dark(#dedede, #444));
}
.viewflow-lookup-result-state { margin-bottom: 3px; font-size: 12px; }
.viewflow-lookup-card-head {
	color: var(--fill-primary, light-dark(#222, #eee));
	font-size: 13px;
	font-weight: 400;
	line-height: 1.5;
}
.viewflow-lookup-card-meta { margin: 4px 0 6px; font-size: 12px; }
.viewflow-lookup-card .viewflow-lookup-actions { color: var(--fill-primary, light-dark(#222, #eee)); }
.viewflow-lookup-status ul { display: grid; gap: 4px; padding: 0; list-style: none; }
.viewflow-lookup-status li button { width: 100%; text-align: start; white-space: normal; }

collapsible-section:has(.zotero-preview-root) > .head .title,
collapsible-section:has(.zotero-viewflow-lookup-body) > .head .title {
	font-size: 0.95em;
}
`;

export function ensureViewFlowStyles(doc: Document | null): void {
	if (!doc?.getElementById) return;
	let style = doc.getElementById('zbf-viewflow-style') as HTMLStyleElement | null;
	if (!style) {
		style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style') as HTMLStyleElement;
		style.id = 'zbf-viewflow-style';
		(doc.head || doc.documentElement)?.append(style);
	}
	if (style.textContent !== VIEWFLOW_CSS) style.textContent = VIEWFLOW_CSS;
}

export function setLookupL10n(el: Element, id: string, fallback: string, args?: Record<string, unknown>): void {
	el.setAttribute('data-l10n-id', id);
	if (args) el.setAttribute('data-l10n-args', JSON.stringify(args));
	else el.removeAttribute('data-l10n-args');
	el.textContent = fallback;
}

export function clearLookupResult(el: HTMLElement): void {
	el.removeAttribute('data-l10n-id');
	el.removeAttribute('data-l10n-args');
	el.innerHTML = '';
}

export function renderLookupTitle(target: HTMLElement, title: string): void {
	const doc = target.ownerDocument;
	const Parser = doc?.defaultView?.DOMParser || globalThis.DOMParser;
	target.textContent = '';
	if (!doc || !Parser) {
		target.textContent = title.replace(/<[^>]*>/g, '');
		return;
	}
	const parsed = new Parser().parseFromString(title, 'text/html');
	const allowed = new Set(['sub', 'sup', 'i', 'b', 'em', 'strong', 'span']);
	const append = (source: Node, parent: Node) => {
		if (source.nodeType === 3) {
			parent.appendChild(doc.createTextNode(source.textContent || ''));
			return;
		}
		if (source.nodeType !== 1) return;
		const tag = (source as Element).localName;
		if (['script', 'style', 'iframe', 'object'].includes(tag)) return;
		const next: Node = allowed.has(tag) ? doc.createElementNS('http://www.w3.org/1999/xhtml', tag) : parent;
		if (next !== parent) parent.appendChild(next);
		for (const child of Array.from(source.childNodes)) if (child) append(child, next);
	};
	for (const child of Array.from(parsed.body.childNodes) as Node[]) append(child, target);
}
