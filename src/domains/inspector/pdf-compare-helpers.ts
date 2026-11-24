import type { ReaderNeighborRef, ReaderNeighborsPayload } from '../../kernel/types.ts';
import { createXhtmlEl } from './pdf-preview-ui.ts';
import { resolveAllPdfAttachments, type PdfAttachmentEntry } from './pdf-renderer.ts';
import { loadAttachmentPreviewDoc, type PreviewState } from './pdf-viewport-manager.ts';

export type NeighborSide = 'left' | 'right';

export interface NeighborCompareControls {
	leftBtn: HTMLButtonElement;
	rightBtn: HTMLButtonElement;
	activeSide: NeighborSide | null;
}

export function attachNeighborCompareButtons(
	doc: Document,
	bar: HTMLDivElement,
	signal: AbortSignal,
	onPickNeighbor: (side: NeighborSide) => void,
): NeighborCompareControls {
	const leftBtn = createXhtmlEl(doc, 'button');
	leftBtn.type = 'button';
	leftBtn.className = 'ztf-pdf-btn ztf-pdf-compare-btn ztf-pdf-neighbor-left';
	leftBtn.textContent = '◀ 左标签';
	leftBtn.style.display = 'none';

	const rightBtn = createXhtmlEl(doc, 'button');
	rightBtn.type = 'button';
	rightBtn.className = 'ztf-pdf-btn ztf-pdf-compare-btn ztf-pdf-neighbor-right';
	rightBtn.textContent = '右标签 ▶';
	rightBtn.style.display = 'none';

	const controls: NeighborCompareControls = { leftBtn, rightBtn, activeSide: null };
	leftBtn.addEventListener('click', () => onPickNeighbor('left'), { signal });
	rightBtn.addEventListener('click', () => onPickNeighbor('right'), { signal });
	bar.append(leftBtn, rightBtn);
	return controls;
}

export function syncNeighborCompareButtons(
	controls: NeighborCompareControls,
	bar: HTMLDivElement,
	tabType: string,
	sameItemCount: number,
	neighbors: ReaderNeighborsPayload | null,
): void {
	const isReader = tabType === 'reader';
	const hasLeft = isReader && Boolean(neighbors?.left);
	const hasRight = isReader && Boolean(neighbors?.right);

	controls.leftBtn.style.display = hasLeft ? 'inline-flex' : 'none';
	controls.rightBtn.style.display = hasRight ? 'inline-flex' : 'none';
	if (neighbors?.left) {
		const shortLeft = neighbors.left.title.slice(0, 8);
		controls.leftBtn.textContent = `◀ ${shortLeft}`;
		controls.leftBtn.title = `对照左侧标签页：${neighbors.left.title}`;
	}
	if (neighbors?.right) {
		const shortRight = neighbors.right.title.slice(0, 8);
		controls.rightBtn.textContent = `${shortRight} ▶`;
		controls.rightBtn.title = `对照右侧标签页：${neighbors.right.title}`;
	}

	if (controls.activeSide === 'left' && hasLeft) controls.leftBtn.setAttribute('data-active', 'true');
	else controls.leftBtn.removeAttribute('data-active');

	if (controls.activeSide === 'right' && hasRight) controls.rightBtn.setAttribute('data-active', 'true');
	else controls.rightBtn.removeAttribute('data-active');

	if (sameItemCount > 1 || (isReader && (sameItemCount >= 1 || hasLeft || hasRight))) {
		bar.style.display = 'flex';
	} else {
		bar.style.display = 'none';
	}
}

export async function resolveNeighborPdfEntries(ref: ReaderNeighborRef): Promise<PdfAttachmentEntry[]> {
	const hostItems = (globalThis as any).Zotero?.Items;
	const targetID = ref.parentItemID || ref.itemID;
	let item = targetID > 0
		? (hostItems?.get?.(targetID) || (hostItems?.getAsync ? await hostItems.getAsync(targetID).catch(() => null) : null))
		: null;
	if (!item && ref.itemID > 0 && ref.itemID !== targetID) {
		item = hostItems?.get?.(ref.itemID) || (hostItems?.getAsync ? await hostItems.getAsync(ref.itemID).catch(() => null) : null);
	}
	if (!item) return [];
	const entries = await resolveAllPdfAttachments(item);
	if (ref.itemID > 0) {
		const exact = entries.find((e) => e.id === ref.itemID);
		if (exact) return [exact, ...entries.filter((e) => e.id !== ref.itemID)];
	}
	return entries;
}

export async function activateNeighborComparison(
	state: PreviewState,
	controls: NeighborCompareControls,
	side: NeighborSide,
	neighbors: ReaderNeighborsPayload | null,
	onError: (err: unknown) => void,
): Promise<boolean> {
	const ref = side === 'left' ? neighbors?.left : neighbors?.right;
	if (!ref) return false;
	const entries = await resolveNeighborPdfEntries(ref);
	const chosen = entries[0];
	if (!chosen?.attachment) return false;
	controls.activeSide = side;
	state.compareUI.selfBtn?.removeAttribute?.('data-active');
	syncNeighborCompareButtons(controls, state.compareUI.bar, state.compare.tabType, state.attachments.length, neighbors);
	await loadAttachmentPreviewDoc(state, chosen.attachment, onError);
	return true;
}
