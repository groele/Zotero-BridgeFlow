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

interface TargetSpec {
	key: string;
	sectionID: string;
	getPosition: () => PanePositionValue;
	anchorAfterSectionID?: string;
}

export function normalizePanePosition(raw: unknown, fallback: PanePositionValue = 'zotero-item-pane-header'): PanePositionValue {
	if (raw === 'zotero-item-pane-header' || raw === 'zotero-editpane-item-box' || raw === 'zotero-editpane-related') {
		return raw;
	}
	return fallback;
}

/**
 * Coordinates ItemPane section ordering across Zotero 10-12 `item-details` containers
 * and `item-pane-sidenav` navigation buttons with strict idempotent group placement.
 */
export class ItemPanePositionCoordinator {
	private readonly targets = new Map<string, TargetSpec>();
	private readonly observers = new Map<PositionOwner, MutationObserver>();
	private readonly timers = new Map<PositionOwner, ReturnType<typeof setTimeout>>();
	private readonly running = new Set<PositionOwner>();
	private readonly dirty = new Set<PositionOwner>();

	setTarget(
		key: string,
		spec: { sectionID: string; getPosition: () => PanePositionValue; anchorAfterSectionID?: string } | null,
	): void {
		if (!spec) this.targets.delete(key);
		else this.targets.set(key, { key, ...spec });
	}

	observeAndQueue(body: HTMLElement | null): void {
		const owner = body?.closest?.('item-details') as PositionOwner | null;
		if (!owner?.getPanes) return;
		if (!this.observers.has(owner)) {
			const parent = owner.getPanes().find((p) => p.contains?.(body!))?.parentNode;
			const Observer = owner.ownerDocument?.defaultView?.MutationObserver;
			if (parent && Observer) {
				const obs = new Observer(() => {
					if (!this.running.has(owner)) this.queue(owner);
				});
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
		}, 20);
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
		const groups: Record<PanePositionValue, TargetSpec[]> = {
			'zotero-item-pane-header': [],
			'zotero-editpane-item-box': [],
			'zotero-editpane-related': [],
		};

		const independent = [...this.targets.values()].filter((s) => !s.anchorAfterSectionID);
		const anchored = [...this.targets.values()].filter((s) => Boolean(s.anchorAfterSectionID));

		for (const spec of independent) {
			groups[spec.getPosition()].push(spec);
		}
		for (const spec of anchored) {
			const pos = spec.getPosition();
			const list = groups[pos];
			const anchorIdx = list.findIndex((item) => item.sectionID === spec.anchorAfterSectionID);
			if (anchorIdx >= 0) list.splice(anchorIdx + 1, 0, spec);
			else list.push(spec);
		}

		for (const position of ['zotero-item-pane-header', 'zotero-editpane-item-box', 'zotero-editpane-related'] as const) {
			await this.alignGroup(owner, position, groups[position]);
		}
	}

	private async alignGroup(owner: PositionOwner, position: PanePositionValue, group: readonly TargetSpec[]): Promise<void> {
		const presentIDs = group
			.map((s) => s.sectionID)
			.filter((id) => owner.getPanes().some((p) => p.dataset.pane === id));
		if (!presentIDs.length) return;

		const panes = owner.getPanes();
		const startIdx = this.computeGroupStartIndex(panes, position, presentIDs.length);
		const slice = panes.slice(startIdx, startIdx + presentIDs.length).map((p) => p.dataset.pane);
		if (slice.length === presentIDs.length && presentIDs.every((id, idx) => slice[idx] === id)) {
			return;
		}

		await this.moveSectionToPosition(owner, presentIDs[0], position);
		for (let i = 1; i < presentIDs.length; i++) {
			await this.moveSectionAfter(owner, presentIDs[i], presentIDs[i - 1]);
		}
	}

	private computeGroupStartIndex(panes: HTMLElement[], position: PanePositionValue, groupSize: number): number {
		if (position === 'zotero-item-pane-header') return 0;
		if (position === 'zotero-editpane-related') return Math.max(0, panes.length - groupSize);
		const info = panes.findIndex((p) => p.dataset.pane === 'info');
		return info < 0 ? 0 : info + 1;
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
