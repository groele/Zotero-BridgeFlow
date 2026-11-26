interface HubTabHost {
	add(options: { type: string; title: string; data: object; select: boolean; onClose(): void }): { id: string; container: HTMLElement };
	close(id: string): void;
}

const pages = new WeakMap<Window, () => void>();

export function closeHubPage(owner: Window | null | undefined): void {
	if (!owner) return;
	const closer = pages.get(owner);
	if (closer) {
		pages.delete(owner);
		try { closer(); } catch { /* ignore */ }
	}
}

export function openHubPage(
	owner: Window,
	separate: boolean,
	title: string,
	render: (container: HTMLElement, close: () => void) => (() => void) | void,
): void {
	if (!owner || (owner as any).closed) return;
	closeHubPage(owner);
	if (separate) {
		const popup = owner.open?.('about:blank', '_blank', 'chrome,dialog=no,resizable,width=1080,height=740');
		if (!popup) return;
		let done = false;
		let disposeView: (() => void) | void;
		const close = () => {
			if (done) return;
			done = true;
			try { disposeView?.(); } catch { /* ignore */ }
			if (pages.get(owner) === close) pages.delete(owner);
			try { if (!popup.closed) popup.close(); } catch { /* ignore */ }
		};
		pages.set(owner, close);
		const mount = () => {
			if (done || pages.get(owner) !== close || popup.closed || !popup.document?.body) return;
			popup.document.title = title;
			popup.document.body.style.cssText = 'margin:0;height:100vh;display:flex;color-scheme:light dark';
			disposeView = render(popup.document.body, close);
			popup.addEventListener('unload', () => {
				done = true;
				try { disposeView?.(); } catch { /* ignore */ }
				if (pages.get(owner) === close) pages.delete(owner);
			}, { once: true });
		};
		if (popup.document?.readyState === 'complete') mount();
		else popup.addEventListener('load', mount, { once: true });
		return;
	}
	const tabs = (owner as Window & { Zotero_Tabs?: HubTabHost }).Zotero_Tabs;
	if (!tabs?.add || !tabs?.close) return;
	let done = false;
	let pageId = '';
	let disposeView: (() => void) | void;
	const close = () => {
		if (done) return;
		done = true;
		try { disposeView?.(); } catch { /* ignore */ }
		if (pages.get(owner) === close) pages.delete(owner);
		if (pageId) {
			try { tabs.close(pageId); } catch { /* ignore */ }
		}
	};
	const page = tabs.add({
		type: 'bridgeflow-hub',
		title,
		data: {},
		select: true,
		onClose: () => {
			done = true;
			try { disposeView?.(); } catch { /* ignore */ }
			if (pages.get(owner) === close) pages.delete(owner);
		},
	});
	if (!page?.container) return;
	pageId = page.id;
	pages.set(owner, close);
	disposeView = render(page.container, close);
}
