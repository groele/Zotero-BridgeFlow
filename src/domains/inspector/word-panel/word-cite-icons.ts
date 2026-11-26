const SVG_NS = 'http://www.w3.org/2000/svg';

export type WordCiteIconName = 'word' | 'refresh' | 'switch' | 'chevron';

interface SvgShapeSpec {
	readonly tag: 'path' | 'rect';
	readonly attrs: Readonly<Record<string, string>>;
}

const WORD_SHAPES: readonly SvgShapeSpec[] = [
	{ tag: 'path', attrs: { d: 'M7.2 4.8C7.2 3.53 8.23 2.5 9.5 2.5h9.7c1.27 0 2.3 1.03 2.3 2.3v2.45H7.2V4.8Z', fill: 'var(--zbf-w-b1)' } },
	{ tag: 'path', attrs: { d: 'M7.2 7.25h14.3v4.75H7.2V7.25Z', fill: 'var(--zbf-w-b2)' } },
	{ tag: 'path', attrs: { d: 'M7.2 12h14.3v4.75H7.2V12Z', fill: 'var(--zbf-w-b3)' } },
	{ tag: 'path', attrs: { d: 'M7.2 16.75h14.3v2.45c0 1.27-1.03 2.3-2.3 2.3H9.5c-1.27 0-2.3-1.03-2.3-2.3v-2.45Z', fill: 'var(--zbf-w-b4)' } },
	{ tag: 'rect', attrs: { x: '2.8', y: '6.9', width: '11.4', height: '11.4', rx: '2.5', fill: 'var(--zbf-w-shadow)' } },
	{ tag: 'rect', attrs: { x: '2', y: '6.1', width: '11.4', height: '11.4', rx: '2.5', fill: 'var(--zbf-w-shield)' } },
	{ tag: 'path', attrs: { d: 'M4.05 8.9h1.48l.98 4.45 1.08-4.45h1.34l1.08 4.45.98-4.45h1.48l-1.62 5.75H9.44L8.26 10.4l-1.18 4.25H5.67L4.05 8.9Z', fill: '#ffffff' } },
];

const STROKE_ICON_PATHS: Readonly<Record<Exclude<WordCiteIconName, 'word'>, { viewBox: string; paths: readonly string[] }>> = {
	refresh: {
		viewBox: '0 0 14 14',
		paths: [
			'M11.4 7a4.4 4.4 0 1 1-1.12-2.95',
			'M11.5 2.1v2.2H9.3',
		],
	},
	switch: {
		viewBox: '0 0 14 14',
		paths: [
			'M2.5 4.7h8.5M8.8 2.5L11 4.7 8.8 7',
			'M11.5 9.3H3M5.2 7L3 9.3l2.2 2.2',
		],
	},
	chevron: {
		viewBox: '0 0 12 12',
		paths: ['M2.6 4.5L6 7.9 9.4 4.5'],
	},
};

function createSvgNode(doc: Document, tag: string): Element {
	return typeof doc.createElementNS === 'function'
		? doc.createElementNS(SVG_NS, tag)
		: doc.createElement(tag);
}

export function createWordCiteSvgIcon(doc: Document, name: WordCiteIconName, cls = 'zbf-wc-svg'): Element {
	const svg = createSvgNode(doc, 'svg');
	svg.setAttribute('class', cls);
	svg.setAttribute('fill', 'none');
	svg.setAttribute('aria-hidden', 'true');

	if (name === 'word') {
		svg.setAttribute('viewBox', '0 0 24 24');
		for (const spec of WORD_SHAPES) {
			const node = createSvgNode(doc, spec.tag);
			for (const [k, v] of Object.entries(spec.attrs)) node.setAttribute(k, v);
			svg.appendChild(node);
		}
		return svg;
	}

	const spec = STROKE_ICON_PATHS[name];
	svg.setAttribute('viewBox', spec.viewBox);
	for (const d of spec.paths) {
		const path = createSvgNode(doc, 'path');
		path.setAttribute('d', d);
		path.setAttribute('stroke', 'currentColor');
		path.setAttribute('stroke-width', '1.4');
		path.setAttribute('stroke-linecap', 'round');
		path.setAttribute('stroke-linejoin', 'round');
		svg.appendChild(path);
	}
	return svg;
}
