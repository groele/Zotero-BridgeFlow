import { stripItemTitleMarkup } from '../../../services/item-resolution.ts';

export const READER_ATT_STYLE_ID = 'zbf-reader-att-switcher-style';
export const READER_ATT_BTN_CLASS = 'zbf-reader-att-wrap';
export const READER_ATT_MENU_ID = 'zbf-reader-att-menu';
export const READER_ATT_BACKDROP_ID = 'zbf-reader-att-backdrop';

export type AttachmentKind = 'pdf' | 'epub' | 'snapshot' | 'image' | 'file' | 'link';

export interface SiblingAttachmentEntry {
	id: number;
	title: string;
	filename: string;
	kind: AttachmentKind;
	kindLabel: string;
	readerCapable: boolean;
}

export const READER_ATT_SWITCHER_CSS = `
.custom-sections > .section:has(> .${READER_ATT_BTN_CLASS}[hidden]) {
	display: none !important;
}
.${READER_ATT_BTN_CLASS} {
	display: inline-flex;
	align-items: center;
	margin-inline: 2px;
	-moz-window-dragging: no-drag;
}
.${READER_ATT_BTN_CLASS}[hidden] { display: none !important; }
.zbf-reader-att-btn {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	height: 26px;
	padding: 0 8px 0 10px;
	border-radius: 6px;
	border: 1px solid transparent;
	background: var(--fill-quinary, rgba(0, 0, 0, 0.055));
	color: var(--fill-primary, #262626);
	font: 12px/1 system-ui, "Microsoft YaHei UI", sans-serif;
	cursor: pointer;
	white-space: nowrap;
	-moz-window-dragging: no-drag;
	transition: background-color 0.12s ease, border-color 0.12s ease;
}
.zbf-reader-att-btn:hover,
.zbf-reader-att-btn[aria-expanded="true"] {
	background: var(--fill-quarternary, rgba(0, 0, 0, 0.105));
}
.zbf-reader-att-btn:focus-visible {
	outline: 2px solid var(--accent-blue, #4072e5);
	outline-offset: 1px;
}
.zbf-reader-att-chev { width: 10px; height: 10px; opacity: 0.72; flex-shrink: 0; }
#${READER_ATT_BACKDROP_ID} {
	position: fixed;
	inset: 0;
	z-index: 2147483639;
	background: transparent;
	-moz-window-dragging: no-drag;
}
#${READER_ATT_MENU_ID} {
	position: fixed;
	z-index: 2147483640;
	min-width: 224px;
	max-width: min(380px, calc(100vw - 16px));
	max-height: 320px;
	overflow-y: auto;
	padding: 5px;
	border-radius: 10px;
	background: var(--color-background, #ffffff);
	color: var(--fill-primary, #1e293b);
	border: 1px solid var(--color-border, rgba(0, 0, 0, 0.14));
	box-shadow: 0 10px 28px rgba(0, 0, 0, 0.16), 0 2px 6px rgba(0, 0, 0, 0.08);
	font: 12.5px/1.4 system-ui, "Microsoft YaHei UI", sans-serif;
	box-sizing: border-box;
	-moz-window-dragging: no-drag;
}
.zbf-reader-att-item {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	padding: 6px 8px;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: inherit;
	font: 12.5px/1.35 system-ui, "Microsoft YaHei UI", sans-serif;
	text-align: left;
	cursor: pointer;
}
.zbf-reader-att-item:hover,
.zbf-reader-att-item[data-focused="true"] {
	background: var(--fill-quinary, rgba(0, 0, 0, 0.06));
}
.zbf-reader-att-item[data-active="true"] { font-weight: 600; }
.zbf-reader-att-check {
	width: 14px;
	height: 14px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	color: var(--accent-blue, #4072e5);
}
.zbf-reader-att-title {
	flex: 1 1 auto;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.zbf-reader-att-badge {
	flex-shrink: 0;
	font-size: 10.5px;
	padding: 1px 5px;
	border-radius: 4px;
	background: var(--fill-quinary, rgba(0, 0, 0, 0.06));
	color: var(--fill-secondary, #64748b);
}
.zbf-reader-att-open-dot {
	width: 6px;
	height: 6px;
	border-radius: 999px;
	background: var(--accent-blue, #4072e5);
	flex-shrink: 0;
}
`;

export function createReaderHtmlEl<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K): HTMLElementTagNameMap[K] {
	return doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K];
}

export function createReaderSvgIcon(doc: Document, className: string, viewBox: string, pathD: string): Element {
	const ns = 'http://www.w3.org/2000/svg';
	const svg = doc.createElementNS(ns, 'svg');
	if (className) svg.setAttribute('class', className);
	svg.setAttribute('viewBox', viewBox);
	svg.setAttribute('aria-hidden', 'true');
	const path = doc.createElementNS(ns, 'path');
	path.setAttribute('d', pathD);
	path.setAttribute('fill', 'none');
	path.setAttribute('stroke', 'currentColor');
	path.setAttribute('stroke-width', '1.8');
	path.setAttribute('stroke-linecap', 'round');
	path.setAttribute('stroke-linejoin', 'round');
	svg.appendChild(path);
	return svg;
}

const KIND_RANK: Record<AttachmentKind, number> = {
	pdf: 0,
	epub: 1,
	snapshot: 2,
	image: 3,
	file: 4,
	link: 5,
};

function classifyAttachment(child: any): { kind: AttachmentKind; kindLabel: string; readerCapable: boolean } {
	const ct = String(child?.attachmentContentType || '').toLowerCase();
	const fname = String(child?.attachmentFilename || '').toLowerCase();
	const linkMode = Number(child?.attachmentLinkMode ?? -1);
	if (child?.isPDFAttachment?.() || ct === 'application/pdf' || fname.endsWith('.pdf')) {
		return { kind: 'pdf', kindLabel: 'PDF', readerCapable: true };
	}
	if (child?.isEPUBAttachment?.() || ct === 'application/epub+zip' || fname.endsWith('.epub')) {
		return { kind: 'epub', kindLabel: 'EPUB', readerCapable: true };
	}
	if (child?.isSnapshotAttachment?.() || ct === 'text/html' || ct === 'application/xhtml+xml' || fname.endsWith('.html') || fname.endsWith('.htm')) {
		const isUrlOnly = linkMode === 3;
		return { kind: isUrlOnly ? 'link' : 'snapshot', kindLabel: isUrlOnly ? 'Link' : 'Snapshot', readerCapable: !isUrlOnly };
	}
	if (ct.startsWith('image/')) return { kind: 'image', kindLabel: 'Image', readerCapable: false };
	if (linkMode === 3) return { kind: 'link', kindLabel: 'Link', readerCapable: false };
	return { kind: 'file', kindLabel: 'File', readerCapable: false };
}

export function resolveSiblingAttachments(
	currentAttID: number,
	includeSnapshots = true,
): { parentID: number; items: SiblingAttachmentEntry[] } {
	const hostItems = (globalThis as any).Zotero?.Items;
	if (!hostItems?.get || !currentAttID) return { parentID: 0, items: [] };
	const cur = hostItems.get(currentAttID);
	if (!cur || cur.deleted || cur.isTrashed?.()) return { parentID: 0, items: [] };
	const parentID = Number(cur.parentItemID || 0);
	const parent = parentID > 0 ? hostItems.get(parentID) : null;
	if (!parent || parent.deleted || parent.isTrashed?.() || typeof parent.getAttachments !== 'function') {
		return { parentID: 0, items: [] };
	}

	const rawIds: number[] = parent.getAttachments() || [];
	const rows: Array<SiblingAttachmentEntry & { order: number }> = [];
	const seen = new Set<number>();
	rawIds.forEach((rawId, idx) => {
		const id = Number(rawId) || 0;
		if (!id || seen.has(id)) return;
		seen.add(id);
		const child = hostItems.get(id);
		if (!child || child.deleted || child.isTrashed?.() || child.isNote?.() === true) return;
		const { kind, kindLabel, readerCapable } = classifyAttachment(child);
		if (!readerCapable || (!includeSnapshots && id !== currentAttID && kind === 'snapshot')) return;
		const rawTitle = stripItemTitleMarkup(String(child.getField?.('title') || '')).trim();
		const filename = String(child.attachmentFilename || '').trim();
		const fallback = kind === 'snapshot' ? 'Snapshot' : (filename || kindLabel);
		rows.push({ id, title: rawTitle || fallback, filename, kind, kindLabel, readerCapable, order: idx });
	});

	const titleCounts = new Map<string, number>();
	for (const r of rows) titleCounts.set(r.title, (titleCounts.get(r.title) || 0) + 1);
	for (const r of rows) {
		if ((titleCounts.get(r.title) || 0) > 1 && r.filename && r.filename !== r.title) {
			r.title = `${r.title} (${r.filename})`;
		}
	}
	rows.sort((a, b) => (KIND_RANK[a.kind] - KIND_RANK[b.kind]) || (a.order - b.order));
	return { parentID, items: rows.map(({ order: _order, ...entry }) => entry) };
}
