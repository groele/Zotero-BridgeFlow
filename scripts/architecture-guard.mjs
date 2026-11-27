import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'architecture-baseline.json'), 'utf8'));

const failures = [];
let passed = 0;

function check(name, fn) {
	try {
		fn();
		passed++;
		console.log(`[PASS] ${name}`);
	} catch (err) {
		failures.push(`${name}: ${err.message}`);
		console.error(`[FAIL] ${name}: ${err.message}`);
	}
}

function walkFiles(dir, extFilter) {
	const results = [];
	if (!fs.existsSync(dir)) return results;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...walkFiles(full, extFilter));
		} else if (!extFilter || extFilter(full)) {
			results.push(full);
		}
	}
	return results;
}

const srcFiles = walkFiles(path.join(root, 'src'), (f) => f.endsWith('.ts') || f.endsWith('.tsx'));

// 1. 360-line ceiling
check('Single-file <= 360 lines ceiling', () => {
	const maxLines = baseline.maxFileLines || 360;
	const violations = [];
	for (const f of srcFiles) {
		const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/).length;
		if (lines > maxLines) {
			violations.push(`${path.relative(root, f)} (${lines} lines)`);
		}
	}
	if (violations.length) throw new Error(`Oversized modules: ${violations.join(', ')}`);
});

// 2. TypeScript purity & zero @ts-nocheck / @ts-ignore
check('TypeScript purity & zero ts-nocheck/ts-ignore', () => {
	const jsInSrc = walkFiles(path.join(root, 'src'), (f) => f.endsWith('.js') || f.endsWith('.mjs'));
	if (jsInSrc.length) throw new Error(`Non-TS files in src/: ${jsInSrc.map((f) => path.relative(root, f)).join(', ')}`);
	const bad = [];
	for (const f of srcFiles) {
		const text = fs.readFileSync(f, 'utf8');
		if (/@ts-nocheck|@ts-ignore/.test(text)) bad.push(path.relative(root, f));
	}
	if (bad.length) throw new Error(`Forbidden TS suppression in: ${bad.join(', ')}`);
});

// 3. No version-prefixed filenames
check('Naming governance (no version-prefixed filenames)', () => {
	const bad = [];
	for (const f of srcFiles) {
		const base = path.basename(f);
		if (/^(v\d+|V\d+|temp[-_])/i.test(base)) bad.push(path.relative(root, f));
	}
	if (bad.length) throw new Error(`Forbidden filenames: ${bad.join(', ')}`);
});

// 4. Strict layered dependency boundaries (no cross-domain imports, no upward imports)
check('Strict 5-layer dependency boundaries', () => {
	const violations = [];
	const importRe = /(?:import|export)\s+(?:type\s+)?[\s\S]*?from\s+['"]([^'"]+)['"]/g;
	for (const f of srcFiles) {
		const rel = path.relative(path.join(root, 'src'), f).replace(/\\/g, '/');
		const text = fs.readFileSync(f, 'utf8');
		let match;
		while ((match = importRe.exec(text)) !== null) {
			const spec = match[1];
			if (!spec.startsWith('.')) continue;
			const resolved = path.relative(path.join(root, 'src'), path.resolve(path.dirname(f), spec)).replace(/\\/g, '/');
			if (rel.startsWith('kernel/') && (resolved.startsWith('services/') || resolved.startsWith('domains/') || resolved.startsWith('bridges/'))) {
				violations.push(`${rel} -> ${resolved} (kernel cannot import upper layers)`);
			}
			if (rel.startsWith('services/') && (resolved.startsWith('domains/') || resolved.startsWith('bridges/'))) {
				violations.push(`${rel} -> ${resolved} (services cannot import domains/bridges)`);
			}
			if ((rel.startsWith('prefs/') || rel === 'preferences.ts') && (resolved.startsWith('domains/') || resolved.startsWith('bridges/'))) {
				violations.push(`${rel} -> ${resolved} (prefs cannot import domains/bridges)`);
			}
			const domainMatch = rel.match(/^domains\/([^/]+)\//);
			const targetDomainMatch = resolved.match(/^domains\/([^/]+)\//);
			if (domainMatch && targetDomainMatch && domainMatch[1] !== targetDomainMatch[1]) {
				violations.push(`${rel} -> ${resolved} (cross-domain direct import forbidden; use kernel/services/bridges)`);
			}
		}
	}
	if (violations.length) throw new Error(violations.join('; '));
});

// 5. Deprecated Gecko/Zotero API ban
check('Deprecated API ban (Cu.import / Components.classes)', () => {
	const bad = [];
	for (const f of srcFiles) {
		const text = fs.readFileSync(f, 'utf8');
		if (/\bCu\.import\s*\(|\bComponents\.classes\b|\bComponents\.interfaces\b/.test(text)) {
			bad.push(path.relative(root, f));
		}
	}
	if (bad.length) throw new Error(`Deprecated APIs found in: ${bad.join(', ')}`);
});

// 6. Version alignment across package.json, manifest.json, update.json, baseline
function checkVersionAlignment() {
	const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
	const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
	const update = JSON.parse(fs.readFileSync(path.join(root, 'update.json'), 'utf8'));
	const ver = pkg.version;
	if (manifest.version !== ver) throw new Error(`manifest.json (${manifest.version}) != package.json (${ver})`);
	const zApp = manifest.applications?.zotero;
	if (zApp?.strict_min_version !== '10.0' || zApp?.strict_max_version !== '12.*') {
		throw new Error(`manifest.json strict version scope must be 10.0 - 12.*`);
	}
	const feedEntry = update.addons?.[zApp.id]?.updates?.[0];
	if (!feedEntry || feedEntry.version !== ver) {
		throw new Error(`update.json (${feedEntry?.version}) != package.json (${ver})`);
	}
	const feedApp = feedEntry.applications?.zotero;
	if (feedApp?.strict_min_version !== zApp.strict_min_version || feedApp?.strict_max_version !== zApp.strict_max_version) {
		throw new Error('Update feed compatibility differs from manifest');
	}
	if (feedEntry.update_link !== `${pkg.homepage}/releases/download/v${ver}/Zotero-BridgeFlow-${ver}.xpi`) {
		throw new Error('Update feed download URL differs from the current release asset');
	}
	if (baseline.lastReleasedVersion !== ver) {
		throw new Error(`architecture-baseline.json (${baseline.lastReleasedVersion}) != package.json (${ver})`);
	}
	const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
	if (lock.version !== ver || lock.packages[''].version !== ver) throw Error('Lockfile version mismatch');
	if (!fs.readFileSync(path.join(root, 'prefs.xhtml'), 'utf8').includes(`"version":"${ver}"`)) throw Error('Preferences badge drift');
	const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
	if (!readme.includes(`**${ver}**`) || !readme.includes(`(\`v${ver}\`)`) || !readme.includes(`Zotero-BridgeFlow-${ver}.xpi`)) {
		throw Error('README version or installer table drift');
	}
}
check('Version alignment & Zotero 10.0-12.* scope', checkVersionAlignment);

check('Valid CSS font shorthands across all src modules', () => {
	const bad = [];
	const badFontRe = /(?<![-\w])font\s*:(?!\s*inherit(?:\s+!important)?\s*(?:[;'"`}]|$))[^;'"`{}]+\binherit\b/;
	for (const f of srcFiles) {
		if (badFontRe.test(fs.readFileSync(f, 'utf8'))) {
			bad.push(path.relative(root, f));
		}
	}
	if (bad.length) throw Error(`Invalid CSS font shorthand with inherit in: ${bad.join(', ')}`);
});


// 7. Fluent symmetry (en-US vs zh-CN) & zero duplicates
check('Fluent FTL symmetry (en-US <-> zh-CN) & zero duplicates', () => {
	const enPath = path.join(root, 'locale/en-US/zotero-bridgeflow.ftl');
	const zhPath = path.join(root, 'locale/zh-CN/zotero-bridgeflow.ftl');
	if (!fs.existsSync(enPath) || !fs.existsSync(zhPath)) {
		throw new Error('Missing locale FTL files');
	}
	const parseKeys = (filePath) => {
		const keys = new Set();
		const dups = [];
		for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
			const m = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*)\s*=/);
			if (m) {
				if (keys.has(m[1])) dups.push(m[1]);
				keys.add(m[1]);
			}
		}
		if (dups.length) throw new Error(`Duplicate FTL keys in ${path.relative(root, filePath)}: ${dups.join(', ')}`);
		return keys;
	};
	const enKeys = parseKeys(enPath);
	const zhKeys = parseKeys(zhPath);
	const onlyEn = [...enKeys].filter((k) => !zhKeys.has(k));
	const onlyZh = [...zhKeys].filter((k) => !enKeys.has(k));
	if (onlyEn.length || onlyZh.length) {
		throw new Error(`FTL mismatch — only in en-US: [${onlyEn.join(', ')}]; only in zh-CN: [${onlyZh.join(', ')}]`);
	}

	const missingRefs = [];
	const xhtml = fs.readFileSync(path.join(root, 'prefs.xhtml'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
	for (const m of xhtml.matchAll(/\bdata-l10n-id="([^"]+)"/g)) {
		if (!enKeys.has(m[1])) missingRefs.push(`prefs.xhtml:${m[1]}`);
	}
	for (const f of srcFiles) {
		const txt = fs.readFileSync(f, 'utf8');
		for (const m of txt.matchAll(/setStatusFeedback\([^,]+,\s*['"](zbf-[^'"]+)['"]/g)) {
			if (!enKeys.has(m[1])) missingRefs.push(`${path.relative(root, f)}:${m[1]}`);
		}
		for (const m of txt.matchAll(/setAttribute\(\s*['"]data-l10n-id['"]\s*,\s*['"](zbf-[^'"]+)['"]\s*\)/g)) {
			if (!enKeys.has(m[1])) missingRefs.push(`${path.relative(root, f)}:${m[1]}`);
		}
	}
	if (missingRefs.length) {
		throw new Error(`Unresolved Fluent data-l10n-id references: ${[...new Set(missingRefs)].join(', ')}`);
	}
});

// 8. Preferences XHTML zero hardcoded CJK text & subsystem horizontal tabs
check('Preferences XHTML zero hardcoded CJK & subsystem horizontal tabs', () => {
	const xhtmlPath = path.join(root, 'prefs.xhtml');
	if (!fs.existsSync(xhtmlPath)) throw new Error('Missing prefs.xhtml');
	const text = fs.readFileSync(xhtmlPath, 'utf8');
	const stripped = text.replace(/<!--[\s\S]*?-->/g, '');
	if (/[\u4e00-\u9fff]/.test(stripped)) {
		throw new Error('Hardcoded Chinese text found in prefs.xhtml; all labels must use data-l10n-id');
	}
	const tabTags = [...stripped.matchAll(/<html:button\b[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);
	const panelTags = [...stripped.matchAll(/<html:section\b[^>]*role="tabpanel"[^>]*>/g)].map((m) => m[0]);
	const selectedCount = tabTags.filter((tag) => /aria-selected="true"/.test(tag)).length;
	const visiblePanels = panelTags.filter((tag) => !/\bhidden\s*=/.test(tag)).length;
	if (tabTags.length !== 6 || panelTags.length !== 6 || selectedCount !== 1 || visiblePanels !== 1) {
		throw new Error(`Expected 6 horizontal subsystem tabs & panels with 1 active (tabs=${tabTags.length}, panels=${panelTags.length}, selected=${selectedCount}, visible=${visiblePanels})`);
	}
});

check('Debt baseline stays cleared', () => {
	if (baseline.debtCleared !== true) throw Error('Debt baseline reopened');
});
check('Workspace HTML controls use the XHTML namespace', () => {
	for (const f of srcFiles.filter(f => /[\\/]domains[\\/]workspace[\\/]/.test(f))) {
		if (/\.createElement\(/.test(fs.readFileSync(f, 'utf8'))) throw Error(path.relative(root, f));
	}
});
check('Workspace 16px content and 24px subordinate indent', () => {
	const css = fs.readFileSync(path.join(root, 'settings.css'), 'utf8');
	if (!/padding:\s*\d+px 16px/.test(css) || !/margin-inline-start:\s*24px/.test(css)) throw Error('Preferences alignment drift');
});
check('Current Gecko APIs', () => {
	for (const f of srcFiles) {
		const txt = fs.readFileSync(f, 'utf8');
		if (/\.ownerGlobal\b|\.jsm["']|Components\.utils|(?<![.\w$])performance\.now\s*\(|(?<![.\w$])queueMicrotask\s*\(/.test(txt)) {
			throw Error(path.basename(f));
		}
	}
});
check('Explicit package module and TypeScript 6+ toolchain', () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
	if (pkg.type !== 'module' || Number.parseInt(pkg.devDependencies.typescript) < 6) throw Error('Unsupported build configuration');
});

// 15. Bridge isolation: forbid importing concrete domains/* modules or penetrating internal .store. / .tracker.
check('Bridge isolation (Port-only constructors, zero domains/* imports or .store./.tracker. penetration)', () => {
	const violations = [];
	const bridgeFiles = srcFiles.filter((f) => /[\\/]bridges[\\/]/.test(f));
	for (const f of bridgeFiles) {
		const txt = fs.readFileSync(f, 'utf8');
		if (/from\s+['"][^'"]*domains\//.test(txt)) {
			violations.push(`${path.relative(root, f)} (imports concrete domains/* instead of kernel/services Port types)`);
		}
		if (/\.store\.|\.tracker\.|domains\/[^'"]+\/store\//.test(txt)) {
			violations.push(`${path.relative(root, f)} (penetrates .store. / .tracker.)`);
		}
	}
	if (violations.length) throw new Error(`Bridge domain coupling found in: ${violations.join('; ')}`);
});

// 16. Host monkey-patch fence: runtime.patch must stay within src/services/host/ or Word IPC integration
check('Host runtime.patch fence (host adapters & Word IPC only)', () => {
	const violations = [];
	for (const f of srcFiles) {
		const rel = path.relative(path.join(root, 'src'), f).replace(/\\/g, '/');
		if (rel.startsWith('services/host/') || rel.startsWith('domains/word-cite/ipc/')) continue;
		const txt = fs.readFileSync(f, 'utf8');
		if (/\bruntime\.patch\s*\(/.test(txt)) violations.push(rel);
	}
	if (violations.length) throw new Error(`Unfenced runtime.patch outside host adapters: ${violations.join(', ')}`);
});

// 17. EventBus closure: zero dead or half-open event definitions in BridgeFlowEventMap
check('EventBus zero dead/half-open event definitions', () => {
	const typesTxt = fs.readFileSync(path.join(root, 'src/kernel/types.ts'), 'utf8');
	const mapMatch = typesTxt.match(/export interface BridgeFlowEventMap \{([\s\S]*?)\n\}/);
	if (!mapMatch) throw new Error('BridgeFlowEventMap not found');
	const eventNames = [...mapMatch[1].matchAll(/'([a-z0-9:-]+)'\s*:/g)].map((m) => m[1]);
	const oneWayAllowlist = new Set(['prefs:changed']);
	const corpus = srcFiles
		.filter((f) => !f.endsWith(`${path.sep}types.ts`))
		.map((f) => fs.readFileSync(f, 'utf8'))
		.join('\n');
	const broken = eventNames.filter((ev) => {
		const esc = ev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const hasEmit = new RegExp(`emit\\(\\s*['"]${esc}['"]`).test(corpus);
		const hasOn = new RegExp(`\\.on\\(\\s*['"]${esc}['"]`).test(corpus);
		if (oneWayAllowlist.has(ev)) return !hasEmit;
		return !hasEmit || !hasOn;
	});
	if (broken.length) throw new Error(`Dead or half-open EventBus definitions: ${broken.join(', ')}`);
});

// 18. Zotero 11+ compatibility: ban removed singular ZoteroPane APIs
check('Forbid singular ZoteroPane.getSelectedLibraryID / getSelectedCollection', () => {
	const hits = [];
	for (const f of srcFiles) {
		const txt = fs.readFileSync(f, 'utf8');
		if (/\bgetSelectedLibraryID\s*\(|\bgetSelectedCollection\s*\(/.test(txt)) {
			hits.push(path.relative(root, f));
		}
	}
	if (hits.length) throw new Error(`Removed singular ZoteroPane APIs found in: ${hits.join(', ')}`);
});

// 19. Host private property fence: reader/tab internals must stay inside src/services/host/
check('Host private property fence (reader/tab internals only in src/services/host/)', () => {
	const privateHostRe = /\.(?:_tabs|_readers|_internalReader|_iframeWindow|_waitForReader|_initPromise|_recentlyClosedTabs|_window)\b/;
	const hits = [];
	for (const f of srcFiles) {
		const rel = path.relative(path.join(root, 'src'), f).replace(/\\/g, '/');
		if (rel.startsWith('services/host/')) continue;
		const txt = fs.readFileSync(f, 'utf8');
		if (privateHostRe.test(txt)) hits.push(rel);
	}
	if (hits.length) throw new Error(`Direct reader/tab private host access outside src/services/host/: ${hits.join(', ')}`);
});

console.log(`\nArchitecture guard summary: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exit(1);
