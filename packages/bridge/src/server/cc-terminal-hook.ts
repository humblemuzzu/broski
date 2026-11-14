/**
 * The loopback endpoint a terminal `claude`'s `PermissionRequest` hook posts to (Claude Code PLAN D26). The request
 * stays open while a person decides on the phone; the answer is the hook's JSON body. It never answers by itself: a
 * request the adapter has no answer for, or that the CLI drops (its own hook timeout, or the terminal gone), ends with
 * `{}`, which leaves the decision to the terminal's own prompt. Authentication is the loopback listener's bearer token,
 * checked before a request reaches here (`http-handler.ts`).
 */

import type { PermissionRequestHookInput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { TerminalAskHandler, TerminalPermissionDecision } from "../backends/claude-code/ports/terminal";
import { MAX_MESSAGE_BYTES, MAX_NAME_CHARS, MAX_PATH_CHARS, type SessionRef } from "../contract";

const MAX_PENDING_ASKS = 64;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HookAsk = z.looseObject({
	hook_event_name: z.literal("PermissionRequest"),
	session_id: z.string().regex(SESSION_ID),
	transcript_path: z.string().max(MAX_PATH_CHARS),
	cwd: z.string().max(MAX_PATH_CHARS),
	tool_name: z.string().min(1).max(MAX_NAME_CHARS),
	tool_input: z.unknown(),
});

export interface TerminalHookDeps {
	/** `ContractSeam.hold` / `release` (core README §20): the session stays open while the ask is on it. */
	readonly hold: (session: SessionRef) => Promise<{ readonly status: string }>;
	readonly release: (session: SessionRef) => void;
	readonly log: (message: string) => void;
}

export interface TerminalHookReceiver {
	handle(request: Request): Promise<Response>;
	/** The adapter's handler, given once at its start (`TerminalOptions.hookAsks`). */
	readonly setHandler: (handler: TerminalAskHandler) => void;
}

export function createTerminalHookReceiver(deps: TerminalHookDeps): TerminalHookReceiver {
	let handler: TerminalAskHandler | undefined;
	let pending = 0;

	async function handle(request: Request): Promise<Response> {
		if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
		if (pending >= MAX_PENDING_ASKS) return Response.json({ error: "Too many asks" }, { status: 429 });
		pending += 1;
		try {
			return await receive(request);
		} finally {
			pending -= 1;
		}
	}

	async function receive(request: Request): Promise<Response> {
		const body = await readBounded(request);
		if (body === undefined) return Response.json({ error: "Body too large" }, { status: 413 });
		const parsed = HookAsk.safeParse(parseJson(body));
		if (!parsed.success) return Response.json({ error: "Not a PermissionRequest hook input" }, { status: 400 });
		return handler === undefined ? noDecision() : ask(handler, parsed.data, request.signal);
	}

	async function ask(
		asker: TerminalAskHandler,
		input: z.infer<typeof HookAsk>,
		clientGone: AbortSignal,
	): Promise<Response> {
		const stop = new AbortController();
		const onGone = () => stop.abort();
		if (clientGone.aborted) stop.abort();
		else clientGone.addEventListener("abort", onGone, { once: true });
		try {
			return await decide(asker, input, stop);
		} finally {
			clientGone.removeEventListener("abort", onGone);
		}
	}

	async function decide(
		asker: TerminalAskHandler,
		input: z.infer<typeof HookAsk>,
		stop: AbortController,
	): Promise<Response> {
		const ref: SessionRef = { backend: "claude-code", sessionId: input.session_id };
		const asking = (async () => asker(askOf(input), stop.signal))().catch(() => undefined);
		const early = await Promise.race([asking.then((decision) => ({ decision })), tick()]);
		if (early !== undefined) return answerOf(early.decision);
		const held = await deps.hold(ref).catch(() => ({ status: "rejected" }));
		if (held.status !== "accepted") {
			stop.abort();
			await asking;
			return noDecision();
		}
		try {
			const decision = await asking;
			deps.log(
				`[CC terminal ask] ${input.tool_name} on ${input.session_id}: ${decision?.behavior ?? "left to the terminal"}`,
			);
			return answerOf(decision);
		} finally {
			deps.release(ref);
		}
	}

	return { handle, setHandler: (next) => (handler = next) };
}

function askOf(input: z.infer<typeof HookAsk>): PermissionRequestHookInput {
	return {
		hook_event_name: "PermissionRequest",
		session_id: input.session_id,
		transcript_path: input.transcript_path,
		cwd: input.cwd,
		tool_name: input.tool_name,
		tool_input: input.tool_input,
	};
}

function noDecision(): Response {
	return Response.json({});
}

function answerOf(decision: TerminalPermissionDecision | undefined): Response {
	return decision === undefined
		? noDecision()
		: Response.json({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision } });
}

/** One turn of the event loop: an adapter that declines at once (a hosted session, a question) has by then. */
function tick(): Promise<undefined> {
	return new Promise((resolve) => setTimeout(resolve, 0, undefined));
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** The body as text, or undefined past the bound; never buffers more than the bound. */
async function readBounded(request: Request): Promise<string | undefined> {
	const declared = Number(request.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > MAX_MESSAGE_BYTES) return undefined;
	if (request.body === null) return "";
	const reader = request.body.getReader();
	const parts: Uint8Array[] = [];
	let total = 0;
	for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
		total += chunk.value.length;
		if (total > MAX_MESSAGE_BYTES) {
			await reader.cancel();
			return undefined;
		}
		parts.push(chunk.value);
	}
	return new TextDecoder().decode(Buffer.concat(parts));
}
