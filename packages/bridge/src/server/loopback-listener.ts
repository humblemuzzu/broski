/**
 * The bridge's 127.0.0.1 listener. Phones reach the bridge only through broski-link's socket; this one serves the
 * agent permission hooks on this machine, the dashboard and `/proxy/<port>`.
 */

import type { Server, WebSocketHandler } from "bun";

export interface LoopbackListenerOptions {
	readonly port: number;
	readonly tls?: { readonly keyPath: string; readonly certPath: string };
	readonly fetch: (request: Request, server: Server<unknown>) => Response | Promise<Response | undefined> | undefined;
	readonly websocket: WebSocketHandler<unknown>;
}

export function serveLoopback(options: LoopbackListenerOptions): Server<unknown> {
	return Bun.serve({
		hostname: "127.0.0.1",
		port: options.port,
		// A permission hook's request stays open while a person decides on the phone; Bun's default resets it at 10 s.
		idleTimeout: 0,
		...(options.tls && { tls: { key: Bun.file(options.tls.keyPath), cert: Bun.file(options.tls.certPath) } }),
		fetch: options.fetch,
		websocket: options.websocket,
	});
}
