/**
 * Step 7 facts for `session_settings`: the context window each listed model runs with (OQ4 kept a 1M toggle; none is
 * needed when every model already has 1,000,000), and that `applyFlagSettings({fastMode: true})` is the SDK's fast
 * mode opt-in (the 2.1.316 binary answers `sdk_opt_in_required` until the flag layer says `fastMode: true`).
 */

import { describe, expect, test } from "bun:test";
import type { SDKMessage, SDKSystemMessage } from "@anthropic-ai/claude-agent-sdk";
import { expectNoOrphans } from "./rig/orphans";
import { isIdle, type SpikeSession, startSpike } from "./rig/session";

expectNoOrphans();

const CLI_TEST_MS = 60_000;

async function turn(spike: SpikeSession, text: string): Promise<void> {
	const after = spike.messages.length;
	spike.send(text);
	await spike.waitFor((m) => m.type === "result", { after });
	await spike.waitFor(isIdle, { after });
}

function inits(messages: readonly SDKMessage[]): SDKSystemMessage[] {
	return messages.flatMap((m) => (m.type === "system" && m.subtype === "init" ? [m] : []));
}

describe("the context window and fast mode on the real CLI", () => {
	test(
		"every listed model runs with a 1,000,000 token window",
		async () => {
			const listing = startSpike({ permissionMode: "default", turns: [] });
			const values = (await listing.q.supportedModels()).map((model) => model.value);
			await listing.close();
			expect(values.length).toBeGreaterThan(0);
			for (const model of values) {
				const spike = startSpike({ permissionMode: "default", turns: [{ text: ["ok"] }], options: { model } });
				try {
					await turn(spike, "hello");
					const usage = spike.results()[0]?.modelUsage ?? {};
					const windows = Object.values(usage).map((entry) => entry.contextWindow);
					expect({ model, windows }).toEqual({ model, windows: windows.map(() => 1_000_000) });
					expect(windows.length).toBeGreaterThan(0);
				} finally {
					await spike.close();
				}
			}
		},
		CLI_TEST_MS * 3,
	);

	test(
		"the fastMode flag is the SDK's opt-in: the next init says on, and off again once it is cleared",
		async () => {
			const spike = startSpike({
				permissionMode: "default",
				turns: [{ text: ["one"] }, { text: ["two"] }, { text: ["three"] }],
			});
			try {
				await turn(spike, "first");
				expect(inits(spike.messages).at(-1)?.fast_mode_disabled_reason).toBe("sdk_opt_in_required");
				await spike.q.applyFlagSettings({ fastMode: true });
				await turn(spike, "second");
				expect(inits(spike.messages).at(-1)).toMatchObject({ fast_mode_state: "on" });
				expect(inits(spike.messages).at(-1)?.fast_mode_disabled_reason).toBeUndefined();
				await spike.q.applyFlagSettings({ fastMode: false });
				await turn(spike, "third");
				expect(inits(spike.messages).at(-1)).toMatchObject({
					fast_mode_state: "off",
					fast_mode_disabled_reason: "sdk_opt_in_required",
				});
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);
});
