const PANE_POSITION_ANCHORS = {
	'zotero-item-pane-header': null,
	'zotero-editpane-item-box': 'info',
	'zotero-editpane-abstract': 'abstract',
	'zotero-editpane-attachments': 'attachments',
	'zotero-editpane-notes': 'notes',
	'zotero-editpane-related': null,
} as const;

export type PanePositionValue = keyof typeof PANE_POSITION_ANCHORS;

const PANE_POSITIONS = Object.keys(PANE_POSITION_ANCHORS) as PanePositionValue[];

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
	return typeof raw === 'string' && Object.hasOwn(PANE_POSITION_ANCHORS, raw)
		? raw as PanePositionValue
		: fallback;
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
	private readonly lastAppliedSig = new WeakMap<PositionOwner, string>();

	setTarget(
		key: string,
		spec: { sectionID: string; getPosition: () => PanePositionValue; anchorAfterSectionID?: string } | null,
	): void {
		if (!spec) this.targets.delete(key);
		else this.targets.set(key, { key, ...spec });
		for (const owner of this.observers.keys()) this.lastAppliedSig.delete(owner);
	}

	private pruneDisconnected(): void {
		for (const [owner, obs] of this.observers.entries()) {
			if ((owner as { isConnected?: boolean }).isConnected === false) {
				obs.disconnect();
				this.observers.delete(owner);
				const t = this.timers.get(owner);
				if (t !== undefined) { clearTimeout(t); this.timers.delete(owner); }
				this.running.delete(owner);
				this.dirty.delete(owner);
			}
		}
	}

	observeAndQueue(body: HTMLElement | null): void {
		this.pruneDisconnected();
		const owner = body?.closest?.('item-details') as PositionOwner | null;
		if (!owner?.getPanes || (owner as { isConnected?: boolean }).isConnected === false) return;
		if (!this.observers.has(owner)) {
			const parent = owner.getPanes().find((p) => p.contains?.(body!))?.parentNode;
			const Observer = owner.ownerDocument?.defaultView?.MutationObserver;
			if (parent && Observer) {
				const obs = new Observer(() => {
					if ((owner as { isConnected?: boolean }).isConnected === false) { this.pruneDisconnected(); return; }
					if (!this.running.has(owner)) this.queue(owner);
				});
				obs.observe(parent, { childList: true });
				this.observers.set(owner, obs);
			}
		}
		this.queue(owner);
	}

	private computeOwnerSig(owner: PositionOwner): string {
		const paneIDs = this.getPaneIDs(owner);
		const targetSig = Array.from(this.targets.values())
			.map((s) => `${s.sectionID}@${s.getPosition()}:${s.anchorAfterSectionID || ''}`)
			.join(',');
		return `${paneIDs.join(',')}|${targetSig}`;
	}

	queueAll(): void {
		this.pruneDisconnected();
		for (const owner of this.observers.keys()) {
			this.lastAppliedSig.delete(owner);
			this.queue(owner);
		}
	}

	queue(owner: PositionOwner | null): void {
		if (!owner?.getPanes || this.timers.has(owner)) return;
		if (this.running.has(owner)) {
			this.dirty.add(owner);
			return;
		}
		if (!owner.skipRender && !owner.querySelector?.('[data-ztf-pdf-full-section]') && this.lastAppliedSig.get(owner) === this.computeOwnerSig(owner)) {
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
		// Reordering restores Zotero's previous scroll position. Defer it while the
		// user is viewing a full-height PDF, including queued work from item render.
		if (owner.skipRender || owner.querySelector?.('[data-ztf-pdf-full-section]')) return;
		const paneIDs = this.getPaneIDs(owner);
		const targets = Array.from(this.targets.values()).filter(spec => paneIDs.includes(spec.sectionID));
		if (!targets.length) return;
		const managed = new Set(targets.map(spec => spec.sectionID));
		const desired = paneIDs.filter(id => !managed.has(id));
		const native = [...desired];
		const groups = new Map(PANE_POSITIONS.map(position => [position, [] as string[]]));
		for (const spec of targets.filter(spec => !spec.anchorAfterSectionID)) {
			groups.get(spec.getPosition())!.push(spec.sectionID);
		}
		for (const spec of targets.filter(spec => spec.anchorAfterSectionID)) {
			const group = groups.get(spec.getPosition())!;
			const anchor = group.indexOf(spec.anchorAfterSectionID!);
			group.splice(anchor < 0 ? group.length : anchor + 1, 0, spec.sectionID);
		}

		for (const position of PANE_POSITIONS) {
			const group = groups.get(position)!;
			if (!group.length) continue;
			const anchor = PANE_POSITION_ANCHORS[position];
			const anchorMissing = anchor !== null && !native.includes(anchor);
			const nativeIndex = anchor ? native.indexOf(anchor) : -1;
			const nextNative = anchorMissing ? undefined : native[nativeIndex + 1];
			const index = position === 'zotero-editpane-related' || nextNative === undefined
				? desired.length
				: desired.indexOf(nextNative);
			desired.splice(index, 0, ...group);
		}

		// Work backward so the next pane in the desired order is already placed.
		for (let index = desired.length - 1; index >= 0; index--) {
			const id = desired[index];
			if (!managed.has(id)) continue;
			const next = desired[index + 1];
			const current = this.getPaneIDs(owner);
			const currentIndex = current.indexOf(id);
			const targetIndex = next === undefined ? current.length : current.indexOf(next);
			if (currentIndex < 0 || targetIndex < 0 || currentIndex + 1 === targetIndex) continue;
			await this.reorderPane(owner, id, next, targetIndex);
		}
		this.lastAppliedSig.set(owner, this.computeOwnerSig(owner));
	}

	private getPaneIDs(owner: PositionOwner): string[] {
		return owner.getPanes().flatMap(pane => pane.dataset.pane ? [pane.dataset.pane] : []);
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
