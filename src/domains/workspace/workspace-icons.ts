const SVG_NS = 'http://www.w3.org/2000/svg';

export type WorkspaceIconName =
	| 'more'
	| 'bridge'
	| 'layers'
	| 'plus'
	| 'folder'
	| 'sleep'
	| 'sidebar'
	| 'topbar'
	| 'search'
	| 'pin'
	| 'close'
	| 'archive'
	| 'workspace'
	| 'clock'
	| 'pdf'
	| 'note'
	| 'virtual'
	| 'edit'
	| 'palette'
	| 'trash'
	| 'save'
	| 'collapse'
	| 'word'
	| 'copy'
	| 'locate'
	| 'refresh'
	| 'undo'
	| 'play'
	| 'eye';

interface ShapeDef {
	tag: 'path' | 'circle' | 'rect' | 'ellipse';
	attrs: Record<string, string>;
}

const ICONS: Record<WorkspaceIconName, ShapeDef[]> = {
	more: [
		{ tag: 'circle', attrs: { cx: '3.5', cy: '8', r: '1.1', fill: 'currentColor', stroke: 'none' } },
		{ tag: 'circle', attrs: { cx: '8', cy: '8', r: '1.1', fill: 'currentColor', stroke: 'none' } },
		{ tag: 'circle', attrs: { cx: '12.5', cy: '8', r: '1.1', fill: 'currentColor', stroke: 'none' } },
	],
	layers: [
		{ tag: 'path', attrs: { d: 'M8 2.2L2.2 5.3 8 8.4l5.8-3.1L8 2.2ZM2.2 8.2L8 11.3l5.8-3.1M2.2 11L8 14l5.8-3' } },
	],
	bridge: [
		{ tag: 'path', attrs: { d: 'M8 2.2L2.2 5.3 8 8.4l5.8-3.1L8 2.2ZM2.2 8.2L8 11.3l5.8-3.1M2.2 11L8 14l5.8-3' } },
	],
	plus: [
		{ tag: 'path', attrs: { d: 'M8 3.6v8.8M3.6 8h8.8' } },
	],
	folder: [
		{ tag: 'path', attrs: { d: 'M2.2 4.2a1 1 0 0 1 1-1h3l1.2 1.3h5.4a1 1 0 0 1 1 1v6.3a1 1 0 0 1-1 1H3.2a1 1 0 0 1-1-1V4.2Z' } },
	],
	sleep: [
		{ tag: 'path', attrs: { d: 'M12.8 9.9A5.4 5.4 0 0 1 6.1 3.2a5.5 5.5 0 1 0 6.7 6.7Z' } },
	],
	sidebar: [
		{ tag: 'rect', attrs: { x: '2.2', y: '2.8', width: '11.6', height: '10.4', rx: '1.6' } },
		{ tag: 'path', attrs: { d: 'M6 2.8v10.4' } },
	],
	topbar: [
		{ tag: 'rect', attrs: { x: '2.2', y: '2.8', width: '11.6', height: '10.4', rx: '1.6' } },
		{ tag: 'path', attrs: { d: 'M2.3 6.4h11.4' } },
	],
	workspace: [
		{ tag: 'rect', attrs: { x: '2.2', y: '2.8', width: '11.6', height: '10.4', rx: '1.6' } },
		{ tag: 'path', attrs: { d: 'M2.3 6h11.4M9.4 6v7.2' } },
	],
	archive: [
		{ tag: 'rect', attrs: { x: '2.2', y: '3', width: '11.6', height: '2.6', rx: '0.8' } },
		{ tag: 'path', attrs: { d: 'M3.2 5.6v6.6a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V5.6M6.5 8.4h3' } },
	],
	search: [
		{ tag: 'circle', attrs: { cx: '7', cy: '7', r: '4.4' } },
		{ tag: 'path', attrs: { d: 'M10.3 10.3L13.5 13.5' } },
	],
	pin: [
		{ tag: 'path', attrs: { d: 'M9.5 2.5L13.5 6.5L12 8L10.2 7.6L7.6 10.2L8 12L6.5 13.5L2.5 9.5L4 8L5.8 8.4L8.4 5.8L8 4L9.5 2.5Z' } },
		{ tag: 'path', attrs: { d: 'M4.5 11.5L2 14' } },
	],
	close: [
		{ tag: 'path', attrs: { d: 'M4.5 4.5l7 7M11.5 4.5l-7 7' } },
	],
	clock: [
		{ tag: 'circle', attrs: { cx: '8', cy: '8', r: '5.7' } },
		{ tag: 'path', attrs: { d: 'M8 4.8V8l2.2 1.5' } },
	],
	pdf: [
		{ tag: 'path', attrs: { d: 'M4 2h5.5L13 5.5V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z' } },
		{ tag: 'path', attrs: { d: 'M9.5 2v3.5H13M5.5 8.5h5M5.5 11h3.5' } },
	],
	note: [
		{ tag: 'path', attrs: { d: 'M3.2 2.5h9.6a1 1 0 0 1 1 1v6.8L10.3 13.8H3.2a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z' } },
		{ tag: 'path', attrs: { d: 'M10 13.8v-3.5h3.5M5 6h5.5M5 8.8h3.8' } },
	],
	virtual: [
		{ tag: 'circle', attrs: { cx: '8', cy: '8', r: '5.5', 'stroke-dasharray': '2.4 2.1' } },
	],
	edit: [
		{ tag: 'path', attrs: { d: 'M10.8 2.6a1.4 1.4 0 0 1 2 2L5.5 11.9 2.6 12.6l.7-2.9 7.5-7.1Z' } },
		{ tag: 'path', attrs: { d: 'M9.5 3.9l2 2' } },
	],
	palette: [
		{ tag: 'path', attrs: { d: 'M8 2.3a5.7 5.7 0 1 0 0 11.4c.9 0 1.5-.6 1.5-1.4 0-.4-.2-.7-.4-1-.2-.3-.3-.6-.3-.9 0-.7.6-1.3 1.3-1.3h1.4A2.5 2.5 0 0 0 13.7 6.6C13.7 4.1 11.1 2.3 8 2.3Z' } },
		{ tag: 'circle', attrs: { cx: '5.5', cy: '6.3', r: '0.8', fill: 'currentColor', stroke: 'none' } },
		{ tag: 'circle', attrs: { cx: '8', cy: '5', r: '0.8', fill: 'currentColor', stroke: 'none' } },
		{ tag: 'circle', attrs: { cx: '10.4', cy: '6.3', r: '0.8', fill: 'currentColor', stroke: 'none' } },
	],
	trash: [
		{ tag: 'path', attrs: { d: 'M3 4.4h10M6.2 4.4V3.1a.8.8 0 0 1 .8-.8h2a.8.8 0 0 1 .8.8v1.3M4.4 4.4l.6 8.3a1 1 0 0 0 1 .9h4a1 1 0 0 0 1-.9l.6-8.3M6.8 7v4M9.2 7v4' } },
	],
	save: [
		{ tag: 'path', attrs: { d: 'M3.4 2.6h7.4l2.6 2.6v7.4a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1V3.6a1 1 0 0 1 1-1Z' } },
		{ tag: 'path', attrs: { d: 'M5.3 2.6v3.4h4.8V2.6M5.2 13.6V9.2h5.6v4.4' } },
	],
	collapse: [
		{ tag: 'path', attrs: { d: 'M4 6l4-3 4 3M4 10l4 3 4-3M3 8h10' } },
	],
	word: [
		{ tag: 'rect', attrs: { x: '2.4', y: '2.4', width: '11.2', height: '11.2', rx: '1.8' } },
		{ tag: 'path', attrs: { d: 'M4.7 5.3l1.4 5.4 1.9-4.1 1.9 4.1 1.4-5.4' } },
	],
	copy: [
		{ tag: 'rect', attrs: { x: '5.5', y: '5.5', width: '7.8', height: '7.8', rx: '1.3' } },
		{ tag: 'path', attrs: { d: 'M3.7 10.5H3.2a1 1 0 0 1-1-1V3.4a1 1 0 0 1 1-1h6.1a1 1 0 0 1 1 1v.5' } },
	],
	locate: [
		{ tag: 'circle', attrs: { cx: '8', cy: '8', r: '4.5' } },
		{ tag: 'circle', attrs: { cx: '8', cy: '8', r: '1.4', fill: 'currentColor', stroke: 'none' } },
		{ tag: 'path', attrs: { d: 'M8 2v1.6M8 12.4V14M2 8h1.6M12.4 8H14' } },
	],
	refresh: [
		{ tag: 'path', attrs: { d: 'M13.2 5.4A5.5 5.5 0 0 0 3.3 5M2.8 2.6v2.8h2.8M2.8 10.6a5.5 5.5 0 0 0 9.9.4M13.2 13.4v-2.8h-2.8' } },
	],
	undo: [
		{ tag: 'path', attrs: { d: 'M5.5 4.2L2.6 7l2.9 2.8' } },
		{ tag: 'path', attrs: { d: 'M3 7h6.5a3.7 3.7 0 1 1 0 7.4H6.8' } },
	],
	play: [
		{ tag: 'path', attrs: { d: 'M4.5 3.3l8.2 4.7-8.2 4.7V3.3Z' } },
	],
	eye: [
		{ tag: 'path', attrs: { d: 'M1.8 8s2.3-4.2 6.2-4.2S14.2 8 14.2 8s-2.3 4.2-6.2 4.2S1.8 8 1.8 8Z' } },
		{ tag: 'circle', attrs: { cx: '8', cy: '8', r: '1.9' } },
	],
};

export function createWorkspaceIcon(doc: Document, name: WorkspaceIconName, size = 13): SVGElement {
	const svg = doc.createElementNS(SVG_NS, 'svg') as unknown as SVGElement;
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('width', String(size));
	svg.setAttribute('height', String(size));
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '1.35');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('class', 'zbf-tb-icon');
	for (const def of ICONS[name] || ICONS.layers) {
		const el = doc.createElementNS(SVG_NS, def.tag);
		for (const [k, v] of Object.entries(def.attrs)) {
			el.setAttribute(k, v);
		}
		svg.appendChild(el);
	}
	return svg;
}
