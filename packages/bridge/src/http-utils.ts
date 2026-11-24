/**
 * HTTP utility functions extracted from server.ts.
 *
 * Pure helpers for JSON responses, error sanitization, origin validation
 * and auth token extraction.
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

/** A DNS-rebinding page sends its own name as `Host`; only loopback names reach the loopback-only routes. */
export function isLoopbackHostHeader(host: string | null): boolean {
	if (!host) return true;
	const trimmed = host.trim().toLowerCase();
	if (trimmed.startsWith("[::1]")) {
		return trimmed === "[::1]" || /^\[::1\]:\d+$/.test(trimmed);
	}
	const hostname = trimmed.includes(":") ? trimmed.slice(0, trimmed.lastIndexOf(":")) : trimmed;
	return hostname === "127.0.0.1" || hostname === "localhost";
}

export function isAllowedBrowserRequest(request: Request): boolean {
	try {
		if (!isLoopbackHostHeader(request.headers.get("host"))) return false;

		const site = (request.headers.get("sec-fetch-site") ?? "").toLowerCase().trim();
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
