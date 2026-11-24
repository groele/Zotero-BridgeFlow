import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../kernel/types.ts';
import { mergeAnnotationsByIDs } from '../../services/annotation-utils.ts';
import { ReaderPopupLabelsController } from './annotation-popup-labels.ts';

export class ReaderAnnotationTools {
	private unregisterListener: Disposable | null = null;
	private readonly kernel: PluginKernel;
	public readonly popupLabels: ReaderPopupLabelsController;

	constructor(kernel: PluginKernel) {
		this.kernel = kernel;
		this.popupLabels = new ReaderPopupLabelsController(kernel);
	}

	register(): void {
		this.popupLabels.start();
		if (this.unregisterListener) return;
		const readerApi = (globalThis as any).Zotero?.Reader;
		if (typeof readerApi?.registerEventListener !== 'function') return;

		const listener = (event: any) => {
			if (!this.kernel.prefs.get('inspector.annotations.mergeEnable')) return;
			const ids: number[] = Array.isArray(event?.params?.ids)
				? event.params.ids.map((v: unknown) => Number(v)).filter((n: number) => Number.isInteger(n) && n > 0)
				: [];
			if (ids.length < 2 || typeof event?.append !== 'function') return;
			const zh = Boolean((globalThis as any).Zotero?.locale?.startsWith?.('zh'));
			event.append({
				label: zh ? `合并选中的 ${ids.length} 条标注` : `Merge ${ids.length} Selected Annotations`,
				onCommand: () => {
					void mergeAnnotationsByIDs(ids).then((res) => {
						try {
							const PW = (globalThis as any).Zotero?.ProgressWindow;
							if (typeof PW !== 'function') return;
							const win = new PW({ closeOnClick: true });
							win.changeHeadline(zh ? 'BridgeFlow 批注合并' : 'BridgeFlow Annotation Merge');
							win.addDescription(res.ok
								? (zh ? `已合并 ${ids.length} 条标注为 1 条` : `Merged ${ids.length} annotations`)
								: (zh ? '无法合并所选批注（请确认属于同一有效附件）' : 'Unable to merge selected annotations'));
							win.show();
							win.startCloseTimer(2600);
						} catch { /* ignore */ }
					});
				},
			});
		};

		try {
			readerApi.registerEventListener('createAnnotationContextMenu', listener, this.kernel.info.id);
			this.unregisterListener = () => {
				try {
					readerApi.unregisterEventListener?.('createAnnotationContextMenu', listener);
				} catch { /* ignore */ }
			};
		} catch {
			this.unregisterListener = null;
		}
	}

	unregister(): void {
		this.popupLabels.stop();
		this.unregisterListener?.();
		this.unregisterListener = null;
	}

	mergeByIDs(ids: readonly number[]): Promise<{ ok: boolean; keptID: number; removedCount: number }> {
		return mergeAnnotationsByIDs(ids);
	}
}
