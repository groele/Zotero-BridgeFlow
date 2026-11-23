import { safeGetItemField } from '../../services/item-resolution.ts';
import type { LookupCandidate } from './citation-lookup-engine.ts';
import { clearLookupResult, renderLookupTitle, setLookupL10n } from './inspector-styles.ts';

export interface LookupCardCallbacks {
	resolveItem: (candidate: LookupCandidate) => any;
	onLocate: (itemID: number) => Promise<boolean>;
	onOpenPdf: (itemOrID: any) => Promise<boolean>;
	onCiteWord?: (itemID: number) => boolean;
	isActive: () => boolean;
}

export function renderLookupItemCard(
	doc: Document,
	statusDiv: HTMLElement,
	candidate: LookupCandidate,
	fallbackState: string,
	l10nId: string,
	cb: LookupCardCallbacks,
): void {
	const target = cb.resolveItem(candidate);
	clearLookupResult(statusDiv);
	const card = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
	card.className = 'viewflow-lookup-card';

	const stateEl = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
	stateEl.className = 'viewflow-lookup-result-state';
	setLookupL10n(stateEl, l10nId, fallbackState);
	card.appendChild(stateEl);

	const head = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
	head.className = 'viewflow-lookup-card-head';
	renderLookupTitle(head, safeGetItemField(target, 'title') || candidate.title || '');
	card.appendChild(head);

	const meta = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
	meta.className = 'viewflow-lookup-card-meta';
	const journal = safeGetItemField(target, 'publicationTitle') || safeGetItemField(target, 'journalAbbreviation') || '';
	const year = (safeGetItemField(target, 'year') || safeGetItemField(target, 'date')).slice(0, 4);
	meta.textContent = `${journal} (${year}) · Vol.${safeGetItemField(target, 'volume') || '-'} · pp.${safeGetItemField(target, 'pages') || '-'}`;
	card.appendChild(meta);

	const actRow = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
	actRow.className = 'viewflow-lookup-actions';

	const locateBtn = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
	locateBtn.type = 'button';
	setLookupL10n(locateBtn, 'zbf-lookup-locate', '定位条目');
	locateBtn.onclick = async () => {
		const ok = await cb.onLocate(candidate.itemID);
		if (cb.isActive()) {
			setLookupL10n(
				stateEl,
				ok ? 'zbf-lookup-status-located' : 'zbf-lookup-status-locate-failed',
				ok ? '已定位' : '定位失败，请重试',
			);
		}
	};

	const pdfBtn = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
	pdfBtn.type = 'button';
	setLookupL10n(pdfBtn, 'zbf-lookup-open-pdf', '打开 PDF');
	pdfBtn.onclick = async () => {
		const opened = await cb.onOpenPdf(target || candidate.itemID);
		if (cb.isActive() && !opened) {
			setLookupL10n(stateEl, 'zbf-lookup-status-no-pdf', '未找到 PDF 附件');
		}
	};

	actRow.append(locateBtn, pdfBtn);
	if (cb.onCiteWord) {
		const citeBtn = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
		citeBtn.type = 'button';
		citeBtn.textContent = '插入 Word';
		citeBtn.title = '在当前 Word 光标处插入此文献的可编辑引文域';
		citeBtn.onclick = () => {
			const sent = cb.onCiteWord?.(candidate.itemID);
			if (cb.isActive() && sent) {
				setLookupL10n(stateEl, 'zbf-lookup-status-located', '已发送至 Word 光标处');
			}
		};
		actRow.appendChild(citeBtn);
	}
	card.appendChild(actRow);
	statusDiv.appendChild(card);
}

export function renderLookupCandidatesList(
	doc: Document,
	statusDiv: HTMLElement,
	items: readonly LookupCandidate[],
	cb: LookupCardCallbacks,
): void {
	clearLookupResult(statusDiv);
	const heading = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
	setLookupL10n(heading, 'zbf-lookup-candidates-heading', `找到 ${items.length} 篇可能匹配的文献，请点击选择：`, { count: items.length });
	statusDiv.appendChild(heading);

	const list = doc.createElementNS('http://www.w3.org/1999/xhtml', 'ul') as HTMLElement;
	for (const c of items) {
		const row = doc.createElementNS('http://www.w3.org/1999/xhtml', 'li');
		const btn = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
		btn.type = 'button';
		const tObj = cb.resolveItem(c);
		const j = safeGetItemField(tObj, 'journalAbbreviation') || safeGetItemField(tObj, 'publicationTitle') || '';
		const y = (safeGetItemField(tObj, 'year') || safeGetItemField(tObj, 'date')).slice(0, 4);
		const suffix = j || y ? ` (${[j, y].filter(Boolean).join(', ')})` : '';
		renderLookupTitle(btn, safeGetItemField(tObj, 'title') || c.title || '');
		if (suffix) btn.appendChild(doc.createTextNode(suffix));
		btn.onclick = () => renderLookupItemCard(doc, statusDiv, c, '候选文献，请核对后定位', 'zbf-lookup-state-candidate', cb);
		row.appendChild(btn);
		list.appendChild(row);
	}
	statusDiv.appendChild(list);
}

export function readSystemClipboardText(): string {
	try {
		const hostServices = (globalThis as any).Services;
		const hostCc = (globalThis as any).Cc;
		const hostCi = (globalThis as any).Ci;
		if (hostServices?.clipboard && hostCc && hostCi) {
			const trans = hostCc['@mozilla.org/widget/transferable;1'].createInstance(hostCi.nsITransferable);
			trans.init?.(null);
			trans.addDataFlavor('text/plain');
			hostServices.clipboard.getData(trans, hostCi.nsIClipboard.kGlobalClipboard);
			const holder: { value?: { data?: string } } = {};
			trans.getTransferData('text/plain', holder);
			const txt = String(holder.value?.data || '').trim();
			if (txt) return txt;
		}
	} catch { /* fallback below */ }
	try {
		return String((globalThis as any).Zotero?.Utilities?.Internal?.getClipboardText?.() || '').trim();
	} catch {
		return '';
	}
}
