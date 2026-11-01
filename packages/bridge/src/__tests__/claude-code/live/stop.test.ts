/** Stop (D8, D31; rules 19 and 18's abort): `interrupt({cancelQueued: true})`, the run ends `aborted`, queued input comes back. */

import { describe, expect, test } from "bun:test";
import { expectNoOrphans } from "../spike/rig/orphans";
import { realRig } from "./helpers/rig";
import { SLOW_TEXT } from "./helpers/turns";

expectNoOrphans();

const CLI_TEST_MS = 30_000;

describe("Stop on the real CLI", () => {
	test(
		"mid-text: the run ends aborted, once, with the stream valid and the server asked once",
		async () => {
			const rig = realRig([SLOW_TEXT, { text: ["must not run"] }]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				await live.prompt("talk slowly");
				await live.waitFor("run_started");
				await rig.mapping.waitForFrame("stream_event");
				expect((await live.control.abort()).status).toBe("accepted");
				const finished = await live.waitFor("run_finished");
				expect(finished.outcome).toEqual({ kind: "aborted" });
				live.assertSettled();
				expect(live.events().filter((event) => event.type === "run_finished")).toHaveLength(1);
				expect(rig.server.served("main")).toBe(1);
				expect(rig.mapping.settled).toEqual(["aborted"]);
				expect(rig.desk.withdrawn).toEqual([finished.runId]);
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"mid-tool: aborted too, and a Stop with no run is accepted and silent",
		async () => {
			const rig = realRig([
				{ toolCalls: [{ name: "Bash", args: { command: "sleep 20", description: "wait" } }] },
				{ text: ["after"] },
			]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				const before = live.recorder.items.length;
				expect((await live.control.abort()).status).toBe("accepted");
				expect(live.recorder.items.length).toBe(before);
				await live.prompt("run it");
				await rig.mapping.waitForFrame("assistant");
				await Bun.sleep(400);
				const started = Date.now();
				expect((await live.control.abort()).status).toBe("accepted");
				const finished = await live.waitFor("run_finished");
				expect(finished.outcome).toEqual({ kind: "aborted" });
				expect(Date.now() - started).toBeLessThan(10_000);
				live.assertSettled();
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"queued and steered input comes back in input_returned, steering first, and nothing is sent",
		async () => {
			const rig = realRig([SLOW_TEXT, { text: ["must not run"] }]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				await live.prompt("talk slowly");
				await rig.mapping.waitForFrame("stream_event");
				const queued = await live.prompt("queued after", "queue");
				const steered = await live.prompt("steered in", "steer");
				expect(queued).toMatchObject({ status: "accepted", disposition: "queued" });
				expect(steered).toMatchObject({ status: "accepted", disposition: "steered" });
				await live.control.abort();
				const finished = await live.waitFor("run_finished");
				expect(finished.outcome).toEqual({ kind: "aborted" });
				const returned = live.events().find((event) => event.type === "input_returned");
				expect(returned).toEqual({ type: "input_returned", texts: ["steered in", "queued after"] });
				expect(live.reduced().queue).toEqual([]);
				await Bun.sleep(500);
				expect(rig.server.served("main")).toBe(1);
				live.assertSettled();
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"a Stop right after the prompt, before the CLI began it, still ends the run",
		async () => {
			const rig = realRig([{ text: ["never shown"] }]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				await live.prompt("hurry");
				await live.control.abort();
				const finished = await live.waitFor("run_finished");
				expect(finished.outcome.kind).toBe("aborted");
				await Bun.sleep(700);
				live.assertSettled();
				const runs = live.events().filter((event) => event.type === "run_started");
				expect(runs).toHaveLength(1);
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	for (const wait of [0, 40, 120]) {
		test(
			`a Stop ${wait} ms after a request began to be held ends the turn, and the next prompt runs`,
			async () => {
				let release: () => void = () => undefined;
				const held = new Promise<void>((resolve) => {
					release = resolve;
				});
				const rig = realRig([{ text: ["held"], gate: held }, { text: ["second"] }]);
				try {
					const live = await rig.openNew(rig.home.projectDir);
					await live.prompt("hold it");
					await live.waitFor("run_started");
					if (wait > 0) await Bun.sleep(wait);
					await live.control.abort();
					const finished = await live.waitFor("run_finished");
					expect(finished.outcome).toEqual({ kind: "aborted" });
					release();
					await Bun.sleep(400);
					const mark = live.recorder.items.length;
					const next = await live.prompt("and now?");
					expect(next).toMatchObject({ status: "accepted", disposition: "started" });
					const second = await live.runAfter(mark);
					expect(second.outcome).toEqual({ kind: "completed" });
					expect(rig.server.mainRequests().length).toBeGreaterThanOrEqual(1);
					live.assertSettled();
				} finally {
					await rig.dispose();
				}
			},
			CLI_TEST_MS,
		);
	}
});
