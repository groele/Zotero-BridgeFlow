import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const buildVersion = pkg.version;

function extractTemplateLiterals(src) {
	const results = [];
	let i = 0;
	const n = src.length;
	while (i < n) {
		const ch = src[i];
		if (ch === '/' && src[i + 1] === '/') {
			while (i < n && src[i] !== '\n') i++;
		} else if (ch === '/' && src[i + 1] === '*') {
			i += 2;
			while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
			i += 2;
		} else if (ch === "'" || ch === '"') {
			const q = ch;
			i++;
			while (i < n && src[i] !== q) {
				if (src[i] === '\\') i++;
				i++;
			}
			i++;
		} else if (ch === '`') {
			let prev = i - 1;
			while (prev >= 0 && /\s/.test(src[prev])) prev--;
			const prevWord = src.slice(Math.max(0, prev - 10), prev + 1).match(/[\w$]+$/)?.[0] || '';
			const isTagged = prev >= 0 && /[\w$)\]]/.test(src[prev]) && !/^(?:return|typeof|void|delete|throw|case|in|of)$/.test(prevWord);
			const start = i;
			i++;
			const exprs = [];
			let rawWithPlaceholders = '';
			while (i < n && src[i] !== '`') {
				if (src[i] === '\\') {
					rawWithPlaceholders += src[i] + (src[i + 1] || '');
					i += 2;
				} else if (src[i] === '$' && src[i + 1] === '{') {
					const exprStart = i;
					i += 2;
					let depth = 1;
					while (i < n && depth > 0) {
						if (src[i] === '`') {
							depth = -999;
							break;
						}
						if (src[i] === "'" || src[i] === '"') {
							const q2 = src[i++];
							while (i < n && src[i] !== q2) {
								if (src[i] === '\\') i++;
								i++;
							}
							i++;
						} else if (src[i] === '{') {
							depth++;
							i++;
						} else if (src[i] === '}') {
							depth--;
							i++;
						} else {
							i++;
						}
					}
					if (depth !== 0) {
						rawWithPlaceholders = null;
						break;
					}
					const token = `zbfph${exprs.length}zbf`;
					exprs.push({ token, raw: src.slice(exprStart, i) });
					rawWithPlaceholders += token;
				} else {
					rawWithPlaceholders += src[i++];
				}
			}
			if (i < n && src[i] === '`') {
				i++;
				if (!isTagged && rawWithPlaceholders !== null) {
					results.push({ start, end: i, rawWithPlaceholders, exprs });
				}
			}
		} else {
			i++;
		}
	}
	return results;
}

const inlineCssMinifyPlugin = {
	name: 'inline-css-minify',
	setup(build) {
		build.onLoad({ filter: /[\\/]src[\\/].*\.ts$/ }, async (args) => {
			const src = await fs.promises.readFile(args.path, 'utf8');
			const tpls = extractTemplateLiterals(src);
			if (!tpls.length) return null;
			let changed = false;
			let out = '';
			let last = 0;
			for (const t of tpls) {
				const s = t.rawWithPlaceholders;
				const looksCss = s.length >= 60 && s.includes('{') && s.includes('}') && s.includes(':')
					&& (args.path.includes('style') || s.includes('.zbf-') || s.includes('#zbf-') || s.includes('--zbf-') || s.includes('.selection-popup') || s.includes('@keyframes'));
				if (!looksCss || s.includes('function ') || s.includes('const ')) continue;
				try {
					const res = await esbuild.transform(s, { loader: 'css', minify: true });
					if (res.warnings.length !== 0) continue;
					let min = res.code.trim().replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
					let allSurvived = true;
					for (const ex of t.exprs) {
						const parts = min.split(ex.token);
						if (parts.length !== 2) {
							allSurvived = false;
							break;
						}
						min = parts[0] + ex.raw + parts[1];
					}
					const origLen = t.end - t.start - 2;
					if (allSurvived && min.length < origLen) {
						out += src.slice(last, t.start) + '`' + min + '`';
						last = t.end;
						changed = true;
					}
				} catch { /* keep original template literal if CSS parser rejects it */ }
			}
			if (!changed) return null;
			out += src.slice(last);
			return { contents: out, loader: 'ts' };
		});
	},
};

const sharedOptions = {
	bundle: true,
	format: 'iife',
	target: 'firefox140',
	charset: 'utf8',
	treeShaking: true,
	minifyWhitespace: true,
	minifySyntax: true,
	minifyIdentifiers: false,
	legalComments: 'none',
	plugins: [inlineCssMinifyPlugin],
	define: {
		__BRIDGEFLOW_VERSION__: JSON.stringify(buildVersion),
	},
};

await esbuild.build({
	...sharedOptions,
	entryPoints: [path.join(root, 'src/index.ts')],
	outfile: path.join(root, 'zoterobridgeflow.js'),
	banner: {
		js: `/* Zotero BridgeFlow v${buildVersion} - Unified Reading Workspace, Inspector & Word Citation Tracking for Zotero 10-12. */`,
	},
});

console.log(`zoterobridgeflow.js (v${buildVersion}) bundled successfully.`);

await esbuild.build({
	...sharedOptions,
	entryPoints: [path.join(root, 'src/preferences.ts')],
	outfile: path.join(root, 'zoterobridgeflow_prefs.js'),
	banner: {
		js: `/* Zotero BridgeFlow v${buildVersion} - Preferences controller. */`,
	},
});

console.log(`zoterobridgeflow_prefs.js (v${buildVersion}) bundled successfully.`);
