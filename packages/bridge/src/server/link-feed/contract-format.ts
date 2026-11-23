import type {
	FileChange,
	Interaction,
	PermissionPreview,
	QuestionsRequest,
	RunOutcome,
	SessionSnapshot,
	SessionSummary,
	ToolPermissionRequest,
	ToolResultItem,
	TranscriptItem,
} from "../../contract";
import type { ObservedEvent } from "../../core/observer";
import {
	alertEvent,
	commandOf,
	cwdBase,
	type LinkFeedAlertKind,
	type LinkFeedEventMessage,
	stringOf,
	summarize,
} from "./format";
import { answerLine, failureWords, limitWords, nameList, oneLine, planSummary, tidyPath, toolLabel } from "./words";

/** The session an alert is about, and what its backend is called. */
export type AlertSource = Pick<ObservedEvent, "session" | "backendName">;

/** Room left in the 80 characters of a title for the words after the session's own name. */
const LABEL_MAX = 50;

/** Options a question's notification lists before it says there are more. */
const OPTIONS_SHOWN = 4;

const READING_TOOLS = new Set(["read", "notebookread"]);
const SEARCHING_TOOLS = new Set(["ls", "find", "grep", "glob"]);
const EDITING_TOOLS = new Set(["write", "edit", "multiedit", "notebookedit"]);

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
		whatItWants(source.backendName, summary?.cwd, interaction, request),
		at,
		interaction.id,
	);
}

/** "Pi wants to run ls apps", "Claude Code wants to edit src/a.ts": who asks and for what, read on a lock screen. */
function whatItWants(
	agent: string,
	cwd: string | undefined,
	interaction: Interaction,
	request: ToolPermissionRequest,
): string {
	const call = callWords(stringOf(interaction.origin?.toolName), cwd, request);
	return call === undefined
		? (stringOf(interaction.title) ?? `${agent} needs your approval`)
		: `${agent} wants to ${call}`;
}

/** What the pending call would do, as the end of "wants to …". Never any file's content, only names. */
function callWords(
	tool: string | undefined,
	cwd: string | undefined,
	request: ToolPermissionRequest,
): string | undefined {
	const command = commandPreview(request.previews) ?? commandOf(request.input);
	if (command) return `run ${oneLine(command)}`;
	const changes = request.previews.find((preview) => preview.kind === "file_changes");
	if (changes?.kind === "file_changes" && changes.changes.length > 0) {
		return `${changeVerb(changes.changes)} ${nameList(changes.changes.map((change) => tidyPath(change.path, cwd)))}`;
	}
	const paths = request.previews.find((preview) => preview.kind === "paths");
	if (paths?.kind === "paths") return `${pathVerb(tool)} ${nameList(paths.paths.map((path) => tidyPath(path, cwd)))}`;
	const network = request.previews.find((preview) => preview.kind === "network");
	if (network?.kind === "network") return `open ${network.host}`;
	const detail = summarize(request.input) ?? stringOf(request.reason);
	if (tool !== undefined && detail && pathVerb(tool) !== "access" && !SEARCHING_TOOLS.has(tool.toLowerCase())) {
		return `${pathVerb(tool)} ${tidyPath(oneLine(detail), cwd)}`;
	}
	if (tool === undefined) return detail && oneLine(detail);
	return detail ? `use ${toolLabel(tool)}: ${oneLine(detail)}` : `use ${toolLabel(tool)}`;
}

function commandPreview(previews: readonly PermissionPreview[]): string | undefined {
	for (const preview of previews) {
		if (preview.kind === "command" && stringOf(preview.command)) return preview.command;
	}
	return undefined;
}

function changeVerb(changes: readonly FileChange[]): string {
	const kinds = new Set(changes.map((change) => change.change));
	if (kinds.size === 1 && kinds.has("added")) return "create";
	if (kinds.size === 1 && kinds.has("deleted")) return "delete";
	if (kinds.size === 1 && kinds.has("renamed")) return "rename";
	return "edit";
}

function pathVerb(tool: string | undefined): string {
	const name = tool?.toLowerCase() ?? "";
	if (READING_TOOLS.has(name)) return "read";
	if (SEARCHING_TOOLS.has(name)) return "search";
	return EDITING_TOOLS.has(name) ? "edit" : "access";
}

export function contractAttention(
	source: AlertSource,
	summary: SessionSummary | undefined,
	interaction: Interaction,
	at: number,
): LinkFeedEventMessage {
	const words = attentionWords(source, summary?.cwd, interaction);
	return alertEvent(
		"attention",
		source.session.backend,
		source.session.sessionId,
		summary?.cwd,
		titled(source, summary, words.state),
		words.body,
		at,
		interaction.id,
	);
}

/** What the session waits for, in the words of the ask: a question's text, the plan's name, the call to approve. */
function attentionWords(
	source: AlertSource,
	cwd: string | undefined,
	interaction: Interaction,
): { state: string; body: string } {
	const { request } = interaction;
	const own = stringOf(interaction.title) ?? stringOf(interaction.body) ?? "Open Broski to answer";
	switch (request.kind) {
		case "tool_permission":
			return { state: "needs approval", body: whatItWants(source.backendName, cwd, interaction, request) };
		case "questions":
			return {
				state: request.questions.length > 1 ? "has questions" : "has a question",
				body: questionWords(request, own),
			};
		case "plan_approval":
			return { state: "plan ready", body: planSummary(request.plan) ?? "Review the plan to let it go on" };
		case "form":
			return { state: "needs input", body: request.server ? `${request.server} is asking for details` : own };
		case "choice":
			return { state: "needs a choice", body: `${own}: ${request.options.map((option) => option.label).join(" · ")}` };
		case "confirm":
			return { state: "needs confirmation", body: own };
		case "text":
			return { state: "needs input", body: own };
	}
}

function questionWords(request: QuestionsRequest, fallback: string): string {
	const [first] = request.questions;
	if (!first) return fallback;
	const text = answerLine(first.text) ?? fallback;
	const options = first.secret ? [] : first.options.map((option) => option.label);
	const listed = options.slice(0, OPTIONS_SHOWN).join(" · ");
	const more = options.length > OPTIONS_SHOWN ? " …" : "";
	const others = request.questions.length > 1 ? ` (+${request.questions.length - 1} more)` : "";
	return `${text}${listed ? ` ${listed}${more}` : ""}${others}`;
}

/** The alert of a run that ended, or undefined when its ending is no news (the person stopped it, or it will resume). */
export function contractDone(
	source: AlertSource,
	summary: SessionSummary | undefined,
	outcome: RunOutcome,
	beforeEnd: SessionSnapshot,
	at: number,
): LinkFeedEventMessage | undefined {
	const words = outcomeWords(outcome, beforeEnd, summary?.cwd);
	if (!words) return undefined;
	return alertEvent(
		words.kind,
		source.session.backend,
		source.session.sessionId,
		summary?.cwd,
		titled(source, summary, words.state),
		words.body,
		at,
	);
}

function outcomeWords(
	outcome: RunOutcome,
	state: SessionSnapshot,
	cwd: string | undefined,
): { kind: LinkFeedAlertKind; state: string; body: string } | undefined {
	switch (outcome.kind) {
		case "completed":
			return {
				kind: "done",
				state: "finished",
				body: finalAnswerLine(state) ?? lastCallLine(state, cwd) ?? "The run finished",
			};
		case "error":
			return { kind: "failed", state: "failed", body: failureWords(outcome.error.code) };
		case "limit":
			return { kind: "failed", state: "stopped at a limit", body: limitWords(outcome.limit) };
		case "aborted":
		case "deferred":
			return undefined;
	}
}

/** The first line that says something in the newest top-level text the run produced; an open block is newer than a finished one. */
function finalAnswerLine(state: SessionSnapshot): string | undefined {
	for (const block of [...state.blocks].reverse()) {
		if (block.kind !== "text" || block.parentToolCallId !== undefined) continue;
		const line = answerLine(block.text);
		if (line) return line;
	}
	const items = state.run?.items ?? [];
	for (const item of [...items].reverse()) {
		if (item.kind !== "block" || item.block !== "text" || item.parentToolCallId !== undefined) continue;
		const line = answerLine(item.text);
		if (line) return line;
	}
	return undefined;
}

/**
 * A run that wrote no text: its newest top-level call, what it ran, and the exit code when that was not 0.
 */
function lastCallLine(state: SessionSnapshot, cwd: string | undefined): string | undefined {
	const items = state.run?.items ?? [];
	for (const item of [...items].reverse()) {
		if (item.kind !== "tool_call" || item.parentToolCallId !== undefined) continue;
		const command = commandOf(item.input);
		const detail = summarize(item.input);
		const call = command
			? `Ran: ${oneLine(command)}`
			: detail === undefined
				? toolLabel(item.name)
				: `${toolLabel(item.name)}: ${tidyPath(oneLine(detail), cwd)}`;
		const exitCode = resultOf(items, item.toolCallId)?.result.exitCode;
		return exitCode === undefined || exitCode === 0 ? call : `${call} (exit code ${exitCode})`;
	}
	return undefined;
}

function resultOf(items: readonly TranscriptItem[], toolCallId: string): ToolResultItem | undefined {
	return items.find((item): item is ToolResultItem => item.kind === "tool_result" && item.toolCallId === toolCallId);
}

/** The session's own name, else its folder's, else its backend's, followed by what happened. */
function titled(source: AlertSource, summary: SessionSummary | undefined, what: string): string {
	const name = stringOf(summary?.title?.text) ?? stringOf(cwdBase(summary?.cwd)) ?? source.backendName;
	const label = name.length <= LABEL_MAX ? name : `${name.slice(0, LABEL_MAX - 1)}…`;
	return `${label} — ${what}`;
}
