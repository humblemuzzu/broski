/**
 * Step 7, end to end on the real CLI: a host keeps its latest `system/init` (`HostView.latestInit`), so
 * `session_settings` offers fast mode once the session ran a turn on a model that supports it; turning it on goes
 * through `applyFlagSettings` and the CLI's next `init` says it is on. `plugins` reads the same init.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { SessionSetting } from "../../../contract";
import { expectNoOrphans } from "../spike/rig/orphans";
import { CLI_TEST_MS, type IntegrationRig, startRig } from "./rig";

expectNoOrphans();

let world: IntegrationRig | undefined;

afterEach(async () => {
	await world?.dispose();
	world = undefined;
});

describe("fast mode through the adapter", () => {
	test(
		"is offered after a turn, turns on through the CLI, and the next turn's init says so",
		async () => {
			world = await startRig();
			const { rig, world: claude } = world;
			const live = await rig.openNew();
			const fastMode = async (enabled?: boolean): Promise<SessionSetting | undefined> => {
				const answer = await rig.backend.call?.({
					backend: "claude-code",
					op: {
						kind: "session_settings",
						sessionId: live.ref.sessionId,
						...(enabled !== undefined && { change: { kind: "toggle", key: "fastMode", enabled } }),
					},
				});
				if (answer?.status !== "accepted" || answer.result.kind !== "session_settings") throw new Error("refused");
				return answer.result.settings.find((setting) => setting.key === "fastMode");
			};
			expect(await fastMode()).toBeUndefined();
			claude.router.replace(live.ref.sessionId, [{ text: ["one"] }, { text: ["two"] }]);
			await live.run("First.");
			expect(await fastMode()).toMatchObject({ kind: "toggle", enabled: false });
			expect(await fastMode(true)).toMatchObject({ enabled: true, note: "Takes effect from the next message." });
			await live.run("Second.");
			const settled = await fastMode();
			expect(settled).toMatchObject({ enabled: true });
			expect(settled).not.toHaveProperty("note");

			const plugins = await rig.backend.call?.({
				backend: "claude-code",
				op: { kind: "plugins", cwd: claude.home.projectDir, sessionId: live.ref.sessionId },
			});
			expect(plugins?.status).toBe("accepted");
			await live.close();
		},
		CLI_TEST_MS,
	);
});
