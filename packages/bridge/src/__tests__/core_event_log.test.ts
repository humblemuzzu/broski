import { describe, expect, test } from "bun:test";
import { EventLog } from "../core/event-log";
import type { EncodedFrame } from "../core/frame";

function frame(seq: number, bytes = 10): EncodedFrame {
	return { text: `#${seq}`, bytes };
}

function filled(log: EventLog, count: number, bytes = 10): void {
	for (let seq = 1; seq <= count; seq++) log.push(seq, frame(seq, bytes));
}

describe("the replay log", () => {
	test("replays every event after a seq it still holds, and nothing for the newest", () => {
		const log = new EventLog({ maxEvents: 100, maxBytes: 10_000 });
		filled(log, 5);
		expect(log.after(2, 5)?.map((item) => item.text)).toEqual(["#3", "#4", "#5"]);
		expect(log.after(0, 5)).toHaveLength(5);
		expect(log.after(5, 5)).toEqual([]);
	});

	test("cannot replay from before its window, or from beyond the stream", () => {
		const log = new EventLog({ maxEvents: 3, maxBytes: 10_000 });
		filled(log, 10);
		expect(log.after(7, 10)?.map((item) => item.text)).toEqual(["#8", "#9", "#10"]);
		expect(log.after(6, 10)).toBeUndefined();
		expect(log.after(11, 10)).toBeUndefined();
		expect(new EventLog({ maxEvents: 3, maxBytes: 100 }).after(0, 0)).toEqual([]);
	});

	test("keeps to its byte bound, but always keeps the newest event", () => {
		const log = new EventLog({ maxEvents: 100, maxBytes: 25 });
		filled(log, 10);
		expect(log.after(8, 10)).toHaveLength(2);
		expect(log.after(7, 10)).toBeUndefined();
		log.push(11, frame(11, 1_000));
		expect(log.after(10, 11)?.map((item) => item.text)).toEqual(["#11"]);
		expect(log.after(9, 11)).toBeUndefined();
	});

	test("stays bounded over a long stream", () => {
		const log = new EventLog({ maxEvents: 50, maxBytes: 1_000_000 });
		filled(log, 100_000);
		expect(log.after(99_950, 100_000)).toHaveLength(50);
		expect(log.after(99_949, 100_000)).toBeUndefined();
	});
});
