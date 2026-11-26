import type { WordInsertResultPayload } from '../../../kernel/types.ts';
import type { PluginKernel } from '../../../kernel/plugin-kernel.ts';
import { normalizeToRegularItem } from '../../../services/item-resolution.ts';
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

export type WordInsertResult = WordInsertResultPayload['status'];

export function resolveWordCitationIDs(rawItems: readonly any[]): number[] {
	const ids = new Set<number>();
	for (const raw of rawItems) {
		const item = normalizeToRegularItem(raw);
		const id = Number(item?.id);
		if (!Number.isSafeInteger(id) || id <= 0) return [];
		ids.add(id);
	}
	return [...ids];
}

export function resolveActiveSelectionForWord(win?: Window): any[] {
	const zotero = (globalThis as any).Zotero;
	const targetWin = win || zotero?.getMainWindow?.() || zotero?.getMainWindows?.()?.[0];
	const tabs = (targetWin as any)?.Zotero_Tabs;
	const pane = (targetWin as any)?.ZoteroPane;
	if (!tabs || !pane) return [];

	if (tabs.selectedID === 'zotero-pane' || tabs.selectedIndex === 0) {
		return pane.getSelectedItems?.() || [];
	}
	const reader = zotero?.Reader?.getByTabID?.(tabs.selectedID);
	const attachment = reader && zotero?.Items?.get?.(reader.itemID);
	return attachment ? [attachment] : [];
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
	const selectedIDs = resolveWordCitationIDs(rawItems);
	if (!selectedIDs.length) return 'invalid-selection';

	const host = (globalThis as any).Zotero;
	const integration = host?.Integration;
	if (typeof integration?.CitationField !== 'function' || typeof integration?.Citation !== 'function'
		|| typeof integration?.Field?.loadExisting !== 'function') return 'unavailable';

	const verifyDrop = host.isMac !== true && options.verifyCursor;
	let rejection: WordInsertResult | null = null;
	let writeAttempted = false;
	let fieldVerified = false;

	const insertCitation = async function (this: NativeSession, field: NativeField | null): Promise<NativeCitation[]> {
		let newField = false;
		let activeField: NativeField | null = field;
		let citation: NativeCitation;
		let committed = false;

		try {
			if (activeField) {
				activeField = await integration.Field.loadExisting(activeField);
				if (activeField && activeField.type === 2) {
					rejection = 'field-conflict';
					throw new host.Exception.Alert('integration.error.notInCitation');
				}
				if (activeField && activeField.type === 1) {
					citation = new integration.Citation(activeField, await activeField.unserialize(), await activeField.getNoteIndex());
				} else {
					rejection = 'field-conflict';
					throw new Error('Word cursor is in an unrecognized field');
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
				if (fieldIndex < 0) {
					rejection = 'field-conflict';
					throw new Error('Could not locate the Word citation field');
				}
			}

			const existingIDs = new Set(citation.citationItems.map((item) => Number(item.id)));
			for (const id of selectedIDs) {
				if (!existingIDs.has(id)) citation.citationItems.push({ id });
			}
			const expectedIDs = citation.citationItems.map(item => String(item.id)).sort();
			writeAttempted = true;
			const citations = await this._insertCitingResult(fieldIndex, activeField!, citation);
			const actualIDs = citations[0]?.citationItems.map(item => String(item.id)).sort();
			if (citations.length !== 1 || actualIDs.length !== expectedIDs.length
				|| actualIDs.some((id, index) => id !== expectedIDs[index])) {
				throw new Error('Word returned a citation cluster with unexpected item identities');
			}
			const [result] = citations;
			const index = result.fieldIndex ?? result._fieldIndex;
			const resultField = result.field ?? result._field;
			if (!resultField || index === undefined || !Number.isInteger(index) || index < (fieldIndex === -1 ? -1 : 0)) {
				throw new Error('Word returned an invalid citation field');
			}
			if (!this.data?.prefs?.delayCitationUpdates) await this.updateFromDocument(0);
			await this.addCitation(index, await resultField.getNoteIndex(), result);
			committed = true;
			return citations;
		} catch (error) {
			if (newField && !committed && typeof activeField?.delete === 'function') {
				try {
					await activeField.delete();
					await this.getFields(true);
					await this.updateFromDocument(0);
					writeAttempted = false;
				} catch (cleanupErr) {
					writeAttempted = true;
					kernel.logger.error('word-cite:rollback', cleanupErr);
				}
			}
			throw error;
		}
	};

	let committedSession: NativeSession | undefined;
	try {
		if (verifyDrop && !win32.verifyDroppedWordTarget()) return 'non-word';
		const result = await runWordCommand(kernel, 'addEditCitation', async (invoke, session: NativeSession) => {
			if (verifyDrop && !win32.verifyDroppedWordTarget()) {
				rejection = 'non-word';
				return;
			}
			const liveIDs = resolveWordCitationIDs(rawItems);
			if (liveIDs.length !== selectedIDs.length || liveIDs.some((id, index) => id !== selectedIDs[index])) {
				rejection = 'invalid-selection';
				return;
			}
			if (typeof session?.cite !== 'function' || typeof session._insertCitingResult !== 'function'
				|| typeof session.addCitation !== 'function') throw new Error('Word citation API unavailable');
			let wroteCitation = false;
			const dispose = kernel.runtime.patch(session as unknown as Record<string, unknown>, 'cite', 'Word session',
				() => async (field) => {
					const citations = await insertCitation.call(session, field as NativeField | null);
					wroteCitation = true;
					fieldVerified = true;
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
		if (writeAttempted && result !== 'completed') return 'uncertain-write';
		if (rejection) return rejection;
		if (result !== 'completed') return result;
		if (!fieldVerified) return 'unavailable';
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
