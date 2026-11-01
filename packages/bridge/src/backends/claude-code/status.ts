/** Lane C · `status()`: binary found, version, auth, policy refusals; never fails (contract `BackendStatus`). */

import type { BackendStatus } from "../../contract";
import type { ClaudeCodeServices } from "./services";

export interface StatusDeps {
	readonly services: ClaudeCodeServices;
}

export async function claudeCodeStatus(_deps: StatusDeps): Promise<BackendStatus> {
	return {
		installed: false,
		auth: "unknown",
		usable: false,
		issues: [{ severity: "error", message: "the Claude Code contract adapter is not built yet" }],
	};
}
