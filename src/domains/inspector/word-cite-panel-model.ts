import type { PrefKey, PrefValue } from '../../kernel/pref-schema.ts';
import type {
	CitationSnapshotPayload,
	WordInsertResultPayload,
	WordRefreshResultPayload,
	WorkspaceGroupSummary,
} from '../../kernel/types.ts';
import { deduplicateRegularItems, getCachedPrimaryItemFields, normalizeToRegularItem } from '../../services/item-resolution.ts';
import {
	buildOrphanBannerModel,
	type OrphanCardViewModel,
	type OrphanSelectionState,
	type ReceiptState,
} from './word-cite-orphan-model.ts';
import {
	buildMetadataRemindersModel,
	type ReminderCheckScope,
	type ReminderRuleConfig,
	type ReminderSectionViewModel,
	type ReminderUiState,
} from './word-cite-reminders-model.ts';

export function formatInsertReceipt(res: WordInsertResultPayload, zh: boolean): ReceiptState {
	const doc = res.documentName ? (zh ? `「${res.documentName}」` : `"${res.documentName}"`) : 'Word';
	if (res.status === 'inserted') return { tone: 'ok', text: zh ? `✓ 已插入 ${res.itemCount} 篇引文到 ${doc}` : `✓ Inserted ${res.itemCount} citation(s) into ${doc}` };
	if (res.status === 'busy') return { tone: 'warn', text: zh ? '⌛ Word 正在处理引文，请稍候再试' : '⌛ Word is busy updating citations, try again' };
	if (res.status === 'non-word') return { tone: 'warn', text: zh ? '⚠ 当前激活文档不是受支持的 Word 文档' : '⚠ Active document is not a supported Word document' };
	if (res.status === 'cancelled') return { tone: 'warn', text: zh ? 'ⓘ 已取消插入引文' : 'ⓘ Citation insertion cancelled' };
	return { tone: 'err', text: zh ? '✕ 插入失败：请先打开 Word 并确认插件连接正常' : '✕ Unable to insert: verify Word is open and connected' };
}

export function formatRefreshReceipt(res: WordRefreshResultPayload, zh: boolean): ReceiptState {
	const doc = res.documentName ? (zh ? `「${res.documentName}」` : `"${res.documentName}"`) : 'Word';
	if (res.ok) return { tone: 'ok', text: zh ? `↻ 已刷新 ${doc}，并同步序号` : `↻ Refreshed ${doc} citations` };
	return { tone: 'warn', text: zh ? '⚠ 未检测到可刷新的活动 Word 文档' : '⚠ No active Word document to refresh' };
}

export function formatPendingReceipt(kind: 'insert' | 'refresh' | 'recover', zh: boolean): ReceiptState {
	const text = kind === 'insert' ? (zh ? '正在插入 Word 引文…' : 'Inserting Word citations…')
		: kind === 'recover' ? (zh ? '正在单事务还原/重建引文并重连 Word…' : 'Recovering & relinking citations…')
		: (zh ? '正在刷新 Word 引文…' : 'Refreshing Word citations…');
	return { tone: 'warn', text };
}

export function formatIgnoreReminderReceipt(key: string, zh: boolean): ReceiptState {
	return {
		tone: 'ok',
		text: zh ? 'ⓘ 提醒已忽略；条目和 Word 引文未更改' : 'ⓘ Reminder ignored; item and Word citation unchanged',
		headline: zh ? 'ⓘ 已忽略该条信息提醒' : 'ⓘ Metadata reminder ignored',
		subnote: zh ? '条目与 Word 引文未更改' : 'Item & Word citation untouched',
		actions: key ? [{
			kind: 'undo-ignore-reminder',
			label: zh ? '撤销' : 'Undo',
			title: zh ? '立即恢复这条信息完整性提醒' : 'Restore this metadata reminder',
			reminderKey: key,
		}] : undefined,
		stickyUntil: Date.now() + 8_000,
	};
}

export function buildWordCiteSectionSummary(zh: boolean, snap: CitationSnapshotPayload | null, ids: readonly number[]): string {
	if (!snap?.activeSessionID) return '';
	const total = snap.totalCitedCount;
	const orphanSuffix = snap.orphans?.length
		? (zh ? ` · ⚠ ${snap.orphans.length} 缺失` : ` · ⚠ ${snap.orphans.length} missing`)
		: '';
	if (ids.length > 1) return (zh ? `已选 ${ids.length} 篇 · 共引 ${total} 篇` : `${ids.length} selected · ${total} cited`) + orphanSuffix;
	const badge = ids.length === 1 ? snap.byItemID.get(ids[0]) : undefined;
	if (badge) return (zh ? `序号 [${badge.ordinal}] · 共引 ${total} 篇` : `[${badge.ordinal}] · ${total} cited`) + orphanSuffix;
	return (zh ? `未引用 · 共引 ${total} 篇` : `Uncited · ${total} cited`) + orphanSuffix;
}

export interface WordStatStripModel {
	readonly citedValue: string;
	readonly citedLabel: string;
	readonly inTextValue: string;
	readonly inTextLabel: string;
	readonly orphanValue: string;
	readonly orphanLabel: string;
	readonly orphanWarn: boolean;
	readonly tooltip: string;
}

export function buildWordStatStrip(zh: boolean, snap: CitationSnapshotPayload | null): WordStatStripModel {
	if (!snap?.activeSessionID) {
		return {
			citedValue: '—',
			citedLabel: zh ? '已引用文献' : 'Cited Items',
			inTextValue: '—',
			inTextLabel: zh ? '文内引用' : 'In-Text',
			orphanValue: '0',
			orphanLabel: zh ? '待找回' : 'Broken',
			orphanWarn: false,
			tooltip: zh ? '暂未检测到活动 Word 文档会话' : 'No active Word session detected',
		};
	}
	let inTextTotal = 0;
	for (const b of snap.byItemID.values()) {
		inTextTotal += Math.max(1, Number(b.occurrences ?? 1));
	}
	const orphanCount = snap.orphans?.length ?? 0;
	inTextTotal += orphanCount;
	return {
		citedValue: String(snap.totalCitedCount),
		citedLabel: zh ? '已引用文献' : 'Cited Items',
		inTextValue: String(inTextTotal),
		inTextLabel: zh ? '文内引用' : 'In-Text',
		orphanValue: String(orphanCount),
		orphanLabel: zh ? '待找回' : 'Broken',
		orphanWarn: orphanCount > 0,
		tooltip: zh
			? `当前文档共引用 ${snap.totalCitedCount} 篇文献，文内引用 ${inTextTotal} 处${orphanCount > 0 ? `，另有 ${orphanCount} 条断链待找回` : ''}`
			: `${snap.totalCitedCount} cited items, ${inTextTotal} in-text occurrences${orphanCount > 0 ? `, ${orphanCount} broken` : ''}`,
	};
}

export interface CurrentCiteCardDisplay {
	readonly kicker: string;
	readonly badgeText: string;
	readonly badgeCited: boolean;
	readonly title: string;
	readonly submeta: string;
	readonly tooltip: string;
}

export function buildCurrentCiteDisplay(
	zh: boolean,
	snap: CitationSnapshotPayload | null,
	items: readonly any[],
	ids: readonly number[],
): CurrentCiteCardDisplay {
	if (!items.length) {
		return {
			kicker: zh ? '当前选中文献' : 'Selected Item',
			badgeText: '',
			badgeCited: false,
			title: zh ? '请选择文献条目以插入 Word 引文' : 'Select an item to insert a Word citation',
			submeta: '',
			tooltip: '',
		};
	}
	const first = getCachedPrimaryItemFields(items[0]);
	const subParts = [first.creatorYear, first.source].filter(Boolean);
	const submeta = items.length === 1
		? subParts.join(' · ')
		: (zh ? `共选 ${items.length} 篇文献${subParts.length ? ` · 首篇：${subParts.join(' · ')}` : ''}` : `${items.length} selected${subParts.length ? ` · ${subParts.join(' · ')}` : ''}`);
	const title = first.title || (zh ? '未命名文献' : 'Untitled item');

	let badgeText = '';
	let badgeCited = false;
	if (snap?.activeSessionID) {
		if (ids.length === 1) {
			const b = snap.byItemID.get(ids[0]);
			if (b) {
				const occ = b.occurrences ?? 1;
				badgeText = occ > 1 ? (zh ? `[${b.ordinal}] · ${occ}次` : `[${b.ordinal}] · ${occ}×`) : `[${b.ordinal}]`;
				badgeCited = true;
			} else {
				badgeText = zh ? '未引用' : 'Uncited';
			}
		} else if (ids.length > 1) {
			const cited = ids.map((id) => snap.byItemID.get(id)).filter((b): b is NonNullable<typeof b> => Boolean(b)).sort((a, b) => a.ordinal - b.ordinal);
			if (cited.length) {
				badgeText = `[${cited.slice(0, 3).map((b) => b.ordinal).join(', ')}${cited.length > 3 ? '…' : ''}]`;
				badgeCited = true;
			} else {
				badgeText = zh ? `0/${ids.length} 已引` : `0/${ids.length} cited`;
			}
		}
	}

	return {
		kicker: items.length > 1 ? (zh ? `当前已选 ${items.length} 篇文献` : `${items.length} Items Selected`) : (zh ? '当前选中文献' : 'Selected Item'),
		badgeText,
		badgeCited,
		title,
		submeta,
		tooltip: [title, submeta].filter(Boolean).join('\n'),
	};
}

export interface WordCiteViewModel {
	showDocSwitcher: boolean;
	showSummaryCounts: boolean;
	docName: string;
	docStatusText: string;
	docSwitchTitle: string;
	sessionBadgeText: string;
	isMultiSession: boolean;
	hasWordSession: boolean;
	statStrip: WordStatStripModel;
	currentCite: CurrentCiteCardDisplay;
	insertLabel: string;
	insertDisabled: boolean;
	refreshDisabled: boolean;
	refreshTitle: string;
	groupButtonText: string;
	groupButtonTitle: string;
	showCollectionButton: boolean;
	colButtonText: string;
	colButtonTitle: string;
	orphanCard: OrphanCardViewModel;
	orphanDisabled: boolean;
	reminders: ReminderSectionViewModel;
	receipt: ReceiptState;
	zh: boolean;
}

export function assembleWordCiteViewModel(params: {
	zh: boolean;
	snap: CitationSnapshotPayload | null;
	items: readonly any[];
	itemIDs: readonly number[];
	groups: readonly WorkspaceGroupSummary[];
	getPref: <K extends PrefKey>(key: K) => PrefValue<K>;
	sectionEnabled: boolean;
	pending: boolean;
	orphanState: OrphanSelectionState;
	reminderState: ReminderUiState;
	isReminderIgnored: (item: any) => boolean;
	receipt: ReceiptState;
}): { vm: WordCiteViewModel; matchedGroup: WorkspaceGroupSummary | null; summary: string } {
	const {
		zh, snap, items, itemIDs, groups, getPref,
		sectionEnabled, pending, orphanState, reminderState, isReminderIgnored, receipt,
	} = params;
	const hasSession = Boolean(snap?.activeSessionID);
	const sessionCount = snap?.sessions?.length ?? 0;
	const activeSessionIdx = sessionCount >= 2
		? Math.max(0, (snap?.sessions ?? []).findIndex((s) => s.sessionID === snap?.activeSessionID)) + 1
		: 0;
	const idSet = new Set(itemIDs);
	const matchedGroup = getPref('inspector.wordCite.showGroupSynergy') && idSet.size > 0
		? groups.find((g) => g.itemIDs.length >= 2 && g.itemIDs.some((id) => idSet.has(id))) ?? null
		: null;
	const uncitedInGroup = matchedGroup && hasSession ? matchedGroup.itemIDs.filter((id) => !snap!.byItemID.has(id)).length : 0;
	const showSummaryCounts = Boolean(getPref('inspector.wordCite.showSummaryCounts'));
	const summary = showSummaryCounts ? buildWordCiteSectionSummary(zh, snap, itemIDs) : '';
	const tagLabel = String(getPref('wordCite.citationTags.text') || '/Citations').trim() || '/Citations';

	const showOrphanCard = Boolean(getPref('inspector.wordCite.showOrphanRecovery'));
	const rawScope = String(getPref('inspector.wordCite.reminderScope') || 'both');
	const scope: ReminderCheckScope = rawScope === 'wordOnly' || rawScope === 'selectionOnly' ? rawScope : 'both';
	const reminderRules: ReminderRuleConfig = {
		enabled: Boolean(getPref('inspector.wordCite.showMetadataReminders')),
		scope,
		checkCreatorsYear: Boolean(getPref('inspector.wordCite.reminderCheckCreatorsYear')),
		checkVenue: Boolean(getPref('inspector.wordCite.reminderCheckVenue')),
		checkPagination: Boolean(getPref('inspector.wordCite.reminderCheckPagination')),
		showSuggested: Boolean(getPref('inspector.wordCite.reminderShowSuggested')),
		strictOnlineFirst: Boolean(getPref('inspector.wordCite.reminderStrictOnlineFirst')),
	};
	const preReminders = buildMetadataRemindersModel({
		zh,
		snap,
		selectedItems: items,
		isIgnored: isReminderIgnored,
		expanded: reminderState.expanded,
		filter: reminderState.filter,
		rules: reminderRules,
	});
	reminderState.syncAutoExpand(Boolean(getPref('inspector.wordCite.reminderAutoExpand')), preReminders.activeSig);
	const reminders = preReminders.expanded === reminderState.expanded
		? preReminders
		: { ...preReminders, expanded: reminderState.expanded };

	const vm: WordCiteViewModel = {
		zh,
		showDocSwitcher: Boolean(getPref('inspector.wordCite.showDocSwitcher')),
		showSummaryCounts,
		docName: hasSession ? (snap!.activeDocumentName || 'Word') : (zh ? '未连接 Word' : 'No Word session'),
		docStatusText: hasSession
			? (sessionCount >= 2 ? (zh ? `共 ${sessionCount} 个文档` : `${sessionCount} docs`) : (zh ? '实时同步' : 'Live sync'))
			: (zh ? '请先打开 Word 文档' : 'Open a Word document'),
		docSwitchTitle: sessionCount >= 2
			? (zh ? `点击切换目标 Word 文档 (${sessionCount} 个已打开)` : `Switch active Word document (${sessionCount} open)`)
			: (hasSession ? snap!.activeDocumentName : (zh ? '请打开 Word 文档' : 'Open a Word document')),
		sessionBadgeText: sessionCount >= 2 ? `${activeSessionIdx}/${sessionCount}` : '',
		isMultiSession: sessionCount >= 2,
		hasWordSession: hasSession,
		statStrip: buildWordStatStrip(zh, snap),
		currentCite: buildCurrentCiteDisplay(zh, snap, items, itemIDs),
		insertLabel: itemIDs.length > 1 ? (zh ? `合并插入 ${itemIDs.length} 篇引文到 Word` : `Insert ${itemIDs.length} Citations in Word`) : (zh ? '插入到 Word 光标处' : 'Insert at Word Cursor'),
		insertDisabled: pending || itemIDs.length === 0 || !sectionEnabled,
		refreshDisabled: pending || !sectionEnabled,
		refreshTitle: zh ? '刷新当前 Word 文档引文与编号' : 'Refresh Word document & sync ordinals',
		groupButtonText: matchedGroup ? (zh ? `↗ 引用所在分组「${matchedGroup.groupName}」(${matchedGroup.itemIDs.length})` : `↗ Cite Group "${matchedGroup.groupName}" (${matchedGroup.itemIDs.length})`) : '',
		groupButtonTitle: matchedGroup ? (zh ? `将工作区分组「${matchedGroup.groupName}」中的 ${matchedGroup.itemIDs.length} 篇文献合并插入 Word${hasSession ? `（其中 ${uncitedInGroup} 篇尚未引用）` : ''}` : `Insert all ${matchedGroup.itemIDs.length} papers from "${matchedGroup.groupName}"${hasSession ? ` (${uncitedInGroup} uncited)` : ''}`) : '',
		showCollectionButton: Boolean(getPref('inspector.wordCite.showCollectionLink') && hasSession && getPref('wordCite.collections.enable')),
		colButtonText: zh ? `文集 ${tagLabel}` : `Cited ${tagLabel}`,
		colButtonTitle: zh ? '在左侧目录树定位当前文档的已引用文献合集' : 'Reveal temporary Word collection in library tree',
		orphanCard: buildOrphanBannerModel(showOrphanCard ? snap?.orphans : undefined, zh, {
			uncheckedKeys: orphanState.uncheckedKeys,
			expanded: orphanState.expanded,
			accordionOpen: orphanState.accordionOpen,
		}),
		orphanDisabled: pending || !sectionEnabled,
		reminders,
		receipt,
	};
	return { vm, matchedGroup, summary };
}

export function resolveWordCiteTargetItems(win: Window | null, item: any): any[] {
	if (!item) return [];
	const reg = normalizeToRegularItem(item) || item;
	const paneItems: any[] = (win as any)?.ZoteroPane?.getSelectedItems?.() || [];
	const regId = Number(reg?.id || 0);
	const itemId = Number(item?.id || 0);
	if (paneItems.length > 1 && paneItems.some((p) => Number(p?.id || 0) === itemId || (regId > 0 && Number(p?.id || 0) === regId))) {
		return deduplicateRegularItems(paneItems).items;
	}
	return deduplicateRegularItems([reg]).items;
}

export function preloadUnloadedCitedItems(
	citedIDs: readonly number[] | undefined,
	enabled: boolean,
	onLoaded: () => void,
): void {
	if (!citedIDs?.length || !enabled) return;
	const hostItems = (globalThis as any).Zotero?.Items;
	if (typeof hostItems?.get !== 'function' || typeof hostItems?.getAsync !== 'function') return;
	const missing = citedIDs.filter((id) => Number.isSafeInteger(id) && id > 0 && !hostItems.get(id));
	if (!missing.length) return;
	void Promise.resolve(hostItems.getAsync(missing)).then(onLoaded).catch(() => {});
}
