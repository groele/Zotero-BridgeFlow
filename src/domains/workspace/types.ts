export interface TabGroup {
	id: string;
	name: string;
	color: string;
	memberKeys: string[];
}

export interface VirtualMemberMeta {
	key: string;
	itemID: number;
	parentItemID?: number;
	title: string;
	shortTitle?: string;
	filename?: string;
	source?: string;
	creatorYear?: string;
	collection?: string;
	type: string;
}

export interface WorkspaceSession {
	id: string;
	name: string;
	createdAt: number;
	isTemplate?: boolean;
	kind?: 'manual' | 'template' | 'rolling' | 'pre-replace';
	groups: TabGroup[];
	pinnedKeys: string[];
	remarks: Record<string, string>;
}

export type RemarkDisplayMode = 'both' | 'remark' | 'title';

export interface TabReadingProgress {
	readSeconds: number;
	lastPage?: number;
	totalPages?: number;
}

export interface WorkspaceState {
	version: number;
	groups: TabGroup[];
	collapsed: string[];
	pinnedKeys: string[];
	sleepingKeys: string[];
	remarks: Record<string, string>;
	remarkModes: Record<string, RemarkDisplayMode>;
	lastViewedAt: Record<string, number>;
	readingProgress: Record<string, TabReadingProgress>;
	virtualMembers: Record<string, VirtualMemberMeta>;
	sessions: WorkspaceSession[];
	rollingSessions: WorkspaceSession[];
}

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
