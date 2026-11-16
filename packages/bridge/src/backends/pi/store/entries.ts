/**
 * A Pi session file's lines as the store reads them (pi-coding-agent 1.5.2 `docs/session-format.md:49-207`): the
 * header, then entries chained by `id`/`parentId`. Only the fields the store and the mapping read.
 */

import type { PiMessage } from "../messages";

/** The version a current file's header names; older files are migrated in memory (`migration.ts`). */
export const CURRENT_SESSION_VERSION = 3;

export interface SessionHeader {
	readonly type: "session";
	readonly version?: number;
	readonly id: string;
	readonly timestamp: string;
	readonly cwd: string;
	/** The file this session was forked or handed off from. */
	readonly parentSession?: string;
}

interface EntryBase {
	id: string;
	parentId: string | null;
	readonly timestamp: string;
}

export interface MessageEntry extends EntryBase {
	readonly type: "message";
	readonly message: PiMessage;
}

export interface ModelChangeEntry extends EntryBase {
	readonly type: "model_change";
	readonly provider: string;
	readonly modelId: string;
}

export interface ThinkingLevelChangeEntry extends EntryBase {
	readonly type: "thinking_level_change";
	readonly thinkingLevel: string;
}

export interface CompactionEntry extends EntryBase {
	readonly type: "compaction";
	readonly summary: string;
	firstKeptEntryId: string;
	readonly tokensBefore: number;
}

export interface BranchSummaryEntry extends EntryBase {
	readonly type: "branch_summary";
	readonly summary: string;
}

export interface CustomEntry extends EntryBase {
	readonly type: "custom";
	readonly customType: string;
	readonly data?: unknown;
}

export interface CustomMessageEntry extends EntryBase {
	readonly type: "custom_message";
	readonly customType: string;
	readonly content: string | Extract<PiMessage, { role: "user" }>["content"];
	readonly display: boolean;
	readonly details?: unknown;
}

export interface LabelEntry extends EntryBase {
	readonly type: "label";
	readonly targetId: string;
	readonly label: string | undefined;
}

export interface SessionInfoEntry extends EntryBase {
	readonly type: "session_info";
	readonly name?: string;
}

/** Entries the store keeps in a branch but shows nothing of. */
export interface BookkeepingEntry extends EntryBase {
	readonly type: "usage" | "context_edit";
}

export type SessionEntry =
	| MessageEntry
	| ModelChangeEntry
	| ThinkingLevelChangeEntry
	| CompactionEntry
	| BranchSummaryEntry
	| CustomEntry
	| CustomMessageEntry
	| LabelEntry
	| SessionInfoEntry
	| BookkeepingEntry;
