/**
 * JSON-RPC 2.0 over JSONL records, both ways. Ids may be strings or numbers in either direction. A request of ours
 * ends with the agent's answer, its error (a value, never a throw), its deadline, or the connection's end; only one
 * sent without a deadline waits as long as the agent takes. What the agent sends about a session goes to the route
 * attached for that session, in the order it was written; what arrives before the route is attached waits for it, a
 * bounded number of records deep.
 */

import type { z } from "zod";
import type { JsonlItem } from "../../../adapter-kit/jsonl";
import { ElicitationRequest, PermissionRequest, type SessionUpdate } from "./frames";
import { type Inbound, parseInbound, type SessionRecord, sessionRecordOf } from "./inbound";

export type RpcFailure = {
	readonly message: string;
	/** The agent's JSON-RPC error code; absent when the failure is the connection's (a deadline, an exit, a bad frame). */
	readonly code?: number;
};

export type RpcResult<T> =
	| { readonly ok: true; readonly result: T }
	| { readonly ok: false; readonly failure: RpcFailure };

export type AgentCall =
	| { readonly method: "session/request_permission"; readonly params: PermissionRequest; readonly answer: Answer }
	| { readonly method: "elicitation/create"; readonly params: ElicitationRequest; readonly answer: Answer };

export interface Answer {
	result(value: unknown): void;
	error(code: number, message: string): void;
}

export interface SessionRoute {
	update(update: SessionUpdate): void;
	call(call: AgentCall): void;
	/** A record about the session that did not read as the kind it says it is. */
	fault(message: string): void;
}

export const NO_DEADLINE = Number.POSITIVE_INFINITY;
export const REQUEST_DEADLINE_MS = 60_000;
const MAX_WAITING_RECORDS = 256;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

interface Pending {
	readonly settle: (result: RpcResult<unknown>) => void;
}

interface Waiting {
	readonly sessionId: string;
	readonly deliver: (route: SessionRoute) => void;
	readonly dropped?: () => void;
}

export class JsonRpc {
	private readonly pending = new Map<string, Pending>();
	private readonly routes = new Map<string, SessionRoute>();
	private readonly waiting: Waiting[] = [];
	private nextId = 0;
	private closed: string | undefined;

	constructor(
		private readonly who: string,
		private readonly write: (record: string) => void,
		private readonly onFault: (message: string) => void,
	) {}

	request<T>(
		method: string,
		params: unknown,
		schema: z.ZodType<T>,
		deadlineMs = REQUEST_DEADLINE_MS,
	): Promise<RpcResult<T>> {
		if (this.closed !== undefined) return Promise.resolve({ ok: false, failure: { message: this.closed } });
		const id = ++this.nextId;
		return new Promise((resolve) => {
			const timer = Number.isFinite(deadlineMs)
				? setTimeout(() => {
						this.pending.delete(String(id));
						resolve({
							ok: false,
							failure: { message: `${this.who} did not answer ${method} within ${deadlineMs / 1000} s` },
						});
					}, deadlineMs)
				: undefined;
			this.pending.set(String(id), {
				settle: (result) => {
					clearTimeout(timer);
					resolve(result.ok ? this.read(method, result.result, schema) : result);
				},
			});
			this.send({ id, method, params });
		});
	}

	notify(method: string, params: unknown): void {
		if (this.closed === undefined) this.send({ method, params });
	}

	/** Routes the session's records to `route` from now on, those that waited for it first; the result detaches it. */
	attach(sessionId: string, route: SessionRoute): () => void {
		this.routes.set(sessionId, route);
		const mine = this.waiting.filter((entry) => entry.sessionId === sessionId);
		this.waiting.splice(0, this.waiting.length, ...this.waiting.filter((entry) => entry.sessionId !== sessionId));
		for (const entry of mine) entry.deliver(route);
		return () => {
			if (this.routes.get(sessionId) === route) this.routes.delete(sessionId);
		};
	}

	receive(item: JsonlItem): void {
		if (item.kind === "oversized") {
			this.onFault(`${this.who} sent a record of ${item.bytes} bytes, past what the bridge reads`);
			return;
		}
		const inbound = parseInbound(item.text);
		if (inbound.kind === "invalid") this.onFault(`${this.who} sent ${inbound.reason}`);
		else this.dispatch(inbound);
	}

	/** Every request still waiting fails with `reason`, and every later one at once. */
	close(reason: string): void {
		this.closed ??= reason;
		for (const [id, pending] of this.pending) {
			this.pending.delete(id);
			pending.settle({ ok: false, failure: { message: reason } });
		}
	}

	private dispatch(inbound: Exclude<Inbound, { kind: "invalid" }>): void {
		switch (inbound.kind) {
			case "response": {
				const pending = this.pending.get(String(inbound.id));
				if (pending === undefined) return;
				this.pending.delete(String(inbound.id));
				pending.settle(inbound.error ? { ok: false, failure: inbound.error } : { ok: true, result: inbound.result });
				return;
			}
			case "notification":
				if (inbound.method === "session/update") this.sessionRecord(sessionRecordOf(inbound.params));
				return;
			case "request":
				this.agentRequest(inbound.id, inbound.method, inbound.params);
				return;
		}
	}

	private sessionRecord(record: SessionRecord): void {
		switch (record.kind) {
			case "update":
				this.toSession(record.sessionId, (route) => route.update(record.update));
				return;
			case "fault":
				this.toSession(record.sessionId, (route) => route.fault(`${this.who} sent ${record.message}`));
				return;
			case "invalid":
				this.onFault(`${this.who} sent ${record.message}`);
				return;
			case "other":
				return;
		}
	}

	private agentRequest(id: string | number, method: string, params: unknown): void {
		const answer = this.answerTo(id);
		const call = callOf(method, params, answer);
		if (call === "unknown") answer.error(METHOD_NOT_FOUND, `the client does not offer ${method}`);
		else if (call === undefined) answer.error(INVALID_PARAMS, `the client cannot read ${method}'s params`);
		else {
			const dropped = () => answer.error(INTERNAL_ERROR, `no session of this client took ${method}`);
			this.toSession(call.params.sessionId, (route) => route.call(call), dropped);
		}
	}

	private toSession(sessionId: string, deliver: (route: SessionRoute) => void, dropped?: () => void): void {
		const route = this.routes.get(sessionId);
		if (route !== undefined) {
			deliver(route);
			return;
		}
		this.waiting.push({ sessionId, deliver, ...(dropped !== undefined && { dropped }) });
		if (this.waiting.length > MAX_WAITING_RECORDS) this.waiting.shift()?.dropped?.();
	}

	private answerTo(id: string | number): Answer {
		let answered = false;
		const once = (body: Record<string, unknown>) => {
			if (answered) return;
			answered = true;
			this.send({ id, ...body });
		};
		return {
			result: (value) => once({ result: value }),
			error: (code, message) => once({ error: { code, message } }),
		};
	}

	private read<T>(method: string, result: unknown, schema: z.ZodType<T>): RpcResult<T> {
		const parsed = schema.safeParse(result);
		if (parsed.success) return { ok: true, result: parsed.data };
		return { ok: false, failure: { message: `${this.who} answered ${method} with a result the bridge cannot read` } };
	}

	private send(body: Record<string, unknown>): void {
		if (this.closed === undefined) this.write(`${JSON.stringify({ jsonrpc: "2.0", ...body })}\n`);
	}
}

function callOf(method: string, params: unknown, answer: Answer): AgentCall | "unknown" | undefined {
	if (method === "session/request_permission") {
		const parsed = PermissionRequest.safeParse(params);
		return parsed.success ? { method, params: parsed.data, answer } : undefined;
	}
	if (method === "elicitation/create") {
		const parsed = ElicitationRequest.safeParse(params);
		return parsed.success ? { method, params: parsed.data, answer } : undefined;
	}
	return "unknown";
}
