import type { ActionResult, ClientMessage, ResponseFor, TermListResult, TermOpenResult } from "../contract";
import type { CoreClient } from "./client";
import type { CoreContext, Handler, Respond } from "./context";
import type { WorkspaceHost } from "./ports";
import { protocolError, rejected } from "./results";
import { NO_WORKSPACE, served } from "./workspace-handler";

export const termList = served<"term.list", TermListResult>(
	(request, result) => ({ type: "term.list.result", requestId: request.requestId, result }),
	({ workspace }) => workspace.terminals.list(),
);

export const termOpen = served<"term.open", TermOpenResult>(
	(request, result) => ({ type: "term.open.result", requestId: request.requestId, result }),
	({ workspace, request }) => workspace.terminals.open(request),
);

/**
 * Nothing here awaits: the replay ends exactly where the client's first live `term_output` begins, since the
 * workspace's output reaches the core only between turns of the event loop. A terminal that has exited sends
 * nothing more, so attaching to one reads its replay and views nothing.
 */
export const termAttach: Handler<"term.attach"> = async (ctx, client, request, respond) => {
	const workspace = ctx.workspace;
	const result = workspace ? workspace.terminals.attach(request) : rejected("unsupported", NO_WORKSPACE);
	const sent = respond({ type: "term.attach.result", requestId: request.requestId, result });
	if (sent && result.status === "accepted" && result.terminal.status === "running") {
		ctx.terminals.attach(request.id, client);
	} else ctx.terminals.detach(request.id, client);
};

export const termDetach: Handler<"term.detach"> = async (ctx, client, request, respond) => {
	if (ctx.terminals.detach(request.id, client)) {
		respond({ type: "term.detach.result", requestId: request.requestId });
	} else {
		respond(protocolError(request.requestId, "not_attached", `not attached to terminal ${JSON.stringify(request.id)}`));
	}
};

type AttachedType = "term.input" | "term.resize";

/** `RequestOf<T>`, written so that the fields both requests have stay reachable for a generic `T`. */
type AttachedRequest<T extends AttachedType> = Extract<ClientMessage, { type: AttachedType }> & { type: T };

type AttachedHandler<T extends AttachedType> = (
	ctx: CoreContext,
	client: CoreClient,
	request: AttachedRequest<T>,
	respond: Respond<ResponseFor<T>>,
) => Promise<void>;

/**
 * Input and resizes act on a terminal the client is attached to, and are handed over before anything awaits,
 * so a client's keystrokes reach the terminal in the order it sent them.
 */
function attachedOnly<T extends AttachedType>(
	answer: (request: AttachedRequest<T>, result: ActionResult) => ResponseFor<T>,
	act: (workspace: WorkspaceHost, request: AttachedRequest<T>) => ActionResult,
): AttachedHandler<T> {
	return async (ctx, client, request, respond) => {
		const workspace = ctx.workspace;
		if (!workspace) respond(answer(request, rejected("unsupported", NO_WORKSPACE)));
		else if (client.terminals.has(request.id)) respond(answer(request, act(workspace, request)));
		else
			respond(
				protocolError(request.requestId, "not_attached", `attach to terminal ${JSON.stringify(request.id)} first`),
			);
	};
}

export const termInput = attachedOnly<"term.input">(
	(request, result) => ({ type: "term.input.result", requestId: request.requestId, result }),
	(workspace, request) => workspace.terminals.input(request),
);

export const termResize = attachedOnly<"term.resize">(
	(request, result) => ({ type: "term.resize.result", requestId: request.requestId, result }),
	(workspace, request) => workspace.terminals.resize(request),
);

/** Closing needs no attach: a terminal can be ended from the list. Its viewers are told by `term_exited`. */
export const termClose = served<"term.close", ActionResult>(
	(request, result) => ({ type: "term.close.result", requestId: request.requestId, result }),
	({ workspace, request }) => workspace.terminals.close(request),
);
