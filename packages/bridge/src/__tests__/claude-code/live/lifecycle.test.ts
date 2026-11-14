/**
 * Rules 10, 15, 16 and 24 against the real CLI: a prompt's run starts when it is dispatched, shows the prompt, and
 * ends on `session_state_changed{idle}` only (D7); the transcript cut and the catalogue row follow the run.
 */

import { describe, expect, test } from "bun:test";
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { withConfigDir } from "../spike/rig/config-env";
import { expectNoOrphans } from "../spike/rig/orphans";
import { realRig } from "./helpers/rig";

expectNoOrphans();

const CLI_TEST_MS = 30_000;

describe("a run on the real CLI", () => {
	test(
		"starts at dispatch, shows the prompt, ends completed on idle, and the row follows",
		async () => {
			const rig = realRig([{ text: ["Hello ", "there."] }]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				expect(live.initial.modes).toEqual([{ axis: "permissions", value: "default" }]);
				expect(live.initial.modelId).toBe("default");
				const { runId, outcome, clientRequestId } = await live.run("Say hello.");
				expect(outcome).toEqual({ kind: "completed" });
				live.assertSettled();
				const events = live.events();
				expect(events.map((event) => event.type)).toEqual(["run_started", "user_message", "run_finished"]);
				expect(events[0]).toMatchObject({ type: "run_started", runId, trigger: "prompt" });
				expect(events[1]).toMatchObject({
					type: "user_message",
					messageId: clientRequestId,
					clientRequestId,
					text: "Say hello.",
				});
				expect(rig.mapping.noted).toEqual([clientRequestId]);
				expect(rig.ownership.claimed).toEqual([live.ref.sessionId]);
				expect(rig.ownership.prompts.map((p) => p.uuid)).toEqual([clientRequestId]);
				expect(rig.store.announced.length).toBeGreaterThanOrEqual(2);
				expect(rig.store.rows.at(-1)).toMatchObject({ status: "idle", cut: undefined });
				expect(rig.store.rows.find((row) => row.status === "running")).toMatchObject({ cut: null });
				expect(rig.catalogue.observed.map((seen) => seen.cwd)).toEqual([rig.home.projectDir]);
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);
});

describe("the transcript cut follows the chain", () => {
	test(
		"each run's cut is the chain's newest entry when it began",
		async () => {
			const rig = realRig([
				{ text: ["One."] },
				{ toolCalls: [{ name: "Read", args: { file_path: "README.md" } }] },
				{ text: ["Two."] },
			]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				await live.run("First.");
				const mark = live.recorder.items.length;
				await live.run("Second, with a tool.");
				const chain = await withConfigDir(rig.home, () =>
					getSessionMessages(live.ref.sessionId, { dir: rig.home.projectDir }),
				);
				const cuts = rig.store.rows.filter((row) => row.status === "running").map((row) => row.cut);
				expect(cuts[0]).toBeNull();
				expect(cuts[1]).toBe(chain[1]?.uuid);
				expect(rig.live.row(live.ref.sessionId)).toMatchObject({ status: "idle" });
				expect(rig.live.row(live.ref.sessionId)?.cut).toBeUndefined();
				expect(mark).toBeGreaterThan(0);
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);
});
