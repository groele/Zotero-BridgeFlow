import type { Disposable, DomainModule, SpotlightItemResult } from './types.ts';

export type CommandOwnerId = DomainModule['id'] | 'kernel';

export interface CommandDefinition {
	readonly id: string;
	readonly title: string;
	readonly subtitle: string;
	readonly badge?: string;
	readonly keywords?: string;
	readonly action: () => void | Promise<void>;
}

export interface CommandContribution {
	readonly id: string;
	readonly owner: CommandOwnerId;
	readonly priority?: number;
	readonly isEnabled?: () => boolean;
	readonly build: (win: Window, doc: Document | null) => readonly CommandDefinition[];
}

function matchesCommandTerm(rawTerm: string, cmd: CommandDefinition): boolean {
	const clean = rawTerm.replace(/^>\s*/, '').trim().toLowerCase();
	if (!clean) return true;
	const hay = `${cmd.title} ${cmd.subtitle} ${cmd.keywords || ''}`.toLowerCase();
	return clean.split(/\s+/).every((tok) => hay.includes(tok));
}

export class CommandRegistry {
	private readonly contributions = new Map<string, CommandContribution>();
	private readonly onError?: (id: string, err: unknown) => void;

	constructor(onError?: (id: string, err: unknown) => void) {
		this.onError = onError;
	}

	register(contribution: CommandContribution): Disposable {
		this.contributions.set(contribution.id, contribution);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			if (this.contributions.get(contribution.id) === contribution) {
				this.contributions.delete(contribution.id);
			}
		};
	}

	query(rawTerm: string, win: Window): SpotlightItemResult[] {
		const doc = win?.document ?? null;
		const sorted = [...this.contributions.values()].sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50));
		const out: SpotlightItemResult[] = [];
		const seen = new Set<string>();
		for (const contribution of sorted) {
			try {
				if (contribution.isEnabled && !contribution.isEnabled()) continue;
				for (const cmd of contribution.build(win, doc)) {
					if (seen.has(cmd.id) || !matchesCommandTerm(rawTerm, cmd)) continue;
					seen.add(cmd.id);
					out.push({
						id: cmd.id,
						category: 'command',
						title: cmd.title,
						subtitle: cmd.subtitle,
						badge: cmd.badge,
						action: cmd.action,
					});
				}
			} catch (err) {
				this.onError?.(contribution.id, err);
			}
		}
		return out;
	}

	listIds(): string[] {
		return [...this.contributions.keys()];
	}

	clear(): void {
		this.contributions.clear();
	}
}
