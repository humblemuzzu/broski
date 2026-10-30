/**
 * On the real adapter: compaction by hand and by Pi's own threshold, the
 * transcript across it, and the usage a run reports (including after a compaction, when Pi cannot
 * say how full the context is).
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { AgentEvent, SessionRef } from "../../contract";
import { FAUX_MODEL_IDS, wireIdOf } from "./helpers/faux-models";
import { LiveRig } from "./helpers/live-rig";
import { answerTexts, countOf, holdingRun, userItems } from "./helpers/live-steps";
import { allItems } from "./helpers/paging";
import { say } from "./helpers/scenarios";
import { sessionEntries } from "./helpers/session-files";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

const typesOf = (events: readonly AgentEvent[], wanted: readonly AgentEvent["type"][]) =>
	events.map((event) => event.type).filter((type) => wanted.includes(type));

describe("compaction by hand", () => {
	test("is one compaction that completes, leaves the summary in the session, and the transcript pages across it", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		await t.rig.arrange(live.ref, { kind: "reply" });
		await live.run("Something to compact.");
		const before = await allItems(t.backend, live.ref, 200);

		const mark = live.recorder.items.length;
		expect((await live.control.compact?.(undefined))?.status).toBe("accepted");
		const started = await live.waitFor("compaction_started", () => true, mark);
		const finished = await live.waitFor("compaction_finished", () => true, mark);
		expect(started.trigger).toBe("manual");
		expect(finished.outcome.kind).toBe("completed");
		expect(finished.outcome.kind === "completed" && typeof finished.outcome.tokensBefore).toBe("number");
		expect(live.reduced().compaction).toBeUndefined();
		live.assertSettled();
		expect(sessionEntries(t.fileOf(live.ref)).filter((entry) => entry.type === "compaction")).toHaveLength(1);

		const whole = await allItems(t.backend, live.ref, 200);
		const paged = await allItems(t.backend, live.ref, 1);
		expect(paged.map((item) => item.id)).toEqual(whole.map((item) => item.id));
		expect(new Set(paged.map((item) => item.id)).size).toBe(paged.length);
		expect(whole[0]?.kind).toBe("compaction");
		const wasThere = before.map((item) => item.id);
		expect(whole.map((item) => item.id)).toEqual(expect.arrayContaining(wasThere));
		expect(userItems(whole).map((item) => item.text)).toEqual(["Something to compact."]);
	});

	test("asked for while idle, is a run of the phone's: started, compacted, usage pulled, finished", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		await t.rig.arrange(live.ref, { kind: "reply" });
		await live.run("Something to compact.");
		const mark = live.recorder.items.length;

		expect((await live.control.compact?.(undefined))?.status).toBe("accepted");
		const started = await live.waitFor("run_started", () => true, mark);
		const finished = await live.waitFor("run_finished", () => true, mark);

		expect(started.trigger).toBe("prompt");
		expect(finished).toMatchObject({ runId: started.runId, outcome: { kind: "completed" } });
		const order = live.recorder.items.slice(mark).map((record) => record.event.type);
		expect(order.filter((type) => type !== "usage_updated")).toEqual([
			"run_started",
			"compaction_started",
			"compaction_finished",
			"run_finished",
		]);
		expect(order.indexOf("usage_updated")).toBeGreaterThan(order.indexOf("compaction_finished"));
		expect(order.indexOf("usage_updated")).toBeLessThan(order.indexOf("run_finished"));
		live.assertSettled();
		await t.rig.arrange(live.ref, { kind: "reply" });
		expect((await live.run("after it")).outcome.kind).toBe("completed");
	});

	test("is refused while a run is going, and the run is not disturbed", async () => {
		t = await LiveRig.create();
		const live = await holdingRun(t);
		const refused = await live.control.compact?.(undefined);
		expect(refused).toMatchObject({ status: "rejected", rejection: { code: "busy" } });
		expect(live.events().some((event) => event.type === "compaction_started")).toBe(false);
		t.bus.release(live.ref.sessionId);
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
	});
});

describe("compaction by Pi's threshold", () => {
	test("happens inside the run that passed it: one run, started and finished before it ends", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew({ modelId: wireIdOf(FAUX_MODEL_IDS.tiny) });
		t.router.script(live.ref.sessionId, [say("x".repeat(16_000))]);
		const { outcome } = await live.run("fill the window");
		expect(outcome.kind).toBe("completed");
		const order = typesOf(live.events(), ["run_started", "compaction_started", "compaction_finished", "run_finished"]);
		expect(order).toEqual(["run_started", "compaction_started", "compaction_finished", "run_finished"]);
		const started = live.events().find((event) => event.type === "compaction_started");
		expect(started).toMatchObject({ trigger: "auto" });
		expect(live.events().find((event) => event.type === "compaction_finished")).toMatchObject({
			outcome: { kind: "completed" },
		});
		expect(countOf(live, "run_started")).toBe(1);
		live.assertSettled();
	});

	test("leaves the context fill unknown, and the run's usage says so by leaving it out", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew({ modelId: wireIdOf(FAUX_MODEL_IDS.tiny) });
		t.router.script(live.ref.sessionId, [say("x".repeat(16_000))]);
		await live.run("fill the window");
		const usage = live.events().findLast((event) => event.type === "usage_updated");
		expect(usage?.type === "usage_updated" && usage.usage.inputTokens).toBeGreaterThan(0);
		expect(usage?.type === "usage_updated" && usage.usage.contextTokens).toBeUndefined();
		expect(usage?.type === "usage_updated" && usage.usage.contextWindow).toBeUndefined();
		expect(answerTexts(await allItems(t.backend, live.ref, 200))).toContain("x".repeat(16_000));
	});
});

describe("usage after a run", () => {
	function fileTotals(rig: LiveRig, ref: SessionRef) {
		const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
		for (const entry of sessionEntries(rig.fileOf(ref))) {
			if (entry.type !== "message" || entry.message.role !== "assistant") continue;
			totals.input += entry.message.usage.input;
			totals.output += entry.message.usage.output;
			totals.cacheRead += entry.message.usage.cacheRead;
			totals.cacheWrite += entry.message.usage.cacheWrite;
		}
		return totals;
	}

	test("is the session's totals as Pi counted them, copied not recomputed, and grows with the next run", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const reported = () => {
			const event = live.events().findLast((candidate) => candidate.type === "usage_updated");
			if (event?.type !== "usage_updated") throw new Error("no usage was reported");
			return event.usage;
		};
		await t.rig.arrange(live.ref, { kind: "reply" });
		await live.run("First.");
		const one = reported();
		const totals = fileTotals(t, live.ref);
		expect(one).toMatchObject({
			inputTokens: totals.input,
			outputTokens: totals.output,
			cacheWriteTokens: totals.cacheWrite,
		});
		expect(one.cacheReadTokens ?? 0).toBe(totals.cacheRead);
		expect(one.inputTokens).toBeGreaterThan(0);
		expect(one.contextWindow).toBe(128_000);
		expect(one.contextTokens).toBeGreaterThan(0);
		expect(live.session.snapshot().usage).toEqual(one);

		await t.rig.arrange(live.ref, { kind: "reply" });
		await live.run("Second.");
		const two = reported();
		const after = fileTotals(t, live.ref);
		expect(two).toMatchObject({ inputTokens: after.input, outputTokens: after.output });
		expect((two.outputTokens ?? 0) > (one.outputTokens ?? 0)).toBe(true);
	});
});

describe("usage outside a run's end", () => {
	test("a session opened again shows its usage in the snapshot, before any run", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		await t.rig.arrange(live.ref, { kind: "reply" });
		await live.run("count me");
		const counted = live.reduced().usage;
		await live.close();
		await t.bus.shutDown(live.ref.sessionId);

		const reopened = await t.rig.open(live.ref);
		expect(reopened.initial.usage).toEqual(counted);
		expect(reopened.initial.usage?.outputTokens).toBeGreaterThan(0);
	});

	test("each assistant message's totals arrive while the run goes on, before it ends", async () => {
		t = await LiveRig.create();
		const live = await holdingRun(t);
		const during = await live.waitFor("usage_updated");
		expect(during.usage.outputTokens).toBeGreaterThan(0);
		expect(countOf(live, "run_finished")).toBe(0);
		await live.control.abort();
		await live.waitFor("run_finished");
	});
});
