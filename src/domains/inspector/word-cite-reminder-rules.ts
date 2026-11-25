import {
	isRegularValidItem,
	normalizeToRegularItem,
	safeGetItemField,
} from '../../services/item-resolution.ts';

export type ReminderCheckScope = 'both' | 'wordOnly' | 'selectionOnly';

export interface ReminderRuleConfig {
	readonly enabled: boolean;
	readonly scope: ReminderCheckScope;
	readonly checkCreatorsYear: boolean;
	readonly checkVenue: boolean;
	readonly checkPagination: boolean;
	readonly showSuggested: boolean;
	readonly strictOnlineFirst: boolean;
}

export const DEFAULT_REMINDER_RULE_CONFIG: ReminderRuleConfig = {
	enabled: true,
	scope: 'both',
	checkCreatorsYear: true,
	checkVenue: true,
	checkPagination: true,
	showSuggested: true,
	strictOnlineFirst: false,
};

export interface ReminderFieldBadge {
	readonly text: string;
	readonly kind: 'missing' | 'suggested';
}

const ITEM_TYPE_LABELS_ZH: Readonly<Record<string, string>> = {
	journalArticle: '期刊论文',
	conferencePaper: '会议论文',
	book: '图书',
	bookSection: '图书章节',
	preprint: '预印本',
	thesis: '学位论文',
	report: '报告',
	webpage: '网页',
	patent: '专利',
	manuscript: '手稿',
	magazineArticle: '杂志文章',
	newspaperArticle: '报纸文章',
};

const ITEM_TYPE_LABELS_EN: Readonly<Record<string, string>> = {
	journalArticle: 'Journal',
	conferencePaper: 'Conference',
	book: 'Book',
	bookSection: 'Chapter',
	preprint: 'Preprint',
	thesis: 'Thesis',
	report: 'Report',
	webpage: 'Web Page',
	patent: 'Patent',
	manuscript: 'Manuscript',
	magazineArticle: 'Magazine',
	newspaperArticle: 'Newspaper',
};

export function resolveZoteroItemType(item: any): string {
	if (!item) return '';
	if (typeof item.itemType === 'string' && item.itemType.trim()) return item.itemType.trim();
	const typeID = Number(item.itemTypeID || 0);
	if (typeID > 0) {
		try {
			const resolved = (globalThis as any).Zotero?.ItemTypes?.getName?.(typeID);
			if (typeof resolved === 'string' && resolved.trim()) return resolved.trim();
		} catch { /* ignore */ }
	}
	return '';
}

export function formatReminderItemType(itemType: string, zh: boolean): string {
	if (!itemType) return zh ? '文献' : 'Item';
	return (zh ? ITEM_TYPE_LABELS_ZH[itemType] : ITEM_TYPE_LABELS_EN[itemType]) || (zh ? '文献' : 'Item');
}

function hasAnyCreator(item: any): boolean {
	if (typeof item?.getCreators === 'function') {
		try {
			const list = item.getCreators();
			if (Array.isArray(list)) return list.length > 0;
		} catch { /* fallback */ }
	}
	return Boolean(String(item?.firstCreator || safeGetItemField(item, 'firstCreator') || '').trim());
}

/**
 * Evaluates bibliography completeness by Zotero itemType and user rule switches.
 * Returns null if all enabled required citation fields are present ("suggested" fields alone never trigger a warning).
 */
export function inspectItemMetadataFields(
	item: any,
	zh: boolean,
	rules: Partial<ReminderRuleConfig> = DEFAULT_REMINDER_RULE_CONFIG,
	options?: { isCitedInWord?: boolean },
): ReminderFieldBadge[] | null {
	const cfg: ReminderRuleConfig = { ...DEFAULT_REMINDER_RULE_CONFIG, ...rules };
	const primary = normalizeToRegularItem(item);
	if (!primary || !isRegularValidItem(primary)) return null;

	const rawType = resolveZoteroItemType(primary);
	const badges: ReminderFieldBadge[] = [];
	const add = (kind: 'missing' | 'suggested', zhText: string, enText: string) => {
		if (kind === 'suggested' && !cfg.showSuggested) return;
		badges.push({ kind, text: zh ? zhText : enText });
	};

	const title = safeGetItemField(primary, 'title').trim();
	if (!title) add('missing', '缺少题名', 'Missing title');

	if (cfg.checkCreatorsYear) {
		const creatorOptional = rawType === 'webpage' || rawType === 'statute' || rawType === 'case' || rawType === 'standard';
		if (!hasAnyCreator(primary)) {
			if (creatorOptional) add('suggested', '作者建议补全', 'Author suggested');
			else add('missing', '缺少作者', 'Missing author');
		}
		const year = (safeGetItemField(primary, 'year') || safeGetItemField(primary, 'date')).trim();
		if (!year) {
			if (rawType === 'webpage') add('suggested', '日期建议补全', 'Date suggested');
			else add('missing', '缺少年份', 'Missing year');
		}
	}

	const doi = safeGetItemField(primary, 'DOI').trim();
	const pages = safeGetItemField(primary, 'pages').trim();
	const vol = safeGetItemField(primary, 'volume').trim();
	const requireFormalPagination = cfg.strictOnlineFirst || Boolean(options?.isCitedInWord);

	if (rawType === 'journalArticle') {
		if (cfg.checkVenue && !safeGetItemField(primary, 'publicationTitle').trim()) {
			add('missing', '缺少期刊名', 'Missing journal');
		}
		if (cfg.checkPagination) {
			if (!vol && !pages) {
				if (doi && !requireFormalPagination) add('suggested', '卷期页码建议补全', 'Vol./pages suggested');
				else add('missing', '缺少卷期页码', 'Missing vol./pages');
			} else if (!vol && pages) {
				add('missing', '缺少卷号', 'Missing volume');
			} else if (vol && !pages) {
				if (cfg.strictOnlineFirst) add('missing', '缺少页码', 'Missing pages');
				else add('suggested', '页码建议补全', 'Pages suggested');
			}
		}
		if (!doi) add('suggested', 'DOI 建议补全', 'DOI suggested');
	} else if (rawType === 'conferencePaper') {
		if (cfg.checkVenue && !(safeGetItemField(primary, 'proceedingsTitle') || safeGetItemField(primary, 'conferenceName')).trim()) {
			add('missing', '缺少会议名', 'Missing venue');
		}
		if (cfg.checkPagination && !pages) add('suggested', '页码建议补全', 'Pages suggested');
		if (!doi) add('suggested', 'DOI 建议补全', 'DOI suggested');
	} else if (rawType === 'book') {
		if (cfg.checkVenue && !safeGetItemField(primary, 'publisher').trim()) add('missing', '缺少出版社', 'Missing publisher');
		if (!safeGetItemField(primary, 'ISBN').trim()) add('suggested', 'ISBN 建议补全', 'ISBN suggested');
	} else if (rawType === 'bookSection') {
		if (cfg.checkVenue) {
			if (!safeGetItemField(primary, 'bookTitle').trim()) add('missing', '缺少书名', 'Missing book title');
			if (!safeGetItemField(primary, 'publisher').trim()) add('suggested', '出版社建议补全', 'Publisher suggested');
		}
		if (cfg.checkPagination && !pages) add('suggested', '页码建议补全', 'Pages suggested');
	} else if (rawType === 'thesis') {
		if (cfg.checkVenue && !(safeGetItemField(primary, 'university') || safeGetItemField(primary, 'publisher')).trim()) {
			add('missing', '缺少授予单位', 'Missing university');
		}
	} else if (rawType === 'preprint') {
		const repo = (safeGetItemField(primary, 'repository') || safeGetItemField(primary, 'archiveID') || doi || safeGetItemField(primary, 'url')).trim();
		if (cfg.checkVenue && !repo) add('missing', '缺少预印本库', 'Missing archive');
		else if (!doi && !safeGetItemField(primary, 'archiveID').trim()) add('suggested', 'DOI/arXiv 建议补全', 'DOI/arXiv suggested');
	} else if (rawType === 'report') {
		if (cfg.checkVenue && !(safeGetItemField(primary, 'institution') || safeGetItemField(primary, 'publisher')).trim()) {
			add('missing', '缺少机构名', 'Missing institution');
		}
	} else if (rawType === 'webpage') {
		if (cfg.checkVenue && !safeGetItemField(primary, 'url').trim()) add('missing', '缺少网址', 'Missing URL');
	} else if (rawType === 'patent') {
		if (cfg.checkVenue && !safeGetItemField(primary, 'patentNumber').trim()) add('missing', '缺少专利号', 'Missing patent no.');
	}

	return badges.some((b) => b.kind === 'missing') ? badges : null;
}
