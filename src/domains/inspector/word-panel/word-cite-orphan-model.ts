import type { OrphanCitationInfo, WordRecoverOrphansResultPayload } from '../../../kernel/types.ts';

export interface ReceiptChip {
	readonly text: string;
	readonly variant: 'ok' | 'info' | 'warn';
}

export interface ReceiptAction {
	readonly kind: 'locate-recovered' | 'refresh-word' | 'undo-ignore-reminder';
	readonly label: string;
	readonly title: string;
	readonly itemIDs?: readonly number[];
	readonly sessionID?: string;
	readonly reminderKey?: string;
}

export interface ReceiptState {
	readonly text: string;
	readonly tone: 'ok' | 'warn' | 'err' | 'none';
	readonly headline?: string;
	readonly chips?: readonly ReceiptChip[];
	readonly subnote?: string;
	readonly actions?: readonly ReceiptAction[];
	readonly stickyUntil?: number;
}

export interface OrphanRowViewModel {
	readonly key: string;
	readonly ordinal: number;
	readonly title: string;
	readonly tooltip: string;
	readonly authorYear: string;
	readonly tagText: string;
	readonly tagVariant: 'trash' | 'rebuild' | 'unrec';
	readonly recoverable: boolean;
	readonly checked: boolean;
}

export interface OrphanCardViewModel {
	readonly visible: boolean;
	readonly accordionOpen: boolean;
	readonly countBadge: string;
	readonly title: string;
	readonly shortTitle: string;
	readonly listText: string;
	readonly summaryChips: ReadonlyArray<{ text: string; variant: 'trash' | 'rebuild' | 'unrec' }>;
	readonly showToggle: boolean;
	readonly toggleLabel: string;
	readonly rows: readonly OrphanRowViewModel[];
	readonly footHint: string;
	readonly buttonLabel: string;
	readonly buttonTooltip: string;
	readonly buttonDisabled: boolean;
}

export function isOrphanRecoverable(orphan: OrphanCitationInfo): boolean {
	if (orphan.kind === 'trashed' && Boolean(orphan.itemID)) return true;
	const data = orphan.itemData;
	if (!data || typeof data !== 'object') return false;
	const hasCreators = [data.author, data.editor, data.translator].some((arr) => Array.isArray(arr) && Array.isArray(arr) && arr.length > 0);
	return Boolean(
		String(data.title || '').trim()
		|| String(data['container-title'] || '').trim()
		|| String(data.DOI || '').trim()
		|| String(data.URL || '').trim()
		|| String(data.ISBN || '').trim()
		|| hasCreators,
	);
}

export function formatRecoverReceipt(res: WordRecoverOrphansResultPayload, zh: boolean): ReceiptState {
	if (res.error) return { tone: 'err', text: res.error };
	const {
		restoredCount, importedCount, skippedCount, ambiguousCount = 0,
		existingCount = 0, relinkedCount = 0, foreignSkippedCount = 0,
		refreshed, recoveredItemIDs, sessionID, collectionName,
	} = res;
	const totalRecovered = restoredCount + importedCount + existingCount;
	if (!totalRecovered) {
		return {
			tone: 'warn',
			text: ambiguousCount
				? (zh ? `有 ${ambiguousCount} 篇引文对应多条文库记录，请核对后重试。` : `${ambiguousCount} citation(s) matched multiple library items. Review the matches and retry.`)
				: (zh ? '⚠ 未能恢复缺失引文（缺少可用备份元数据）' : '⚠ No orphan citations could be recovered (missing embedded metadata)'),
		};
	}

	const parts: string[] = [];
	const chips: ReceiptChip[] = [];
	if (restoredCount > 0) {
		parts.push(zh ? `已从回收站还原 ${restoredCount} 篇` : `Restored ${restoredCount} from Trash`);
		chips.push({ text: zh ? `回收站还原 ${restoredCount} 篇` : `Trash ${restoredCount}`, variant: 'ok' });
	}
	if (importedCount > 0) {
		parts.push(zh ? `已反向导入 ${importedCount} 篇` : `Imported ${importedCount}`);
		chips.push({ text: zh ? `备份重建 ${importedCount} 篇` : `Rebuilt ${importedCount}`, variant: 'info' });
	}
	if (existingCount > 0) {
		parts.push(zh ? `已复用库内匹配文献 ${existingCount} 篇` : `Matched ${existingCount} existing item(s)`);
		chips.push({ text: zh ? `复用已有 ${existingCount} 篇` : `Matched ${existingCount}`, variant: 'info' });
	}
	if (refreshed) {
		parts.push(zh ? '已执行 Word 刷新，请核对文内引文' : 'Word refreshed; verify the document citations');
		chips.push({ text: zh ? '↻ Word 已刷新' : '↻ Word Refreshed', variant: 'ok' });
	} else if (relinkedCount > 0) {
		parts.push(zh ? '请在目标 Word 文档刷新并核对引文' : 'click Refresh in Word to relink');
		chips.push({ text: zh ? '待刷新重连 Word' : 'Needs Word Refresh', variant: 'warn' });
	}
	if (foreignSkippedCount > 0) {
		parts.push(zh ? `${foreignSkippedCount} 篇外部账号引文未写跨库映射` : `${foreignSkippedCount} external URI(s) skipped`);
		chips.push({ text: zh ? `外部账号隔离 ${foreignSkippedCount} 篇` : `External ${foreignSkippedCount}`, variant: 'warn' });
	}
	if (ambiguousCount > 0) {
		chips.push({ text: zh ? `候选不唯一 ${ambiguousCount} 篇` : `Ambiguous ${ambiguousCount}`, variant: 'warn' });
	}
	if (skippedCount > ambiguousCount) {
		parts.push(zh ? `跳过 ${skippedCount} 篇` : `skipped ${skippedCount}`);
		chips.push({ text: zh ? `其他跳过 ${skippedCount - ambiguousCount} 篇` : `Other skipped ${skippedCount - ambiguousCount}`, variant: 'warn' });
	}

	const actions: ReceiptAction[] = [];
	if (!refreshed && relinkedCount > 0) {
		actions.push({
			kind: 'refresh-word',
			label: zh ? '↻ 立即刷新 Word' : '↻ Refresh Word',
			title: zh ? '立即执行 Zotero 官方刷新，将恢复的文献重新连接回当前 Word 文档' : 'Run Zotero Refresh now to relink recovered items in Word',
			sessionID,
		});
	}
	if (recoveredItemIDs?.length) {
		actions.push({
			kind: 'locate-recovered',
			label: zh ? `定位查看 (${recoveredItemIDs.length}) ↗` : `Locate (${recoveredItemIDs.length}) ↗`,
			title: zh ? '在文库列表中定位并高亮刚刚找回的文献（便于核对或补抓 PDF）' : 'Select and reveal the recovered items in your Zotero library',
			itemIDs: recoveredItemIDs,
			sessionID,
		});
	}

	const headline = zh ? `✓ 已成功找回 ${totalRecovered} 篇缺失引文` : `✓ Recovered ${totalRecovered} missing citation(s)`;
	const subnote = collectionName ? (zh ? `目标文集「${collectionName}」` : `Target collection "${collectionName}"`) : undefined;
	return {
		tone: 'ok',
		text: `✓ ${parts.join(zh ? '；' : '; ')}`,
		headline,
		chips,
		subnote,
		actions: actions.length ? actions : undefined,
		stickyUntil: Date.now() + 25_000,
	};
}

export function buildOrphanBannerModel(
	orphans: readonly OrphanCitationInfo[] | undefined,
	zh: boolean,
	options?: { uncheckedKeys?: ReadonlySet<string>; expanded?: boolean; accordionOpen?: boolean },
): OrphanCardViewModel {
	if (!orphans?.length) {
		return {
			visible: false, accordionOpen: false, countBadge: '0', title: '', shortTitle: '', listText: '',
			summaryChips: [], showToggle: false, toggleLabel: '', rows: [], footHint: '',
			buttonLabel: '', buttonTooltip: '', buttonDisabled: true,
		};
	}
	const unchecked = options?.uncheckedKeys;
	const expanded = Boolean(options?.expanded);
	const accordionOpen = options?.accordionOpen ?? true;
	let trashedCount = 0;
	let rebuildCount = 0;
	let unrecCount = 0;

	const allRows: OrphanRowViewModel[] = orphans.map((o) => {
		const recoverable = isOrphanRecoverable(o);
		const isTrash = o.kind === 'trashed' && Boolean(o.itemID);
		if (isTrash) trashedCount += 1;
		else if (recoverable) rebuildCount += 1;
		else unrecCount += 1;

		const checked = recoverable && !unchecked?.has(o.key);
		const tagVariant = isTrash ? 'trash' : recoverable ? 'rebuild' : 'unrec';
		const tagText = isTrash
			? (zh ? '回收站·含原附件' : 'Trash · Keeps PDF')
			: recoverable
				? (zh ? 'Word备份·可重建' : 'Word Backup')
				: (zh ? '无内嵌备份' : 'No Backup');
		const doi = String(o.itemData?.DOI || '').trim();
		const tooltipParts = [`[${o.ordinal}] ${o.title}`, o.authorYear || '', doi ? `DOI: ${doi}` : '', tagText].filter(Boolean);
		return {
			key: o.key,
			ordinal: o.ordinal,
			title: o.title,
			tooltip: tooltipParts.join('\n'),
			authorYear: o.authorYear || '',
			tagText,
			tagVariant,
			recoverable,
			checked,
		};
	});

	const summaryChips: Array<{ text: string; variant: 'trash' | 'rebuild' | 'unrec' }> = [];
	if (trashedCount > 0) summaryChips.push({ text: zh ? `回收站 ${trashedCount}` : `Trash ${trashedCount}`, variant: 'trash' });
	if (rebuildCount > 0) summaryChips.push({ text: zh ? `可重建 ${rebuildCount}` : `Backup ${rebuildCount}`, variant: 'rebuild' });
	if (unrecCount > 0) summaryChips.push({ text: zh ? `缺备份 ${unrecCount}` : `No Data ${unrecCount}`, variant: 'unrec' });

	const checkedRows = allRows.filter((r) => r.checked);
	const recoverableTotal = trashedCount + rebuildCount;
	const ordinals = orphans.slice(0, 4).map((o) => `[${o.ordinal}]`).join(' ');
	const moreOrd = orphans.length > 4 ? (zh ? ' 等' : '…') : '';
	const title = zh
		? `⚠ 检测到 ${orphans.length} 篇断链引文（${ordinals}${moreOrd}）`
		: `⚠ ${orphans.length} broken citation(s) (${ordinals}${moreOrd})`;
	const shortTitle = zh ? '断链引文需要核对' : 'Broken citations to review';
	const listText = allRows.slice(0, 4).map((r) => `[${r.ordinal}] ${r.title} (${r.tagText})`).join('\n')
		+ (allRows.length > 4 ? (zh ? `\n…另有 ${allRows.length - 4} 篇` : `\n…and ${allRows.length - 4} more`) : '');

	let buttonLabel: string;
	if (recoverableTotal === 0) {
		buttonLabel = zh ? '缺少内嵌备份，请在 Word 中手动重选' : 'No embedded backup available';
	} else if (checkedRows.length === 0) {
		buttonLabel = zh ? '请勾选需要找回的引文' : 'Select citations to recover';
	} else if (checkedRows.length < recoverableTotal) {
		buttonLabel = zh ? `找回已选 ${checkedRows.length} 篇并重连` : `Recover ${checkedRows.length} Selected`;
	} else if (trashedCount > 0 && rebuildCount === 0) {
		buttonLabel = zh ? `一键从回收站找回并重连 (${trashedCount})` : `Restore & Relink (${trashedCount})`;
	} else if (trashedCount === 0) {
		buttonLabel = zh ? `一键找回并重连 Word (${rebuildCount})` : `Recover & Relink (${rebuildCount})`;
	} else {
		buttonLabel = zh ? `一键还原并导入 (${checkedRows.length})` : `Restore & Import (${checkedRows.length})`;
	}

	const buttonTooltip = zh
		? '在单个数据库事务中无损还原回收站条目或从 Word 备份重建（自动按 DOI/题录查重），并通过官方 dc:replaces 关系自动重连 Word'
		: 'Atomically restore from Trash or rebuild from Word metadata with DOI/title deduplication and native dc:replaces relinking';

	const showToggle = allRows.length > 3;
	const toggleLabel = expanded
		? (zh ? '收起' : 'Less')
		: (zh ? `展开全部 (${allRows.length})` : `Show all (${allRows.length})`);
	const rows = showToggle && !expanded ? allRows.slice(0, 3) : allRows;

	return {
		visible: true,
		accordionOpen,
		countBadge: String(orphans.length),
		title,
		shortTitle,
		listText,
		summaryChips,
		showToggle,
		toggleLabel,
		rows,
		footHint: zh ? '写回前可核对' : 'Verify before relink',
		buttonLabel,
		buttonTooltip,
		buttonDisabled: checkedRows.length === 0,
	};
}

export class OrphanSelectionState {
	public readonly uncheckedKeys = new Set<string>();
	public expanded = false;
	public accordionOpen = true;
	private autoOpenedSig = '';
	private currentSessionID = '';
	private readonly sessionUnchecked = new Map<string, Set<string>>();

	reset(): void {
		this.uncheckedKeys.clear();
		this.sessionUnchecked.clear();
		this.currentSessionID = '';
		this.expanded = false;
		this.accordionOpen = true;
		this.autoOpenedSig = '';
	}

	toggleKey(key: string): void {
		if (this.uncheckedKeys.has(key)) this.uncheckedKeys.delete(key);
		else this.uncheckedKeys.add(key);
		if (this.currentSessionID) this.sessionUnchecked.set(this.currentSessionID, new Set(this.uncheckedKeys));
	}

	getSelectedRecoverableKeys(orphans: readonly OrphanCitationInfo[] | undefined): string[] {
		if (!orphans?.length) return [];
		return orphans.filter((o) => isOrphanRecoverable(o) && !this.uncheckedKeys.has(o.key)).map((o) => o.key);
	}

	/** Returns true when a fresh orphan set appears and the section should auto-expand once. */
	syncSnapshot(activeSessionID: string | null | undefined, orphans: readonly OrphanCitationInfo[] | undefined, autoExpand = true): boolean {
		const nextSes = String(activeSessionID || '');
		if (nextSes !== this.currentSessionID) {
			if (this.currentSessionID) this.sessionUnchecked.set(this.currentSessionID, new Set(this.uncheckedKeys));
			this.currentSessionID = nextSes;
			this.uncheckedKeys.clear();
			for (const k of this.sessionUnchecked.get(nextSes) || []) this.uncheckedKeys.add(k);
		}
		if (!orphans?.length) {
			this.uncheckedKeys.clear();
			if (nextSes) this.sessionUnchecked.delete(nextSes);
			this.expanded = false;
			this.accordionOpen = true;
			this.autoOpenedSig = '';
			return false;
		}
		const validKeys = new Set(orphans.map((o) => o.key));
		for (const k of [...this.uncheckedKeys]) {
			if (!validKeys.has(k)) this.uncheckedKeys.delete(k);
		}
		if (nextSes) this.sessionUnchecked.set(nextSes, new Set(this.uncheckedKeys));
		const sig = `${nextSes}:${orphans.map((o) => o.key).sort().join('|')}`;
		if (sig === this.autoOpenedSig) return false;
		this.autoOpenedSig = sig;
		this.accordionOpen = autoExpand;
		return autoExpand;
	}
}
