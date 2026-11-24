export interface TabReadingProgress {
	readSeconds: number;
	lastPage?: number;
	totalPages?: number;
	pageSeconds?: Record<string, number>;
}

export function mergePageSeconds(
	prevMap: Readonly<Record<string, number>> | undefined,
	lastPage: number | undefined,
	deltaSeconds: number,
): Record<string, number> | undefined {
	const next: Record<string, number> = prevMap ? { ...prevMap } : {};
	if (lastPage && lastPage > 0 && deltaSeconds > 0) {
		const pageKey = String(Math.floor(lastPage));
		next[pageKey] = Math.max(0, (next[pageKey] || 0) + deltaSeconds);
	}
	return Object.keys(next).length ? next : undefined;
}

export function buildReadingHeatmapBuckets(progress?: TabReadingProgress, bucketCount = 16): number[] {
	const pageSec = progress?.pageSeconds;
	if (!pageSec || !Object.keys(pageSec).length) return [];
	const pages = Object.keys(pageSec).map((p) => Number(p)).filter((p) => Number.isFinite(p) && p > 0);
	if (!pages.length) return [];
	const maxPage = Math.max(Number(progress?.totalPages || 0), ...pages);
	if (maxPage <= 0) return [];
	const bins = Array.from({ length: bucketCount }, () => 0);
	for (const p of pages) {
		const sec = pageSec[String(p)] || 0;
		const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor(((p - 1) / maxPage) * bucketCount)));
		bins[idx] += sec;
	}
	const peak = Math.max(...bins, 1);
	return bins.map((v) => Math.round((v / peak) * 100) / 100);
}

export function formatReadingDuration(seconds?: number): string {
	const total = Math.max(0, Math.floor(Number(seconds) || 0));
	if (total < 60) return '';
	const mins = Math.floor(total / 60);
	if (mins < 60) return `${mins}m`;
	const hrs = Math.floor(mins / 60);
	const rem = mins % 60;
	return rem ? `${hrs}h${rem}m` : `${hrs}h`;
}

export function formatReadingProgress(prog?: TabReadingProgress): { text: string; ratio: number | null } {
	if (!prog) return { text: '', ratio: null };
	const dur = formatReadingDuration(prog.readSeconds);
	const page = Number(prog.lastPage) || 0;
	const total = Number(prog.totalPages) || 0;
	const pageText = page > 0 ? (total > 0 ? `p.${page}/${total}` : `p.${page}`) : '';
	const text = [dur, pageText].filter(Boolean).join(' · ');
	const ratio = page > 0 && total > 0 ? Math.max(0, Math.min(1, page / total)) : null;
	return { text, ratio };
}
