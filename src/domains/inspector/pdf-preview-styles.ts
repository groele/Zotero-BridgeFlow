const STYLE_ID = 'zbf-pdf-preview-styles';

export const PREVIEW_CSS = `
.ztf-pdf-root {
	display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px;
	min-inline-size: 0; inline-size: 100%; contain: inline-size;
	font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
	padding: 2px 0 4px 0; color: var(--fill-primary, currentColor);
}
.ztf-pdf-toolbar {
	display: flex; align-items: center; justify-content: space-between;
	gap: 4px; flex-wrap: wrap; min-block-size: 24px; padding: 0 1px 4px;
	background: transparent;
	border-bottom: 1px solid var(--fill-quinary, color-mix(in srgb, currentColor 7%, transparent));
}
.ztf-pdf-att-select {
	flex: 1 1 100%; min-inline-size: 0; inline-size: 100%; block-size: 22px;
	padding: 0 6px; margin-top: 2px; border-radius: 4px;
	border: 1px solid var(--fill-quarternary, rgba(127, 127, 127, 0.22));
	background: var(--material-background, transparent);
	color: var(--fill-primary, inherit); font: 500 11px/1.3 system-ui, sans-serif; cursor: pointer;
}
.ztf-pdf-btn-group { display: flex; align-items: center; gap: 2px; }
.ztf-pdf-btn {
	appearance: none !important; -moz-appearance: none !important; box-sizing: border-box;
	display: inline-flex; align-items: center; justify-content: center; gap: 4px;
	min-inline-size: 20px !important; min-block-size: 20px !important; block-size: 20px !important;
	margin: 0 !important; padding: 0 5px !important;
	border: 1px solid transparent !important; border-radius: 4px !important;
	background: transparent !important; box-shadow: none !important;
	color: var(--fill-secondary, inherit); font: 500 11.5px/1 system-ui, sans-serif;
	cursor: pointer; user-select: none;
	transition: background-color 0.12s ease, color 0.12s ease, opacity 0.12s ease;
}
.ztf-pdf-btn-svg { inline-size: 12px; block-size: 12px; flex-shrink: 0; pointer-events: none; }
.ztf-pdf-btn:hover:not(:disabled) {
	background: var(--fill-quinary, color-mix(in srgb, currentColor 8%, transparent)) !important;
	color: var(--fill-primary, inherit);
}
.ztf-pdf-btn:active:not(:disabled) {
	background: var(--fill-quarternary, color-mix(in srgb, currentColor 14%, transparent)) !important;
}
.ztf-pdf-btn:disabled { opacity: 0.32; cursor: default; }
.ztf-pdf-compare-bar {
	display: flex; align-items: center; gap: 3px; flex: 1 1 100%; min-inline-size: 0;
	padding-top: 3px; margin-top: 2px;
	border-top: 1px dashed var(--fill-quinary, color-mix(in srgb, currentColor 8%, transparent));
}
.ztf-pdf-compare-count {
	flex-shrink: 0; padding: 1px 5px; border-radius: 999px;
	background: var(--accent-blue10, rgba(64, 114, 229, 0.12));
	color: var(--accent-blue, #4072e5); font: 600 10.5px/1.3 system-ui, sans-serif;
	font-variant-numeric: tabular-nums;
}
.ztf-pdf-compare-nav { flex-shrink: 0; padding: 0 3px !important; }
.ztf-pdf-compare-btn { font-size: 11px !important; padding: 0 6px !important; flex-shrink: 0; }
.ztf-pdf-compare-btn[data-active="true"] {
	color: var(--accent-blue, #4072e5) !important;
	background: var(--accent-blue10, rgba(64, 114, 229, 0.14)) !important;
	border-color: var(--accent-blue30, rgba(64, 114, 229, 0.35)) !important;
}
.ztf-pdf-compare-select {
	flex: 1 1 auto; min-inline-size: 0; block-size: 20px; padding: 0 5px; border-radius: 4px;
	border: 1px solid var(--fill-quarternary, rgba(127, 127, 127, 0.22));
	background: var(--material-background, transparent); color: var(--fill-primary, inherit);
	font: 500 11px/1.2 system-ui, sans-serif; cursor: pointer;
}
.ztf-pdf-open-btn {
	padding: 0 7px !important; color: var(--accent-blue, #4072e5) !important;
	background: var(--accent-blue10, rgba(64, 114, 229, 0.1)) !important;
	font-weight: 500; font-size: 11px;
}
.ztf-pdf-open-btn:hover:not(:disabled) {
	background: var(--accent-blue30, rgba(64, 114, 229, 0.2)) !important;
	color: var(--accent-blue, #4072e5) !important;
}
.ztf-pdf-page-label {
	min-inline-size: 38px; padding: 2px 4px; border-radius: 4px;
	text-align: center; font-variant-numeric: tabular-nums;
	color: var(--fill-secondary, inherit); font-size: 11px; cursor: pointer; user-select: none;
}
.ztf-pdf-page-label:hover {
	background: var(--fill-quinary, color-mix(in srgb, currentColor 8%, transparent));
	color: var(--fill-primary, inherit);
}
.ztf-pdf-page-input {
	inline-size: 38px; block-size: 19px; padding: 0 3px; border-radius: 4px;
	border: 1px solid var(--accent-blue, #4072e5);
	background: var(--material-background, #fff); color: var(--fill-primary, inherit);
	font: 500 11px/1 system-ui, sans-serif; text-align: center; outline: none;
}
.ztf-pdf-status {
	padding: 12px 8px; color: var(--fill-secondary, inherit);
	font-size: 12px; text-align: center; display: none; overflow-wrap: anywhere;
}
.ztf-pdf-viewport {
	position: relative; display: flex; flex-direction: column; align-items: stretch;
	gap: 8px; max-block-size: calc(100vh - 170px);
	overflow-y: auto; overflow-x: auto; padding: 2px 0 4px; background: transparent;
	scrollbar-width: thin; outline: none;
	scrollbar-color: var(--color-scrollbar, rgba(127, 127, 127, 0.38)) transparent;
}
.ztf-pdf-page-card {
	position: relative; flex: 0 0 auto; flex-shrink: 0; display: block;
	inline-size: 100%; box-sizing: border-box; background: #fff;
	border-radius: 5px; border: 1px solid var(--fill-quarternary, rgba(0, 0, 0, 0.12));
	box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); overflow: hidden; cursor: pointer;
	transition: border-color 0.14s ease, box-shadow 0.14s ease;
}
.ztf-pdf-page-card:hover {
	border-color: var(--accent-blue50, rgba(64, 114, 229, 0.45));
	box-shadow: 0 2px 6px rgba(0, 0, 0, 0.09);
}
.ztf-pdf-page-card[data-unrendered="true"] {
	aspect-ratio: 1 / 1.4142; min-block-size: 320px;
	background: var(--fill-senary, rgba(0, 0, 0, 0.02));
}
.ztf-pdf-canvas { display: block; inline-size: 100%; block-size: auto; background: #fff; }
.ztf-pdf-page-badge {
	position: absolute; inset-inline-end: 6px; inset-block-end: 6px;
	padding: 1px 6px; border-radius: 999px; font: 500 10px/1.35 system-ui, sans-serif;
	font-variant-numeric: tabular-nums; background: rgba(15, 23, 42, 0.56);
	color: #fff; pointer-events: none; opacity: 0.72; transition: opacity 0.14s ease;
}
.ztf-pdf-page-card:hover .ztf-pdf-page-badge { opacity: 0.95; }
.ztf-pdf-root[data-show-badge="false"] .ztf-pdf-page-badge { display: none; }
[data-ztf-pdf-full-hidden="true"], [data-ztf-pdf-full-stack="true"] > :not([data-ztf-pdf-full-section="true"]) { display: none !important; }
[data-ztf-pdf-full-stack="true"] {
	display: flex !important; flex-direction: column !important;
	block-size: 100% !important; max-block-size: 100% !important; overflow: hidden !important;
}
[data-ztf-pdf-full-section="true"],
[data-ztf-pdf-full-section="true"] > collapsible-section,
[data-ztf-pdf-full-section="true"] > collapsible-section > [data-type="body"] {
	display: flex !important; flex-direction: column !important;
	flex: 1 1 auto !important; block-size: 100% !important; min-block-size: 0 !important;
}
[data-ztf-pdf-full-section="true"] > collapsible-section > .head { display: none !important; }
.ztf-pdf-root[data-layout-mode="full"] {
	display: flex; flex-direction: column; flex: 1 1 auto; block-size: 100%; min-block-size: 0;
}
.ztf-pdf-root[data-layout-mode="full"] .ztf-pdf-viewport {
	flex: 1 1 auto; max-block-size: calc(100vh - 96px); block-size: 100%;
}
`;

export function ensurePdfPreviewStyles(doc: Document): void {
	if (!doc?.getElementById) return;
	let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
	if (!style) {
		style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style') as HTMLStyleElement;
		style.id = STYLE_ID;
		(doc.head || doc.documentElement)?.append(style);
	}
	if (style.textContent !== PREVIEW_CSS) style.textContent = PREVIEW_CSS;
}

export function removePdfPreviewStyles(doc?: Document | null): void {
	doc?.getElementById?.(STYLE_ID)?.remove?.();
}
