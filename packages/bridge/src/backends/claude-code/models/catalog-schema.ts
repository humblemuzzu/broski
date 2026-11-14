/** What `<stateDir>/catalog.json` holds, checked on read: an `initialize` answer is only trusted as far as its typed fields (`SDKControlInitializeResponse`). */

import type { SDKControlInitializeResponse } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const EffortLevel = z.enum(["low", "medium", "high", "xhigh", "max"]);

const SlashCommandRow = z.object({
	name: z.string(),
	description: z.string(),
	argumentHint: z.string(),
	aliases: z.array(z.string()).optional(),
	builtin: z.boolean().optional(),
});

const ModelRow = z.object({
	value: z.string(),
	resolvedModel: z.string().optional(),
	displayName: z.string(),
	description: z.string(),
	supportsEffort: z.boolean().optional(),
	supportedEffortLevels: z.array(EffortLevel).optional(),
	supportsAdaptiveThinking: z.boolean().optional(),
	supportsFastMode: z.boolean().optional(),
	supportsAutoMode: z.boolean().optional(),
});

const AgentRow = z.object({
	name: z.string(),
	description: z.string(),
	model: z.string().optional(),
});

const Account = z.object({
	email: z.string().optional(),
	organization: z.string().optional(),
	subscriptionType: z.string().optional(),
	tokenSource: z.string().optional(),
	apiKeySource: z.string().optional(),
	apiProvider: z
		.enum(["firstParty", "bedrock", "vertex", "foundry", "anthropicAws", "anthropicGoogleCloud", "mantle", "gateway"])
		.optional(),
});

const InitializeAnswer = z.object({
	commands: z.array(SlashCommandRow),
	agents: z.array(AgentRow),
	output_style: z.string(),
	available_output_styles: z.array(z.string()),
	models: z.array(ModelRow),
	account: Account,
	claude_code_version: z.string().optional(),
	fast_mode_state: z.enum(["off", "cooldown", "on"]).optional(),
	fast_mode_disabled_reason: z
		.enum([
			"free",
			"preference",
			"extra_usage_disabled",
			"network_error",
			"unknown",
			"not_first_party",
			"disabled_by_env",
			"model_not_allowed",
			"sdk_opt_in_required",
			"pending",
		])
		.optional(),
});

/** Only the typed fields survive a round trip, and `SDKControlInitializeResponse` accepts exactly them. */
export function parseInitializeAnswer(value: unknown): SDKControlInitializeResponse | undefined {
	const parsed = InitializeAnswer.safeParse(value);
	return parsed.success ? parsed.data : undefined;
}

export const CatalogFile = z.object({
	version: z.literal(1),
	cliPath: z.string(),
	entries: z.array(
		z.object({
			cwd: z.string(),
			at: z.number().int().nonnegative(),
			skills: z.array(z.string()).optional(),
			init: z.unknown(),
		}),
	),
});
