/**
 * The loopback listener's HTTP routes (the status root, the terminal hooks, the bridge's MCP server) and its fetch
 * handler factory (auth, origin and TLS checks, WebSocket upgrades).
 */
import type { ServerWebSocket } from "bun";
import {
	extractTokenFromRequest,
	isAllowedBrowserRequest,
	isAllowedOrigin,
	jsonResponse,
	publicJson,
	toErrorMessage,
	toPublicErrorMessage,
} from "./http-utils";
import { MCP_PATH } from "./mcp";
import type { HookIngress } from "./server/hook-ingress";

// ── handleHttpRequest Dependencies ─────────────────────────────────────

export interface HandleHttpDeps {
	version: string;
	hookIngress?: HookIngress;
}

/** Handles one HTTP request that passed the fetch handler's checks. */
export async function handleHttpRequest(request: Request, deps: HandleHttpDeps): Promise<Response> {
	const url = new URL(request.url);

	// ── Root status endpoint ───────────────────────────────────────────
	if (url.pathname === "/") {
		return jsonResponse({ status: "ok", version: deps.version });
	}

	if (deps.hookIngress?.owns(url.pathname)) return await deps.hookIngress.handle(request);

	return new Response("Not found", { status: 404 });
}

// ── createFetchHandler Dependencies ────────────────────────────────────

export interface FetchHandlerDeps {
	httpDeps: HandleHttpDeps;
	allowTokenInUrl: boolean;
	validateAuthToken: (provided: string, expected: string) => boolean;
	getAuthToken: () => string;
	/** The hook routes' own token, which opens nothing else; the bridge's token does not open them. */
	getHookToken: () => string;
	sockets: Set<ServerWebSocket<unknown>>;
	maxClients: number;
	tlsEnabled: boolean;
	isLoopbackAddress: (addr: string | undefined) => boolean;
	log: (msg: string) => void;
	logUser: (msg: string) => void;
	/** `/mcp`, which authenticates with its own per-session tokens rather than the bridge's. */
	handleMcp?: (request: Request) => Promise<Response>;
}

/**
 * What only this machine may reach: `/mcp`, answered here since it takes its own tokens and not the bridge's, and the
 * hooks, refused here from elsewhere and answered once the hook token is checked. Undefined for every other path.
 */
async function loopbackOnlyRoute(
	request: Request,
	url: URL,
	isLoopback: boolean,
	deps: FetchHandlerDeps,
): Promise<Response | undefined> {
	const mcp = url.pathname === MCP_PATH ? deps.handleMcp : undefined;
	if (mcp === undefined && !deps.httpDeps.hookIngress?.owns(url.pathname)) return undefined;
	if (!isLoopback || !isAllowedBrowserRequest(request)) return new Response("Forbidden", { status: 403 });
	if (mcp === undefined) return undefined;
	try {
		return await mcp(request);
	} catch (error) {
		deps.log(`[MCP] Error: ${toErrorMessage(error)}`);
		return publicJson({ error: toPublicErrorMessage(error) }, 500);
	}
}

/**
 * Creates a `fetch` handler for Bun.serve with auth, origin checking,
 * TLS enforcement, and WebSocket upgrade logic.
 */
export function createFetchHandler(deps: FetchHandlerDeps) {
	return async (request: Request, serverInstance: any): Promise<Response | undefined> => {
		const url = new URL(request.url);

		if (!deps.allowTokenInUrl && url.searchParams.has("token")) {
			return publicJson({ error: "Token in URL not allowed" }, 400);
		}

		const isWebSocketUpgrade = request.headers.get("upgrade")?.toLowerCase() === "websocket";
		if (isWebSocketUpgrade) {
			if (deps.sockets.size >= deps.maxClients) {
				deps.logUser(`[Security] WS rejected: too many clients (${deps.sockets.size} >= ${deps.maxClients})`);
				return new Response("Too many clients", { status: 429 });
			}
			const origin = request.headers.get("origin");
			if (!isAllowedOrigin(origin)) {
				deps.logUser(`[Security] WS rejected (origin): ${origin}`);
				return new Response("Forbidden", { status: 403 });
			}
		}

		const requestIp = (() => {
			try {
				const ip = serverInstance?.requestIP?.(request);
				if (!ip) return undefined;
				if (typeof ip === "string") return ip;
				return typeof ip.address === "string" ? ip.address : undefined;
			} catch {
				return undefined;
			}
		})();
		const isLoopback = deps.isLoopbackAddress(requestIp);

		if (!deps.tlsEnabled && !isLoopback) {
			return new Response("TLS required for non-local connections", { status: 403 });
		}

		if (!isWebSocketUpgrade) {
			const routed = await loopbackOnlyRoute(request, url, isLoopback, deps);
			if (routed) return routed;
		}

		const providedToken = extractTokenFromRequest(url, request);
		const hookRoute = !isWebSocketUpgrade && deps.httpDeps.hookIngress?.owns(url.pathname) === true;
		const expectedToken = hookRoute ? deps.getHookToken() : deps.getAuthToken();
		const isValidToken = !!(providedToken && deps.validateAuthToken(providedToken, expectedToken));

		if (isWebSocketUpgrade) {
			if (!isValidToken) {
				deps.logUser("[Security] WS rejected (auth)");
				return new Response("Unauthorized", { status: 401 });
			}
			if (serverInstance.upgrade(request)) return;
			return new Response("WebSocket upgrade failed", { status: 500 });
		}

		if (!isValidToken) {
			return publicJson({ error: "Unauthorized" }, 401);
		}

		try {
			return await handleHttpRequest(request, deps.httpDeps);
		} catch (error) {
			deps.log(`[HTTP] Error: ${toErrorMessage(error)}`);
			return publicJson({ error: toPublicErrorMessage(error) }, 500);
		}
	};
}
