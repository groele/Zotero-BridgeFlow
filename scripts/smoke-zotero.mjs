import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const ZIP_EOCD_SIG = 0x06054b50;
const ZIP_CD_SIG = 0x02014b50;
const ZIP_LOCAL_SIG = 0x04034b50;
const ZIP_MAX_COMMENT = 65535;
const ZIP_EOCD_MIN_LEN = 22;

export const HOST_CONTRACTS = Object.freeze([
	{
		id: 'reader',
		entries: ['chrome/content/zotero/xpcom/reader.js'],
		symbols: [
			'class ReaderTab',
			'options.tabID',
			'this._readers',
			'this._initPromise',
			'this._waitForReader',
			'this._handleTabClose',
			'this._updateLayout',
			'this._updateDocShellActivity',
			'_internalReader',
			'_primaryView',
			'_iframeWindow',
			'primaryViewStats',
			'registerEventListener',
			'getByTabID',
		],
	},
	{
		id: 'tabs',
		entries: ['chrome/content/zotero/tabs.js'],
		symbols: [
			'this._tabs',
			'this.rename',
			'this.select',
			'this.close',
			'this.move',
			"Zotero.Notifier.trigger('select', 'tab'",
		],
	},
	{
		id: 'contextPane',
		entries: ['chrome/content/zotero/elements/contextPane.js'],
		symbols: ['_getItemContext', '_removeItemContext', '_addItemContext'],
	},
	{
		id: 'itemTree',
		entries: [
			'chrome/content/zotero/itemTree.js',
			'chrome/content/zotero/xpcom/itemTreeView.js',
			'chrome/content/zotero/components/itemTree.js',
		],
		symbols: ['_renderCell'],
	},
	{
		id: 'collectionTree',
		entries: [
			'chrome/content/zotero/collectionTree.js',
			'chrome/content/zotero/xpcom/collectionTreeView.js',
			'chrome/content/zotero/components/collectionTree.js',
		],
		symbols: [
			'_getIcon',
			'_expandRow',
			'_addSortedRow',
			'_rows',
			'_rowMap',
			'_refreshRowMap',
			'_addRow',
			'_includedInTree',
		],
	},
	{
		id: 'integration',
		entries: ['chrome/content/zotero/xpcom/integration.js'],
		symbols: ['getSession', 'execCommand'],
	},
]);

const PLATFORM_CANDIDATES = Object.freeze({
	win32: [
		'C:\\Program Files\\Zotero\\zotero.exe',
		'C:\\Program Files (x86)\\Zotero\\zotero.exe',
	],
	darwin: ['/Applications/Zotero.app/Contents/MacOS/zotero'],
	linux: ['/usr/bin/zotero', '/usr/lib/zotero/zotero'],
});

export function detectZoteroBinary(
	envPath = process.env.ZOTERO_PLUGIN_ZOTERO_BIN_PATH,
	platform = process.platform,
	existsFn = fs.existsSync,
) {
	if (typeof envPath === 'string' && envPath.trim().length > 0) {
		const trimmed = envPath.trim();
		if (existsFn(trimmed)) {
			return trimmed;
		}
		const binName = platform === 'win32' ? 'zotero.exe' : 'zotero';
		const joined = path.join(trimmed, binName);
		if (existsFn(joined)) {
			return joined;
		}
		return null;
	}

	const candidates = PLATFORM_CANDIDATES[platform] ?? PLATFORM_CANDIDATES.linux;
	for (const candidate of candidates) {
		if (existsFn(candidate)) {
			return candidate;
		}
	}
	return null;
}

export function resolveZoteroHostPaths(binaryPath, existsFn = fs.existsSync) {
	let resolvedBinary = binaryPath;
	try {
		if (existsFn === fs.existsSync) {
			resolvedBinary = fs.realpathSync(binaryPath);
		}
	} catch {
		resolvedBinary = binaryPath;
	}

	const binDir = path.dirname(resolvedBinary);
	const baseDirs = [binDir];
	const macResourcesDir = path.resolve(binDir, '..', 'Resources');
	if (existsFn(macResourcesDir)) {
		baseDirs.push(macResourcesDir);
	}

	const pickFirst = (relCandidates) => {
		for (const base of baseDirs) {
			for (const rel of relCandidates) {
				const full = path.join(base, rel);
				if (existsFn(full)) return full;
			}
		}
		return null;
	};

	return {
		binaryPath: resolvedBinary,
		installDir: binDir,
		omniJaPath: pickFirst(['app/omni.ja', 'omni.ja']),
		platformIniPath: pickFirst(['platform.ini']),
		applicationIniPath: pickFirst(['app/application.ini', 'application.ini']),
	};
}

function findEocdOffset(buf) {
	const minOffset = Math.max(0, buf.length - (ZIP_EOCD_MIN_LEN + ZIP_MAX_COMMENT));
	let fallback = -1;
	for (let offset = buf.length - ZIP_EOCD_MIN_LEN; offset >= minOffset; offset--) {
		if (buf.readUInt32LE(offset) !== ZIP_EOCD_SIG) continue;
		const commentLength = buf.readUInt16LE(offset + 20);
		if (offset + ZIP_EOCD_MIN_LEN + commentLength === buf.length) {
			return offset;
		}
		if (fallback === -1) fallback = offset;
	}
	return fallback;
}

export function readZipEntries(zipBuffer, targetNames) {
	const buf = Buffer.isBuffer(zipBuffer)
		? zipBuffer
		: Buffer.from(zipBuffer.buffer, zipBuffer.byteOffset, zipBuffer.byteLength);

	if (buf.length < ZIP_EOCD_MIN_LEN) {
		throw new Error('Invalid ZIP buffer: smaller than EOCD record');
	}

	const eocdOffset = findEocdOffset(buf);
	if (eocdOffset === -1) {
		throw new Error('Invalid ZIP buffer: EOCD signature (0x06054b50) not found');
	}

	const totalEntries = buf.readUInt16LE(eocdOffset + 10);
	const cdSize = buf.readUInt32LE(eocdOffset + 12);
	const cdOffset = buf.readUInt32LE(eocdOffset + 16);

	if (cdOffset + cdSize > buf.length) {
		throw new Error(`Invalid ZIP central directory bounds (offset=${cdOffset}, size=${cdSize})`);
	}

	const targets = new Set();
	for (const rawName of targetNames) {
		targets.add(String(rawName).replace(/\\/g, '/').replace(/^\/+/, ''));
	}

	const results = new Map();
	if (targets.size === 0) return results;

	let pos = cdOffset;
	for (let i = 0; i < totalEntries; i++) {
		if (pos + 46 > buf.length) {
			throw new Error(`Truncated central directory entry at index ${i}`);
		}
		if (buf.readUInt32LE(pos) !== ZIP_CD_SIG) {
			throw new Error(`Invalid central directory signature at offset ${pos}`);
		}

		const compressionMethod = buf.readUInt16LE(pos + 10);
		const compressedSize = buf.readUInt32LE(pos + 20);
		const fileNameLength = buf.readUInt16LE(pos + 28);
		const extraFieldLength = buf.readUInt16LE(pos + 30);
		const fileCommentLength = buf.readUInt16LE(pos + 32);
		const localHeaderOffset = buf.readUInt32LE(pos + 42);
		const entryName = buf.subarray(pos + 46, pos + 46 + fileNameLength).toString('utf8');

		pos += 46 + fileNameLength + extraFieldLength + fileCommentLength;

		if (!targets.has(entryName)) continue;

		if (localHeaderOffset + 30 > buf.length || buf.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_SIG) {
			throw new Error(`Invalid local file header for "${entryName}" at offset ${localHeaderOffset}`);
		}

		const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
		const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
		const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
		const dataEnd = dataStart + compressedSize;
		if (dataEnd > buf.length) {
			throw new Error(`Truncated entry payload for "${entryName}"`);
		}

		const rawSlice = buf.subarray(dataStart, dataEnd);
		let decoded;
		if (compressionMethod === 0) {
			decoded = rawSlice.toString('utf8');
		} else if (compressionMethod === 8) {
			decoded = zlib.inflateRawSync(rawSlice).toString('utf8');
		} else {
			throw new Error(`Unsupported ZIP compression method ${compressionMethod} for "${entryName}"`);
		}

		results.set(entryName, decoded);
		if (results.size === targets.size) break;
	}

	return results;
}

export function parseIniText(iniText) {
	const sections = {};
	if (!iniText || typeof iniText !== 'string') return sections;
	let currentSection = '';
	for (const rawLine of iniText.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith(';') || line.startsWith('#')) continue;
		if (line.startsWith('[') && line.endsWith(']')) {
			currentSection = line.slice(1, -1).trim();
			if (!sections[currentSection]) sections[currentSection] = {};
			continue;
		}
		const eqIndex = line.indexOf('=');
		if (eqIndex === -1) continue;
		const key = line.slice(0, eqIndex).trim();
		const value = line.slice(eqIndex + 1).trim();
		if (!sections[currentSection]) sections[currentSection] = {};
		sections[currentSection][key] = value;
	}
	return sections;
}

export function getRequiredOmniEntryNames() {
	const names = [];
	for (const contract of HOST_CONTRACTS) {
		for (const entry of contract.entries) {
			names.push(entry);
		}
	}
	return names;
}

export function verifyZoteroOmniContracts(entriesMap, platformIniText = null, applicationIniText = null) {
	const platformIni = parseIniText(platformIniText);
	const appIni = parseIniText(applicationIniText);

	const hostInfo = {
		zoteroVersion: appIni.App?.Version ?? null,
		geckoMilestone: platformIni.Build?.Milestone ?? null,
		buildId: appIni.App?.BuildID ?? platformIni.Build?.BuildID ?? null,
	};

	const contracts = [];
	const failures = [];

	for (const spec of HOST_CONTRACTS) {
		let matchedEntry = null;
		let sourceText = null;
		for (const candidate of spec.entries) {
			if (entriesMap.has(candidate)) {
				matchedEntry = candidate;
				sourceText = entriesMap.get(candidate);
				break;
			}
		}

		const entryLabel = matchedEntry ?? spec.entries[0];
		const matchedSymbols = [];
		const missingSymbols = [];

		if (typeof sourceText === 'string') {
			for (const symbol of spec.symbols) {
				if (sourceText.includes(symbol)) {
					matchedSymbols.push(symbol);
				} else {
					missingSymbols.push(symbol);
				}
			}
		} else {
			missingSymbols.push(...spec.symbols);
		}

		const ok = matchedEntry !== null && missingSymbols.length === 0;
		contracts.push({
			id: spec.id,
			entry: entryLabel,
			foundEntry: matchedEntry !== null,
			ok,
			requiredSymbols: [...spec.symbols],
			matchedSymbols,
			missingSymbols,
		});

		if (!ok) {
			failures.push({
				id: spec.id,
				entry: entryLabel,
				reason:
					matchedEntry === null
						? `Missing entry "${entryLabel}" in omni.ja`
						: `Missing symbols in "${entryLabel}": ${missingSymbols.join(', ')}`,
				missingSymbols,
			});
		}
	}

	const passedCount = contracts.filter((c) => c.ok).length;
	const failedCount = contracts.length - passedCount;

	return {
		ok: failedCount === 0,
		passedCount,
		failedCount,
		hostInfo,
		contracts,
		failures,
	};
}

function readAddonId() {
	try {
		const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8'));
		return manifest?.applications?.zotero?.id || 'bridgeflow@groele';
	} catch {
		return 'bridgeflow@groele';
	}
}

const RETRYABLE_RM_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES']);

function delayMs(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function removeDirWithRetry(
	dirPath,
	{
		maxAttempts = 8,
		baseDelayMs = 150,
		rmSyncFn = fs.rmSync,
		sleepFn = delayMs,
	} = {},
) {
	let lastError = null;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			rmSyncFn(dirPath, { recursive: true, force: true });
			return { removed: true, attempts: attempt, warning: null };
		} catch (err) {
			lastError = err;
			const code = err?.code;
			if (code === 'ENOENT') {
				return { removed: true, attempts: attempt, warning: null };
			}
			if (!RETRYABLE_RM_CODES.has(code) || attempt === maxAttempts) {
				break;
			}
			await sleepFn(Math.min(1200, baseDelayMs * attempt));
		}
	}
	return {
		removed: false,
		attempts: maxAttempts,
		warning: lastError ? `Failed to remove temp profile (${lastError.code || 'ERR'}): ${lastError.message}` : null,
	};
}

export function terminateProcessTree(
	child,
	{
		platform = process.platform,
		spawnSyncFn = spawnSync,
		killFn = process.kill,
	} = {},
) {
	if (!child || !child.pid) return false;
	if (platform === 'win32') {
		try {
			const res = spawnSyncFn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
				stdio: 'ignore',
				windowsHide: true,
				timeout: 5000,
			});
			if (res && res.status === 0) return true;
		} catch { /* fall back to child.kill */ }
		try {
			child.kill('SIGKILL');
			return true;
		} catch {
			return false;
		}
	}
	try {
		killFn(-child.pid, 'SIGKILL');
		return true;
	} catch {
		try {
			child.kill('SIGKILL');
			return true;
		} catch {
			return false;
		}
	}
}

export async function runHeadlessLaunchSmoke(
	binaryPath,
	timeoutMs = 12000,
	options = {},
) {
	const addonId = readAddonId();
	const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zotero-bridgeflow-smoke-'));
	const platform = options.platform ?? process.platform;
	const spawnArgs =
		typeof options.buildArgs === 'function'
			? options.buildArgs(profileDir)
			: ['-profile', profileDir, '-headless', '-no-remote', '-ZoteroDebugText'];

	let child = null;
	let timedOut = false;
	let treeKilled = false;
	let spawnError = null;
	let exitCode = null;
	let signal = null;
	const chunks = [];
	const maxLogBytes = 32_768;
	let collectedBytes = 0;

	const pushChunk = (chunk) => {
		if (collectedBytes >= maxLogBytes) return;
		const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
		chunks.push(text);
		collectedBytes += text.length;
	};

	try {
		const extDir = path.join(profileDir, 'extensions');
		fs.mkdirSync(extDir, { recursive: true });
		fs.writeFileSync(path.join(extDir, addonId), `${REPO_ROOT}\n`, 'utf8');
		fs.writeFileSync(
			path.join(profileDir, 'prefs.js'),
			[
				'user_pref("extensions.autoDisableScopes", 0);',
				'user_pref("extensions.enabledScopes", 15);',
				'user_pref("app.update.enabled", false);',
				'user_pref("extensions.zotero.firstRun2", false);',
			].join('\n') + '\n',
			'utf8',
		);

		await new Promise((resolve) => {
			let settled = false;
			let timer = null;
			let killWaitTimer = null;
			const finish = () => {
				if (settled) return;
				settled = true;
				if (timer !== null) clearTimeout(timer);
				if (killWaitTimer !== null) clearTimeout(killWaitTimer);
				resolve();
			};

			try {
				child = spawn(binaryPath, spawnArgs, {
					stdio: ['ignore', 'pipe', 'pipe'],
					windowsHide: true,
					detached: platform !== 'win32',
				});
			} catch (err) {
				spawnError = err;
				finish();
				return;
			}

			child.stdout?.on('data', pushChunk);
			child.stderr?.on('data', pushChunk);
			child.on('error', (err) => {
				spawnError = err;
				finish();
			});
			child.on('close', (code, sig) => {
				exitCode = code;
				signal = sig;
				finish();
			});

			timer = setTimeout(() => {
				timedOut = true;
				treeKilled = terminateProcessTree(child, { platform });
				// Wait briefly for OS handles to flush after killing the process tree.
				killWaitTimer = setTimeout(finish, 3000);
			}, timeoutMs);
		});

		const combinedOutput = chunks.join('').trim();
		const ok = !spawnError && (timedOut || exitCode === 0);

		const cleanup = await removeDirWithRetry(profileDir, options.cleanupOptions);
		return {
			ok,
			timedOut,
			treeKilled,
			exitCode,
			signal,
			error: spawnError ? spawnError.message : null,
			cleanupRemoved: cleanup.removed,
			cleanupAttempts: cleanup.attempts,
			cleanupWarning: cleanup.warning,
			logExcerpt: combinedOutput.slice(0, 1000),
		};
	} catch (err) {
		await removeDirWithRetry(profileDir, options.cleanupOptions);
		throw err;
	}
}

export function parseCliArgs(argv) {
	const args = {
		checkOnly: false,
		json: false,
		requireHost: false,
		launch: false,
		timeoutMs: 12000,
		zoteroBin: null,
	};
	for (const token of argv) {
		if (token === '--check-only') args.checkOnly = true;
		else if (token === '--json') args.json = true;
		else if (token === '--require-host') args.requireHost = true;
		else if (token === '--launch') args.launch = true;
		else if (token.startsWith('--timeout=')) {
			const parsed = Number.parseInt(token.slice('--timeout='.length), 10);
			if (Number.isFinite(parsed) && parsed > 0) args.timeoutMs = parsed;
		} else if (token.startsWith('--zotero-bin=')) {
			const val = token.slice('--zotero-bin='.length).trim();
			if (val) args.zoteroBin = val;
		}
	}
	if (args.checkOnly) args.launch = false;
	return args;
}

async function runCli() {
	const args = parseCliArgs(process.argv.slice(2));
	const binaryPath = detectZoteroBinary(args.zoteroBin ?? process.env.ZOTERO_PLUGIN_ZOTERO_BIN_PATH);

	if (!binaryPath) {
		const message = 'Zotero binary not found (set --zotero-bin=<path> or ZOTERO_PLUGIN_ZOTERO_BIN_PATH to override)';
		if (args.json) {
			console.log(JSON.stringify({ status: args.requireHost ? 'fail' : 'skip', message }, null, 2));
		} else if (args.requireHost) {
			console.error(`[FAIL] ${message}`);
		} else {
			console.log(`[SKIP] ${message}`);
		}
		process.exit(args.requireHost ? 1 : 0);
	}

	const paths = resolveZoteroHostPaths(binaryPath);
	if (!paths.omniJaPath) {
		const message = `Zotero omni.ja not found near ${binaryPath}`;
		if (args.json) {
			console.log(JSON.stringify({ status: 'fail', message, binaryPath }, null, 2));
		} else {
			console.error(`[FAIL] ${message}`);
		}
		process.exit(1);
	}

	const platformIniText = paths.platformIniPath ? fs.readFileSync(paths.platformIniPath, 'utf8') : null;
	const applicationIniText = paths.applicationIniPath
		? fs.readFileSync(paths.applicationIniPath, 'utf8')
		: null;
	const omniBuffer = fs.readFileSync(paths.omniJaPath);
	const entriesMap = readZipEntries(omniBuffer, getRequiredOmniEntryNames());
	const report = verifyZoteroOmniContracts(entriesMap, platformIniText, applicationIniText);

	let launchReport = null;
	if (args.launch) {
		launchReport = await runHeadlessLaunchSmoke(paths.binaryPath, args.timeoutMs);
	}

	const overallOk = report.ok && (!launchReport || launchReport.ok);

	if (args.json) {
		console.log(
			JSON.stringify(
				{
					status: overallOk ? 'pass' : 'fail',
					binaryPath: paths.binaryPath,
					omniJaPath: paths.omniJaPath,
					...report,
					launch: launchReport,
				},
				null,
				2,
			),
		);
		process.exit(overallOk ? 0 : 1);
	}

	const versionLabel = report.hostInfo.zoteroVersion ?? 'unknown';
	const geckoLabel = report.hostInfo.geckoMilestone ?? 'unknown';
	console.log(`Zotero Host Contract Smoke Check`);
	console.log(`  Binary : ${paths.binaryPath}`);
	console.log(`  Archive: ${paths.omniJaPath}`);
	console.log(`  Version: Zotero ${versionLabel} (Gecko ${geckoLabel})`);
	console.log('');

	for (const contract of report.contracts) {
		const status = contract.ok ? '[PASS]' : '[FAIL]';
		const counts = `${contract.matchedSymbols.length}/${contract.requiredSymbols.length} symbols`;
		if (contract.ok) {
			console.log(`${status} ${contract.id.padEnd(14)} ${contract.entry} (${counts})`);
		} else {
			const detail = contract.foundEntry
				? `missing: ${contract.missingSymbols.join(', ')}`
				: 'entry not found in omni.ja';
			console.error(`${status} ${contract.id.padEnd(14)} ${contract.entry} (${counts}; ${detail})`);
		}
	}

	if (launchReport) {
		const launchTag = launchReport.ok ? '[PASS]' : '[FAIL]';
		const launchDetail = launchReport.timedOut
			? `alive through ${args.timeoutMs}ms smoke window (treeKilled=${launchReport.treeKilled}, cleaned=${launchReport.cleanupRemoved})`
			: `exit=${launchReport.exitCode} (cleaned=${launchReport.cleanupRemoved})`;
		console.log(`${launchTag} ${'headlessLaunch'.padEnd(14)} isolated profile (${launchDetail})`);
		if (launchReport.cleanupWarning) console.warn(`[WARN] ${launchReport.cleanupWarning}`);
	}

	console.log('');
	console.log(`Summary: ${report.passedCount}/${report.contracts.length} host contracts passed.`);
	process.exit(overallOk ? 0 : 1);
}

const isDirectExecution =
	process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectExecution) {
	void runCli();
}
