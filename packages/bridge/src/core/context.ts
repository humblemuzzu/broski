import type { AgentBackend, BackendId, ClientMessage, ErrorResponse, ResponseFor, ServerMessage } from "../contract";
import type { BackendRegistry } from "./backend-registry";
import type { CoreClient } from "./client";
import type { InteractionDesk } from "./interaction-desk";
import type { CoreClock, CoreLog, DirectoryPolicy, WorkspaceHost } from "./ports";
import type { PromptLedger } from "./prompt-ledger";
import type { Replacements } from "./replacements";
import { protocolError } from "./results";
import type { SessionHub } from "./session-hub";
import type { TerminalViewers } from "./terminal-viewers";

/** Everything a request handler reaches. */
export interface CoreContext {
	readonly registry: BackendRegistry;
	readonly hub: SessionHub;
	readonly desk: InteractionDesk;
	readonly ledger: PromptLedger;
	readonly replacements: Replacements;
	readonly directories: DirectoryPolicy;
	/** Absent when the bridge serves no workspace: every workspace request is then `unsupported`. */
	readonly workspace: WorkspaceHost | undefined;
	readonly terminals: TerminalViewers;
	readonly bridgeVersion: string;
	readonly maxFrameBytes: number;
	readonly clock: CoreClock;
	readonly log: CoreLog;
}

/**
 * Sends the one answer a request gets; true when it went out as given, false when the bridge had to
 * answer with an `error` instead (it broke the contract or could not fit the link) or had answered
 * already (the request ran past its deadline).
 */
export type Respond<M extends ServerMessage> = (message: M | ErrorResponse) => boolean;

export type RequestType = ClientMessage["type"];

export type RequestOf<T extends RequestType> = Extract<ClientMessage, { type: T }>;

/** Serves one request; it calls `respond` exactly once. */
export type Handler<T extends RequestType> = (
	ctx: CoreContext,
	client: CoreClient,
	request: RequestOf<T>,
	respond: Respond<ResponseFor<T>>,
) => Promise<void>;

/** A request that names a backend, with the backend it names. */
export interface BackendRequest<T extends RequestType> {
	readonly ctx: CoreContext;
	readonly client: CoreClient;
	readonly request: RequestOf<T>;
	readonly respond: Respond<ResponseFor<T>>;
	readonly backend: AgentBackend;
}

/**
 * The handler of a request that names a backend: `serve` gets the backend, after waiting for one
 * still starting (`BackendRegistry.reach`); without one the request is answered `unknown_backend`.
 */
export function onBackend<T extends RequestType>(
	backendOf: (request: RequestOf<T>) => BackendId,
	serve: (target: BackendRequest<T>) => Promise<void>,
): Handler<T> {
	return async (ctx, client, request, respond) => {
		const backend = await reachBackend(ctx, backendOf(request), request.requestId, respond);
		if (backend) await serve({ ctx, client, request, respond, backend });
	};
}

/** The backend `id`, after waiting for one still starting; undefined once the request is answered `unknown_backend`. */
export async function reachBackend(
	ctx: CoreContext,
	id: BackendId,
	requestId: string,
	respond: (error: ErrorResponse) => boolean,
): Promise<AgentBackend | undefined> {
	const reached = await ctx.registry.reach(id);
	if ("backend" in reached) return reached.backend;
	respond(protocolError(requestId, "unknown_backend", reached.missing));
	return undefined;
}
