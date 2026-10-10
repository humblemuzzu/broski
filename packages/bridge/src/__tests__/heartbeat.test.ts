import { describe, expect, test } from "bun:test";
import { HEARTBEAT_DEAD_AFTER_MS, heartbeatAction } from "../server/heartbeat";

const now = 1_000_000;
const silent = { lastPongAt: now - HEARTBEAT_DEAD_AFTER_MS - 1 };

describe("heartbeatAction", () => {
	test("a network client that stopped answering is closed", () => {
		expect(heartbeatAction(undefined, silent, now)).toBe("close");
	});

	test("a backgrounded phone behind broski-link keeps its connection", () => {
		expect(heartbeatAction({ kind: "link", deviceId: "a".repeat(32) }, silent, now)).toBe("skip");
	});

	test("the link daemon's feed is never pinged", () => {
		expect(heartbeatAction({ kind: "link-daemon" }, silent, now)).toBe("skip");
	});

	test("one ping is in flight at a time until it goes stale", () => {
		const ctx = { lastPongAt: now, pendingPing: { sentAt: now - 10_000 } };
		expect(heartbeatAction(undefined, ctx, now)).toBe("wait");
		expect(heartbeatAction(undefined, { ...ctx, pendingPing: { sentAt: now - 31_000 } }, now)).toBe("ping");
	});

	test("a live client with no ping in flight is pinged", () => {
		expect(heartbeatAction(undefined, { lastPongAt: now }, now)).toBe("ping");
	});
});
