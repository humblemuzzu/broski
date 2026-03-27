import * as pi from "../connectors/pi";
import type { ServerMessage } from "../types";

type Reply = (message: ServerMessage) => void;

export async function handle(message: any, reply: Reply): Promise<boolean> {
	const cwd =
		typeof message?.projectPath === "string" && message.projectPath.trim()
			? message.projectPath.trim()
			: typeof message?.cwd === "string" && message.cwd.trim()
				? message.cwd.trim()
				: undefined;

	switch (message.type) {
		case "pi_abort_compaction": {
			const instance = await pi.getOrCreateInstance(cwd);
			instance.session.abortCompaction();
			reply({ type: "pi_compaction_aborted", data: true, requestId: message.requestId });
			return true;
		}

		case "pi_abort_branch_summary": {
			const instance = await pi.getOrCreateInstance(cwd);
			instance.session.abortBranchSummary();
			reply({ type: "pi_branch_summary_aborted", data: true, requestId: message.requestId });
			return true;
		}

		case "pi_abort_bash": {
			const instance = await pi.getOrCreateInstance(cwd);
			instance.session.abortBash();
			reply({ type: "pi_bash_aborted", data: true, requestId: message.requestId });
			return true;
		}

		default:
			return false;
	}
}
