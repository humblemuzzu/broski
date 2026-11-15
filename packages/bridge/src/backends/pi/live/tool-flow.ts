/**
 * The tool calls of a run as `tool_*` events. A call starts when its assistant message streams it
 * (`toolcall_start`) or, for one no message streamed, at `tool_execution_start`. A top-level call finishes
 * at its result message, whose entry names an image in it; a nested call (one tool made through `ctx.executeTool()`)
 * has no message and finishes at `tool_execution_end`.
 */

import type { AgentEvent, ImageRef, SessionRef, ToolCallId, ToolOutcome, ToolResult } from "../../../contract";
import type { RecordedToolOutcome } from "../broski-entries";
import { entryAttachmentId } from "../ids";
import { boundedJson } from "../json";
import {
	fileChangesOf,
	toolFinished,
	toolOutcome,
	toolOutputOf,
	toolResultOf,
	toolStartedOfExecution,
} from "../mapping/tool-items";
import type {
	AssistantMessage,
	ImageContent,
	TextContent,
	ToolCall,
	ToolResultMessage,
	UnsupportedContent,
} from "../messages";
import type { RunContext } from "../ports";
import type { PiEventOf } from "../rpc/frames";

type Content = readonly (TextContent | ImageContent | UnsupportedContent)[];
type ToolEvent<T extends "tool_execution_start" | "tool_execution_update" | "tool_execution_end"> = Omit<
	PiEventOf<T>,
	"type"
>;

export interface ToolFlowDeps {
	readonly emit: (event: AgentEvent) => void;
	readonly run: () => RunContext | undefined;
	/** An abort was requested for the run, so a call that fails now failed because of it. */
	readonly aborting: () => boolean;
	readonly children: ChildLinks;
	/** Records an outcome Pi stores as an ordinary failure, for the result entry that holds it. */
	readonly record: (entryId: string, outcome: RecordedToolOutcome) => void;
}

/** The part of `ChildFeeds` a tool call needs. */
export interface ChildLinks {
	link(piToolCallId: string, toolName: string, args: unknown, details: unknown): SessionRef | undefined;
	end(piToolCallId: string, outcome: ToolOutcome): void;
}

/** For a session whose calls have no children to follow: a terminal's. */
export const NO_CHILDREN: ChildLinks = { link: () => undefined, end: () => undefined };

interface OpenCall {
	readonly name: string;
	readonly args: unknown;
	/** The call's child session was announced in the parent's stream. */
	linked: boolean;
	/** Read when the call ends: the gate's denials are forgotten at the next assistant message (`ToolCallIds.nextResponse`). */
	denied: boolean;
}

export class ToolFlow {
	/** By Pi's tool call id: the calls of the response under way and the nested calls running. */
	private open = new Map<string, OpenCall>();

	constructor(private readonly deps: ToolFlowDeps) {}

	/** The assistant message streams a call (the event itself is mapped by the message's `AssistantStream`). */
	streamed(call: Pick<ToolCall, "id" | "name" | "arguments">): void {
		this.open.set(call.id, { name: call.name, args: call.arguments, denied: false, linked: false });
	}

	/**
	 * `unexecuted` are the live ids of calls the stream started that Pi will never run (`AssistantStream.unexecutedCalls`):
	 * no `tool_execution_*` event will finish them, so they finish here.
	 */
	responseEnded(message: AssistantMessage, unexecuted: readonly ToolCallId[]): void {
		for (const block of message.content) {
			if (block.type === "toolCall") this.rememberCall(block);
		}
		for (const id of unexecuted) this.abandonCall(id);
	}

	executionStarted(event: ToolEvent<"tool_execution_start">): void {
		const run = this.deps.run();
		if (!run) return;
		this.open.set(event.toolCallId, { name: event.toolName, args: event.args, denied: false, linked: false });
		if (run.tools.find(event.toolCallId) === undefined) {
			this.deps.emit(toolStartedOfExecution(event, run.tools));
		}
	}

	executionUpdated(event: ToolEvent<"tool_execution_update">): void {
		const run = this.deps.run();
		if (run && run.tools.find(event.toolCallId) !== undefined) this.deps.emit(toolOutputOf(event, run.tools));
		this.linkChild(event.toolCallId, event.partialResult.details);
	}

	/** The call's sub-runs reach its child session; the first time, the parent's stream says where the child is. */
	private linkChild(piId: string, details: unknown): void {
		const call = this.open.get(piId);
		const toolCallId = this.deps.run()?.tools.find(piId);
		if (call === undefined || toolCallId === undefined) return;
		const child = this.deps.children.link(piId, call.name, call.args, details);
		if (child === undefined || call.linked) return;
		call.linked = true;
		this.deps.emit({ type: "tool_updated", toolCallId, update: { kind: "child_session", session: child } });
	}

	executionEnded(event: ToolEvent<"tool_execution_end">): void {
		const call = this.open.get(event.toolCallId);
		const run = this.deps.run();
		if (call && run) call.denied = run.tools.wasDenied(event.toolCallId);
		if (event.parentToolCallId === undefined) return;
		this.finishCall(event.toolCallId, event.result.content ?? [], event.isError, event.result.details, () => undefined);
	}

	/** A call whose result no stored entry will hold (a terminal's): finished at its `tool_execution_end`, an image in it a placeholder. */
	finishedWithoutEntry(event: ToolEvent<"tool_execution_end">): void {
		this.finishCall(event.toolCallId, event.result.content ?? [], event.isError, event.result.details, () => undefined);
	}

	/** `entryId` is the entry the result was persisted as; undefined when it could not be found, and an image in it is a placeholder. */
	resultPersisted(message: ToolResultMessage, entryId: string | undefined): void {
		this.linkChild(message.toolCallId, message.details);
		const outcome = this.finishCall(message.toolCallId, message.content, message.isError, message.details, (index) =>
			entryId === undefined ? undefined : imageRefAt(message.content, entryId, index),
		);
		this.deps.children.end(message.toolCallId, outcome ?? (message.isError ? "failed" : "completed"));
		if (entryId !== undefined && (outcome === "denied" || outcome === "aborted")) this.deps.record(entryId, outcome);
	}

	/** Every call still running when the run settles ended with it. */
	closing(): AgentEvent[] {
		const events: AgentEvent[] = [];
		for (const piId of [...this.open.keys()]) {
			this.deps.children.end(piId, "aborted");
			const event = this.finishEvent(piId, "aborted", resultText("The run ended before the tool finished."));
			if (event) events.push(event);
		}
		this.open.clear();
		return events;
	}

	private rememberCall(block: ToolCall): void {
		const known = this.open.get(block.id);
		this.open.set(block.id, {
			name: block.name,
			args: block.arguments,
			denied: known?.denied ?? false,
			linked: known?.linked ?? false,
		});
	}

	private finishCall(
		piId: string,
		content: Content,
		isError: boolean,
		details: unknown,
		imageRef: (index: number) => ImageRef | undefined,
	): ToolOutcome | undefined {
		const run = this.deps.run();
		const call = this.open.get(piId);
		if (!run || !call) return undefined;
		const changes = isError
			? []
			: fileChangesOf(call.name, boundedJson(call.args), details === undefined ? undefined : boundedJson(details));
		const outcome = toolOutcome({
			isError,
			denied: call.denied,
			aborted: isError && this.deps.aborting(),
		});
		const event = this.finishEvent(piId, outcome, toolResultOf(content, isError, changes, imageRef));
		if (!event) return undefined;
		this.deps.emit(event);
		return outcome;
	}

	private abandonCall(id: ToolCallId): void {
		const run = this.deps.run();
		if (!run) return;
		for (const piId of [...this.open.keys()]) {
			if (run.tools.find(piId) === id) this.open.delete(piId);
		}
		this.deps.emit({
			type: "tool_finished",
			toolCallId: id,
			outcome: "aborted",
			result: resultText("The tool call did not run."),
		});
	}

	/** Only a call this run announced can finish. */
	private finishEvent(piId: string, outcome: ToolOutcome, result: ToolResult): AgentEvent | undefined {
		const run = this.deps.run();
		const known = this.open.delete(piId);
		if (!run || !known || run.tools.find(piId) === undefined) return undefined;
		return toolFinished(piId, outcome, result, run.tools);
	}
}

function resultText(text: string): ToolResult {
	return toolResultOf([{ type: "text", text }], true, [], () => undefined);
}

function imageRefAt(content: Content, entryId: string, index: number): ImageRef | undefined {
	const block = content[index];
	if (block?.type !== "image") return undefined;
	return { kind: "image_ref", id: entryAttachmentId(entryId, index), mimeType: block.mimeType };
}
