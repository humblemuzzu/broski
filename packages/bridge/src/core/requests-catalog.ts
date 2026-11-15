import { PROTOCOL_VERSION, type ResponseFor } from "../contract";
import { type Handler, onBackend } from "./context";
import { allowedOptionalDirectory } from "./directories";
import { pageWithinFrame } from "./paged-read";
import { protocolError } from "./results";

/**
 * Bridge and app talk only when `major` is equal (README §12.4).
 */
export const hello: Handler<"hello"> = async (ctx, client, request, respond) => {
	const theirs = request.protocol;
	if (!client.hello(theirs, PROTOCOL_VERSION)) {
		for (const live of client.detachAll()) ctx.hub.leave(live, client);
		ctx.terminals.leave(client);
		respond(
			protocolError(
				request.requestId,
				"unsupported_version",
				`this bridge speaks protocol ${PROTOCOL_VERSION.major}.${PROTOCOL_VERSION.minor}; the app speaks ${theirs.major}.${theirs.minor}`,
			),
		);
		return;
	}
	respond({
		type: "hello.result",
		requestId: request.requestId,
		protocol: PROTOCOL_VERSION,
		bridgeVersion: ctx.bridgeVersion,
	});
};

/** The backends registered now; one still starting is announced by a `status_changed` once it lands. */
export const backendsList: Handler<"backends.list"> = async (ctx, _client, request, respond) => {
	const backends = ctx.registry.descriptors();
	respond({ type: "backends.list.result", requestId: request.requestId, backends });
};

export const backendStatus = onBackend<"backend.status">(
	(request) => request.backend,
	async ({ ctx, request, respond, backend }) => {
		const status = await ctx.registry.status(backend);
		respond({ type: "backend.status.result", requestId: request.requestId, status });
	},
);

export const modelsList = onBackend<"models.list">(
	(request) => request.backend,
	async ({ ctx, request, respond, backend }) => {
		const options = { includeUnavailable: request.includeUnavailable === true };
		const directory = await allowedOptionalDirectory(ctx.directories, request.cwd);
		const result = directory?.status === "rejected" ? directory : await backend.listModels(directory?.cwd, options);
		respond({ type: "models.list.result", requestId: request.requestId, result });
	},
);

export const commandsList = onBackend<"commands.list">(
	(request) => request.backend,
	async ({ ctx, request, respond, backend }) => {
		const directory = await allowedOptionalDirectory(ctx.directories, request.cwd);
		const result =
			directory?.status === "rejected"
				? directory
				: await backend.listCommands({
						...(directory && { cwd: directory.cwd }),
						...(request.session !== undefined && { session: request.session }),
					});
		respond({ type: "commands.list.result", requestId: request.requestId, result });
	},
);

export const modesList = onBackend<"modes.list">(
	(request) => request.backend,
	async ({ ctx, request, respond, backend }) => {
		const directory = await allowedOptionalDirectory(ctx.directories, request.cwd);
		const result = directory?.status === "rejected" ? directory : await backend.listModes(directory?.cwd);
		respond({ type: "modes.list.result", requestId: request.requestId, result });
	},
);

export const sessionsList = onBackend<"sessions.list">(
	(request) => request.backend,
	async ({ ctx, request, respond, backend }) => {
		const directory = await allowedOptionalDirectory(ctx.directories, request.query.cwd);
		if (directory?.status === "rejected") {
			respond({ type: "sessions.list.result", requestId: request.requestId, result: directory });
			return;
		}
		const query = directory ? { ...request.query, cwd: directory.cwd } : request.query;
		const message = await pageWithinFrame(
			ctx.maxFrameBytes,
			request.page.limit,
			async (limit): Promise<ResponseFor<"sessions.list">> => ({
				type: "sessions.list.result",
				requestId: request.requestId,
				result: await backend.listSessions(query, { ...request.page, limit }),
			}),
		);
		respond(message);
	},
);

export const sessionGet = onBackend<"session.get">(
	(request) => request.session.backend,
	async ({ request, respond, backend }) => {
		const result = await backend.getSession(request.session);
		respond({ type: "session.get.result", requestId: request.requestId, result });
	},
);
