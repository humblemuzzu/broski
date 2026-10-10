import { describe, expect, it } from "bun:test";
import { type MemoryPressureLevel, onMemoryPressure } from "../utils/memory-pressure";

describe("onMemoryPressure", () => {
	it("delivers the level Bun emits", () => {
		const levels: MemoryPressureLevel[] = [];
		const off = onMemoryPressure((level) => levels.push(level));
		try {
			process.emit("memoryPressure", "warning");
			process.emit("memoryPressure", "critical");
		} finally {
			off();
		}
		expect(levels).toEqual(["warning", "critical"]);
	});

	it("stops delivery after the returned unsubscribe runs", () => {
		let calls = 0;
		const off = onMemoryPressure(() => {
			calls++;
		});
		off();
		process.emit("memoryPressure", "critical");
		expect(calls).toBe(0);
	});

	it("keeps other listeners alive when one unsubscribes", () => {
		let first = 0;
		let second = 0;
		const offFirst = onMemoryPressure(() => {
			first++;
		});
		const offSecond = onMemoryPressure(() => {
			second++;
		});
		try {
			offFirst();
			process.emit("memoryPressure", "critical");
			expect(first).toBe(0);
			expect(second).toBe(1);
		} finally {
			offSecond();
		}
	});
});
