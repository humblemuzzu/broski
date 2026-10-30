import type { ActionResult, ClientMessage, PromptResult, Rejected, ResponseFor, SessionControl } from "../contract";
import type { CoreClient } from "./client";
import { type CoreContext, type Respond, reachBackend } from "./context";
import type { LiveSession } from "./live-session";
import { protocolError, rejected } from "./results";
import { sessionKey } from "./session-key";

export const WATCH_ONLY = "this session can only be watched";

type ControlType =
	| "prompt"
	| "abort"
	| "interaction.answer"
	| "queue.cancel"
	| "model.set"
	| "thinking.set"
	| "mode.set"
	| "compact"
	| "compaction.cancel"
	| "retry.cancel";

/** `RequestOf<T>`, written so that the fields every control request has stay reachable for a generic `T`. */
type ControlRequest<T extends ControlType> = Extract<ClientMessage, { type: ControlType }> & { type: T };
/** A control request, with the session it acts on and that session's control. */
export interface Controlled<T extends ControlType> {
	readonly ctx: CoreContext;
	readonly request: ControlRequest<T>;
	readonly live: LiveSession;
	readonly control: SessionControl;
}

/**
 * The handler of a request that acts on a session. The client must view the session, once every
 * attach and detach it sent before has run, because it acts on state it saw (`not_attached`
 * otherwise); a session that can only be watched answers `unsupported`. `answer` words the result
 * as the request's response.
 */
export function controlled<T extends ControlType, R extends ActionResult | PromptResult>(
	answer: (request: ControlRequest<T>, result: R | Rejected) => ResponseFor<T>,
	run: (target: Controlled<T>) => Promise<R | Rejected>,
): (
	ctx: CoreContext,
	client: CoreClient,
	request: ControlRequest<T>,
	respond: Respond<ResponseFor<T>>,
) => Promise<void> {
	return async (ctx, client, request, respond) => {
		const key = sessionKey(request.session);
		const live = await client.viewing(key);
		if (!live) {
			if (await reachBackend(ctx, request.session.backend, request.requestId, respond)) {
				respond(protocolError(request.requestId, "not_attached", `attach to ${key} first`));
			}
			return;
		}
		const control = live.open.control;
		respond(
			answer(request, control ? await run({ ctx, request, live, control }) : rejected("unsupported", WATCH_ONLY)),
		);
	};
}
