/**
 * HTTP request handler extracted from server.ts.
 *
 * Handles all HTTP routes: reverse proxy, web dashboard, API endpoints
 * (/projects, /browse), and the fetch handler factory (auth + security).
 */
import { join, resolve, sep } from "node:path";
import type { ServerWebSocket } from "bun";
import type { OpenCodeConnector } from "./connectors/opencode";
import {
	buildProxyForwardHeaders,
	buildProxyShim,
	checkHttpEntitlement,
	extractTokenFromRequest,
	type HttpEntitlementDeps,
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
	webDistDir: string;
	version: string;
	allowedProxyPorts: Set<number>;
	opencode: OpenCodeConnector | null;
	listFilesDirectly: (path: string) => Promise<unknown>;
	logUser: (msg: string) => void;
	entitlementDeps: HttpEntitlementDeps;
}

/**
 * Handles HTTP requests for all bridge routes.
 * Extracted from the `handleHttp` closure in server.ts.
 */
export async function handleHttpRequest(request: Request, deps: HandleHttpDeps): Promise<Response> {
	const url = new URL(request.url);
	const accept = request.headers.get("accept") ?? "";
	const wantsHtml = accept.includes("text/html");

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

	// ── Serve embedded web dashboard ───────────────────────────────────
	if (
		request.method === "GET" &&
		(wantsHtml ||
			url.pathname.startsWith("/assets/") ||
			url.pathname === "/favicon.ico" ||
			url.pathname === "/manifest.json" ||
			url.pathname === "/robots.txt")
	) {
		const indexPath = join(deps.webDistDir, "index.html");
		const indexFile = Bun.file(indexPath);
		if (await indexFile.exists()) {
			const safePath = (() => {
				if (url.pathname === "/" || url.pathname === "") return indexPath;
				const target = resolve(deps.webDistDir, `.${url.pathname}`);
				const base = resolve(deps.webDistDir) + sep;
				if (!target.startsWith(base)) return null;
				return target;
			})();
			if (safePath) {
				const file = Bun.file(safePath);
				if (await file.exists()) return new Response(file);
			}
			return new Response(indexFile);
		}
	}

	// ── Root status endpoint ───────────────────────────────────────────
	if (url.pathname === "/") {
		return jsonResponse({ status: "ok", version: deps.version });
	}

	// ── /projects ──────────────────────────────────────────────────────
	if (url.pathname === "/projects") {
		const denied = await checkHttpEntitlement(request, deps.entitlementDeps);
		if (denied) return denied;
		if (!deps.opencode) return jsonResponse({ error: "OpenCode not available" }, 503);
		try {
			const data = await deps.opencode.listProjects();
			return jsonResponse(data);
		} catch {
			return jsonResponse({ error: "Request failed" }, 500);
		}
	}

	// ── /browse ────────────────────────────────────────────────────────
	if (url.pathname === "/browse") {
		const denied = await checkHttpEntitlement(request, deps.entitlementDeps);
		if (denied) return denied;
		const path = url.searchParams.get("path");
		if (!path) return jsonResponse({ error: "Missing path" }, 400);
		try {
			const items = await deps.listFilesDirectly(path);
			return jsonResponse({ path, items });
		} catch {
			return jsonResponse({ error: "Request failed" }, 500);
		}
	}

	return new Response("Not found", { status: 404 });
}

// ── createFetchHandler Dependencies ────────────────────────────────────

export interface FetchHandlerDeps {
	httpDeps: HandleHttpDeps;
	safeString: (v: unknown) => string;
	allowTokenInUrl: boolean;
	validateAuthToken: (provided: string, expected: string) => boolean;
	getAuthToken: () => string;
	getAuthExpiresAt: () => number;
	rotateExpiredAuthToken: () => Promise<void>;
	sockets: Set<ServerWebSocket<unknown>>;
	maxClients: number;
	tlsEnabled: boolean;
	isLoopbackAddress: (addr: string | undefined) => boolean;
	isTailscaleAddress: (addr: string | undefined) => boolean;
	allowedProxyPorts: Set<number>;
	log: (msg: string) => void;
	logUser: (msg: string) => void;
}

/**
 * Creates a `fetch` handler for Bun.serve with auth, origin checking,
 * TLS enforcement, and WebSocket upgrade logic.
 * Extracted from `makeFetch` in server.ts.
 */
export function createFetchHandler(serverLabel: string, deps: FetchHandlerDeps) {
	return async (request: Request, serverInstance: any): Promise<Response | undefined> => {
		const url = new URL(request.url);

		const isLoopbackHostHeader = (() => {
			const host = deps.safeString(request.headers.get("host")).toLowerCase().trim();
			if (!host) return false;
			return host.startsWith("127.0.0.1") || host.startsWith("localhost") || host.startsWith("[::1]");
		})();

		if (!deps.allowTokenInUrl && url.searchParams.has("token")) {
			return publicJson({ error: "Token in URL not allowed" }, 400);
		}

		await deps.rotateExpiredAuthToken();

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
		const isTailscale = deps.isTailscaleAddress(requestIp);

		if (!deps.tlsEnabled && !isLoopback && !isTailscale) {
			return new Response("TLS required for non-local connections", { status: 403 });
		}

		// WebSocket proxy (loopback-only, no auth token).
		if (isWebSocketUpgrade && url.pathname.startsWith("/proxy-ws/")) {
			if (!isLoopback) return new Response("Forbidden", { status: 403 });
			if (serverLabel === "loopback" && !isLoopbackHostHeader) return new Response("Forbidden", { status: 403 });
			if (!isAllowedBrowserRequest(request, deps.safeString)) return new Response("Forbidden", { status: 403 });
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
			if (serverLabel === "loopback" && !isLoopbackHostHeader) return new Response("Forbidden", { status: 403 });
			if (!isAllowedBrowserRequest(request, deps.safeString)) return new Response("Forbidden", { status: 403 });
			try {
				return await handleHttpRequest(request, deps.httpDeps);
			} catch (error) {
				deps.log(`[HTTP] Error: ${toErrorMessage(error)}`);
				return publicJson({ error: toPublicErrorMessage(error) }, 500);
			}
		}

		const providedToken = extractTokenFromRequest(url, request);
		const isValidToken = !!(
			providedToken &&
			deps.validateAuthToken(providedToken, deps.getAuthToken()) &&
			Date.now() <= deps.getAuthExpiresAt()
		);

		if (isWebSocketUpgrade) {
			if (!isValidToken) {
				deps.logUser(`[Security] WS rejected (auth) via ${serverLabel}`);
				return new Response("Unauthorized", { status: 401 });
			}
			if (serverInstance.upgrade(request)) return;
			return new Response("WebSocket upgrade failed", { status: 500 });
		}

		if (!isValidToken) {
			const accept = request.headers.get("accept") ?? "";
			const wantsHtml = accept.includes("text/html");
			const looksLikeDashboardAsset =
				wantsHtml ||
				url.pathname.startsWith("/assets/") ||
				url.pathname.startsWith("/proxy/") ||
				url.pathname === "/favicon.ico" ||
				url.pathname === "/manifest.json" ||
				url.pathname === "/robots.txt";
			if (request.method === "GET" && looksLikeDashboardAsset) {
				if (serverLabel === "loopback" && !isLoopbackHostHeader) {
					return publicJson({ error: "Unauthorized" }, 401);
				}
				try {
					return await handleHttpRequest(request, deps.httpDeps);
				} catch (error) {
					deps.log(`[HTTP] Error: ${toErrorMessage(error)}`);
					return publicJson({ error: toPublicErrorMessage(error) }, 500);
				}
			}
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
