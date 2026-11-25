import type { CitationSnapshotPayload } from '../../kernel/types.ts';
import {
	formatCreatorYear,
	normalizeToRegularItem,
	safeGetItemField,
} from '../../services/item-resolution.ts';
import { buildReminderItemKeys } from '../../services/metadata-reminders-cache.ts';
import {
	DEFAULT_REMINDER_RULE_CONFIG,
	formatReminderItemType,
	inspectItemMetadataFields,
	resolveZoteroItemType,
	type ReminderCheckScope,
	type ReminderFieldBadge,
	type ReminderRuleConfig,
} from './word-cite-reminder-rules.ts';

export {
	DEFAULT_REMINDER_RULE_CONFIG,
	formatReminderItemType,
	inspectItemMetadataFields,
	resolveZoteroItemType,
	type ReminderCheckScope,
	type ReminderFieldBadge,
	type ReminderRuleConfig,
};

export interface ReminderItemRecord {
	readonly itemID: number;
	readonly cacheKey: string;
	readonly itemType: string;
	readonly itemTypeLabel: string;
	readonly title: string;
	readonly creatorYear: string;
	readonly sourceKind: 'word' | 'selection';
	readonly ordinal?: number;
	readonly sourceLabel: string;
	readonly fields: readonly ReminderFieldBadge[];
	readonly ignored: boolean;
}

export interface ReminderSectionViewModel {
	readonly visible: boolean;
	readonly expanded: boolean;
	readonly filter: 'active' | 'ignored';
	readonly checkedCount: number;
	readonly activeCount: number;
	readonly ignoredCount: number;
	readonly activeSig: string;
	readonly headerBadge: string;
	readonly headerBadgeTone: 'warn' | 'ok' | 'neutral';
	readonly headerTitle: string;
	readonly headerActionHint: string;
	readonly activeTabLabel: string;
	readonly ignoredTabLabel: string;
	readonly scopeHint: string;
	readonly emptyText: string;
	readonly rows: readonly ReminderItemRecord[];
}

export function buildMetadataRemindersModel(options: {
	zh: boolean;
	snap: CitationSnapshotPayload | null;
	selectedItems: readonly any[];
	isIgnored: (item: any) => boolean;
	expanded: boolean;
	filter: 'active' | 'ignored';
	rules: ReminderRuleConfig;
}): ReminderSectionViewModel {
	const { zh, snap, selectedItems, isIgnored, expanded, filter, rules } = options;
	if (!rules.enabled) {
		return {
			visible: false, expanded: false, filter, checkedCount: 0, activeCount: 0, ignoredCount: 0, activeSig: '',
			headerBadge: '0', headerBadgeTone: 'neutral', headerTitle: '', headerActionHint: '',
			activeTabLabel: '', ignoredTabLabel: '', scopeHint: '', emptyText: '', rows: [],
		};
	}

	const hostItems = (globalThis as any).Zotero?.Items;
	const candidates: Array<{ item: any; sourceKind: 'word' | 'selection'; ordinal?: number }> = [];
	const seenIDs = new Set<number>();
	const includeWord = rules.scope === 'both' || rules.scope === 'wordOnly';
	const includeSelection = rules.scope === 'both' || rules.scope === 'selectionOnly';

	if (includeWord && snap?.activeSessionID && snap.byItemID.size > 0 && typeof hostItems?.get === 'function') {
		const sortedBadges = [...snap.byItemID.values()].sort((a, b) => a.ordinal - b.ordinal);
		for (const badge of sortedBadges) {
			const it = normalizeToRegularItem(hostItems.get(badge.itemID));
			const id = Number(it?.id || 0);
			if (!it || id <= 0 || seenIDs.has(id)) continue;
			seenIDs.add(id);
			candidates.push({ item: it, sourceKind: 'word', ordinal: badge.ordinal });
		}
	}

	if (includeSelection) {
		for (const sel of selectedItems) {
			const it = normalizeToRegularItem(sel);
			const id = Number(it?.id || 0);
			if (!it || id <= 0 || seenIDs.has(id)) continue;
			seenIDs.add(id);
			const wordBadge = snap?.activeSessionID ? snap.byItemID.get(id) : undefined;
			candidates.push({
				item: it,
				sourceKind: wordBadge ? 'word' : 'selection',
				ordinal: wordBadge?.ordinal,
			});
		}
	}

	const allRecords: ReminderItemRecord[] = [];
	for (const cand of candidates) {
		const fields = inspectItemMetadataFields(cand.item, zh, rules, { isCitedInWord: cand.sourceKind === 'word' });
		if (!fields) continue;
		const itemID = Number(cand.item.id);
		const { primary } = buildReminderItemKeys(cand.item);
		const cacheKey = primary || `item:${itemID}`;
		const rawType = resolveZoteroItemType(cand.item);
		const title = safeGetItemField(cand.item, 'title').trim() || (zh ? `未命名条目 #${itemID}` : `Untitled #${itemID}`);
		const sourceLabel = cand.sourceKind === 'word'
			? (zh ? '当前文档' : 'Active doc')
			: (zh ? '当前选择' : 'Selected');
		allRecords.push({
			itemID, cacheKey, itemType: rawType, itemTypeLabel: formatReminderItemType(rawType, zh),
			title, creatorYear: formatCreatorYear(cand.item), sourceKind: cand.sourceKind,
			ordinal: cand.ordinal, sourceLabel, fields, ignored: isIgnored(cand.item),
		});
	}

	const activeRows = allRecords.filter((r) => !r.ignored);
	const ignoredRows = allRecords.filter((r) => r.ignored);
	const activeCount = activeRows.length;
	const ignoredCount = ignoredRows.length;
	const checkedCount = candidates.length;
	const effectiveFilter = filter === 'ignored' ? 'ignored' : 'active';
	const rows = effectiveFilter === 'ignored' ? ignoredRows : activeRows;
	const activeSig = activeRows.map((r) => r.cacheKey).join('|');
	const hasWordSession = Boolean(snap?.activeSessionID);
	const hasWordActive = activeRows.some((r) => r.sourceKind === 'word');

	let headerBadge = '!';
	let headerBadgeTone: 'warn' | 'ok' | 'neutral' = 'neutral';
	let headerTitle: string;
	if (activeCount > 0) {
		headerBadge = '!';
		headerBadgeTone = 'warn';
		headerTitle = hasWordActive || hasWordSession
			? (zh ? `${activeCount} 篇引用文献信息待补全` : `${activeCount} cited item(s) incomplete`)
			: (zh ? `${activeCount} 篇所选文献信息待补全` : `${activeCount} selected item(s) incomplete`);
	} else if (ignoredCount > 0) {
		headerBadge = String(ignoredCount);
		headerTitle = zh ? `文献信息提醒 · 已忽略 ${ignoredCount} 篇` : `Metadata reminders · ${ignoredCount} ignored`;
	} else if (checkedCount > 0) {
		headerBadge = '✓';
		headerBadgeTone = 'ok';
		headerTitle = hasWordSession && includeWord
			? (zh ? `${checkedCount} 篇引用文献著录均完整` : `All ${checkedCount} cited items complete`)
			: (zh ? '当前所选文献著录完整' : 'Selected item metadata complete');
	} else {
		headerBadge = '0';
		headerTitle = zh ? '引用文献信息提醒' : 'Citation metadata reminders';
	}

	const scopeDescZh = rules.scope === 'wordOnly' ? '当前 Word 引用文献' : rules.scope === 'selectionOnly' ? '当前所选条目' : '当前文档引用与所选条目';
	const scopeDescEn = rules.scope === 'wordOnly' ? 'active Word citations' : rules.scope === 'selectionOnly' ? 'selected items' : 'cited & selected items';

	return {
		visible: true,
		expanded,
		filter: effectiveFilter,
		checkedCount,
		activeCount,
		ignoredCount,
		activeSig,
		headerBadge,
		headerBadgeTone,
		headerTitle,
		headerActionHint: !expanded && activeCount > 0 ? (zh ? '查看' : 'View') : '',
		activeTabLabel: zh ? `待处理 ${activeCount}` : `Active ${activeCount}`,
		ignoredTabLabel: zh ? `已忽略 ${ignoredCount}` : `Ignored ${ignoredCount}`,
		scopeHint: zh
			? `范围：${scopeDescZh}；点击条目定位并在「信息」页补全`
			: `Scope: ${scopeDescEn}; click item to locate and complete in Info`,
		emptyText: effectiveFilter === 'ignored'
			? (zh ? '暂无已忽略的条目提醒。' : 'No ignored reminders.')
			: ignoredCount > 0
				? (zh ? '没有待处理提醒，可在「已忽略」中恢复。' : 'No active reminders. Switch to Ignored to restore.')
				: checkedCount > 0
					? (zh ? `✓ 已检查 ${checkedCount} 篇文献，核心著录字段均完整。` : `✓ All ${checkedCount} checked item(s) have complete metadata.`)
					: (zh ? '连接 Word 文档或选择文献后将自动检查著录完整性。' : 'Connect a Word document or select an item to check metadata.'),
		rows,
	};
}

export class ReminderUiState {
	public expanded = false;
	public filter: 'active' | 'ignored' = 'active';
	public lastUndoKey: string | null = null;
	private autoOpenedSig = '';

	reset(): void {
		this.expanded = false;
		this.filter = 'active';
		this.lastUndoKey = null;
		this.autoOpenedSig = '';
	}

	syncAutoExpand(autoExpand: boolean, activeSig: string): void {
		if (!activeSig) {
			this.autoOpenedSig = '';
			return;
		}
		if (autoExpand && this.autoOpenedSig !== activeSig) {
			this.autoOpenedSig = activeSig;
			this.expanded = true;
		}
	}
}
