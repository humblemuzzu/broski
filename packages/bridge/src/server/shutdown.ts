import { stopBridgeResources } from "../lifecycle/bridge-teardown";
import { DEFAULT_TEARDOWN_TIMEOUT_MS, type TeardownResult } from "../lifecycle/teardown";
import type { BridgeMcp } from "./bridge-mcp";
import type { ContractSeam } from "./contract-seam";
import type { LeveledLogger } from "./logger";
import type { BridgeState } from "./state";

export type StopDeps = {
	state: BridgeState;
	log: LeveledLogger;
	contract: ContractSeam;
	mcp?: Pick<BridgeMcp, "revokeAll">;
};

/**
 * Revokes the MCP tokens, then stops the sweep, the listeners and the core behind `server.stop()`, within the teardown
 * budget.
 */
export function createStop(deps: StopDeps): (force?: boolean) => Promise<TeardownResult> {
	const { state } = deps;
	return (force = true) => {
		deps.mcp?.revokeAll();
		if (state.sweepTimer) clearInterval(state.sweepTimer);
		return stopBridgeResources(
			{
				disposeBackends: () => deps.contract.stop(),
				stopServers: () => {
					state.secureServer?.stop(force);
					state.linkIngress?.stop();
				},
			},
			{ timeoutMs: DEFAULT_TEARDOWN_TIMEOUT_MS, log: deps.log.logError },
		);
	};
}
