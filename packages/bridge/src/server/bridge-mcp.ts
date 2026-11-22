/**
 * The bridge's MCP server (`mcp/`) as the loopback listener serves it at `/mcp`: one token registry for every backend,
 * its asks and notices raised on the core through the contract seam, and per backend an issuer of session tokens that
 * name the bound listener. A token works only while the bridge runs: shutdown revokes every one.
 */

import type { BackendId, SessionId } from "../contract";
import { createMcpHttpHandler, MCP_PATH, type McpBridgeSink, type McpCapability, McpSessionRegistry } from "../mcp";

/** Where the MCP server listens; `caCertPath` is the certificate a client must trust when the listener speaks TLS. */
export interface McpEndpoint {
	readonly url: string;
	readonly caCertPath?: string;
}

export type McpTools = Readonly<Record<McpCapability, boolean>>;

/** One session's token, bound to the tools it was given; `revoke` once the session's process is gone. */
export interface McpLease extends McpEndpoint {
	readonly token: string;
	readonly tools: readonly McpCapability[];
	revoke(): void;
}

/** One backend's way to the MCP server. */
export interface BroskiMcpIssuer {
	/** Undefined until the loopback listener is bound. */
	endpoint(): McpEndpoint | undefined;
	/** Undefined before the listener is bound, or when the config leaves the session no tool. */
	issue(sessionId: SessionId, tools: McpTools): McpLease | undefined;
}

export interface BridgeMcp {
	/** The `/mcp` route; `503` until `connect`. */
	handle(request: Request): Promise<Response>;
	connect(sink: McpBridgeSink): void;
	listen(port: number, caCertPath: string | undefined): void;
	issuer(backend: BackendId): BroskiMcpIssuer;
	/** Bridge shutdown. */
	revokeAll(): void;
}

export interface BridgeMcpOptions {
	readonly version: string;
	/** `bridgeTools.notify`: `broski_notify` is offered at all. */
	readonly notify: boolean;
	readonly registry?: McpSessionRegistry;
	readonly heartbeatMs?: number;
}

export function createBridgeMcp(options: BridgeMcpOptions): BridgeMcp {
	const registry = options.registry ?? new McpSessionRegistry();
	let handler: ((request: Request) => Promise<Response>) | undefined;
	let endpoint: McpEndpoint | undefined;
	return {
		handle: async (request) => (handler ? handler(request) : new Response("Not ready", { status: 503 })),
		connect: (sink) => {
			handler = createMcpHttpHandler({
				registry,
				sink,
				version: options.version,
				...(options.heartbeatMs !== undefined && { heartbeatMs: options.heartbeatMs }),
			});
		},
		listen: (port, caCertPath) => {
			const scheme = caCertPath === undefined ? "http" : "https";
			endpoint = { url: `${scheme}://127.0.0.1:${port}${MCP_PATH}`, ...(caCertPath !== undefined && { caCertPath }) };
		},
		issuer: (backend) => ({
			endpoint: () => endpoint,
			issue: (sessionId, tools) => {
				if (endpoint === undefined) return undefined;
				const granted = { ...tools, notify: tools.notify && options.notify };
				if (!granted.ask && !granted.plan && !granted.notify) return undefined;
				const credential = registry.issue({ session: { backend, sessionId }, tools: granted });
				return { ...endpoint, token: credential.token, tools: credential.capabilities, revoke: credential.revoke };
			},
		}),
		revokeAll: () => registry.revokeAll(),
	};
}
