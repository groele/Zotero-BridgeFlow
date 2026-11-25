import {
	addPopupButton,
	addPopupSeparator,
	addPopupSubmenuSection,
	createFloatingPopup,
} from './popup-menu-helpers.ts';
import { createWorkspaceElement } from './workspace-elements.ts';
import type { WorkspaceIconName } from './workspace-icons.ts';
import { GROUP_PALETTE } from './types.ts';

export interface MenuItemOptions {
	icon?: WorkspaceIconName;
	danger?: boolean;
	disabled?: boolean;
	badge?: string;
	checked?: boolean;
}

export interface MenuBuilder {
	addItem(label: string, onClick: () => void, options?: MenuItemOptions): void;
	addSeparator(): void;
	addSubmenu(label: string, icon: WorkspaceIconName, build: (sub: MenuBuilder) => void, dotColor?: string): void;
	addColorPicker?(currentColor: string, onPick: (hex: string) => void, onCustom: () => void): void;
}

export interface ActiveMenuHandle {
	close(): void;
}

function createXulElement(doc: Document, tag: string): any {
	const d = doc as Document & { createXULElement?: (name: string) => Element };
	if (typeof d.createXULElement === 'function') {
		return d.createXULElement(tag);
	}
	return doc.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', tag);
}

function getPopupSet(doc: Document): Element | null {
	return doc.getElementById('mainPopupSet') || doc.querySelector('popupset');
}

function canUseNativeXulMenu(doc: Document): boolean {
	const d = doc as Document & { createXULElement?: (name: string) => Element };
	return typeof d.createXULElement === 'function' && Boolean(getPopupSet(doc));
}

function buildXulMenuSection(win: Window, doc: Document, popup: any): MenuBuilder {
	const defer = (fn: () => void) => {
		if (typeof win.setTimeout === 'function') win.setTimeout(fn, 0);
		else fn();
	};
	return {
		addItem(label, onClick, options = {}) {
			const mi = createXulElement(doc, 'menuitem');
			const prefix = options.checked ? '✓ ' : '';
			const suffix = options.badge ? ` (${options.badge})` : '';
			mi.setAttribute('label', `${prefix}${label}${suffix}`);
			if (options.disabled) mi.setAttribute('disabled', 'true');
			mi.addEventListener('command', () => defer(onClick));
			popup.append(mi);
		},
		addSeparator() {
			popup.append(createXulElement(doc, 'menuseparator'));
		},
		addSubmenu(label, _icon, build) {
			const menu = createXulElement(doc, 'menu');
			menu.setAttribute('label', label);
			const subPopup = createXulElement(doc, 'menupopup');
			menu.append(subPopup);
			popup.append(menu);
			build(buildXulMenuSection(win, doc, subPopup));
		},
		addColorPicker(currentColor, onPick, onCustom) {
			for (const hex of GROUP_PALETTE) {
				const mi = createXulElement(doc, 'menuitem');
				mi.setAttribute('label', `${hex === currentColor ? '✓ ' : '   '}${hex}`);
				mi.addEventListener('command', () => defer(() => onPick(hex)));
				popup.append(mi);
			}
			const custom = createXulElement(doc, 'menuitem');
			custom.setAttribute('label', '自定义 Hex 颜色…');
			custom.addEventListener('command', () => defer(onCustom));
			popup.append(custom);
		},
	};
}

export function openContextMenu(
	win: Window,
	anchor: HTMLElement,
	event: MouseEvent | undefined,
	minWidth: number,
	build: (builder: MenuBuilder) => void,
): ActiveMenuHandle | null {
	const doc = win.document;
	if (!doc) return null;

	if (canUseNativeXulMenu(doc)) {
		const popupset = getPopupSet(doc);
		if (!popupset) return null;
		const popup = createXulElement(doc, 'menupopup');
		let closed = false;
		const cleanup = () => {
			if (closed) return;
			closed = true;
			try { popup.hidePopup?.(); } catch {}
			popup.remove?.();
		};
		popup.addEventListener('popuphidden', (e: Event) => {
			if (e.target === popup) {
				closed = true;
				popup.remove?.();
			}
		});
		popupset.append(popup);
		build(buildXulMenuSection(win, doc, popup));

		const hasScreen = Boolean(event && (event.screenX > 0 || event.screenY > 0));
		if (hasScreen && typeof popup.openPopupAtScreen === 'function') {
			popup.openPopupAtScreen(event!.screenX, event!.screenY, true);
		} else if (typeof popup.openPopup === 'function') {
			popup.openPopup(anchor, 'after_start', 0, 0, true, false);
		} else {
			cleanup();
			return null;
		}
		return { close: cleanup };
	}

	const pop = createFloatingPopup(doc, anchor, event, minWidth);
	if (!pop) return null;

	let closed = false;
	let boundOutside: ((e: Event) => void) | null = null;
	let boundKeydown: ((e: Event) => void) | null = null;
	let boundBlur: (() => void) | null = null;
	const cleanup = () => {
		if (closed) return;
		closed = true;
		pop.remove();
		if (boundOutside) doc.removeEventListener('mousedown', boundOutside, true);
		if (boundKeydown) doc.removeEventListener('keydown', boundKeydown, true);
		if (boundBlur) win.removeEventListener('blur', boundBlur);
		boundOutside = null;
		boundKeydown = null;
		boundBlur = null;
	};

	const buildHtmlSection = (container: HTMLElement): MenuBuilder => ({
		addItem(label, onClick, options = {}) {
			const text = options.checked !== undefined
				? `${options.checked ? '✓ ' : '   '}${label}`
				: label;
			addPopupButton(doc, container, text, onClick, cleanup, options);
		},
		addSeparator() {
			addPopupSeparator(doc, container);
		},
		addSubmenu(label, icon, subBuild, dotColor) {
			addPopupSubmenuSection(doc, container, label, icon, (sub) => {
				subBuild(buildHtmlSection(sub));
			}, dotColor);
		},
		addColorPicker(currentColor, onPick, onCustom) {
			const swatchRow = createWorkspaceElement(doc, 'div');
			swatchRow.className = 'zbf-color-row';
			for (const color of GROUP_PALETTE) {
				const swatch = createWorkspaceElement(doc, 'button');
				swatch.type = 'button';
				swatch.className = `zbf-color-swatch${color === currentColor ? ' active' : ''}`;
				swatch.style.backgroundColor = color;
				swatch.title = color;
				swatch.addEventListener('click', () => {
					cleanup();
					onPick(color);
				});
				swatchRow.appendChild(swatch);
			}
			container.appendChild(swatchRow);
			addPopupButton(doc, container, '自定义 Hex 颜色…', onCustom, cleanup, { icon: 'palette' });
		},
	});

	build(buildHtmlSection(pop));

	boundOutside = (e: Event) => {
		if (!pop.contains(e.target as Node)) cleanup();
	};
	boundKeydown = (e: Event) => {
		if ((e as KeyboardEvent).key === 'Escape') {
			e.preventDefault();
			cleanup();
		}
	};
	boundBlur = () => cleanup();

	win.setTimeout(() => {
		if (closed) return;
		if (boundOutside) doc.addEventListener('mousedown', boundOutside, true);
		if (boundKeydown) doc.addEventListener('keydown', boundKeydown, true);
		if (boundBlur) win.addEventListener('blur', boundBlur);
	}, 15);

	return { close: cleanup };
}
