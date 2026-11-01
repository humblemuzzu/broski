/** `tasks` (D22): a session's background work from its host's task state, and stopping a task. */

import type { ActionListTone, BackendCallResult, TasksOp } from "../../../contract";
import type { BackgroundTask, HostView, OpsDeps, TaskStatus } from "../ports";
import { isRejected, rejected } from "../rejections";
import { guarded } from "./guard";
import { messageOf } from "./host-access";
import { action, actionList, findAction, type RowSpec } from "./list-rows";

const STATUS: Record<TaskStatus, { label: string; tone: ActionListTone }> = {
	pending: { label: "waiting", tone: "busy" },
	running: { label: "running", tone: "busy" },
	paused: { label: "paused", tone: "warning" },
	completed: { label: "done", tone: "ok" },
	failed: { label: "failed", tone: "error" },
	killed: { label: "stopped", tone: "neutral" },
	stopped: { label: "stopped", tone: "neutral" },
};

const STOPPABLE = new Set<TaskStatus>(["pending", "running", "paused"]);

function rowOf(task: BackgroundTask): RowSpec {
	return {
		id: task.taskId,
		title: task.description,
		status: STATUS[task.status] ?? { label: String(task.status), tone: "neutral" },
		badges: task.taskType === undefined ? [] : [task.taskType],
		actions: STOPPABLE.has(task.status) ? [action("stop", "Stop", true)] : [],
	};
}

function listOf(host: HostView | undefined, note?: string) {
	const tasks = host?.tasks() ?? [];
	const empty =
		host === undefined
			? "Nothing is running: this session is not open on the Mac."
			: "No background work in this session.";
	return actionList(tasks.map(rowOf), note ?? (tasks.length === 0 ? empty : undefined));
}

export async function tasks(deps: OpsDeps, op: TasksOp): Promise<BackendCallResult> {
	return guarded("tasks", async () => {
		const result = await deps.live.withLiveHost(op.sessionId, async (host) => {
			if (op.change === undefined) return { kind: "tasks" as const, list: listOf(host) };
			const found = findAction(listOf(host).rows, op.change);
			if (isRejected(found)) return found;
			if (host === undefined) return rejected("not_found", `no task ${op.change.rowId}`);
			try {
				await host.query.stopTask(found.row.id);
			} catch (error) {
				return rejected("backend_error", `stop ${found.row.title}: ${messageOf(error)}`);
			}
			return { kind: "tasks" as const, list: listOf(host, `Asked ${found.row.title} to stop.`) };
		});
		return result;
	});
}
