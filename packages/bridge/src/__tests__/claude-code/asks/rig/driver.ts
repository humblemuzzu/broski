/** The conformance driver for the ask rig: it can arrange an interaction of any kind and nothing else. */

import type { AgentBackend, BackendHost, SessionRef } from "../../../../contract";
import type { ConformanceDriver, Scenario } from "../../../../contract/testing/conformance-types";
import type { AskRigBackend } from "./ask-backend";

export class AskRigDriver implements ConformanceDriver {
	readonly cwd: string;
	readonly otherCwd = "/nowhere";

	constructor(
		private readonly backend: AskRigBackend,
		cwd: string,
	) {
		this.cwd = cwd;
	}

	async arrange(session: SessionRef, scenario: Scenario): Promise<boolean> {
		if (scenario.kind !== "interaction") return false;
		this.backend.arranged.set(session.sessionId, scenario.interaction);
		return true;
	}

	async seedSessions(): Promise<void> {}

	async release(): Promise<void> {}

	async quiesce(): Promise<void> {}

	async delivered(): Promise<undefined> {
		return undefined;
	}

	async backendCall(): Promise<undefined> {
		return undefined;
	}

	async runExternally(): Promise<boolean> {
		return false;
	}

	async restart(_host: BackendHost): Promise<AgentBackend> {
		return this.backend;
	}
}
