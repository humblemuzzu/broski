/**
 * Step 7, end to end on the real CLI: hooks the user configured show live as activities (the host sets
 * `includeHookEvents`) and in history as activity items read from the transcript's hook attachments.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Activity, ActivityItem } from "../../../contract";
import { expectNoOrphans } from "../spike/rig/orphans";
import { CLI_TEST_MS, type IntegrationRig, startRig } from "./rig";

expectNoOrphans();

let world: IntegrationRig | undefined;

afterEach(async () => {
	await world?.dispose();
	world = undefined;
});

const HOOKS = {
	hooks: {
		PreToolUse: [{ matcher: "Read", hooks: [{ type: "command", command: "echo pre-read-ok" }] }],
		Stop: [{ hooks: [{ type: "command", command: "echo stopping >&2; exit 1" }] }],
	},
};

describe("hook activity", () => {
	test(
		"shows live with its outcome, and the same hooks come back in history",
		async () => {
			world = await startRig();
			const { rig, world: claude } = world;
			writeFileSync(join(claude.home.configDir, "settings.json"), JSON.stringify(HOOKS));
			const live = await rig.openNew();
			claude.router.replace(live.ref.sessionId, [
				{ toolCalls: [{ name: "Read", args: { file_path: "README.md" } }] },
				{ text: ["done"] },
			]);
			await live.run("Read the readme.");
			await world.driver.quiesce();
			live.assertValid();
			const shown = structuredClone(
				live.events().flatMap((event) => (event.type === "activity" ? [event.activity] : [])),
			);
			const last = (label: string): Activity | undefined => shown.filter((a) => a.label === label).at(-1);
			expect(shown.find((a) => a.label === "PreToolUse:Read")?.status).toBe("running");
			expect(last("PreToolUse:Read")).toMatchObject({
				detail: "PreToolUse",
				status: "succeeded",
				output: "pre-read-ok\n",
				durationMs: expect.any(Number),
			});
			expect(last("Stop")).toMatchObject({ status: "failed", output: "stopping\n" });

			const page = await rig.backend.readTranscript(live.ref, { limit: 50 });
			if (page.status !== "accepted") throw new Error("no transcript");
			const history = page.page.items.filter((item): item is ActivityItem => item.kind === "activity");
			expect(history.map((item) => [item.label, item.status])).toEqual([
				["Stop", "failed"],
				["PreToolUse:Read", "succeeded"],
			]);
			expect(history.every((item) => typeof item.durationMs === "number")).toBe(true);
			await live.close();
		},
		CLI_TEST_MS,
	);
});
