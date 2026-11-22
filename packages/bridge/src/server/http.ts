import { validateAuthToken } from "../auth-token";
import { createFetchHandler, type FetchHandlerDeps } from "../http-handler";
import { buildProxyPortAllowlist } from "../http-utils";
import { isLoopbackAddress } from "../security";
import type { HookIngress } from "./hook-ingress";
import type { BridgeLimits } from "./limits";
import type { LeveledLogger } from "./logger";
import type { BridgeState } from "./state";

export type HttpWiringDeps = {
	state: BridgeState;
	log: LeveledLogger;
	limits: BridgeLimits;
	version: string;
	/** `/hook/<backend>` and `/cc-terminal-hook` (`server/hook-ingress.ts`). */
	hookIngress: HookIngress;
	/** The bridge's MCP server at `/mcp`. */
	handleMcp?: (request: Request) => Promise<Response>;
};

/** The loopback listener's fetch handler: auth, TLS enforcement, the dev-server proxy, the hooks and `/mcp`. */
export function createHttpFetch(deps: HttpWiringDeps): ReturnType<typeof createFetchHandler> {
	const { state } = deps;
	const allowedProxyPorts = buildProxyPortAllowlist();
	const fetchHandlerDeps: FetchHandlerDeps = {
		httpDeps: {
			tlsEnabled: state.tlsEnabled,
			version: deps.version,
			allowedProxyPorts,
			logUser: deps.log.logUser,
			hookIngress: deps.hookIngress,
		},
		allowTokenInUrl: state.allowTokenInUrl,
		validateAuthToken,
		getAuthToken: () => state.authToken,
		getHookToken: () => state.hookToken,
		sockets: state.sockets,
		maxClients: deps.limits.maxClients,
		tlsEnabled: state.tlsEnabled,
		isLoopbackAddress,
		allowedProxyPorts,
		log: deps.log.logInfo,
		logUser: deps.log.logUser,
		...(deps.handleMcp && { handleMcp: deps.handleMcp }),
	};
	return createFetchHandler(fetchHandlerDeps);
}
