/** The product's hardest rule: the bridge never answers for a human (PLAN D14). */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { captureProblems, DeskRig, stillPending, throwingLive } from "./desk-rig";

const UI_DIR = join(import.meta.dir, "../../../backends/claude-code/ui");

const SCHEMA = { type: "object", properties: { name: { type: "string" } } };
const NESTED = { type: "object", properties: { a: { type: "object", properties: {} } } };
const PLAN = { plan: "# Plan", planFilePath: "/p.md" };
const QUESTIONS = {
	questions: [{ question: "Which?", header: "H", multiSelect: false, options: [{ label: "A", description: "a" }] }],
};

function raiseOneOfEach(rig: DeskRig): Promise<unknown>[] {
	return [
		rig.tool("Bash", { command: "ls" }).promise,
		rig.tool(
			"Write",
			{ file_path: "a.txt", content: "x" },
			{ suggestions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }] },
		).promise,
		rig.tool("AskUserQuestion", QUESTIONS).promise,
		rig.tool("AskUserQuestion", { questions: [] }).promise,
		rig.tool("ExitPlanMode", PLAN).promise,
		rig.elicit({ serverName: "s", message: "form", mode: "form", requestedSchema: SCHEMA }).promise,
		rig.elicit({ serverName: "s", message: "empty", mode: "form", requestedSchema: {} }).promise,
		rig.elicit({ serverName: "s", message: "nested", mode: "form", requestedSchema: NESTED }).promise,
		rig.elicit({ serverName: "s", message: "url", mode: "url", url: "https://example.com/x", elicitationId: "e" })
			.promise,
		rig.elicit({ serverName: "s", message: "bad url", mode: "url", url: "file:///etc/passwd", elicitationId: "f" })
			.promise,
	];
}

describe("no ask ends without a human, the CLI or the process", () => {
	test("nothing the desk does on its own settles any kind of ask, however long it waits", async () => {
		const rig = new DeskRig();
		const promises = raiseOneOfEach(rig);
		expect(rig.requested()).toHaveLength(promises.length);
		for (const promise of promises) expect(await stillPending(promise, 20)).toBe(true);
		expect(rig.resolved()).toEqual([]);
		expect(rig.pending()).toHaveLength(promises.length);
	});

	test("answers that are wrong, unknown or for another kind leave every ask raised", async () => {
		const rig = new DeskRig();
		const promises = raiseOneOfEach(rig);
		for (const interaction of rig.requested()) {
			rig.answer(interaction, { kind: "text", text: "wrong kind" });
			rig.answer(interaction, { kind: "tool_permission", optionId: "nope", grantIds: [] });
		}
		rig.desk.answer({ interactionId: "unknown", reply: { kind: "cancel", stopRun: false } });
		rig.desk.withdrawRun("another-run");
		rig.desk.elicitationComplete("another-elicitation");
		for (const promise of promises) expect(await stillPending(promise)).toBe(true);
		expect(rig.resolved()).toEqual([]);
	});

	test.each([
		[
			"a person's cancel",
			(rig: DeskRig) => rig.requested().map((i) => rig.answer(i, { kind: "cancel", stopRun: false })),
			"answered",
		],
		["the run ending", (rig: DeskRig) => rig.desk.withdrawRun("run-1"), "withdrawn"],
		["the process ending", (rig: DeskRig) => rig.desk.expireAll(), "expired"],
	])("%s settles every kind, each exactly once", async (_name, end, reason) => {
		const rig = new DeskRig();
		const promises = raiseOneOfEach(rig);
		end(rig);
		await Promise.all(promises);
		expect(rig.resolved().map((entry) => entry.reason)).toEqual(promises.map(() => reason));
		expect(new Set(rig.resolved().map((entry) => entry.interactionId)).size).toBe(promises.length);
	});

	test("the CLI withdrawing each ask settles it withdrawn", async () => {
		const rig = new DeskRig();
		const controllers = [rig.tool("Bash", { command: "ls" }), rig.tool("ExitPlanMode", PLAN)];
		const elicitation = rig.elicit({ serverName: "s", message: "m", mode: "form", requestedSchema: SCHEMA });
		for (const ask of [...controllers, elicitation]) ask.controller.abort();
		await Promise.all([...controllers, elicitation].map((ask) => ask.promise));
		expect(rig.resolved().map((entry) => entry.reason)).toEqual(["withdrawn", "withdrawn", "withdrawn"]);
	});

	test("the desk's source holds no timer and no clock that could run out", () => {
		const forbidden = /setTimeout|setInterval|setImmediate|\.after\(|Bun\.sleep|AbortSignal\.timeout|queueMicrotask/;
		const offenders = readdirSync(UI_DIR)
			.filter((name) => name.endsWith(".ts"))
			.filter((name) => forbidden.test(readFileSync(join(UI_DIR, name), "utf8")));
		expect(offenders).toEqual([]);
	});

	test("the desk never hands the CLI a null, which would leave the tool blocked for good", async () => {
		const rig = new DeskRig();
		const promises = raiseOneOfEach(rig);
		rig.desk.expireAll();
		for (const result of await Promise.all(promises)) expect(result).not.toBeNull();
	});
});

describe("the desk's own code failing mid-callback", () => {
	test("an emit that throws leaves the ask raised and answerable, and says so", async () => {
		const quiet = captureProblems();
		const rig = new DeskRig();
		const emitting = throwingLive(rig, ["interaction_requested", "interaction_resolved"]);
		const failing = new DeskRig({ live: emitting });
		const ask = failing.tool("Bash", { command: "ls" });
		expect(await stillPending(ask.promise)).toBe(true);
		expect(emitting.snapshot().interactions).toHaveLength(1);
		const [interaction] = emitting.snapshot().interactions;
		if (!interaction) throw new Error("the ask is not in the snapshot");
		const answered = failing.desk.answer({
			interactionId: interaction.id,
			reply: { kind: "tool_permission", optionId: "deny_once", grantIds: [] },
		});
		expect(answered).toEqual({ status: "accepted" });
		expect(await ask.promise).toMatchObject({ behavior: "deny" });
		quiet.restore();
		expect(quiet.lines.join("")).toContain("[claude-code asks] interaction_requested: Error: the sink refused");
		expect(quiet.lines.join("")).toContain("[claude-code asks] interaction_resolved");
	});

	test("an input the builder cannot read still reaches a person as a plain allow or deny", async () => {
		const quiet = captureProblems();
		const rig = new DeskRig();
		const hostile = {
			get command(): string {
				throw new Error("unreadable input");
			},
		};
		const ask = rig.tool("Bash", hostile);
		const interaction = rig.only();
		expect(interaction.title).toBe("Allow Bash?");
		expect(interaction.request).toMatchObject({ kind: "tool_permission", deliberate: true, previews: [] });
		expect(await stillPending(ask.promise)).toBe(true);
		rig.answer(interaction, { kind: "tool_permission", optionId: "allow_once", grantIds: [] });
		expect(await ask.promise).toEqual({ behavior: "allow", updatedInput: hostile });
		quiet.restore();
		expect(quiet.lines.join("")).toContain("Bash ask: Error: unreadable input");
	});

	test("a callback that cannot raise anything at all waits for the CLI to withdraw it, and answers nothing before", async () => {
		const quiet = captureProblems();
		const rig = new DeskRig({
			now: () => {
				throw new Error("no clock");
			},
		});
		const tool = rig.tool("Bash", { command: "ls" });
		const elicitation = rig.elicit({ serverName: "s", message: "m", mode: "form", requestedSchema: SCHEMA });
		expect(await stillPending(tool.promise, 20)).toBe(true);
		expect(await stillPending(elicitation.promise, 20)).toBe(true);
		expect(rig.events()).toEqual([]);
		tool.controller.abort();
		elicitation.controller.abort();
		expect(await tool.promise).toMatchObject({ behavior: "deny" });
		expect(await elicitation.promise).toEqual({ action: "cancel" });
		quiet.restore();
		expect(quiet.lines.join("")).toContain("canUseTool: Error: no clock");
		expect(quiet.lines.join("")).toContain("onElicitation: Error: no clock");
	});
});
