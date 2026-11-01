import { uninstallCcHook } from "../handlers/cc_hook_installer";
import { stopBridgeResources } from "../lifecycle/bridge-teardown";
import { DEFAULT_TEARDOWN_TIMEOUT_MS, type TeardownResult } from "../lifecycle/teardown";
import type { PtyRuntime } from "../pty/runtime";
import type { ContractSeam } from "./contract-seam";
import type { FsWatchers } from "./fs-watchers";
import type { LeveledLogger } from "./logger";
import type { BridgeState } from "./state";

export type StopDeps = {
	state: BridgeState;
	log: LeveledLogger;
	fsWatchers: FsWatchers;
	ptyRuntime: PtyRuntime;
	contract: ContractSeam;
	/** False with `claudeCode.contract`: the old hook was never installed, and the adapter's own hook stays. */
	keepsOldHook: boolean;
};

/** Cancels the timers, drains the waiters, and runs the resource teardown behind `server.stop()`. */
export function createStop(deps: StopDeps): (force?: boolean) => Promise<TeardownResult> {
	const { state } = deps;

	return (force = true) => {
		if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
		if (state.tickTimer) clearInterval(state.tickTimer);
		if (state.eventBufferPruneTimer) clearInterval(state.eventBufferPruneTimer);
		for (const waiter of state.ccPermissionWaiters.values()) {
			clearTimeout(waiter.timer);
			waiter.resolve({ response: "reject" });
		}
		state.ccPermissionWaiters.clear();
		for (const waiter of state.ccElicitationWaiters.values()) {
			clearTimeout(waiter.timer);
			waiter.resolve({ action: "cancel" });
		}
		state.ccElicitationWaiters.clear();
		for (const unregister of state.unregisterBoundedState) unregister();

		return stopBridgeResources(
			{
				externalTails: [state.ccExternalTails],
				eventBuffers: [state.ccEventBuffers],
				closeFsWatchers: () => deps.fsWatchers.closeAll(),
				stopPtyRuntime: () => deps.ptyRuntime.stop(),
				uninstallHooks: deps.keepsOldHook ? [() => uninstallCcHook(deps.log.logInfo)] : [],
				disposeBackends: [() => deps.contract.stop()],
				stopServers: () => {
					state.secureServer?.stop(force);
					state.linkIngress?.stop();
				},
			},
			{ timeoutMs: DEFAULT_TEARDOWN_TIMEOUT_MS, log: deps.log.logError },
		);
	};
}
