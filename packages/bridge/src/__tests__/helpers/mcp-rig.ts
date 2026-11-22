/**
 * The MCP server on a real loopback port, over a bridge stand-in that records what reaches it: each interaction
 * waits until the test answers it, and ends `withdrawn` once its signal aborts, as the core's does.
 */

import type { ActionResult, InteractionReply, SessionRef } from "../../contract";
import {
	createMcpHttpHandler,
	type ExternalInteractionOutcome,
	type ExternalInteractionSpec,
	type ExternalNoticeSpec,
	type McpBridgeSink,
	type McpCapability,
	McpSessionRegistry,
} from "../../mcp";

export const SESSION: SessionRef = { backend: "pi", sessionId: "mcp-session" };

export interface Raised {
	readonly session: SessionRef;
	readonly spec: ExternalInteractionSpec;
	readonly signal: AbortSignal;
	answer(reply: InteractionReply): void;
	expire(): void;
}

export class RecordingSink implements McpBridgeSink {
	readonly raised: Raised[] = [];
	readonly notices: { readonly session: SessionRef; readonly notice: ExternalNoticeSpec }[] = [];
	noticeResult: ActionResult = { status: "accepted" };
	private readonly waiters = new Set<() => void>();

	raiseExternalInteraction(
		session: SessionRef,
		spec: ExternalInteractionSpec,
		signal: AbortSignal,
	): Promise<ExternalInteractionOutcome> {
		const settled = Promise.withResolvers<ExternalInteractionOutcome>();
		signal.addEventListener("abort", () => settled.resolve({ kind: "ended", reason: "withdrawn" }), { once: true });
		this.raised.push({
			session,
			spec,
			signal,
			answer: (reply) => settled.resolve({ kind: "answered", reply }),
			expire: () => settled.resolve({ kind: "ended", reason: "expired" }),
		});
		for (const wake of [...this.waiters]) wake();
		return settled.promise;
	}

	async emitExternalNotice(session: SessionRef, notice: ExternalNoticeSpec): Promise<ActionResult> {
		this.notices.push({ session, notice });
		return this.noticeResult;
	}

	/** The `count`th interaction raised, counting from 1. */
	nth(count: number): Promise<Raised> {
		return new Promise((resolve) => {
			const check = () => {
				const found = this.raised[count - 1];
				if (found === undefined) return;
				this.waiters.delete(check);
				resolve(found);
			};
			this.waiters.add(check);
			check();
		});
	}
}

const ALL: Record<McpCapability, boolean> = { ask: true, plan: true, notify: true };

export class McpRig {
	readonly sink = new RecordingSink();
	readonly registry = new McpSessionRegistry();
	private readonly server: ReturnType<typeof Bun.serve>;

	constructor(heartbeatMs = 25) {
		const handle = createMcpHttpHandler({ registry: this.registry, sink: this.sink, version: "9.9.9", heartbeatMs });
		this.server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handle });
	}

	get url(): string {
		return `http://127.0.0.1:${this.server.port}/mcp`;
	}

	issue(tools: Partial<Record<McpCapability, boolean>> = ALL) {
		return this.registry.issue({ session: SESSION, tools: { ask: false, plan: false, notify: false, ...tools } });
	}

	post(token: string | undefined, body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal) {
		return fetch(this.url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				"mcp-protocol-version": "2025-06-18",
				...(token !== undefined && { authorization: `Bearer ${token}` }),
				...headers,
			},
			body: typeof body === "string" ? body : JSON.stringify(body),
			...(signal !== undefined && { signal }),
		});
	}

	async rpc(token: string, method: string, params?: unknown, id: number | string = 1): Promise<RpcReply> {
		const response = await this.post(token, { jsonrpc: "2.0", id, method, params }, { accept: "application/json" });
		return (await response.json()) as RpcReply;
	}

	stop(): void {
		this.server.stop(true);
	}
}

export interface RpcReply {
	readonly id: number | string | null;
	readonly result?: Record<string, unknown>;
	readonly error?: { readonly code: number; readonly message: string };
}

export function callOf(name: string, args: unknown, meta?: Record<string, unknown>, id: number | string = 7) {
	return {
		jsonrpc: "2.0",
		id,
		method: "tools/call",
		params: { name, arguments: args, ...(meta !== undefined && { _meta: meta }) },
	};
}

/** The JSON-RPC messages of an SSE response, as they arrive, until the server closes it. */
export async function* sseMessages(response: Response): AsyncGenerator<Record<string, unknown>> {
	const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
	if (reader === undefined) return;
	let buffered = "";
	for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
		buffered += chunk.value;
		let end = buffered.indexOf("\n\n");
		while (end !== -1) {
			const data = buffered
				.slice(0, end)
				.split("\n")
				.find((line) => line.startsWith("data: "));
			buffered = buffered.slice(end + 2);
			if (data !== undefined) yield JSON.parse(data.slice("data: ".length));
			end = buffered.indexOf("\n\n");
		}
	}
}
