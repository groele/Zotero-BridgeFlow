import type { PluginKernel } from '../../../kernel/plugin-kernel.ts';
import { isItemWritable } from '../../../services/item-resolution.ts';
import {
	readItemRemarkWithFallback,
	writeItemRemarkWithSync,
	type VisualNotesDataSource,
} from '../data-source.ts';

export class InfoBriefNoteController {
	private readonly kernel: PluginKernel;
	private dataSource?: VisualNotesDataSource;
	private registeredRowID = '';
	private readonly onUpdated: () => void;

	constructor(kernel: PluginKernel, onUpdated: () => void) {
		this.kernel = kernel;
		this.onUpdated = onUpdated;
	}

	setDataSource(source?: VisualNotesDataSource): void {
		this.dataSource = source;
	}

	register(): boolean {
		if (this.registeredRowID) return true;
		const manager = (globalThis as any).Zotero?.ItemPaneManager;
		if (typeof manager?.registerInfoRow !== 'function') return false;

		try {
			const rowID = manager.registerInfoRow({
				rowID: 'bridgeflow-brief-note',
				pluginID: this.kernel.info.id,
				label: { l10nID: 'zbf-info-brief-note-label' },
				position: 'start',
				multiline: true,
				nowrap: false,
				editable: true,
				onGetData: ({ item }: { item?: any }) => readItemRemarkWithFallback(item, this.dataSource),
				onSetData: ({ item, value }: { item?: any; value?: string }) => {
					if (!item) return;
					const syncExtra = Boolean(this.kernel.prefs.get('workspace.syncRemarkToExtra'));
					writeItemRemarkWithSync(item, String(value ?? ''), syncExtra, this.dataSource);
					this.refresh();
					this.onUpdated();
				},
				onItemChange: ({ item, setEnabled, setEditable }: {
					item?: any;
					setEnabled?: (v: boolean) => void;
					setEditable?: (v: boolean) => void;
				}) => {
					const valid = Boolean(item && !item.deleted && (item.isRegularItem?.() || item.isAttachment?.()));
					setEnabled?.(valid);
					setEditable?.(Boolean(valid && (this.dataSource ? true : isItemWritable(item))));
				},
			});
			if (typeof rowID === 'string' && rowID) {
				this.registeredRowID = rowID;
				return true;
			}
		} catch { /* ignore */ }
		return false;
	}

	unregister(): void {
		if (!this.registeredRowID) return;
		const id = this.registeredRowID;
		this.registeredRowID = '';
		try {
			(globalThis as any).Zotero?.ItemPaneManager?.unregisterInfoRow?.(id);
		} catch { /* ignore */ }
	}

	refresh(): void {
		if (!this.registeredRowID) return;
		try {
			(globalThis as any).Zotero?.ItemPaneManager?.refreshInfoRow?.(this.registeredRowID);
		} catch { /* ignore */ }
	}
}
