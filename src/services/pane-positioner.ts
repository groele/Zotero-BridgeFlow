export type PanePositionValue =
	| 'zotero-item-pane-header'
	| 'zotero-editpane-item-box'
	| 'zotero-editpane-related';

export interface PositionOwner extends Element {
	getPanes(): HTMLElement[];
	skipRender?: boolean;
	sidenav?: {
		container: PositionOwner;
		querySelectorAll(selector: string): NodeListOf<HTMLElement>;
		changePaneOrder(id: string, index: number, options: { persist: boolean; render: boolean }): Promise<void>;
	};
	changePaneOrder?(id: string, index: number, options: { render: boolean }): Promise<void>;
}

export function normalizePanePosition(raw: unknown, fallback: PanePositionValue = 'zotero-item-pane-header'): PanePositionValue {
	if (raw === 'zotero-item-pane-header' || raw === 'zotero-editpane-item-box' || raw === 'zotero-editpane-related') {
		return raw;
	}
	return fallback;
}

/**
 * Coordinates ItemPane section ordering across Zotero 10-12 `item-details` containers
 * and `item-pane-sidenav` navigation buttons without fighting native pane mutations.
 */
export class ItemPanePositionCoordinator {
	private readonly targets = new Map<string, { sectionID: string; getPosition: () => PanePositionValue; anchorAfterSectionID?: string }>();
	private readonly observers = new Map<PositionOwner, MutationObserver>();
	private readonly timers = new Map<PositionOwner, number>();
	private readonly running = new Set<PositionOwner>();
	private readonly dirty = new Set<PositionOwner>();

	setTarget(
		key: string,
		spec: { sectionID: string; getPosition: () => PanePositionValue; anchorAfterSectionID?: string } | null,
	): void {
		if (!spec) this.targets.delete(key);
		else this.targets.set(key, spec);
	}

	observeAndQueue(body: HTMLElement | null): void {
		const owner = body?.closest?.('item-details') as PositionOwner | null;
		if (!owner?.getPanes) return;
		if (!this.observers.has(owner)) {
			const parent = owner.getPanes().find((p) => p.contains?.(body!))?.parentNode;
			const Observer = owner.ownerDocument?.defaultView?.MutationObserver;
			if (parent && Observer) {
				const obs = new Observer(() => this.queue(owner));
				obs.observe(parent, { childList: true });
				this.observers.set(owner, obs);
			}
		}
		this.queue(owner);
	}

	queueAll(): void {
		for (const owner of this.observers.keys()) {
			this.queue(owner);
		}
	}

	queue(owner: PositionOwner | null): void {
		if (!owner?.getPanes || this.timers.has(owner)) return;
		if (this.running.has(owner)) {
			this.dirty.add(owner);
			return;
		}
		const timer = setTimeout(() => {
			this.timers.delete(owner);
			this.running.add(owner);
			void this.applyAll(owner).finally(() => {
				this.running.delete(owner);
				if (this.dirty.has(owner)) {
					this.dirty.delete(owner);
					this.queue(owner);
				}
			});
		}, 0);
		this.timers.set(owner, timer);
	}

	dispose(): void {
		for (const t of this.timers.values()) clearTimeout(t);
		this.timers.clear();
		for (const obs of this.observers.values()) obs.disconnect();
		this.observers.clear();
		this.targets.clear();
		this.running.clear();
		this.dirty.clear();
	}

	private async applyAll(owner: PositionOwner): Promise<void> {
		if (owner.skipRender) return;
		// Apply independent sections first, then anchored sections (e.g. lookup directly after preview)
		const independent: Array<{ sectionID: string; getPosition: () => PanePositionValue }> = [];
		const anchored: Array<{ sectionID: string; anchorAfterSectionID: string }> = [];

		for (const spec of this.targets.values()) {
			if (spec.anchorAfterSectionID) {
				anchored.push({ sectionID: spec.sectionID, anchorAfterSectionID: spec.anchorAfterSectionID });
			} else {
				independent.push(spec);
			}
		}

		for (const spec of independent) {
			await this.moveSectionToPosition(owner, spec.sectionID, spec.getPosition());
		}
		for (const spec of anchored) {
			await this.moveSectionAfter(owner, spec.sectionID, spec.anchorAfterSectionID);
		}
	}

	private async moveSectionToPosition(owner: PositionOwner, sectionID: string, position: PanePositionValue): Promise<void> {
		const panes = owner.getPanes();
		const current = panes.findIndex((p) => p.dataset.pane === sectionID);
		if (current < 0) return;

		let targetIdx = 0;
		if (position === 'zotero-editpane-related') {
			targetIdx = panes.length;
		} else if (position === 'zotero-editpane-item-box') {
			const info = panes.findIndex((p) => p.dataset.pane === 'info');
			targetIdx = info < 0 ? 0 : info + 1;
		}
		if (current === targetIdx || current === targetIdx - 1) return;

		const targetPaneID = panes[targetIdx]?.dataset.pane;
		await this.reorderPane(owner, sectionID, targetPaneID, targetIdx);
	}

	private async moveSectionAfter(owner: PositionOwner, sectionID: string, anchorSectionID: string): Promise<void> {
		const panes = owner.getPanes();
		const anchorIdx = panes.findIndex((p) => p.dataset.pane === anchorSectionID);
		const currentIdx = panes.findIndex((p) => p.dataset.pane === sectionID);
		if (anchorIdx < 0 || currentIdx < 0 || currentIdx === anchorIdx + 1) return;

		const desiredPaneIndex = currentIdx < anchorIdx ? anchorIdx : anchorIdx + 1;
		const targetPaneID = panes[anchorIdx + 1]?.dataset.pane;
		await this.reorderPane(owner, sectionID, targetPaneID, desiredPaneIndex);
	}

	private async reorderPane(owner: PositionOwner, sectionID: string, targetPaneID: string | undefined, fallbackIdx: number): Promise<void> {
		const sidenav = owner.sidenav;
		if (sidenav?.container === owner && sidenav.changePaneOrder) {
			const wrappers = Array.from(sidenav.querySelectorAll?.('.inherit-flex > .pin-wrapper') || []) as HTMLElement[];
			const sidenavTargetIdx = targetPaneID
				? wrappers.findIndex((w) => (w.querySelector('.btn[data-pane]') as HTMLElement | null)?.dataset.pane === targetPaneID)
				: wrappers.length;
			await sidenav.changePaneOrder(
				sectionID,
				wrappers.length && sidenavTargetIdx >= 0 ? sidenavTargetIdx : fallbackIdx,
				{ persist: false, render: false },
			);
		} else if (owner.changePaneOrder) {
			await owner.changePaneOrder(sectionID, fallbackIdx, { render: false });
		}
	}
}
