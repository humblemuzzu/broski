/**
 * Pi's session events into the live state, through `mapping/`. The listener never throws: Pi calls its listeners
 * bare, so a throw breaks the agent loop (pi-coding-agent `src/core/agent-session.ts:1039-1043`). It never awaits
 * either: Pi drops a listener's promise.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { type AssistantMessage, contentText, type UserMessage } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "../../../contract";
import { PROMPT_ENTRY, promptEntryData, TOOL_OUTCOME_ENTRY, toolOutcomeEntryData } from "../broski-entries";
import { mintMessageId } from "../ids";
import { customNotice, userMessageEvent } from "../mapping/message-items";
import {
	compactionFinished,
	compactionRunOutcome,
	compactionStarted,
	retryFinished,
	retryScheduled,
} from "../mapping/session-events";
import { AssistantStream } from "../mapping/stream-blocks";
import type { PiEvent, RunContext } from "../ports";
import { faultEvent, noticeEvent } from "./live-notes";
import type { LiveState } from "./live-state";
import { persistedEntryId } from "./persisted-entry";
import type { PromptDesk } from "./prompt-desk";
import type { QueueMirror } from "./queue-mirror";
import type { RunTracker } from "./run-tracker";
import { type ChildLinks, ToolFlow } from "./tool-flow";
import type { UsageFeed } from "./usage-feed";

/** What the host does with the events that are about the session rather than about a run. */
export interface BridgeHooks {
	/** A user message ended: its text, for the session's title. */
	userMessage(text: string): void;
	renamed(name: string | undefined): void;
	/** Pi changed the thinking level on its own (an extension did). */
	thinkingChanged(): void;
	/** Before `run_finished`: the session's model and thinking may have moved without an event. */
	settling(): void;
}

export interface EventBridgeDeps {
	readonly live: LiveState;
	readonly runs: RunTracker;
	readonly queue: QueueMirror;
	readonly prompts: PromptDesk;
	readonly usage: UsageFeed;
	readonly now: () => number;
	readonly hooks: BridgeHooks;
	readonly children: ChildLinks;
}

/**
 * Pi takes a follow-up while its run is still streaming but past the run's last look at its queue
 * (`agent-session.ts:1906-1908` against `:1080`): the terminal leaves it queued too, and so it goes with the next prompt.
 */
const LEFT_QUEUED = "A message queued as the run ended was not sent. It goes with the next prompt.";

export class EventBridge {
	private session: AgentSession | undefined;
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
			record: (outcome) => this.appendRecord(TOOL_OUTCOME_ENTRY, toolOutcomeEntryData(outcome)),
		});
	}

	/** Subscribes to `session` for good: its `dispose()` drops every listener (pi `src/core/agent-session.ts:1427`). */
	attach(session: AgentSession): void {
		this.session = session;
		session.subscribe((event) => {
			try {
				this.handle(event);
			} catch (error) {
				this.fault(error);
			}
		});
	}

	/**
	 * The phone asked for a compaction: resolves when it starts (Pi emits `compaction_start` only after `compact()` has
	 * aborted the run), and the run it makes is the phone's (trigger `prompt`).
	 */
	nextCompactionStart(): Promise<void> {
		this.compactionRequested = true;
		return new Promise((resolve) => {
			this.compactionStart = resolve;
		});
	}

	private handle(event: AgentSessionEvent): void {
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
				this.messageEnded(event.message);
				return;
			case "tool_execution_start":
				this.tools.executionStarted(event);
				return;
			case "tool_execution_update":
				this.tools.executionUpdated(event);
				return;
			case "tool_execution_end":
				this.tools.executionEnded(event);
				return;
			case "queue_update":
				this.deps.queue.reconcile(event);
				return;
			case "compaction_start":
				this.compactionStarted(event);
				return;
			case "compaction_end":
				this.compactionEnded(event);
				return;
			case "auto_retry_start":
				if (this.deps.runs.current()) this.deps.live.emit(retryScheduled(event, this.deps.now()));
				return;
			case "auto_retry_end":
				if (this.deps.live.snapshot().retry) this.deps.live.emit(retryFinished(event));
				return;
			case "thinking_level_changed":
				this.deps.hooks.thinkingChanged();
				return;
			case "session_info_changed":
				this.deps.hooks.renamed(event.name);
				return;
			case "agent_settled":
				this.settled(event.aborted);
				return;
			case "agent_end":
			case "turn_start":
			case "turn_end":
			case "entry_appended":
			case "summarization_retry_scheduled":
			case "summarization_retry_attempt_start":
			case "summarization_retry_finished":
			case "bash_execution_update":
				return;
		}
	}

	/** A run Pi started on its own (an extension's `sendUserMessage`), or a prompt's own when `started` came first. */
	private ensureRun(): RunContext {
		const { runs } = this.deps;
		return runs.current() ?? runs.start("system", this.requireSession().sessionManager.getLeafId());
	}

	private messageStarted(message: AgentMessage): void {
		switch (message.role) {
			case "assistant": {
				const run = this.ensureRun();
				for (const event of this.stream?.abandon() ?? []) this.deps.live.emit(event);
				run.tools.nextResponse();
				this.stream = new AssistantStream(mintMessageId(), run.tools);
				return;
			}
			case "user":
			case "toolResult":
				this.ensureRun();
				return;
			default:
				return;
		}
	}

	private messageUpdated(event: PiEvent<"message_update">): void {
		const { assistantMessageEvent } = event;
		if (assistantMessageEvent.type === "toolcall_start") {
			const call = assistantMessageEvent.partial.content[assistantMessageEvent.contentIndex];
			if (call?.type === "toolCall") this.tools.streamed(call);
		}
		for (const out of this.stream?.update(assistantMessageEvent) ?? []) this.deps.live.emit(out);
	}

	private messageEnded(message: AgentMessage): void {
		switch (message.role) {
			case "assistant":
				this.assistantEnded(message);
				return;
			case "user":
				this.afterPersist(message, (entryId) => this.userRecorded(message, entryId));
				return;
			case "toolResult":
				this.afterPersist(message, (entryId) => this.tools.resultPersisted(message, entryId));
				return;
			case "custom": {
				const notice = customNotice(message.display, message.content);
				if (notice) this.deps.live.emit(notice);
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
		queueMicrotask(() => this.deps.usage.refresh());
	}

	/**
	 * Pi persists a message right after its public listeners return, in the same synchronous stretch, and the
	 * agent loop continues in a later microtask (pi `src/core/agent-session.ts:1144-1166`), so a microtask
	 * queued here sees the message as the session's newest entry and nothing is appended between.
	 */
	private afterPersist(message: AgentMessage, handle: (entryId: string) => void): void {
		queueMicrotask(() => {
			try {
				handle(this.persistedEntryId(message));
			} catch (error) {
				this.fault(error);
			}
		});
	}

	private persistedEntryId(message: AgentMessage): string {
		return persistedEntryId(this.requireSession().sessionManager, message);
	}

	private userRecorded(message: UserMessage, entryId: string): void {
		const record = this.deps.prompts.claim(message.content);
		if (record) this.appendRecord(PROMPT_ENTRY, promptEntryData(record));
		this.deps.live.emit(userMessageEvent(message.content, entryId, record));
		this.deps.hooks.userMessage(contentText(message.content));
	}

	/**
	 * A `custom` entry right after the message just persisted (`afterPersist`). Pi moves its leaf before it writes,
	 * so a write that fails still leaves the entry in memory (`src/core/session-manager.ts:1191-1196`); the failure
	 * is reported.
	 */
	private appendRecord(customType: string, data: object): void {
		try {
			this.requireSession().sessionManager.appendCustomEntry(customType, data);
		} catch (error) {
			this.fault(error);
		}
	}

	/**
	 * A compaction while a prompt sent while idle is still being decided is Pi's pre-prompt one: that prompt's run
	 * starts. One with no run at all is a run of its own (`RunTracker`), the phone's when it asked for it.
	 */
	private compactionStarted(event: PiEvent<"compaction_start">): void {
		if (this.deps.live.snapshot().compaction) return;
		const { runs, prompts } = this.deps;
		if (!runs.current() && !prompts.startEarly()) {
			runs.start(
				this.compactionRequested ? "prompt" : "system",
				this.requireSession().sessionManager.getLeafId(),
				"compaction",
			);
		}
		this.compactionRequested = false;
		this.deps.live.emit(compactionStarted(event));
		this.compactionStart?.();
		this.compactionStart = undefined;
	}

	/** Pi can end a compaction it never started (pi `src/core/agent-session.ts:3083`): the contract has no such event, so it is a notice. */
	private compactionEnded(event: PiEvent<"compaction_end">): void {
		if (this.deps.live.snapshot().compaction) {
			this.deps.live.emit(compactionFinished(event));
			this.deps.usage.refresh();
		} else if (event.errorMessage) {
			this.deps.live.emit(noticeEvent("error", event.errorMessage));
		}
		if (this.deps.runs.compacting) this.deps.runs.end(compactionRunOutcome(event));
	}

	/** A run must always end: whatever fails while it is being closed is reported, and `run_finished` still follows. */
	private settled(aborted: boolean): void {
		let closing: AgentEvent[] = [];
		try {
			closing = [...(this.stream?.abandon() ?? []), ...this.tools.closing()];
			this.deps.hooks.settling();
		} catch (error) {
			this.fault(error);
		}
		const lastAssistant = this.lastAssistant;
		this.stream = undefined;
		this.lastAssistant = undefined;
		this.deps.runs.settle(aborted, lastAssistant, closing);
		this.deps.prompts.endRun();
		this.deps.queue.forgetDelivering();
		if (!aborted && this.requireSession().pendingMessageCount > 0)
			this.deps.live.emit(noticeEvent("warning", LEFT_QUEUED));
	}

	private fault(error: unknown): void {
		this.deps.live.emit(faultEvent(error));
	}

	private requireSession(): AgentSession {
		if (!this.session) throw new Error("the event bridge is not attached to a session");
		return this.session;
	}
}
