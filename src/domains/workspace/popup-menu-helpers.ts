export function createFloatingPopup(doc: Document, anchor: HTMLElement, event?: MouseEvent, minWidth = 210): HTMLElement | null {
	const host = doc.documentElement || doc.body;
	if (!host) return null;
	const pop = doc.createElement('div');
	pop.className = 'zbf-popup-menu';
	pop.style.minWidth = `${minWidth}px`;
	host.appendChild(pop);

	const rect = anchor.getBoundingClientRect();
	const rawX = event?.clientX && event.clientX > 0 ? event.clientX : rect.left;
	const rawY = event?.clientY && event.clientY > 0 ? event.clientY : rect.bottom + 4;
	const winW = doc.defaultView?.innerWidth || 1200;
	const winH = doc.defaultView?.innerHeight || 800;
	const popW = pop.offsetWidth || minWidth;
	const left = Math.max(8, Math.min(rawX, winW - popW - 12));
	const top = Math.max(8, Math.min(rawY, winH - 280));
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
	const btn = doc.createElement('button');
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
	const sep = doc.createElement('div');
	sep.className = 'zbf-popup-sep';
	pop.appendChild(sep);
}

export function openTextPromptModal(
	win: Window,
	title: string,
	placeholder: string,
	initialValue: string,
	onConfirm: (value: string) => void,
): void {
	const doc = win.document;
	const host = doc.documentElement || doc.body;
	if (!host) return;

	const backdrop = doc.createElement('div');
	backdrop.id = 'zbf-hub-backdrop';
	backdrop.style.zIndex = '100020';

	const modal = doc.createElement('div');
	modal.className = 'zbf-hub-box';
	modal.style.maxWidth = '420px';

	const head = doc.createElement('div');
	head.className = 'zbf-hub-head';
	const h3 = doc.createElement('div');
	h3.className = 'zbf-hub-title';
	h3.textContent = title;
	const closeBtn = doc.createElement('button');
	closeBtn.type = 'button';
	closeBtn.className = 'zbf-hub-close';
	closeBtn.textContent = '✕';

	const input = doc.createElement('input') as HTMLInputElement;
	input.type = 'text';
	input.className = 'zbf-hub-input';
	input.placeholder = placeholder;
	input.value = initialValue;

	const actions = doc.createElement('div');
	actions.className = 'zbf-hub-actions';
	actions.style.justifyContent = 'flex-end';

	const cancelBtn = doc.createElement('button');
	cancelBtn.type = 'button';
	cancelBtn.className = 'zbf-hub-btn';
	cancelBtn.textContent = '取消';

	const okBtn = doc.createElement('button');
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
