/**
 * Rules 24 to 26 on the real CLI: a snapshot is the open one plus the events, and `close()` detaches without aborting
 * (adapter README D1).
 */

import { describe, expect, test } from "bun:test";
import { expectNoOrphans } from "../spike/rig/orphans";
import { realRig } from "./helpers/rig";
import { SLOW_TEXT } from "./helpers/turns";

expectNoOrphans();

const CLI_TEST_MS = 30_000;

describe("closing and reopening a session", () => {
	test(
		"a snapshot taken mid-run equals the events applied, and a reopen gives the same state",
		async () => {
			const rig = realRig([SLOW_TEXT]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				const sent = crypto.randomUUID();
				await live.prompt("talk slowly", "start", sent);
				await rig.mapping.waitForFrame("stream_event");
				expect(JSON.stringify(live.session.snapshot())).toBe(JSON.stringify(live.reduced()));
				expect(
					live.reduced().run?.items.some((item) => item.kind === "user_message" && item.clientRequestId === sent),
				).toBe(true);
				const started = await live.waitFor("run_started");
				await live.close();
				const reopened = await rig.openExisting(live.ref);
				expect(JSON.stringify(reopened.initial)).toBe(JSON.stringify(live.reduced()));
				expect(reopened.initial.run?.runId).toBe(started.runId);
				expect((await reopened.control.abort()).status).toBe("accepted");
				const finished = await reopened.waitFor("run_finished");
				expect(finished.outcome).toEqual({ kind: "aborted" });
				reopened.assertSettled();
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"close is idempotent, silent afterwards, rejects every control call as closed, and aborts nothing",
		async () => {
			const rig = realRig([{ text: ["a slow answer"], delayMs: 300 }]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				await live.prompt("go");
				await live.waitFor("run_started");
				await live.close();
				await live.close();
				const control = live.control;
				const closed = { status: "rejected", rejection: { code: "closed" } };
				expect(
					await control.prompt({
						clientRequestId: crypto.randomUUID(),
						mode: "start",
						text: "x",
						attachments: [],
					}),
				).toMatchObject(closed);
				expect(await control.abort()).toMatchObject(closed);
				expect(await control.setModel("opus")).toMatchObject(closed);
				expect(await control.setThinking("low")).toMatchObject(closed);
				expect(await control.setMode("permissions", "plan")).toMatchObject(closed);
				expect(await control.compact?.(undefined)).toMatchObject(closed);
				expect(await control.cancelQueued?.("x")).toMatchObject(closed);
				const reopened = await rig.openExisting(live.ref);
				const finished = await reopened.waitFor("run_finished");
				expect(finished.outcome).toEqual({ kind: "completed" });
				expect(live.recorder.recordsAfterClose()).toBe(0);
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);
});

describe("the idle grace", () => {
	test(
		"the grace starts when the last view closes and a view that attaches cancels it",
		async () => {
			const rig = realRig([]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				await live.close();
				expect(rig.clock.pending).toBe(1);
				const again = await rig.openExisting(live.ref);
				expect(rig.clock.pending).toBe(0);
				await again.close();
				expect(rig.clock.pending).toBe(1);
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"an idle, detached host ends after the grace, and the session resumes in a new host with its history",
		async () => {
			const rig = realRig([{ text: ["first answer"] }, { text: ["second answer"] }]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				await live.run("remember PLUMBUS");
				expect(rig.clock.pending).toBe(0);
				await live.close();
				expect(rig.clock.pending).toBe(1);
				rig.clock.advance(29_999);
				expect(rig.live.isHosted(live.ref.sessionId)).toBe(true);
				rig.clock.advance(1);
				await Bun.sleep(300);
				expect(rig.live.isHosted(live.ref.sessionId)).toBe(false);
				expect(rig.live.row(live.ref.sessionId)).toBeUndefined();
				expect(rig.desk.expired).toBeGreaterThan(0);

				const again = await rig.openExisting(live.ref);
				await again.run("what did I say?");
				const history = JSON.stringify(rig.server.mainRequests()[1]?.body);
				expect(history).toContain("remember PLUMBUS");
				expect(history).toContain("first answer");
				expect(again.initial.modes).toEqual([{ axis: "permissions", value: "default" }]);
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"an attached host, a host with a run, and a host with queued input never end; the grace starts when they settle",
		async () => {
			const rig = realRig([SLOW_TEXT, { text: ["queued answer"] }]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				expect(rig.clock.pending).toBe(0);
				await live.prompt("talk slowly");
				await live.waitFor("run_started");
				await live.prompt("then this", "queue");
				await live.close();
				expect(rig.clock.pending).toBe(0);
				rig.clock.advance(120_000);
				expect(rig.live.isHosted(live.ref.sessionId)).toBe(true);
				const reopened = await rig.openExisting(live.ref);
				const first = await reopened.waitFor("run_finished");
				await reopened.waitFor("run_finished", (event) => event.runId !== first.runId);
				await reopened.close();
				expect(rig.clock.pending).toBe(1);
				rig.clock.advance(30_000);
				await Bun.sleep(300);
				expect(rig.live.isHosted(live.ref.sessionId)).toBe(false);
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"opening a session that does not exist is not_found, and dispose ends every host and silences the sink",
		async () => {
			const rig = realRig([SLOW_TEXT]);
			try {
				const missing = await rig.live.open(
					{ kind: "existing", session: { backend: "claude-code", sessionId: crypto.randomUUID() } },
					{ emit: () => undefined },
				);
				expect(missing).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
				const live = await rig.openNew(rig.home.projectDir);
				await live.prompt("talk slowly");
				await rig.mapping.waitForFrame("stream_event");
				await rig.live.dispose();
				const after = live.recorder.items.length;
				await Bun.sleep(500);
				expect(live.recorder.items.length).toBe(after);
				expect(rig.live.isHosted(live.ref.sessionId)).toBe(false);
				expect(
					await rig.live.open({ kind: "new", options: { cwd: rig.home.projectDir } }, { emit: () => undefined }),
				).toMatchObject({
					status: "rejected",
					rejection: { code: "closed" },
				});
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);
});
