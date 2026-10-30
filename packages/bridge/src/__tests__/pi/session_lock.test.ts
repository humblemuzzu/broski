import { describe, expect, test } from "bun:test";
import { SessionLocks } from "../../backends/pi/live/session-lock";

/** Whether the lock holds an entry for `sessionId`: read from its insides, which only this test needs to see. */
function heldBy(locks: SessionLocks, sessionId: string): boolean {
	const tails: Map<string, unknown> = Reflect.get(locks, "tails");
	return tails.has(sessionId);
}

describe("the session lock", () => {
	test("runs one session's work one at a time, in arrival order", async () => {
		const locks = new SessionLocks();
		const order: string[] = [];
		const gate = Promise.withResolvers<void>();
		const first = locks.run("s", async () => {
			order.push("first started");
			await gate.promise;
			order.push("first done");
			return 1;
		});
		const second = locks.run("s", async () => {
			order.push("second");
			return 2;
		});
		await Promise.resolve();
		expect(order).toEqual(["first started"]);
		gate.resolve();
		expect(await Promise.all([first, second])).toEqual([1, 2]);
		expect(order).toEqual(["first started", "first done", "second"]);
	});

	test("work that fails rejects its caller and releases the lock", async () => {
		const locks = new SessionLocks();
		const failing = locks.run("s", async () => {
			throw new Error("boom");
		});
		const after = locks.run("s", async () => "ran");
		await expect(failing).rejects.toThrow("boom");
		expect(await after).toBe("ran");
	});

	test("different sessions do not wait for each other", async () => {
		const locks = new SessionLocks();
		const gate = Promise.withResolvers<void>();
		const blocked = locks.run("a", () => gate.promise);
		expect(await locks.run("b", async () => "free")).toBe("free");
		gate.resolve();
		await blocked;
	});

	test("work queued behind finished work keeps its place until it is done", async () => {
		const locks = new SessionLocks();
		const order: string[] = [];
		const first = Promise.withResolvers<void>();
		const second = Promise.withResolvers<void>();
		const a = locks.run("s", () => first.promise);
		const b = locks.run("s", async () => {
			order.push("b started");
			await second.promise;
			order.push("b done");
		});
		first.resolve();
		await a;
		for (let turn = 0; turn < 5; turn++) await Promise.resolve();
		expect(order).toEqual(["b started"]);
		expect(heldBy(locks, "s")).toBe(true);
		const c = locks.run("s", async () => {
			order.push("c");
		});
		for (let turn = 0; turn < 5; turn++) await Promise.resolve();
		expect(order).toEqual(["b started"]);
		second.resolve();
		await Promise.all([b, c]);
		expect(order).toEqual(["b started", "b done", "c"]);
	});

	test("an idle session holds no entry", async () => {
		const locks = new SessionLocks();
		const running = locks.run("s", async () => undefined);
		expect(heldBy(locks, "s")).toBe(true);
		await running;
		await Promise.resolve();
		await Promise.resolve();
		expect(heldBy(locks, "s")).toBe(false);
	});
});
