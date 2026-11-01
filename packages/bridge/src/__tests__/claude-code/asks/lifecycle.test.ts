import { describe, expect, test } from "bun:test";
import type { ToolPermissionReply } from "../../../contract";
import { DeskRig, stillPending } from "./desk-rig";

const BASH = { command: "ls" };
const ALLOW: ToolPermissionReply = { kind: "tool_permission", optionId: "allow_once", grantIds: [] };
const DENY: ToolPermissionReply = { kind: "tool_permission", optionId: "deny_once", grantIds: [] };

describe("an ask's life", () => {
	test("is requested on the run, resolved once when answered, and gone from the snapshot", async () => {
		const rig = new DeskRig();
		const ask = rig.tool("Bash", BASH);
		const interaction = rig.only();
		expect(interaction).toMatchObject({ runId: "run-1", blocksRun: true, createdAt: 1_000 });
		expect(rig.pending()).toEqual([interaction]);
		expect(rig.answer(interaction, ALLOW)).toEqual({ status: "accepted" });
		await ask.promise;
		expect(rig.pending()).toEqual([]);
		expect(rig.resolved()).toEqual([{ interactionId: interaction.id, reason: "answered" }]);
		expect(rig.answer(interaction, ALLOW)).toMatchObject({ status: "rejected", rejection: { code: "stale" } });
		expect(rig.resolved()).toHaveLength(1);
	});

	test("an id nobody raised is not found", () => {
		const rig = new DeskRig();
		expect(rig.desk.answer({ interactionId: "nope", reply: ALLOW })).toMatchObject({
			rejection: { code: "not_found" },
		});
	});

	test("outside a run it names no run and blocks none", () => {
		const rig = new DeskRig();
		rig.runId = undefined;
		rig.tool("Bash", BASH);
		const { runId, blocksRun } = rig.only();
		expect(runId).toBeUndefined();
		expect(blocksRun).toBe(false);
	});

	test("two asks at once are answered independently, in any order", async () => {
		const rig = new DeskRig();
		const first = rig.tool("Bash", BASH);
		const second = rig.tool("Bash", { command: "pwd" });
		const [a, b] = rig.requested();
		if (!a || !b) throw new Error("two asks expected");
		expect(a.id).not.toBe(b.id);
		rig.answer(b, DENY);
		expect(await second.promise).toMatchObject({ behavior: "deny" });
		expect(await stillPending(first.promise)).toBe(true);
		rig.answer(a, ALLOW);
		expect(await first.promise).toMatchObject({ behavior: "allow" });
	});
});

describe("the CLI withdrawing an ask", () => {
	test("its signal aborting resolves it withdrawn, releases the callback, and a late answer is stale", async () => {
		const rig = new DeskRig();
		const ask = rig.tool("Bash", BASH);
		const interaction = rig.only();
		ask.controller.abort();
		expect(await ask.promise).toEqual({ behavior: "deny", message: "The request was withdrawn." });
		expect(rig.resolved()).toEqual([{ interactionId: interaction.id, reason: "withdrawn" }]);
		expect(rig.pending()).toEqual([]);
		expect(rig.answer(interaction, ALLOW)).toMatchObject({ rejection: { code: "stale" } });
	});

	test("a signal that aborts after the answer adds nothing", async () => {
		const rig = new DeskRig();
		const ask = rig.tool("Bash", BASH);
		rig.answer(rig.only(), ALLOW);
		await ask.promise;
		ask.controller.abort();
		expect(rig.resolved()).toHaveLength(1);
	});

	test("a signal already aborted raises nothing", async () => {
		const rig = new DeskRig();
		const controller = new AbortController();
		controller.abort();
		const ask = rig.tool("Bash", BASH, {}, controller);
		expect(await ask.promise).toMatchObject({ behavior: "deny" });
		expect(rig.events()).toEqual([]);
	});

	test("the run's end withdraws that run's asks only", async () => {
		const rig = new DeskRig();
		const first = rig.tool("Bash", BASH);
		rig.runId = "run-2";
		const second = rig.tool("Bash", { command: "pwd" });
		rig.desk.withdrawRun("run-1");
		expect(await first.promise).toMatchObject({ behavior: "deny" });
		expect(await stillPending(second.promise)).toBe(true);
		expect(rig.resolved()).toEqual([{ interactionId: rig.requested()[0]?.id ?? "", reason: "withdrawn" }]);
		rig.desk.withdrawRun("run-1");
		expect(rig.resolved()).toHaveLength(1);
	});

	test("the process ending expires every ask and releases every callback", async () => {
		const rig = new DeskRig();
		const tool = rig.tool("Bash", BASH);
		const elicitation = rig.elicit({ serverName: "s", message: "m", mode: "form", requestedSchema: {} });
		rig.desk.expireAll();
		expect(await tool.promise).toMatchObject({ behavior: "deny" });
		expect(await elicitation.promise).toEqual({ action: "cancel" });
		expect(rig.resolved().map((entry) => entry.reason)).toEqual(["expired", "expired"]);
		rig.desk.expireAll();
		expect(rig.resolved()).toHaveLength(2);
	});
});

describe("a redelivered request id", () => {
	test("while pending is the same ask: one interaction, one promise, one answer", async () => {
		const rig = new DeskRig();
		const first = rig.tool("Bash", BASH, { requestId: "r-1" });
		const again = rig.tool("Bash", BASH, { requestId: "r-1" });
		expect(rig.requested()).toHaveLength(1);
		rig.answer(rig.only(), ALLOW);
		expect(await again.promise).toMatchObject({ behavior: "allow" });
		expect(await first.promise).toEqual(await again.promise);
	});

	test("after the human answered replays that answer without asking again", async () => {
		const rig = new DeskRig();
		const first = rig.tool("Bash", BASH, { requestId: "r-1" });
		rig.answer(rig.only(), DENY);
		const denied = await first.promise;
		const again = rig.tool("Bash", BASH, { requestId: "r-1" });
		expect(await again.promise).toEqual(denied);
		expect(rig.requested()).toHaveLength(1);
	});

	test("after the CLI withdrew it is a new ask", async () => {
		const rig = new DeskRig();
		const first = rig.tool("Bash", BASH, { requestId: "r-1" });
		first.controller.abort();
		await first.promise;
		rig.tool("Bash", BASH, { requestId: "r-1" });
		expect(rig.requested()).toHaveLength(2);
		expect(rig.pending()).toHaveLength(1);
	});

	test("elicitations are deduplicated the same way", async () => {
		const rig = new DeskRig();
		const request = { serverName: "s", message: "m", mode: "form", requestedSchema: {} } as const;
		const first = rig.elicit(request, "e-1");
		const again = rig.elicit(request, "e-1");
		expect(rig.requested()).toHaveLength(1);
		rig.answer(rig.only(), { kind: "confirm", confirmed: true });
		expect(await again.promise).toEqual({ action: "accept", content: {} });
		expect(await first.promise).toEqual({ action: "accept", content: {} });
	});
});

describe("stopping the run", () => {
	test("is asked of the host once, after the answer is given, and a host that fails does not fail the answer", async () => {
		const failing = new DeskRig({
			abortRun: async () => {
				throw new Error("cannot abort");
			},
		});
		const ask = failing.tool("Bash", BASH);
		expect(failing.answer(failing.only(), { kind: "cancel", stopRun: true })).toEqual({ status: "accepted" });
		expect(await ask.promise).toMatchObject({ behavior: "deny", interrupt: true });

		const throwing = new DeskRig({
			abortRun: () => {
				throw new Error("cannot abort");
			},
		});
		const other = throwing.tool("Bash", BASH);
		expect(throwing.answer(throwing.only(), { kind: "cancel", stopRun: true })).toEqual({ status: "accepted" });
		expect(await other.promise).toMatchObject({ behavior: "deny", interrupt: true });
	});

	test("a cancel that does not stop the run asks nothing of the host", async () => {
		const rig = new DeskRig();
		const ask = rig.tool("Bash", BASH);
		rig.answer(rig.only(), { kind: "cancel", stopRun: false });
		await ask.promise;
		expect(rig.aborts).toEqual([]);
	});
});
