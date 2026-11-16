import { describe, expect, test } from "bun:test";
import { emptySnapshot, type SessionSnapshot } from "../contract";
import { holdsOpen } from "../core/keep-open";

const ASK = { id: "i", createdAt: 1, title: "Go on?", blocksRun: false, request: { kind: "confirm" as const } };

describe("what keeps a session open", () => {
	test("each kind of work in flight holds it open on its own, and nothing else does", () => {
		const cases: Array<[string, Partial<SessionSnapshot>]> = [
			["a run", { run: { runId: "r", trigger: "prompt", startedAt: 1, items: [], droppedItems: 0 } }],
			["an ask outside a run", { interactions: [ASK] }],
			["a compaction outside a run", { compaction: { trigger: "manual", startedAt: 1 } }],
			["a retry outside a run", { retry: { attempt: 1, message: "overloaded" } }],
			["queued input", { queue: [{ id: "q", delivery: "queue", preview: "later" }] }],
			["a task in the background", { backgroundTasks: [{ id: "job-1", kind: "task", title: "tail the log" }] }],
		];
		for (const [name, work] of cases) {
			expect([name, holdsOpen({ ...emptySnapshot(), ...work })]).toEqual([name, true]);
		}
		const settled: SessionSnapshot = { ...emptySnapshot(), modelId: "m", lastOutcome: { kind: "completed" } };
		expect(holdsOpen(settled)).toBe(false);
	});
});
