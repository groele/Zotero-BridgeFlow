import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const buildVersion = String(pkg.version || '0.0.1');
const buildTime = new Date().toISOString();

const sharedOptions = {
	bundle: true,
	format: 'iife',
	target: 'firefox140',
	charset: 'utf8',
	treeShaking: true,
	minify: false,
	define: {
		__BRIDGEFLOW_VERSION__: JSON.stringify(buildVersion),
		__BRIDGEFLOW_BUILD_TIME__: JSON.stringify(buildTime),
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
