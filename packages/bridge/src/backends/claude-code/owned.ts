/** Lane A · the owner journal (D17, D37): which sessions and prompts this bridge made, at `<stateDir>/owned.jsonl`. */

import { join } from "node:path";
import { z } from "zod";
import type { SessionId, SessionOrigin } from "../../contract";
import { clip } from "./bounds";
import type { OwnershipDeps } from "./ports/deps";
import type { Ownership, PromptRecord } from "./ports/store";
import { boundedGrowth, trimOldest } from "./store/bounded";
import { LineJournal } from "./store/line-journal";

const MAX_SESSIONS = 20_000;
const MAX_PROMPTS = 50_000;
const MAX_NAMES_PER_PROMPT = 100;
const MAX_NAME_CHARS_KEPT = 256;
const MAX_READ_BYTES = 32 * 1_048_576;
const JOURNAL_FILE = "owned.jsonl";

const SessionLine = z.object({ k: z.literal("s"), i: z.string().min(1) });
const PromptLine = z.object({
	k: z.literal("p"),
	s: z.string().min(1),
	u: z.string().min(1),
	n: z.array(z.string().nullable()).max(MAX_NAMES_PER_PROMPT),
});
const JournalLine = z.discriminatedUnion("k", [SessionLine, PromptLine]);

export function createOwnership(deps: OwnershipDeps): Ownership {
	return new OwnerJournal(new LineJournal(join(deps.services.stateDir, JOURNAL_FILE), MAX_READ_BYTES));
}

function promptKey(sessionId: SessionId, sendUuid: string): string {
	return JSON.stringify([sessionId, sendUuid]);
}

function keptNames(names: readonly (string | undefined)[]): (string | null)[] {
	return names
		.slice(0, MAX_NAMES_PER_PROMPT)
		.map((name) => (name === undefined ? null : clip(name, MAX_NAME_CHARS_KEPT)));
}

interface KeptPrompt {
	readonly sessionId: SessionId;
	readonly sendUuid: string;
	readonly record: PromptRecord;
}

class OwnerJournal implements Ownership {
	private readonly sessions = new Set<SessionId>();
	private readonly prompts = new Map<string, KeptPrompt>();
	private lines = 0;

	constructor(private readonly file: LineJournal) {}

	async load(): Promise<void> {
		for (const text of await this.file.read()) {
			const line = parseLine(text);
			if (line === undefined) continue;
			this.lines += 1;
			if (line.k === "s") this.remember(line.i);
			else this.recall(line.s, line.u, line.n);
		}
		trimOldest(this.sessions, MAX_SESSIONS);
		trimOldest(this.prompts, MAX_PROMPTS);
		if (this.lines > this.capacityLines()) await this.compact();
	}

	origin(sessionId: SessionId): SessionOrigin {
		return this.sessions.has(sessionId) ? "broski" : "external";
	}

	async claim(sessionId: SessionId): Promise<void> {
		this.remember(sessionId);
		await this.write({ k: "s", i: sessionId });
	}

	async notePrompt(sessionId: SessionId, sendUuid: string, record: PromptRecord): Promise<void> {
		const names = keptNames(record.imageNames);
		this.recall(sessionId, sendUuid, names);
		await this.write({ k: "p", s: sessionId, u: sendUuid, n: names });
	}

	prompt(sessionId: SessionId, sendUuid: string): PromptRecord | undefined {
		return this.prompts.get(promptKey(sessionId, sendUuid))?.record;
	}

	private remember(sessionId: SessionId): void {
		this.sessions.delete(sessionId);
		this.sessions.add(sessionId);
		boundedGrowth(this.sessions, MAX_SESSIONS);
	}

	private recall(sessionId: SessionId, sendUuid: string, names: readonly (string | null)[]): void {
		const key = promptKey(sessionId, sendUuid);
		this.prompts.delete(key);
		this.prompts.set(key, {
			sessionId,
			sendUuid,
			record: { imageNames: names.map((name) => name ?? undefined) },
		});
		boundedGrowth(this.prompts, MAX_PROMPTS);
	}

	private async write(line: z.infer<typeof JournalLine>): Promise<void> {
		this.lines += 1;
		if (this.lines > this.capacityLines()) await this.compact();
		else await this.file.append(JSON.stringify(line));
	}

	private capacityLines(): number {
		return 2 * (MAX_SESSIONS + MAX_PROMPTS);
	}

	private async compact(): Promise<void> {
		const kept: string[] = [];
		for (const sessionId of this.sessions) kept.push(JSON.stringify({ k: "s", i: sessionId }));
		for (const { sessionId, sendUuid, record } of this.prompts.values()) {
			kept.push(
				JSON.stringify({
					k: "p",
					s: sessionId,
					u: sendUuid,
					n: keptNames(record.imageNames),
				}),
			);
		}
		this.lines = kept.length;
		await this.file.rewrite(kept);
	}
}

function parseLine(text: string): z.infer<typeof JournalLine> | undefined {
	try {
		const parsed = JournalLine.safeParse(JSON.parse(text));
		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
}
