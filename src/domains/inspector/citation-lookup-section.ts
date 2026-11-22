import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../kernel/types.ts';
import { resolvePdfAttachments } from '../../services/item-resolution.ts';
import { normalizePanePosition } from '../../services/pane-positioner.ts';
import type { ServiceContainer } from '../../services/service-container.ts';
import type { CitationLookupEngine, LookupCandidate } from './citation-lookup-engine.ts';
import {
	readSystemClipboardText, renderLookupCandidatesList, renderLookupItemCard,
} from './citation-lookup-ui.ts';
import { clearLookupResult, ensureViewFlowStyles, setLookupL10n } from './inspector-styles.ts';

export class CitationLookupSectionController {
	private unregisterFn: Disposable | null = null;
	private sectionID: string | false = false;
	private anchorSectionID: string | false = false;
	private readonly cleanups = new WeakMap<HTMLElement, () => void>();
	private readonly kernel: PluginKernel;
	private readonly services: ServiceContainer;
	private readonly engine: CitationLookupEngine;

	constructor(kernel: PluginKernel, services: ServiceContainer, engine: CitationLookupEngine) {
		this.kernel = kernel;
		this.services = services;
		this.engine = engine;
	}

	setAnchorSectionID(anchorID: string | false): void {
		this.anchorSectionID = anchorID;
		this.syncPositionTarget();
	}

	register(): void {
		if (this.unregisterFn) return;
		const icon = `${this.kernel.info.rootURI}assets/lookup.svg`;
		const reg = this.services.itemPanes.register({
			paneID: 'bridgeflow-citation-lookup',
			pluginID: this.kernel.info.id,
			header: { l10nID: 'zbf-pane-lookup-header', icon },
			sidenav: { l10nID: 'zbf-pane-lookup-sidenav', icon, orderable: true },
			onInit: ({ body, setEnabled }: { body: HTMLElement; setEnabled?: (v: boolean) => void }) => {
				setEnabled?.(true);
				this.mountUI(body);
				this.services.panePositions.observeAndQueue(body);
			},
			onDestroy: ({ body }: { body: HTMLElement }) => {
				this.cleanups.get(body)?.();
				this.cleanups.delete(body);
			},
			onItemChange: ({ body, setEnabled }: { body: HTMLElement; setEnabled?: (v: boolean) => void }) => {
				setEnabled?.(true);
				this.services.panePositions.observeAndQueue(body);
				return true;
			},
			onRender: ({ body, setEnabled }: { body: HTMLElement; setEnabled?: (v: boolean) => void }) => {
				setEnabled?.(true);
				this.services.panePositions.observeAndQueue(body);
			},
		});
		this.sectionID = reg.sectionID;
		this.unregisterFn = reg.dispose;
		this.syncPositionTarget();
	}

	unregister(): void {
		this.services.panePositions.setTarget('citation-lookup', null);
		this.sectionID = false;
		this.unregisterFn?.();
		this.unregisterFn = null;
	}

	private syncPositionTarget(): void {
		if (!this.sectionID) return;
		this.services.panePositions.setTarget('citation-lookup', {
			sectionID: this.sectionID,
			getPosition: () => normalizePanePosition(this.kernel.prefs.get('inspector.cslPreview.position'), 'zotero-item-pane-header'),
			anchorAfterSectionID: this.anchorSectionID || undefined,
		});
	}

	private mountUI(body: HTMLElement): void {
		this.cleanups.get(body)?.();
		const doc = body.ownerDocument;
		if (!doc) return;
		doc.defaultView?.MozXULElement?.insertFTLIfNeeded?.('zotero-bridgeflow.ftl');
		ensureViewFlowStyles(doc);

		body.textContent = '';
		body.className = 'zotero-viewflow-lookup-body';

		const container = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLDivElement;
		container.className = 'viewflow-lookup-container';

		const input = doc.createElementNS('http://www.w3.org/1999/xhtml', 'input') as HTMLInputElement;
		input.type = 'text';
		input.className = 'viewflow-lookup-input';
		input.setAttribute('data-l10n-id', 'zbf-lookup-input');

		const btnRow = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLDivElement;
		btnRow.className = 'viewflow-lookup-actions';

		const searchBtn = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
		searchBtn.type = 'button';
		searchBtn.className = 'viewflow-lookup-search';
		setLookupL10n(searchBtn, 'zbf-lookup-search', '查找原文献');

		const clipBtn = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
		clipBtn.type = 'button';
		setLookupL10n(clipBtn, 'zbf-lookup-clipboard', '读取剪贴板');
		btnRow.append(searchBtn, clipBtn);

		const statusDiv = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLDivElement;
		statusDiv.className = 'viewflow-lookup-status';
		statusDiv.setAttribute('role', 'status');
		statusDiv.setAttribute('aria-live', 'polite');

		container.append(input, btnRow, statusDiv);
		body.append(container);

		let request = 0;
		let pasteTimer: ReturnType<typeof setTimeout> | undefined;
		const cancelPaste = () => {
			if (pasteTimer !== undefined) clearTimeout(pasteTimer);
			pasteTimer = undefined;
		};
		this.cleanups.set(body, () => { request++; cancelPaste(); });

		const resolveItem = (candidate: LookupCandidate): any =>
			candidate.item || (globalThis as any).Zotero?.Items?.get?.(candidate.itemID) || null;

		const executeLookup = async (textToSearch: string) => {
			const current = ++request;
			const isActive = () => current === request && body.isConnected && input.value.trim() === textToSearch.trim();
			if (!textToSearch.trim()) {
				clearLookupResult(statusDiv);
				return;
			}
			const cb = {
				resolveItem,
				onLocate: (id: number) => this.locateItem(id),
				onOpenPdf: (target: any) => this.openItemPdf(target),
				isActive,
			};
			setLookupL10n(statusDiv, 'zbf-lookup-status-searching', '正在反查本地文献库...');
			try {
				const pane = (doc.defaultView as any)?.ZoteroPane;
				const libraryID = pane?.getSelectedLibraryIDs?.()?.[0] ?? (globalThis as any).Zotero?.Libraries?.userLibraryID;
				const outcome = await this.engine.resolveRich(textToSearch, {
					libraryID,
					useHistory: this.kernel.prefs.get('inspector.lookup.historyEnable'),
				});
				if (!isActive()) return;

				if (!outcome.historyMatched && !outcome.parsed && !outcome.candidates.length) {
					setLookupL10n(statusDiv, 'zbf-lookup-status-unrecognized', '无法识别引文结构，请提供包含期刊、年份、卷号与页码（或 DOI/arXiv）的引文。');
					return;
				}
				if (outcome.candidates.length === 1) {
					const hit = outcome.candidates[0];
					if (outcome.historyMatched) {
						renderLookupItemCard(doc, statusDiv, hit, '已匹配文献', 'zbf-lookup-state-matched', cb);
					} else {
						await this.locateInLibrary(hit.itemID);
						if (!isActive()) return;
						renderLookupItemCard(doc, statusDiv, hit, '已定位文献', 'zbf-lookup-state-located', cb);
					}
					return;
				}
				if (outcome.candidates.length > 1) {
					renderLookupCandidatesList(doc, statusDiv, outcome.candidates, cb);
					return;
				}
				const journalLabel = outcome.parsed?.journalText || outcome.parsed?.doi || outcome.parsed?.arxiv || '-';
				const yearLabel = String(outcome.parsed?.year || '-');
				setLookupL10n(
					statusDiv,
					'zbf-lookup-status-not-found',
					`未在当前文库中找到匹配项 (解析: ${journalLabel}, ${yearLabel})`,
					{ journal: journalLabel, year: yearLabel },
				);
			} catch {
				if (isActive()) setLookupL10n(statusDiv, 'zbf-lookup-status-error', '查询失败，请重试或重新粘贴引文。');
			}
		};

		input.oninput = () => {
			request++;
			clearLookupResult(statusDiv);
			if (!input.value.trim()) cancelPaste();
		};
		searchBtn.onclick = () => { void executeLookup(input.value); };
		input.onpaste = () => {
			cancelPaste();
			pasteTimer = setTimeout(() => {
				pasteTimer = undefined;
				if (input.value.trim()) void executeLookup(input.value);
			}, 0);
		};
		input.onkeydown = (e: Event) => {
			const key = (e as KeyboardEvent).key;
			if (key === 'Enter') {
				cancelPaste();
				void executeLookup(input.value);
			} else if (key === 'Escape') {
				cancelPaste();
				request++;
				input.value = '';
				clearLookupResult(statusDiv);
			}
		};
		clipBtn.onclick = () => {
			const clipText = readSystemClipboardText();
			if (clipText) {
				input.value = clipText;
				void executeLookup(clipText);
				return;
			}
			setLookupL10n(statusDiv, 'zbf-lookup-status-clipboard-fallback', '无法直接读取剪贴板，请手动在输入框中粘贴 (Ctrl+V)。');
			input.focus();
		};
	}

	private async locateInLibrary(itemID: number): Promise<boolean> {
		const win = (globalThis as any).Zotero?.getMainWindow?.();
		if (!win?.ZoteroPane) return false;
		try {
			win.Zotero_Tabs?.select?.('zotero-pane');
			const ok = await win.ZoteroPane.selectItem(itemID);
			if (ok === false) return false;
			const tree = win.document?.getElementById?.('zotero-items-tree');
			if (tree?.ensureRowIsVisible && tree?.selection) {
				tree.ensureRowIsVisible(tree.selection.currentIndex);
			}
			return true;
		} catch {
			return false;
		}
	}

	private async locateItem(itemID: number): Promise<boolean> {
		if (this.kernel.prefs.get('fusion.lookupJumpExistingTab')) {
			this.kernel.bus.emit('workspace:open-item-request', {
				itemID,
				preferExistingTab: true,
				assignToActiveGroup: false,
			});
		}
		return this.locateInLibrary(itemID);
	}

	private async openItemPdf(itemOrId: any): Promise<boolean> {
		try {
			const item = typeof itemOrId === 'number'
				? await (globalThis as any).Zotero?.Items?.getAsync?.(itemOrId)
				: itemOrId;
			if (!item) return false;
			const pdfs = await resolvePdfAttachments(item);
			const first = pdfs[0];
			if (!first) return false;
			if (this.kernel.prefs.get('fusion.lookupJumpExistingTab')) {
				this.kernel.bus.emit('workspace:open-item-request', {
					itemID: Number(item.id || 0),
					attachmentID: first.id,
					preferExistingTab: true,
					assignToActiveGroup: true,
				});
				return true;
			}
			const reader = (globalThis as any).Zotero?.Reader;
			if (reader?.open) {
				await reader.open(first.id);
				return true;
			}
		} catch { /* ignore */ }
		return false;
	}
}
