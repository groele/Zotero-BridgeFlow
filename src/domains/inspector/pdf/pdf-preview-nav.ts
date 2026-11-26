import type { ReaderNeighborsPayload } from '../../../kernel/types.ts';
import {
	activateNeighborComparison, attachNeighborCompareButtons, syncNeighborCompareButtons,
	type NeighborCompareControls, type NeighborSide,
} from './pdf-compare-helpers.ts';
import {
	createCompareBar, createToolBtn as toolBtn, createXhtmlEl as el,
	syncCompareBar, type CompareState,
} from './pdf-preview-ui.ts';
import { pickCompareAttachment } from './pdf-renderer.ts';
import { loadAttachmentPreviewDoc, type PreviewState } from './pdf-viewport-manager.ts';

export interface PreviewShellDeps {
	doc: Document;
	win: Window;
	body: HTMLElement;
	customSection: Element | null;
	collapsible: Element | null;
	tabType?: string;
	fullActive: boolean;
	defaultZoom: number;
	signal: AbortSignal;
	setSectionSummary?: (summary: string) => void;
	getAllowNeighbor: () => boolean;
	getLatestNeighbors: () => ReaderNeighborsPayload | null;
	getNeighborCtrl: (body: HTMLElement) => NeighborCompareControls | undefined;
	setNeighborCtrl: (body: HTMLElement, ctrl: NeighborCompareControls) => void;
	onRenderError: (err: unknown) => void;
}

export function buildPdfPreviewShell(deps: PreviewShellDeps): {
	state: PreviewState;
	zoomOutBtn: HTMLButtonElement;
	zoomInBtn: HTMLButtonElement;
	modeBtn: HTMLButtonElement;
} {
	const { doc, win, body, customSection, collapsible, tabType, fullActive, defaultZoom, signal, setSectionSummary } = deps;
	const root = el(doc, 'div');
	root.className = 'ztf-pdf-root';
	const toolbar = el(doc, 'div');
	toolbar.className = 'ztf-pdf-toolbar';

	const navGroup = el(doc, 'div');
	navGroup.className = 'ztf-pdf-btn-group';
	const prevBtn = toolBtn(doc, '‹', 'zbf-pdf-preview-prev', '', 'prev');
	const pageLabel = el(doc, 'span');
	pageLabel.className = 'ztf-pdf-page-label';
	pageLabel.textContent = '0 / 0';
	const nextBtn = toolBtn(doc, '›', 'zbf-pdf-preview-next', '', 'next');
	navGroup.append(prevBtn, pageLabel, nextBtn);

	const zoomGroup = el(doc, 'div');
	zoomGroup.className = 'ztf-pdf-btn-group';
	const zoomOutBtn = toolBtn(doc, '−', 'zbf-pdf-preview-zoom-out', '', 'zoomOut');
	const zoomLabel = toolBtn(doc, '100%');
	const zoomInBtn = toolBtn(doc, '+', 'zbf-pdf-preview-zoom-in', '', 'zoomIn');
	const modeBtn = toolBtn(doc, '', 'zbf-pdf-preview-toggle-mode', 'ztf-pdf-mode-btn', 'toggleMode');
	const openBtn = toolBtn(doc, '在阅读器中打开', 'zbf-pdf-preview-open-reader', 'ztf-pdf-open-btn', 'openReader');
	zoomGroup.append(zoomOutBtn, zoomLabel, zoomInBtn, modeBtn, openBtn);

	const attSelect = el(doc, 'select', 'display:none');
	attSelect.className = 'ztf-pdf-att-select';
	const compare: CompareState = { mode: 'sibling', pickedAttachmentID: null, currentAttachmentID: 0, tabType: tabType || 'library' };

	let stateRef: PreviewState;
	const compareUI = createCompareBar(doc, signal, () => stateRef.compare, (nextMode, nextPickedID) => {
		const ctrl = deps.getNeighborCtrl(body);
		if (ctrl) ctrl.activeSide = null;
		stateRef.compare.mode = nextMode;
		stateRef.compare.pickedAttachmentID = nextPickedID;
		const chosen = pickCompareAttachment(
			{ ownerID: stateRef.ownerID, currentAttachmentID: stateRef.compare.currentAttachmentID, entries: stateRef.attachments },
			nextMode,
			nextPickedID,
			stateRef.compare.tabType === 'reader' ? 'reader' : 'library',
		);
		if (chosen) {
			stateRef.compare.pickedAttachmentID = chosen.id;
			stateRef.attSelect.value = String(chosen.id);
		}
		syncCompareBar(compareUI, stateRef.compare, stateRef.attachments, chosen?.id || 0);
		if (ctrl) {
			syncNeighborCompareButtons(
				ctrl, compareUI.bar, stateRef.compare.tabType, stateRef.attachments.length,
				deps.getAllowNeighbor() ? deps.getLatestNeighbors() : null,
			);
		}
		if (chosen && chosen.attachment !== stateRef.attachment) {
			void loadAttachmentPreviewDoc(stateRef, chosen.attachment, deps.onRenderError);
		}
	});

	const neighborCtrl = attachNeighborCompareButtons(doc, compareUI.bar, signal, (side: NeighborSide) => {
		if (neighborCtrl.activeSide === side) {
			neighborCtrl.activeSide = null;
			syncNeighborCompareButtons(neighborCtrl, compareUI.bar, stateRef.compare.tabType, stateRef.attachments.length, deps.getLatestNeighbors());
			const fallback = pickCompareAttachment(
				{ ownerID: stateRef.ownerID, currentAttachmentID: stateRef.compare.currentAttachmentID, entries: stateRef.attachments },
				stateRef.compare.mode, stateRef.compare.pickedAttachmentID, stateRef.compare.tabType === 'reader' ? 'reader' : 'library',
			);
			if (fallback && fallback.attachment !== stateRef.attachment) {
				void loadAttachmentPreviewDoc(stateRef, fallback.attachment, deps.onRenderError);
			}
			return;
		}
		void activateNeighborComparison(stateRef, neighborCtrl, side, deps.getLatestNeighbors(), deps.onRenderError);
	});
	deps.setNeighborCtrl(body, neighborCtrl);
	toolbar.append(navGroup, zoomGroup, attSelect, compareUI.bar);

	const statusEl = el(doc, 'div');
	statusEl.className = 'ztf-pdf-status';
	const viewportEl = el(doc, 'div');
	viewportEl.className = 'ztf-pdf-viewport';
	viewportEl.setAttribute('tabindex', '0');
	root.append(toolbar, statusEl, viewportEl);
	body.append(root);

	stateRef = {
		doc, win, body, root, customSection, collapsible, setSectionSummary,
		item: null, ownerID: 0, attIdsKey: '', attachment: null, attachments: [], pageByAttachment: new Map<number, number>(),
		pdfDoc: null, loading: false, generation: 0, fullActive, zoom: defaultZoom,
		currentPage: 0, numPages: 0, lastWidth: 0, resizeTimer: null, loadTimer: null, lastSwitchAt: 0, resizeObserver: null,
		slots: [], observer: null, statusEl, pageLabel, zoomLabel, prevBtn, nextBtn, openBtn, attSelect, viewportEl, compare, compareUI,
	};
	return { state: stateRef, zoomOutBtn, zoomInBtn, modeBtn };
}
