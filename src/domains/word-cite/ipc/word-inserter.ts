import type { PluginKernel } from '../../../kernel/plugin-kernel.ts';
import { deduplicateRegularItems } from '../../../services/item-resolution.ts';
import type { Win32BridgeService } from '../../../services/win32-bridge.ts';
import { runWordCommand } from './word-command.ts';

interface NativeField {
	type?: number;
	_field?: NativeField;
	unserialize(): Promise<unknown>;
	getNoteIndex(): Promise<number>;
	equals(other: NativeField | undefined): Promise<boolean>;
	delete?(): Promise<void>;
}

interface NativeCitation {
	citationItems: Array<{ id: number | string }>;
	fieldIndex?: number;
	_fieldIndex?: number;
	field?: NativeField;
	_field?: NativeField;
	prepareForEditing(): Promise<void>;
}

interface NativeSession {
	_insertCitingResult(index: number, field: NativeField, citation: NativeCitation): Promise<NativeCitation[]>;
	addCitation(index: number, note: number, citation: NativeCitation): Promise<void>;
	addField(flag: boolean): Promise<NativeField>;
	getFields(refresh?: boolean): Promise<NativeField[]>;
	updateFromDocument(index: number): Promise<void>;
	citationsByItemID: Record<string, unknown>;
	data: { prefs: { delayCitationUpdates: boolean } };
	cite(field: NativeField | null): Promise<NativeCitation[]>;
}

export type WordInsertResult = 'inserted' | 'busy' | 'non-word' | 'cancelled' | 'unavailable';

export function resolveActiveSelectionForWord(win?: Window): any[] {
	const zotero = (globalThis as any).Zotero;
	const targetWin = win || zotero?.getMainWindow?.() || zotero?.getMainWindows?.()?.[0];
	const tabs = (targetWin as any)?.Zotero_Tabs;
	const pane = (targetWin as any)?.ZoteroPane;
	if (!tabs || !pane) return [];

	if (tabs.selectedID === 'zotero-pane' || tabs.selectedIndex === 0) {
		const { items } = deduplicateRegularItems(pane.getSelectedItems?.() || []);
		return items;
	}
	const reader = zotero?.Reader?.getByTabID?.(tabs.selectedID);
	const attachment = reader && zotero?.Items?.get?.(reader.itemID);
	const candidate = attachment?.parentItem || attachment;
	return candidate ? deduplicateRegularItems([candidate]).items : [];
}

/**
 * Inserts real Zotero native Word field codes (`ADDIN ZOTERO_ITEM CSL_CITATION`)
 * at the active Word cursor through the native citation command and session writer.
 */
export async function insertItemsIntoWord(
	kernel: PluginKernel,
	win32: Win32BridgeService,
	rawItems: readonly any[],
	options: { verifyCursor?: boolean; onCommitted?: (session?: unknown) => void } = {},
): Promise<WordInsertResult> {
	const { items } = deduplicateRegularItems(rawItems);
	const selectedIDs = items.map((item) => Number(item.id)).filter((id) => Number.isSafeInteger(id) && id > 0);
	if (!selectedIDs.length) return 'unavailable';

	const host = (globalThis as any).Zotero;
	const integration = host?.Integration;
	if (typeof integration?.CitationField !== 'function' || typeof integration?.Citation !== 'function'
		|| typeof integration?.Field?.loadExisting !== 'function') return 'unavailable';

	const verifyDrop = host.isMac !== true && options.verifyCursor;
	if (verifyDrop && !win32.verifyDroppedWordTarget()) return 'non-word';

	const insertCitation = async function (this: NativeSession, field: NativeField | null): Promise<NativeCitation[]> {
		let newField = false;
		let activeField: NativeField | null = field;
		let citation: NativeCitation;
		let committed = false;

		try {
			if (activeField) {
				activeField = await integration.Field.loadExisting(activeField);
				if (activeField && activeField.type === 2) {
					throw new host.Exception.Alert('integration.error.notInCitation');
				}
				if (activeField && activeField.type === 1) {
					citation = new integration.Citation(activeField, await activeField.unserialize(), await activeField.getNoteIndex());
				} else {
					activeField = new integration.CitationField(activeField?._field ?? activeField);
					citation = new integration.Citation(activeField);
				}
			} else {
				newField = true;
				activeField = new integration.CitationField(await this.addField(true));
				citation = new integration.Citation(activeField);
			}

			await citation.prepareForEditing();
			let fieldIndex = -1;
			if (!this.data?.prefs?.delayCitationUpdates || !Object.keys(this.citationsByItemID || {}).length) {
				const findFieldIndex = this.getFields().then(async (fields) => {
					for (const [index, candidate] of fields.entries()) {
						if (await candidate.equals(activeField?._field)) {
							activeField = new integration.CitationField(candidate);
							return index;
						}
					}
					return -1;
				});
				const [fieldResult, updateResult] = await Promise.allSettled([findFieldIndex, this.updateFromDocument(0)]);
				if (fieldResult.status === 'rejected') throw fieldResult.reason;
				if (updateResult.status === 'rejected') throw updateResult.reason;
				fieldIndex = fieldResult.value;
			}

			const existingIDs = new Set(citation.citationItems.map((item) => Number(item.id)));
			for (const id of selectedIDs) {
				if (!existingIDs.has(id)) citation.citationItems.push({ id });
			}
			const citations = await this._insertCitingResult(fieldIndex, activeField!, citation);
			if (!citations.length) throw new Error('Word returned no citation fields');
			let refreshedFields: NativeField[] | undefined;

			if (!this.data?.prefs?.delayCitationUpdates) {
				if (citations.length !== 1) {
					refreshedFields = await this.getFields(true);
				}
				await this.updateFromDocument(0);
			}

			for (const cit of citations) {
				const idx = (cit.fieldIndex ?? cit._fieldIndex)!;
				if (refreshedFields && refreshedFields[idx]) {
					const rep = new integration.CitationField(refreshedFields[idx]);
					if ('field' in cit) cit.field = rep;
					else cit._field = rep;
				}
				const citField = (cit.field ?? cit._field)!;
				await this.addCitation(idx, await citField.getNoteIndex(), cit);
				committed = true;
			}
			return citations;
		} catch (error) {
			if (newField && !committed && typeof activeField?.delete === 'function') {
				try {
					await activeField.delete();
					await this.getFields(true);
					await this.updateFromDocument(0);
				} catch (cleanupErr) {
					kernel.logger.error('word-cite:rollback', cleanupErr);
				}
			}
			throw error;
		}
	};

	let committedSession: NativeSession | undefined;
	try {
		const result = await runWordCommand(kernel, 'addEditCitation', async (invoke, session: NativeSession) => {
			if (typeof session?.cite !== 'function' || typeof session._insertCitingResult !== 'function'
				|| typeof session.addCitation !== 'function') throw new Error('Word citation API unavailable');
			let wroteCitation = false;
			const dispose = kernel.runtime.patch(session as unknown as Record<string, unknown>, 'cite', 'Word session',
				() => async (field) => {
					const citations = await insertCitation.call(session, field as NativeField | null);
					wroteCitation = true;
					return citations;
				},
			);
			try {
				await invoke();
				if (!wroteCitation) throw new Error('The Word command did not insert a citation');
				committedSession = session;
			} finally {
				dispose();
			}
		});
		if (result !== 'completed') return result;
		try { options.onCommitted?.(committedSession); } catch { /* Word has already completed */ }
		return 'inserted';
	} finally {
		if (verifyDrop) win32.clearLastDroppedWordTarget();
	}
}

export async function refreshActiveWordDocument(kernel: PluginKernel, expectedSessionID?: string): Promise<boolean> {
	let invoked = false;
	const result = await runWordCommand(kernel, 'refresh', async (invoke, session) => {
		if (expectedSessionID && session?.sessionID !== expectedSessionID) return;
		invoked = true;
		return invoke();
	});
	return invoked && result === 'completed';
}
