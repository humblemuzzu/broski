import type {
	Interaction,
	PermissionPreview,
	RunOutcome,
	SessionSnapshot,
	SessionSummary,
	ToolPermissionRequest,
	ToolResultItem,
	TranscriptItem,
} from "../../contract";
import type { ObservedEvent } from "../../core/observer";
import { alertEvent, firstLine, type LinkFeedEventMessage, stringOf, summarize } from "./format";

/** The session an alert is about, and what its backend is called. */
export type AlertSource = Pick<ObservedEvent, "session" | "backendName">;

/** Room left in the 80 characters of a title for the words after the session's own name. */
const LABEL_MAX = 50;

export function contractApproval(
	source: AlertSource,
	summary: SessionSummary | undefined,
	interaction: Interaction,
	request: ToolPermissionRequest,
	at: number,
): LinkFeedEventMessage {
	return alertEvent(
		"approval",
		source.session.backend,
		source.session.sessionId,
		summary?.cwd,
		titled(source, summary, "needs approval"),
		whatItWants(source.backendName, interaction, request),
		at,
		interaction.id,
	);
}

/** "Pi wants to run ls apps", "Claude Code wants to use edit: src/a.ts": who asks and for what, read on a lock screen. */
function whatItWants(agent: string, interaction: Interaction, request: ToolPermissionRequest): string {
	const tool = stringOf(interaction.origin?.toolName);
	const command = request.previews.find((preview) => preview.kind === "command");
	if (command?.kind === "command" && stringOf(command.command)) return `${agent} wants to run ${command.command}`;
	const detail =
		previewDetail(request.previews) ??
		summarize(request.input) ??
		stringOf(request.reason) ??
		stringOf(interaction.title) ??
		"approval required";
	return tool ? `${agent} wants to use ${tool}: ${detail}` : detail;
}

export function contractAttention(
	source: AlertSource,
	summary: SessionSummary | undefined,
	interaction: Interaction,
	at: number,
): LinkFeedEventMessage {
	return alertEvent(
		"attention",
		source.session.backend,
		source.session.sessionId,
		summary?.cwd,
		titled(source, summary, "needs input"),
		stringOf(interaction.title) ?? stringOf(interaction.body) ?? "input required",
		at,
		interaction.id,
	);
}

/** The `done` alert of a run that ended, or undefined when its ending is no news (the person stopped it, or it will resume). */
export function contractDone(
	source: AlertSource,
	summary: SessionSummary | undefined,
	outcome: RunOutcome,
	beforeEnd: SessionSnapshot,
	at: number,
): LinkFeedEventMessage | undefined {
	const words = outcomeWords(outcome, beforeEnd);
	if (!words) return undefined;
	return alertEvent(
		"done",
		source.session.backend,
		source.session.sessionId,
		summary?.cwd,
		titled(source, summary, words.title),
		words.body,
		at,
	);
}

function outcomeWords(outcome: RunOutcome, state: SessionSnapshot): { title: string; body: string } | undefined {
	switch (outcome.kind) {
		case "completed":
			return { title: "finished", body: finalAnswerLine(state) ?? lastCallLine(state) ?? "Turn finished" };
		case "error":
			return { title: "stopped with an error", body: `Run failed: ${outcome.error.code}` };
		case "limit":
			return { title: "stopped at a limit", body: `Run stopped at its ${outcome.limit.replaceAll("_", " ")} limit` };
		case "aborted":
		case "deferred":
			return undefined;
	}
}

/** The first line of the newest top-level text the run produced; an open block is newer than a finished one. */
function finalAnswerLine(state: SessionSnapshot): string | undefined {
	for (const block of [...state.blocks].reverse()) {
		if (block.kind === "text" && block.parentToolCallId === undefined) return firstLine(block.text);
	}
	const items = state.run?.items ?? [];
	for (const item of [...items].reverse()) {
		if (item.kind === "block" && item.block === "text" && item.parentToolCallId === undefined) {
			return firstLine(item.text);
		}
	}
	return undefined;
}

/**
 * A run that wrote no text: its newest top-level call, what it ran, and the exit code when that was not 0.
 */
function lastCallLine(state: SessionSnapshot): string | undefined {
	const items = state.run?.items ?? [];
	for (const item of [...items].reverse()) {
		if (item.kind !== "tool_call" || item.parentToolCallId !== undefined) continue;
		const detail = summarize(item.input);
		const call = detail === undefined ? item.name : `${item.name}: ${firstLine(detail) ?? detail}`;
		const exitCode = resultOf(items, item.toolCallId)?.result.exitCode;
		return exitCode === undefined || exitCode === 0 ? call : `${call} (exit code ${exitCode})`;
	}
	return undefined;
}

function resultOf(items: readonly TranscriptItem[], toolCallId: string): ToolResultItem | undefined {
	return items.find((item): item is ToolResultItem => item.kind === "tool_result" && item.toolCallId === toolCallId);
}

/** The session's own name, or its backend's, followed by what happened. */
function titled(source: AlertSource, summary: SessionSummary | undefined, what: string): string {
	const name = stringOf(summary?.title?.text) ?? source.backendName;
	const label = name.length <= LABEL_MAX ? name : `${name.slice(0, LABEL_MAX - 1)}…`;
	return `${label} — ${what}`;
}

function previewDetail(previews: readonly PermissionPreview[]): string | undefined {
	for (const preview of previews) {
		const detail = previewText(preview);
		if (detail) return detail;
	}
	return undefined;
}

/** What a preview says about the call, without any file's content: a command, paths or a host. */
function previewText(preview: PermissionPreview): string | undefined {
	switch (preview.kind) {
		case "command":
			return stringOf(preview.command);
		case "paths":
			return preview.paths.join(" ");
		case "network":
			return preview.host;
		case "file_changes":
			return stringOf(preview.changes.map((change) => change.path).join(" "));
	}
}
