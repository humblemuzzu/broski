/** Rule 22 on the real CLI: `compact` is a `/compact` prompt, a run of its own that shows no user message. */

import { describe, expect, test } from "bun:test";
import { expectNoOrphans } from "../spike/rig/orphans";
import { realRig } from "./helpers/rig";
import type { StandInMapping } from "./helpers/stand-ins";
import { SLOW_TEXT } from "./helpers/turns";

expectNoOrphans();

const CLI_TEST_MS = 30_000;
const SUMMARY = { text: ["<analysis>a</analysis>\n<summary>A scripted summary.</summary>"] };

const SLOW_SUMMARY = {
	text: ["<analysis>", ...Array.from({ length: 20 }, (_, i) => `step${i} `), "</analysis>\n<summary>Slow.</summary>"],
	delayMs: 200,
};

/** What lane B maps from the compaction frames, as far as the host's rules need it: a start, and a finish. */
function showCompaction(mapping: StandInMapping): void {
	mapping.script((frame) => {
		if (frame.type !== "system") return [];
		if (frame.subtype === "status" && frame.status === "compacting") {
			return [{ event: { type: "compaction_started", trigger: "manual" } }];
		}
		if (frame.subtype === "status" && frame.compact_result === "failed") {
			return [
				{ event: { type: "compaction_finished", outcome: { kind: "failed", message: frame.compact_error ?? "" } } },
			];
		}
		if (frame.subtype === "compact_boundary") {
			return [{ event: { type: "compaction_finished", outcome: { kind: "completed" } } }];
		}
		return [];
	});
}

describe("compaction on the real CLI", () => {
	test(
		"an idle session compacts: a prompt run, no user message, the mapper's compaction events inside it",
		async () => {
			const rig = realRig([{ text: ["first answer"] }], { server: { sideRequests: { compact: [SUMMARY] } } });
			showCompaction(rig.mapping);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				await live.run("hello");
				const mark = live.recorder.items.length;
				const accepted = await live.control.compact?.(undefined);
				expect(accepted?.status).toBe("accepted");
				await live.waitFor("compaction_finished", () => true, mark);
				const finished = await live.waitFor("run_finished", () => true, mark);
				expect(finished.outcome).toEqual({ kind: "completed" });
				const events = live
					.events()
					.slice(mark)
					.map((event) => event.type);
				expect(events).toEqual(["run_started", "compaction_started", "compaction_finished", "run_finished"]);
				live.assertSettled();
				expect([rig.server.served("main"), rig.server.served("compact")]).toEqual([1, 1]);
				expect(rig.mapping.noted).toHaveLength(2);
				expect(live.events().find((event) => event.type === "run_started" && event.trigger === "prompt")).toBeDefined();
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"a session with a run under way answers busy",
		async () => {
			const rig = realRig([SLOW_TEXT]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				await live.prompt("talk slowly");
				await live.waitFor("run_started");
				expect(await live.control.compact?.("be brief")).toMatchObject({
					status: "rejected",
					rejection: { code: "busy" },
				});
				await live.control.abort();
				await live.waitFor("run_finished");
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	for (const kind of ["slow", "held"] as const) {
		test(
			`cancelCompaction ends a ${kind} compaction under way as aborted, with its run, and the session goes on`,
			async () => {
				const summary = kind === "slow" ? SLOW_SUMMARY : { ...SUMMARY, gate: new Promise<void>(() => undefined) };
				const rig = realRig([{ text: ["first answer"] }, { text: ["after"] }], {
					server: { sideRequests: { compact: [summary] } },
				});
				showCompaction(rig.mapping);
				try {
					const live = await rig.openNew(rig.home.projectDir);
					const cancel = live.control.cancelCompaction;
					if (!cancel) throw new Error("the session cannot cancel a compaction");
					await live.run("hello");
					const quiet = live.recorder.items.length;
					expect((await cancel()).status).toBe("accepted");
					expect(live.recorder.items.length).toBe(quiet);
					await live.control.compact?.(undefined);
					const mark = live.recorder.items.length;
					await live.waitFor("compaction_started", () => true, mark - 1);
					expect((await cancel()).status).toBe("accepted");
					const finished = await live.waitFor("compaction_finished", () => true, mark - 1);
					expect(finished.outcome).toEqual({ kind: "aborted" });
					const ended = await live.waitFor("run_finished", () => true, mark - 1);
					expect(ended.outcome).toEqual({ kind: "aborted" });
					live.assertSettled();
					expect((await live.run("again")).outcome).toEqual({ kind: "completed" });
				} finally {
					await rig.dispose();
				}
			},
			CLI_TEST_MS,
		);
	}

	test(
		"a compaction inside a regular run cannot be ended alone",
		async () => {
			const rig = realRig([SLOW_TEXT]);
			rig.mapping.script((frame) =>
				frame.type === "system" && frame.subtype === "init"
					? [{ event: { type: "compaction_started", trigger: "auto" } }]
					: [],
			);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				await live.prompt("talk slowly");
				await live.waitFor("compaction_started");
				expect(await live.control.cancelCompaction?.()).toMatchObject({
					status: "rejected",
					rejection: { code: "unsupported" },
				});
				await live.control.abort();
				const finished = await live.waitFor("run_finished");
				expect(finished.outcome).toEqual({ kind: "aborted" });
				expect(live.reduced().compaction).toBeUndefined();
				live.assertSettled();
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);
});
