import { describe, expect, it } from "bun:test";
import { enrichRuntimeEvent, RUNTIME_STREAM_STATE_MAX_KEYS, resetRuntimeStreamState } from "../runtime/stream-contract";
import { BoundedMap } from "../state/bounded-map";
import type { BroskiRuntimeEvent } from "../types/runtime";

function makeMap(options: { maxEntries: number; ttlMs?: number; touchOnGet?: boolean }) {
	let clock = 1_000_000;
	const map = new BoundedMap<string, number>({
		maxEntries: options.maxEntries,
		ttlMs: options.ttlMs,
		touchOnGet: options.touchOnGet,
		now: () => clock,
	});
	return { map, advance: (ms: number) => (clock += ms) };
}

describe("BoundedMap.has", () => {
	it("refreshes the ttl the same way get does", () => {
		const { map, advance } = makeMap({ maxEntries: 4, ttlMs: 1000 });
		map.set("a", 1);

		advance(900);
		expect(map.has("a")).toBe(true);

		advance(900);
		expect(map.get("a")).toBe(1);
	});

	it("moves the entry to the most recent end when touchOnGet is on", () => {
		const { map } = makeMap({ maxEntries: 4, touchOnGet: true });
		map.set("a", 1);
		map.set("b", 2);

		expect(map.has("a")).toBe(true);
		expect([...map.keys()]).toEqual(["b", "a"]);
	});

	it("leaves the order alone when touchOnGet is off", () => {
		const { map } = makeMap({ maxEntries: 4, touchOnGet: false });
		map.set("a", 1);
		map.set("b", 2);

		expect(map.has("a")).toBe(true);
		expect([...map.keys()]).toEqual(["a", "b"]);
	});
});

describe("runtime stream state under capacity pressure", () => {
	const event = (sessionId: string) => {
		const input: BroskiRuntimeEvent = {
			type: "assistant_text_delta",
			backend: "pi",
			timestampMs: 1,
			sessionId,
			delta: "x",
		};
		return enrichRuntimeEvent(input, { backend: "pi", sessionId });
	};

	it("never capacity-evicts the state of a live stream", () => {
		const hot = "evict-check-hot";
		const idle = Array.from({ length: RUNTIME_STREAM_STATE_MAX_KEYS }, (_, index) => `evict-check-idle-${index}`);

		try {
			event(hot);
			for (const sessionId of idle) {
				event(hot);
				event(sessionId);
			}

			expect(event(hot).seq).toBe(RUNTIME_STREAM_STATE_MAX_KEYS + 2);
		} finally {
			resetRuntimeStreamState("pi", hot);
			for (const sessionId of idle) resetRuntimeStreamState("pi", sessionId);
		}
	});
});
