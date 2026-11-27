/**
 * What the backend does with agy's processes: with room for two sessions, a third closes the least recently used idle
 * one (`session/close`, which ends its worker and no other process) and that one reloads on its next prompt; a session
 * whose worker is killed mid-turn fails its run in agy's own words and reloads on the next prompt; when the front itself
 * is killed, every session it hosted is lost the same way and the next prompt starts another front. A turn is held
 * mid-way on agy's question, which it asks on any permission policy. A session's worker is the child that joined the
 * front while it made or loaded the session (the tap notes the front's children around each), since the front may have
 * children of its own: on a Gemini API key it had one more than it had sessions. Only processes traced to the tap's own
 * `agy` are killed (`processes.ts`), and each test's backend is disposed at its end. Three prompts each, nine in all.
 */

import { afterAll, beforeAll, describe, expect } from "bun:test";
import { isRecord } from "../../../adapter-kit/bounded-json";
import { PresenceLocks } from "../../../backends/antigravity/live/lock";
import { WORKER_STOPPED } from "../../../backends/antigravity/live/outcomes";
import type { LiveSession } from "../../../contract/testing/conformance-harness";
import { fileLock } from "../../../platform/file-lock";
import { eventually } from "../../helpers/workspace-rig";
import { testMs } from "./gate";
import { liveTest } from "./live-test";
import { childrenOf, describeProcesses, isAlive, killFront, killWorker } from "./processes";
import { HOLD_PROMPT, input, OK_PROMPT, run } from "./runs";
import { appeared, type Frame, type TappedAgy } from "./wire-log";
import { AgyWorld } from "./world";

export function capacitySuite(): void {
	describe("agy's processes", () => {
		let world: AgyWorld;

		beforeAll(() => {
			world = AgyWorld.create({ label: "processes" });
		});
		afterAll(async () => {
			await world?.dispose();
			expect(world?.faults ?? []).toEqual([]);
		});

		liveTest(
			"a third session closes the least recently used idle one, whose worker ends, and it reloads on its next prompt",
			async () => {
				const backend = await world.start({ maxSessions: 2 });
				const a = await backend.openNew();
				expect((await run(a, OK_PROMPT)).outcome).toEqual({ kind: "completed" });
				const b = await backend.openNew();
				expect((await run(b, OK_PROMPT)).outcome).toEqual({ kind: "completed" });
				const { front, worker: aWorker } = workerOf(world, a);
				const { worker: bWorker } = workerOf(world, b);
				const before = childrenOf(front.pid);
				console.log(
					`front ${front.pid} with two sessions: ${describeProcesses(before)}; a's worker ${aWorker}, b's ${bWorker}`,
				);
				expect(before.map((child) => child.pid)).toEqual(expect.arrayContaining([aWorker, bWorker]));

				await backend.openNew();
				expect(closes(world, a)).toBe(1);
				await eventually(() => !isAlive(aWorker), "a's worker to end", 10_000);
				const others = before.filter((child) => child.pid !== aWorker);
				expect(others.filter((child) => !isAlive(child.pid))).toEqual([]);
				expect(new PresenceLocks(world.presenceDir, fileLock).heldElsewhere(a.ref.sessionId)).toBe(false);

				const mark = a.recorder.items.length;
				expect((await run(a, OK_PROMPT)).outcome).toEqual({ kind: "completed" });
				await a.waitFor("resynced", () => true, mark);
				expect(world.tap.exchanges("session/load", a.ref.sessionId).some((load) => load.agy.pid === front.pid)).toBe(
					true,
				);
				expect(closes(world, b)).toBe(1);
				a.assertSettled();
				await backend.backend.dispose();
			},
			testMs(3),
		);

		liveTest(
			"a killed worker fails its session's run, and the next prompt reloads the session",
			async () => {
				const backend = await world.start();
				const live = await backend.openNew();
				expect((await run(live, OK_PROMPT)).outcome).toEqual({ kind: "completed" });
				const { front, worker } = workerOf(world, live);
				const lost = await lostMidTurn(live, () => killWorker(front, worker));
				const said = await eventually(
					() => errorOf(world.tap.exchanges("session/prompt", live.ref.sessionId).at(-1)?.answer),
					"agy's error answering the held prompt",
					5_000,
				);
				console.log(`agy answered the held prompt ${JSON.stringify(said)}; the run ended: ${lost}`);
				expect(lost).toContain(said.message);
				await reloads(live);
				await backend.backend.dispose();
			},
			testMs(3),
		);

		liveTest(
			"a killed front fails the running turn and loses every session it hosted; the next prompt starts another front",
			async () => {
				const backend = await world.start();
				const idle = await backend.openNew();
				expect((await run(idle, OK_PROMPT)).outcome).toEqual({ kind: "completed" });
				const busy = await backend.openNew();
				const { front, worker: busyWorker } = workerOf(world, busy);
				const { worker: idleWorker } = workerOf(world, idle);
				expect(idleWorker).not.toBe(busyWorker);
				expect(childrenOf(front.pid).map((child) => child.pid)).toEqual(
					expect.arrayContaining([idleWorker, busyWorker]),
				);
				await lostMidTurn(busy, () => killFront(front));
				await eventually(() => !isAlive(front.pid), "the killed front to be gone", 5_000);
				await reloads(idle);
				expect(workerOf(world, idle).front.pid).not.toBe(front.pid);
				await backend.backend.dispose();
			},
			testMs(3),
		);
	});
}

/** The front that made the session or last loaded it, and the one worker that joined it then. */
function workerOf(world: AgyWorld, live: LiveSession): { readonly front: TappedAgy; readonly worker: number } {
	const { sessionId } = live.ref;
	const open = world.tap.hosting(sessionId) ?? expect.unreachable(`no front hosts ${sessionId}`);
	const joined = appeared(open);
	const [worker] = joined;
	if (worker === undefined || joined.length > 1) {
		throw new Error(
			`${joined.length} children joined front ${open.agy.pid} while it opened ${sessionId} ([${joined.join(", ")}]), not one worker`,
		);
	}
	return { front: open.agy, worker };
}

function errorOf(answer: Frame | undefined): { readonly code: unknown; readonly message: string } | undefined {
	const error = answer?.message.error;
	return isRecord(error) && typeof error.message === "string"
		? { code: error.code, message: error.message }
		: undefined;
}

function closes(world: AgyWorld, live: LiveSession): number {
	return world.tap
		.exchanges("session/close", live.ref.sessionId)
		.filter((exchange) => exchange.agy.args.includes("--process-per-session")).length;
}

/**
 * A turn held on its question, then `kill`: the run fails as the bridge says a lost agy fails, its ask withdrawn. The
 * result is the run's error message.
 */
async function lostMidTurn(live: LiveSession, kill: () => void): Promise<string> {
	const mark = live.recorder.items.length;
	expect(await live.control.prompt(input(HOLD_PROMPT))).toMatchObject({ status: "accepted" });
	const { runId } = await live.waitFor("run_started", () => true, mark);
	const asked = await live.waitFor("interaction_requested", () => true, mark);
	kill();
	const finished = await live.waitFor("run_finished", (event) => event.runId === runId, mark);
	if (finished.outcome.kind !== "error") throw new Error(`the held run ended ${finished.outcome.kind}`);
	// bun 1.4.5's toMatchObject writes an asymmetric matcher into the object it checks, which would corrupt the event.
	expect(finished.outcome.error.code).toBe("backend_unavailable");
	expect(finished.outcome.error.message).toContain(WORKER_STOPPED);
	const withdrawn = await live.waitFor(
		"interaction_resolved",
		(event) => event.interactionId === asked.interaction.id,
		mark,
	);
	expect(withdrawn.reason).toBe("withdrawn");
	live.assertSettled();
	return finished.outcome.error.message;
}

/** The next prompt loads the session in a new host, which replaces the view's state once, and runs. */
async function reloads(live: LiveSession): Promise<void> {
	const mark = live.recorder.items.length;
	expect((await run(live, OK_PROMPT)).outcome).toEqual({ kind: "completed" });
	await live.waitFor("resynced", () => true, mark);
	expect(
		live
			.events()
			.slice(mark)
			.filter((event) => event.type === "resynced"),
	).toHaveLength(1);
	live.assertSettled();
}
