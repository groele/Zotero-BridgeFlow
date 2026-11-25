import { createWorkspaceElement } from './workspace-elements.ts';
import { createWorkspaceIcon, type WorkspaceIconName } from './workspace-icons.ts';
export function createFloatingPopup(doc: Document, anchor: HTMLElement, event?: MouseEvent, minWidth = 228): HTMLElement | null {
	const host = doc.documentElement || doc.body;
	if (!host) return null;
	const pop = createWorkspaceElement(doc, 'div');
	pop.className = 'zbf-popup-menu';
	pop.style.minWidth = `${minWidth}px`;
	host.appendChild(pop);

	const positionPopup = () => {
		if (!pop.isConnected) return;
		const rect = anchor.getBoundingClientRect();
		const hasMouse = Boolean(event && event.clientX > 0 && event.clientY > 0);
		const winW = doc.defaultView?.innerWidth || 1200;
		const winH = doc.defaultView?.innerHeight || 800;
		const popW = pop.offsetWidth || minWidth;
		const popH = Math.min(pop.offsetHeight || 260, winH - 16);
		const rawX = hasMouse
			? event!.clientX + 2
			: (rect.left > winW * 0.55 ? rect.right - popW : rect.left);
		let rawY = hasMouse ? event!.clientY + 6 : rect.bottom + 6;
		if (rawY + popH > winH - 8) {
			rawY = hasMouse ? event!.clientY - popH - 6 : rect.top - popH - 6;
		}
		pop.style.left = `${Math.max(8, Math.min(rawX, winW - popW - 12))}px`;
		pop.style.top = `${Math.max(8, Math.min(rawY, winH - popH - 8))}px`;
	};
	positionPopup();
	queueMicrotask(positionPopup);
	return pop;
}

export function addPopupButton(
	doc: Document,
	pop: HTMLElement,
	label: string,
	onClick: () => void,
	closePopup: () => void,
	options: { danger?: boolean; disabled?: boolean; icon?: WorkspaceIconName; badge?: string } = {},
): HTMLButtonElement {
	const btn = createWorkspaceElement(doc, 'button');
	btn.type = 'button';
	btn.className = `zbf-popup-item${options.danger ? ' danger' : ''}`;
	if (options.disabled) btn.disabled = true;

	const left = createWorkspaceElement(doc, 'span');
	left.className = 'zbf-popup-item-main';
	if (options.icon) {
		left.appendChild(createWorkspaceIcon(doc, options.icon, 14));
	}
	const textSpan = createWorkspaceElement(doc, 'span');
	textSpan.className = 'zbf-popup-item-label';
	textSpan.textContent = label;
	left.appendChild(textSpan);
	btn.appendChild(left);

	if (options.badge) {
		const badgeEl = createWorkspaceElement(doc, 'span');
		badgeEl.className = 'zbf-popup-item-badge';
		badgeEl.textContent = options.badge;
		btn.appendChild(badgeEl);
	}

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

export function addPopupSubmenuSection(
	doc: Document,
	pop: HTMLElement,
	label: string,
	icon: WorkspaceIconName,
	build: (container: HTMLElement) => void,
	dotColor?: string,
): void {
	const wrap = createWorkspaceElement(doc, 'div');
	wrap.className = 'zbf-popup-submenu-wrap';
	const trigger = createWorkspaceElement(doc, 'button');
	trigger.type = 'button';
	trigger.className = 'zbf-popup-item zbf-popup-submenu-trigger';

	const left = createWorkspaceElement(doc, 'span');
	left.className = 'zbf-popup-item-main';
	left.appendChild(createWorkspaceIcon(doc, icon, 14));
	const txt = createWorkspaceElement(doc, 'span');
	txt.className = 'zbf-popup-item-label';
	txt.textContent = label;
	left.appendChild(txt);
	if (dotColor) {
		const dot = createWorkspaceElement(doc, 'span');
		dot.className = 'zbf-popup-color-dot';
		dot.style.backgroundColor = dotColor;
		left.appendChild(dot);
	}

	const arrow = createWorkspaceElement(doc, 'span');
	arrow.className = 'zbf-popup-submenu-arrow';
	arrow.textContent = '▸';
	trigger.append(left, arrow);

	const body = createWorkspaceElement(doc, 'div');
	body.className = 'zbf-popup-submenu-body';
	body.hidden = true;
	build(body);

	trigger.addEventListener('click', (e) => {
		e.stopPropagation();
		body.hidden = !body.hidden;
		arrow.textContent = body.hidden ? '▸' : '▾';
	});
	wrap.append(trigger, body);
	pop.appendChild(wrap);
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
	backdrop.className = 'zbf-prompt-backdrop';
	backdrop.style.zIndex = '2147483647';

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
		if (ke.isComposing) return;
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
