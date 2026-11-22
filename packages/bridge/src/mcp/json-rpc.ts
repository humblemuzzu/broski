/** The JSON-RPC 2.0 messages of MCP's Streamable HTTP transport, as the server reads and writes them. */

import { z } from "zod";
import { MAX_ID_CHARS } from "../contract";

export const RequestId = z.union([z.string().max(MAX_ID_CHARS), z.int()]);
export type RequestId = z.infer<typeof RequestId>;

const Params = z.record(z.string(), z.unknown());

export const RpcRequest = z.object({
	jsonrpc: z.literal("2.0"),
	id: RequestId,
	method: z.string(),
	params: Params.optional(),
});
export type RpcRequest = z.infer<typeof RpcRequest>;

export const RpcNotification = z.object({ jsonrpc: z.literal("2.0"), method: z.string(), params: Params.optional() });

/** What the client answers a server request with; this server sends none, so it is only acknowledged. */
export const RpcResponse = z.union([
	z.object({ jsonrpc: z.literal("2.0"), id: RequestId, result: z.unknown() }),
	z.object({ jsonrpc: z.literal("2.0"), id: RequestId.nullable(), error: z.unknown() }),
]);

export const CallParams = z.object({
	name: z.string(),
	arguments: z.unknown().optional(),
	_meta: z.looseObject({ progressToken: z.union([z.string().max(MAX_ID_CHARS), z.number()]).optional() }).optional(),
});

export const CancelledParams = z.object({ requestId: RequestId });

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;

export function rpcResult(id: RequestId, result: unknown) {
	return { jsonrpc: "2.0", id, result };
}

export function rpcError(id: RequestId | null, code: number, message: string) {
	return { jsonrpc: "2.0", id, error: { code, message } };
}

export function progressNotification(progressToken: string | number, progress: number) {
	return {
		jsonrpc: "2.0",
		method: "notifications/progress",
		params: { progressToken, progress, message: "Waiting for the user's answer on Broski" },
	};
}

/** One server-sent event carrying one JSON-RPC message. */
export function sseEvent(message: unknown): string {
	return `event: message\ndata: ${JSON.stringify(message)}\n\n`;
}

/** An SSE comment: it keeps the connection alive for a client that gave no progress token. */
export const SSE_KEEPALIVE = ": waiting\n\n";
