/**
 * One JSON-RPC record the agent wrote: a request has `method` and `id`, a notification only `method`, a response only
 * `id`. A response is read by its `id` first, so one whose body does not read still ends the request it answers.
 */

import { z } from "zod";
import { isKnownUpdate, SessionNotification, SessionUpdate } from "./frames";

const Id = z.union([z.string(), z.number()]);

const Envelope = z.object({
	id: Id.nullish(),
	method: z.string().nullish(),
	params: z.unknown().optional(),
	result: z.unknown().optional(),
	error: z.unknown().optional(),
});

const RpcError = z.object({ code: z.number(), message: z.string() });

/** `unreadable`: a response whose body is neither a result nor an error the client can read. */
export type Reply =
	| { readonly kind: "result"; readonly result: unknown }
	| { readonly kind: "error"; readonly code: number; readonly message: string }
	| { readonly kind: "unreadable"; readonly reason: string };

export type Inbound =
	| { readonly kind: "response"; readonly id: string | number; readonly reply: Reply }
	| { readonly kind: "request"; readonly id: string | number; readonly method: string; readonly params: unknown }
	| { readonly kind: "notification"; readonly method: string; readonly params: unknown }
	| { readonly kind: "invalid"; readonly reason: string };

export function parseInbound(text: string): Inbound {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return { kind: "invalid", reason: "a line that is not JSON" };
	}
	const envelope = Envelope.safeParse(value);
	if (!envelope.success) return { kind: "invalid", reason: "a record that is not JSON-RPC" };
	const { id, method, params } = envelope.data;
	if (method != null) {
		return id == null ? { kind: "notification", method, params } : { kind: "request", id, method, params };
	}
	if (id == null) return { kind: "invalid", reason: "a response without an id" };
	return { kind: "response", id, reply: replyOf(envelope.data) };
}

/** JSON-RPC 2.0 gives a response a `result` or an `error`; an `error` of `null` is none. */
function replyOf({ result, error }: { readonly result?: unknown; readonly error?: unknown }): Reply {
	if (error != null) {
		const read = RpcError.safeParse(error);
		return read.success
			? { kind: "error", ...read.data }
			: { kind: "unreadable", reason: "an error that is not a JSON-RPC error" };
	}
	return result === undefined
		? { kind: "unreadable", reason: "neither a result nor an error" }
		: { kind: "result", result };
}

/** `other`: an update of a kind the adapter does not read, which it lets pass. */
export type SessionRecord =
	| { readonly kind: "update"; readonly sessionId: string; readonly update: SessionUpdate }
	| { readonly kind: "fault"; readonly sessionId: string; readonly message: string }
	| { readonly kind: "other" }
	| { readonly kind: "invalid"; readonly message: string };

export function sessionRecordOf(params: unknown): SessionRecord {
	const notification = SessionNotification.safeParse(params);
	if (!notification.success) return { kind: "invalid", message: "a session/update without a session" };
	const { sessionId, update } = notification.data;
	const parsed = SessionUpdate.safeParse(update);
	if (parsed.success) return { kind: "update", sessionId, update: parsed.data };
	if (!isKnownUpdate(update.sessionUpdate)) return { kind: "other" };
	return { kind: "fault", sessionId, message: `a ${update.sessionUpdate} update that does not read as one` };
}
