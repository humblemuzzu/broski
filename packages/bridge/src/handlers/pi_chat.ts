import * as pi from "../connectors/pi";
import type { Msg, PiMessage } from "../routing/messages";
import type { FileAttachment } from "../types";
import {
	composePromptWithTaggedPaths,
	extractImages,
	extractTaggedPaths,
	type PiHandlerContext,
} from "./pi_message_helpers";
import { broadcastPiRuntimeState, ensureStreamBridge } from "./pi_stream_bridge";
import { broadcastPiStreamMessage } from "./pi_stream_delivery";

async function handleChat(message: Msg<"pi_chat">, ctx: PiHandlerContext): Promise<void> {
	await ensureStreamBridge(ctx.cwd, ctx.broadcast);
	// Also ensure any other active Pi sessions have stream bridges
	for (const { cwd: existingCwd } of pi.listActiveRuntimeStates()) {
		if (existingCwd !== ctx.cwd) {
			await ensureStreamBridge(existingCwd, ctx.broadcast, true);
		}
	}

	const instance = await pi.getOrCreateInstance(ctx.cwd);
	ctx.viewSession(instance.session.sessionId);
	const attachments = message.fileAttachments as FileAttachment[] | undefined;
	const prompt = composePromptWithTaggedPaths(
		typeof message.prompt === "string" ? message.prompt : "",
		extractTaggedPaths(attachments),
	);
	const streamingBehavior =
		message.streamingBehavior === "steer" || message.streamingBehavior === "followUp"
			? message.streamingBehavior
			: undefined;

	void instance.session
		.prompt(prompt, {
			images: extractImages(attachments),
			streamingBehavior,
			source: "rpc",
		})
		.catch((error) => {
			broadcastPiStreamMessage(ctx.broadcast, ctx.cwd, instance.session.sessionId, {
				type: "error",
				message: error instanceof Error ? error.message : String(error),
			});
			broadcastPiRuntimeState(ctx.broadcast, ctx.cwd, pi.mapStatePayload(instance));
		});

	ctx.reply({ type: "pi_chat_started", data: true, requestId: message.requestId });
}

async function handleQueueMessage(
	message: Msg<"pi_steer" | "pi_follow_up">,
	ctx: PiHandlerContext,
	type: "steer" | "followUp",
): Promise<void> {
	await ensureStreamBridge(ctx.cwd, ctx.broadcast);
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	ctx.viewSession(instance.session.sessionId);
	const attachments = message.fileAttachments as FileAttachment[] | undefined;
	const prompt = composePromptWithTaggedPaths(
		typeof message.message === "string" ? message.message : "",
		extractTaggedPaths(attachments),
	);

	if (type === "steer") {
		await instance.session.steer(prompt, extractImages(attachments));
		ctx.reply({ type: "pi_steered", data: true, requestId: message.requestId });
		return;
	}

	await instance.session.followUp(prompt, extractImages(attachments));
	ctx.reply({ type: "pi_followed_up", data: true, requestId: message.requestId });
}

async function handleAbort(message: Msg<"pi_abort">, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	await instance.session.abort();
	ctx.reply({ type: "pi_aborted", data: true, requestId: message.requestId });
}

export async function handle(message: PiMessage, ctx: PiHandlerContext): Promise<boolean> {
	switch (message.type) {
		case "pi_chat": {
			await handleChat(message, ctx);
			return true;
		}

		case "pi_steer": {
			await handleQueueMessage(message, ctx, "steer");
			return true;
		}

		case "pi_follow_up": {
			await handleQueueMessage(message, ctx, "followUp");
			return true;
		}

		case "pi_abort": {
			await handleAbort(message, ctx);
			return true;
		}

		default:
			return false;
	}
}
