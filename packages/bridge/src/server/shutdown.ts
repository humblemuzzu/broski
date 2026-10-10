import * as pi from "../connectors/pi";
import { uninstallCcHook } from "../handlers/cc_hook_installer";
import { uninstallCxHook } from "../handlers/cx_hook_installer";
import * as piDurable from "../handlers/pi_durable";
import * as piFeatures from "../handlers/pi_features";
import { stopBridgeResources } from "../lifecycle/bridge-teardown";
import { DEFAULT_TEARDOWN_TIMEOUT_MS, type TeardownResult } from "../lifecycle/teardown";
import type { EndpointWatcher } from "../network/endpoint-watcher";
import type { PtyRuntime } from "../pty/runtime";
import type { CodexClient } from "./codex-client";
import type { FsWatchers } from "./fs-watchers";
import type { LeveledLogger } from "./logger";
import type { BridgeState } from "./state";

export type StopDeps = {
	state: BridgeState;
	log: LeveledLogger;
	fsWatchers: FsWatchers;
	ptyRuntime: PtyRuntime;
	codexClient: CodexClient;
	endpointWatcher: EndpointWatcher;
};

/** Cancels the timers, drains the waiters, and runs the resource teardown behind `server.stop()`. */
export function createStop(deps: StopDeps): (force?: boolean) => Promise<TeardownResult> {
	const { state } = deps;

	return (force = true) => {
		if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
		if (state.tickTimer) clearInterval(state.tickTimer);
		deps.endpointWatcher.stop();
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
		for (const waiter of state.cxApprovalWaiters.values()) {
			clearTimeout(waiter.timer);
			waiter.resolve({ response: "reject" });
		}
		state.cxApprovalWaiters.clear();
		for (const unregister of state.unregisterBoundedState) unregister();

		return stopBridgeResources(
			{
				externalTails: [state.ccExternalTails, state.cxExternalTails, state.ocExternalTails],
				eventBuffers: [state.ccEventBuffers, state.cxEventBuffers],
				closeFsWatchers: () => deps.fsWatchers.closeAll(),
				stopPtyRuntime: () => deps.ptyRuntime.stop(),
				uninstallHooks: [() => uninstallCcHook(deps.log.logInfo), () => uninstallCxHook(deps.log.logInfo)],
				stopCodexAppServer: () => deps.codexClient.stopCodexAppServer(),
				disposeBackends: [() => pi.disposeAll(), () => piFeatures.stopAllPiExternalTails(), () => piDurable.shutdown()],
				stopServers: () => {
					state.secureServer?.stop(force);
					state.loopbackServer?.stop(force);
					state.linkIngress?.stop();
				},
			},
			{ timeoutMs: DEFAULT_TEARDOWN_TIMEOUT_MS, log: deps.log.logError },
		);
	};
}
