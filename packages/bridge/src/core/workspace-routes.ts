import type { ClientMessage, ServerMessage } from "../contract";
import type { CoreClient } from "./client";
import type { CoreContext } from "./context";
import { termAttach, termClose, termDetach, termInput, termList, termOpen, termResize } from "./requests-terminal";
import {
	fsImage,
	fsList,
	fsRead,
	fsSearch,
	gitBranches,
	gitCheckout,
	gitCommit,
	gitDiff,
	gitLog,
	gitStage,
	gitStatus,
	gitUnstage,
	workspaceInfo,
} from "./requests-workspace";

/** The workspace requests (contract README §20); with `routeRequest`'s, every request type has a handler. */
export type WorkspaceMessage = Extract<
	ClientMessage,
	{ type: "workspace.info" | `fs.${string}` | `git.${string}` | `term.${string}` }
>;

/** Every workspace request to its handler; one without a handler does not compile. */
export function routeWorkspaceRequest(
	ctx: CoreContext,
	client: CoreClient,
	request: WorkspaceMessage,
	respond: (message: ServerMessage) => boolean,
): Promise<void> {
	switch (request.type) {
		case "workspace.info":
			return workspaceInfo(ctx, client, request, respond);
		case "fs.list":
			return fsList(ctx, client, request, respond);
		case "fs.read":
			return fsRead(ctx, client, request, respond);
		case "fs.image":
			return fsImage(ctx, client, request, respond);
		case "fs.search":
			return fsSearch(ctx, client, request, respond);
		case "git.status":
			return gitStatus(ctx, client, request, respond);
		case "git.diff":
			return gitDiff(ctx, client, request, respond);
		case "git.stage":
			return gitStage(ctx, client, request, respond);
		case "git.unstage":
			return gitUnstage(ctx, client, request, respond);
		case "git.commit":
			return gitCommit(ctx, client, request, respond);
		case "git.branches":
			return gitBranches(ctx, client, request, respond);
		case "git.checkout":
			return gitCheckout(ctx, client, request, respond);
		case "git.log":
			return gitLog(ctx, client, request, respond);
		case "term.list":
			return termList(ctx, client, request, respond);
		case "term.open":
			return termOpen(ctx, client, request, respond);
		case "term.attach":
			return termAttach(ctx, client, request, respond);
		case "term.detach":
			return termDetach(ctx, client, request, respond);
		case "term.input":
			return termInput(ctx, client, request, respond);
		case "term.resize":
			return termResize(ctx, client, request, respond);
		case "term.close":
			return termClose(ctx, client, request, respond);
	}
}
