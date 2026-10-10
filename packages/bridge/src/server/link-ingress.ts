import type { Connections } from "./connections";
import type { BridgeLimits } from "./limits";
import { isLinkSocketData, readLinkHeaders } from "./link-identity";
import { hardenLinkSocketFile, prepareLinkSocketPath, removeLinkSocketFile } from "./link-socket-path";
import type { LeveledLogger } from "./logger";
import type { BridgeState } from "./state";

export type LinkIngress = {
	stop: () => void;
};

export type LinkIngressDeps = {
	socketPath: string;
	state: BridgeState;
	connections: Connections;
	limits: BridgeLimits;
	log: LeveledLogger;
};

/**
 * A second ingress for the broski-link daemon: the same WebSocket handler object as the network
 * server, on a private unix socket where the upgrade carries a device identity instead of a token.
 */
export async function startLinkIngress(deps: LinkIngressDeps): Promise<LinkIngress> {
	await prepareLinkSocketPath(deps.socketPath);
	const server = Bun.serve({
		unix: deps.socketPath,
		fetch: (request, server) => handleLinkRequest(request, server, deps),
		websocket: deps.connections.websocketConfig,
	});
	const stop = (): void => {
		server.stop(true);
		removeLinkSocketFile(deps.socketPath);
	};
	try {
		hardenLinkSocketFile(deps.socketPath);
		deps.log.logInfo(`[Link] broski-link ingress listening on ${deps.socketPath}`);
	} catch (error) {
		stop();
		throw error;
	}
	return { stop };
}

async function handleLinkRequest(
	request: Request,
	server: Bun.Server<unknown>,
	deps: LinkIngressDeps,
): Promise<Response | undefined> {
	if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
		return new Response("Not found", { status: 404 });
	}

	const identity = readLinkHeaders(request.headers);
	if (!identity.ok) {
		deps.log.logUser(`[Link] Rejected upgrade: ${identity.error}`);
		return new Response(identity.error, { status: identity.status });
	}

	if (countLinkSockets(deps.state) >= deps.limits.linkMaxClients) {
		deps.log.logUser("[Link] Rejected upgrade: too many link clients");
		return new Response("Too many link clients", { status: 429 });
	}

	if (server.upgrade(request, { data: identity.data })) {
		deps.log.logInfo(
			identity.data.kind === "link-daemon"
				? "[Link] Daemon feed attaching"
				: `[Link] Device ${identity.data.deviceId.slice(0, 8)} attaching`,
		);
		return undefined;
	}
	return new Response("WebSocket upgrade failed", { status: 500 });
}

function countLinkSockets(state: BridgeState): number {
	let count = 0;
	for (const ws of state.sockets) {
		if (isLinkSocketData(ws.data)) count++;
	}
	return count;
}
