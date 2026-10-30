/** `backend.call` `run_shell` (contract README §13): `!command` in a session this bridge runs. */

import type { BackendCallResult, RunShellOp } from "../../../contract";
import type { SessionHosts } from "../live/session-hosts";
import type { SessionStore } from "../ports";
import { rejected } from "../rejections";

export interface RunShellDeps {
	readonly hosts: Pick<SessionHosts, "runShell">;
	readonly store: Pick<SessionStore, "locate">;
}

export async function runShellOp(deps: RunShellDeps, op: RunShellOp): Promise<BackendCallResult> {
	const running = deps.hosts.runShell(op);
	if (running !== undefined) return running;
	const stored = await deps.store.locate(op.sessionId);
	if ("status" in stored) return stored;
	return rejected("unsupported", "a command runs only in a session this bridge runs: open it, or take it over first");
}
