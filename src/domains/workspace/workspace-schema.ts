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
const progress = v.strictObject({ readSeconds: count, lastPage: v.optional(count), totalPages: v.optional(count) });
const document = v.strictObject({
	version: v.literal(2), groups: v.array(group), collapsed: keys, pinnedKeys: keys,
	sleepingKeys: keys, remarks: strings, remarkModes: v.record(text, remarkMode),
	lastViewedAt: v.record(text, count), readingProgress: v.record(text, progress),
	virtualMembers: v.record(text, virtualMember), sessions: v.array(session), rollingSessions: v.array(session),
});
const backup = v.strictObject({ format: v.literal('zotero-bridgeflow-workspace'), version: v.literal(2), state: document });

export type TabGroup = v.InferOutput<typeof group>;
export type VirtualMemberMeta = v.InferOutput<typeof virtualMember>;
export type WorkspaceSession = v.InferOutput<typeof session>;
export type WorkspaceState = v.InferOutput<typeof document>;
export type RemarkDisplayMode = v.InferOutput<typeof remarkMode>;
export type TabReadingProgress = v.InferOutput<typeof progress>;

export function readWorkspace(raw: string): WorkspaceState {
	return v.parse(document, JSON.parse(raw));
}

export function readBackup(raw: string): WorkspaceState {
	return v.parse(backup, JSON.parse(raw)).state;
}
