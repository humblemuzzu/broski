/** The registry's `end`, and a CLI that dies under a host. */

import { describe, expect, test } from "bun:test";
import { expectNoOrphans } from "../spike/rig/orphans";
import { cliPidsOf } from "./helpers/cli-process";
import { realRig } from "./helpers/rig";
import { SLOW_TEXT } from "./helpers/turns";

expectNoOrphans();

const CLI_TEST_MS = 30_000;

describe("ending a session's host", () => {
	test(
		"end closes the host and its CLI; the session is no longer hosted",
		async () => {
			const rig = realRig([{ text: ["done"] }]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				await live.run("hello");
				expect(rig.live.isHosted(live.ref.sessionId)).toBe(true);
				expect(cliPidsOf(live.ref.sessionId)).toHaveLength(1);
				await live.close();
				await rig.live.end(live.ref.sessionId);
				expect(rig.live.isHosted(live.ref.sessionId)).toBe(false);
				expect(cliPidsOf(live.ref.sessionId)).toEqual([]);
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);
});

describe("a CLI that dies under a host", () => {
	test(
		"the run ends in error, queued input comes back, a notice says so, and the next prompt starts a new process",
		async () => {
			const rig = realRig([SLOW_TEXT, { text: ["back again"] }]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				await live.prompt("talk slowly");
				await rig.mapping.waitForFrame("stream_event");
				await live.prompt("queued for later", "queue");
				const [pid] = cliPidsOf(live.ref.sessionId);
				if (pid === undefined) throw new Error("no CLI process found");
				process.kill(pid, "SIGKILL");
				const finished = await live.waitFor("run_finished");
				expect(finished.outcome).toMatchObject({ kind: "error", error: { code: "backend_unavailable" } });
				const events = live.events();
				expect(events.find((event) => event.type === "notice")).toMatchObject({ level: "error" });
				expect(events.find((event) => event.type === "input_returned")).toEqual({
					type: "input_returned",
					texts: ["queued for later"],
				});
				live.assertSettled();
				expect(rig.desk.expired).toBeGreaterThan(0);

				const mark = live.recorder.items.length;
				const again = await live.prompt("are you there?");
				expect(again).toMatchObject({ status: "accepted", disposition: "started" });
				const second = await live.runAfter(mark);
				expect(second.outcome).toEqual({ kind: "completed" });
				expect(cliPidsOf(live.ref.sessionId)).toHaveLength(1);
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);
});
