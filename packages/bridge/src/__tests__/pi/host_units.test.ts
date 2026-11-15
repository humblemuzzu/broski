/**
 * The parts of the live session that need no Pi: the queue mirror, the run tracker, the rejection map.
 * They run against the contract's own reducer through `LiveState`, so what they emit is what a phone sees.
 */

import { describe, expect, test } from "bun:test";
import { LiveState } from "../../backends/pi/live/live-state";
import { promptRejection } from "../../backends/pi/live/prompt-errors";
import { QueueMirror } from "../../backends/pi/live/queue-mirror";
import { RunTracker } from "../../backends/pi/live/run-tracker";
import type { AssistantMessage } from "../../backends/pi/messages";
import type { InteractionPort } from "../../backends/pi/ports";
import { ACCEPTED } from "../../backends/pi/rejections";
import { EXIT_AFTER_EOF_MS, STOP_BUDGET_MS } from "../../backends/pi/rpc/child";
import { type AgentEvent, emptySnapshot, type SinkRecord } from "../../contract";
import { useWatchdog } from "./helpers/use-watchdog";
import { HostRig, pause } from "./host_rig";

useWatchdog();

function recorded(): { live: LiveState; events: AgentEvent[] } {
	const events: AgentEvent[] = [];
	const live = new LiveState(emptySnapshot(), () => 1);
	live.attach({ emit: (record: SinkRecord) => events.push(record.event) });
	return { live, events };
}

const reply = (text: string): AssistantMessage => ({
	role: "assistant",
	content: [{ type: "text", text }],
	stopReason: "stop",
	timestamp: 1,
});

const typed = (events: readonly AgentEvent[]) => events.map((event) => event.type);

describe("QueueMirror", () => {
	const input = (text: string) => ({ text, preview: text, imageNames: [] });
	const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

	test("shows steers before follow-ups, each item with the id and request it was queued under", () => {
		const { live, events } = recorded();
		const queue = new QueueMirror(live);
		const later = queue.enqueue("queue", input("later"), id(1));
		const now = queue.enqueue("steer", input("now"), id(2));

		const last = events.at(-1);
		expect(last?.type === "queue_changed" && last.items.map((item) => item.id)).toEqual([now.id, later.id]);
		expect(live.snapshot().queue.map((item) => item.clientRequestId)).toEqual([id(2), id(1)]);
		expect(queue.size).toBe(2);
	});

	test("of equal texts Pi delivers the oldest first, so the newest stay", () => {
		const { live } = recorded();
		const queue = new QueueMirror(live);
		const first = queue.enqueue("queue", input("same"), id(1));
		const second = queue.enqueue("queue", input("same"), id(2));

		queue.reconcile({ steering: [], followUp: ["same"] });

		expect(live.snapshot().queue.map((item) => item.id)).toEqual([second.id]);
		expect(queue.takeDelivered("same")?.item.id).toBe(first.id);
		expect(queue.takeDelivered("same")).toBeUndefined();
	});

	test("emits only when something left, and keeps what Pi holds beyond what was enqueued", () => {
		const { live, events } = recorded();
		const queue = new QueueMirror(live);
		queue.enqueue("steer", input("a"), id(1));
		const before = events.length;

		queue.reconcile({ steering: ["a", "b"], followUp: [] });
		expect(events).toHaveLength(before);
		expect(queue.size).toBe(1);

		queue.reconcile({ steering: ["b"], followUp: [] });
		expect(events).toHaveLength(before + 1);
		expect(queue.size).toBe(0);
	});

	test("what left the queue is claimed by its text once, and forgotten when the run ends", () => {
		const { live } = recorded();
		const queue = new QueueMirror(live);
		queue.enqueue("steer", input("a"), id(1));
		queue.enqueue("steer", input("b"), id(2));
		queue.reconcile({ steering: [], followUp: [] });

		expect(queue.takeDelivered("b")?.item.clientRequestId).toBe(id(2));
		queue.forgetDelivering();
		expect(queue.takeDelivered("a")).toBeUndefined();
	});
});

describe("RunTracker", () => {
	function tracker(usage?: { inputTokens: number }) {
		const { live, events } = recorded();
		const released: string[] = [];
		const interactions: InteractionPort = {
			answer: () => ACCEPTED,
			withdrawRun: () => {
				throw new Error("a run that ends leaves its asks to the desk; only an abort withdraws them here");
			},
			endRun: (runId) => released.push(runId),
			expireAll: () => {},
		};
		const runs = new RunTracker({
			live,
			interactions,
			refreshUsage: () => {
				if (usage) live.emit({ type: "usage_updated", usage });
			},
		});
		return { live, events, runs, released };
	}

	test("a run starts with its trigger and cut, and ends once: closing events, asks, usage, then run_finished", () => {
		const { runs, events, released } = tracker({ inputTokens: 7 });
		const run = runs.start("prompt", "entry-1");
		expect(runs.cut()).toEqual({ leafEntryId: "entry-1" });

		const closing: AgentEvent[] = [{ type: "notice", level: "info", text: "closing" }];
		runs.settle(false, reply("done"), closing);

		expect(typed(events)).toEqual(["run_started", "notice", "usage_updated", "run_finished"]);
		expect(released).toEqual([run.runId]);
		expect(runs.current()).toBeUndefined();
		expect(runs.cut()).toBeUndefined();
		runs.settle(false, undefined, []);
		expect(events).toHaveLength(4);
	});

	test("a retry or a compaction the run left open is closed before it ends", () => {
		const { runs, events, live } = tracker();
		runs.start("system", null);
		live.emit({ type: "retry_scheduled", attempt: 1, message: "overloaded" });
		live.emit({ type: "compaction_started", trigger: "auto" });

		runs.settle(true, undefined, []);

		expect(typed(events).slice(-3)).toEqual(["retry_finished", "compaction_finished", "run_finished"]);
		expect(live.snapshot().retry).toBeUndefined();
		expect(live.snapshot().compaction).toBeUndefined();
		expect(live.snapshot().lastOutcome).toEqual({ kind: "aborted" });
	});

	test("an abort is remembered for the run it was meant for and not the next", () => {
		const { runs } = tracker();
		runs.start("prompt", null);
		runs.noteAbort();
		expect(runs.aborting).toBe(true);
		runs.settle(true, undefined, []);
		expect(runs.aborting).toBe(false);
		runs.start("prompt", null);
		expect(runs.aborting).toBe(false);
	});

	test("a wait for the settle resolves after it, and at once when no run is active", async () => {
		const { runs } = tracker();
		await runs.afterSettle();
		runs.start("prompt", null);
		let woke = false;
		void runs.afterSettle().then(() => {
			woke = true;
		});
		await pause(5);
		expect(woke).toBe(false);
		runs.settle(false, undefined, []);
		await pause(5);
		expect(woke).toBe(true);
	});
});

describe("promptRejection", () => {
	test.each([
		["Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.", "busy"],
		["Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.", "busy"],
		["No model selected.\n\nUse /login to log into a provider", "no_model"],
		["No API key found for scripted.\n\nUse /login to log into a provider via OAuth.", "auth"],
		['Authentication failed for "x". Credentials may have expired.', "auth"],
		["something else broke", "backend_error"],
	] as const)("message %#", (message, code) => {
		const result = promptRejection(message);
		expect(result.rejection.code).toBe(code);
		expect(result.rejection.message).not.toContain("/login");
	});
});

describe("shutdown", () => {
	test("an extension that never leaves session_shutdown holds the shutdown only until pi is killed", async () => {
		const t = await HostRig.create();
		t.gate("shutdownGate");
		await t.rig.rig.openNew();
		const started = Date.now();

		await t.rig.rig.backend.dispose();

		const took = Date.now() - started;
		expect(took).toBeGreaterThanOrEqual(EXIT_AFTER_EOF_MS - 200);
		expect(took).toBeLessThan(STOP_BUDGET_MS + 1_000);
		expect(t.rig.world.sessionProcesses()).toBe(0);
		await t.dispose();
	}, 20_000);
});
