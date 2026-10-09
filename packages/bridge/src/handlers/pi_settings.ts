import * as pi from "../connectors/pi";
import { type PiHandlerContext, parseQueueMode } from "./pi_message_helpers";

async function handleSetQueueMode(message: any, ctx: PiHandlerContext, type: "steering" | "followUp"): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	const mode = parseQueueMode(message.mode);

	if (type === "steering") {
		instance.session.setSteeringMode(mode);
		ctx.reply({
			type: "pi_steering_mode_set",
			data: { mode: instance.session.steeringMode },
			requestId: message.requestId,
		});
		return;
	}

	instance.session.setFollowUpMode(mode);
	ctx.reply({
		type: "pi_follow_up_mode_set",
		data: { mode: instance.session.followUpMode },
		requestId: message.requestId,
	});
}

async function handleSetAutoRetry(message: any, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	instance.session.setAutoRetryEnabled(message.enabled === true);
	ctx.reply({ type: "pi_auto_retry_set", data: instance.session.autoRetryEnabled, requestId: message.requestId });
}

async function handleAbortRetry(message: any, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	instance.session.abortRetry();
	ctx.reply({ type: "pi_retry_aborted", data: true, requestId: message.requestId });
}

async function handleSetAutoCompaction(message: any, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	instance.session.setAutoCompactionEnabled(message.enabled === true);
	ctx.reply({
		type: "pi_auto_compaction_set",
		data: instance.session.autoCompactionEnabled,
		requestId: message.requestId,
	});
}

async function handleGetSettings(message: any, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	ctx.reply({ type: "pi_settings", data: pi.getSettings(instance), requestId: message.requestId });
}

async function handleSetSettings(message: any, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	await pi.applySettings(
		instance,
		(message.settings && typeof message.settings === "object" ? message.settings : {}) as Record<string, unknown>,
	);
	ctx.reply({ type: "pi_settings_updated", data: true, requestId: message.requestId });
}

export async function handle(message: any, ctx: PiHandlerContext): Promise<boolean> {
	switch (message.type) {
		case "pi_set_steering_mode": {
			await handleSetQueueMode(message, ctx, "steering");
			return true;
		}

		case "pi_set_follow_up_mode": {
			await handleSetQueueMode(message, ctx, "followUp");
			return true;
		}

		case "pi_set_auto_retry": {
			await handleSetAutoRetry(message, ctx);
			return true;
		}

		case "pi_abort_retry": {
			await handleAbortRetry(message, ctx);
			return true;
		}

		case "pi_set_auto_compaction": {
			await handleSetAutoCompaction(message, ctx);
			return true;
		}

		case "pi_get_settings": {
			await handleGetSettings(message, ctx);
			return true;
		}

		case "pi_set_settings": {
			await handleSetSettings(message, ctx);
			return true;
		}

		default:
			return false;
	}
}
