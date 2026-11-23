import { createWorkspaceElement } from './workspace-elements.ts';
export function createFloatingPopup(doc: Document, anchor: HTMLElement, event?: MouseEvent, minWidth = 210): HTMLElement | null {
	const host = doc.documentElement || doc.body;
	if (!host) return null;
	const pop = createWorkspaceElement(doc, 'div');
	pop.className = 'zbf-popup-menu';
	pop.style.minWidth = `${minWidth}px`;
	host.appendChild(pop);

	const rect = anchor.getBoundingClientRect();
	const hasMouse = Boolean(event && event.clientX > 0 && event.clientY > 0);
	const winW = doc.defaultView?.innerWidth || 1200;
	const winH = doc.defaultView?.innerHeight || 800;
	const popW = pop.offsetWidth || minWidth;
	const rawX = hasMouse
		? event!.clientX + 2
		: (rect.left > winW * 0.55 ? rect.right - popW : rect.left);
	const rawY = hasMouse ? event!.clientY + 6 : rect.bottom + 6;
	const left = Math.max(8, Math.min(rawX, winW - popW - 12));
	const top = Math.max(8, Math.min(rawY, winH - 300));
	pop.style.left = `${left}px`;
	pop.style.top = `${top}px`;
	return pop;
}

export function addPopupButton(
	doc: Document,
	pop: HTMLElement,
	label: string,
	onClick: () => void,
	closePopup: () => void,
	options: { danger?: boolean; disabled?: boolean } = {},
): HTMLButtonElement {
	const btn = createWorkspaceElement(doc, 'button');
	btn.type = 'button';
	btn.className = `zbf-popup-item${options.danger ? ' danger' : ''}`;
	btn.textContent = label;
	if (options.disabled) btn.disabled = true;
	btn.addEventListener('click', () => {
		closePopup();
		onClick();
	});
	pop.appendChild(btn);
	return btn;
}

export function addPopupSeparator(doc: Document, pop: HTMLElement): void {
	const sep = createWorkspaceElement(doc, 'div');
	sep.className = 'zbf-popup-sep';
	pop.appendChild(sep);
}

export function openTextPromptModal(
	win: Window,
	title: string,
	placeholder: string,
	initialValue: string,
	onConfirm: (value: string) => void,
	anchor?: HTMLElement | null,
): void {
	const doc = win.document;
	const host = doc.documentElement || doc.body;
	if (!host) return;

	const backdrop = createWorkspaceElement(doc, 'div');
	backdrop.id = 'zbf-hub-backdrop';
	backdrop.style.zIndex = '100020';

	const modal = createWorkspaceElement(doc, 'div');
	modal.className = 'zbf-hub-box';
	modal.style.maxWidth = '380px';
	modal.style.width = '360px';
	modal.style.position = 'fixed';
	const target = anchor || (doc.activeElement as HTMLElement | null);
	const winW = win.innerWidth || 1200;
	const winH = win.innerHeight || 800;
	if (target && typeof target.getBoundingClientRect === 'function') {
		const rect = target.getBoundingClientRect();
		if (rect.width > 0 || rect.height > 0) {
			const top = Math.max(12, Math.min(Math.round(rect.bottom + 8), winH - 180));
			const left = rect.left > winW * 0.55
				? Math.max(12, Math.min(Math.round(rect.right - 360), winW - 372))
				: Math.max(12, Math.min(Math.round(rect.left), winW - 372));
			modal.style.top = `${top}px`;
			modal.style.left = `${left}px`;
		}
	}

	const head = createWorkspaceElement(doc, 'div');
	head.className = 'zbf-hub-head';
	const h3 = createWorkspaceElement(doc, 'div');
	h3.className = 'zbf-hub-title';
	h3.textContent = title;
	const closeBtn = createWorkspaceElement(doc, 'button');
	closeBtn.type = 'button';
	closeBtn.className = 'zbf-hub-close';
	closeBtn.textContent = '✕';

	const input = createWorkspaceElement(doc, 'input') as HTMLInputElement;
	input.type = 'text';
	input.className = 'zbf-hub-input';
	input.placeholder = placeholder;
	input.value = initialValue;

	const actions = createWorkspaceElement(doc, 'div');
	actions.className = 'zbf-hub-actions';
	actions.style.justifyContent = 'flex-end';

	const cancelBtn = createWorkspaceElement(doc, 'button');
	cancelBtn.type = 'button';
	cancelBtn.className = 'zbf-hub-btn';
	cancelBtn.textContent = '取消';

	const okBtn = createWorkspaceElement(doc, 'button');
	okBtn.type = 'button';
	okBtn.className = 'zbf-hub-btn primary';
	okBtn.textContent = '确定';

	const cleanup = () => backdrop.remove();
	closeBtn.addEventListener('click', cleanup);
	cancelBtn.addEventListener('click', cleanup);
	backdrop.addEventListener('click', (e) => {
		if (e.target === backdrop) cleanup();
	});
	const submit = () => {
		const val = input.value;
		cleanup();
		onConfirm(val);
	};
	okBtn.addEventListener('click', submit);
	input.addEventListener('keydown', (e) => {
		const ke = e as KeyboardEvent;
		if (ke.key === 'Enter') {
			ke.preventDefault();
			submit();
		} else if (ke.key === 'Escape') {
			ke.preventDefault();
			cleanup();
		}
	});

	head.append(h3, closeBtn);
	actions.append(cancelBtn, okBtn);
	modal.append(head, input, actions);
	backdrop.appendChild(modal);
	host.appendChild(backdrop);
	win.setTimeout(() => {
		input.focus();
		input.select();
	}, 10);
}
