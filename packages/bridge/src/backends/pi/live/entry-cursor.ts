/**
 * The session's entries as the host learns them over RPC. Pi names no entry in its message events, but persists a
 * message right after it writes its `message_end` (pi-coding-agent 1.5.2 `dist/core/agent-session.js:810-829`), so a
 * `get_entries` sent then finds it: the entries after the newest one known (`docs/rpc-commands.md:689-717`). A message
 * is matched to its entry by role and timestamp, a tool result by its call too.
 */

import type { PiMessage } from "../messages";
import type { RpcAnswer } from "../rpc/client";
import type { PiEntry } from "../rpc/replies";
import type { EntriesSince } from "./pi-child";

/** Entries a later lookup may still ask for: the results of one response arrive together and are asked for one by one. */
const REMEMBERED_ENTRIES = 64;

export interface EntryLookup {
	entriesSince(cursor: string | null): Promise<RpcAnswer<EntriesSince>>;
}

export class EntryCursor {
	private recent: PiEntry[] = [];
	private failure: string | undefined;

	/** `newest` is the file's last entry when the session was opened; Pi's leaf is that entry then. */
	constructor(
		private readonly lookup: EntryLookup,
		private newest: string | null,
		private leaf: string | null = newest,
	) {}

	/** The newest entry known: the session's leaf as far as the host knows. */
	get leafId(): string | null {
		return this.leaf;
	}

	/** An entry Pi appended and announced itself (`entry_appended`). */
	appended(entry: { readonly id: string }): void {
		this.newest = entry.id;
		this.leaf = entry.id;
	}

	/** Reads what Pi appended since the last look; the first failure is returned, later ones are not repeated. */
	async refresh(): Promise<string | undefined> {
		const answer = await this.lookup.entriesSince(this.newest);
		if (!answer.ok) {
			const first = this.failure === undefined;
			this.failure = answer.error;
			return first ? answer.error : undefined;
		}
		this.failure = undefined;
		const { entries, leafId } = answer.data;
		this.recent = [...this.recent, ...entries].slice(-REMEMBERED_ENTRIES);
		this.newest = entries.at(-1)?.id ?? this.newest;
		this.leaf = leafId;
		return undefined;
	}

	/** The entry `message` was persisted as, among the newest. */
	entryOf(message: PiMessage & { readonly timestamp: number }): PiEntry | undefined {
		for (let at = this.recent.length - 1; at >= 0; at--) {
			const entry = this.recent[at];
			if (entry !== undefined && holds(entry, message)) return entry;
		}
		return undefined;
	}
}

function holds(entry: PiEntry, message: PiMessage & { readonly timestamp: number }): boolean {
	const stored = entry.type === "message" ? entry.message : undefined;
	if (stored === undefined || stored.role !== message.role || stored.timestamp !== message.timestamp) return false;
	return message.role !== "toolResult" || stored.toolCallId === message.toolCallId;
}
