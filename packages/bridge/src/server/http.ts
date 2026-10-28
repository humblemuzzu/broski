import { validateAuthToken } from "../auth-token";
import type { OpenCodeConnector } from "../connectors/opencode";
import { type CcPermissionHookContext, handleCcPermissionHook } from "../handlers/cc_permission_hook";
import { createFetchHandler, type FetchHandlerDeps, type HandleHttpDeps } from "../http-handler";
import { buildProxyPortAllowlist } from "../http-utils";
import { isLoopbackAddress } from "../security";
import type { BridgeLimits } from "./limits";
import type { LeveledLogger } from "./logger";
import type { BridgeState } from "./state";
import type { Streams } from "./streams";
import { safeString } from "./util";

export type HttpWiring = {
	allowedProxyPorts: Set<number>;
	makeFetch: () => ReturnType<typeof createFetchHandler>;
};

export type HttpWiringDeps = {
	state: BridgeState;
	streams: Streams;
	log: LeveledLogger;
	limits: BridgeLimits;
	version: string;
	getOpenCode: () => OpenCodeConnector | null;
	listFilesDirectly: (path: string) => Promise<unknown>;
	debugRts: boolean;
};

/** HTTP/WS upgrade fetch wiring: auth, TLS enforcement, dashboard, proxy and the permission hooks. */
export function createHttpWiring(deps: HttpWiringDeps): HttpWiring {
	const { state } = deps;
	const allowedProxyPorts = buildProxyPortAllowlist();

	const httpDeps: HandleHttpDeps = {
		tlsEnabled: state.tlsEnabled,
		webDistDir: state.webDistDir,
		version: deps.version,
		allowedProxyPorts,
		getOpenCode: deps.getOpenCode,
		listFilesDirectly: deps.listFilesDirectly,
		logUser: deps.log.logUser,
		handleCcPermissionHook: (request: Request) => {
			const hookCtx: CcPermissionHookContext = {
				emitCcStream: deps.streams.emitCcStream,
				logInfo: deps.log.logInfo,
				logDebug: deps.log.logDebug,
				DEBUG_RTS: deps.debugRts,
			};
			return handleCcPermissionHook(request, hookCtx);
		},
	};

	const fetchHandlerDeps: FetchHandlerDeps = {
		httpDeps,
		safeString,
		allowTokenInUrl: state.allowTokenInUrl,
		validateAuthToken,
		getAuthToken: () => state.authToken,
		sockets: state.sockets,
		maxClients: deps.limits.maxClients,
		tlsEnabled: state.tlsEnabled,
		isLoopbackAddress,
		allowedProxyPorts,
		log: deps.log.log,
		logUser: deps.log.logUser,
	};

	const makeFetch = () => createFetchHandler(fetchHandlerDeps);

	return { allowedProxyPorts, makeFetch };
}
