import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {
	HOST_CONTRACTS,
	detectZoteroBinary,
	getRequiredOmniEntryNames,
	parseCliArgs,
	readZipEntries,
	removeDirWithRetry,
	runHeadlessLaunchSmoke,
	terminateProcessTree,
	verifyZoteroOmniContracts,
} from '../scripts/smoke-zotero.mjs';

const CRC32_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let k = 0; k < 8; k++) {
			c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[i] = c >>> 0;
	}
	return table;
})();

function crc32(buffer) {
	let crc = 0xffffffff;
	for (let i = 0; i < buffer.length; i++) {
		crc = CRC32_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Build a valid in-memory ZIP archive supporting compression method 0 (stored)
 * and method 8 (raw deflate).
 */
function buildZipArchive(entries) {
	const localChunks = [];
	const centralChunks = [];
	let localOffset = 0;

	for (const entry of entries) {
		const nameBuf = Buffer.from(entry.name, 'utf8');
		const rawBuf = Buffer.from(entry.content, 'utf8');
		const method = entry.method ?? 0;
		const payloadBuf = method === 8 ? zlib.deflateRawSync(rawBuf) : rawBuf;
		const checksum = crc32(rawBuf);

		const localHeader = Buffer.alloc(30);
		localHeader.writeUInt32LE(0x04034b50, 0);
		localHeader.writeUInt16LE(20, 4);
		localHeader.writeUInt16LE(0, 6);
		localHeader.writeUInt16LE(method, 8);
		localHeader.writeUInt16LE(0, 10);
		localHeader.writeUInt16LE(0, 12);
		localHeader.writeUInt32LE(checksum, 14);
		localHeader.writeUInt32LE(payloadBuf.length, 18);
		localHeader.writeUInt32LE(rawBuf.length, 22);
		localHeader.writeUInt16LE(nameBuf.length, 26);
		localHeader.writeUInt16LE(0, 28);

		localChunks.push(localHeader, nameBuf, payloadBuf);

		const cdHeader = Buffer.alloc(46);
		cdHeader.writeUInt32LE(0x02014b50, 0);
		cdHeader.writeUInt16LE(20, 4);
		cdHeader.writeUInt16LE(20, 6);
		cdHeader.writeUInt16LE(0, 8);
		cdHeader.writeUInt16LE(method, 10);
		cdHeader.writeUInt16LE(0, 12);
		cdHeader.writeUInt16LE(0, 14);
		cdHeader.writeUInt32LE(checksum, 16);
		cdHeader.writeUInt32LE(payloadBuf.length, 20);
		cdHeader.writeUInt32LE(rawBuf.length, 24);
		cdHeader.writeUInt16LE(nameBuf.length, 28);
		cdHeader.writeUInt16LE(0, 30);
		cdHeader.writeUInt16LE(0, 32);
		cdHeader.writeUInt16LE(0, 34);
		cdHeader.writeUInt16LE(0, 36);
		cdHeader.writeUInt32LE(0, 38);
		cdHeader.writeUInt32LE(localOffset, 42);

		centralChunks.push(cdHeader, nameBuf);
		localOffset += localHeader.length + nameBuf.length + payloadBuf.length;
	}

	const centralDir = Buffer.concat(centralChunks);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(0, 4);
	eocd.writeUInt16LE(0, 6);
	eocd.writeUInt16LE(entries.length, 8);
	eocd.writeUInt16LE(entries.length, 10);
	eocd.writeUInt32LE(centralDir.length, 12);
	eocd.writeUInt32LE(localOffset, 16);
	eocd.writeUInt16LE(0, 20);

	return Buffer.concat([...localChunks, centralDir, eocd]);
}

function createPassingContractEntries(overrides = {}) {
	const base = {
		'chrome/content/zotero/xpcom/reader.js': [
			'class ReaderTab {',
			'  constructor(options) {',
			'    this.tabID = options.tabID;',
			'    this._readers = [];',
			'    this._initPromise = this._waitForReader();',
			'    this._handleTabClose();',
			'    this._updateLayout();',
			'    this._updateDocShellActivity();',
			'  }',
			'  registerEventListener() {}',
			'  getByTabID() {}',
			'}',
		].join('\n'),
		'chrome/content/zotero/tabs.js': [
			'this._tabs = [];',
			'this.rename = () => {};',
			'this.select = () => { Zotero.Notifier.trigger(\'select\', \'tab\', id); };',
			'this.close = () => {};',
			'this.move = () => {};',
		].join('\n'),
		'chrome/content/zotero/elements/contextPane.js': [
			'function _getItemContext() {}',
			'function _removeItemContext() {}',
			'function _addItemContext() {}',
		].join('\n'),
		'chrome/content/zotero/itemTree.js': 'class ItemTree { _renderCell() {} }',
		'chrome/content/zotero/collectionTree.js': [
			'class CollectionTree {',
			'  _getIcon() {}',
			'  _expandRow() {}',
			'  _addSortedRow() {}',
			'}',
		].join('\n'),
		'chrome/content/zotero/xpcom/integration.js': [
			'function getSession() {}',
			'function execCommand() {}',
		].join('\n'),
	};
	return { ...base, ...overrides };
}

test('readZipEntries extracts both stored (method 0) and deflated (method 8) entries accurately', () => {
	const zipBuf = buildZipArchive([
		{
			name: 'chrome/content/zotero/itemTree.js',
			content: 'export class ItemTree { _renderCell() { return "桥引"; } }',
			method: 0,
		},
		{
			name: 'chrome/content/zotero/xpcom/integration.js',
			content: 'export function getSession() {} export function execCommand() {}',
			method: 8,
		},
		{
			name: 'chrome/content/zotero/ignored.js',
			content: 'should not be returned when not requested',
			method: 8,
		},
	]);

	const extracted = readZipEntries(zipBuf, [
		'chrome/content/zotero/itemTree.js',
		'chrome/content/zotero/xpcom/integration.js',
		'chrome/content/zotero/nonexistent.js',
	]);

	assert.equal(extracted.size, 2);
	assert.equal(
		extracted.get('chrome/content/zotero/itemTree.js'),
		'export class ItemTree { _renderCell() { return "桥引"; } }',
	);
	assert.equal(
		extracted.get('chrome/content/zotero/xpcom/integration.js'),
		'export function getSession() {} export function execCommand() {}',
	);
	assert.equal(extracted.has('chrome/content/zotero/ignored.js'), false);
	assert.equal(extracted.has('chrome/content/zotero/nonexistent.js'), false);
});

test('readZipEntries throws on non-ZIP buffer', () => {
	assert.throws(() => readZipEntries(Buffer.from('not a zip archive at all'), ['a.js']), /EOCD/);
});

test('verifyZoteroOmniContracts passes when all host contracts are extracted from mixed stored/deflated ZIP', () => {
	const rawEntries = createPassingContractEntries();
	const zipEntries = Object.entries(rawEntries).map(([name, content], idx) => ({
		name,
		content,
		method: idx % 2 === 0 ? 0 : 8,
	}));

	const zipBuf = buildZipArchive(zipEntries);
	const extracted = readZipEntries(zipBuf, getRequiredOmniEntryNames());

	const platformIni = '[Build]\nBuildID=20260922124338\nMilestone=140.17.0\n';
	const appIni = '[App]\nName=Zotero\nVersion=10.0.8\nBuildID=20261106171835\n';
	const result = verifyZoteroOmniContracts(extracted, platformIni, appIni);

	assert.equal(result.ok, true);
	assert.equal(result.passedCount, HOST_CONTRACTS.length);
	assert.equal(result.failedCount, 0);
	assert.deepEqual(result.failures, []);
	assert.equal(result.hostInfo.zoteroVersion, '10.0.8');
	assert.equal(result.hostInfo.geckoMilestone, '140.17.0');
	assert.equal(result.hostInfo.buildId, '20261106171835');
});

test('verifyZoteroOmniContracts fails and reports exact missing symbol names on contract drift', () => {
	const driftedEntries = createPassingContractEntries({
		'chrome/content/zotero/itemTree.js': 'class ItemTree { renderRowOnly() {} }',
		'chrome/content/zotero/xpcom/reader.js': [
			'class ReaderTab {',
			'  constructor() {',
			'    this._readers = [];',
			'    this._initPromise = this._waitForReader();',
			'    this._handleTabClose();',
			'    this._updateLayout();',
			'  }',
			'  registerEventListener() {}',
			'  getByTabID() {}',
			'}',
		].join('\n'),
	});

	const zipBuf = buildZipArchive(
		Object.entries(driftedEntries).map(([name, content]) => ({ name, content, method: 8 })),
	);
	const extracted = readZipEntries(zipBuf, getRequiredOmniEntryNames());
	const result = verifyZoteroOmniContracts(extracted);

	assert.equal(result.ok, false);
	assert.equal(result.failedCount, 2);

	const itemTreeReport = result.contracts.find((c) => c.id === 'itemTree');
	assert.ok(itemTreeReport);
	assert.equal(itemTreeReport.ok, false);
	assert.deepEqual(itemTreeReport.missingSymbols, ['_renderCell']);

	const readerReport = result.contracts.find((c) => c.id === 'reader');
	assert.ok(readerReport);
	assert.equal(readerReport.ok, false);
	assert.deepEqual(readerReport.missingSymbols, ['options.tabID', 'this._updateDocShellActivity']);

	const failureReasons = result.failures.map((f) => f.reason).join('\n');
	assert.match(failureReasons, /_renderCell/);
	assert.match(failureReasons, /options\.tabID/);
	assert.match(failureReasons, /this\._updateDocShellActivity/);
});

test('verifyZoteroOmniContracts reports missing omni.ja entry cleanly', () => {
	const partialEntries = createPassingContractEntries();
	delete partialEntries['chrome/content/zotero/xpcom/integration.js'];

	const entriesMap = new Map(Object.entries(partialEntries));
	const result = verifyZoteroOmniContracts(entriesMap);

	assert.equal(result.ok, false);
	assert.equal(result.failedCount, 1);
	const integrationReport = result.contracts.find((c) => c.id === 'integration');
	assert.ok(integrationReport);
	assert.equal(integrationReport.foundEntry, false);
	assert.deepEqual(integrationReport.missingSymbols, ['getSession', 'execCommand']);
});

test('detectZoteroBinary resolves env override and cross-platform defaults', () => {
	const fakeExists = (allowed) => (p) => allowed.includes(p);

	assert.equal(
		detectZoteroBinary('D:\\Custom\\zotero.exe', 'win32', fakeExists(['D:\\Custom\\zotero.exe'])),
		'D:\\Custom\\zotero.exe',
	);
	assert.equal(
		detectZoteroBinary('', 'win32', fakeExists(['C:\\Program Files (x86)\\Zotero\\zotero.exe'])),
		'C:\\Program Files (x86)\\Zotero\\zotero.exe',
	);
	assert.equal(
		detectZoteroBinary('', 'darwin', fakeExists(['/Applications/Zotero.app/Contents/MacOS/zotero'])),
		'/Applications/Zotero.app/Contents/MacOS/zotero',
	);
	assert.equal(
		detectZoteroBinary('', 'linux', fakeExists(['/usr/lib/zotero/zotero'])),
		'/usr/lib/zotero/zotero',
	);
	assert.equal(detectZoteroBinary('', 'linux', fakeExists([])), null);
});

test('removeDirWithRetry retries transient Windows EBUSY/EPERM locks and degrades gracefully if permanently locked', async () => {
	let calls = 0;
	const delays = [];
	const ok = await removeDirWithRetry('C:\\fake\\profile', {
		maxAttempts: 5,
		baseDelayMs: 50,
		sleepFn: async (ms) => { delays.push(ms); },
		rmSyncFn: () => {
			calls++;
			if (calls < 3) {
				const err = new Error('resource busy or locked');
				err.code = calls === 1 ? 'EBUSY' : 'EPERM';
				throw err;
			}
		},
	});
	assert.equal(ok.removed, true);
	assert.equal(ok.attempts, 3);
	assert.equal(ok.warning, null);
	assert.deepEqual(delays, [50, 100]);

	let failCalls = 0;
	const stuck = await removeDirWithRetry('C:\\fake\\locked', {
		maxAttempts: 3,
		baseDelayMs: 10,
		sleepFn: async () => {},
		rmSyncFn: () => {
			failCalls++;
			const err = new Error('locked by AV');
			err.code = 'EBUSY';
			throw err;
		},
	});
	assert.equal(failCalls, 3);
	assert.equal(stuck.removed, false);
	assert.match(stuck.warning, /EBUSY/);
});

test('terminateProcessTree invokes taskkill /T /F on Windows and negative-PID kill on POSIX', () => {
	const winCalls = [];
	const winRes = terminateProcessTree(
		{ pid: 4321, kill() { winCalls.push('fallback-kill'); } },
		{
			platform: 'win32',
			spawnSyncFn: (cmd, args) => { winCalls.push([cmd, ...args]); return { status: 0 }; },
		},
	);
	assert.equal(winRes, true);
	assert.deepEqual(winCalls, [['taskkill', '/PID', '4321', '/T', '/F']]);

	const posixCalls = [];
	const posixRes = terminateProcessTree(
		{ pid: 9876, kill() { posixCalls.push('fallback-kill'); } },
		{
			platform: 'linux',
			killFn: (pid, sig) => { posixCalls.push([pid, sig]); },
		},
	);
	assert.equal(posixRes, true);
	assert.deepEqual(posixCalls, [[-9876, 'SIGKILL']]);
});

test('runHeadlessLaunchSmoke kills long-running child tree on timeout and removes temp profile cleanly', async () => {
	let capturedProfile = '';
	const res = await runHeadlessLaunchSmoke(process.execPath, 350, {
		buildArgs: (profileDir) => {
			capturedProfile = profileDir;
			return ['-e', 'console.log("smoke-ready"); setInterval(() => {}, 1000);'];
		},
	});
	assert.equal(res.ok, true);
	assert.equal(res.timedOut, true);
	assert.equal(res.treeKilled, true);
	assert.equal(res.cleanupRemoved, true);
	assert.equal(res.cleanupWarning, null);
	assert.equal(fs.existsSync(capturedProfile), false, 'temp profile directory must be deleted after kill');
	assert.match(res.logExcerpt, /smoke-ready/);
});

test('parseCliArgs supports --zotero-bin override for Zotero 11/12 testing', () => {
	const parsed = parseCliArgs(['--check-only', '--require-host', '--zotero-bin=D:\\Zotero11\\zotero.exe', '--timeout=9000']);
	assert.equal(parsed.checkOnly, true);
	assert.equal(parsed.requireHost, true);
	assert.equal(parsed.launch, false);
	assert.equal(parsed.zoteroBin, 'D:\\Zotero11\\zotero.exe');
	assert.equal(parsed.timeoutMs, 9000);
});
