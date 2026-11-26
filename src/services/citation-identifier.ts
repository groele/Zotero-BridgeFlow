export const MAX_CITATION_INPUT_LEN = 2400;

export function extractIdentifier(input: string): { doi?: string; arxiv?: string } {
	const bounded = input.length > MAX_CITATION_INPUT_LEN ? input.slice(0, MAX_CITATION_INPUT_LEN) : input;
	const doiMatch = bounded.match(/\b(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)/i);
	const arxivMatch =
		bounded.match(/\b(?:arXiv:\s*|arxiv\.org\/(?:abs|pdf)\/)(\d{4}\.\d{4,5}(?:v\d+)?)\b/i) ||
		bounded.trim().match(/^(\d{4}\.\d{4,5}(?:v\d+)?)$/i);
	return {
		doi: doiMatch ? doiMatch[1].replace(/[.,;]+$/, '').replace(/\)+$/, trailing => {
			const opens = (doiMatch[1].match(/\(/g) || []).length;
			const closes = (doiMatch[1].match(/\)/g) || []).length;
			return trailing.slice(0, Math.max(0, trailing.length - Math.max(0, closes - opens)));
		}).toLowerCase() : undefined,
		arxiv: arxivMatch ? arxivMatch[1] : undefined,
	};
}
