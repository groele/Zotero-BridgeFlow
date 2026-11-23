export type { TabGroup, VirtualMemberMeta, WorkspaceSession, WorkspaceState, RemarkDisplayMode, TabReadingProgress } from './workspace-schema.ts';

export interface TrackedTab {
	tabID: string;
	key: string;
	type: string;
	itemID: number;
	parentItemID: number;
	title: string;
	shortTitle: string;
	filename: string;
	source: string;
	creatorYear: string;
	collection: string;
	groupId: string;
	pinned: boolean;
	sleeping: boolean;
	virtual: boolean;
	remark: string;
	lastViewedAt: number;
}

export interface TabCloseOptions {
	preserveVirtual?: boolean;
	protectPinned?: boolean;
	protectSelected?: boolean;
	protectMedia?: boolean;
}

export const GROUP_PALETTE = [
	'#2563EB', '#0D9488', '#D97706', '#DC2626',
	'#7C3AED', '#DB2777', '#059669', '#4F46E5',
] as const;

export const MAX_REMARK_LENGTH = 300;
export const MAX_ROLLING_SESSIONS = 3;
export const MAX_MANUAL_SESSIONS = 30;
