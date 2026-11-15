/** An `InteractionDesk` over a bare live state, for the tests that need no Pi session. */

import { ToolCallIds } from "../../backends/pi/ids";
import { LiveState } from "../../backends/pi/live/live-state";
import type { AskHost, RunContext } from "../../backends/pi/ports";
import { InteractionDesk } from "../../backends/pi/ui/interactions";
import { emptySnapshot, type InteractionRequest } from "../../contract";
import { EventLog } from "./event_log";

export interface DeskRig {
	readonly desk: InteractionDesk;
	readonly live: LiveState;
	readonly log: EventLog;
	readonly aborts: { count: number };
	/** Makes the host report this run as active, or none. */
	setRun(runId: string | undefined): void;
	/** What the host reports as the active run's abort. */
	aborting: boolean;
	now: number;
}

export function deskRig(): DeskRig {
	const log = new EventLog();
	const live = new LiveState(emptySnapshot(), () => rig.now);
	live.attach(log.sink);
	let run: RunContext | undefined;
	const aborts = { count: 0 };
	const host: AskHost = {
		live,
		activeRun: () => run,
		inCommand: () => false,
		abortRun: () => {
			aborts.count += 1;
		},
		aborting: () => rig.aborting,
		now: () => rig.now,
	};
	const rig: DeskRig = {
		desk: new InteractionDesk(host),
		live,
		log,
		aborts,
		aborting: false,
		now: 1_000_000,
		setRun: (runId) => {
			run = runId === undefined ? undefined : { runId, tools: new ToolCallIds() };
		},
	};
	return rig;
}

export const CONFIRM: InteractionRequest = { kind: "confirm" };
export const TEXT: InteractionRequest = { kind: "text", multiline: false };
export const PERMISSION: InteractionRequest = {
	kind: "tool_permission",
	inputEditable: false,
	previews: [],
	options: [{ id: "allow", label: "Allow", effect: "allow", scope: "once", stopsRun: false, message: "none" }],
	grants: [],
	deliberate: false,
};
export const CHOICE: InteractionRequest = { kind: "choice", options: [{ value: "a", label: "A" }] };

export function pause(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
