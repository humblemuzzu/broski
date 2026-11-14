/**
 * What the core does for phones whose link is not perfect, end to end over the broski-link socket:
 * a reconnect, a phone that stops reading, a bridge restart, the idle close, and a live state
 * larger than one link message.
 */

import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { EventEnvelope, SessionRef } from "../contract";
import { DEFAULT_IDLE_CLOSE_MS } from "../core/keep-open";
import { LINK_OVERFLOW_CLOSE_CODE } from "../transport/send-limits";
import { E2E_TEST_TIMEOUT_MS, setupTestEnv } from "./e2e/harness";
import { removeRoot, startCoreBridge } from "./helpers/core-bridge";
import { promptInput, quiesce } from "./helpers/core-rig";
import type { LinkContractClient } from "./helpers/link-contract-client";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const env = setupTestEnv();
const roots: string[] = [];

afterAll(() => {
	for (const root of roots) removeRoot(root);
	env.restore();
});

/** Runs the bridge with `name` set in its environment, as an operator would. */
async function withEnv<T>(name: string, value: string, run: () => Promise<T>): Promise<T> {
	const previous = process.env[name];
	process.env[name] = value;
	try {
		return await run();
	} finally {
		if (previous === undefined) delete process.env[name];
		else process.env[name] = previous;
	}
}

function finishedRuns(phone: LinkContractClient, session: SessionRef): number {
	return phone.envelopes(session).filter((envelope) => envelope.event.type === "run_finished").length;
}

function runsFinished(phone: LinkContractClient, session: SessionRef, count: number): Promise<EventEnvelope> {
	return phone.waitForEvent(session, () => finishedRuns(phone, session) >= count, `${count} finished runs`);
}

function lastSeq(phone: LinkContractClient, session: SessionRef): number {
	return phone.envelopes(session).at(-1)?.seq ?? 0;
}

describe("the core over an imperfect link", () => {
	test("a phone that reconnects gets what it missed replayed, or a snapshot when its epoch is stale", async () => {
		const rig = await startCoreBridge();
		roots.push(rig.root);
		try {
			const a = await rig.phone("a");
			const b = await rig.phone("b");
			const session = rig.fake.fake.seed({ cwd: rig.cwd });
			const attached = await a.ok("session.attach", { session });
			await b.ok("session.attach", { session });
			await a.ok("prompt", { session, input: promptInput("One") });
			await runsFinished(a, session, 1);
			const seen = lastSeq(a, session);
			a.socket.close();
			await b.ok("prompt", { session, input: promptInput("Two") });
			await runsFinished(b, session, 2);
			const back = await rig.phone("a-again");
			const resumed = await back.ok("session.attach", { session, resume: { epoch: attached.sync.epoch, seq: seen } });
			expect(resumed.sync).toEqual({ kind: "replay", epoch: attached.sync.epoch, afterSeq: seen });
			await back.waitForEvent(session, (envelope) => envelope.seq === lastSeq(b, session), "the replay");
			expect(back.envelopes(session)).toEqual(b.envelopes(session).filter((envelope) => envelope.seq > seen));
			const stale = await back.ok("session.attach", { session, resume: { epoch: "from-an-old-bridge", seq: seen } });
			expect(stale.sync).toMatchObject({ kind: "snapshot", epoch: attached.sync.epoch, lastSeq: lastSeq(b, session) });
		} finally {
			await rig.stop();
		}
	});

	test("a phone that stops reading never holds up another, and gets everything in order once it reads again", async () => {
		const rig = await startCoreBridge();
		roots.push(rig.root);
		try {
			const slow = await rig.phone("slow");
			const fast = await rig.phone("fast");
			const session = rig.fake.fake.seed({ cwd: rig.cwd });
			await slow.ok("session.attach", { session });
			await fast.ok("session.attach", { session });
			slow.socket.pause();
			for (let run = 1; run <= 5; run++) {
				rig.fake.fake.script(session, [{ kind: "text", text: "w".repeat(100_000) }]);
				await fast.ok("prompt", { session, input: promptInput(`Run ${run}`) });
				await runsFinished(fast, session, run);
			}
			expect(finishedRuns(slow, session)).toBe(0);
			slow.socket.resume();
			await runsFinished(slow, session, 5);
			expect(slow.envelopes(session)).toEqual(fast.envelopes(session));
			expect(slow.socket.closed()).toBeNull();
		} finally {
			await rig.stop();
		}
	});

	test("a phone a whole link window behind is cut off, and catches up from a snapshot", async () => {
		await withEnv("BROSKI_LINK_BACKPRESSURE_MB", "8", async () => {
			const rig = await startCoreBridge();
			roots.push(rig.root);
			try {
				const slow = await rig.phone("slow");
				const fast = await rig.phone("fast");
				const session = rig.fake.fake.seed({ cwd: rig.cwd });
				const attached = await slow.ok("session.attach", { session });
				await fast.ok("session.attach", { session });
				slow.socket.pause();
				for (let run = 1; run <= 12; run++) {
					rig.fake.fake.script(session, [{ kind: "text", text: "w".repeat(1_000_000) }]);
					await fast.ok("prompt", { session, input: promptInput(`Run ${run}`) });
					await runsFinished(fast, session, run);
				}
				expect(fast.socket.closed()).toBeNull();
				slow.socket.resume();
				expect((await slow.socket.waitForClose()).code).toBe(LINK_OVERFLOW_CLOSE_CODE);
				const back = await rig.phone("slow-again");
				const resumed = await back.ok("session.attach", {
					session,
					resume: { epoch: attached.sync.epoch, seq: lastSeq(slow, session) },
				});
				expect(resumed.sync).toMatchObject({ kind: "snapshot", lastSeq: lastSeq(fast, session) });
			} finally {
				await rig.stop();
			}
		});
	});

	test("a session keeps running with nobody viewing it, and closes only once idle and the delay has passed", async () => {
		const rig = await startCoreBridge();
		roots.push(rig.root);
		try {
			const a = await rig.phone("a");
			const session = rig.fake.fake.seed({ cwd: rig.cwd });
			rig.fake.fake.script(session, [{ kind: "text", text: "Working." }, { kind: "hold" }]);
			await a.ok("session.attach", { session });
			await a.ok("prompt", { session, input: promptInput("Go") });
			await a.waitForEvent(session, (envelope) => envelope.event.type === "block_finished", "the first block");
			await a.ok("session.detach", { session });
			rig.clock.advance(24 * 60 * 60 * 1000);
			expect(rig.opens.closed).toEqual([]);
			rig.fake.fake.release(session);
			await quiesce();
			rig.clock.advance(DEFAULT_IDLE_CLOSE_MS - 1);
			expect(rig.opens.closed).toEqual([]);
			rig.clock.advance(1);
			expect(rig.opens.closed).toEqual([session.sessionId]);
		} finally {
			await rig.stop();
		}
	});

	test("the snapshot of a run longer than one link message sheds its oldest items and fits", async () => {
		await withEnv("BROSKI_LINK_MESSAGE_MB", "1", async () => {
			const rig = await startCoreBridge();
			roots.push(rig.root);
			try {
				const runner = await rig.phone("runner");
				const session = rig.fake.fake.seed({ cwd: rig.cwd });
				const blocks = Array.from({ length: 400 }, (_, index) => ({
					kind: "text" as const,
					text: `${index}:${"x".repeat(5_000)}`,
				}));
				rig.fake.fake.script(session, [...blocks, { kind: "notice", level: "info", text: "ready" }, { kind: "hold" }]);
				await runner.ok("session.attach", { session });
				await runner.ok("prompt", { session, input: promptInput("A long run") });
				await runner.waitForEvent(session, (envelope) => envelope.event.type === "notice", "the end of the blocks");
				const late = await rig.phone("late");
				const answer = await late.ok("session.attach", { session });
				if (answer.sync.kind !== "snapshot" || !answer.sync.snapshot.run)
					throw new Error("expected a running snapshot");
				const run = answer.sync.snapshot.run;
				expect(run.droppedItems).toBeGreaterThan(0);
				expect(run.droppedItems + run.items.length).toBe(1 + blocks.length);
				expect(run.items.at(-1)).toMatchObject({ kind: "block", text: blocks.at(-1)?.text });
				const [size] = late.frameSizes("session.attach.result");
				expect(size).toBeLessThanOrEqual(1024 * 1024);
				expect(size).toBeGreaterThan(900 * 1024);
				rig.fake.fake.release(session);
				await late.waitForEvent(session, (envelope) => envelope.event.type === "run_finished", "the end of the run");
				expect([...runner.foreignFrames(), ...late.foreignFrames()]).toEqual([]);
			} finally {
				await rig.stop();
			}
		});
	});

	test("a run that survives a bridge restart is there under the same id, in a new epoch", async () => {
		const first = await startCoreBridge();
		roots.push(first.root);
		const phone = await first.phone("phone");
		const session = first.fake.fake.seed({ cwd: first.cwd });
		first.fake.fake.script(session, [
			{ kind: "text", text: "Working." },
			{ kind: "hold" },
			{ kind: "text", text: "Done." },
		]);
		const attached = await phone.ok("session.attach", { session });
		const input = promptInput("Outlive the bridge");
		const accepted = await phone.ok("prompt", { session, input });
		const started = (await phone.waitForEvent(session, (envelope) => envelope.event.type === "run_started", "the run"))
			.event;
		if (started.type !== "run_started") throw new Error("not a run start");
		await phone.waitForEvent(session, (envelope) => envelope.event.type === "block_finished", "the first block");
		const seen = lastSeq(phone, session);
		await first.stop();

		const second = await startCoreBridge({
			from: { root: first.root, restart: (host) => first.fake.fake.restart(host) },
		});
		try {
			const back = await second.phone("phone-again");
			const resumed = await back.ok("session.attach", { session, resume: { epoch: attached.sync.epoch, seq: seen } });
			if (resumed.sync.kind !== "snapshot") throw new Error("a new bridge has nothing to replay");
			expect(resumed.sync.epoch).not.toBe(attached.sync.epoch);
			expect(resumed.sync.snapshot.run?.runId).toBe(started.runId);
			expect((await back.ok("prompt", { session, input })).result).toEqual(accepted.result);
			expect(readFileSync(second.journalPath, "utf8")).toContain(input.clientRequestId);
			second.fake.fake.release(session);
			await back.waitForEvent(session, (envelope) => envelope.event.type === "run_finished", "the end of the run");
		} finally {
			await second.stop();
		}
	});
});
