import { validateAuthToken } from "../auth-token";
import { createFetchHandler, type FetchHandlerDeps } from "../http-handler";
import { buildProxyPortAllowlist } from "../http-utils";
import { isLoopbackAddress } from "../security";
import type { TerminalHookReceiver } from "./cc-terminal-hook";
import type { BridgeLimits } from "./limits";
import type { LeveledLogger } from "./logger";
import type { BridgeState } from "./state";

export type HttpWiringDeps = {
	state: BridgeState;
	log: LeveledLogger;
	limits: BridgeLimits;
	version: string;
	/** The Claude Code terminal hook's receiver (adapter README D29), served while `claudeCode.terminalAsks` is on. */
	terminalHook?: TerminalHookReceiver;
};

/** The loopback listener's fetch handler: auth, TLS enforcement, the dev-server proxy and the terminal hook. */
export function createHttpFetch(deps: HttpWiringDeps): ReturnType<typeof createFetchHandler> {
	const { state } = deps;
	const allowedProxyPorts = buildProxyPortAllowlist();
	const fetchHandlerDeps: FetchHandlerDeps = {
		httpDeps: {
			tlsEnabled: state.tlsEnabled,
			version: deps.version,
			allowedProxyPorts,
			logUser: deps.log.logUser,
			...(deps.terminalHook && { handleCcTerminalHook: deps.terminalHook.handle }),
		},
		allowTokenInUrl: state.allowTokenInUrl,
		validateAuthToken,
		getAuthToken: () => state.authToken,
		sockets: state.sockets,
		maxClients: deps.limits.maxClients,
		tlsEnabled: state.tlsEnabled,
		isLoopbackAddress,
		allowedProxyPorts,
		log: deps.log.logInfo,
		logUser: deps.log.logUser,
	};
	return createFetchHandler(fetchHandlerDeps);
}
