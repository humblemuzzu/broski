/**
 * Sessions on the real `agy`: one made on the live front with nothing of the bridge's in it (no `_meta`, no system
 * prompt), the phone's settings and agy's presence lock; the front and its workers stopped by `dispose` within the stop
 * ladder, the lock let go; the session reopened by a new backend through `session/load`, its history kept out of the
 * live stream and still agy's own, since the model recalls what it was told before with only the person's words sent;
 * a second reader (a short job's `session/load`) of the session the front hosts, after a turn of its own so that the
 * read is agy's and not the transcript the backend kept, and the session then goes on working and compacts. The tests
 * run in order on one session, each on what the one before left. Four prompts.
 */

import { afterAll, beforeAll, describe, expect } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";
import { STOP_BUDGET_MS } from "../../../adapter-kit/stdio-child";
import { PresenceLocks } from "../../../backends/antigravity/live/lock";
import type { SessionRef } from "../../../contract";
import type { LiveSession } from "../../../contract/testing/conformance-harness";
import { allTranscript } from "../../../contract/testing/conformance-reads";
import { fileLock } from "../../../platform/file-lock";
import { eventually } from "../../helpers/workspace-rig";
import { TEST_MS } from "./gate";
import { liveTest } from "./live-test";
import { childrenOf, describeProcesses, isAlive } from "./processes";
import { answerText, contextOf, OK_PROMPT, run } from "./runs";
import { paramsOf, resultOf } from "./wire-log";
import { AgyWorld, type LiveBackend } from "./world";

/** Told in the first turn only, so a later answer that names it proves the model has agy's own history. */
const REMEMBER_PROMPT = "Remember this code word for later: heron. Reply with ok only.";
const RECALL_PROMPT = "What code word did I ask you to remember? Reply with the code word only.";
const QUIET_MS = 3_000;

export function sessionsSuite(): void {
	describe("sessions on the live front", () => {
		let world: AgyWorld;
		let first: LiveBackend | undefined;
		let session: SessionRef | undefined;
		let hosted: { readonly backend: LiveBackend; readonly live: LiveSession } | undefined;
		const locks = () => new PresenceLocks(world.presenceDir, fileLock);
		const made = () => session ?? expect.unreachable("the test before made no session");

		beforeAll(() => {
			world = AgyWorld.create({ label: "sessions" });
		});
		afterAll(async () => {
			await world.dispose();
			expect(world.faults).toEqual([]);
		});

		liveTest(
			"a new session runs on a per-session front with nothing of the bridge's, the phone's settings and agy's lock held",
			async () => {
				first = await world.start();
				const accepting = await acceptingMode(first, world.cwd);
				const { modelId, thinking, mode } = first.choice;
				const live = await first.openNew({
					modelId,
					...(thinking !== undefined && { thinking }),
					modes: [{ axis: mode.axis, value: accepting }],
				});
				session = live.ref;
				expect(live.initial).toMatchObject({ modelId, ...(thinking !== undefined && { thinking }) });
				expect(live.initial.modes).toEqual([{ axis: mode.axis, value: accepting }]);

				const front = world.tap.front();
				expect(front?.args).toEqual(["acp", "--process-per-session"]);
				const created = world.tap
					.exchanges("session/new")
					.find((exchange) => resultOf(exchange.answer)?.sessionId === live.ref.sessionId);
				expect(created?.agy.pid).toBe(front?.pid);
				expect(paramsOf(created?.request ?? expect.unreachable("no session/new"))).toEqual({
					cwd: world.cwd,
					mcpServers: [],
				});

				const lock = join(world.presenceDir, `${live.ref.sessionId}.lock`);
				expect(statSync(lock).mode & 0o777).toBe(0o600);
				expect(locks().heldElsewhere(live.ref.sessionId)).toBe(true);

				const mark = live.recorder.items.length;
				expect(await live.control.setMode(mode.axis, mode.value)).toEqual({ status: "accepted" });
				await live.waitFor("mode_changed", (event) => event.value === mode.value, mark);

				expect((await run(live, REMEMBER_PROMPT)).outcome).toEqual({ kind: "completed" });
				await first.catalog.waitFor(
					(events) =>
						events.find(
							(event) =>
								event.type === "session_updated" &&
								event.summary.session.sessionId === live.ref.sessionId &&
								event.summary.title !== undefined,
						),
					"agy's title for the session (session_info_update)",
				);
				live.assertSettled();
			},
			TEST_MS,
		);

		liveTest(
			"dispose stops the front and its workers within the stop ladder, then lets the lock go",
			async () => {
				const ref = made();
				const front = world.tap.front() ?? expect.unreachable("no front runs");
				const workers = childrenOf(front.pid);
				console.log(`front ${front.pid}, workers: ${describeProcesses(workers)}`);
				expect(workers.length).toBeGreaterThanOrEqual(1);
				const started = performance.now();
				await (first ?? expect.unreachable("no backend")).backend.dispose();
				const took = performance.now() - started;
				console.log(`dispose took ${Math.round(took)} ms; the stop ladder allows ${STOP_BUDGET_MS} ms`);
				expect(took).toBeLessThan(STOP_BUDGET_MS + 1_000);
				const gone = [front.pid, front.tapPid, ...workers.map((worker) => worker.pid)];
				await eventually(() => gone.every((pid) => !isAlive(pid)), "the front and its workers to be gone", 1_000);
				expect(locks().heldElsewhere(ref.sessionId)).toBe(false);
			},
			TEST_MS,
		);

		liveTest(
			"a new backend reopens the session through session/load, keeps its history out of the live stream and agy's own",
			async () => {
				const ref = made();
				const backend = await world.start();
				const live = await backend.open(ref);
				hosted = { backend, live };
				expect(live.initial.run).toBeUndefined();
				expect(live.initial.interactions).toEqual([]);
				expect(live.session.control).toBeDefined();
				expect(locks().heldElsewhere(ref.sessionId)).toBe(true);
				await Bun.sleep(QUIET_MS);
				expect(live.events().filter((event) => /^(block_|tool_|user_message|run_)/.test(event.type))).toEqual([]);

				const load = world.tap
					.exchanges("session/load", ref.sessionId)
					.find((exchange) => exchange.agy.args.includes("--process-per-session"));
				expect(load?.answer?.message.error).toBeUndefined();
				expect(paramsOf(load?.request ?? expect.unreachable("no session/load on the front"))._meta).toBeUndefined();

				const turn = await run(live, RECALL_PROMPT);
				expect(turn.outcome).toEqual({ kind: "completed" });
				expect(answerText(turn.events).toLowerCase()).toContain("heron");
				const recalled = world.tap.exchanges("session/prompt", ref.sessionId).at(-1);
				expect(paramsOf(recalled?.request ?? expect.unreachable("no session/prompt"))).toEqual({
					sessionId: ref.sessionId,
					prompt: [{ type: "text", text: RECALL_PROMPT }],
				});

				for (const missing of [crypto.randomUUID(), "../not-a-session"]) {
					const target = { kind: "existing" as const, session: { ...ref, sessionId: missing } };
					const opened = await backend.backend.open(target, { emit: () => undefined });
					expect(opened).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
				}
			},
			TEST_MS,
		);

		liveTest(
			"after a turn, a short job reads the session the front hosts afresh, and the session then still compacts",
			async () => {
				const ref = made();
				const { backend, live } = hosted ?? expect.unreachable("the test before hosted no session");
				expect((await run(live, OK_PROMPT)).outcome).toEqual({ kind: "completed" });
				const loadsBefore = world.tap.exchanges("session/load", ref.sessionId).length;
				const items = await allTranscript(backend.backend, ref, 200);
				const job = world.tap
					.exchanges("session/load", ref.sessionId)
					.slice(loadsBefore)
					.find((exchange) => !exchange.agy.args.includes("--process-per-session"));
				if (job === undefined) {
					throw new Error(`no short job loaded the session for this read, which gave ${items.length} items`);
				}
				expect(job.answer?.message.error).toBeUndefined();
				const closed = world.tap.exchanges("session/close", ref.sessionId);
				expect(closed.some((exchange) => exchange.agy.tapPid === job.agy.tapPid)).toBe(true);
				const asked = items.flatMap((item) => (item.kind === "user_message" ? [item.text] : []));
				expect(asked).toEqual([REMEMBER_PROMPT, RECALL_PROMPT, OK_PROMPT]);
				expect(items.some((item) => item.kind === "block" && item.block === "text" && /heron/i.test(item.text))).toBe(
					true,
				);

				const before = contextOf(live.session.snapshot());
				const mark = live.recorder.items.length;
				expect(await live.control.compact?.(undefined)).toEqual({ status: "accepted" });
				const finished = await live.waitFor("compaction_finished", () => true, mark);
				expect(finished.outcome.kind).toBe("completed");
				const compacted = world.tap.exchanges("session/prompt", ref.sessionId).at(-1);
				expect(paramsOf(compacted?.request ?? expect.unreachable("no compaction prompt")).prompt).toEqual([
					{ type: "text", text: "/compact" },
				]);
				await live.waitFor("usage_updated", (event) => event.usage.contextTokens !== undefined, mark);
				console.log(`compaction: ${before} before, ${contextOf(live.session.snapshot())} after`);
				live.assertSettled();
			},
			TEST_MS,
		);
	});
}

/** agy's mode that writes without asking, found by its name in agy's catalog: set at open, then set back. */
async function acceptingMode(live: LiveBackend, cwd: string): Promise<string> {
	const modes = await live.backend.listModes(cwd);
	if (modes.status === "rejected") throw new Error(modes.rejection.message);
	const value = modes.modes
		.find((axis) => axis.id === live.choice.mode.axis)
		?.options.find((option) => /accept/i.test(option.value))?.value;
	return value ?? expect.unreachable("agy lists no mode that accepts edits");
}
