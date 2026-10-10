export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function connectBenchClient(port: number, token: string, timeoutMs = 10_000): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, [`broski-auth.${token}`]);
		const timer = setTimeout(() => reject(new Error("ws connect timeout")), timeoutMs);
		ws.onopen = () => {
			clearTimeout(timer);
			resolve(ws);
		};
		ws.onerror = () => {
			clearTimeout(timer);
			reject(new Error("ws connect error"));
		};
	});
}

export function waitForMessage(ws: WebSocket, type: string, timeoutMs = 10_000): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			ws.removeEventListener("message", handler);
			reject(new Error(`timeout waiting for ${type}`));
		}, timeoutMs);
		const handler = (event: MessageEvent): void => {
			const parsed = parseFrame(event.data);
			if (parsed && parsed.type === type) {
				clearTimeout(timer);
				ws.removeEventListener("message", handler);
				resolve(parsed);
			}
		};
		ws.addEventListener("message", handler);
	});
}

export function parseFrame(data: unknown): Record<string, unknown> | null {
	if (typeof data !== "string") return null;
	try {
		const parsed: unknown = JSON.parse(data);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * Tell the bridge this socket is looking at `sessionId`. Runtime events for other sessions are
 * only cross-session activity, so a bench client that never does this receives no deltas.
 */
export function watchSession(ws: WebSocket, agent: string, sessionId: string): void {
	ws.send(JSON.stringify({ type: "set_view", agent, sessionId }));
}
