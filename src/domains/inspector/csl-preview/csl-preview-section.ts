import type { PluginKernel } from '../../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../../kernel/types.ts';
import { deduplicateRegularItems } from '../../../services/item-resolution.ts';
import { normalizePanePosition } from '../../../services/pane-positioner.ts';
import type { ServiceContainer } from '../../../services/service-container.ts';
import {
	clearPreviewTimers, PREVIEW_ERROR_L10N, renderPreviewCopyError, renderPreviewMessage,
	renderPreviewPayload, showPreviewCopyFeedback, type PreviewBlockContent, type PreviewPaneState,
} from './csl-preview-dom.ts';
import { ensureViewFlowStyles } from './inspector-styles.ts';

export class CslPreviewSectionController {
	public sectionID: string | false = false;
	private readonly states = new Map<HTMLElement, PreviewPaneState>();
	private unregisterFn: Disposable | null = null;
	private readonly kernel: PluginKernel;
	private readonly services: ServiceContainer;

	constructor(kernel: PluginKernel, services: ServiceContainer) {
		this.kernel = kernel;
		this.services = services;
	}

	register(): void {
		if (this.unregisterFn) return;
		const icon = `${this.kernel.info.rootURI}assets/view.svg`;
		const reg = this.services.itemPanes.register({
			paneID: 'bridgeflow-csl-preview',
			pluginID: this.kernel.info.id,
			header: { l10nID: 'zbf-pane-csl-preview-header', icon },
			sidenav: { l10nID: 'zbf-pane-csl-preview-sidenav', icon, orderable: true },
			onInit: ({ body, item, setEnabled }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void }) => {
				const doc = body.ownerDocument;
				if (!doc) return;
				doc.defaultView?.MozXULElement?.insertFTLIfNeeded?.('zotero-bridgeflow.ftl');
				ensureViewFlowStyles(doc);
				body.classList.add('zotero-preview-root');
				body.style.contain = 'content';
				const st: PreviewPaneState = {
					body, doc, items: [], itemsSig: '', omitted: 0, generation: 0, failed: false, lastHTML: '',
					renderedSig: '', lastChangeAt: 0, inFlightSig: '', inFlight: null, payload: null,
					copyFeedback: new Map(), feedbackTimers: new Set(), setEnabled,
				};
				this.states.set(body, st);
				this.bindBodyEvents(st);
				this.updateItems(st, item, setEnabled);
				this.services.panePositions.observeAndQueue(body);
			},
			onDestroy: ({ body }: { body: HTMLElement }) => {
				const st = this.states.get(body);
				if (st) clearPreviewTimers(st);
				this.states.delete(body);
			},
			onItemChange: ({ body, item, setEnabled }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void }) => {
				const st = this.states.get(body);
				if (!st) return false;
				st.failed = false;
				this.services.panePositions.observeAndQueue(body);
				return this.updateItems(st, item, setEnabled);
			},
			onRender: ({ body, item, setEnabled }: { body: HTMLElement; item?: any; setEnabled?: (v: boolean) => void }) => {
				const st = this.states.get(body);
				if (!st) return;
				this.updateItems(st, item, setEnabled);
				this.services.panePositions.observeAndQueue(body);
				void this.renderState(body);
			},
			onAsyncRender: async ({ body }: { body: HTMLElement }) => { await this.renderState(body); },
			onToggle: ({ body }: { body: HTMLElement }) => { void this.renderState(body); },
		});
		this.sectionID = reg.sectionID;
		this.unregisterFn = reg.dispose;
		if (this.sectionID) {
			this.services.panePositions.setTarget('csl-preview', {
				sectionID: this.sectionID,
				getPosition: () => normalizePanePosition(this.kernel.prefs.get('inspector.cslPreview.position'), 'zotero-item-pane-header'),
			});
		}
	}

	async renderState(body: HTMLElement, force = false): Promise<void> {
		const st = this.states.get(body);
		if (!st) return;
		const runSig = `${st.itemsSig}|${this.kernel.prefs.get('inspector.cslPreview.citationstyle')}|${this.kernel.prefs.get('inspector.cslPreview.whatToShow')}|${this.kernel.prefs.get('inspector.cslPreview.fontsize')}|${this.kernel.prefs.get('inspector.cslPreview.spacing')}`;
		if (!force && !st.failed && st.renderedSig === runSig && st.lastHTML) return;
		if (!force && st.inFlight && st.inFlightSig === runSig) return st.inFlight;
		const gen = ++st.generation;
		if (!st.items.length) {
			st.payload = null;
			st.renderedSig = runSig;
			renderPreviewMessage(st, 'zbf-preview-select-items', '请选择一个或多个条目以预览引用。');
			return;
		}
		const mode = String(this.kernel.prefs.get('inspector.cslPreview.whatToShow') || 'zpboth');
		const wantBib = mode !== 'zpcite' && mode !== 'zpintext';
		const wantCite = mode !== 'zpbib';
		const isCacheHit = (!wantBib || Boolean(this.services.csl.peekCached(st.items, { asCitation: false })))
			&& (!wantCite || Boolean(this.services.csl.peekCached(st.items, { asCitation: true })));
		if (!st.payload && !st.lastHTML) renderPreviewMessage(st, 'zbf-preview-loading', '正在生成预览…');
		const scrubDelay = !force && !isCacheHit && st.lastChangeAt > 0 && Date.now() - st.lastChangeAt < 120 ? 42 : 0;
		let task: Promise<void> | null = null;
		task = (async () => {
			try {
				if (scrubDelay > 0) {
					await new Promise<void>((r) => setTimeout(r, scrubDelay));
					if (gen !== st.generation || st.body.isConnected === false) return;
				}
				const [bibRes, citeRes] = await Promise.all([
					wantBib ? this.services.csl.formatItems(st.items, { asCitation: false }) : Promise.resolve(null),
					wantCite ? this.services.csl.formatItems(st.items, { asCitation: true }) : Promise.resolve(null),
				]);
				if (gen !== st.generation || st.body.isConnected === false) return;
				const payload: Partial<Record<'bibliography' | 'citation', PreviewBlockContent>> = {};
				if (bibRes && (bibRes.html || bibRes.text)) payload.bibliography = bibRes;
				if (citeRes && (citeRes.html || citeRes.text)) payload.citation = citeRes;
				st.payload = payload;
				st.failed = false;
				st.renderedSig = runSig;
				renderPreviewPayload(
					st,
					payload,
					String(this.kernel.prefs.get('inspector.cslPreview.fontsize') || '1'),
					String(this.kernel.prefs.get('inspector.cslPreview.spacing') || '1.5'),
				);
			} catch (error) {
				if (gen !== st.generation || st.body.isConnected === false) return;
				st.payload = null;
				st.failed = true;
				st.renderedSig = '';
				const code = (error as { previewCode?: string })?.previewCode || '';
				const [id, fallback] = PREVIEW_ERROR_L10N[code] || ['zbf-preview-unavailable', '预览不可用，请检查引用样式后重试。'];
				const detail = code ? '' : (error instanceof Error ? error.message : String(error || ''));
				renderPreviewMessage(st, id, fallback, true, detail);
			} finally {
				if (st.inFlight === task) { st.inFlight = null; st.inFlightSig = ''; }
			}
		})();
		st.inFlight = task;
		st.inFlightSig = runSig;
		return task;
	}

	async refreshModifiedItems(itemIDs: readonly number[]): Promise<void> {
		if (!itemIDs.length) { await this.refreshAll(); return; }
		const idSet = new Set(itemIDs);
		for (const [body, st] of this.states.entries()) {
			if (!st.items.some((it) => idSet.has(Number(it?.id || 0)))) continue;
			st.itemsSig = '';
			st.renderedSig = '';
			this.updateItems(st, st.items[0]);
			await this.renderState(body, true);
		}
	}

	async refreshAll(): Promise<void> {
		for (const [body, st] of this.states.entries()) {
			st.itemsSig = '';
			st.renderedSig = '';
			this.updateItems(st, st.items[0]);
			await this.renderState(body, true);
		}
	}

	unregister(): void {
		this.services.panePositions.setTarget('csl-preview', null);
		this.sectionID = false;
		this.unregisterFn?.();
		this.unregisterFn = null;
		for (const st of this.states.values()) clearPreviewTimers(st);
		this.states.clear();
	}

	private updateItems(st: PreviewPaneState, item: any, setEnabled?: (v: boolean) => void): boolean {
		const maxItems = this.kernel.prefs.get('inspector.cslPreview.maxPreviewItems');
		const isReader = Boolean(st.body.closest?.('zotero-reader, [data-pane-type="reader"]'));
		const paneSel: any[] = !isReader
			? ((st.doc.defaultView as any)?.ZoteroPane?.getSelectedItems?.() || (globalThis as any).Zotero?.getMainWindow?.()?.ZoteroPane?.getSelectedItems?.() || [])
			: [];
		const useMulti = paneSel.length > 1 && (!item || paneSel.some((s) => s === item || (s?.id && s.id === item?.id)));
		const selected = useMulti ? paneSel : (item ? [item] : paneSel);
		const unique = deduplicateRegularItems(selected).items;
		const items = unique.slice(0, maxItems);
		const omitted = unique.length - items.length;
		const nextSig = items.map((it) => `${it?.id ?? ''}:${it?.version ?? it?.dateModified ?? ''}`).join('|');
		if (nextSig !== st.itemsSig || st.omitted !== omitted) {
			st.itemsSig = nextSig;
			st.renderedSig = '';
			st.lastChangeAt = Date.now();
			st.generation++;
			st.inFlight = null;
			st.inFlightSig = '';
			st.payload = null;
		}
		st.items = items;
		st.omitted = omitted;
		const enabled = items.length > 0;
		(setEnabled || st.setEnabled)?.(enabled);
		return enabled;
	}

	private bindBodyEvents(st: PreviewPaneState): void {
		const triggerCopy = (button: HTMLElement | null) => {
			if (!button || !st.payload) return;
			const asCitation = button.getAttribute('data-copy-citation') === 'true';
			const content = st.payload[asCitation ? 'citation' : 'bibliography'];
			if (!content) return;
			const ok = this.services.clipboard.copyRendered(st.items, content, { asCitation, source: 'preview' });
			if (ok) {
				st.body.querySelector?.('.zotero-preview-copy-status')?.remove();
				showPreviewCopyFeedback(st, button);
			} else {
				renderPreviewCopyError(st);
			}
		};

		const interceptAnchor = (ev: Event): boolean => {
			const anchor = (ev.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
			if (!anchor) return false;
			ev.preventDefault?.();
			ev.stopPropagation?.();
			const raw = String(anchor.getAttribute('href') || '').trim();
			const url = /^doi:/i.test(raw) ? `https://doi.org/${encodeURIComponent(raw.replace(/^doi:\s*/i, ''))}` : raw;
			if ((ev.type === 'click' || (ev as MouseEvent).button === 1) && /^(?:https?:|mailto:)/i.test(url)) {
				try { (globalThis as any).Zotero?.launchURL?.(url); } catch { /* ignore */ }
			}
			return true;
		};
		st.body.addEventListener('auxclick', (ev: Event) => { interceptAnchor(ev); });
		st.body.addEventListener('click', (ev: Event) => {
			if (interceptAnchor(ev)) return;
			const target = ev.target as Element | null;
			const retryBtn = target?.closest?.('.zotero-preview-retry') as HTMLElement | null;
			if (retryBtn) { st.failed = false; void this.renderState(st.body, true); return; }
			const copyBtn = target?.closest?.('.zotero-preview-copy') as HTMLElement | null;
			if (copyBtn) triggerCopy(copyBtn);
		});
		st.body.addEventListener('keydown', (ev: Event) => {
			const keyEv = ev as KeyboardEvent;
			if (keyEv.key !== 'Enter' && keyEv.key !== ' ') return;
			const copyBtn = (ev.target as Element | null)?.closest?.('.zotero-preview-copy') as HTMLElement | null;
			if (!copyBtn) return;
			keyEv.preventDefault?.();
			triggerCopy(copyBtn);
		});
	}
}
