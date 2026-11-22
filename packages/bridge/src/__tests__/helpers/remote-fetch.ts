/**
 * The loopback listener's fetch handler as a request from another machine meets it. The real listener binds 127.0.0.1
 * alone, so no socket can show this: the handler is given a server whose `requestIP` names a LAN address, over TLS,
 * with a bridge token that every request passes.
 */

import { createFetchHandler } from "../../http-handler";
import { isLoopbackAddress } from "../../security";
import type { HookIngress } from "../../server/hook-ingress";

export interface RemoteRoutes {
	readonly hookIngress: HookIngress;
	readonly handleMcp?: (request: Request) => Promise<Response>;
}

export function fetchFrom(address: string, routes: RemoteRoutes): (request: Request) => Promise<Response | undefined> {
	const handler = createFetchHandler({
		httpDeps: {
			tlsEnabled: true,
			version: "0.0.0-test",
			allowedProxyPorts: new Set(),
			logUser: () => undefined,
			hookIngress: routes.hookIngress,
		},
		allowTokenInUrl: false,
		validateAuthToken: () => true,
		getAuthToken: () => "bridge-token",
		getHookToken: () => "hook-token",
		sockets: new Set(),
		maxClients: 4,
		tlsEnabled: true,
		isLoopbackAddress,
		allowedProxyPorts: new Set(),
		log: () => undefined,
		logUser: () => undefined,
		...(routes.handleMcp && { handleMcp: routes.handleMcp }),
	});
	const server = { requestIP: () => ({ address }) };
	return (request) => handler(request, server);
}
