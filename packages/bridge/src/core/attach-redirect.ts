import { type SessionRef, sessionCapabilities } from "../contract";
import { type BackendRequest, type CoreContext, reachBackend } from "./context";
import { LiveSession } from "./live-session";
import { openFailure } from "./results";

/** A stream that ended in `session_replaced`, and the session its conversation went on as. */
export interface Replaced {
	readonly epoch: string;
	readonly session: SessionRef;
}

/**
 * Where the conversation of the stream `epoch` went on, when that stream ended in `session_replaced`.
 */
export function movedTo(ctx: CoreContext, epoch: string | undefined): Replaced | undefined {
	if (epoch === undefined) return undefined;
	const session = ctx.replacements.successor(epoch);
	return session && { epoch, session };
}

/**
 * Answers an attach to a replaced session with the session that continues it (contract README §5).
 * The client views nothing: it attaches to the successor next, which this opens meanwhile so the
 * answer's `capabilities` are the successor's own.
 */
export async function redirectAttach(target: BackendRequest<"session.attach">, moved: Replaced): Promise<void> {
	const { ctx, request, respond } = target;
	const backend = await reachBackend(ctx, moved.session.backend, request.requestId, respond);
	if (!backend) return;
	const live = await ctx.hub.acquire(backend, moved.session);
	if (!(live instanceof LiveSession)) {
		respond(openFailure(request.requestId, live));
		return;
	}
	respond({
		type: "session.attach.result",
		requestId: request.requestId,
		capabilities: sessionCapabilities(live.open),
		sync: { kind: "replaced", epoch: moved.epoch, session: live.ref },
	});
}
