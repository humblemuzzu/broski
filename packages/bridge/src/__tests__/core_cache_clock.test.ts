import { describe, expect, test } from "bun:test";
import type { CacheWindow, SessionRef, Usage } from "../contract";
import { type CoreRig, promptInput, quiesce, RIG_CWD, startCoreRig, type TestClient } from "./helpers/core-rig";

const MINUTE = 60 * 1000;

/** Runs one turn of `session` that reports `usage`, `minutes` after the previous one. */
async function turn(rig: CoreRig, phone: TestClient, session: SessionRef, usage: Usage, minutes = 1): Promise<void> {
	rig.clock.advance(minutes * MINUTE);
	rig.fake.fake.script(session, [{ kind: "usage", usage }]);
	await phone.ok("prompt", { session, input: promptInput("Next") });
	await quiesce();
}

function windows(phone: TestClient, session: SessionRef): Array<CacheWindow | undefined> {
	return phone.events(session).flatMap((event) => (event.type === "usage_updated" ? [event.usage.cache] : []));
}

async function viewed(): Promise<{ rig: CoreRig; phone: TestClient; session: SessionRef }> {
	const rig = await startCoreRig();
	const phone = await rig.client("phone");
	const session = rig.fake.fake.seed({ cwd: RIG_CWD });
	await phone.ok("session.attach", { session });
	return { rig, phone, session };
}

describe("the cache clock", () => {
	test("a backend that reports only totals gets each request's window, stamped when its totals moved", async () => {
		const { rig, phone, session } = await viewed();
		await turn(rig, phone, session, { inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 1_000 });
		const first = rig.clock.now();
		await turn(rig, phone, session, { inputTokens: 150, cacheReadTokens: 1_000, cacheWriteTokens: 1_200 });
		const second = rig.clock.now();
		await turn(rig, phone, session, { inputTokens: 150, cacheReadTokens: 1_000, cacheWriteTokens: 1_200, costUsd: 1 });
		expect(windows(phone, session)).toEqual([
			{ lastTouchAt: first, cachedTokens: 0, promptTokens: 1_100 },
			{ lastTouchAt: second, cachedTokens: 1_000, promptTokens: 1_250 },
			{ lastTouchAt: second, cachedTokens: 1_000, promptTokens: 1_250 },
		]);
		await phone.ok("session.attach", { session });
		expect(phone.events(session).some((event) => event.type === "resynced")).toBe(false);
		expect(rig.log.errors).toEqual([]);
	});

	test("a window the backend gives keeps its lifetime, gets a stamp and the request's tokens when it lacks them", async () => {
		const { rig, phone, session } = await viewed();
		await turn(rig, phone, session, { inputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 });
		const given: CacheWindow = { lastTouchAt: 0, ttlMs: 300_000, confidence: "exact" };
		await turn(rig, phone, session, { inputTokens: 30, cacheReadTokens: 500, cacheWriteTokens: 0, cache: given });
		const exact: CacheWindow = {
			lastTouchAt: 5,
			ttlMs: 3_600_000,
			confidence: "exact",
			cachedTokens: 1,
			promptTokens: 2,
		};
		await turn(rig, phone, session, { inputTokens: 40, cacheReadTokens: 900, cacheWriteTokens: 0, cache: exact });
		expect(windows(phone, session)).toEqual([
			undefined,
			{
				lastTouchAt: rig.clock.now() - MINUTE,
				ttlMs: 300_000,
				confidence: "exact",
				cachedTokens: 500,
				promptTokens: 520,
			},
			exact,
		]);
	});

	test("a backend that reports no cache totals gets no window", async () => {
		const { rig, phone, session } = await viewed();
		await turn(rig, phone, session, { inputTokens: 10, outputTokens: 5 });
		expect(windows(phone, session)).toEqual([undefined]);
	});

	test("the window outlives the session's close, so a phone that comes back sees it warm", async () => {
		const { rig, phone, session } = await viewed();
		await turn(rig, phone, session, { inputTokens: 100, cacheReadTokens: 4_000, cacheWriteTokens: 0 });
		const [warm] = windows(phone, session);
		await phone.ok("session.detach", { session });
		rig.clock.advance(5 * MINUTE);
		expect(rig.opens.closed).toEqual([session.sessionId]);
		const back = await phone.ok("session.attach", { session });
		if (back.sync.kind !== "snapshot") throw new Error("a reopened session gives a snapshot");
		expect(back.sync.snapshot.usage?.cache).toEqual(warm);
		await phone.ok("session.attach", { session });
		expect(phone.events(session).some((event) => event.type === "resynced")).toBe(false);
	});
});
