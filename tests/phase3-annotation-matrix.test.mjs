import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import path from 'node:path';
import {
	buildAnnotationMatrix,
	matchesAnnotationQuery,
	renderMatrixCsv,
	renderMatrixHtmlNote,
	renderMatrixMarkdown,
	saveMatrixAsZoteroNote,
} from '../src/services/annotation-matrix.ts';
import { openAnnotationMatrixModal } from '../src/domains/visual-notes/hub/annotation-matrix-modal.ts';
import { extractQueryTerms } from '../src/domains/visual-notes/hub/annotation-matrix-ui.ts';
import { resolvePopupButtonColor } from '../src/domains/visual-notes/reader/annotation-popup-labels.ts';
import {
	buildColorLabelsJsonFromInputs,
	initAnnotationColorEditor,
	syncAnnotationColorInputs,
} from '../src/prefs/color-editor.ts';
import { updatePreferenceDependencies } from '../src/prefs/helpers.ts';
import { PREF_SCHEMA } from '../src/kernel/pref-schema.ts';
import { TypedEventBus } from '../src/kernel/event-bus.ts';
import { UnifiedPrefService } from '../src/kernel/pref-service.ts';

function createMemoryPrefs(initial = {}) {
	const map = new Map(Object.entries(initial));
	const adapter = {
		get(key) { return map.get(key); },
		set(key, val) { map.set(key, val); },
		clear(key) { map.delete(key); },
		registerObserver() { return 'obs-1'; },
		unregisterObserver() {},
	};
	return { adapter, prefs: new UnifiedPrefService({ adapter }) };
}

function createFakeMatrixDoc() {
	const byId = new Map();
	const makeEl = (tag) => {
		const attrs = new Map();
		const children = [];
		const listeners = new Map();
		const el = {
			tagName: tag.toUpperCase(),
			_id: '',
			set id(v) { this._id = v; if (v) byId.set(v, el); },
			get id() { return this._id; },
			style: {},
			children,
			value: '',
			checked: false,
			type: '',
			placeholder: '',
			className: '',
			_textContent: '',
			set textContent(v) {
				this._textContent = String(v ?? '');
				if (this._textContent === '') children.length = 0;
			},
			get textContent() { return this._textContent; },
			setAttribute(k, v) { attrs.set(k, String(v)); },
			getAttribute(k) { return attrs.get(k) ?? null; },
			removeAttribute(k) { attrs.delete(k); },
			append(...nodes) { for (const n of nodes) children.push(n); },
			appendChild(n) { children.push(n); return n; },
			remove() { if (this._id) byId.delete(this._id); },
			addEventListener(type, fn) {
				if (!listeners.has(type)) listeners.set(type, []);
				listeners.get(type).push(fn);
			},
			click() { for (const fn of listeners.get('click') || []) fn({ target: this }); },
			dispatch(type) { for (const fn of listeners.get(type) || []) fn({ target: this }); },
			querySelector(sel) {
				if (sel.includes('type="color"')) return children[0] || null;
				if (sel.includes('data-zbf-color')) return children[1] || null;
				return null;
			},
			stopPropagation() {},
		};
		return el;
	};
	const body = makeEl('body');
	const head = makeEl('head');
	return {
		head,
		body,
		documentElement: body,
		getElementById(id) { return byId.get(id) || null; },
		querySelectorAll() { return []; },
		createElementNS(_ns, tag) { return makeEl(tag); },
	};
}

test('Phase 3: annotation boolean query && / || and matrix Markdown/CSV/HTML/Note export', async () => {
	const annSample = {
		itemID: 1,
		itemTitle: 'RAG Survey',
		creatorYear: 'Lewis 2020',
		annotationID: 11,
		color: '#ff6666',
		colorLabel: '方法',
		text: 'Dense retrieval with FAISS index',
		comment: '对照稀疏检索有优势',
		pageLabel: '4',
		tags: ['方法/检索'],
	};
	assert.equal(matchesAnnotationQuery(annSample, 'dense && faiss'), true);
	assert.equal(matchesAnnotationQuery(annSample, 'dense && missing'), false);
	assert.equal(matchesAnnotationQuery(annSample, 'missing || 稀疏检索'), true);

	const att1 = {
		id: 101,
		deleted: false,
		getAnnotations: () => [
			{ id: 1, deleted: false, annotationColor: '#ff6666', annotationText: 'Dual encoder', annotationComment: 'Fast', annotationPageLabel: '3' },
			{ id: 2, deleted: false, annotationColor: '#5fb236', annotationText: 'High memory', annotationComment: '', annotationPageLabel: '7' },
		],
	};
	const att2 = {
		id: 201,
		deleted: false,
		getAnnotations: () => [
			{ id: 3, deleted: false, annotationColor: '#ff6666', annotationText: 'BM25 baseline', annotationComment: '', annotationPageLabel: '2' },
		],
	};
	const item1 = {
		id: 100,
		deleted: false,
		firstCreator: 'Karpukhin',
		getField: (f) => (f === 'title' ? 'DPR' : f === 'year' ? '2020' : ''),
		getAttachments: () => [101],
	};
	const item2 = {
		id: 200,
		deleted: false,
		firstCreator: 'Robertson',
		getField: (f) => (f === 'title' ? 'BM25' : f === 'year' ? '2009' : ''),
		getAttachments: () => [201],
	};

	const savedNotes = [];
	globalThis.Zotero = {
		Items: { get: (id) => ({ 100: item1, 101: att1, 200: item2, 201: att2 }[id] || null) },
		Libraries: { userLibraryID: 1 },
		Item: class {
			constructor(type) { this.type = type; this.id = 777; }
			setNote(html) { this.html = html; }
			async saveTx() { savedNotes.push(this); return this.id; }
		},
	};

	const matrix = buildAnnotationMatrix([item1, item2], '', {});
	assert.deepEqual(matrix.columns, ['Method', 'Gap']);
	assert.equal(matrix.rows.length, 2);
	assert.equal(matrix.totalAnnotations, 3);

	const md = renderMatrixMarkdown(matrix, '检索对比');
	assert.match(md, /\| 文献 \| Method \| Gap \|/);
	assert.match(md, /\[p\.3\] Dual encoder（评注：Fast）/);

	const csv = renderMatrixCsv(matrix);
	assert.match(csv, /文献,作者年份,Method,Gap/);
	assert.match(csv, /DPR,Karpukhin 2020/);

	const html = renderMatrixHtmlNote(matrix, '检索对比');
	assert.match(html, /<table>/);
	const noteID = await saveMatrixAsZoteroNote(matrix, '检索对比');
	assert.equal(noteID, 777);
	assert.equal(savedNotes.length, 1);

	delete globalThis.Zotero;
});

test('Phase 3: openAnnotationMatrixModal renders interactive matrix and dispatches Word batch insert', () => {
	const att = {
		id: 301,
		deleted: false,
		getAnnotations: () => [
			{ id: 10, deleted: false, annotationColor: '#2ea8e5', annotationText: 'Key insight', annotationComment: '', annotationPageLabel: '5' },
		],
	};
	const item = {
		id: 300,
		deleted: false,
		firstCreator: 'Zhang',
		isAttachment: () => false,
		getAnnotations: () => { throw new Error('getAnnotations() can only be called on file attachments'); },
		getField: (f) => (f === 'title' ? 'BridgeFlow Paper' : f === 'year' ? '2026' : ''),
		getAttachments: () => [301],
	};
	globalThis.Zotero = {
		Items: { get: (id) => (id === 300 ? item : id === 301 ? att : null) },
	};

	const doc = createFakeMatrixDoc();
	const win = { document: doc };
	const bus = new TypedEventBus();
	const wordRequests = [];
	bus.on('word:insert-items-request', (req) => wordRequests.push(req));
	const { prefs } = createMemoryPrefs({ 'modules.wordCite.enable': true });

	openAnnotationMatrixModal({ win, title: '测试分组', itemIDs: [300], prefs, bus });

	const backdrop = doc.getElementById('zbf-matrix-backdrop');
	assert.ok(backdrop);
	// Find "合并插入 Word" button in modal footer and click it
	const dialog = backdrop.children[0];
	const foot = dialog.children[3];
	const actions = foot.children[1];
	const wordBtn = actions.children.find((b) => b.textContent === '合并插入 Word');
	assert.ok(wordBtn);
	wordBtn.click();
	assert.equal(wordRequests.length, 1);
	assert.deepEqual(wordRequests[0].itemIDs, [300]);
	const input = dialog.children[1].children[0].children[0];
	input.value = 'missing annotation';
	input.dispatch('input');
	wordBtn.click();
	assert.equal(wordRequests.length, 1, 'immediate Word insertion must use the latest filter');

	delete globalThis.Zotero;
});

test('Phase 3: Settings page color editor, dependency isolation, and prefs.js completeness', () => {
	// 1. Verify prefs.js covers all user-facing PREF_SCHEMA keys
	const prefsJs = fs.readFileSync(path.resolve(process.cwd(), 'prefs.js'), 'utf8');
	const runtimeOnly = new Set(['workspace.document', 'workspace.verticalSidebarCollapsed']);
	const missingInPrefsJs = Object.keys(PREF_SCHEMA).filter(
		(k) => !runtimeOnly.has(k) && !prefsJs.includes(`"extensions.zotero.bridgeflow.${k}"`),
	);
	assert.deepEqual(missingInPrefsJs, [], `Missing in prefs.js: ${missingInPrefsJs.join(', ')}`);

	// 2. Verify visual color editor syncs directly and preserves active focus while editing
	const doc = createFakeMatrixDoc();
	const grid = doc.createElementNS('', 'div');
	grid.id = 'zbf-ann-color-grid';
	Object.defineProperty(grid, 'childElementCount', { get() { return grid.children.length; } });
	grid.querySelectorAll = (sel) => {
		if (sel.includes('zbf-color-label-item')) return grid.children;
		if (sel.includes('data-zbf-color')) return grid.children.map((row) => row.children[1]).filter(Boolean);
		return [];
	};
	doc.body.append(grid);

	const { prefs } = createMemoryPrefs();
	let savedCalls = 0;
	initAnnotationColorEditor(doc, prefs, () => { savedCalls++; });
	assert.equal(grid.children.length, 8);
	const firstSwatch = grid.children[0].children[0];
	const firstColorInput = grid.children[0].children[1];
	doc.activeElement = firstColorInput;
	firstColorInput.value = '';
	firstColorInput.dispatch('input');
	syncAnnotationColorInputs(doc, '');
	assert.equal(firstColorInput.value, '', 'active input must not snap back mid-typing');
	firstColorInput.value = '研究背景';
	firstColorInput.dispatch('change');
	assert.equal(savedCalls, 2);
	assert.match(prefs.get('inspector.annotations.colorLabels'), /"#ffd400":"研究背景"/);

	firstSwatch.value = '#e11d48';
	firstSwatch.dispatch('change');
	const slotSaved = prefs.get('inspector.annotations.colorLabels');
	assert.match(slotSaved, /\["#e11d48","研究背景"\]/);

	const thirdSwatch = grid.children[2].children[0];
	const thirdInput = grid.children[2].children[1];
	thirdSwatch.value = '#06b6d4';
	thirdSwatch.dispatch('change');
	thirdInput.value = '核心局限';
	thirdInput.dispatch('change');
	const multiSlotSaved = prefs.get('inspector.annotations.colorLabels');
	syncAnnotationColorInputs(doc, multiSlotSaved);
	assert.equal(grid.children[2].children[0].value, '#06b6d4');
	assert.equal(grid.children[2].children[1].value, '核心局限');

	// Verify rgb(...) SVG fill color resolution for reader selection popup labels
	const fakeRgbBtn = {
		style: { backgroundColor: 'rgb(255, 212, 0)' },
		querySelector: () => null,
	};
	assert.equal(resolvePopupButtonColor(fakeRgbBtn, 0), '#ffd400');

	doc.activeElement = null;
	syncAnnotationColorInputs(doc, '');
	assert.equal(firstColorInput.value, 'Context');
	assert.equal(firstSwatch.value, '#ffd400');
	assert.equal(buildColorLabelsJsonFromInputs(grid.querySelectorAll('data-zbf-color')), '');

	// 3. Verify updatePreferenceDependencies keeps annotation card enabled when pdfPreview is disabled
	const subtree = (id) => {
		const el = doc.createElementNS('', 'div');
		el.id = id;
		el.querySelectorAll = () => [];
		return el;
	};
	const subPdf = subtree('zbf-sub-pdf-preview');
	const cardAnn = subtree('zbf-card-annotations');
	const subRemark = subtree('zbf-sub-remark-cfg');
	const subHeat = subtree('zbf-sub-reading-heatmap');
	const btnMatrix = subtree('zbf-btn-open-matrix');
	doc.body.append(subPdf, cardAnn, subRemark, subHeat, btnMatrix);

	prefs.set('modules.inspector.enable', true);
	prefs.set('modules.visualNotes.enable', true);
	prefs.set('inspector.pdfPreview.enable', false);
	prefs.set('workspace.enableTabRemarks', false);
	prefs.set('workspace.readingTitleHeatmap.enable', false);
	prefs.set('workspace.enableAnnotationMatrix', false);
	updatePreferenceDependencies(doc, prefs);

	assert.equal(subPdf.getAttribute('data-disabled'), 'true');
	assert.equal(cardAnn.getAttribute('data-disabled'), 'false');
	assert.equal(subRemark.getAttribute('data-disabled'), 'true');
	assert.equal(subHeat.getAttribute('data-disabled'), 'true');
	assert.equal(btnMatrix.getAttribute('disabled'), 'true');

	// 4. Verify matrix query term extraction
	assert.deepEqual(extractQueryTerms('方法 && 对照 || 不足'), ['方法', '对照', '不足']);
	assert.deepEqual(extractQueryTerms('a && Alpha || BETA'), ['alpha', 'beta']);
});
