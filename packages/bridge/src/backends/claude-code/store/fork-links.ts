/** Lane A · which session each fork this bridge made came from: the SDK keeps no link (research 04 §9.5), so we do. */

import { join } from "node:path";
import { z } from "zod";
import type { SessionId } from "../../../contract";
import { boundedGrowth } from "./bounded";
import { LineJournal } from "./line-journal";

const MAX_LINKS = 20_000;
const MAX_READ_BYTES = 4 * 1_048_576;
const FORKS_FILE = "forks.jsonl";

const ForkLine = z.object({ f: z.string().min(1), p: z.string().min(1) });

export class ForkLinks {
	private readonly parents = new Map<SessionId, SessionId>();
	private readonly file: LineJournal;
	private loaded: Promise<void> | undefined;

	constructor(stateDir: string) {
		this.file = new LineJournal(join(stateDir, FORKS_FILE), MAX_READ_BYTES);
	}

	async parentOf(forkId: SessionId): Promise<SessionId | undefined> {
		await this.load();
		return this.parents.get(forkId);
	}

	async link(forkId: SessionId, parentId: SessionId): Promise<void> {
		await this.load();
		this.remember(forkId, parentId);
		await this.file.append(JSON.stringify({ f: forkId, p: parentId }));
	}

	private load(): Promise<void> {
		this.loaded ??= this.file.read().then((lines) => {
			for (const text of lines) {
				const line = parseLine(text);
				if (line !== undefined) this.remember(line.f, line.p);
			}
		});
		return this.loaded;
	}

	private remember(forkId: SessionId, parentId: SessionId): void {
		this.parents.delete(forkId);
		this.parents.set(forkId, parentId);
		boundedGrowth(this.parents, MAX_LINKS);
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
