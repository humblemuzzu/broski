import { describe, expect, test } from "bun:test";
import { LiveState } from "../../adapter-kit/live-state";
import { type AgentEvent, applyEvent, emptySnapshot, type SinkRecord } from "../../contract";

function recorder(): { emit(record: SinkRecord): void; records: SinkRecord[] } {
	const records: SinkRecord[] = [];
	return { emit: (record) => records.push(record), records };
}

const run: AgentEvent[] = [
	{ type: "run_started", runId: "run-1", trigger: "prompt" },
	{ type: "user_message", messageId: "a1b2c3d4:0", text: "Hi", attachments: [] },
	{ type: "block_started", blockId: "m:0", messageId: "m", kind: "text" },
	{ type: "block_delta", blockId: "m:0", text: "Hel" },
	{ type: "block_finished", blockId: "m:0", text: "Hello" },
	{ type: "run_finished", runId: "run-1", outcome: { kind: "completed" } },
];

describe("a hosted session's live state", () => {
	test("is the open snapshot with every emitted event applied, and the sink sees each one", () => {
		let clock = 100;
		const live = new LiveState(emptySnapshot(), () => clock++);
		const sink = recorder();
		const initial = live.attach(sink);
		for (const event of run) live.emit(event, { entryId: "a1b2c3d4" });
		expect(sink.records.map((record) => record.event)).toEqual(run);
		expect(sink.records[0]).toEqual({
			at: 100,
			event: { type: "run_started", runId: "run-1", trigger: "prompt" },
			native: { entryId: "a1b2c3d4" },
		});
		expect(live.snapshot()).toEqual(sink.records.reduce(applyEvent, initial));
		expect(live.snapshot().lastOutcome).toEqual({ kind: "completed" });
	});

	test("keeps applying events with no sink, and a reattached sink starts from the state then", () => {
		const live = new LiveState(emptySnapshot(), () => 1);
		const first = recorder();
		live.attach(first);
		live.emit({ type: "run_started", runId: "run-1", trigger: "prompt" });
		live.detach(first);
		expect(live.attached).toBe(false);
		live.emit({ type: "notice", level: "info", text: "nobody is watching" });
		const second = recorder();
		const resumed = live.attach(second);
		expect(resumed.run?.runId).toBe("run-1");
		live.emit({ type: "run_finished", runId: "run-1", outcome: { kind: "aborted" } });
		expect(first.records).toHaveLength(1);
		expect(second.records.map((record) => record.event.type)).toEqual(["run_finished"]);
		expect(live.snapshot()).toEqual(second.records.reduce(applyEvent, resumed));
	});

	test("detaching a sink that is no longer attached keeps the one that is", () => {
		const live = new LiveState(emptySnapshot(), () => 1);
		const old = recorder();
		const current = recorder();
		live.attach(old);
		live.attach(current);
		live.detach(old);
		live.emit({ type: "notice", level: "info", text: "still here" });
		expect(old.records).toHaveLength(0);
		expect(current.records).toHaveLength(1);
	});
});
