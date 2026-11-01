/**
 * What the host does with each frame of its CLI beyond showing it: run boundaries (D7), the queue's lifecycle (D8),
 * the model, the mode, the asks' withdrawals, the catalogue's news and the tasks. What a frame shows is the mapper's.
 */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AskDesk } from "../ports/asks";
import type { CatalogueAccess } from "../ports/catalogue";
import type { SessionEmitter } from "../ports/live";
import type { FrameMapper, MappedEvent, MappingPort } from "../ports/mapping";
import type { CommandLifecycle } from "../ports/sdk";
import { asCommandLifecycle } from "../sdk/lifecycle";
import type { ChildRouter } from "./child-router";
import type { InputQueue } from "./queue";
import type { RunTracker } from "./run-tracker";
import type { SessionSettings } from "./settings";
import type { TaskBoard } from "./task-board";

type SystemFrame = Extract<SDKMessage, { type: "system" }>;
type EntryFrame = Extract<SDKMessage, { type: "user" | "assistant" }>;

export interface FrameDeps {
	readonly live: SessionEmitter;
	readonly runs: RunTracker;
	readonly queue: InputQueue;
	readonly tasks: TaskBoard;
	readonly children: ChildRouter;
	readonly desk: AskDesk;
	readonly settings: SessionSettings;
	readonly mapping: MappingPort;
	readonly mapper: () => FrameMapper;
	readonly catalogue: CatalogueAccess;
	readonly cwd: string;
	readonly emitMapped: (events: readonly MappedEvent[]) => void;
	/** The CLI wrote the session's file: a resume finds it. */
	readonly persisted: () => void;
	/** A run begins that no send of ours started (a wake-up turn, a background task). */
	readonly systemRun: () => void;
	readonly endRun: () => void;
	readonly cancelledBeforeStart: () => void;
	readonly conversationReset: (newConversationId: string) => void;
}

export class FrameHandler {
	constructor(private readonly deps: FrameDeps) {}

	handle(frame: SDKMessage): void {
		const lifecycle = asCommandLifecycle(frame);
		if (lifecycle) {
			this.lifecycle(lifecycle);
			return;
		}
		switch (frame.type) {
			case "system":
				this.system(frame);
				return;
			case "result":
				this.deps.runs.noteTurn(this.deps.mapping.turnOutcome(frame));
				break;
			case "assistant":
			case "user":
				this.entry(frame);
				this.deps.runs.markStarted();
				break;
			case "stream_event":
				this.deps.runs.markStarted();
				break;
			case "conversation_reset":
				this.deps.conversationReset(frame.new_conversation_id);
				return;
			default:
				break;
		}
		this.show(frame);
	}

	private system(frame: SystemFrame): void {
		const { deps } = this;
		switch (frame.subtype) {
			case "session_state_changed":
				this.state(frame.state);
				return;
			case "init":
				deps.persisted();
				deps.settings.modelFromInit(frame.model);
				deps.settings.modeFromFrame(frame.permissionMode);
				deps.runs.markStarted();
				break;
			case "status":
				if (frame.permissionMode !== undefined) deps.settings.modeFromFrame(frame.permissionMode);
				break;
			case "elicitation_complete":
				deps.desk.elicitationComplete(frame.elicitation_id);
				break;
			case "commands_changed":
				deps.catalogue.invalidate(deps.cwd);
				break;
			case "background_tasks_changed":
				deps.tasks.replace(frame);
				break;
			case "task_started":
				deps.tasks.started(frame);
				break;
			case "task_updated":
				deps.tasks.updated(frame);
				break;
			case "task_notification":
				deps.tasks.finished(frame);
				deps.children.taskEnded(frame.task_id, frame.status);
				break;
			default:
				break;
		}
		this.show(frame);
	}

	private state(state: "idle" | "running" | "requires_action"): void {
		const { runs } = this.deps;
		if (state === "idle") {
			this.deps.endRun();
			return;
		}
		if (state === "running" && !runs.current) this.deps.systemRun();
		runs.markStarted();
	}

	/** Every main-thread `user` and `assistant` frame is a chain entry under its own uuid (D70). */
	private entry(frame: EntryFrame): void {
		if (frame.parent_tool_use_id !== null || frame.uuid === undefined) return;
		if ("agent_id" in frame && frame.agent_id !== undefined) return;
		this.deps.runs.noteEntry(frame.uuid);
	}

	private lifecycle(frame: CommandLifecycle): void {
		const { queue, live, runs } = this.deps;
		if (frame.state === "started" || frame.state === "completed") {
			const delivered = queue.settleSteered(frame.commandUuid);
			if (delivered) live.emit(delivered.event);
			if (frame.state === "started") runs.markStarted();
			return;
		}
		const run = runs.current;
		if (frame.state === "cancelled" && run?.aborting && !run.started) this.deps.cancelledBeforeStart();
	}

	private show(frame: SDKMessage): void {
		this.deps.emitMapped(this.deps.mapper().map(frame));
	}
}
