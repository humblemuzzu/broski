import type { ResponseFor } from "../contract";
import { onBackend } from "./context";
import { allowedDirectory } from "./directories";
import { pageWithinFrame } from "./paged-read";
import { unsupported } from "./results";

export const sessionCreate = onBackend<"session.create">(
	(request) => request.backend,
	async ({ ctx, request, respond, backend }) => {
		const directory = await allowedDirectory(ctx.directories, request.options.cwd);
		const result =
			directory.status === "rejected"
				? directory
				: await ctx.hub.create(backend, { ...request.options, cwd: directory.cwd });
		respond({ type: "session.create.result", requestId: request.requestId, result });
	},
);

export const sessionFork = onBackend<"session.fork">(
	(request) => request.session.backend,
	async ({ request, respond, backend }) => {
		const result = backend.fork ? await backend.fork(request.session, request.at) : unsupported("fork a session");
		respond({ type: "session.fork.result", requestId: request.requestId, result });
	},
);

export const sessionRename = onBackend<"session.rename">(
	(request) => request.session.backend,
	async ({ request, respond, backend }) => {
		const result = backend.rename
			? await backend.rename(request.session, request.title)
			: unsupported("rename a session");
		respond({ type: "session.rename.result", requestId: request.requestId, result });
	},
);

export const sessionDelete = onBackend<"session.delete">(
	(request) => request.session.backend,
	async ({ request, respond, backend }) => {
		const result = backend.delete ? await backend.delete(request.session) : unsupported("delete a session");
		respond({ type: "session.delete.result", requestId: request.requestId, result });
	},
);

export const transcriptRead = onBackend<"transcript.read">(
	(request) => request.session.backend,
	async ({ ctx, request, respond, backend }) => {
		const message = await pageWithinFrame(
			ctx.maxFrameBytes,
			request.page.limit,
			async (limit): Promise<ResponseFor<"transcript.read">> => {
				const result = await backend.readTranscript(request.session, { ...request.page, limit });
				return {
					type: "transcript.read.result",
					requestId: request.requestId,
					result,
				};
			},
		);
		respond(message);
	},
);

export const attachmentRead = onBackend<"attachment.read">(
	(request) => request.session.backend,
	async ({ request, respond, backend }) => {
		const result = await backend.readAttachment(request.session, request.attachmentId, request.variant);
		respond({ type: "attachment.read.result", requestId: request.requestId, result });
	},
);
