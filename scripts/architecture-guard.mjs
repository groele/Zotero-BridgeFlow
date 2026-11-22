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
check('Version alignment & Zotero 10.0-12.* scope', () => {
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
	if (baseline.lastReleasedVersion !== ver) {
		throw new Error(`architecture-baseline.json (${baseline.lastReleasedVersion}) != package.json (${ver})`);
	}
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
});

// 8. Preferences XHTML zero hardcoded CJK text & single default open card
check('Preferences XHTML zero hardcoded CJK & single default open card', () => {
	const xhtmlPath = path.join(root, 'prefs.xhtml');
	if (!fs.existsSync(xhtmlPath)) throw new Error('Missing prefs.xhtml');
	const text = fs.readFileSync(xhtmlPath, 'utf8');
	const stripped = text.replace(/<!--[\s\S]*?-->/g, '');
	if (/[\u4e00-\u9fff]/.test(stripped)) {
		throw new Error('Hardcoded Chinese text found in prefs.xhtml; all labels must use data-l10n-id');
	}
	const openCount = (stripped.match(/<html:details\b[^>]*\bopen=/g) || []).length;
	if (openCount !== 1) {
		throw new Error(`Expected exactly 1 default-open <html:details> card, found ${openCount}`);
	}
});

console.log(`\nArchitecture guard summary: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exit(1);
