/**
 * What the backend does with agy's processes: with room for two sessions, a third closes the least recently used idle
 * one (`session/close`, which ends its worker) and that one reloads on its next prompt; a session whose worker is
 * killed mid-turn fails its run in agy's own words and reloads on the next prompt; when the front itself is killed,
 * every session it hosted is lost the same way and the next prompt starts another front. A turn is held mid-way on
 * agy's question, which it asks on any permission policy. Only processes traced to the tap's own `agy` are killed
 * (`processes.ts`), and each test's backend is disposed at its end. Three prompts each, nine in all.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { isRecord } from "../../../adapter-kit/bounded-json";
import { PresenceLocks } from "../../../backends/antigravity/live/lock";
import { WORKER_STOPPED } from "../../../backends/antigravity/live/outcomes";
import type { LiveSession } from "../../../contract/testing/conformance-harness";
import { fileLock } from "../../../platform/file-lock";
import { eventually } from "../../helpers/workspace-rig";
import { TEST_MS } from "./gate";
import { childrenOf, describeProcesses, isAlive, killFront, killWorker } from "./processes";
import { HOLD_PROMPT, input, OK_PROMPT, run } from "./runs";
import { type Frame, resultOf, type TappedAgy } from "./wire-log";
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

		test(
			"a third session closes the least recently used idle one, whose worker ends, and it reloads on its next prompt",
			async () => {
				const backend = await world.start({ maxSessions: 2 });
				const a = await backend.openNew();
				expect((await run(a, OK_PROMPT)).outcome).toEqual({ kind: "completed" });
				const b = await backend.openNew();
				expect((await run(b, OK_PROMPT)).outcome).toEqual({ kind: "completed" });
				const front = frontOf(world, a);
				const before = childrenOf(front.pid);
				console.log(`workers with two sessions: ${describeProcesses(before)}`);
				expect(before.length).toBe(2);

				await backend.openNew();
				expect(closes(world, a)).toBe(1);
				await eventually(
					() => before.filter((worker) => !isAlive(worker.pid)).length === 1,
					"one worker to end",
					10_000,
				);
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
			TEST_MS,
		);

		test(
			"a killed worker fails its session's run, and the next prompt reloads the session",
			async () => {
				const backend = await world.start();
				const live = await backend.openNew();
				expect((await run(live, OK_PROMPT)).outcome).toEqual({ kind: "completed" });
				const front = frontOf(world, live);
				const [worker, ...others] = childrenOf(front.pid);
				expect(others).toEqual([]);
				const lost = await lostMidTurn(live, () => killWorker(front, worker?.pid ?? expect.unreachable("no worker")));
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
			TEST_MS,
		);

		test(
			"a killed front fails the running turn and loses every session it hosted; the next prompt starts another front",
			async () => {
				const backend = await world.start();
				const idle = await backend.openNew();
				expect((await run(idle, OK_PROMPT)).outcome).toEqual({ kind: "completed" });
				const busy = await backend.openNew();
				const front = frontOf(world, busy);
				expect(childrenOf(front.pid).length).toBe(2);
				await lostMidTurn(busy, () => killFront(front));
				await eventually(() => !isAlive(front.pid), "the killed front to be gone", 5_000);
				await reloads(idle);
				expect(frontOf(world, idle).pid).not.toBe(front.pid);
				await backend.backend.dispose();
			},
			TEST_MS,
		);
	});
}

/** The front that made the session or last loaded it. */
function frontOf(world: AgyWorld, live: LiveSession): TappedAgy {
	const { sessionId } = live.ref;
	const made = world.tap
		.exchanges("session/new")
		.filter((exchange) => resultOf(exchange.answer)?.sessionId === sessionId);
	const loaded = world.tap
		.exchanges("session/load", sessionId)
		.filter((exchange) => exchange.agy.args.includes("--process-per-session"));
	const latest = [...made, ...loaded].sort((x, y) => x.agy.startedAt - y.agy.startedAt).at(-1);
	return latest?.agy ?? expect.unreachable(`no front hosts ${sessionId}`);
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
	expect(finished.outcome.error).toMatchObject({
		code: "backend_unavailable",
		message: expect.stringContaining(WORKER_STOPPED),
	});
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
