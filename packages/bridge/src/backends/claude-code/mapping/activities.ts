/**
 * What Claude Code reports that is not a turn, as contract activities: a background task's end, a slash command's
 * output, the output of a `!` shell escape. The live mapper, the transcript store and the terminal tail build them here,
 * so one report reads the same in all three.
 */

import {
	type Activity,
	type ActivityStatus,
	type BackgroundTaskKind,
	clipEnd,
	type SessionId,
	type SessionRef,
} from "../../../contract";
import { childRef } from "../ids";
import { phoneLine, phoneText } from "../phone-text";
import type { TaskNotification } from "./harness-text";

/** The CLI's task types of a subagent (`SDKBackgroundTasksChangedMessage.tasks[].task_type`); the rest are work. */
const AGENT_TASKS: ReadonlySet<string> = new Set(["local_agent", "remote_agent"]);
const LOCAL_AGENT = "local_agent";
/** A shell's output keeps its newest part: the phone shows its last lines. */
const LOG_CHARS = 64 * 1024;

export function taskKind(taskType: string | undefined): BackgroundTaskKind {
	return taskType !== undefined && AGENT_TASKS.has(taskType) ? "agent" : "task";
}

/** The session a local subagent's task runs in (D20). */
export function taskChildSession(
	sessionId: SessionId | undefined,
	taskType: string | undefined,
	taskId: string | undefined,
): SessionRef | undefined {
	if (sessionId === undefined || taskType !== LOCAL_AGENT || taskId === undefined) return undefined;
	const child = childRef(sessionId, taskId);
	return child === undefined ? undefined : { backend: "claude-code", sessionId: child };
}

/** `killed` is how a stopped task's status reads in a saved notification; an unknown status says nothing. */
export function taskStatus(status: string | undefined): ActivityStatus | undefined {
	switch (status) {
		case "completed":
		case "failed":
		case "running":
			return status;
		case "stopped":
		case "killed":
			return "stopped";
		default:
			return undefined;
	}
}

export interface TaskEnd {
	readonly kind: BackgroundTaskKind;
	readonly summary: string | undefined;
	readonly status: ActivityStatus | undefined;
	readonly command?: string;
	readonly durationMs?: number;
	readonly report?: string;
	readonly childSession?: SessionRef;
}

/** The CLI's own sentence leads ("Background command "npm test" failed with exit code 1"). */
export function taskActivity(end: TaskEnd): Activity {
	const title = phoneLine(end.summary ?? "");
	const report = end.report === undefined ? "" : phoneText(end.report).trim();
	return {
		kind: end.kind,
		title: title === "" ? (end.kind === "agent" ? "A subagent finished" : "A background task finished") : title,
		...(end.status !== undefined && { status: end.status }),
		...(end.command !== undefined && end.command !== "" && { command: phoneText(end.command) }),
		...(end.durationMs !== undefined && { durationMs: Math.max(0, Math.round(end.durationMs)) }),
		...(report !== "" && { body: { format: "markdown", text: report } }),
		...(end.childSession !== undefined && { childSession: end.childSession }),
	};
}

/** A saved `<task-notification>`, as the transcript and a terminal's session read it. */
export function savedTaskActivity(notification: TaskNotification, sessionId: SessionId | undefined): Activity {
	const { taskId, taskType } = notification;
	const childSession = taskChildSession(sessionId, taskType, taskId);
	return taskActivity({
		kind: taskKind(taskType),
		summary: notification.summary,
		status: taskStatus(notification.status),
		...(notification.result !== undefined && { report: notification.result }),
		...(childSession !== undefined && { childSession }),
	});
}

/** A slash command's printed result; undefined when it printed nothing. */
export function commandOutputActivity(text: string, failed: boolean): Activity | undefined {
	const shown = phoneText(text).trim();
	if (shown === "") return undefined;
	return {
		kind: "command",
		title: failed ? "The command failed" : "Command output",
		...(failed && { status: "failed" }),
		body: { format: "text", text: shown },
	};
}

/** What a `!` shell escape printed; undefined when it printed nothing. */
export function shellOutputActivity(stdout: string, stderr: string): Activity | undefined {
	const output = [stdout, stderr].map((part) => phoneText(part).trimEnd()).filter((part) => part !== "");
	if (output.length === 0) return undefined;
	return {
		kind: "command",
		title: "Shell output",
		body: { format: "log", text: clipEnd(output.join("\n"), LOG_CHARS) },
	};
}
