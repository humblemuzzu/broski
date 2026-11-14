/** Which session each fork this bridge made came from: the CLI keeps no link, so the bridge does (D27). */

import { join } from "node:path";
import { z } from "zod";
import type { SessionId } from "../../../contract";
import { boundedGrowth, trimOldest } from "./bounded";
import { LineJournal } from "./line-journal";

export const MAX_LINKS = 20_000;
/** A Claude Code session id is a UUID; a longer one is not a session this bridge forked. */
export const MAX_FORK_ID_CHARS = 64;
/** The file is compacted past twice `MAX_LINKS` lines, so every line it can hold is read back. */
export const MAX_READ_BYTES = 8 * 1_048_576;
const FORKS_FILE = "forks.jsonl";

const Id = z.string().min(1).max(MAX_FORK_ID_CHARS);
const ForkLine = z.object({ f: Id, p: Id });

export class ForkLinks {
	private readonly parents = new Map<SessionId, SessionId>();
	private readonly file: LineJournal;
	private loaded: Promise<void> | undefined;
	private lines = 0;

	constructor(
		stateDir: string,
		private readonly maxLinks = MAX_LINKS,
	) {
		this.file = new LineJournal(join(stateDir, FORKS_FILE), MAX_READ_BYTES);
	}

	async parentOf(forkId: SessionId): Promise<SessionId | undefined> {
		await this.load();
		return this.parents.get(forkId);
	}

	async link(forkId: SessionId, parentId: SessionId): Promise<void> {
		await this.load();
		const line = ForkLine.safeParse({ f: forkId, p: parentId });
		if (!line.success) return;
		this.remember(forkId, parentId);
		this.lines += 1;
		if (this.lines > 2 * this.maxLinks) await this.compact();
		else await this.file.append(JSON.stringify(line.data));
	}

	private load(): Promise<void> {
		this.loaded ??= this.file.read().then((lines) => {
			for (const text of lines) {
				const line = parseLine(text);
				if (line === undefined) continue;
				this.lines += 1;
				this.remember(line.f, line.p);
			}
			trimOldest(this.parents, this.maxLinks);
		});
		return this.loaded;
	}

	private remember(forkId: SessionId, parentId: SessionId): void {
		this.parents.delete(forkId);
		this.parents.set(forkId, parentId);
		boundedGrowth(this.parents, this.maxLinks);
	}

	private async compact(): Promise<void> {
		trimOldest(this.parents, this.maxLinks);
		const kept = [...this.parents].map(([f, p]) => JSON.stringify({ f, p }));
		this.lines = kept.length;
		await this.file.rewrite(kept);
	}
}

function parseLine(text: string): z.infer<typeof ForkLine> | undefined {
	try {
		const parsed = ForkLine.safeParse(JSON.parse(text));
		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
}
