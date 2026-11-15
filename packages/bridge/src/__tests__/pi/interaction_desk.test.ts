/**
 * The interaction desk: one `Interaction` per ask, resolved exactly once by a human, the
 * extension's own timeout, the run's end or the shutdown, and by nothing else.
 */

import { describe, expect, spyOn, test } from "bun:test";
import { Interaction, MAX_LIST_ITEMS, sessionStatus } from "../../contract";
import { CHOICE, CONFIRM, type DeskRig, deskRig, PERMISSION, pause, TEXT } from "./desk_rig";

describe("what an ask puts in the live state", () => {
	test("inside a run it names the run and blocks it", async () => {
		const { desk, live, log, setRun } = deskRig();
		setRun("run-1");
		void desk.ask({ title: "Sure?", body: "Really.", request: CONFIRM, origin: { toolName: "bash" } });
		const { interaction } = await log.next("interaction_requested");
		expect(interaction).toMatchObject({
			runId: "run-1",
			createdAt: 1_000_000,
			title: "Sure?",
			body: "Really.",
			blocksRun: true,
			origin: { toolName: "bash" },
			request: { kind: "confirm" },
		});
		expect(interaction).not.toHaveProperty("expiresAt");
		expect(live.snapshot().interactions).toEqual([interaction]);
		expect(sessionStatus(live.snapshot())).toBe("waiting_for_user");
	});

	test("outside a run it names none and blocks none", async () => {
		const { desk, live, log } = deskRig();
		void desk.ask({ title: "From a command", request: TEXT });
		const { interaction } = await log.next("interaction_requested");
		expect(interaction.blocksRun).toBe(false);
		expect(interaction).not.toHaveProperty("runId");
		expect(sessionStatus(live.snapshot())).toBe("idle");
	});

	test("an extension timeout is the interaction's own deadline, and a larger one than a timer holds is capped", async () => {
		const { desk, log } = deskRig();
		void desk.ask({ title: "t", request: CONFIRM }, 60_000);
		void desk.ask({ title: "t", request: CONFIRM }, 2 ** 40);
		const [short, long] = await Promise.all([log.next("interaction_requested"), log.next("interaction_requested")]);
		expect(short.interaction.expiresAt).toBe(1_060_000);
		expect(long.interaction.expiresAt).toBe(1_000_000 + 2 ** 31 - 1);
		desk.expireAll();
	});

	test("a fractional timeout gives a whole-number deadline", async () => {
		const { desk, log } = deskRig();
		void desk.ask({ title: "t", request: CONFIRM }, 1500.2);
		const { interaction } = await log.next("interaction_requested");
		expect(interaction.expiresAt).toBe(1_001_501);
		expect(Interaction.safeParse(interaction).success).toBe(true);
		desk.expireAll();
	});

	test("a timeout that is not a positive number sets no deadline and no timer", async () => {
		const { desk, log } = deskRig();
		void desk.ask({ title: "t", request: CONFIRM }, 0);
		void desk.ask({ title: "t", request: CONFIRM }, Number.NaN);
		void desk.ask({ title: "t", request: CONFIRM }, -5);
		await pause(30);
		expect(log.of("interaction_requested").map((event) => event.interaction.expiresAt)).toEqual([
			undefined,
			undefined,
			undefined,
		]);
		expect(log.of("interaction_resolved")).toEqual([]);
		desk.expireAll();
	});
});

describe("answers", () => {
	test("an answer resolves the ask once, as answered, and a second answer is stale", async () => {
		const { desk, live, log } = deskRig();
		const asked = desk.ask({ title: "t", request: CONFIRM });
		const { interaction } = await log.next("interaction_requested");
		const reply = { kind: "confirm", confirmed: true } as const;
		expect(desk.answer({ interactionId: interaction.id, reply })).toEqual({ status: "accepted" });
		expect(await asked).toEqual({ kind: "answered", reply });
		expect(log.of("interaction_resolved")).toEqual([
			{ type: "interaction_resolved", interactionId: interaction.id, reason: "answered" },
		]);
		expect(live.snapshot().interactions).toEqual([]);
		expect(desk.answer({ interactionId: interaction.id, reply })).toMatchObject({
			status: "rejected",
			rejection: { code: "stale" },
		});
	});

	test("an unknown id is not_found", () => {
		const { desk } = deskRig();
		const result = desk.answer({ interactionId: "nobody", reply: { kind: "confirm", confirmed: true } });
		expect(result).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
	});

	test("a malformed answer is invalid_input and changes nothing; the ask still waits for a good one", async () => {
		const { desk, live, log } = deskRig();
		const asked = desk.ask({ title: "t", request: CHOICE });
		const { interaction } = await log.next("interaction_requested");
		const wrongKind = desk.answer({ interactionId: interaction.id, reply: { kind: "confirm", confirmed: true } });
		const notAnOption = desk.answer({ interactionId: interaction.id, reply: { kind: "choice", value: "z" } });
		expect(wrongKind).toMatchObject({ status: "rejected", rejection: { code: "invalid_input" } });
		expect(notAnOption).toMatchObject({ status: "rejected", rejection: { code: "invalid_input" } });
		expect(log.of("interaction_resolved")).toEqual([]);
		expect(live.snapshot().interactions).toHaveLength(1);
		desk.answer({ interactionId: interaction.id, reply: { kind: "choice", value: "a" } });
		expect(await asked).toEqual({ kind: "answered", reply: { kind: "choice", value: "a" } });
	});

	test("a reply the asker refuses is invalid_input too, and the ask keeps waiting", async () => {
		const { desk, log } = deskRig();
		const asked = desk.ask({
			title: "t",
			request: TEXT,
			replyProblem: (reply) => (reply.kind === "text" && reply.text === "no" ? "not that" : undefined),
		});
		const { interaction } = await log.next("interaction_requested");
		const refused = desk.answer({ interactionId: interaction.id, reply: { kind: "text", text: "no" } });
		expect(refused).toMatchObject({ status: "rejected", rejection: { code: "invalid_input", message: "not that" } });
		expect(desk.answer({ interactionId: interaction.id, reply: { kind: "text", text: "yes" } })).toEqual({
			status: "accepted",
		});
		expect(await asked).toEqual({ kind: "answered", reply: { kind: "text", text: "yes" } });
	});

	test("a cancel is an answer, valid for every kind, and does not reach the asker's refusal", async () => {
		const { desk, log, aborts } = deskRig();
		const asked = desk.ask({ title: "t", request: CHOICE, replyProblem: () => "never" });
		const { interaction } = await log.next("interaction_requested");
		const cancel = { kind: "cancel", stopRun: false } as const;
		expect(desk.answer({ interactionId: interaction.id, reply: cancel })).toEqual({ status: "accepted" });
		expect(await asked).toEqual({ kind: "answered", reply: cancel });
		expect(log.of("interaction_resolved")[0]?.reason).toBe("answered");
		expect(aborts.count).toBe(0);
	});

	test("a cancel that stops the run resolves the ask, then aborts the run once", async () => {
		const { desk, log, aborts, setRun } = deskRig();
		setRun("run-1");
		const asked = desk.ask({ title: "t", request: CONFIRM });
		const { interaction } = await log.next("interaction_requested");
		desk.answer({ interactionId: interaction.id, reply: { kind: "cancel", stopRun: true } });
		expect(aborts.count).toBe(1);
		expect(await asked).toEqual({ kind: "answered", reply: { kind: "cancel", stopRun: true } });
		expect(log.of("interaction_resolved")).toHaveLength(1);
	});
});

describe("nothing but a human, the extension or the host ends an ask", () => {
	test("an ask without a positive timeout schedules no timer at all, so no time can end it", () => {
		const { desk } = deskRig();
		const timers = spyOn(globalThis, "setTimeout");
		try {
			for (const timeoutMs of [undefined, 0, -5, Number.NaN]) {
				void desk.ask({ title: "t", request: CONFIRM }, timeoutMs);
			}
			expect(timers).not.toHaveBeenCalled();
		} finally {
			timers.mockRestore();
			desk.expireAll();
		}
	});

	test("an ask with no timeout waits", async () => {
		const { desk, live, log } = deskRig();
		let ended = false;
		void desk.ask({ title: "t", request: CONFIRM }).then(() => {
			ended = true;
		});
		await log.next("interaction_requested");
		await pause(80);
		expect(ended).toBe(false);
		expect(live.snapshot().interactions).toHaveLength(1);
		desk.expireAll();
	});

	test("the extension's timeout ends the ask as withdrawn, and only then", async () => {
		const { desk, live, log } = deskRig();
		const asked = desk.ask({ title: "t", request: CONFIRM }, 25);
		const { interaction } = await log.next("interaction_requested");
		expect(await asked).toEqual({ kind: "ended" });
		expect(log.of("interaction_resolved")).toEqual([
			{ type: "interaction_resolved", interactionId: interaction.id, reason: "withdrawn" },
		]);
		expect(live.snapshot().interactions).toEqual([]);
	});

	test("an answer clears the extension's timer: nothing fires afterwards", async () => {
		const { desk, log } = deskRig();
		const asked = desk.ask({ title: "t", request: CONFIRM }, 25);
		const { interaction } = await log.next("interaction_requested");
		desk.answer({ interactionId: interaction.id, reply: { kind: "confirm", confirmed: false } });
		await asked;
		await pause(70);
		expect(log.of("interaction_resolved")).toHaveLength(1);
	});

	test("every way an ask can end clears its timer", async () => {
		const ends: ((rig: DeskRig, id: string) => void)[] = [
			(rig, id) => void rig.desk.answer({ interactionId: id, reply: { kind: "confirm", confirmed: true } }),
			(rig) => rig.desk.withdrawRun("run-1"),
			(rig) => rig.desk.expireAll(),
		];
		for (const end of ends) {
			const rig = deskRig();
			rig.setRun("run-1");
			const started = spyOn(globalThis, "setTimeout");
			const cleared = spyOn(globalThis, "clearTimeout");
			void rig.desk.ask({ title: "t", request: CONFIRM }, 60_000);
			const timer = started.mock.results.at(-1)?.value;
			const { interaction } = await rig.log.next("interaction_requested");
			end(rig, interaction.id);
			expect(cleared.mock.calls.some(([handle]) => handle === timer)).toBe(true);
			started.mockRestore();
			cleared.mockRestore();
		}
	});

	test("the end of a run withdraws that run's asks and no others", async () => {
		const { desk, live, log, setRun } = deskRig();
		setRun("run-1");
		const inRun = desk.ask({ title: "in", request: CONFIRM });
		setRun("run-2");
		const other = desk.ask({ title: "other", request: CONFIRM });
		setRun(undefined);
		const outside = desk.ask({ title: "outside", request: CONFIRM });
		await Promise.all([
			log.next("interaction_requested"),
			log.next("interaction_requested"),
			log.next("interaction_requested"),
		]);
		desk.withdrawRun("run-1");
		expect(await inRun).toEqual({ kind: "ended" });
		expect(log.of("interaction_resolved").map((event) => event.reason)).toEqual(["withdrawn"]);
		expect(live.snapshot().interactions.map((interaction) => interaction.title)).toEqual(["other", "outside"]);
		desk.withdrawRun("run-1");
		expect(log.of("interaction_resolved")).toHaveLength(1);
		desk.expireAll();
		expect(await Promise.all([other, outside])).toEqual([{ kind: "ended" }, { kind: "ended" }]);
	});

	test("an ask for a run being aborted ends at once and shows nobody; one outside any run is asked", async () => {
		const rig = deskRig();
		rig.setRun("run-1");
		rig.aborting = true;
		expect(await rig.desk.ask({ title: "too late", request: CONFIRM })).toEqual({ kind: "ended" });
		expect(rig.log.events).toEqual([]);
		rig.setRun(undefined);
		void rig.desk.ask({ title: "from a command", request: CONFIRM });
		await rig.log.next("interaction_requested");
		rig.desk.expireAll();
	});

	test("the end of a run withdraws its permission asks and raises any other of its asks again on its own", async () => {
		const { desk, live, log, setRun } = deskRig();
		setRun("run-1");
		const permission = desk.ask({ title: "Allow read?", request: PERMISSION });
		const dialog = desk.ask({ title: "From a timer", request: CONFIRM });
		await Promise.all([log.next("interaction_requested"), log.next("interaction_requested")]);

		desk.endRun("run-1");
		expect(await permission).toEqual({ kind: "ended" });
		const [kept] = live.snapshot().interactions;
		expect(live.snapshot().interactions).toHaveLength(1);
		expect(kept).toMatchObject({ title: "From a timer", blocksRun: false });
		expect(kept).not.toHaveProperty("runId");
		expect(log.of("interaction_resolved").map((event) => event.reason)).toEqual(["withdrawn", "withdrawn"]);

		desk.expireAll();
		expect(await dialog).toEqual({ kind: "ended" });
	});

	test("expireAll resolves every ask expired, ends it, and closes the desk", async () => {
		const { desk, live, log } = deskRig();
		const first = desk.ask({ title: "1", request: CONFIRM }, 60_000);
		const second = desk.ask({ title: "2", request: TEXT });
		const { interaction } = await log.next("interaction_requested");
		await log.next("interaction_requested");
		desk.expireAll();
		expect(await Promise.all([first, second])).toEqual([{ kind: "ended" }, { kind: "ended" }]);
		expect(log.of("interaction_resolved").map((event) => event.reason)).toEqual(["expired", "expired"]);
		expect(live.snapshot().interactions).toEqual([]);
		expect(desk.answer({ interactionId: interaction.id, reply: { kind: "confirm", confirmed: true } })).toMatchObject({
			rejection: { code: "stale" },
		});
		expect(log.invalid).toEqual([]);

		const events = log.events.length;
		expect(await desk.ask({ title: "late", request: CONFIRM })).toEqual({ kind: "ended" });
		expect(log.events).toHaveLength(events);
		desk.expireAll();
		expect(log.events).toHaveLength(events);
	});
});

describe("two asks, and answers racing the ends", () => {
	test("answers reach their own askers, in any order", async () => {
		const { desk, log } = deskRig();
		const first = desk.ask({ title: "first", request: CONFIRM });
		const second = desk.ask({ title: "second", request: TEXT });
		const a = await log.next("interaction_requested", (event) => event.interaction.title === "first");
		const b = await log.next("interaction_requested", (event) => event.interaction.title === "second");
		desk.answer({ interactionId: b.interaction.id, reply: { kind: "text", text: "for the second" } });
		desk.answer({ interactionId: a.interaction.id, reply: { kind: "confirm", confirmed: true } });
		expect(await first).toEqual({ kind: "answered", reply: { kind: "confirm", confirmed: true } });
		expect(await second).toEqual({ kind: "answered", reply: { kind: "text", text: "for the second" } });
		expect(log.of("interaction_resolved").map((event) => event.interactionId)).toEqual([
			b.interaction.id,
			a.interaction.id,
		]);
	});

	test("an answer after the run's end is stale, and the end after an answer changes nothing", async () => {
		const { desk, log, setRun } = deskRig();
		setRun("run-1");
		const withdrawn = desk.ask({ title: "w", request: CONFIRM });
		const answered = desk.ask({ title: "a", request: CONFIRM });
		const w = await log.next("interaction_requested", (event) => event.interaction.title === "w");
		const a = await log.next("interaction_requested", (event) => event.interaction.title === "a");
		const yes = { kind: "confirm", confirmed: true } as const;
		desk.answer({ interactionId: a.interaction.id, reply: yes });
		desk.withdrawRun("run-1");
		expect(desk.answer({ interactionId: w.interaction.id, reply: yes })).toMatchObject({
			rejection: { code: "stale" },
		});
		expect(await withdrawn).toEqual({ kind: "ended" });
		expect(await answered).toEqual({ kind: "answered", reply: yes });
		expect(log.of("interaction_resolved").map((event) => event.reason)).toEqual(["answered", "withdrawn"]);
	});

	test("the extension's timer losing to an answer, and the answer losing to it, each resolve once", async () => {
		const { desk, log } = deskRig();
		const yes = { kind: "confirm", confirmed: true } as const;
		const timed = desk.ask({ title: "t", request: CONFIRM }, 20);
		const t = await log.next("interaction_requested");
		await pause(60);
		expect(desk.answer({ interactionId: t.interaction.id, reply: yes })).toMatchObject({
			rejection: { code: "stale" },
		});
		expect(await timed).toEqual({ kind: "ended" });
		expect(log.of("interaction_resolved").map((event) => event.reason)).toEqual(["withdrawn"]);
	});
});

describe("bounds", () => {
	test("past MAX_LIST_ITEMS open asks a new one ends at once, asking nobody", async () => {
		const { desk, live } = deskRig();
		for (let i = 0; i < MAX_LIST_ITEMS; i++) void desk.ask({ title: `${i}`, request: CONFIRM });
		expect(live.snapshot().interactions).toHaveLength(MAX_LIST_ITEMS);
		expect(await desk.ask({ title: "one too many", request: CONFIRM })).toEqual({ kind: "ended" });
		expect(live.snapshot().interactions).toHaveLength(MAX_LIST_ITEMS);
		desk.expireAll();
	});

	test("the resolved ids kept are bounded: the oldest falls out and answers not_found, a recent one stale", async () => {
		const { desk, log } = deskRig();
		const reply = { kind: "confirm", confirmed: true } as const;
		const ids: string[] = [];
		for (let i = 0; i < MAX_LIST_ITEMS + 1; i++) {
			const asked = desk.ask({ title: `${i}`, request: CONFIRM });
			const { interaction } = await log.next("interaction_requested");
			ids.push(interaction.id);
			desk.answer({ interactionId: interaction.id, reply });
			await asked;
		}
		expect(desk.answer({ interactionId: ids[0] ?? "", reply })).toMatchObject({ rejection: { code: "not_found" } });
		expect(desk.answer({ interactionId: ids[1] ?? "", reply })).toMatchObject({ rejection: { code: "stale" } });
		expect(desk.answer({ interactionId: ids.at(-1) ?? "", reply })).toMatchObject({ rejection: { code: "stale" } });
	});
});
