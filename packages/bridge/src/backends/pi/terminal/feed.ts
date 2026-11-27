/**
 * A terminal session's events as the live state of a contract session: the run, its text, thinking and tools, the
 * compaction, the model. It maps with the parts a hosted session maps with (`mapping/`, `RunTracker`, `ToolFlow`),
 * fed from the link's `TerminalEvent`s instead of a hosted `pi`'s RPC events. It writes nothing: the terminal's `pi` is the
 * session file's only writer. Pi gives extensions no queue or retry event (`protocol.ts`), so there is none here.
 */

import { LiveState } from "../../../adapter-kit/live-state";
import {
	type AttachmentRef,
	emptySnapshot,
	type ImageRef,
	type JsonValue,
	MAX_LIST_ITEMS,
	type SessionSnapshot,
	sessionStatus,
} from "../../../contract";
import { mintActivityId, mintMessageId } from "../ids";
import { noticeEvent } from "../live/live-notes";
import { RunTracker } from "../live/run-tracker";
import { NO_CHILDREN, ToolFlow } from "../live/tool-flow";
import { announcedTasks } from "../mapping/background-tasks";
import { customActivity } from "../mapping/custom-activity";
import { extractUserImagePaths } from "../mapping/image-paths";
import { compactionFinished, compactionRunOutcome, compactionStarted } from "../mapping/session-events";
import { AssistantStream } from "../mapping/stream-blocks";
import { modelWireId } from "../models/model-ids";
import { permissionsSetting } from "../modes";
import type { LiveRow } from "../ports";
import { assistantOf } from "./assistant-message";
import { TerminalDialogs } from "./dialogs";
import type { Command, EndedMessage, TerminalEvent, TerminalState } from "./protocol";
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
	{
		e:
			| "model"
			| "thinking"
			| "name"
			| "compaction_start"
			| "compaction_end"
			| "ui_prompt"
			| "tasks"
			| "dialog_open"
			| "dialog_close";
	}
>;

export class TerminalFeed {
	readonly live: LiveState;
	readonly sent = new SentPrompts();
	readonly dialogs: TerminalDialogs;
	private readonly runs: RunTracker;
	private readonly tools: ToolFlow;
	private stream: AssistantStream | undefined;
	private lastAssistant: ReturnType<typeof assistantOf> | undefined;
	private leafId: string | null = null;
	private modelId: string | undefined;
	private thinking: string | undefined;
	private readonly deferredImageTools = new Map<
		string,
		{
			readonly toolCallId: string;
			readonly toolName: string;
			readonly result: Extract<TerminalEvent, { e: "tool_end" }>["result"];
			readonly isError: boolean;
		}
	>();

	/**
	 * `changed` is told when a run starts or ends or the session is renamed, which a session list shows; `command` sends
	 * the terminal what the phone answered its dialogs, and a cancel's stop.
	 */
	constructor(
		now: () => number,
		private readonly changed: () => void,
		command: (command: Command) => void = () => {},
		private readonly cwd?: string,
	) {
		this.live = new LiveState({ ...emptySnapshot(), modes: [permissionsSetting("off")] }, now);
		this.dialogs = new TerminalDialogs({
			live: this.live,
			runs: () => this.runs,
			now,
			reply: (id, reply) => command({ kind: "answer", id, reply }),
			abort: () => command({ kind: "abort" }),
		});
		this.runs = new RunTracker({
			live: this.live,
			interactions: { endRun: (runId) => this.dialogs.endRun(runId) },
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
		const runStartedAt = snapshot.run?.startedAt ?? snapshot.compaction?.startedAt;
		return {
			status: sessionStatus(snapshot),
			...(snapshot.modelId !== undefined && { modelId: snapshot.modelId }),
			...(runStartedAt !== undefined && { runStartedAt }),
			...(cut && { cut }),
		};
	}

	/**
	 * The terminal's state as it told it: at connection, again when it reconnects, and after events were lost. The run
	 * comes first, so a dialog the state lists is raised in it.
	 */
	reconcile(state: TerminalState): void {
		this.leafId = state.leafId;
		if (state.model) this.modelId = modelWireId(state.model);
		this.thinking = state.thinking;
		this.announceModel();
		this.tasksAnnounced(state.tasks);
		if (state.running) this.resumeRun(state);
		else if (this.runs.current()) this.finishRun(false);
		else for (const event of this.closing()) this.live.emit(event);
		this.dialogs.reconcile(state.dialogs ?? []);
	}

	/**
	 * The run under way goes on from what the state says: the tools it lists, and the message still streaming with the
	 * calls it announced, stay open; the rest end.
	 */
	private resumeRun(state: TerminalState): void {
		const open = this.runs.current();
		const run = open ?? this.runs.start(this.trigger(), state.leafId, undefined, state.runStartedAt);
		if (!open) this.changed();
		const caughtUp = this.stream?.catchUp(state.blocks);
		const going = new Set([
			...state.tools.map((tool) => tool.id),
			...(caughtUp ? (this.stream?.streamedCalls() ?? []) : []),
		]);
		for (const event of this.tools.closing(going)) this.live.emit(event);
		if (caughtUp) for (const event of caughtUp) this.live.emit(event);
		else {
			for (const event of this.stream?.abandon() ?? []) this.live.emit(event);
			this.stream = undefined;
			if (state.blocks.length > 0) {
				this.stream = new AssistantStream(mintMessageId(), run.tools);
				for (const block of state.blocks) this.openBlock(block);
			}
		}
		for (const tool of state.tools) {
			if (run.tools.find(tool.id) !== undefined) continue;
			this.tools.executionStarted({ toolCallId: tool.id, toolName: tool.name, args: tool.args });
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
				if (event.parentToolCallId === undefined) {
					const hasImage = (event.result.content ?? []).some((block) => block.type === "image");
					if (hasImage) this.deferredImageTools.set(event.toolCallId, ended);
					else this.tools.finishedWithoutEntry(ended);
				}
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
				if (event.phase === "start" && event.title !== undefined && !this.dialogs.anyOpen()) {
					this.live.emit(noticeEvent("info", `The terminal is waiting for an answer: ${event.title}`));
				}
				return;
			case "tasks":
				this.tasksAnnounced(event.tasks);
				return;
			case "dialog_open":
				this.dialogs.opened(event.id, event.dialog);
				return;
			case "dialog_close":
				this.dialogs.closed(event.id);
				return;
		}
	}

	/** An extension older than the tasks list announces none: what the session shows stays as it was. */
	private tasksAnnounced(announced: JsonValue | undefined): void {
		const tasks = announcedTasks(announced);
		if (tasks === undefined || JSON.stringify(tasks) === JSON.stringify(this.live.snapshot().backgroundTasks)) return;
		this.live.emit({ type: "background_tasks_changed", tasks });
	}

	/** The terminal went away: what it was running ends, and its viewers are left with what was read. */
	close(): void {
		this.tasksAnnounced([]);
		this.dialogs.end();
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
		this.flushDeferredImageTools();
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
		this.flushDeferredImageTools();
		for (const event of this.stream?.abandon() ?? []) this.live.emit(event);
		run.tools.nextResponse();
		this.stream = new AssistantStream(mintMessageId(), run.tools);
	}

	private flushDeferredImageTools(): void {
		for (const ended of this.deferredImageTools.values()) this.tools.finishedWithoutEntry(ended);
		this.deferredImageTools.clear();
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
				const claimed = this.sent.claim(message.text);
				let text = message.text;
				let attachments: AttachmentRef[] = [];
				if (claimed !== undefined && claimed.images.length > 0) {
					attachments = [...claimed.images];
				} else if (message.images !== undefined && message.images.length > 0 && message.timestamp !== undefined) {
					attachments = message.images.map(
						(slot): ImageRef => ({
							kind: "image_ref",
							id: `ts:${message.timestamp}:${slot.index}`,
							mimeType: slot.mimeType,
						}),
					);
				} else {
					const extracted = extractUserImagePaths(text, this.cwd);
					text = extracted.text;
					attachments = [...extracted.files].slice(0, MAX_LIST_ITEMS);
				}
				this.live.emit({
					type: "user_message",
					messageId: mintMessageId(),
					text,
					attachments,
					...(claimed !== undefined && { clientRequestId: claimed.clientRequestId }),
				});
				return;
			}
			case "toolResult": {
				this.deferredImageTools.delete(message.toolCallId);
				const timestamp = message.timestamp;
				const content = message.result.content ?? [];
				this.tools.finishedWithRefs(
					{
						toolCallId: message.toolCallId,
						toolName: message.toolName,
						result: message.result,
						isError: message.isError,
					},
					(index): ImageRef | undefined => {
						const block = content[index];
						if (block?.type !== "image" || timestamp === undefined) return undefined;
						return { kind: "image_ref", id: `ts:${timestamp}:${index}`, mimeType: block.mimeType };
					},
				);
				return;
			}
			case "custom": {
				const activity = message.display
					? customActivity(message.customType, message.text, message.details)
					: undefined;
				if (activity) this.live.emit({ type: "activity", activityId: mintActivityId(), activity });
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
