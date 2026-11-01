import { z } from "zod";
import {
	ChangedFilesListed,
	ChangedFilesOp,
	ModelsRefreshed,
	READ_OP_KINDS,
	RefreshModelsOp,
} from "./backend-ops-reads";
import {
	ExportPartOp,
	ExportPartRead,
	ExportSessionOp,
	ImportSessionOp,
	SessionExported,
	SessionImported,
	TRANSFER_OP_KINDS,
} from "./backend-ops-transfer";
import { FileChange } from "./content";
import { SessionId, TranscriptItemId } from "./ids";
import { MAX_ID_CHARS, MAX_LIST_ITEMS, MAX_NAME_CHARS, MAX_PATH_CHARS, MAX_TEXT_CHARS } from "./limits";
import { Rejected } from "./rejection";
import {
	SESSION_CONTROL_OP_KINDS,
	SessionSettingsOp,
	SessionSettingsResult,
	SessionToolsOp,
	SessionToolsResult,
	SystemPromptOp,
	SystemPromptResult,
} from "./session-controls";
import { RunShellOp, SHELL_OP_KINDS, ShellStarted } from "./shell-ops";
import {
	AbortBranchSummaryOp,
	BranchSummaryAborted,
	EntryLabelled,
	LabelEntryOp,
	ReadTreeOp,
	TREE_OP_KINDS,
	TreeRead,
} from "./tree-ops";

export const BackendOpKind = z.enum([
	"rewind_files",
	"review_start",
	"revert",
	"revert_stage",
	"revert_clear",
	"revert_commit",
	"navigate_tree",
	"take_over",
	...SESSION_CONTROL_OP_KINDS,
	...TRANSFER_OP_KINDS,
	...READ_OP_KINDS,
	...TREE_OP_KINDS,
	...SHELL_OP_KINDS,
]);
export type BackendOpKind = z.infer<typeof BackendOpKind>;

/** Whether an accepted op changes what the session's transcript reads, so the adapter emits `transcript_invalidated`. */
export function rewritesHistory(kind: BackendOpKind): boolean {
	switch (kind) {
		case "revert":
		case "revert_commit":
		case "navigate_tree":
			return true;
		case "rewind_files":
		case "review_start":
		case "revert_stage":
		case "revert_clear":
		case "take_over":
		case "session_settings":
		case "session_tools":
		case "system_prompt":
		case "export_session":
		case "export_part":
		case "import_session":
		case "changed_files":
		case "refresh_models":
		case "read_tree":
		case "label_entry":
		case "abort_branch_summary":
		case "run_shell":
			return false;
	}
}

/** Claude Code: restore files edited since a user message. Conversation history is untouched. */
export const RewindFilesOp = z.strictObject({
	kind: z.literal(BackendOpKind.enum.rewind_files),
	sessionId: SessionId,
	userItemId: TranscriptItemId,
	dryRun: z.boolean(),
});
export type RewindFilesOp = z.infer<typeof RewindFilesOp>;

export const UncommittedReview = z.strictObject({ kind: z.literal("uncommitted") });
export type UncommittedReview = z.infer<typeof UncommittedReview>;

export const BaseBranchReview = z.strictObject({
	kind: z.literal("base_branch"),
	branch: z.string().min(1).max(MAX_NAME_CHARS),
});
export type BaseBranchReview = z.infer<typeof BaseBranchReview>;

export const CommitReview = z.strictObject({
	kind: z.literal("commit"),
	sha: z.string().min(1).max(MAX_ID_CHARS),
	title: z.string().max(MAX_NAME_CHARS).optional(),
});
export type CommitReview = z.infer<typeof CommitReview>;

export const CustomReview = z.strictObject({
	kind: z.literal("custom"),
	instructions: z.string().min(1).max(MAX_TEXT_CHARS),
});
export type CustomReview = z.infer<typeof CustomReview>;

export const ReviewTarget = z.discriminatedUnion("kind", [
	UncommittedReview,
	BaseBranchReview,
	CommitReview,
	CustomReview,
]);
export type ReviewTarget = z.infer<typeof ReviewTarget>;

/** Codex: run a code review as a run of this session. */
export const ReviewStartOp = z.strictObject({
	kind: z.literal(BackendOpKind.enum.review_start),
	sessionId: SessionId,
	target: ReviewTarget,
});
export type ReviewStartOp = z.infer<typeof ReviewStartOp>;

/** Codex: drop the turn that starts with `beforeItemId` and every later turn from history. Files are untouched. */
export const RevertOp = z.strictObject({
	kind: z.literal(BackendOpKind.enum.revert),
	sessionId: SessionId,
	beforeItemId: TranscriptItemId,
});
export type RevertOp = z.infer<typeof RevertOp>;

/** OpenCode: stage a revert to before `itemId`; with `restoreFiles` the working tree is restored at once. */
export const RevertStageOp = z.strictObject({
	kind: z.literal(BackendOpKind.enum.revert_stage),
	sessionId: SessionId,
	itemId: TranscriptItemId,
	restoreFiles: z.boolean(),
});
export type RevertStageOp = z.infer<typeof RevertStageOp>;

/** OpenCode: undo a staged revert, restoring the files it changed. */
export const RevertClearOp = z.strictObject({ kind: z.literal(BackendOpKind.enum.revert_clear), sessionId: SessionId });
export type RevertClearOp = z.infer<typeof RevertClearOp>;

/** OpenCode: delete the history a staged revert points past. */
export const RevertCommitOp = z.strictObject({
	kind: z.literal(BackendOpKind.enum.revert_commit),
	sessionId: SessionId,
});
export type RevertCommitOp = z.infer<typeof RevertCommitOp>;

/** Pi: move the session's leaf to `itemId` in the same file, optionally summarising the branch left. */
export const NavigateTreeOp = z.strictObject({
	kind: z.literal(BackendOpKind.enum.navigate_tree),
	sessionId: SessionId,
	itemId: TranscriptItemId,
	summarize: z.boolean(),
	/** What the summary should stress, as the terminal's "Summarize with custom prompt". */
	instructions: z.string().min(1).max(MAX_TEXT_CHARS).optional(),
});
export type NavigateTreeOp = z.infer<typeof NavigateTreeOp>;

/**
 * Pi: make a session another client wrote (a terminal `pi`, the old app) one this bridge may drive. The person says that
 * no terminal is using it; the adapter refuses while one is, or while the file is still changing. The session keeps its
 * id and its history; what changes is what it allows (`SessionCapabilities`), told to its viewers by `session_replaced`.
 */
export const TakeOverOp = z.strictObject({
	kind: z.literal(BackendOpKind.enum.take_over),
	sessionId: SessionId,
});
export type TakeOverOp = z.infer<typeof TakeOverOp>;

export const ClaudeCodeOp = z.discriminatedUnion("kind", [RewindFilesOp]);
export type ClaudeCodeOp = z.infer<typeof ClaudeCodeOp>;

export const CodexOp = z.discriminatedUnion("kind", [ReviewStartOp, RevertOp]);
export type CodexOp = z.infer<typeof CodexOp>;

export const OpenCodeOp = z.discriminatedUnion("kind", [RevertStageOp, RevertClearOp, RevertCommitOp]);
export type OpenCodeOp = z.infer<typeof OpenCodeOp>;

export const PiOp = z.discriminatedUnion("kind", [
	NavigateTreeOp,
	TakeOverOp,
	SessionSettingsOp,
	SessionToolsOp,
	SystemPromptOp,
	ExportSessionOp,
	ExportPartOp,
	ImportSessionOp,
	ChangedFilesOp,
	RefreshModelsOp,
	ReadTreeOp,
	LabelEntryOp,
	AbortBranchSummaryOp,
	RunShellOp,
]);
export type PiOp = z.infer<typeof PiOp>;

export const ClaudeCodeCall = z.strictObject({ backend: z.literal("claude-code"), op: ClaudeCodeOp });
export type ClaudeCodeCall = z.infer<typeof ClaudeCodeCall>;

export const CodexCall = z.strictObject({ backend: z.literal("codex"), op: CodexOp });
export type CodexCall = z.infer<typeof CodexCall>;

export const OpenCodeCall = z.strictObject({ backend: z.literal("opencode"), op: OpenCodeOp });
export type OpenCodeCall = z.infer<typeof OpenCodeCall>;

export const PiCall = z.strictObject({ backend: z.literal("pi"), op: PiOp });
export type PiCall = z.infer<typeof PiCall>;

/** The escape hatch for a feature only one backend has. Pi Durable has none. */
export const BackendCall = z.discriminatedUnion("backend", [ClaudeCodeCall, CodexCall, OpenCodeCall, PiCall]);
export type BackendCall = z.infer<typeof BackendCall>;

/** `filesChanged` absent: the backend did not say. `skippedLinks`: files a real rewind left alone because a link sat at their path. */
export const RewindFilesResult = z.strictObject({
	kind: z.literal(BackendOpKind.enum.rewind_files),
	canRewind: z.boolean(),
	filesChanged: z.array(z.string().max(MAX_PATH_CHARS)).max(MAX_LIST_ITEMS).optional(),
	insertions: z.int().nonnegative().optional(),
	deletions: z.int().nonnegative().optional(),
	skippedLinks: z.int().nonnegative().optional(),
	error: z.string().max(MAX_TEXT_CHARS).optional(),
});
export type RewindFilesResult = z.infer<typeof RewindFilesResult>;

export const ReviewStarted = z.strictObject({ kind: z.literal(BackendOpKind.enum.review_start) });
export type ReviewStarted = z.infer<typeof ReviewStarted>;

export const Reverted = z.strictObject({ kind: z.literal(BackendOpKind.enum.revert) });
export type Reverted = z.infer<typeof Reverted>;

export const RevertStaged = z.strictObject({
	kind: z.literal(BackendOpKind.enum.revert_stage),
	files: z.array(FileChange).max(MAX_LIST_ITEMS),
});
export type RevertStaged = z.infer<typeof RevertStaged>;

export const RevertCleared = z.strictObject({ kind: z.literal(BackendOpKind.enum.revert_clear) });
export type RevertCleared = z.infer<typeof RevertCleared>;

export const RevertCommitted = z.strictObject({ kind: z.literal(BackendOpKind.enum.revert_commit) });
export type RevertCommitted = z.infer<typeof RevertCommitted>;

export const TreeNavigated = z.strictObject({ kind: z.literal(BackendOpKind.enum.navigate_tree) });
export type TreeNavigated = z.infer<typeof TreeNavigated>;

export const TakenOver = z.strictObject({ kind: z.literal(BackendOpKind.enum.take_over) });
export type TakenOver = z.infer<typeof TakenOver>;

export const BackendOpResult = z.discriminatedUnion("kind", [
	RewindFilesResult,
	ReviewStarted,
	Reverted,
	RevertStaged,
	RevertCleared,
	RevertCommitted,
	TreeNavigated,
	TakenOver,
	SessionSettingsResult,
	SessionToolsResult,
	SystemPromptResult,
	SessionExported,
	ExportPartRead,
	SessionImported,
	ChangedFilesListed,
	ModelsRefreshed,
	TreeRead,
	EntryLabelled,
	BranchSummaryAborted,
	ShellStarted,
]);
export type BackendOpResult = z.infer<typeof BackendOpResult>;

export const BackendCallAccepted = z.strictObject({ status: z.literal("accepted"), result: BackendOpResult });
export type BackendCallAccepted = z.infer<typeof BackendCallAccepted>;

export const BackendCallResult = z.discriminatedUnion("status", [BackendCallAccepted, Rejected]);
export type BackendCallResult = z.infer<typeof BackendCallResult>;
