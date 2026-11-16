/**
 * Background tasks, live: the list the CLI keeps (`background_tasks_changed`, whole each time) and each task's end
 * (`task_notification`). A task that runs in the foreground ends with its tool call, whose result shows it, so only a
 * task in the background ends as an activity.
 */

import type {
	SDKBackgroundTasksChangedMessage,
	SDKTaskNotificationMessage,
	SDKTaskStartedMessage,
	SDKTaskUpdatedMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { type BackgroundTask, MAX_LIST_ITEMS, MAX_TEXT_CHARS } from "../../../contract";
import { clip } from "../bounds";
import { mintActivityId } from "../ids";
import { isRecord } from "../json";
import { phoneLine } from "../phone-text";
import type { MappedEvent } from "../ports/mapping";
import { taskActivity, taskChildSession, taskKind, taskStatus } from "./activities";
import type { MapperState } from "./state";
import { wireId, wireToolCallId } from "./wire-id";

/** The task types that may block their tool call (`SDKTaskStartedMessage.is_backgrounded`); the rest always run behind it. */
const FOREGROUNDABLE: ReadonlySet<string> = new Set(["local_agent", "local_bash"]);

/** A frame newer or stranger than its type may hold anything in these fields. */
function text(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function milliseconds(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function rememberTask(state: MapperState, frame: SDKTaskStartedMessage): void {
	const taskId = wireId(frame.task_id);
	if (taskId === undefined) return;
	const toolId = wireToolCallId(frame.tool_use_id);
	const input = toolId === undefined ? undefined : state.openTools.get(toolId)?.input;
	const taskType = text(frame.task_type);
	const foregroundable = taskType !== undefined && FOREGROUNDABLE.has(taskType);
	state.rememberTask(taskId, {
		taskType,
		command: isRecord(input) ? text(input.command) : undefined,
		startedAt: state.now(),
		background: typeof frame.is_backgrounded === "boolean" ? frame.is_backgrounded : !foregroundable,
	});
}

/** A call moved to the background later (Ctrl+B, a timeout) ends as a background task. */
export function noteTaskUpdate(state: MapperState, frame: SDKTaskUpdatedMessage): void {
	const taskId = wireId(frame.task_id);
	const task = taskId === undefined ? undefined : state.tasks.get(taskId);
	if (task !== undefined && isRecord(frame.patch) && frame.patch.is_backgrounded === true) task.background = true;
}

/** Ambient tasks (watchers, housekeeping) are no activity, as the SDK asks of indicators. */
export function backgroundTasksEvents(state: MapperState, frame: SDKBackgroundTasksChangedMessage): MappedEvent[] {
	if (!Array.isArray(frame.tasks)) return [];
	const tasks = frame.tasks
		.filter((task) => isRecord(task) && task.ambient !== true)
		.slice(0, MAX_LIST_ITEMS)
		.flatMap((task): BackgroundTask[] => {
			const id = wireId(task.task_id);
			if (id === undefined) return [];
			const known = state.tasks.get(id);
			const taskType = text(task.task_type);
			const title = phoneLine(text(task.description) ?? "");
			const childSession = taskChildSession(state.seed.sessionId, taskType, id);
			return [
				{
					id,
					kind: taskKind(taskType),
					title: title === "" ? "Background task" : title,
					...(known?.command !== undefined && { command: clip(known.command, MAX_TEXT_CHARS) }),
					...(known !== undefined && { startedAt: known.startedAt }),
					...(childSession !== undefined && { childSession }),
				},
			];
		});
	return [{ event: { type: "background_tasks_changed", tasks } }];
}

export function taskEndEvents(state: MapperState, frame: SDKTaskNotificationMessage): MappedEvent[] {
	if (frame.skip_transcript === true || frame.ambient === true) return [];
	const taskId = wireId(frame.task_id);
	const known = taskId === undefined ? undefined : state.tasks.get(taskId);
	const toolId = wireToolCallId(frame.tool_use_id);
	const background = known?.background ?? (toolId === undefined || !state.openTools.has(toolId));
	if (!background) return [];
	const childSession = taskChildSession(state.seed.sessionId, known?.taskType, taskId);
	const durationMs = isRecord(frame.usage) ? milliseconds(frame.usage.duration_ms) : undefined;
	const activity = taskActivity({
		kind: taskKind(known?.taskType),
		summary: text(frame.summary),
		status: taskStatus(text(frame.status)),
		...(known?.command !== undefined && { command: known.command }),
		...(durationMs !== undefined && { durationMs }),
		...(childSession !== undefined && { childSession }),
	});
	return [{ event: { type: "activity", activityId: mintActivityId(), activity } }];
}
