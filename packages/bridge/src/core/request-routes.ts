import type { ClientMessage, ServerMessage } from "../contract";
import type { CoreClient } from "./client";
import type { CoreContext } from "./context";
import {
	backendStatus,
	backendsList,
	commandsList,
	hello,
	modelsList,
	modesList,
	sessionGet,
	sessionsList,
} from "./requests-catalog";
import {
	abort,
	compact,
	interactionAnswer,
	modelSet,
	modeSet,
	prompt,
	queueCancel,
	sessionAttach,
	sessionDetach,
	thinkingSet,
} from "./requests-live";
import {
	attachmentRead,
	backendCall,
	sessionArchive,
	sessionCreate,
	sessionDelete,
	sessionFork,
	sessionRename,
	transcriptRead,
} from "./requests-sessions";

/** Every request of `protocol.ts` to its handler; a request type without one does not compile. */
export function routeRequest(
	ctx: CoreContext,
	client: CoreClient,
	request: ClientMessage,
	respond: (message: ServerMessage) => boolean,
): Promise<void> {
	switch (request.type) {
		case "hello":
			return hello(ctx, client, request, respond);
		case "backends.list":
			return backendsList(ctx, client, request, respond);
		case "backend.status":
			return backendStatus(ctx, client, request, respond);
		case "models.list":
			return modelsList(ctx, client, request, respond);
		case "commands.list":
			return commandsList(ctx, client, request, respond);
		case "modes.list":
			return modesList(ctx, client, request, respond);
		case "sessions.list":
			return sessionsList(ctx, client, request, respond);
		case "session.get":
			return sessionGet(ctx, client, request, respond);
		case "session.create":
			return sessionCreate(ctx, client, request, respond);
		case "session.fork":
			return sessionFork(ctx, client, request, respond);
		case "session.rename":
			return sessionRename(ctx, client, request, respond);
		case "session.delete":
			return sessionDelete(ctx, client, request, respond);
		case "session.archive":
			return sessionArchive(ctx, client, request, respond);
		case "session.attach":
			return sessionAttach(ctx, client, request, respond);
		case "session.detach":
			return sessionDetach(ctx, client, request, respond);
		case "transcript.read":
			return transcriptRead(ctx, client, request, respond);
		case "attachment.read":
			return attachmentRead(ctx, client, request, respond);
		case "prompt":
			return prompt(ctx, client, request, respond);
		case "abort":
			return abort(ctx, client, request, respond);
		case "interaction.answer":
			return interactionAnswer(ctx, client, request, respond);
		case "queue.cancel":
			return queueCancel(ctx, client, request, respond);
		case "model.set":
			return modelSet(ctx, client, request, respond);
		case "thinking.set":
			return thinkingSet(ctx, client, request, respond);
		case "mode.set":
			return modeSet(ctx, client, request, respond);
		case "compact":
			return compact(ctx, client, request, respond);
		case "backend.call":
			return backendCall(ctx, client, request, respond);
	}
}
