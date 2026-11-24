import assert from 'node:assert/strict';
import test from 'node:test';
import { PluginKernel } from '../src/kernel/plugin-kernel.ts';
import { isChineseLocale, tLocale } from '../src/kernel/locale.ts';
import { runWordCommand } from '../src/domains/word-cite/word-command.ts';
import { WordIntegrationPoller } from '../src/domains/word-cite/word-poller.ts';
import { WordSessionTracker } from '../src/domains/word-cite/session-tracker.ts';
import { isJournalMatch, parseCompactCitation } from '../src/domains/inspector/citation-lookup-parser.ts';
import { clearPdfCoverCache, configurePdfCoverCacheDirectory } from '../src/services/pdf-cover-service.ts';

test('tLocale switches between Chinese and English based on Zotero.locale', () => {
	const prevZotero = globalThis.Zotero;
	try {
		globalThis.Zotero = { locale: 'en-US' };
		assert.equal(isChineseLocale(), false);
		assert.equal(tLocale('中文', 'English'), 'English');

		globalThis.Zotero = { locale: 'zh-CN' };
		assert.equal(isChineseLocale(), true);
		assert.equal(tLocale('中文', 'English'), '中文');
	} finally {
		globalThis.Zotero = prevZotero;
	}
});

test('runWordCommand enforces busy guard and cleans up state after completion', async () => {
	const prevZotero = globalThis.Zotero;
	try {
		let releaseExec;
		const kernel = new PluginKernel();
		class TestIface {
			constructor(app, session) {
				this._app = app;
				this._session = session;
				this._doc = { id: 'doc-1' };
			}
			async addEditCitation() {
				return 'ok';
			}
		}
		const fakeApp = { id: 'app-1' };
		const fakeSession = { sessionID: 's1' };
		globalThis.Zotero = {
			isWin: true,
			isMac: false,
			Integration: {
				Interface: TestIface,
				getApplication: () => fakeApp,
				execCommand: async (agent, cmd, docId) => {
					const app = globalThis.Zotero.Integration.getApplication(agent, cmd, docId);
					const iface = new TestIface(app, fakeSession);
					await new Promise((resolve) => { releaseExec = resolve; });
					return iface[cmd]();
				},
			},
		};

		const first = runWordCommand(kernel, 'addEditCitation', async (invoke) => invoke());
		await new Promise((r) => setTimeout(r, 15));
		const second = await runWordCommand(kernel, 'addEditCitation', async (invoke) => invoke());
		assert.equal(second, 'busy');
		const clock = Date.now;
		try {
			Date.now = () => clock() + 91_000;
			assert.equal(await runWordCommand(kernel, 'addEditCitation', async invoke => invoke()), 'busy');
		} finally { Date.now = clock; }

		releaseExec();
		const firstRes = await first;
		assert.equal(firstRes, 'completed');

		// Subsequent command should run cleanly after cleanup
		const third = runWordCommand(kernel, 'addEditCitation', async (invoke) => invoke());
		await new Promise((r) => setTimeout(r, 15));
		releaseExec();
		assert.equal(await third, 'completed');
	} finally {
		globalThis.Zotero = prevZotero;
	}
});

test('WordIntegrationPoller ignores late rejected updateFromDocument after stop()', async () => {
	const prevZotero = globalThis.Zotero;
	try {
		const kernel = new PluginKernel();
		const tracker = new WordSessionTracker();
		let rejectUpdate;
		const session = {
			agent: 'WinWord',
			sessionID: 'late-stop-session',
			updateFromDocument: () => new Promise((_, rej) => { rejectUpdate = rej; }),
		};
		globalThis.Zotero = {
			Integration: {
				sessions: new Map([['late-stop-session', session]]),
			},
		};

		const poller = new WordIntegrationPoller(kernel, tracker);
		poller.start();
		await new Promise((r) => setTimeout(r, 10));
		poller.stop();
		rejectUpdate(new Error('Word closed'));
		await new Promise((r) => setTimeout(r, 10));
		assert.equal(tracker.getSession('late-stop-session'), undefined);
	} finally {
		globalThis.Zotero = prevZotero;
	}
});

test('configurePdfCoverCacheDirectory routes clearPdfCoverCache to custom directory', async () => {
	const prevZotero = globalThis.Zotero;
	const prevPathUtils = globalThis.PathUtils;
	const prevIOUtils = globalThis.IOUtils;
	try {
		const removedPaths = [];
		globalThis.Zotero = { DataDirectory: { dir: 'C:/DefaultZotero' } };
		globalThis.PathUtils = { join: (...parts) => parts.join('/') };
		globalThis.IOUtils = {
			getChildren: async (dir) => [dir + '/1-ATT12345-480.json', dir + '/unrelated.json'],
			remove: async (p) => { removedPaths.push(p); },
		};

		configurePdfCoverCacheDirectory('D:/CustomCacheRoot');
		const ok = await clearPdfCoverCache();
		assert.equal(ok, true);
		assert.deepEqual(removedPaths, ['D:/CustomCacheRoot/covers/1-ATT12345-480.json']);

		configurePdfCoverCacheDirectory('');
	} finally {
		globalThis.Zotero = prevZotero;
		globalThis.PathUtils = prevPathUtils;
		globalThis.IOUtils = prevIOUtils;
	}
});

test('parseCompactCitation and isJournalMatch handle standard, arXiv, DOI, and malformed inputs', () => {
	assert.equal(parseCompactCitation(''), null);
	assert.equal(parseCompactCitation('random unstructured sentence without year or ids'), null);

	const ieee = parseCompactCitation('[1] Smith et al., Nature, 2024, 625(7993), pp. 12-19. doi:10.1038/s41586-024-00001-x');
	assert.ok(ieee);
	assert.equal(ieee.year, 2024);
	assert.equal(ieee.volume, '625');
	assert.equal(ieee.issue, '7993');
	assert.equal(ieee.firstPage, '12');
	assert.equal(ieee.lastPage, '19');
	assert.equal(ieee.doi, '10.1038/s41586-024-00001-x');

	const arxivOnly = parseCompactCitation('arXiv:2401.12345v2');
	assert.ok(arxivOnly);
	assert.equal(arxivOnly.arxiv, '2401.12345v2');

	assert.equal(isJournalMatch('Nat Rev Mol Cell Biol', 'Nature Reviews Molecular Cell Biology', 'Nat. Rev. Mol. Cell Biol.'), true);
	assert.equal(isJournalMatch('PNAS', 'Proceedings of the National Academy of Sciences', ''), true);
	assert.equal(isJournalMatch('Science', 'Nature', 'Nat.'), false);
});
