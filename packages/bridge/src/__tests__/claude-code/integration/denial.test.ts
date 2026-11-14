/** Adapter README D18: a person's denial reads `denied` live and in history, with the real CLI. */

import { afterEach, describe, expect, test } from "bun:test";
import { expectNoOrphans } from "../spike/rig/orphans";
import { CLI_TEST_MS, type IntegrationRig, pending, startRig } from "./rig";

expectNoOrphans();

let world: IntegrationRig | undefined;

afterEach(async () => {
	await world?.dispose();
	world = undefined;
});

describe("a tool call a person denies", () => {
	test(
		"finishes denied in the live stream and reads denied from the transcript, with their words kept",
		async () => {
			world = await startRig();
			const { rig } = world;
			const live = await rig.openNew();
			await rig.arrange(live.ref, { kind: "interaction", interaction: "tool_permission" });
			expect((await live.prompt("Write the file.")).status).toBe("accepted");
			const ask = await pending(live);
			const reply = {
				kind: "tool_permission" as const,
				optionId: "deny_once",
				message: "Not that file.",
				grantIds: [],
			};
			expect((await live.control.answer({ interactionId: ask.id, reply })).status).toBe("accepted");
			const finished = await live.waitFor("tool_finished");
			expect(finished.outcome).toBe("denied");
			await live.waitFor("run_finished");
			live.assertSettled();
			const read = await rig.backend.readTranscript(live.ref, { limit: 200 });
			if (read.status !== "accepted") throw new Error(read.rejection.message);
			const stored = read.page.items.find((item) => item.kind === "tool_result");
			expect(stored?.kind === "tool_result" && stored.toolCallId).toBe(finished.toolCallId);
			expect(stored?.kind === "tool_result" && stored.outcome).toBe("denied");
			expect(JSON.stringify(stored)).toContain("Not that file.");
		},
		CLI_TEST_MS,
	);
});
