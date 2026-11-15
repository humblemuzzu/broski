import type { ActionResult, ClientMessage, PromptResult, Rejected, ResponseFor, SessionControl } from "../contract";
import type { CoreClient } from "./client";
import { type CoreContext, type Respond, reachBackend } from "./context";
import type { LiveSession } from "./live-session";
import { protocolError, rejected } from "./results";
import { sessionKey } from "./session-key";

export const WATCH_ONLY = "this session can only be watched";

/** The requests that need the session's control. */
type ControlType = "prompt" | "abort" | "queue.cancel" | "model.set" | "thinking.set" | "mode.set" | "compact";

/** The requests that act on a session the client views: the control requests and an answer (`answering.ts`). */
export type ViewedType = ControlType | "interaction.answer";

/** `RequestOf<T>`, written so that the fields every such request has stay reachable for a generic `T`. */
type ViewedRequest<T extends ViewedType> = Extract<ClientMessage, { type: ViewedType }> & { type: T };

/** A request that acts on a session, with the session. */
export interface Viewed<T extends ViewedType> {
	readonly ctx: CoreContext;
	readonly client: CoreClient;
	readonly request: ViewedRequest<T>;
	readonly live: LiveSession;
}

/** A control request, with the session it acts on and that session's control. */
export interface Controlled<T extends ControlType> extends Viewed<T> {
	readonly control: SessionControl;
}

type ViewedHandler<T extends ViewedType> = (
	ctx: CoreContext,
	client: CoreClient,
	request: ViewedRequest<T>,
	respond: Respond<ResponseFor<T>>,
) => Promise<void>;

/**
 * The handler of a request that acts on a session. The client must view the session, once every
 * attach and detach it sent before has run, because it acts on state it saw (`not_attached`
 * otherwise). `answer` words the result as the request's response.
 */
export function viewed<T extends ViewedType, R extends ActionResult | PromptResult>(
	answer: (request: ViewedRequest<T>, result: R | Rejected) => ResponseFor<T>,
	run: (target: Viewed<T>) => Promise<R | Rejected>,
): ViewedHandler<T> {
	return async (ctx, client, request, respond) => {
		const key = sessionKey(request.session);
		const live = await client.viewing(key);
		if (!live) {
			if (await reachBackend(ctx, request.session.backend, request.requestId, respond)) {
				respond(protocolError(request.requestId, "not_attached", `attach to ${key} first`));
			}
			return;
		}
		respond(answer(request, await run({ ctx, client, request, live })));
	};
}

/** `viewed`, for a request that needs the session's control: a session that can only be watched answers `unsupported`. */
export function controlled<T extends ControlType, R extends ActionResult | PromptResult>(
	answer: (request: ViewedRequest<T>, result: R | Rejected) => ResponseFor<T>,
	run: (target: Controlled<T>) => Promise<R | Rejected>,
): ViewedHandler<T> {
	return viewed(answer, async (target) => {
		const control = target.live.open.control;
		return control ? run({ ...target, control }) : rejected("unsupported", WATCH_ONLY);
	});
}
