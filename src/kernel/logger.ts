export interface PerfRecord {
	readonly op: string;
	readonly durationMs: number;
	readonly timestamp: number;
}

export class KernelLogger {
	private debugEnabled = false;
	private slowThresholdMs = 50;
	private readonly slowRecords: PerfRecord[] = [];
	private readonly maxRecords = 100;

	configure(options: { debug?: boolean; slowThresholdMs?: number }): void {
		if (typeof options.debug === 'boolean') this.debugEnabled = options.debug;
		if (typeof options.slowThresholdMs === 'number' && Number.isFinite(options.slowThresholdMs)) {
			this.slowThresholdMs = Math.max(5, Math.min(5000, Math.round(options.slowThresholdMs)));
		}
	}

	debug(scope: string, message: string, detail?: unknown): void {
		if (!this.debugEnabled) return;
		const suffix = detail === undefined ? '' : ` ${safeStringify(detail)}`;
		try {
			(globalThis as any).Zotero?.debug?.(`[BridgeFlow:${scope}] ${message}${suffix}`);
		} catch { /* ignore */ }
	}

	error(scope: string, error: unknown): void {
		try {
			const host = (globalThis as any).Zotero;
			if (typeof host?.logError === 'function') {
				host.logError(error instanceof Error ? error : new Error(`[BridgeFlow:${scope}] ${String(error)}`));
			}
		} catch { /* ignore */ }
	}

	recordPerf(op: string, durationMs: number): void {
		if (durationMs < this.slowThresholdMs) return;
		this.slowRecords.push({ op, durationMs, timestamp: Date.now() });
		if (this.slowRecords.length > this.maxRecords) {
			this.slowRecords.splice(0, this.slowRecords.length - this.maxRecords);
		}
		this.debug('perf', `slow op "${op}" took ${durationMs.toFixed(1)}ms`);
	}

	getSlowRecords(): readonly PerfRecord[] {
		return this.slowRecords;
	}

	clearPerf(): void {
		this.slowRecords.length = 0;
	}
}

function safeStringify(value: unknown): string {
	try {
		return typeof value === 'string' ? value : JSON.stringify(value);
	} catch {
		return String(value);
	}
}
