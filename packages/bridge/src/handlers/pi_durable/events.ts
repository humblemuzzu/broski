import type { AgentEvent, SnapshotEvent } from "@earendil-works/pi-durable";
import type { PiDurableInterruptedWork, PiDurablePermissionRequest } from "../../connectors/pi-durable";
import { enrichRuntimeEvent } from "../../runtime/stream-contract";
import type { BroskiPermissionRequestedEvent, BroskiRuntimeEvent } from "../../types/runtime";

export type PiDurableEventContext = {
	sessionId: string;
	cwd?: string;
};

const STATE_EVENT_TYPES = new Set<AgentEvent["type"]>([
	"snapshot",
	"run_start",
	"run_end",
	"turn_end",
	"inbox_update",
	"agent_changed",
	"compaction_start",
	"compaction_end",
	"auto_retry_start",
	"auto_retry_end",
	"task_failed",
]);

export function isPiDurableStateEvent(event: AgentEvent): boolean {
	return STATE_EVENT_TYPES.has(event.type);
}

export function piDurableSnapshotIn(events: readonly AgentEvent[]): SnapshotEvent | undefined {
	for (const event of events) {
		if (event.type === "snapshot") return event;
	}
	return undefined;
}

export function piDurablePermissionRequestEvent(
	request: PiDurablePermissionRequest,
	context: PiDurableEventContext,
	replayed: boolean,
): BroskiPermissionRequestedEvent {
	return enrichRuntimeEvent(
		{
			type: "permission_requested",
			backend: "pi-durable",
			timestampMs: Date.now(),
			sessionId: context.sessionId,
			...(context.cwd !== undefined ? { cwd: context.cwd } : {}),
			request: {
				requestId: request.requestId,
				kind: request.toolName,
				title: request.title,
				options: ["allow", "deny"],
				metadata: { tool: request.toolName, input: request.input, sessionId: context.sessionId },
			},
		},
		{ backend: "pi-durable", isReplay: replayed },
	);
}

export function piDurableResumedEvent(
	interrupted: PiDurableInterruptedWork,
	context: PiDurableEventContext,
): BroskiRuntimeEvent {
	return enrichRuntimeEvent(
		{
			type: "backend_event",
			backend: "pi-durable",
			timestampMs: Date.now(),
			sessionId: context.sessionId,
			...(context.cwd !== undefined ? { cwd: context.cwd } : {}),
			kind: "resumed",
			payload: { tasks: interrupted.tasks.length, submissions: interrupted.submissions.length },
		},
		{ backend: "pi-durable" },
	);
}
