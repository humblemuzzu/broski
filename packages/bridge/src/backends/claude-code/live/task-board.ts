/** The background tasks of a host, from its `background_tasks_changed` (replace) and `task_*` frames (STEP-3 §3 row 16). */

import type {
	SDKBackgroundTasksChangedMessage,
	SDKTaskNotificationMessage,
	SDKTaskStartedMessage,
	SDKTaskUpdatedMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { MAX_LIST_ITEMS, MAX_NAME_CHARS } from "../../../contract";
import { clip } from "../bounds";
import type { BackgroundTask, TaskStatus } from "../ports/live";

export class TaskBoard {
	private tasks = new Map<string, BackgroundTask>();
	private readonly toolUseIds = new Map<string, string>();

	list(): readonly BackgroundTask[] {
		return [...this.tasks.values()];
	}

	/** The set after a change: tasks it names keep the status the `task_*` frames gave them. */
	replace(frame: SDKBackgroundTasksChangedMessage): void {
		const next = new Map<string, BackgroundTask>();
		for (const task of frame.tasks.slice(0, MAX_LIST_ITEMS)) {
			if (task.ambient === true) continue;
			const known = this.tasks.get(task.task_id);
			next.set(task.task_id, this.row(task.task_id, task.description, task.task_type, known?.status ?? "running"));
		}
		this.tasks = next;
		for (const taskId of [...this.toolUseIds.keys()]) if (!next.has(taskId)) this.toolUseIds.delete(taskId);
	}

	started(frame: SDKTaskStartedMessage): void {
		if (frame.tool_use_id !== undefined && this.toolUseIds.size < MAX_LIST_ITEMS) {
			this.toolUseIds.set(frame.task_id, frame.tool_use_id);
		}
	}

	updated(frame: SDKTaskUpdatedMessage): void {
		const task = this.tasks.get(frame.task_id);
		const status = frame.patch.status;
		if (task && status !== undefined) this.tasks.set(frame.task_id, { ...task, status });
	}

	finished(frame: SDKTaskNotificationMessage): void {
		this.tasks.delete(frame.task_id);
		this.toolUseIds.delete(frame.task_id);
	}

	private row(taskId: string, description: string, taskType: string, status: TaskStatus): BackgroundTask {
		const toolUseId = this.toolUseIds.get(taskId);
		return {
			taskId,
			description: clip(description, MAX_NAME_CHARS),
			status,
			taskType,
			...(toolUseId !== undefined && { toolUseId }),
		};
	}
}
