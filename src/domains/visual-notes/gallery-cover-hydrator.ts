import {
	rejectGalleryPdfCover,
	makeAbortController,
	notifyGalleryCoverScroll,
	requestGalleryPdfCover,
} from '../../services/pdf-cover-service.ts';
import { createToolbarArt } from './gallery-icons.ts';
import { galEl } from './gallery-styles.ts';

export function createViewportCoverHydrator(viewport: HTMLElement, doc: Document) {
	const tasks = new Map<HTMLElement, AbortController>();
	const tracked = new Set<HTMLElement>();
	const priorities = new WeakMap<HTMLElement, number>();
	let disposed = false;
	let observer: IntersectionObserver | null = null;

	const cancelCard = (card: HTMLElement) => {
		const ctrl = tasks.get(card);
		if (ctrl) {
			tasks.delete(card);
			ctrl.abort();
		}
	};

	const retried = new WeakSet<HTMLElement>();
	const startCard = (card: HTMLElement) => {
		if (disposed || tasks.has(card) || !card.isConnected) return;
		const cover = card.querySelector<HTMLElement>('.zbf-gal-cover[data-pdf-att-id]');
		const attID = Number(cover?.dataset.pdfAttId);
		if (!cover || !attID || cover.querySelector('.zbf-gal-cover-img')) return;

		const ctrl = makeAbortController(doc.defaultView);
		tasks.set(card, ctrl);
		void requestGalleryPdfCover({
			attID, doc, signal: ctrl.signal,
			priority: () => priorities.get(card) ?? 1,
		}).then((url) => {
			if (tasks.get(card) === ctrl) tasks.delete(card);
			if (!url || disposed || ctrl.signal.aborted || !cover.isConnected) return;
			const img = galEl(doc, 'img');
			img.className = 'zbf-gal-cover-img';
			img.decoding = 'async';
			img.hidden = true;
			img.addEventListener('load', () => {
				if (disposed || !cover.isConnected) return;
				cover.querySelector('.zbf-gal-cover-abstract, .zbf-gal-cover-fallback')?.remove();
				img.hidden = false;
				img.setAttribute('data-loaded', 'true');
			}, { once: true });
			img.addEventListener('error', () => {
				img.remove();
				rejectGalleryPdfCover(attID, url);
				if (disposed || !tracked.has(card) || retried.has(card)) return;
				retried.add(card);
				startCard(card);
			}, { once: true });
			cover.prepend(img);
			img.src = url;
		}).catch(() => {
			if (tasks.get(card) === ctrl) tasks.delete(card);
		});
	};

	const ensureObserver = (): IntersectionObserver | null => {
		if (observer || !viewport.isConnected) return observer;
		const IO = (doc.defaultView as any)?.IntersectionObserver || (globalThis as any).IntersectionObserver;
		if (!IO) return null;
		const obs = new IO((entries: IntersectionObserverEntry[]) => {
			if (disposed) return;
			for (const entry of entries) {
				const card = entry.target as HTMLElement;
				if (entry.isIntersecting) {
					const rect = entry.boundingClientRect;
					const root = entry.rootBounds;
					priorities.set(card, root
						? Math.max(1, Math.round(2000 - Math.abs((rect.top + rect.bottom - root.top - root.bottom) / 2)))
						: 1);
					startCard(card);
				}
				else if (!card.contains(doc.activeElement)) cancelCard(card);
			}
		}, { root: viewport, rootMargin: '260px 120px', threshold: [0, 0.5, 1] }) as IntersectionObserver;
		observer = obs;
		for (const c of tracked) {
			if (c.isConnected) obs.observe(c);
		}
		return obs;
	};

	const onScroll = () => notifyGalleryCoverScroll();
	viewport.addEventListener('scroll', onScroll, { passive: true });
	viewport.addEventListener('wheel', onScroll, { passive: true });

	return {
		observeCard(card: HTMLElement) {
			if (disposed) return;
			if (!card.querySelector('.zbf-gal-cover[data-pdf-att-id]')) return;
			tracked.add(card);
			const obs = ensureObserver();
			if (obs && card.isConnected) obs.observe(card);
			if (viewport.isConnected && card.isConnected && !obs) startCard(card);
		},
		activate() {
			if (disposed) return;
			const obs = ensureObserver();
			for (const c of tracked) {
				if (!c.isConnected) continue;
				if (!obs) startCard(c);
			}
		},
		unobserveCard(card: HTMLElement) {
			tracked.delete(card);
			observer?.unobserve(card);
			cancelCard(card);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			tracked.clear();
			viewport.removeEventListener('scroll', onScroll);
			viewport.removeEventListener('wheel', onScroll);
			observer?.disconnect();
			for (const ctrl of tasks.values()) ctrl.abort();
			tasks.clear();
		},
	};
}

export function syncVisualNotesToolbarGroup(opts: {
	doc: Document;
	zh: boolean;
	galEnabled: boolean;
	hubEnabled: boolean;
	isOpen: boolean;
	existingGroup: HTMLElement | null;
	onToggleGallery: () => void;
	onOpenHub: () => void;
}): { tbGroup: HTMLElement | null; btnGallery: HTMLButtonElement | null; btnHub: HTMLButtonElement | null } {
	const { doc, zh, galEnabled, hubEnabled } = opts;
	const toolbar = doc.getElementById('zotero-items-toolbar');
	if (!toolbar || (!galEnabled && !hubEnabled)) {
		opts.existingGroup?.remove();
		return { tbGroup: null, btnGallery: null, btnHub: null };
	}
	let tbGroup = opts.existingGroup;
	if (!tbGroup || !tbGroup.isConnected) {
		doc.getElementById('zbf-items-tb-group')?.remove();
		tbGroup = galEl(doc, 'div');
		tbGroup.id = 'zbf-items-tb-group';
		tbGroup.className = 'zbf-items-tb-group';
		const anchor = toolbar.querySelector(':scope > spacer[flex="1"]') || toolbar.lastElementChild;
		if (anchor) toolbar.insertBefore(tbGroup, anchor);
		else toolbar.appendChild(tbGroup);
	}
	tbGroup.textContent = '';
	let btnGallery: HTMLButtonElement | null = null;
	let btnHub: HTMLButtonElement | null = null;
	if (galEnabled) {
		btnGallery = galEl(doc, 'button');
		btnGallery.id = 'zbf-tb-gallery-toggle';
		btnGallery.type = 'button';
		btnGallery.className = 'zbf-items-tb-icon';
		btnGallery.setAttribute('aria-pressed', String(opts.isOpen));
		btnGallery.title = zh ? '切换画廊与多维看板视图' : 'Toggle Gallery & Kanban View';
		btnGallery.appendChild(createToolbarArt(doc, 'gallery'));
		btnGallery.addEventListener('click', opts.onToggleGallery);
		tbGroup.appendChild(btnGallery);
	}
	if (hubEnabled) {
		btnHub = galEl(doc, 'button');
		btnHub.id = 'zbf-tb-collection-hub';
		btnHub.type = 'button';
		btnHub.className = 'zbf-items-tb-icon';
		btnHub.title = zh ? '打开当前分类集中笔记与标注中心' : 'Open Collection Notes & Annotations Hub';
		btnHub.appendChild(createToolbarArt(doc, 'notes'));
		btnHub.addEventListener('click', opts.onOpenHub);
		tbGroup.appendChild(btnHub);
	}
	return { tbGroup, btnGallery, btnHub };
}
