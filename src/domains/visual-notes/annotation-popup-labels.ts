import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../kernel/types.ts';
import {
	DEFAULT_ANNOTATION_COLORS,
	normalizeHexColor,
	parseColorSemantics,
	parseEnabledAnnotationColors,
} from '../../services/annotation-utils.ts';

const STYLE_ID = 'zbf-reader-color-labels-style';
const LABEL_CLASS = 'zbf-popup-color-name';
const COLOR_KEYS = Object.keys(DEFAULT_ANNOTATION_COLORS);
const POPUP_CSS = `
.selection-popup, .annotation-popup { max-width: 480px !important; }
.selection-popup .colors, .annotation-popup .colors { flex-wrap: wrap !important; justify-content: flex-start !important; gap: 4px 6px !important; }
.selection-popup .colors .color-button, .annotation-popup .colors .color-button {
  width: auto !important; min-width: 20px; height: 24px !important;
  padding: 2px 7px !important; display: inline-flex !important;
  align-items: center !important; gap: 5px !important; border-radius: 6px !important;
  transition: background-color 0.14s ease, transform 0.12s cubic-bezier(0.22,1,0.36,1) !important;
}
.selection-popup .colors .color-button:hover, .annotation-popup .colors .color-button:hover {
  background-color: rgba(79, 70, 229, 0.08) !important;
}
.selection-popup .colors .color-button:active, .annotation-popup .colors .color-button:active {
  transform: scale(0.95) !important;
}
.selection-popup .colors .color-button[data-zbf-dedup-hidden="true"],
.annotation-popup .colors .color-button[data-zbf-dedup-hidden="true"] {
  display: none !important;
}
.selection-popup .colors .color-button svg, .annotation-popup .colors .color-button svg { flex: none; }
.${LABEL_CLASS} {
  font-size: 12px; font-weight: 500; line-height: 1.2; color: var(--fill-primary, currentColor);
  white-space: nowrap; max-width: 110px; overflow: hidden; text-overflow: ellipsis; pointer-events: none;
}
`;

function rgbToHex(raw: string): string {
	const m = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
	if (!m) return '';
	const toHex = (n: string) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0');
	return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`;
}

export function resolvePopupButtonColor(btn: Element, index: number): string {
	const fillNode = btn.querySelector?.('path[fill]:not([fill="none"]), rect[fill]:not([fill="none"]), circle[fill]:not([fill="none"])');
	const fillAttr = String(fillNode?.getAttribute?.('fill') || '').trim();
	if (fillAttr) {
		return fillAttr.startsWith('rgb') ? rgbToHex(fillAttr) : normalizeHexColor(fillAttr);
	}
	const bg = String((btn as HTMLElement).style?.backgroundColor || '').trim();
	if (bg.startsWith('#')) return normalizeHexColor(bg);
	if (bg.startsWith('rgb')) return rgbToHex(bg);
	return COLOR_KEYS[index] || '';
}

function isSelectedColorButton(btn: Element): boolean {
	try {
		if (btn.classList?.contains?.('active') || btn.classList?.contains?.('selected')) return true;
		if (btn.getAttribute?.('aria-pressed') === 'true' || btn.getAttribute?.('aria-checked') === 'true') return true;
		if (btn.getAttribute?.('data-selected') === 'true' || btn.hasAttribute?.('checked')) return true;
	} catch { /* ignore */ }
	return false;
}

export function decorateSelectionPopupDoc(
	readerDoc: Document,
	semantics: Readonly<Record<string, string>>,
	enabledColors?: ReadonlySet<string>,
): number {
	const buttons = readerDoc.querySelectorAll?.('.selection-popup .colors .color-button, .annotation-popup .colors .color-button');
	if (!buttons || !buttons.length) return 0;
	const activeSet = enabledColors && enabledColors.size > 0 ? enabledColors : parseEnabledAnnotationColors('');
	const groups = new Map<Element | null, Set<string>>();
	let updated = 0;
	buttons.forEach((btn: Element, index: number) => {
		const hex = resolvePopupButtonColor(btn, index);
		const label = (hex && semantics[hex]) || '';
		let span = btn.querySelector?.(`.${LABEL_CLASS}`) as HTMLElement | null;
		const group = btn.parentElement ?? null;
		const seen = groups.get(group) || new Set<string>();
		groups.set(group, seen);
		const slotHex = COLOR_KEYS[index] || '';
		const disabledByPalette = Boolean(hex) && !activeSet.has(hex) && !(slotHex && activeSet.has(slotHex));
		const isDup = !label || seen.has(label);
		if ((disabledByPalette || isDup) && !isSelectedColorButton(btn)) {
			span?.remove?.();
			btn.setAttribute?.('data-zbf-dedup-hidden', 'true');
			return;
		}
		btn.removeAttribute?.('data-zbf-dedup-hidden');
		if (!label) {
			span?.remove?.();
			return;
		}
		seen.add(label);
		if (!span) {
			const htmlNs = 'http://www.w3.org/1999/xhtml';
			span = (typeof readerDoc.createElementNS === 'function'
				? readerDoc.createElementNS(htmlNs, 'span')
				: readerDoc.createElement('span')) as HTMLElement;
			span.className = LABEL_CLASS;
			btn.appendChild(span);
		}
		if (span.textContent !== label) span.textContent = label;

		updated += 1;
	});
	return updated;
}

export function clearSelectionPopupDoc(readerDoc: Document): void {
	readerDoc.getElementById?.(STYLE_ID)?.remove?.();
	readerDoc.querySelectorAll?.(`.${LABEL_CLASS}`).forEach((el: Element) => el.remove?.());
	readerDoc.querySelectorAll?.('[data-zbf-dedup-hidden]').forEach((el: Element) => el.removeAttribute?.('data-zbf-dedup-hidden'));
}

export class ReaderPopupLabelsController {
	private readonly kernel: PluginKernel;
	private readonly attachedDocs = new Map<Document, () => void>();
	private readonly pendingReaders = new Set<object>();
	private notifierSub: Disposable | null = null;
	private active = false;
	private cachedRawLabels: string | null = null;
	private cachedSemantics: Record<string, string> | null = null;
	private cachedRawEnabled: string | null = null;
	private cachedEnabled: Set<string> | null = null;

	constructor(kernel: PluginKernel) {
		this.kernel = kernel;
	}

	isEnabled(): boolean {
		return Boolean(this.kernel.prefs.get('inspector.annotations.popupLabelsEnable'));
	}

	private getSemantics(): Record<string, string> {
		const raw = String(this.kernel.prefs.get('inspector.annotations.colorLabels') || '');
		if (this.cachedSemantics && this.cachedRawLabels === raw) return this.cachedSemantics;
		this.cachedRawLabels = raw;
		this.cachedSemantics = parseColorSemantics(raw);
		return this.cachedSemantics;
	}

	private getEnabledColors(): Set<string> {
		const raw = String(this.kernel.prefs.get('inspector.annotations.enabledColors') || '');
		if (this.cachedEnabled && this.cachedRawEnabled === raw) return this.cachedEnabled;
		this.cachedRawEnabled = raw;
		this.cachedEnabled = parseEnabledAnnotationColors(raw);
		return this.cachedEnabled;
	}

	start(): void {
		if (this.active) return;
		this.active = true;
		this.sync();
		this.notifierSub = this.kernel.notifier?.subscribe?.(['tab'], ({ event }) => {
			if (!this.active || !this.isEnabled()) return;
			if (event === 'add' || event === 'select' || event === 'open') {
				this.scanOpenReaders();
			} else if (event === 'close') {
				this.pruneClosedDocs();
			}
		}) ?? null;
	}

	stop(): void {
		this.active = false;
		this.notifierSub?.();
		this.notifierSub = null;
		this.pendingReaders.clear();
		for (const dispose of [...this.attachedDocs.values()]) dispose();
		this.attachedDocs.clear();
	}

	sync(): void {
		if (!this.active) return;
		if (!this.isEnabled()) {
			for (const dispose of [...this.attachedDocs.values()]) dispose();
			this.attachedDocs.clear();
			this.pendingReaders.clear();
			return;
		}
		this.scanOpenReaders();
		const sem = this.getSemantics();
		const enabled = this.getEnabledColors();
		for (const doc of this.attachedDocs.keys()) {
			decorateSelectionPopupDoc(doc, sem, enabled);
		}
	}

	attachReaderDoc(readerDoc: Document): void {
		if (!this.active || !this.isEnabled() || !readerDoc || this.attachedDocs.has(readerDoc)) return;
		const headOrRoot = readerDoc.head || readerDoc.documentElement;
		if (headOrRoot && !readerDoc.getElementById?.(STYLE_ID)) {
			const htmlNs = 'http://www.w3.org/1999/xhtml';
			const styleEl = typeof readerDoc.createElementNS === 'function'
				? readerDoc.createElementNS(htmlNs, 'style')
				: readerDoc.createElement('style');
			styleEl.id = STYLE_ID;
			styleEl.textContent = POPUP_CSS;
			headOrRoot.appendChild(styleEl);
		}

		const sheet = readerDoc.getElementById?.(STYLE_ID);
		if (sheet && sheet.textContent !== POPUP_CSS) sheet.textContent = POPUP_CSS;
		const apply = () => decorateSelectionPopupDoc(readerDoc, this.getSemantics(), this.getEnabledColors());
		apply();

		const Obs = (readerDoc.defaultView as any)?.MutationObserver || (globalThis as any).MutationObserver;
		const target = readerDoc.body || readerDoc.documentElement;
		let observer: MutationObserver | null = null;
		let applyQueued = false;
		if (Obs && target) {
			const isPopupMutation = (records: MutationRecord[]) => {
				try {
					for (let r = 0; r < records.length; r++) {
						const rec = records[r];
						const t = rec?.target as Element | null;
						if (t && t.nodeType === 1 && t.closest?.('.selection-popup, .annotation-popup')) return true;
						const added = rec?.addedNodes;
						if (added) {
							for (let i = 0; i < added.length; i++) {
								const el = added[i] as Element | null;
								if (el && el.nodeType === 1 && (el.matches?.('.selection-popup, .annotation-popup') || el.querySelector?.('.selection-popup, .annotation-popup'))) {
									return true;
								}
							}
						}
					}
					return false;
				} catch {
					return true;
				}
			};
			const obs = new Obs((records: MutationRecord[]) => {
				if (!isPopupMutation(records) || applyQueued) return;
				applyQueued = true;
				void Promise.resolve().then(() => {
					applyQueued = false;
					if (this.active && this.isEnabled() && this.attachedDocs.has(readerDoc)) apply();
				});
			}) as MutationObserver;
			obs.observe(target, { childList: true, subtree: true });
			observer = obs;
		}
		this.attachedDocs.set(readerDoc, () => {
			observer?.disconnect();
			clearSelectionPopupDoc(readerDoc);
		});
	}

	private scanOpenReaders(): void {
		const readers: any[] = (globalThis as any).Zotero?.Reader?._readers || [];
		for (const reader of readers) {
			if (!reader || reader._isTabClosed || reader._isUninitialized) continue;
			const doc = reader._iframeWindow?.document as Document | undefined;
			if (doc?.body) {
				this.attachReaderDoc(doc);
			} else if (!this.pendingReaders.has(reader)) {
				this.pendingReaders.add(reader);
				const waitReady = reader._waitForReader?.() ?? reader._initPromise ?? Promise.resolve();
				void Promise.resolve(waitReady).then(() => {
					this.pendingReaders.delete(reader);
					if (this.active && this.isEnabled() && !reader._isTabClosed) {
						const readyDoc = reader._iframeWindow?.document as Document | undefined;
						if (readyDoc?.body) this.attachReaderDoc(readyDoc);
					}
				}).catch(() => { this.pendingReaders.delete(reader); });
			}
		}
	}

	private pruneClosedDocs(): void {
		for (const [doc, dispose] of [...this.attachedDocs.entries()]) {
			if (!doc.defaultView || (doc.defaultView as any).closed) {
				this.attachedDocs.delete(doc);
				dispose();
			}
		}
	}
}
