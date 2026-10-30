/**
 * `!command` and `!!command` on real Pi sessions: the output streams as one `bash` tool call of a run, Stop ends the
 * command alone, and the session holds the same `bashExecution` record the terminal's `executeBash` leaves.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { BackendCallResult, ToolFinishedEvent } from "../../contract";
import type { LiveSession } from "../../contract/testing/conformance-harness";
import { LiveRig } from "./helpers/live-rig";
import { callPi } from "./helpers/pi-calls";
import { say } from "./helpers/scenarios";
import { conversation, sessionEntries, writeSessionFile } from "./helpers/session-files";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

function runShell(
	rig: LiveRig,
	live: LiveSession,
	command: string,
	options: { excludeFromContext?: boolean; clientRequestId?: string } = {},
): Promise<BackendCallResult> {
	return callPi(rig.backend, {
		kind: "run_shell",
		sessionId: live.ref.sessionId,
		clientRequestId: options.clientRequestId ?? crypto.randomUUID(),
		command,
		excludeFromContext: options.excludeFromContext ?? false,
	});
}

/** Runs a command to its end and returns the events of its run. */
async function shellRun(rig: LiveRig, live: LiveSession, command: string, excludeFromContext = false) {
	const mark = live.events().length;
	const answer = await runShell(rig, live, command, { excludeFromContext });
	expect(answer).toEqual({ status: "accepted", result: { kind: "run_shell" } });
	const { outcome } = await live.runAfter(mark);
	return { outcome, events: live.events().slice(mark) };
}

function recorded(rig: LiveRig, live: LiveSession) {
	return sessionEntries(rig.fileOf(live.ref)).flatMap((entry) =>
		entry.type === "message" && entry.message.role === "bashExecution" ? [entry.message] : [],
	);
}

function finishedOf(events: readonly { type: string }[]): ToolFinishedEvent {
	const finished = events.find((event): event is ToolFinishedEvent => event.type === "tool_finished");
	if (finished === undefined) throw new Error("no tool finished");
	return finished;
}

describe("a command typed with !", () => {
	test("is a run with one bash tool call: its output streams, it finishes with the exit code, and the stream is valid", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const { outcome, events } = await shellRun(t, live, "echo first; sleep 0.15; echo second");
		expect(outcome).toEqual({ kind: "completed" });
		expect(
			events.map((event) => event.type).filter((type) => type !== "tool_updated" && type !== "usage_updated"),
		).toEqual(["run_started", "tool_started", "tool_finished", "run_finished"]);
		expect(events[0]).toMatchObject({ type: "run_started", trigger: "prompt" });
		expect(events[1]).toMatchObject({
			type: "tool_started",
			name: "bash",
			input: { command: "echo first; sleep 0.15; echo second" },
		});
		const streamed = events
			.flatMap((event) =>
				event.type === "tool_updated" && event.update.kind === "output_appended" ? [event.update.text] : [],
			)
			.join("");
		expect(streamed).toBe("first\nsecond\n");
		expect(events.filter((event) => event.type === "tool_updated").length).toBeGreaterThanOrEqual(2);
		expect(finishedOf(events)).toMatchObject({
			outcome: "completed",
			result: { content: [{ kind: "text", text: "first\nsecond\n" }], exitCode: 0 },
		});
		live.assertSettled();
	});

	test("is recorded in the session as the terminal records it, and the transcript shows the same card", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		await shellRun(t, live, "echo hi; exit 3");
		const [message] = recorded(t, live);
		expect(message).toMatchObject({
			role: "bashExecution",
			command: "echo hi; exit 3",
			output: "hi\n",
			exitCode: 3,
			cancelled: false,
			truncated: false,
		});
		expect(message?.excludeFromContext).toBe(false);
		const page = await t.backend.readTranscript(live.ref, { limit: 10 });
		if (page.status !== "accepted") throw new Error("no transcript");
		const [result, call] = page.page.items;
		expect(call).toMatchObject({ kind: "tool_call", name: "bash", input: { command: "echo hi; exit 3" } });
		expect(result).toMatchObject({
			kind: "tool_result",
			outcome: "failed",
			result: { content: [{ kind: "text", text: "hi\n" }], exitCode: 3, error: "Command exited with code 3" },
		});
	});

	test("reaches the model on the next prompt: the output is in its context", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		await shellRun(t, live, "echo marker-visible");
		t.router.script(live.ref.sessionId, [say("seen")]);
		await live.run("what was printed?");
		const request = t.router.requests(live.ref.sessionId).at(-1);
		expect(JSON.stringify(request?.messages)).toContain("marker-visible");
	});
});

describe("a command typed with !!", () => {
	test("is recorded as excluded from context, and the model is never sent its output", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const { events } = await shellRun(t, live, "echo marker-hidden", true);
		expect(events.find((event) => event.type === "tool_started")).toMatchObject({
			input: { command: "echo marker-hidden", excludeFromContext: true },
		});
		expect(recorded(t, live)[0]).toMatchObject({ output: "marker-hidden\n", excludeFromContext: true });
		t.router.script(live.ref.sessionId, [say("nothing seen")]);
		await live.run("what was printed?");
		const request = t.router.requests(live.ref.sessionId).at(-1);
		expect(JSON.stringify(request?.messages)).not.toContain("marker-hidden");
	});
});

describe("an extension's user_bash handler", () => {
	test("that answers with a result has it recorded as if the command ran, as the terminal does, and nothing is executed", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const { events } = await shellRun(t, live, "drv-result");
		expect(finishedOf(events)).toMatchObject({
			outcome: "completed",
			result: { content: [{ kind: "text", text: "from the extension" }], exitCode: 0 },
		});
		expect(recorded(t, live)[0]).toMatchObject({ command: "drv-result", output: "from the extension", exitCode: 0 });
	});
});

describe("Stop during a command", () => {
	test("ends the command alone: the tool and the run end aborted, the record says cancelled, the session takes prompts again", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const mark = live.events().length;
		await runShell(t, live, "echo begun; sleep 30");
		await live.waitFor("tool_updated", () => true, mark);
		expect((await live.control.abort()).status).toBe("accepted");
		const { outcome } = await live.runAfter(mark);
		expect(outcome).toEqual({ kind: "aborted" });
		expect(finishedOf(live.events().slice(mark))).toMatchObject({ outcome: "aborted" });
		expect(recorded(t, live)[0]).toMatchObject({ cancelled: true });
		expect(
			live
				.events()
				.slice(mark)
				.some((event) => event.type === "queue_changed" || event.type === "input_returned"),
		).toBe(false);
		live.assertSettled();
		t.router.script(live.ref.sessionId, [say("alive")]);
		expect((await live.run("still there?")).outcome.kind).toBe("completed");
	});
});

describe("what a command cannot do", () => {
	test("run beside another command, a run, or a prompt", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const mark = live.events().length;
		await runShell(t, live, "sleep 30");
		await live.waitFor("tool_started", () => true, mark);
		expect(await runShell(t, live, "echo second")).toMatchObject({ status: "rejected", rejection: { code: "busy" } });
		for (const mode of ["start", "steer", "queue"] as const) {
			expect(await live.prompt("hello", mode)).toMatchObject({ status: "rejected", rejection: { code: "busy" } });
		}
		await live.control.abort();
		await live.runAfter(mark);

		await t.rig.arrange(live.ref, { kind: "hold" });
		await live.prompt("hold on");
		await live.waitFor("tool_started", (event) => event.name === "driver_hold");
		expect(await runShell(t, live, "echo during")).toMatchObject({ status: "rejected", rejection: { code: "busy" } });
		await live.control.abort();
	});

	test("be blank, or be run in a session this bridge does not run, or in none", async () => {
		const rig = await LiveRig.create();
		t = rig;
		const live = await rig.rig.openNew();
		expect(await runShell(rig, live, "   ")).toMatchObject({
			status: "rejected",
			rejection: { code: "invalid_input" },
		});
		writeSessionFile(
			rig.world.sessionsRoot,
			{ id: "terminal-made", cwd: rig.cwd, version: 3 },
			conversation(["a", "b"]),
		);
		const elsewhere = (sessionId: string) =>
			callPi(rig.backend, {
				kind: "run_shell",
				sessionId,
				clientRequestId: crypto.randomUUID(),
				command: "true",
				excludeFromContext: false,
			});
		expect(await elsewhere("terminal-made")).toMatchObject({ status: "rejected", rejection: { code: "unsupported" } });
		expect(await elsewhere("nobody")).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
		expect(recorded(rig, live)).toEqual([]);
	});

	test("run twice for one client request", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const clientRequestId = crypto.randomUUID();
		const mark = live.events().length;
		const first = await runShell(t, live, "echo once", { clientRequestId });
		await live.runAfter(mark);
		const second = await runShell(t, live, "echo once", { clientRequestId });
		expect(second).toEqual(first);
		expect(recorded(t, live)).toHaveLength(1);
		expect(live.events().filter((event) => event.type === "run_started")).toHaveLength(1);
	});
});

describe("output without end", () => {
	test("reaches the phone in a few pieces whatever the command prints, and the card keeps the end of it", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const { events } = await shellRun(t, live, "yes line | head -n 200000");
		const pieces = events.filter((event) => event.type === "tool_updated");
		expect(pieces.length).toBeGreaterThan(0);
		expect(pieces.length).toBeLessThan(400);
		expect(recorded(t, live)[0]?.truncated).toBe(true);
		expect(finishedOf(events).result.content[0]).toMatchObject({ kind: "text" });
		live.assertSettled();
	});
});
