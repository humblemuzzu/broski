/**
 * What the host does with each frame of its CLI beyond showing it: run boundaries (D8), the queue's lifecycle (D9),
 * the model, the mode, the asks' withdrawals, the catalogue's news and the subagents' ends. What a frame shows is the
 * mapper's.
 */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { MAX_TEXT_CHARS, type SessionId } from "../../../contract";
import { clip } from "../bounds";
import { imageAttachmentId } from "../ids";
import { isRecord } from "../json";
import { base64ImageOf } from "../mapping/images";
import type { AskDesk } from "../ports/asks";
import type { CatalogueAccess } from "../ports/catalogue";
import type { SessionEmitter } from "../ports/live";
import type { FrameMapper, MappedEvent, MappingPort } from "../ports/mapping";
import type { CommandLifecycle } from "../ports/sdk";
import { asCommandLifecycle } from "../sdk/lifecycle";
import type { ChildRouter } from "./child-router";
import type { LiveImageCache } from "./image-cache";
import type { InputQueue } from "./queue";
import type { RunTracker } from "./run-tracker";
import type { SessionSettings } from "./settings";

type SystemFrame = Extract<SDKMessage, { type: "system" }>;
type EntryFrame = Extract<SDKMessage, { type: "user" | "assistant" }>;

export interface FrameDeps {
	readonly live: SessionEmitter;
	readonly runs: RunTracker;
	readonly queue: InputQueue;
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
	/** Asks the CLI to stop the run again. */
	readonly stopAgain: () => void;
	readonly conversationReset: (newConversationId: string) => void;
	readonly sessionId?: () => SessionId;
	readonly images?: LiveImageCache;
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
				if (frame.type === "user") this.cacheFrameImages(frame);
				this.entry(frame);
				this.began();
				break;
			case "stream_event":
				this.began();
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
				this.began();
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
			case "task_notification":
				deps.children.taskEnded(frame.task_id, frame.status);
				break;
			default:
				break;
		}
		this.show(frame);
	}

	/**
	 * The CLI began the run's turn. A Stop asked for before that reached the CLI ahead of the message it was meant for
	 * (the receipt then lists nothing), so it is asked for again now that there is a turn to stop.
	 */
	private began(): void {
		const { runs } = this.deps;
		if (runs.markStarted() && runs.current?.aborting) this.deps.stopAgain();
	}

	private state(state: "idle" | "running" | "requires_action"): void {
		const { runs } = this.deps;
		if (state === "idle") {
			this.deps.endRun();
			return;
		}
		if (state === "running" && !runs.current) this.deps.systemRun();
		this.began();
	}

	/** Every main-thread `user` and `assistant` frame is a chain entry under its own uuid (D26). */
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
			if (frame.state === "started") this.began();
			return;
		}
		if (frame.state !== "cancelled") return;
		const run = runs.current;
		if (run?.aborting) {
			if (!run.started) this.deps.cancelledBeforeStart();
			return;
		}
		const dropped = queue.settleSteered(frame.commandUuid);
		if (dropped && dropped.text !== "") {
			live.emit({ type: "input_returned", texts: [clip(dropped.text, MAX_TEXT_CHARS)] });
		}
	}

	private show(frame: SDKMessage): void {
		this.deps.emitMapped(this.deps.mapper().map(frame));
	}

	private cacheFrameImages(frame: Extract<SDKMessage, { type: "user" }>): void {
		const cache = this.deps.images;
		const sessionId = this.deps.sessionId?.();
		const uuid = frame.uuid;
		const content = frame.message.content;
		if (cache === undefined || sessionId === undefined || !uuid || !Array.isArray(content)) return;
		content.forEach((block, blockIndex) => {
			const top = base64ImageOf(block);
			if (top !== undefined) {
				cache.put(sessionId, imageAttachmentId(uuid, blockIndex), top);
				return;
			}
			if (isRecord(block) && block.type === "tool_result" && Array.isArray(block.content)) {
				block.content.forEach((inner, innerIndex) => {
					const nested = base64ImageOf(inner);
					if (nested !== undefined) cache.put(sessionId, imageAttachmentId(uuid, blockIndex, innerIndex), nested);
				});
			}
		});
	}
}
