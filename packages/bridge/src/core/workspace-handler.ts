import type { Rejected, ResponseFor } from "../contract";
import type { CoreClient } from "./client";
import type { CoreContext, Handler, RequestOf, RequestType } from "./context";
import { pageWithinFrame } from "./paged-read";
import type { WorkspaceHost } from "./ports";
import { rejected } from "./results";

export const NO_WORKSPACE = "this bridge serves no workspace";

/** A workspace request, with the workspace it reaches. */
export interface WorkspaceRequest<T extends RequestType> {
	readonly ctx: CoreContext;
	readonly client: CoreClient;
	readonly request: RequestOf<T>;
	readonly workspace: WorkspaceHost;
}

/** Words a result as the request's response. */
type Answer<T extends RequestType, R> = (request: RequestOf<T>, result: R | Rejected) => ResponseFor<T>;

/** The handler of a workspace request; a bridge without a workspace answers `unsupported`. */
export function served<T extends RequestType, R>(
	answer: Answer<T, R>,
	run: (target: WorkspaceRequest<T>) => Promise<R>,
): Handler<T> {
	return async (ctx, client, request, respond) => {
		const workspace = ctx.workspace;
		const result = workspace ? await run({ ctx, client, request, workspace }) : rejected("unsupported", NO_WORKSPACE);
		respond(answer(request, result));
	};
}

/**
 * `served`, for an answer `run` bounds by a size (entries, bytes, characters), starting from `initial`: while
 * the answer does not fit the link it is read again smaller, as a page is (`pageWithinFrame`).
 */
export function fitted<T extends RequestType, R>(
	answer: Answer<T, R>,
	initial: (request: RequestOf<T>) => number,
	run: (target: WorkspaceRequest<T>, size: number) => Promise<R>,
): Handler<T> {
	return async (ctx, client, request, respond) => {
		const workspace = ctx.workspace;
		if (!workspace) {
			respond(answer(request, rejected("unsupported", NO_WORKSPACE)));
			return;
		}
		const target = { ctx, client, request, workspace };
		respond(
			await pageWithinFrame(ctx.maxFrameBytes, initial(request), async (size) =>
				answer(request, await run(target, size)),
			),
		);
	};
}
