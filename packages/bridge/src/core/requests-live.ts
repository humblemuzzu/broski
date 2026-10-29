import {
	type ActionResult,
	type ErrorResponse,
	type PromptResult,
	type Rejected,
	sessionCapabilities,
} from "../contract";
import { type BackendRequest, type Handler, reachBackend } from "./context";
import { controlled } from "./controlled";
import { LiveSession } from "./live-session";
import { HELLO_FIRST, protocolError, unsupported } from "./results";
import { sessionKey } from "./session-key";

/** Sessions one client may view at once; each holds an `OpenSession` open. */
export const MAX_SESSIONS_PER_CLIENT = 32;

/** In order with the client's other attaches and detaches of the session, from the moment it arrives. */
export const sessionAttach: Handler<"session.attach"> = (ctx, client, request, respond) =>
	client.inOrder(sessionKey(request.session), async () => {
		const backend = await reachBackend(ctx, request.session.backend, request.requestId, respond);
		if (backend) await attach({ ctx, client, request, respond, backend });
	});

/** Re-attaching to a session already viewed holds no new place under the cap; a new one does, from the start. */
async function attach(target: BackendRequest<"session.attach">): Promise<void> {
	const { client, request, respond } = target;
	const reserved = client.attachedTo(sessionKey(request.session)) === undefined;
	if (reserved && !client.reserve(MAX_SESSIONS_PER_CLIENT)) {
		const text = `a client views at most ${MAX_SESSIONS_PER_CLIENT} sessions; detach one first`;
		respond(protocolError(request.requestId, "invalid_message", text));
		return;
	}
	try {
		await join(target);
	} finally {
		if (reserved) client.release();
	}
}

async function join({ ctx, client, request, respond, backend }: BackendRequest<"session.attach">): Promise<void> {
	const live = await ctx.hub.acquire(backend, request.session);
	if (!(live instanceof LiveSession)) {
		respond(openFailure(request.requestId, live));
		return;
	}
	if (!client.connected) return;
	if (!client.negotiated) {
		respond(protocolError(request.requestId, "invalid_message", HELLO_FIRST));
		return;
	}
	if (live.closed) {
		respond(protocolError(request.requestId, "unknown_session", "the session went away while attaching"));
		return;
	}
	// Nothing below awaits, so no event can fall between the sync and the first live event.
	live.reconcile();
	const { sync, replay } = live.sync(request.resume);
	const sent = respond({
		type: "session.attach.result",
		requestId: request.requestId,
		capabilities: sessionCapabilities(live.open),
		sync,
	});
	if (!sent) return;
	for (const frame of replay) client.send(frame);
	live.viewers.add(client);
	client.attach(live);
	ctx.hub.reviewIdle(live);
}

function openFailure(requestId: string, failure: Rejected): ErrorResponse {
	const { code, message } = failure.rejection;
	return code === "not_found"
		? protocolError(requestId, "unknown_session", message)
		: protocolError(requestId, "internal", `the session could not be opened (${code}): ${message}`);
}

export const sessionDetach: Handler<"session.detach"> = async (ctx, client, request, respond) => {
	const key = sessionKey(request.session);
	await client.inOrder(key, async () => {
		const live = client.attachedTo(key);
		if (!live) {
			respond(protocolError(request.requestId, "not_attached", `not attached to ${key}`));
			return;
		}
		client.forget(live);
		ctx.hub.leave(live, client);
		respond({ type: "session.detach.result", requestId: request.requestId });
	});
};

export const prompt = controlled<"prompt", PromptResult>(
	(request, result) => ({ type: "prompt.result", requestId: request.requestId, result }),
	({ ctx, request, live, control }) => ctx.ledger.submit(live.ref, request.input, (input) => control.prompt(input)),
);

export const interactionAnswer = controlled<"interaction.answer", ActionResult>(
	(request, result) => ({ type: "interaction.answer.result", requestId: request.requestId, result }),
	({ ctx, request, live, control }) => ctx.desk.answer(live, control, request.answer),
);

export const abort = controlled<"abort", ActionResult>(
	(request, result) => ({ type: "abort.result", requestId: request.requestId, result }),
	({ control }) => control.abort(),
);

export const queueCancel = controlled<"queue.cancel", ActionResult>(
	(request, result) => ({ type: "queue.cancel.result", requestId: request.requestId, result }),
	async ({ request, control }) =>
		control.cancelQueued ? control.cancelQueued(request.queueItemId) : unsupported("cancel queued input"),
);

export const modelSet = controlled<"model.set", ActionResult>(
	(request, result) => ({ type: "model.set.result", requestId: request.requestId, result }),
	({ request, control }) => control.setModel(request.modelId),
);

export const thinkingSet = controlled<"thinking.set", ActionResult>(
	(request, result) => ({ type: "thinking.set.result", requestId: request.requestId, result }),
	({ request, control }) => control.setThinking(request.thinking),
);

export const modeSet = controlled<"mode.set", ActionResult>(
	(request, result) => ({ type: "mode.set.result", requestId: request.requestId, result }),
	({ request, control }) => control.setMode(request.axis, request.value),
);

export const compact = controlled<"compact", ActionResult>(
	(request, result) => ({ type: "compact.result", requestId: request.requestId, result }),
	async ({ request, control }) =>
		control.compact ? control.compact(request.instructions) : unsupported("compact this session"),
);
