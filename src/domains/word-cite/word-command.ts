import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { Disposable } from '../../kernel/types.ts';

export type WordCommandResult = 'completed' | 'busy' | 'cancelled' | 'unavailable';

const inFlight = new WeakSet<object>();

/** Track the native command separately from execCommand, which handles and swallows errors. */
export async function runWordCommand(
	kernel: PluginKernel,
	command: 'addEditCitation' | 'refresh',
	run: (original: () => unknown, session: any) => Promise<unknown>,
): Promise<WordCommandResult> {
	const host = (globalThis as any).Zotero;
	const integration = host?.Integration;
	const iface = integration?.Interface?.prototype;
	if (host?.isMac !== true && host?.isWin === false) return 'unavailable';
	if (typeof integration?.execCommand !== 'function'
		|| typeof integration.getApplication !== 'function' || typeof iface?.[command] !== 'function') {
		return 'unavailable';
	}
	if (inFlight.has(integration) || integration.currentDoc) return 'busy';

	const isMac = host.isMac === true;
	const agent = isMac ? 'MacWord16' : 'WinWord';
	const docId = isMac ? '/Applications/Microsoft Word.app/' : null;
	const disposers: Disposable[] = [];
	let application: any;
	let document: unknown;
	let result: WordCommandResult = 'unavailable';
	const isCancelled = (error: unknown): boolean => {
		const UserCancelled = host.Exception?.UserCancelled;
		return typeof UserCancelled === 'function' && error instanceof UserCancelled;
	};

	inFlight.add(integration);
	try {
		disposers.push(kernel.runtime.patch(integration, 'getApplication', 'Word command', (original) =>
			function (this: unknown, ...args: unknown[]) {
				const app = Reflect.apply(original, this, args) as any;
				if (!application && args[0] === agent && args[1] === command && args[2] === docId) {
					application = app;
					if (!isMac && typeof app?.getDocument === 'function' && typeof app.getActiveDocument === 'function') {
						// Zotero 10.0.8's adapter passes null to a getDocument implementation
						// that calls .indexOf() before reaching the native active-document fallback.
						disposers.push(kernel.runtime.patch(app, 'getActiveDocument', 'WinWord adapter', () =>
							async () => app.getDocument(''),
						));
					}
				}
				return app;
			},
		));
		disposers.push(kernel.runtime.patch(iface, command, 'Word command', (original) =>
			async function (this: any, ...args: unknown[]) {
				const invoke = () => Reflect.apply(original, this, args);
				if (!application || this._app !== application) return invoke();
				document = this._doc;
				try {
					const value = await run(invoke, this._session);
					result = 'completed';
					return value;
				} catch (error) {
					if (isCancelled(error)) result = 'cancelled';
					throw error;
				}
			},
		));
		if (typeof integration._handleCommandError === 'function') {
			disposers.push(kernel.runtime.patch(integration, '_handleCommandError', 'Word command', (original) =>
				function (this: unknown, ...args: unknown[]) {
					if (document && args[0] === document) result = 'unavailable';
					return Reflect.apply(original, this, args);
				},
			));
		}
		await integration.execCommand(agent, command, docId, isMac ? 2 : 1);
		return result;
	} catch (error) {
		if (isCancelled(error)) return 'cancelled';
		kernel.logger.error(`word-cite:${command}`, error);
		return 'unavailable';
	} finally {
		for (const dispose of disposers.reverse()) dispose();
		inFlight.delete(integration);
	}
}
