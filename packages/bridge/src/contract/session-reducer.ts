import type { SinkRecord } from "./backend";
import { clipEnd } from "./clip";
import type { ToolUpdatedEvent } from "./events";
import { MAX_TEXT_CHARS } from "./limits";
import { nextRun } from "./run-items";
import type { SessionStatus } from "./sessions";
import type { RunningTool, SessionSnapshot } from "./snapshot";

export function emptySnapshot(): SessionSnapshot {
	return { blocks: [], tools: [], interactions: [], queue: [], backgroundTasks: [], modes: [] };
}

/** What a session is doing, as the snapshot says; never `unknown` for a session open in this bridge. */
export function sessionStatus(snapshot: SessionSnapshot): SessionStatus {
	if (snapshot.interactions.some((interaction) => interaction.blocksRun)) return "waiting_for_user";
	return snapshot.run ? "running" : "idle";
}

/** The live state after `record`. This is the meaning of every event; adapters and clients agree with it. */
export function applyEvent(snapshot: SessionSnapshot, record: Pick<SinkRecord, "at" | "event">): SessionSnapshot {
	const live = applyToLiveState(snapshot, record);
	if (!snapshot.run || !live.run) return live;
	const run = nextRun(live.run, snapshot, record);
	return run === live.run ? live : { ...live, run };
}

function applyToLiveState(snapshot: SessionSnapshot, record: Pick<SinkRecord, "at" | "event">): SessionSnapshot {
	const { at, event } = record;
	switch (event.type) {
		case "run_started":
			return {
				...snapshot,
				run: { runId: event.runId, trigger: event.trigger, startedAt: at, items: [], droppedItems: 0 },
			};
		case "run_finished":
			return { ...without(snapshot, "run", "retry"), lastOutcome: event.outcome };
		case "block_started":
			return {
				...snapshot,
				blocks: [
					...snapshot.blocks,
					{
						blockId: event.blockId,
						messageId: event.messageId,
						kind: event.kind,
						...(event.parentToolCallId !== undefined && { parentToolCallId: event.parentToolCallId }),
						text: "",
					},
				],
			};
		case "block_delta":
			return {
				...snapshot,
				blocks: snapshot.blocks.map((block) =>
					block.blockId === event.blockId ? { ...block, text: newestText(block.text + event.text) } : block,
				),
			};
		case "block_finished":
			return { ...snapshot, blocks: snapshot.blocks.filter((block) => block.blockId !== event.blockId) };
		case "tool_started": {
			const { type: _type, ...started } = event;
			return { ...snapshot, tools: [...snapshot.tools, { ...started, output: "", fileChanges: [] }] };
		}
		case "tool_updated":
			return {
				...snapshot,
				tools: snapshot.tools.map((tool) => (tool.toolCallId === event.toolCallId ? updateTool(tool, event) : tool)),
			};
		case "tool_finished":
			return { ...snapshot, tools: snapshot.tools.filter((tool) => tool.toolCallId !== event.toolCallId) };
		case "interaction_requested":
			return { ...snapshot, interactions: [...snapshot.interactions, event.interaction] };
		case "interaction_resolved":
			return {
				...snapshot,
				interactions: snapshot.interactions.filter((interaction) => interaction.id !== event.interactionId),
			};
		case "queue_changed":
			return { ...snapshot, queue: event.items };
		case "background_tasks_changed":
			return { ...snapshot, backgroundTasks: event.tasks };
		case "compaction_started":
			return { ...snapshot, compaction: { trigger: event.trigger, startedAt: at } };
		case "compaction_finished":
			return without(snapshot, "compaction");
		case "retry_scheduled": {
			const { type: _type, ...retry } = event;
			return { ...snapshot, retry };
		}
		case "retry_finished":
			return without(snapshot, "retry");
		case "usage_updated":
			return { ...snapshot, usage: event.usage };
		case "messages_retracted": {
			const retracted = new Set(event.messageIds);
			return {
				...snapshot,
				blocks: snapshot.blocks.filter((block) => !retracted.has(block.messageId)),
				tools: snapshot.tools.filter((tool) => tool.messageId === undefined || !retracted.has(tool.messageId)),
			};
		}
		case "model_changed":
			return {
				...without(snapshot, "modelId", "thinking"),
				...(event.modelId !== undefined && { modelId: event.modelId }),
				...(event.thinking !== undefined && { thinking: event.thinking }),
			};
		case "mode_changed": {
			const setting = { axis: event.axis, value: event.value };
			const known = snapshot.modes.some((mode) => mode.axis === event.axis);
			return {
				...snapshot,
				modes: known
					? snapshot.modes.map((mode) => (mode.axis === event.axis ? setting : mode))
					: [...snapshot.modes, setting],
			};
		}
		case "resynced":
			return event.snapshot;
		case "user_message":
		case "input_returned":
		case "notice":
		case "activity":
		case "error":
		case "extension":
		case "session_replaced":
			return snapshot;
	}
}

function updateTool(tool: RunningTool, event: ToolUpdatedEvent): RunningTool {
	const update = event.update;
	switch (update.kind) {
		case "input":
			return { ...tool, input: update.input };
		case "output_appended":
			return { ...tool, output: newestText(tool.output + update.text) };
		case "output_replaced":
			return { ...tool, output: update.text };
		case "progress":
			return { ...tool, progress: update.message };
		case "file_changes":
			return { ...tool, fileChanges: update.changes };
		case "child_session":
			return { ...tool, childSession: update.session };
	}
}

/** The last `MAX_TEXT_CHARS` of `text`, never starting inside a surrogate pair. */
function newestText(text: string): string {
	return clipEnd(text, MAX_TEXT_CHARS);
}

function without<K extends keyof SessionSnapshot>(snapshot: SessionSnapshot, ...keys: K[]): SessionSnapshot {
	const copy = { ...snapshot };
	for (const key of keys) delete copy[key];
	return copy;
}
