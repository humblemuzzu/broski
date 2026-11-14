/**
 * Rules 15 to 18 on the real CLI: steering folds into the run (adapter README D9), queued input is the adapter's,
 * visible and cancellable.
 */

import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "../../../contract";
import { expectNoOrphans } from "../spike/rig/orphans";
import { realRig } from "./helpers/rig";
import { SLOW_TEXT } from "./helpers/turns";

expectNoOrphans();

const CLI_TEST_MS = 30_000;
const lastUserText = (body: unknown) => JSON.stringify((body as { messages: unknown[] }).messages.at(-1));
const queueEvents = (events: AgentEvent[]) =>
	events.flatMap((event) => (event.type === "queue_changed" ? [event.items.map((item) => item.delivery)] : []));

describe("steer on the real CLI", () => {
	test(
		"a steer mid-tool joins the run: queued as steering until the CLI folds it in, then shown as a user message",
		async () => {
			const rig = realRig([
				{ toolCalls: [{ name: "Bash", args: { command: "sleep 2", description: "wait" } }] },
				{ text: ["steered answer"] },
			]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				const first = await live.prompt("run it");
				expect(first).toMatchObject({ status: "accepted", disposition: "started" });
				await rig.mapping.waitForFrame("assistant");
				const clientRequestId = crypto.randomUUID();
				const steered = await live.prompt("actually also say hi", "steer", clientRequestId);
				expect(steered).toMatchObject({ status: "accepted", disposition: "steered" });
				const finished = await live.waitFor("run_finished");
				expect(finished.outcome).toEqual({ kind: "completed" });
				live.assertSettled();
				const events = live.events();
				expect(events.filter((event) => event.type === "run_started")).toHaveLength(1);
				expect(queueEvents(events)).toEqual([["steer"], []]);
				const message = events.find(
					(event) => event.type === "user_message" && event.clientRequestId === clientRequestId,
				);
				expect(message).toMatchObject({ text: "actually also say hi" });
				expect(events.indexOf(message as AgentEvent)).toBeGreaterThan(
					events.findIndex((event) => event.type === "queue_changed"),
				);
				expect(lastUserText(rig.server.mainRequests()[1]?.body)).toContain("actually also say hi");
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"a steer with no run starts one",
		async () => {
			const rig = realRig([{ text: ["ok"] }]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				const result = await live.prompt("go", "steer");
				expect(result).toMatchObject({ status: "accepted", disposition: "started" });
				expect((await live.waitFor("run_finished")).outcome).toEqual({ kind: "completed" });
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);
});

describe("queue on the real CLI", () => {
	test(
		"queued input shows, cancels one by one, and the rest runs after the run settles as its own run",
		async () => {
			const rig = realRig([SLOW_TEXT, { text: ["answer C"] }]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				await live.prompt("talk slowly");
				await rig.mapping.waitForFrame("stream_event");
				const b = await live.prompt("B", "queue");
				const c = await live.prompt("C", "queue");
				if (b.status !== "accepted" || c.status !== "accepted") throw new Error("not accepted");
				expect([b.disposition, c.disposition]).toEqual(["queued", "queued"]);
				const shown = live.reduced().queue;
				expect(shown.map((item) => item.preview)).toEqual(["B", "C"]);
				expect(shown.map((item) => item.id)).toEqual([b.queueItemId ?? "", c.queueItemId ?? ""]);
				expect((await live.control.cancelQueued?.(b.queueItemId ?? ""))?.status).toBe("accepted");
				expect((await live.control.cancelQueued?.(b.queueItemId ?? ""))?.status).toBe("rejected");
				expect(live.reduced().queue.map((item) => item.preview)).toEqual(["C"]);
				const first = await live.waitFor("run_finished");
				const second = await live.waitFor("run_finished", (event) => event.runId !== first.runId);
				expect([first.outcome, second.outcome]).toEqual([{ kind: "completed" }, { kind: "completed" }]);
				live.assertSettled();
				const starts = live.events().filter((event) => event.type === "run_started");
				expect(starts.map((event) => event.trigger)).toEqual(["prompt", "queue"]);
				const texts = live.events().flatMap((event) => (event.type === "user_message" ? [event.text] : []));
				expect(texts).toEqual(["talk slowly", "C"]);
				expect(rig.server.served("main")).toBe(2);
				expect(lastUserText(rig.server.mainRequests()[1]?.body)).toContain("C");
				expect(lastUserText(rig.server.mainRequests()[1]?.body)).not.toContain('"B"');
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"start while a run is active is busy, a queued item cannot be cancelled when unknown, and a rejection is not remembered",
		async () => {
			const rig = realRig([SLOW_TEXT, { text: ["done"] }]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				await live.prompt("talk slowly");
				await live.waitFor("run_started");
				const id = crypto.randomUUID();
				const busy = await live.prompt("again", "start", id);
				expect(busy).toMatchObject({ status: "rejected", rejection: { code: "busy" } });
				expect(await live.control.cancelQueued?.("nope")).toMatchObject({ status: "rejected" });
				await live.control.abort();
				await live.waitFor("run_finished");
				const mark = live.recorder.items.length;
				const retried = await live.prompt("again", "start", id);
				expect(retried).toMatchObject({ status: "accepted", disposition: "started" });
				const repeat = await live.prompt("again", "start", id);
				expect(repeat).toEqual(retried);
				await live.runAfter(mark);
				expect(
					live.events().filter((event) => event.type === "user_message" && event.clientRequestId === id),
				).toHaveLength(1);
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);
});
