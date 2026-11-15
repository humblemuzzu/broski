/**
 * A terminal session's events as the live state of a contract session: the run, its text, thinking and tools, the
 * compaction, the model. It maps with the parts a hosted session maps with (`mapping/`, `RunTracker`, `ToolFlow`),
 * fed from the link's `TerminalEvent`s instead of a hosted `pi`'s RPC events. It writes nothing: the terminal's `pi` is the
 * session file's only writer. Pi gives extensions no queue or retry event (`protocol.ts`), so there is none here.
 */

import { type ClientRequestId, emptySnapshot, type SessionSnapshot, sessionStatus } from "../../../contract";
import { mintMessageId } from "../ids";
import { noticeEvent } from "../live/live-notes";
import { LiveState } from "../live/live-state";
import { RunTracker } from "../live/run-tracker";
import { NO_CHILDREN, ToolFlow } from "../live/tool-flow";
import { customNotice } from "../mapping/message-items";
import { compactionFinished, compactionRunOutcome, compactionStarted } from "../mapping/session-events";
import { AssistantStream } from "../mapping/stream-blocks";
import { modelWireId } from "../models/model-ids";
import { permissionsSetting } from "../modes";
import type { LiveRow } from "../ports";
import { assistantOf } from "./assistant-message";
import type { EndedMessage, TerminalEvent, TerminalState } from "./protocol";
import { SentPrompts } from "./sent-prompts";

function toolFields(event: Extract<TerminalEvent, { e: "tool_start" | "tool_update" }>) {
	return {
		toolCallId: event.toolCallId,
		toolName: event.toolName,
		args: event.args,
		...(event.parentToolCallId !== undefined && { parentToolCallId: event.parentToolCallId }),
	};
}

type SessionEvent = Extract<
	TerminalEvent,
	{ e: "model" | "thinking" | "name" | "compaction_start" | "compaction_end" | "ui_prompt" }
>;

export class TerminalFeed {
	readonly live: LiveState;
	readonly sent = new SentPrompts();
	private readonly runs: RunTracker;
	private readonly tools: ToolFlow;
	private stream: AssistantStream | undefined;
	private lastAssistant: ReturnType<typeof assistantOf> | undefined;
	private leafId: string | null = null;
	private modelId: string | undefined;
	private thinking: string | undefined;

	/** `changed` is told when a run starts or ends or the session is renamed, which a session list shows. */
	constructor(
		now: () => number,
		private readonly changed: () => void,
	) {
		this.live = new LiveState({ ...emptySnapshot(), modes: [permissionsSetting("off")] }, now);
		this.runs = new RunTracker({
			live: this.live,
			interactions: { endRun: () => {} },
			refreshUsage: () => {},
		});
		this.tools = new ToolFlow({
			emit: (event) => this.live.emit(event),
			run: () => this.runs.current(),
			aborting: () => this.runs.aborting,
			children: NO_CHILDREN,
			record: () => {},
		});
	}

	snapshot(): SessionSnapshot {
		return this.live.snapshot();
	}

	/** What a session list shows of a session while its terminal runs it. */
	row(): LiveRow {
		const snapshot = this.live.snapshot();
		const cut = this.runs.cut();
		return {
			status: sessionStatus(snapshot),
			...(snapshot.modelId !== undefined && { modelId: snapshot.modelId }),
			...(cut && { cut }),
		};
	}

	/** The terminal's state as it told it: the first at connection, another after events were lost. */
	reconcile(state: TerminalState): void {
		this.leafId = state.leafId;
		if (state.model) this.modelId = modelWireId(state.model);
		this.thinking = state.thinking;
		this.announceModel();
		for (const event of this.closing()) this.live.emit(event);
		const open = this.runs.current();
		if (open && !state.running) this.finishRun(false);
		if (!state.running) return;
		const run = open ?? this.runs.start(this.trigger(), state.leafId);
		run.tools.nextResponse();
		if (state.blocks.length > 0) {
			this.stream = new AssistantStream(mintMessageId(), run.tools);
			for (const block of state.blocks) this.openBlock(block);
		}
		for (const tool of state.tools) {
			this.tools.executionStarted({
				toolCallId: tool.id,
				toolName: tool.name,
				args: tool.args,
			});
		}
	}

	event(event: TerminalEvent): void {
		switch (event.e) {
			case "agent_start":
				this.leafId = event.leafId;
				this.ensureRun();
				return;
			case "agent_settled":
				this.finishRun(event.aborted);
				return;
			case "message_start":
				this.messageStarted(event.role);
				return;
			case "stream":
				this.streamed(event.ev);
				return;
			case "message_end":
				this.messageEnded(event.message);
				return;
			case "tool_start":
				this.ensureRun();
				this.tools.executionStarted(toolFields(event));
				return;
			case "tool_update":
				this.tools.executionUpdated({
					...toolFields(event),
					partialResult: event.partialResult,
				});
				return;
			case "tool_end": {
				const ended = {
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					result: event.result,
					isError: event.isError,
					...(event.parentToolCallId !== undefined && { parentToolCallId: event.parentToolCallId }),
				};
				this.tools.executionEnded(ended);
				if (event.parentToolCallId === undefined) this.tools.finishedWithoutEntry(ended);
				return;
			}
			default:
				this.sessionEvent(event);
		}
	}

	private sessionEvent(event: SessionEvent): void {
		switch (event.e) {
			case "model":
				this.modelId = modelWireId(event);
				this.announceModel();
				return;
			case "thinking":
				this.thinking = event.level;
				this.announceModel();
				return;
			case "name":
				this.changed();
				return;
			case "compaction_start":
				this.compactionStarted(event.reason);
				return;
			case "compaction_end":
				this.compactionEnded(event);
				return;
			case "ui_prompt":
				if (event.phase === "start") {
					this.live.emit(noticeEvent("info", `The terminal is waiting for an answer: ${event.title ?? "a question"}`));
				}
				return;
		}
	}

	/** The terminal went away: what it was running ends, and its viewers are left with what was read. */
	close(): void {
		for (const event of this.closing()) this.live.emit(event);
		this.stream = undefined;
		if (this.runs.current()) {
			this.live.emit(noticeEvent("warning", "The terminal closed while this was running."));
			this.finishRun(true);
		}
	}

	private trigger(): "prompt" | "external" {
		return this.sent.startsRun ? "prompt" : "external";
	}

	private ensureRun() {
		const current = this.runs.current();
		if (current) return current;
		const started = this.runs.start(this.trigger(), this.leafId);
		this.changed();
		return started;
	}

	private finishRun(aborted: boolean): void {
		if (!this.runs.current()) return;
		const closing = this.closing();
		const last = this.lastAssistant;
		this.stream = undefined;
		this.lastAssistant = undefined;
		this.runs.settle(aborted, last, closing);
		this.sent.clear();
		this.changed();
	}

	/** What the run left open, ended as it stands. */
	private closing() {
		return [...(this.stream?.abandon() ?? []), ...this.tools.closing()];
	}

	private announceModel(): void {
		if (this.modelId === undefined && this.thinking === undefined) return;
		this.live.emit({
			type: "model_changed",
			...(this.modelId !== undefined && { modelId: this.modelId }),
			...(this.thinking !== undefined && { thinking: this.thinking }),
		});
	}

	private openBlock(block: TerminalState["blocks"][number]): void {
		const kind = block.kind;
		const events = [
			{ type: `${kind}_start`, contentIndex: block.index },
			{ type: `${kind}_delta`, contentIndex: block.index, delta: block.text },
		] as const;
		for (const event of events) for (const out of this.stream?.update(event) ?? []) this.live.emit(out);
	}

	private messageStarted(role: "user" | "assistant" | "toolResult" | "other"): void {
		if (role === "other") return;
		const run = this.ensureRun();
		if (role !== "assistant") return;
		for (const event of this.stream?.abandon() ?? []) this.live.emit(event);
		run.tools.nextResponse();
		this.stream = new AssistantStream(mintMessageId(), run.tools);
	}

	private streamed(event: Extract<TerminalEvent, { e: "stream" }>["ev"]): void {
		const run = this.ensureRun();
		this.stream ??= new AssistantStream(mintMessageId(), run.tools);
		if (event.type === "toolcall_start") this.tools.streamed({ id: event.id, name: event.toolName, arguments: {} });
		for (const out of this.stream.update(event)) this.live.emit(out);
	}

	private messageEnded(message: EndedMessage): void {
		switch (message.role) {
			case "assistant": {
				const run = this.ensureRun();
				const ended = assistantOf(message);
				this.stream ??= new AssistantStream(mintMessageId(), run.tools);
				const stream = this.stream;
				this.lastAssistant = ended;
				for (const out of stream.end(ended)) this.live.emit(out);
				this.stream = undefined;
				this.tools.responseEnded(ended, stream.unexecutedCalls(ended));
				return;
			}
			case "user": {
				this.ensureRun();
				const clientRequestId: ClientRequestId | undefined = this.sent.claim(message.text);
				this.live.emit({
					type: "user_message",
					messageId: mintMessageId(),
					text: message.text,
					attachments: [],
					...(clientRequestId !== undefined && { clientRequestId }),
				});
				return;
			}
			case "custom": {
				const notice = customNotice(message.display, message.text);
				if (notice) this.live.emit(notice);
				return;
			}
			case "other":
				return;
		}
	}

	private compactionStarted(reason: "manual" | "threshold" | "overflow"): void {
		if (this.live.snapshot().compaction) return;
		if (!this.runs.current()) {
			this.runs.start("external", this.leafId, "compaction");
			this.changed();
		}
		this.live.emit(compactionStarted({ reason }));
	}

	private compactionEnded(event: Extract<TerminalEvent, { e: "compaction_end" }>): void {
		const ended = {
			aborted: event.outcome === "aborted",
			...(event.outcome === "failed" && { errorMessage: event.error ?? "Compaction failed" }),
			...(event.tokensBefore !== undefined && { result: { tokensBefore: event.tokensBefore } }),
		};
		if (this.live.snapshot().compaction) this.live.emit(compactionFinished(ended));
		else if (ended.errorMessage) this.live.emit(noticeEvent("error", ended.errorMessage));
		if (this.runs.compacting) {
			this.runs.end(compactionRunOutcome(ended));
			this.changed();
		}
	}
}
