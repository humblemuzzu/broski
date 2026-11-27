/**
 * JSON-RPC 2.0 over JSONL records, both ways. Ids may be strings or numbers in either direction. A request of ours
 * ends with the agent's answer, its error (a value, never a throw), its deadline, or the connection's end; only one
 * sent without a deadline waits as long as the agent takes. An answer the client cannot read ends its request too, with
 * what was wrong. What the agent sends about a session goes to the route attached for that session, in the order it
 * was written; what arrives before the route is attached waits for it, a bounded number of records deep. An agent
 * request the agent takes back (`$/cancel_request`) is answered `Request cancelled`, as ACP requires of its receiver,
 * and its call's `withdrawn` signal aborts. Every record that breaks the protocol is reported to `onFault`.
 */

import type { z } from "zod";
import type { JsonlItem } from "../../../adapter-kit/jsonl";
import { CancelRequest, ElicitationRequest, PermissionRequest, type SessionUpdate } from "./frames";
import { type Inbound, parseInbound, type Reply, type SessionRecord, sessionRecordOf } from "./inbound";

export type RpcFailure = {
	readonly message: string;
	/** The agent's JSON-RPC error code; absent when the failure is the connection's (a deadline, an exit, a bad frame). */
	readonly code?: number;
};

export type RpcResult<T> =
	| { readonly ok: true; readonly result: T }
	| { readonly ok: false; readonly failure: RpcFailure };

interface CallParts {
	readonly answer: Answer;
	/** Aborts when the agent takes the request back, which is then already answered. */
	readonly withdrawn: AbortSignal;
}

export type AgentCall =
	| ({ readonly method: "session/request_permission"; readonly params: PermissionRequest } & CallParts)
	| ({ readonly method: "elicitation/create"; readonly params: ElicitationRequest } & CallParts);

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
export const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const REQUEST_CANCELLED = -32800;

interface Pending {
	readonly method: string;
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
	/** The agent's requests not yet answered, by their id as JSON. */
	private readonly calls = new Map<string, AbortController>();
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
				method,
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

	/** Every request still waiting fails with `reason`, and every later one at once; the agent's requests are gone with it. */
	close(reason: string): void {
		this.closed ??= reason;
		for (const [id, pending] of this.pending) {
			this.pending.delete(id);
			pending.settle({ ok: false, failure: { message: reason } });
		}
		const calls = [...this.calls.values()];
		this.calls.clear();
		for (const call of calls) call.abort();
	}

	private dispatch(inbound: Exclude<Inbound, { kind: "invalid" }>): void {
		switch (inbound.kind) {
			case "response": {
				const pending = this.pending.get(String(inbound.id));
				if (pending === undefined) return;
				this.pending.delete(String(inbound.id));
				pending.settle(this.replied(pending.method, inbound.reply));
				return;
			}
			case "notification":
				if (inbound.method === "session/update") this.sessionRecord(sessionRecordOf(inbound.params));
				if (inbound.method === "$/cancel_request") this.cancelCall(inbound.params);
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
			case "fault": {
				const message = `${this.who} sent ${record.message}`;
				this.onFault(message);
				this.toSession(record.sessionId, (route) => route.fault(message));
				return;
			}
			case "invalid":
				this.onFault(`${this.who} sent ${record.message}`);
				return;
			case "other":
				return;
		}
	}

	private agentRequest(id: string | number, method: string, params: unknown): void {
		const withdrawn = new AbortController();
		const answer = this.answerTo(id, withdrawn);
		const call = callOf(method, params, { answer, withdrawn: withdrawn.signal });
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

	private cancelCall(params: unknown): void {
		const cancel = CancelRequest.safeParse(params);
		if (!cancel.success) {
			this.onFault(`${this.who} sent a $/cancel_request without a request id`);
			return;
		}
		const call = this.calls.get(JSON.stringify(cancel.data.requestId));
		if (call === undefined) return;
		this.send({ id: cancel.data.requestId, error: { code: REQUEST_CANCELLED, message: "Request cancelled" } });
		this.calls.delete(JSON.stringify(cancel.data.requestId));
		call.abort();
	}

	private answerTo(id: string | number, withdrawn: AbortController): Answer {
		const key = JSON.stringify(id);
		this.calls.set(key, withdrawn);
		const once = (body: Record<string, unknown>) => {
			if (this.calls.get(key) !== withdrawn) return;
			this.calls.delete(key);
			this.send({ id, ...body });
		};
		return {
			result: (value) => once({ result: value }),
			error: (code, message) => once({ error: { code, message } }),
		};
	}

	private replied(method: string, reply: Reply): RpcResult<unknown> {
		switch (reply.kind) {
			case "result":
				return { ok: true, result: reply.result };
			case "error":
				return { ok: false, failure: { code: reply.code, message: reply.message } };
			case "unreadable":
				return this.unreadable(`${this.who} answered ${method} with ${reply.reason}`);
		}
	}

	private read<T>(method: string, result: unknown, schema: z.ZodType<T>): RpcResult<T> {
		const parsed = schema.safeParse(result);
		if (parsed.success) return { ok: true, result: parsed.data };
		const wrong = parsed.error.issues.slice(0, 1).map(issueText).join("");
		return this.unreadable(`${this.who} answered ${method} with a result the bridge cannot read (${wrong})`);
	}

	private unreadable(message: string): RpcResult<never> {
		this.onFault(message);
		return { ok: false, failure: { message } };
	}

	private send(body: Record<string, unknown>): void {
		if (this.closed === undefined) this.write(`${JSON.stringify({ jsonrpc: "2.0", ...body })}\n`);
	}
}

function issueText(issue: z.core.$ZodIssue): string {
	const at = issue.path.map(String).join(".");
	return at === "" ? issue.message : `${at}: ${issue.message}`;
}

function callOf(method: string, params: unknown, parts: CallParts): AgentCall | "unknown" | undefined {
	if (method === "session/request_permission") {
		const parsed = PermissionRequest.safeParse(params);
		return parsed.success ? { method, params: parsed.data, ...parts } : undefined;
	}
	if (method === "elicitation/create") {
		const parsed = ElicitationRequest.safeParse(params);
		return parsed.success ? { method, params: parsed.data, ...parts } : undefined;
	}
	return "unknown";
}
