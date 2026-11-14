/**
 * The model catalogue the adapter lists (adapter README D12): `supportedModels()` and `initializationResult()` offline,
 * and whether the scripted `/v1/models` list changes them.
 */

import { describe, expect, test } from "bun:test";
import type { ModelInfo, SDKControlInitializeResponse } from "@anthropic-ai/claude-agent-sdk";
import { EXPECTED_CLAUDE_CLI_VERSION } from "../../../server/claude-code-backend";
import { expectNoOrphans } from "./rig/orphans";
import { startSpike } from "./rig/session";

expectNoOrphans();

const CLI_TEST_MS = 30_000;

async function catalog(models?: Array<{ id: string; display_name: string }>) {
	const spike = startSpike({ permissionMode: "default", turns: [], server: models ? { models } : {} });
	try {
		const init: SDKControlInitializeResponse = await spike.q.initializationResult();
		const supported: ModelInfo[] = await spike.q.supportedModels();
		await Bun.sleep(300);
		const routes = spike.server.requests().map((r) => `${r.method} ${r.path}`);
		return { init, supported, routes };
	} finally {
		await spike.close();
	}
}

describe("the model catalogue offline", () => {
	test(
		"initialize answers with no request at all; the list does not come from /v1/models",
		async () => {
			const base = await catalog();
			const custom = await catalog([{ id: "claude-custom-1", display_name: "Custom One" }]);
			expect(base.routes).toEqual([]);
			expect(custom.routes).toEqual([]);
			expect(base.supported.map((m) => m.value)).toEqual(["default", "opus", "fable", "sonnet", "haiku"]);
			for (const model of base.supported) {
				expect(model).toMatchObject({
					resolvedModel: expect.any(String),
					supportsEffort: true,
					supportsAutoMode: true,
				});
				expect(model.supportedEffortLevels).toEqual(["low", "medium", "high", "xhigh", "max"]);
			}
			expect(base.supported.filter((m) => m.supportsFastMode).map((m) => m.value)).toEqual([
				"default",
				"opus",
				"fable",
			]);
			expect(base.init).toMatchObject({
				claude_code_version: EXPECTED_CLAUDE_CLI_VERSION,
				account: { apiKeySource: "ANTHROPIC_API_KEY", apiProvider: "firstParty" },
				available_output_styles: ["default", "Proactive", "Concise", "Explanatory", "Learning"],
				fast_mode_disabled_reason: "sdk_opt_in_required",
			});
			expect(base.init.agents.map((a) => a.name)).toEqual([
				"claude",
				"Explore",
				"general-purpose",
				"Plan",
				"statusline-setup",
			]);
			expect(custom.supported).toEqual(base.supported);
			expect(base.init.models).toEqual(base.supported);
		},
		CLI_TEST_MS,
	);
});
