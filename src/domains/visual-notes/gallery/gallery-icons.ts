const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

export function createToolbarArt(doc: Document, kind: 'gallery' | 'notes'): SVGSVGElement {
	const svg = doc.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('width', '20');
	svg.setAttribute('height', '20');
	svg.setAttribute('aria-hidden', 'true');
	const shape = (fill: string, d: string) => {
		const path = doc.createElementNS(SVG_NS, 'path');
		path.setAttribute('fill', fill);
		path.setAttribute('d', d);
		svg.appendChild(path);
	};
	if (kind === 'gallery') {
		shape('#635BD9', 'M3 4a2 2 0 0 1 2-2h7v13H5a2 2 0 0 1-2-2z');
		shape('#169A99', 'M14 5h5a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-5z');
		shape('#818CF8', 'M3 17h9v5H5a2 2 0 0 1-2-2z');
		shape('#fff', 'M5 5h5v1.4H5z M16 8h3v1.4h-3z');
	} else {
		shape('#635BD9', 'M2 5q5-1.6 9.5 1v15Q7 18.7 2 20z');
		shape('#169A99', 'M13 6q4-2.5 9-1v15q-5-1.3-9 1z');
		shape('#FABB56', 'M16 3h3.5v9L18 10.5 16 12z');
		shape('#fff', 'M4.5 8q2.6-.3 4.6.8v1.3q-2.3-1-4.6-.8z M4.5 11q2.6-.3 4.6.8v1.3q-2.3-1-4.6-.8z');
	}
	return svg;
}

export type GalleryIconName =
	| 'grid'
	| 'board'
	| 'hub'
	| 'doc'
	| 'user'
	| 'calendar'
	| 'book'
	| 'clock'
	| 'tag'
	| 'search'
	| 'sort'
	| 'star'
	| 'note';

const ICON_PATHS: Readonly<Record<GalleryIconName, readonly string[]>> = {
	grid: [
		'M3.5 3.5h4.2v4.2H3.5z',
		'M10.3 3.5h4.2v4.2h-4.2z',
		'M3.5 10.3h4.2v4.2H3.5z',
		'M10.3 10.3h4.2v4.2h-4.2z',
	],
	board: [
		'M2.8 3.2h12.4a1 1 0 0 1 1 1v9.6a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1V4.2a1 1 0 0 1 1-1z',
		'M6.9 3.2v11.6',
		'M11.1 3.2v11.6',
	],
	hub: [
		'M4 2.8h8.5L15 5.3v9.9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1z',
		'M6 7.5h6',
		'M6 10.5h6',
		'M6 13.2h3.8',
	],
	doc: [
		'M4.5 2.5h5.8L13.5 5.7v7.8a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z',
		'M10 2.5v3.4h3.4',
		'M6.2 8.5h5.2',
		'M6.2 11.2h3.8',
	],
	user: [
		'M9 8.2a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4z',
		'M3.8 14.6c0-2.4 2.3-4.1 5.2-4.1s5.2 1.7 5.2 4.1',
	],
	calendar: [
		'M3.2 4.2h11.6a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3.2a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z',
		'M5.8 2.4v2.6',
		'M12.2 2.4v2.6',
		'M2.2 7.4h13.6',
	],
	book: [
		'M2.5 3.6c1.8-.5 3.8-.5 5.5.4 1.7-.9 3.7-.9 5.5-.4v10.2c-1.8-.5-3.8-.5-5.5.4-1.7-.9-3.7-.9-5.5-.4z',
		'M8 4v10.2',
	],
	clock: [
		'M9 15.2a6.2 6.2 0 1 0 0-12.4 6.2 6.2 0 0 0 0 12.4z',
		'M9 5.5V9l2.4 1.6',
	],
	tag: [
		'M2.8 9.1V3.8a1 1 0 0 1 1-1h5.3l6.1 6.1a1 1 0 0 1 0 1.4l-4.9 4.9a1 1 0 0 1-1.4 0z',
		'M5.8 5.8h.01',
	],
	search: [
		'M8.2 13.4a5.2 5.2 0 1 0 0-10.4 5.2 5.2 0 0 0 0 10.4z',
		'M12.1 12.1l3.2 3.2',
	],
	sort: [
		'M5.5 3.5v11',
		'M3 6l2.5-2.5L8 6',
		'M12.5 14.5v-11',
		'M10 12l2.5 2.5L15 12',
	],
	star: [
		'M9 2.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L9 12.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z',
	],
	note: [
		'M3.5 3.2h11a1 1 0 0 1 1 1v7.6l-3.2 3.2H3.5a1 1 0 0 1-1-1V4.2a1 1 0 0 1 1-1z',
		'M11.8 11.5v3.2',
	],
};

export function createGallerySvgIcon(doc: Document, name: GalleryIconName, size = 14): SVGElement {
	const svg = doc.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('width', String(size));
	svg.setAttribute('height', String(size));
	svg.setAttribute('viewBox', '0 0 18 18');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '1.45');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	svg.setAttribute('aria-hidden', 'true');
	svg.style.flex = 'none';
	for (const d of ICON_PATHS[name] || []) {
		const path = doc.createElementNS(SVG_NS, 'path');
		path.setAttribute('d', d);
		svg.appendChild(path);
	}
	return svg;
}

const RICH_TAG_RE = /<(\/?)(sub|sup|i|em|b|strong|span)(?:\s[^>]*)?>/gi;

/**
 * Safely renders academic titles containing inline <sub>, <sup>, <i>, <b> tags
 * (e.g. MoS<sub>2</sub>, WSe<sub>2</sub>) into real DOM nodes without innerHTML.
 */
export function renderRichTitleNodes(doc: Document, container: HTMLElement, rawTitle: string): void {
	const text = String(rawTitle || '');
	container.textContent = '';
	if (!text.includes('<') || !doc.createTextNode) {
		container.textContent = text;
		return;
	}
	const stack: HTMLElement[] = [container];
	let lastIdx = 0;
	for (const match of text.matchAll(RICH_TAG_RE)) {
		const idx = match.index ?? 0;
		if (idx > lastIdx) {
			stack[stack.length - 1].appendChild(doc.createTextNode(text.slice(lastIdx, idx)));
		}
		const isClose = match[1] === '/';
		const rawTag = match[2].toLowerCase();
		const normTag = rawTag === 'em' ? 'i' : rawTag === 'strong' ? 'b' : rawTag;
		if (!isClose) {
			if (normTag === 'span') {
				// Keep text inline without pushing structural styling
				stack.push(doc.createElementNS(XHTML_NS, 'span') as HTMLElement);
				stack[stack.length - 2].appendChild(stack[stack.length - 1]);
			} else {
				const node = doc.createElementNS(XHTML_NS, normTag) as HTMLElement;
				stack[stack.length - 1].appendChild(node);
				stack.push(node);
			}
		} else if (stack.length > 1) {
			stack.pop();
		}
		lastIdx = idx + match[0].length;
	}
	if (lastIdx < text.length) {
		stack[stack.length - 1].appendChild(doc.createTextNode(text.slice(lastIdx)));
	}
}

export interface PastelPillStyle {
	readonly bg: string;
	readonly fg: string;
	readonly darkBg: string;
	readonly darkFg: string;
}

const PASTEL_PALETTE: readonly PastelPillStyle[] = [
	{ bg: '#ffe4e6', fg: '#9f1239', darkBg: 'rgba(244,63,94,0.2)', darkFg: '#fda4af' },
	{ bg: '#ffedd5', fg: '#9a3412', darkBg: 'rgba(249,115,22,0.2)', darkFg: '#fdba74' },
	{ bg: '#dcfce7', fg: '#166534', darkBg: 'rgba(34,197,94,0.2)', darkFg: '#86efac' },
	{ bg: '#e0f2fe', fg: '#075985', darkBg: 'rgba(14,165,233,0.2)', darkFg: '#7dd3fc' },
	{ bg: '#ede9fe', fg: '#5b21b6', darkBg: 'rgba(139,92,246,0.2)', darkFg: '#c4b5fd' },
	{ bg: '#fef3c7', fg: '#92400e', darkBg: 'rgba(245,158,11,0.2)', darkFg: '#fcd34d' },
	{ bg: '#f1f5f9', fg: '#334155', darkBg: 'rgba(148,163,184,0.2)', darkFg: '#cbd5e1' },
];

export function resolvePastelTagStyle(tag: string): PastelPillStyle {
	let h = 0;
	const s = String(tag || '');
	for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
	return PASTEL_PALETTE[Math.abs(h) % PASTEL_PALETTE.length];
}
