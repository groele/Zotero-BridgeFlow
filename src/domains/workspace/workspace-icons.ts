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
	| 'virtual';

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
		{ tag: 'rect', attrs: { x: '2.2', y: '2.8', width: '11.6', height: '10.4', rx: '1.6' } },
		{ tag: 'path', attrs: { d: 'M2.3 6h11.4M9.4 6v7.2' } },
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
