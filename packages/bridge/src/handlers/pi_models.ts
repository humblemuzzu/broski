import * as pi from "../connectors/pi";
import { type PiHandlerContext, parseThinkingLevel } from "./pi_message_helpers";
import { emitPiRuntimeModels } from "./pi_stream_bridge";

async function handleListModels(message: any, ctx: PiHandlerContext): Promise<void> {
	const models = await pi.listAvailableModels();
	ctx.reply({ type: "pi_models", data: models, requestId: message.requestId });
	// Use broadcast (not reply) for runtime_models so the message doesn't
	// carry the request-specific requestId, which would pollute the Flutter
	// bridge service's early-response cache with unhandled messages.
	emitPiRuntimeModels(ctx.broadcast, models);
}

async function handleSetModel(message: any, ctx: PiHandlerContext): Promise<void> {
	const provider = String(message.provider ?? "");
	const modelId = String(message.modelId ?? "");
	const model = await pi.findModel(provider, modelId);
	if (!model) {
		throw new Error(`Pi model not found: ${provider}/${modelId}`);
	}

	const instance = await pi.getOrCreateInstance(ctx.cwd);
	await instance.session.setModel(model);
	ctx.reply({ type: "pi_model_set", data: pi.mapModel(model), requestId: message.requestId });
}

async function handleSetThinkingLevel(message: any, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	instance.session.setThinkingLevel(parseThinkingLevel(message.level));
	ctx.reply({
		type: "pi_thinking_level",
		data: { level: instance.session.thinkingLevel },
		requestId: message.requestId,
	});
}

async function handleCycleThinkingLevel(message: any, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	const level = instance.session.cycleThinkingLevel();
	ctx.reply({
		type: "pi_thinking_level",
		data: { level: level ?? instance.session.thinkingLevel },
		requestId: message.requestId,
	});
}

async function handleCycleModel(message: any, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	const direction = message.direction === "backward" ? "backward" : "forward";
	const result = await instance.session.cycleModel(direction);
	ctx.reply({
		type: "pi_model_set",
		data: result?.model ? pi.mapModel(result.model) : null,
		isScoped: result?.isScoped ?? false,
		requestId: message.requestId,
	});
}

export async function handle(message: any, ctx: PiHandlerContext): Promise<boolean> {
	switch (message.type) {
		case "pi_list_models": {
			await handleListModels(message, ctx);
			return true;
		}

		case "pi_set_model": {
			await handleSetModel(message, ctx);
			return true;
		}

		case "pi_set_thinking_level": {
			await handleSetThinkingLevel(message, ctx);
			return true;
		}

		case "pi_cycle_thinking_level": {
			await handleCycleThinkingLevel(message, ctx);
			return true;
		}

		case "pi_cycle_model": {
			await handleCycleModel(message, ctx);
			return true;
		}

		default:
			return false;
	}
}
