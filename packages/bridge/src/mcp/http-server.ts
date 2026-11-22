/**
 * `POST /mcp`: MCP's Streamable HTTP transport, protocol 2025-06-18 (one JSON-RPC message per request, no batches), for
 * one bearer token at a time.
 * A tool that waits for the person answers as a server-sent event stream with a progress notification every
 * `heartbeatMs`, which resets the client's request timeout for as long as the person takes. The client hanging up, or
 * sending `notifications/cancelled`, aborts the wait, which withdraws the card from the phone.
 */

import {
	CallParams,
	CancelledParams,
	INVALID_PARAMS,
	INVALID_REQUEST,
	METHOD_NOT_FOUND,
	PARSE_ERROR,
	progressNotification,
	type RequestId,
	RpcNotification,
	RpcRequest,
	RpcResponse,
	rpcError,
	rpcResult,
	SSE_KEEPALIVE,
	sseEvent,
} from "./json-rpc";
import type { McpGrant, McpSessionRegistry } from "./session-tokens";
import type { McpBridgeSink } from "./sink";
import { type McpTool, type McpToolOutput, toolNamed, toolsOf } from "./tools";

export const MCP_PATH = "/mcp";
export const MAX_MCP_REQUEST_BYTES = 2 * 1_048_576;
export const MCP_HEARTBEAT_MS = 20_000;
/** Calls one token may have waiting at once. */
export const MAX_PENDING_CALLS = 16;

/** A client asking for another version is offered this one, and decides whether to go on (MCP lifecycle). */
const PROTOCOL_VERSION = "2025-06-18";
const ENCODER = new TextEncoder();

export interface McpHttpOptions {
	readonly registry: McpSessionRegistry;
	readonly sink: McpBridgeSink;
	/** The bridge's version, as `serverInfo.version`. */
	readonly version: string;
	readonly heartbeatMs?: number;
}

type Pending = Map<RequestId, AbortController>;

export function createMcpHttpHandler(options: McpHttpOptions): (request: Request) => Promise<Response> {
	const server = new McpHttpServer(options);
	return (request) => server.handle(request);
}

class McpHttpServer {
	private readonly heartbeatMs: number;
	/** Each token's calls still waiting, by request id, for `notifications/cancelled`. */
	private readonly pending = new WeakMap<McpGrant, Pending>();

	constructor(private readonly options: McpHttpOptions) {
		this.heartbeatMs = options.heartbeatMs ?? MCP_HEARTBEAT_MS;
	}

	async handle(request: Request): Promise<Response> {
		if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
		const grant = grantOf(request, this.options.registry);
		if (grant === undefined) return unauthorized();
		const version = request.headers.get("mcp-protocol-version");
		if (version !== null && version !== PROTOCOL_VERSION) {
			return Response.json(rpcError(null, INVALID_REQUEST, `Unsupported protocol version ${version}`), { status: 400 });
		}
		const body = await readBounded(request);
		if (body === undefined) return Response.json({ error: "Request too large" }, { status: 413 });
		const message = parseJson(body);
		if (message === undefined) return Response.json(rpcError(null, PARSE_ERROR, "Parse error"), { status: 400 });
		return this.dispatch(message, grant, request);
	}

	/** A message with a method and an id is a request, whatever its id; one with a method alone a notification. */
	private dispatch(message: unknown, grant: McpGrant, request: Request): Promise<Response> | Response {
		if (!hasKey(message, "method")) return RpcResponse.safeParse(message).success ? accepted() : invalidMessage();
		if (hasKey(message, "id")) {
			const call = RpcRequest.safeParse(message);
			return call.success ? this.answer(call.data, grant, request) : invalidMessage();
		}
		const notification = RpcNotification.safeParse(message);
		if (!notification.success) return invalidMessage();
		if (notification.data.method === "notifications/cancelled") this.cancel(grant, notification.data.params);
		return accepted();
	}

	private cancel(grant: McpGrant, params: unknown): void {
		const cancelled = CancelledParams.safeParse(params);
		if (cancelled.success) this.pending.get(grant)?.get(cancelled.data.requestId)?.abort();
	}

	private async answer(call: RpcRequest, grant: McpGrant, request: Request): Promise<Response> {
		switch (call.method) {
			case "initialize":
				return Response.json(rpcResult(call.id, initializeResult(this.options.version)));
			case "ping":
				return Response.json(rpcResult(call.id, {}));
			case "tools/list":
				return Response.json(
					rpcResult(call.id, { tools: toolsOf(grant.capabilities).map((tool) => tool.declaration) }),
				);
			case "tools/call":
				return this.callTool(call, grant, request);
			default:
				return Response.json(rpcError(call.id, METHOD_NOT_FOUND, `Method not found: ${call.method}`));
		}
	}

	private async callTool(call: RpcRequest, grant: McpGrant, request: Request): Promise<Response> {
		const params = CallParams.safeParse(call.params);
		if (!params.success) return Response.json(rpcError(call.id, INVALID_PARAMS, "Invalid tools/call params"));
		const tool = toolNamed(toolsOf(grant.capabilities), params.data.name);
		if (tool === undefined) {
			return Response.json(rpcError(call.id, INVALID_PARAMS, `Unknown tool: ${params.data.name}`));
		}
		const calls = this.pendingOf(grant);
		if (calls.has(call.id)) return Response.json(rpcError(call.id, INVALID_REQUEST, "Request id already in use"));
		if (calls.size >= MAX_PENDING_CALLS) return Response.json(rpcError(call.id, INVALID_REQUEST, "Too many calls"));
		const stop = new AbortController();
		calls.set(call.id, stop);
		const outcome = this.run(tool, params.data.arguments, grant, stop, request.signal).finally(() =>
			calls.delete(call.id),
		);
		const token = params.data._meta?.progressToken;
		if (tool.blocking && (accepts(request, "text/event-stream") || token !== undefined)) {
			return streamed(call.id, outcome, token, this.heartbeatMs, stop);
		}
		return Response.json(rpcResult(call.id, await outcome));
	}

	private async run(
		tool: McpTool,
		args: unknown,
		grant: McpGrant,
		stop: AbortController,
		hangUp: AbortSignal,
	): Promise<ReturnType<typeof callResult>> {
		const abort = () => stop.abort();
		if (hangUp.aborted) abort();
		else hangUp.addEventListener("abort", abort, { once: true });
		try {
			const context = { session: grant.session, sink: this.options.sink, signal: stop.signal };
			return callResult(await tool.call(args, context));
		} catch (error) {
			return callResult({ ok: false, message: `Broski could not deliver this: ${errorText(error)}` });
		} finally {
			hangUp.removeEventListener("abort", abort);
		}
	}

	private pendingOf(grant: McpGrant): Pending {
		const known = this.pending.get(grant);
		if (known !== undefined) return known;
		const created: Pending = new Map();
		this.pending.set(grant, created);
		return created;
	}
}

function streamed(
	id: RequestId,
	outcome: Promise<unknown>,
	token: string | number | undefined,
	heartbeatMs: number,
	stop: AbortController,
): Response {
	let closed = false;
	let timer: ReturnType<typeof setInterval> | undefined;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (chunk: string) => {
				if (closed) return;
				try {
					controller.enqueue(ENCODER.encode(chunk));
				} catch {
					closed = true;
				}
			};
			let progress = 0;
			timer = setInterval(() => {
				progress += 1;
				send(token === undefined ? SSE_KEEPALIVE : sseEvent(progressNotification(token, progress)));
			}, heartbeatMs);
			void outcome.then((result) => {
				clearInterval(timer);
				send(sseEvent(rpcResult(id, result)));
				if (closed) return;
				closed = true;
				controller.close();
			});
		},
		cancel() {
			closed = true;
			clearInterval(timer);
			stop.abort();
		},
	});
	return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}

function callResult(output: McpToolOutput) {
	if (!output.ok) return { content: [{ type: "text", text: output.message }], isError: true };
	return {
		content: [{ type: "text", text: JSON.stringify(output.value) }],
		structuredContent: output.value,
		isError: false,
	};
}

function initializeResult(version: string) {
	return {
		protocolVersion: PROTOCOL_VERSION,
		capabilities: { tools: { listChanged: false } },
		serverInfo: { name: "broski", version },
	};
}

function grantOf(request: Request, registry: McpSessionRegistry): McpGrant | undefined {
	const header = request.headers.get("authorization");
	return header?.startsWith("Bearer ") ? registry.lookup(header.slice("Bearer ".length)) : undefined;
}

function hasKey(message: unknown, key: string): boolean {
	return typeof message === "object" && message !== null && !Array.isArray(message) && Object.hasOwn(message, key);
}

function accepted(): Response {
	return new Response(null, { status: 202 });
}

function invalidMessage(): Response {
	return Response.json(rpcError(null, INVALID_REQUEST, "Not a JSON-RPC 2.0 message"), { status: 400 });
}

function unauthorized(): Response {
	return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "www-authenticate": "Bearer" } });
}

function accepts(request: Request, type: string): boolean {
	return (request.headers.get("accept") ?? "").includes(type);
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The body as text, or undefined past the bound; never buffers more than the bound. */
async function readBounded(request: Request): Promise<string | undefined> {
	const declared = Number(request.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > MAX_MCP_REQUEST_BYTES) return undefined;
	if (request.body === null) return "";
	const reader = request.body.getReader();
	const parts: Uint8Array[] = [];
	let total = 0;
	for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
		total += chunk.value.length;
		if (total > MAX_MCP_REQUEST_BYTES) {
			await reader.cancel();
			return undefined;
		}
		parts.push(chunk.value);
	}
	return new TextDecoder().decode(Buffer.concat(parts));
}
