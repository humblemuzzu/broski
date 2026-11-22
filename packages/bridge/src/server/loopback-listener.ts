/**
 * The bridge's 127.0.0.1 listener. Phones reach the bridge only through broski-link's socket; this one serves the
 * agent permission hooks on this machine, the dev-server proxy (`/proxy/<port>`, `/proxy-ws/<port>`) and a status
 * probe at `/`; a WebSocket upgrade with the bearer token reaches the same connection handler as a link socket.
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
		// A permission hook's request and an MCP tool's event stream stay open while a person decides on the phone; Bun's
		// default closes a connection idle for 10 s.
		idleTimeout: 0,
		...(options.tls && { tls: { key: Bun.file(options.tls.keyPath), cert: Bun.file(options.tls.certPath) } }),
		fetch: options.fetch,
		websocket: options.websocket,
	});
}
