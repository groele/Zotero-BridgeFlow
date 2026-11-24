import * as v from 'valibot';

const text = v.string();
const keys = v.array(text);
const optionalText = v.optional(text);
const count = v.pipe(v.number(), v.minValue(0));
const strings = v.record(text, text);
const group = v.strictObject({ id: text, name: text, color: text, memberKeys: keys });
const virtualMember = v.strictObject({
	key: text, itemID: count, parentItemID: v.optional(count), title: text, shortTitle: optionalText,
	filename: optionalText, source: optionalText, creatorYear: optionalText, collection: optionalText, type: text,
});
const remarkMode = v.picklist(['both', 'remark', 'title']);
const session = v.strictObject({
	id: text, name: text, createdAt: count, isTemplate: v.optional(v.boolean()), scopedGroupId: optionalText,
	kind: v.optional(v.picklist(['manual', 'template', 'rolling', 'pre-replace'])),
	groups: v.array(group), pinnedKeys: keys, openKeys: keys, remarks: strings,
	collapsed: keys, virtualMembers: v.record(text, virtualMember), remarkModes: v.record(text, remarkMode),
});
const progress = v.strictObject({
	readSeconds: count,
	lastPage: v.optional(count),
	totalPages: v.optional(count),
	pageSeconds: v.optional(v.record(text, count)),
});
const document = v.strictObject({
	version: v.literal(2), groups: v.array(group), collapsed: keys, pinnedKeys: keys,
	sleepingKeys: keys, remarks: strings, remarkModes: v.record(text, remarkMode),
	lastViewedAt: v.record(text, count), readingProgress: v.record(text, progress),
	virtualMembers: v.record(text, virtualMember), sessions: v.array(session), rollingSessions: v.array(session),
});
const backup = v.strictObject({ format: v.literal('zotero-bridgeflow-workspace'), version: v.literal(2), state: document });
const readingNotesDocument = v.strictObject({
	remarks: strings,
	remarkModes: v.record(text, remarkMode),
	lastViewedAt: v.record(text, count),
	readingProgress: v.record(text, progress),
});
const readingNotesBackup = v.strictObject({
	format: v.literal('zotero-bridgeflow-reading-notes'),
	version: v.literal(1),
	state: readingNotesDocument,
});

const readingProgressDocument = v.strictObject({
	lastViewedAt: v.record(text, count),
	readingProgress: v.record(text, progress),
});
const readingProgressBackup = v.strictObject({
	format: v.literal('zotero-bridgeflow-reading-progress'),
	version: v.literal(1),
	state: readingProgressDocument,
});
const briefNotesDocument = v.strictObject({
	remarks: strings,
	remarkModes: v.record(text, remarkMode),
});
const briefNotesBackup = v.strictObject({
	format: v.literal('zotero-bridgeflow-brief-notes'),
	version: v.literal(1),
	state: briefNotesDocument,
});

export type TabGroup = v.InferOutput<typeof group>;
export type VirtualMemberMeta = v.InferOutput<typeof virtualMember>;
export type WorkspaceSession = v.InferOutput<typeof session>;
export type WorkspaceState = v.InferOutput<typeof document>;
export type ReadingNotesState = v.InferOutput<typeof readingNotesDocument>;
export type ReadingProgressState = v.InferOutput<typeof readingProgressDocument>;
export type BriefNotesState = v.InferOutput<typeof briefNotesDocument>;
export type RemarkDisplayMode = v.InferOutput<typeof remarkMode>;
export type TabReadingProgress = v.InferOutput<typeof progress>;

export function readWorkspace(raw: string): WorkspaceState {
	return v.parse(document, JSON.parse(raw));
}

export function readBackup(raw: string): WorkspaceState {
	return v.parse(backup, JSON.parse(raw)).state;
}

export function readReadingNotesBackup(raw: string): ReadingNotesState {
	return v.parse(readingNotesBackup, JSON.parse(raw)).state;
}

export function readReadingProgressBackup(raw: string): ReadingProgressState {
	return v.parse(readingProgressBackup, JSON.parse(raw)).state;
}

export function readBriefNotesBackup(raw: string): BriefNotesState {
	return v.parse(briefNotesBackup, JSON.parse(raw)).state;
}

export function pickWorkspaceLayoutState(state: WorkspaceState): WorkspaceState {
	return {
		version: 2,
		groups: state.groups,
		collapsed: state.collapsed,
		pinnedKeys: state.pinnedKeys,
		sleepingKeys: state.sleepingKeys,
		remarks: {},
		remarkModes: {},
		lastViewedAt: {},
		readingProgress: {},
		virtualMembers: state.virtualMembers,
		sessions: state.sessions,
		rollingSessions: state.rollingSessions,
	};
}

export function pickReadingNotesState(state: Pick<WorkspaceState, 'remarks' | 'remarkModes' | 'lastViewedAt' | 'readingProgress'>): ReadingNotesState {
	return {
		remarks: state.remarks || {},
		remarkModes: state.remarkModes || {},
		lastViewedAt: state.lastViewedAt || {},
		readingProgress: state.readingProgress || {},
	};
}

export function pickReadingProgressState(state: Pick<WorkspaceState, 'lastViewedAt' | 'readingProgress'>): ReadingProgressState {
	return {
		lastViewedAt: state.lastViewedAt || {},
		readingProgress: state.readingProgress || {},
	};
}

export function pickBriefNotesState(state: Pick<WorkspaceState, 'remarks' | 'remarkModes'>): BriefNotesState {
	return {
		remarks: state.remarks || {},
		remarkModes: state.remarkModes || {},
	};
}

export function hasLegacyReadingNotes(state: Partial<WorkspaceState> | null | undefined): boolean {
	if (!state) return false;
	return Boolean(
		Object.keys(state.remarks || {}).length
		|| Object.keys(state.remarkModes || {}).length
		|| Object.keys(state.lastViewedAt || {}).length
		|| Object.keys(state.readingProgress || {}).length,
	);
}
