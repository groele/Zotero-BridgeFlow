const SVG_NS = 'http://www.w3.org/2000/svg';

export type WorkspaceIconName =
	| 'bridge'
	| 'plus'
	| 'folder'
	| 'sleep'
	| 'sidebar'
	| 'search'
	| 'pin'
	| 'close'
	| 'archive';

const ICON_PATHS: Record<WorkspaceIconName, string> = {
	bridge: 'M2 11 C4 4, 12 4, 14 11 M1.5 11 H14.5 M5.5 7.5 V11 M8 5.5 V11 M10.5 7.5 V11',
	plus: 'M8 3 V13 M3 8 H13',
	folder: 'M2 4.5 C2 3.7 2.7 3 3.5 3 H6.5 L8 4.5 H12.5 C13.3 4.5 14 5.2 14 6 V11.5 C14 12.3 13.3 13 12.5 13 H3.5 C2.7 13 2 12.3 2 11.5 Z',
	sleep: 'M11.5 10.5 A4.5 4.5 0 0 1 5.5 4.5 A5 5 0 1 0 11.5 10.5 Z',
	sidebar: 'M2.5 3 H13.5 V13 H2.5 Z M6 3 V13',
	search: 'M7 11.5 A4.5 4.5 0 1 1 7 2.5 A4.5 4.5 0 0 1 7 11.5 Z M10.5 10.5 L14 14',
	pin: 'M5 3 H11 L10 7.5 L12 9.5 H8 V13.5 M8 9.5 H4 L6 7.5 Z',
	close: 'M4 4 L12 12 M12 4 L4 12',
	archive: 'M2.5 3.5 H13.5 V6 H2.5 Z M3.5 6 V12.5 H12.5 V6 M6.5 8.5 H9.5',
};

export function createWorkspaceIcon(doc: Document, name: WorkspaceIconName, size = 14): SVGElement {
	const svg = doc.createElementNS(SVG_NS, 'svg') as unknown as SVGElement;
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('width', String(size));
	svg.setAttribute('height', String(size));
	svg.setAttribute('fill', 'none');
	svg.setAttribute('class', 'zbf-tb-icon');
	const path = doc.createElementNS(SVG_NS, 'path');
	path.setAttribute('d', ICON_PATHS[name]);
	path.setAttribute('stroke', 'currentColor');
	path.setAttribute('stroke-width', '1.5');
	path.setAttribute('stroke-linecap', 'round');
	path.setAttribute('stroke-linejoin', 'round');
	svg.append(path);
	return svg;
}
