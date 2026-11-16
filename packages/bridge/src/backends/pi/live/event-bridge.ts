/**
 * What a hosted session's `pi` reports, one record at a time and in its order (`rpc/client.ts`), into the live state
 * through `mapping/`. Pi's RPC events are its session events with each `message_update` reduced to its delta
 * (pi-coding-agent 1.5.2 `docs/json.md:31-196`). A user message or a tool result is read once Pi has said which entry
 * holds it (`entry-cursor.ts`), so the live ids and the image references are the transcript's.
 */

import type { AgentEvent, RunOutcome } from "../../../contract";
import { type BroskiRecord, promptRecord, toolOutcomeRecord } from "../broski-entries";
import { mintActivityId, mintMessageId } from "../ids";
import { customActivity } from "../mapping/custom-activity";
import { userMessageEvent } from "../mapping/message-items";
import {
	compactionFinished,
	compactionRunOutcome,
	compactionStarted,
	retryFinished,
	retryScheduled,
} from "../mapping/session-events";
import { AssistantStream } from "../mapping/stream-blocks";
import {
	type AssistantMessage,
	contentText,
	type PiMessage,
	type ToolResultMessage,
	type UserMessage,
} from "../messages";
import type { RunContext } from "../ports";
import type { PiExit } from "../rpc/child";
import type { Delivery } from "../rpc/client";
import type { PiEvent, PiEventOf, UiRequest } from "../rpc/frames";
import type { EntryCursor } from "./entry-cursor";
import { faultEvent, noticeEvent } from "./live-notes";
import type { LiveState } from "./live-state";
import type { PromptDesk } from "./prompt-desk";
import type { QueueMirror } from "./queue-mirror";
import type { RunTracker } from "./run-tracker";
import { type ChildLinks, ToolFlow } from "./tool-flow";
import type { UsageFeed } from "./usage-feed";

/** What the host does with what is about the session rather than about a run. */
export interface BridgeHooks {
	/** A user message ended: its text, for the session's title. */
	userMessage(text: string): void;
	renamed(name: string | undefined): void;
	thinkingChanged(level: string): void;
	/** Before `run_finished`: what Pi runs now, which an extension may have changed without an event. */
	settling(): Promise<void>;
	/** An extension's UI request; it must not hold the records after it. */
	dialog(request: UiRequest): void;
	exited(exit: PiExit, stderr: string): void;
}

export interface EventBridgeDeps {
	readonly live: LiveState;
	readonly runs: RunTracker;
	readonly queue: QueueMirror;
	readonly prompts: PromptDesk;
	readonly usage: UsageFeed;
	readonly cursor: EntryCursor;
	readonly children: ChildLinks;
	readonly now: () => number;
	readonly hooks: BridgeHooks;
	/** Has the bridge's extension write a record into the session (`host/protocol.ts`). */
	readonly record: (record: BroskiRecord) => void;
}

/** Pi takes a follow-up that comes as its run ends after the run's last look at its queue: it goes with the next prompt. */
const LEFT_QUEUED = "A message queued as the run ended was not sent. It goes with the next prompt.";

export class EventBridge {
	private stream: AssistantStream | undefined;
	private lastAssistant: AssistantMessage | undefined;
	private compactionStart: (() => void) | undefined;
	private compactionRequested = false;
	private readonly tools: ToolFlow;

	constructor(private readonly deps: EventBridgeDeps) {
		this.tools = new ToolFlow({
			emit: (event) => deps.live.emit(event),
			run: () => deps.runs.current(),
			aborting: () => deps.runs.aborting,
			children: deps.children,
			record: (entryId, outcome) => deps.record(toolOutcomeRecord(entryId, outcome)),
		});
	}

	deliver(delivery: Delivery): Promise<void> | undefined {
		switch (delivery.kind) {
			case "event":
				return this.handle(delivery.event);
			case "ui":
				this.deps.hooks.dialog(delivery.request);
				return undefined;
			case "fault":
				this.deps.live.emit(faultEvent(delivery.message));
				return undefined;
			case "exit":
				this.deps.hooks.exited(delivery.exit, delivery.stderr);
				return undefined;
		}
	}

	/**
	 * The phone asked for a compaction: resolves when it starts (Pi emits `compaction_start` only once a running turn is
	 * aborted), and the run it makes is the phone's (trigger `prompt`).
	 */
	nextCompactionStart(): Promise<void> {
		this.compactionRequested = true;
		return new Promise((resolve) => {
			this.compactionStart = resolve;
		});
	}

	/** The compaction the phone asked for did not start. */
	compactionRefused(): void {
		this.compactionRequested = false;
		this.compactionStart = undefined;
	}

	/** A run Pi is no longer there to end: what it left open is closed, and it ends `outcome`. */
	abandonRun(outcome: RunOutcome): void {
		if (!this.deps.runs.current()) return;
		for (const event of [...(this.stream?.abandon() ?? []), ...this.tools.closing()]) this.deps.live.emit(event);
		this.stream = undefined;
		this.lastAssistant = undefined;
		this.deps.runs.end(outcome);
		this.deps.prompts.endRun();
	}

	private async handle(event: PiEvent): Promise<void> {
		switch (event.type) {
			case "agent_start":
				this.ensureRun();
				return;
			case "message_start":
				this.messageStarted(event.message);
				return;
			case "message_update":
				this.messageUpdated(event);
				return;
			case "message_end":
				return this.messageEnded(event.message);
			case "tool_execution_start":
				this.tools.executionStarted(event);
				return;
			case "tool_execution_update":
				this.tools.executionUpdated(event);
				return;
			case "tool_execution_end":
				this.tools.executionEnded(event);
				return;
			case "agent_settled":
				return this.settled(event.aborted);
			default:
				this.sessionEvent(event);
		}
	}

	private sessionEvent(event: Exclude<PiEvent, { type: `agent_${string}` | `message_${string}` | `tool_${string}` }>) {
		const { live, runs } = this.deps;
		switch (event.type) {
			case "queue_update":
				this.deps.queue.reconcile(event);
				return;
			case "compaction_start":
				this.compactionStarted(event);
				return;
			case "compaction_end":
				return this.compactionEnded(event);
			case "auto_retry_start":
				if (runs.current()) live.emit(retryScheduled(event, this.deps.now()));
				return;
			case "auto_retry_end":
				if (live.snapshot().retry) live.emit(retryFinished(event));
				return;
			case "thinking_level_changed":
				this.deps.hooks.thinkingChanged(event.level);
				return;
			case "session_info_changed":
				this.deps.hooks.renamed(event.name);
				return;
			case "entry_appended":
				this.deps.cursor.appended(event.entry);
				return;
			case "extension_error":
				live.emit(noticeEvent("error", `${event.extensionPath} ${event.event}: ${event.error}`));
				return;
		}
	}

	/** A run Pi started on its own (an extension's `sendUserMessage`), or a prompt's own when `started` came first. */
	private ensureRun(): RunContext {
		const { runs } = this.deps;
		return runs.current() ?? runs.start("system", this.deps.cursor.leafId);
	}

	/** An extension's message that triggers no turn arrives outside any run (`pi.sendMessage`), so it starts none. */
	private messageStarted(message: PiMessage): void {
		if (message.role === "other" || message.role === "bashExecution" || message.role === "custom") return;
		const run = this.ensureRun();
		if (message.role !== "assistant") return;
		for (const event of this.stream?.abandon() ?? []) this.deps.live.emit(event);
		run.tools.nextResponse();
		this.stream = new AssistantStream(mintMessageId(), run.tools);
	}

	private messageUpdated(event: PiEventOf<"message_update">): void {
		const update = event.assistantMessageEvent;
		if (update.type === "ignored") return;
		if (update.type === "toolcall_start" && update.id !== "") {
			this.tools.streamed({ id: update.id, name: update.toolName, arguments: {} });
		}
		for (const out of this.stream?.update(update) ?? []) this.deps.live.emit(out);
	}

	private async messageEnded(message: PiMessage): Promise<void> {
		switch (message.role) {
			case "assistant":
				this.assistantEnded(message);
				return;
			case "user":
				return this.userEnded(message);
			case "toolResult":
				return this.toolResultEnded(message);
			case "custom": {
				const activity = message.display
					? customActivity(message.customType, message.content, message.details)
					: undefined;
				if (activity) this.deps.live.emit({ type: "activity", activityId: mintActivityId(), activity });
				return;
			}
			default:
				return;
		}
	}

	private assistantEnded(message: AssistantMessage): void {
		this.lastAssistant = message;
		const stream = this.stream;
		for (const event of stream?.end(message) ?? []) this.deps.live.emit(event);
		this.stream = undefined;
		this.tools.responseEnded(message, stream?.unexecutedCalls(message) ?? []);
		this.deps.usage.refresh();
	}

	private async userEnded(message: UserMessage): Promise<void> {
		const entry = await this.entryOf(message);
		const record = this.deps.prompts.claim(message.content);
		if (entry !== undefined) {
			this.deps.runs.firstMessageUnder(entry.parentId);
			if (record) this.deps.record(promptRecord(entry.id, record));
		}
		this.deps.live.emit(userMessageEvent(message.content, entry?.id, record));
		this.deps.hooks.userMessage(contentText(message.content));
	}

	private async toolResultEnded(message: ToolResultMessage): Promise<void> {
		const entry = await this.entryOf(message);
		this.tools.resultPersisted(message, entry?.id);
	}

	private async entryOf(message: UserMessage | ToolResultMessage) {
		const failure = await this.deps.cursor.refresh();
		if (failure !== undefined) this.deps.live.emit(faultEvent(`Pi did not say where it stored a message: ${failure}`));
		return this.deps.cursor.entryOf(message);
	}

	/**
	 * A compaction while a prompt sent while idle is still being decided is Pi's pre-prompt one: that prompt's run
	 * starts. One with no run at all is a run of its own (`RunTracker`), the phone's when it asked for it.
	 */
	private compactionStarted(event: PiEventOf<"compaction_start">): void {
		if (this.deps.live.snapshot().compaction) return;
		const { runs, prompts } = this.deps;
		if (!runs.current() && !prompts.startEarly()) {
			runs.start(this.compactionRequested ? "prompt" : "system", this.deps.cursor.leafId, "compaction");
		}
		this.compactionRequested = false;
		this.deps.live.emit(compactionStarted(event));
		this.compactionStart?.();
		this.compactionStart = undefined;
	}

	/**
	 * A compaction Pi ends without having announced its start has no contract event, so it is a notice. A compaction's
	 * own run ends once the usage it left is shown.
	 */
	private async compactionEnded(event: PiEventOf<"compaction_end">): Promise<void> {
		const { live, runs, usage } = this.deps;
		if (live.snapshot().compaction) {
			live.emit(compactionFinished(event));
			if (runs.compacting) await usage.pull();
			else usage.refresh();
		} else if (event.errorMessage) {
			live.emit(noticeEvent("error", event.errorMessage));
		}
		if (runs.compacting) runs.end(compactionRunOutcome(event));
	}

	/** A run must always end: whatever fails while it is being closed is reported, and `run_finished` still follows. */
	private async settled(aborted: boolean): Promise<void> {
		let closing: AgentEvent[] = [];
		try {
			closing = [...(this.stream?.abandon() ?? []), ...this.tools.closing()];
		} catch (error) {
			this.deps.live.emit(faultEvent(error));
		}
		await this.deps.hooks.settling();
		const lastAssistant = this.lastAssistant;
		this.stream = undefined;
		this.lastAssistant = undefined;
		this.deps.runs.settle(aborted, lastAssistant, closing);
		this.deps.prompts.endRun();
		this.deps.queue.forgetDelivering();
		const { pi } = this.deps.queue;
		if (!aborted && pi.steering.length + pi.followUp.length > 0)
			this.deps.live.emit(noticeEvent("warning", LEFT_QUEUED));
	}
}
