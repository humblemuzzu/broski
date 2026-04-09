/**
 * HTTP utility functions extracted from server.ts.
 *
 * Pure helpers for JSON responses, error sanitization, origin validation,
 * auth token extraction, and proxy port allowlisting.
 */
// ── JSON Response Helpers ──────────────────────────────────────────────

export function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"content-type": "application/json",
			"cache-control": "no-store",
			"x-content-type-options": "nosniff",
			"x-frame-options": "DENY",
			"referrer-policy": "no-referrer",
		},
	});
}

export function publicJson(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"content-type": "application/json",
			"cache-control": "no-store",
			"x-content-type-options": "nosniff",
			"x-frame-options": "DENY",
			"referrer-policy": "no-referrer",
			...extraHeaders,
		},
	});
}

// ── Error Message Helpers ──────────────────────────────────────────────

export function toErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export function toPublicErrorMessage(error: unknown): string {
	const containsFilesystemPath = (s: string): boolean => {
		if (/(?:^|\s)\/(?:home|Users|tmp|var|etc|opt|root|private|nix)\//i.test(s)) return true;
		if (/[A-Z]:\\/i.test(s)) return true;
		if (/\bat\s+\S+\s+\(\//.test(s)) return true;
		if (/file:\/\//.test(s)) return true;
		return false;
	};

	const sanitize = (msg: string): string => {
		if (!msg || msg.length === 0) return "Request failed";
		if (msg.length > 300) return "Request failed";
		if (containsFilesystemPath(msg)) return "Request failed";
		if (msg.length > 200) return `${msg.slice(0, 197)}...`;
		return msg;
	};

	if (typeof error === "string") return sanitize(error);
	if (error instanceof Error) return sanitize(error.message || "Request failed");
	return "Request failed";
}

// ── Origin / Browser Request Validation ────────────────────────────────

export function isAllowedOrigin(origin: string | null): boolean {
	if (!origin) return true;
	if (origin.startsWith("file://")) return true;
	if (origin === "http://localhost" || origin === "http://127.0.0.1") return true;
	if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) return true;
	if (origin.startsWith("https://localhost:") || origin.startsWith("https://127.0.0.1:")) return true;
	return false;
}

export function isAllowedBrowserRequest(request: Request, safeString: (v: unknown) => string): boolean {
	try {
		const site = safeString(request.headers.get("sec-fetch-site")).toLowerCase().trim();
		if (site && site !== "same-origin" && site !== "none") return false;

		const origin = request.headers.get("origin");
		if (origin != null && origin !== "" && !isAllowedOrigin(origin)) return false;
		return true;
	} catch {
		return false;
	}
}

// ── Auth Token Extraction ──────────────────────────────────────────────

export function extractProtocolToken(protocolHeader: string | null): string | null {
	if (!protocolHeader) return null;
	const parts = protocolHeader
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean);
	for (const p of parts) {
		if (p.startsWith("broski-auth.")) {
			const tok = p.slice("broski-auth.".length);
			return tok || null;
		}
	}
	return null;
}

export function extractTokenFromRequest(_url: URL, request: Request): string | null {
	const authHeader = request.headers.get("authorization");
	const tokenFromHeader = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
	const tokenFromProtocol = extractProtocolToken(request.headers.get("sec-websocket-protocol"));
	return tokenFromHeader || tokenFromProtocol;
}

// ── Proxy Port Allowlist ───────────────────────────────────────────────

const DEFAULT_ALLOWED_PROXY_PORTS = new Set([
	3000,
	3001,
	3002,
	3003, // React, Next.js, Remix
	4000,
	4001,
	4200,
	4321, // Angular, Astro
	5000,
	5001,
	5173,
	5174,
	5175, // Flask, Vite
	8000,
	8001,
	8080,
	8081,
	8888, // Django, generic
	9000,
	9001, // PHP, misc
]);

export function buildProxyPortAllowlist(): Set<number> {
	const extraProxyPorts = (process.env.BROSKI_ALLOWED_PROXY_PORTS ?? "")
		.split(",")
		.map((p) => Number(p.trim()))
		.filter((p) => Number.isFinite(p) && p > 0 && p < 65536);
	return new Set([...DEFAULT_ALLOWED_PROXY_PORTS, ...extraProxyPorts]);
}

export function isAllowedProxyPort(port: number, allowedPorts: Set<number>): boolean {
	if (allowedPorts.has(port)) return true;
	if (port >= 10000 && port <= 65535) return true;
	return false;
}

// ── Proxy Helpers ──────────────────────────────────────────────────────

export function buildProxyForwardHeaders(request: Request): Headers {
	const h = new Headers();
	const allow = new Set([
		"accept",
		"accept-language",
		"content-type",
		"cache-control",
		"pragma",
		"if-none-match",
		"if-modified-since",
		"user-agent",
		"cookie",
	]);
	for (const [k, v] of request.headers.entries()) {
		const key = k.toLowerCase();
		if (!allow.has(key)) continue;
		h.set(key, v);
	}
	if (!h.has("user-agent")) h.set("user-agent", "broski-bridge-proxy");
	return h;
}

export function rewriteProxyCookies(upstreamRes: Response, headers: Headers, port: number): void {
	try {
		const setCookies = (upstreamRes.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.();
		if (Array.isArray(setCookies) && setCookies.length > 0) {
			headers.delete("set-cookie");
			for (const sc of setCookies) {
				const parts = sc.split(";").map((p) => p.trim());
				const base = parts.shift() ?? "";
				const attrs = parts.filter((p) => !/^domain=/i.test(p) && !/^path=/i.test(p));
				attrs.push(`Path=/proxy/${port}/`);
				headers.append("set-cookie", [base, ...attrs].join("; "));
			}
		}
	} catch {
		// ignore
	}
}

export function rewriteProxyRedirects(headers: Headers, upstreamUrl: URL, port: number): void {
	const location = headers.get("location");
	if (location) {
		try {
			const locUrl = new URL(location, upstreamUrl);
			if ((locUrl.hostname === "127.0.0.1" || locUrl.hostname === "localhost") && Number(locUrl.port) === port) {
				const rewritten = `/proxy/${port}${locUrl.pathname}${locUrl.search}${locUrl.hash}`;
				headers.set("location", rewritten);
			}
		} catch {
			// ignore
		}
	}
}

export function buildProxyShim(prefix: string, wsPrefix: string): string {
	return `<script>(function(){try{var P=${JSON.stringify(prefix)};var W=${JSON.stringify(wsPrefix)};window.__BROSKI_PROXY_PREFIX__=P;function abs(u){try{if(typeof u!=='string')return u;if(u.startsWith(P+'/')||u===P)return u;if(u.startsWith('/'))return P+u;return u}catch{return u}};var of=window.fetch;if(of)window.fetch=function(input,init){try{if(typeof input==='string'){input=abs(input)}else if(input&&typeof input.url==='string'){var nu=abs(input.url);if(nu!==input.url)input=new Request(nu,input)} }catch{}return of.call(this,input,init)};var xo=XMLHttpRequest&&XMLHttpRequest.prototype&&XMLHttpRequest.prototype.open;if(xo)XMLHttpRequest.prototype.open=function(m,u){try{u=abs(u)}catch{}return xo.apply(this,arguments)};var oe=window.EventSource;if(oe)window.EventSource=function(u,c){try{u=abs(u)}catch{}return new oe(u,c)};var OWS=window.WebSocket;if(OWS){window.WebSocket=function(u,p){try{if(typeof u==='string'){if(u.startsWith('ws://localhost:')||u.startsWith('wss://localhost:')||u.startsWith('ws://127.0.0.1:')||u.startsWith('wss://127.0.0.1:')){var pu=new URL(u);u=location.protocol.replace('http','ws')+'//'+location.host+W+'/'+pu.port+pu.pathname+pu.search}}else if(u instanceof URL){u=u.toString()}}catch{}return new OWS(u,p)};window.WebSocket.CONNECTING=OWS.CONNECTING;window.WebSocket.OPEN=OWS.OPEN;window.WebSocket.CLOSING=OWS.CLOSING;window.WebSocket.CLOSED=OWS.CLOSED;window.WebSocket.prototype=OWS.prototype}}catch{}})()</script>`;
}
