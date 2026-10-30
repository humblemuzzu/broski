/**
 * What a hosted session binds its extensions to (pi `src/core/agent-session.ts:3318-3342`). An unset
 * binding keeps Pi's terminal default, so each one a phone cannot honour is bound on purpose.
 */

import type { AgentSession, ExtensionError, ExtensionUIContext } from "@earendil-works/pi-coding-agent";

type ExtensionBindings = Parameters<AgentSession["bindExtensions"]>[0];

export interface BindingTargets {
	readonly uiContext: ExtensionUIContext;
	readonly session: () => AgentSession;
	/** The adapter's abort path, which also settles the run's asks. */
	readonly abort: () => void;
	readonly report: (error: ExtensionError) => void;
}

export function extensionBindings(targets: BindingTargets): ExtensionBindings {
	return {
		uiContext: targets.uiContext,
		mode: "rpc",
		onError: targets.report,
		abortHandler: targets.abort,
		commandContextActions: {
			waitForIdle: () => targets.session().waitForIdle(),
			newSession: () => unavailable("start a new session"),
			fork: () => unavailable("fork the session"),
			switchSession: () => unavailable("switch sessions"),
			navigateTree: () => unavailable("navigate the session tree"),
			reload: () => unavailable("reload extensions"),
		},
	};
}

/**
 * Pi's defaults resolve `{cancelled: false}` having done nothing (pi `src/core/extensions/runner.ts:553-570`);
 * a throw fails the command visibly (`src/core/agent-session.ts:2195-2202`), and a reload mid-run is forbidden (D18).
 * `shutdownHandler` stays unset: an extension cannot stop the bridge, and without one `ctx.shutdown()` does nothing.
 */
function unavailable(what: string): Promise<never> {
	return Promise.reject(new Error(`The phone cannot ${what}.`));
}
