export function createWorkspaceElement<K extends keyof HTMLElementTagNameMap>(
	doc: Document, tag: K,
): HTMLElementTagNameMap[K] {
	return doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K];
}
