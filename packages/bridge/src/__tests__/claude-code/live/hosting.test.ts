/** D23 and the registry's reach: `withHost`, `withLiveHost`, `end`, and a CLI that dies under a host. */

import { describe, expect, test } from "bun:test";
import { expectNoOrphans } from "../spike/rig/orphans";
import { cliPidsOf } from "./helpers/cli-process";
import { realRig } from "./helpers/rig";
import { SLOW_TEXT } from "./helpers/turns";

expectNoOrphans();

const CLI_TEST_MS = 30_000;

describe("reaching a session's host", () => {
	test(
		"withLiveHost: the host while hosted, undefined for a session nobody hosts, not_found for an unknown one",
		async () => {
			const rig = realRig([{ text: ["done"] }]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				await live.run("hello");
				const seen = await rig.live.withLiveHost(live.ref.sessionId, async (host) => ({
					cwd: host?.cwd,
					busy: host?.busy(),
					tasks: host?.tasks(),
					hasQuery: host?.query !== undefined,
				}));
				expect(seen).toEqual({ cwd: rig.home.projectDir, busy: false, tasks: [], hasQuery: true });
				await live.close();
				await rig.live.end(live.ref.sessionId);
				expect(rig.live.isHosted(live.ref.sessionId)).toBe(false);
				expect(await rig.live.withLiveHost(live.ref.sessionId, async (host) => host)).toBeUndefined();
				expect(await rig.live.withLiveHost(crypto.randomUUID(), async () => "never")).toMatchObject({
					status: "rejected",
					rejection: { code: "not_found" },
				});
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"withHost on a session nobody hosts runs on a transient host that is closed afterwards; a terminal's session is unsupported",
		async () => {
			const rig = realRig([{ text: ["done"] }]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				await live.run("hello");
				await live.close();
				await rig.live.end(live.ref.sessionId);
				const id = live.ref.sessionId;
				expect(cliPidsOf(id)).toEqual([]);
				const init = await rig.live.withHost(id, async (host) => {
					expect(cliPidsOf(id)).toHaveLength(1);
					expect(host.busy()).toBe(false);
					return host.query.initializationResult();
				});
				expect(init).toMatchObject({ claude_code_version: expect.any(String) });
				expect(cliPidsOf(id)).toEqual([]);
				expect(rig.live.isHosted(id)).toBe(false);
				rig.writing.add(id);
				expect(await rig.live.withHost(id, async () => "never")).toMatchObject({
					status: "rejected",
					rejection: { code: "unsupported" },
				});
				rig.writing.delete(id);
				expect(await rig.live.withHost(crypto.randomUUID(), async () => "never")).toMatchObject({
					status: "rejected",
					rejection: { code: "not_found" },
				});
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"withHost on a hosted session uses its host, and a work that throws still closes a transient host",
		async () => {
			const rig = realRig([{ text: ["done"] }]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				await live.run("hello");
				const processes = cliPidsOf(live.ref.sessionId);
				const same = await rig.live.withHost(live.ref.sessionId, async (host) => cliPidsOf(host.sessionId));
				expect(same).toEqual(processes);
				await live.close();
				await rig.live.end(live.ref.sessionId);
				const thrown = await rig.live
					.withHost(live.ref.sessionId, async () => {
						throw new Error("the op failed");
					})
					.then(
						() => "returned",
						(error: unknown) => (error instanceof Error ? error.message : "other"),
					);
				expect(thrown).toBe("the op failed");
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
