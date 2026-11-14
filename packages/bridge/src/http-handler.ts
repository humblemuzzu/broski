/**
 * The loopback listener's HTTP routes (the dev-server reverse proxy, the status root, the Claude Code
 * terminal hook) and its fetch handler factory (auth, origin and TLS checks, WebSocket upgrades).
 */
import type { ServerWebSocket } from "bun";
import {
	buildProxyForwardHeaders,
	buildProxyShim,
	extractTokenFromRequest,
	isAllowedBrowserRequest,
	isAllowedOrigin,
	isAllowedProxyPort,
	jsonResponse,
	publicJson,
	rewriteProxyCookies,
	rewriteProxyRedirects,
	toErrorMessage,
	toPublicErrorMessage,
} from "./http-utils";

// ── handleHttpRequest Dependencies ─────────────────────────────────────

export interface HandleHttpDeps {
	tlsEnabled: boolean;
	version: string;
	allowedProxyPorts: Set<number>;
	logUser: (msg: string) => void;
	handleCcTerminalHook?: (request: Request) => Promise<Response>;
}

/** Handles one HTTP request that passed the fetch handler's checks. */
export async function handleHttpRequest(request: Request, deps: HandleHttpDeps): Promise<Response> {
	const url = new URL(request.url);

	// ── Reverse proxy for embedded previews ────────────────────────────
	if (url.pathname.startsWith("/proxy/")) {
		const rest = url.pathname.slice("/proxy/".length);
		const slashIdx = rest.indexOf("/");
		const portRaw = (slashIdx === -1 ? rest : rest.slice(0, slashIdx)).trim();
		const port = Number(portRaw);
		if (!Number.isFinite(port) || port < 1 || port > 65535) {
			return publicJson({ error: "Invalid proxy port" }, 400);
		}
		if (!isAllowedProxyPort(port, deps.allowedProxyPorts)) {
			deps.logUser(`[Security] Proxy blocked: port ${port} not in allowlist`);
			return publicJson({ error: "Port not allowed for proxy" }, 403);
		}
		const upstreamPath = slashIdx === -1 ? "/" : `/${rest.slice(slashIdx + 1)}`;
		const upstreamUrl = new URL(`${deps.tlsEnabled ? "https" : "http"}://127.0.0.1:${port}${upstreamPath}`);
		upstreamUrl.search = url.search;

		const forwardHeaders = buildProxyForwardHeaders(request);
		const method = request.method.toUpperCase();
		const hasBody = !["GET", "HEAD"].includes(method);
		const upstreamRes = await fetch(upstreamUrl.toString(), {
			method,
			redirect: "manual",
			headers: forwardHeaders,
			body: hasBody ? request.body : undefined,
			duplex: hasBody ? "half" : undefined,
		} as RequestInit & { duplex?: string }).catch((err) => {
			return new Response(`Proxy fetch failed: ${toErrorMessage(err)}`, { status: 502 });
		});

		if (upstreamRes instanceof Response && upstreamRes.headers?.get("content-type") == null) {
			return upstreamRes;
		}

		const headers = new Headers(upstreamRes.headers);
		headers.delete("x-frame-options");
		headers.delete("frame-options");
		headers.delete("content-security-policy");
		headers.delete("content-security-policy-report-only");
		headers.set("cache-control", "no-store");
		headers.set("x-content-type-options", "nosniff");

		rewriteProxyCookies(upstreamRes, headers, port);
		rewriteProxyRedirects(headers, upstreamUrl, port);

		const contentType = headers.get("content-type") ?? "";
		if (contentType.includes("text/html")) {
			let text = await upstreamRes.text().catch(() => "");
			const prefix = `/proxy/${port}`;
			const wsPrefix = `/proxy-ws/${port}`;
			const shim = buildProxyShim(prefix, wsPrefix);
			if (text.includes("<head")) {
				text = text.replace(/<head([^>]*)>/i, `<head$1><base href="${prefix}/">${shim}`);
			} else {
				text = `<base href="${prefix}/">\n${shim}\n${text}`;
			}
			text = text.replace(/(href|src|action)=(["'])\//gi, `$1=$2${prefix}/`).replace(/url\(\//gi, `url(${prefix}/`);
			return new Response(text, { status: upstreamRes.status, headers });
		}

		const buf = await upstreamRes.arrayBuffer();
		return new Response(buf, { status: upstreamRes.status, headers });
	}

	// ── Root status endpoint ───────────────────────────────────────────
	if (url.pathname === "/") {
		return jsonResponse({ status: "ok", version: deps.version });
	}

	if (url.pathname === "/cc-terminal-hook" && deps.handleCcTerminalHook)
		return await deps.handleCcTerminalHook(request);

	return new Response("Not found", { status: 404 });
}

// ── createFetchHandler Dependencies ────────────────────────────────────

export interface FetchHandlerDeps {
	httpDeps: HandleHttpDeps;
	allowTokenInUrl: boolean;
	validateAuthToken: (provided: string, expected: string) => boolean;
	getAuthToken: () => string;
	sockets: Set<ServerWebSocket<unknown>>;
	maxClients: number;
	tlsEnabled: boolean;
	isLoopbackAddress: (addr: string | undefined) => boolean;
	allowedProxyPorts: Set<number>;
	log: (msg: string) => void;
	logUser: (msg: string) => void;
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
			const isProxyWs = url.pathname.startsWith("/proxy-ws/");
			if (!isProxyWs && deps.sockets.size >= deps.maxClients) {
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

		// WebSocket proxy (loopback-only, no auth token).
		if (isWebSocketUpgrade && url.pathname.startsWith("/proxy-ws/")) {
			if (!isLoopback) return new Response("Forbidden", { status: 403 });
			if (!isAllowedBrowserRequest(request)) return new Response("Forbidden", { status: 403 });
			const rest = url.pathname.slice("/proxy-ws/".length);
			const slashIdx = rest.indexOf("/");
			const portRaw = (slashIdx === -1 ? rest : rest.slice(0, slashIdx)).trim();
			const port = Number(portRaw);
			if (!Number.isFinite(port) || port < 1 || port > 65535) {
				return new Response("Invalid proxy port", { status: 400 });
			}
			if (!isAllowedProxyPort(port, deps.allowedProxyPorts)) {
				deps.logUser(`[Security] WS Proxy blocked: port ${port} not in allowlist`);
				return new Response("Port not allowed for proxy", { status: 403 });
			}
			const upstreamPath = slashIdx === -1 ? "/" : `/${rest.slice(slashIdx + 1)}`;
			const ok = serverInstance.upgrade(request, {
				data: { kind: "proxy", port, path: upstreamPath, search: url.search },
			});
			if (ok) return;
			return new Response("WebSocket upgrade failed", { status: 500 });
		}

		// HTTP preview proxy — loopback-only, no auth required.
		if (!isWebSocketUpgrade && url.pathname.startsWith("/proxy/")) {
			if (!isLoopback) return new Response("Forbidden", { status: 403 });
			if (!isAllowedBrowserRequest(request)) return new Response("Forbidden", { status: 403 });
			try {
				return await handleHttpRequest(request, deps.httpDeps);
			} catch (error) {
				deps.log(`[HTTP] Error: ${toErrorMessage(error)}`);
				return publicJson({ error: toPublicErrorMessage(error) }, 500);
			}
		}

		const providedToken = extractTokenFromRequest(url, request);
		const isValidToken = !!(providedToken && deps.validateAuthToken(providedToken, deps.getAuthToken()));

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
