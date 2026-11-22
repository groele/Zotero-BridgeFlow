import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import { deduplicateRegularItems } from '../../services/item-resolution.ts';
import type { Win32BridgeService } from '../../services/win32-bridge.ts';

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
	_sessionUpToDate?: boolean;
	style: { opt: { sort_citations: boolean } };
	sessionID?: string;
}

export type WordInsertResult = 'inserted' | 'busy' | 'non-word' | 'cancelled' | 'unavailable';

let insertInFlight = false;

export function resolveActiveSelectionForWord(win?: Window): any[] {
	const zotero = (globalThis as any).Zotero;
	const targetWin = win || zotero?.getMainWindow?.() || zotero?.getMainWindows?.()?.[0];
	const tabs = (targetWin as any)?.Zotero_Tabs;
	const pane = (targetWin as any)?.ZoteroPane;
	if (!tabs || !pane) return [];

	if (tabs.selectedIndex === 0) {
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
 * at the active Word cursor via temporary `Session.prototype.cite` interception.
 * Faithfully replicates Zotero-CiteFlow's transactional insertion + rollback guard.
 */
export async function insertItemsIntoWord(
	kernel: PluginKernel,
	win32: Win32BridgeService,
	rawItems: readonly any[],
	options: { verifyCursor?: boolean; onCommitted?: () => void } = {},
): Promise<WordInsertResult> {
	if (insertInFlight) return 'busy';
	const { items } = deduplicateRegularItems(rawItems);
	const selectedIDs = [...new Set(items.map((item) => Number(item?.id || 0)).filter((id) => Number.isSafeInteger(id) && id > 0))];
	if (!selectedIDs.length) return 'unavailable';

	const host = (globalThis as any).Zotero;
	const integration = host?.Integration;
	const origCite = integration?.Session?.prototype?.cite;
	if (typeof origCite !== 'function' || typeof integration?.execCommand !== 'function') {
		return 'unavailable';
	}

	const isMac = host?.isMac === true;
	if (!isMac && options.verifyCursor && !win32.verifyDroppedWordTarget()) {
		return 'non-word';
	}

	insertInFlight = true;
	const origGetApp = integration.getApplication;
	let wrappedGetApp: ((...args: unknown[]) => unknown) | null = null;
	const patchedApps = new Map<any, any>();

	const restoreApps = (): void => {
		for (const [app, origFn] of patchedApps) {
			try { app.getActiveDocument = origFn; } catch { /* ignore */ }
		}
		patchedApps.clear();
	};

	// Workaround Zotero 10 WinWord adapter getActiveDocument() null-name bug
	if (!isMac && typeof origGetApp === 'function') {
		wrappedGetApp = function (this: unknown, ...args: unknown[]) {
			const app = Reflect.apply(origGetApp, this, args) as any;
			if (args[0] === 'WinWord' && typeof app?.getDocument === 'function' && typeof app?.getActiveDocument === 'function') {
				if (!patchedApps.has(app)) patchedApps.set(app, app.getActiveDocument);
				app.getActiveDocument = function () {
					return this.getDocument('');
				};
			}
			return app;
		};
		integration.getApplication = wrappedGetApp;
	}

	const patchedCite = async function (this: NativeSession, field: NativeField | null): Promise<unknown> {
		if (typeof this._insertCitingResult !== 'function'
			|| typeof this.addCitation !== 'function'
			|| typeof integration.CitationEditInterface !== 'function') {
			return Reflect.apply(origCite, this, arguments);
		}

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
					newField = true;
					activeField = new integration.CitationField(activeField?._field ?? activeField);
					citation = new integration.Citation(activeField);
				}
			} else {
				newField = true;
				activeField = new integration.CitationField(await this.addField(true));
				citation = new integration.Citation(activeField);
			}

			await citation.prepareForEditing();
			let fieldIndexPromise: Promise<number>;
			let citationsByItemIDPromise: Promise<Record<string, unknown>>;

			if (!this.data?.prefs?.delayCitationUpdates || !Object.keys(this.citationsByItemID || {}).length || this._sessionUpToDate) {
				fieldIndexPromise = this.getFields().then(async (fieldsList: NativeField[]) => {
					for (let i = 0, n = fieldsList.length; i < n; i++) {
						if (await fieldsList[i].equals(activeField?._field)) {
							activeField = new integration.CitationField(fieldsList[i]);
							return i;
						}
					}
					return -1;
				});
				citationsByItemIDPromise = this.updateFromDocument(0).then(() => this.citationsByItemID);
			} else {
				fieldIndexPromise = Promise.resolve(-1);
				citationsByItemIDPromise = Promise.resolve(this.citationsByItemID);
			}

			const io = new integration.CitationEditInterface(
				citation,
				Boolean(this.style?.opt?.sort_citations),
				fieldIndexPromise,
				citationsByItemIDPromise,
			);
			for (const id of selectedIDs) {
				if (!io.citation.citationItems.some((c: any) => Number(c.id) === id)) {
					io.citation.citationItems.push({ id });
				}
			}
			if (!io.citation.citationItems.length) {
				throw new host.Exception.UserCancelled('inserting citation');
			}

			const [fieldIndex] = await Promise.all([fieldIndexPromise, citationsByItemIDPromise]);
			const citations: NativeCitation[] = await this._insertCitingResult(fieldIndex, activeField!, io.citation);
			let refreshedFields: NativeField[] | undefined;

			if (!this.data?.prefs?.delayCitationUpdates) {
				if (citations.length !== 1) {
					refreshedFields = await this.getFields(true);
				}
				await this.updateFromDocument(0);
			}

			for (const cit of citations) {
				const idx = (cit.fieldIndex ?? cit._fieldIndex)!;
				if (refreshedFields) {
					const rep = new integration.CitationField(refreshedFields[idx]);
					if ('field' in cit) cit.field = rep;
					else cit._field = rep;
				}
				const citField = (cit.field ?? cit._field)!;
				await this.addCitation(idx, await citField.getNoteIndex(), cit);
				committed = true;
			}
			committed = true;

			try {
				options.onCommitted?.();
			} catch { /* ignore UI refresh error after native commit */ }
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

	integration.Session.prototype.cite = patchedCite;
	try {
		if (isMac) {
			await integration.execCommand('MacWord16', 'addEditCitation', '/Applications/Microsoft Word.app/', 2);
		} else {
			if (options.verifyCursor && !win32.verifyDroppedWordTarget()) {
				return 'non-word';
			}
			await integration.execCommand('WinWord', 'addEditCitation', null, 1);
		}
		return 'inserted';
	} catch (err) {
		const name = String((err as any)?.name || '');
		if (name.includes('UserCancelled')) return 'cancelled';
		kernel.logger.error('word-cite:insert', err);
		return 'unavailable';
	} finally {
		restoreApps();
		if (wrappedGetApp && integration.getApplication === wrappedGetApp) {
			integration.getApplication = origGetApp;
		}
		if (integration.Session.prototype.cite === patchedCite) {
			integration.Session.prototype.cite = origCite;
		}
		insertInFlight = false;
	}
}
