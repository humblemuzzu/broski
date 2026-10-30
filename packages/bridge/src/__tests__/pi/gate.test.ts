/**
 * The permission gate (D14) on a real Pi session with the faux provider: a `tool_call` waits for a
 * human when the `permissions` mode is `ask`, is blocked or allowed by the answer, and never answers itself.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { Interaction, MAX_TEXT_CHARS } from "../../contract";
import { pause } from "./desk_rig";
import { allow, permissionOf, prompt, readsReadme } from "./gate_kit";
import { useWatchdog } from "./helpers/use-watchdog";
import { createRig, type Rig, toolCall, toolCalls } from "./ui_rig";

useWatchdog();

let rig: Rig | undefined;

afterEach(async () => {
	expect(rig?.log.invalid ?? []).toEqual([]);
	await rig?.dispose();
	rig = undefined;
});

async function askingRig(): Promise<Rig> {
	rig = await createRig({ mode: "ask" });
	await rig.bind();
	return rig;
}

describe("a tool call under ask", () => {
	test("raises a tool_permission after the tool started, naming the run, the call and what it touches", async () => {
		const r = await askingRig();
		readsReadme(r, fauxAssistantMessage("done"));
		const run = prompt(r);
		const { interaction } = await r.log.next("interaction_requested");
		const start = r.starts[0];
		expect(start?.toolName).toBe("read");
		expect(interaction).toMatchObject({
			runId: r.currentRun()?.runId,
			blocksRun: true,
			title: "Allow read?",
			origin: { toolName: "read", toolCallId: r.currentRun()?.tools.find(start?.toolCallId ?? "") },
			request: {
				kind: "tool_permission",
				inputEditable: true,
				deliberate: false,
				grants: [],
			},
		});
		expect(interaction.request).not.toHaveProperty("defaultOptionId");
		expect(interaction.request).not.toHaveProperty("reason");
		expect(interaction.origin?.toolCallId).toBeDefined();
		expect(interaction.origin).not.toHaveProperty("parentToolCallId");
		expect(interaction).not.toHaveProperty("expiresAt");
		const request = permissionOf(interaction.request);
		expect(request.input).toEqual({ path: "README.md" });
		expect(request.previews).toEqual([{ kind: "paths", paths: ["README.md"] }]);
		expect(
			request.options.map((option) => [option.id, option.effect, option.scope, option.stopsRun, option.message]),
		).toEqual([
			["allow_once", "allow", "once", false, "none"],
			["allow_session", "allow", "session", false, "none"],
			["deny", "deny", "once", false, "optional"],
			["deny_stop", "deny", "once", true, "none"],
		]);
		const trace = r.log.trace;
		expect(trace.indexOf("session:tool_execution_start")).toBeLessThan(trace.indexOf("live:interaction_requested"));
		r.desk.answer({ interactionId: interaction.id, reply: allow() });
		await run;
	});

	test("a bash call shows its command and the directory it runs in", async () => {
		const r = await askingRig();
		r.faux.handle.setResponses([toolCall("bash", { command: "echo hi" }), fauxAssistantMessage("done")]);
		const run = prompt(r);
		const { interaction } = await r.log.next("interaction_requested");
		expect(permissionOf(interaction.request).previews).toEqual([
			{ kind: "command", command: "echo hi", cwd: r.env.cwd },
		]);
		r.desk.answer({ interactionId: interaction.id, reply: allow() });
		await run;
		expect(r.toolResults()[0]).toMatchObject({ toolName: "bash", isError: false });
		expect(r.toolResults()[0]?.text).toContain("hi");
	});

	test("a command past the contract's bounds is shown cut, says so, cannot be edited and has no one-tap answer", async () => {
		const r = await askingRig();
		const command = `echo ${"x".repeat(MAX_TEXT_CHARS + 500)}`;
		r.faux.handle.setResponses([toolCall("bash", { command }), fauxAssistantMessage("done")]);
		const run = prompt(r);
		const { interaction } = await r.log.next("interaction_requested");
		const request = permissionOf(interaction.request);
		const shown = request.previews[0]?.kind === "command" ? request.previews[0].command : "";
		expect(shown.length).toBe(MAX_TEXT_CHARS);
		expect(shown.startsWith(command.slice(0, MAX_TEXT_CHARS - 100))).toBe(true);
		expect(shown.endsWith("more characters not shown]")).toBe(true);
		expect(request).toMatchObject({ inputEditable: false, deliberate: true });
		expect(request.reason).toContain("only its start is shown");
		expect(JSON.stringify(request.input).length).toBeLessThan(MAX_TEXT_CHARS + 100);
		expect(Interaction.safeParse(interaction).success).toBe(true);
		r.desk.answer({ interactionId: interaction.id, reply: allow("deny") });
		await run;
	});

	test("what could hide part of a command is written out where the human reads it", async () => {
		const r = await askingRig();
		const command = "echo safe\r\u001b[2Krm -rf ~ \u202e gnp.exe";
		r.faux.handle.setResponses([toolCall("bash", { command }), fauxAssistantMessage("done")]);
		const run = prompt(r);
		const { interaction } = await r.log.next("interaction_requested");
		const request = permissionOf(interaction.request);
		expect(request.previews[0]).toMatchObject({
			kind: "command",
			command: "echo safe\\u{D}\\u{1B}[2Krm -rf ~ \\u{202E} gnp.exe",
		});
		r.desk.answer({ interactionId: interaction.id, reply: allow("deny") });
		await run;
	});

	test("allow once runs the tool, resolves answered, and the next call asks again", async () => {
		const r = await askingRig();
		r.faux.handle.setResponses([
			toolCall("read", { path: "README.md" }),
			toolCall("read", { path: "README.md" }),
			fauxAssistantMessage("done"),
		]);
		const run = prompt(r);
		for (let i = 0; i < 2; i++) {
			const { interaction } = await r.log.next("interaction_requested");
			expect(r.desk.answer({ interactionId: interaction.id, reply: allow() })).toEqual({ status: "accepted" });
		}
		await run;
		expect(r.log.of("interaction_resolved").map((event) => event.reason)).toEqual(["answered", "answered"]);
		expect(r.toolResults().map((result) => result.isError)).toEqual([false, false]);
		expect(r.toolResults()[0]?.text).toContain("A file the tests point at");
		expect(r.pending()).toEqual([]);
	});

	test("two calls in one response are asked one at a time, in order", async () => {
		const r = await askingRig();
		r.faux.handle.setResponses([
			toolCalls(["read", { path: "README.md" }], ["bash", { command: "true" }]),
			fauxAssistantMessage("done"),
		]);
		const run = prompt(r);
		const first = await r.log.next("interaction_requested");
		expect(first.interaction.origin?.toolName).toBe("read");
		await pause(40);
		expect(r.log.of("interaction_requested")).toHaveLength(1);
		r.desk.answer({ interactionId: first.interaction.id, reply: allow() });
		const second = await r.log.next("interaction_requested");
		expect(second.interaction.origin?.toolName).toBe("bash");
		r.desk.answer({ interactionId: second.interaction.id, reply: allow("deny") });
		await run;
		expect(r.toolResults().map((result) => [result.toolName, result.isError])).toEqual([
			["read", false],
			["bash", true],
		]);
	});

	test("allow for the session lets the same tool through without asking, for the session only", async () => {
		const r = await askingRig();
		r.faux.handle.setResponses([
			toolCall("read", { path: "README.md" }),
			toolCall("read", { path: "README.md" }),
			toolCall("bash", { command: "true" }),
			fauxAssistantMessage("done"),
		]);
		const run = prompt(r);
		const first = await r.log.next("interaction_requested");
		r.desk.answer({ interactionId: first.interaction.id, reply: allow("allow_session") });
		const second = await r.log.next("interaction_requested");
		expect(second.interaction.origin?.toolName).toBe("bash");
		r.desk.answer({ interactionId: second.interaction.id, reply: allow() });
		await run;
		expect(r.log.of("interaction_requested")).toHaveLength(2);
		expect(r.toolResults().map((result) => result.toolName)).toEqual(["read", "read", "bash"]);
	});

	test("deny blocks the call with the human's words, records it as denied, and the run goes on", async () => {
		const r = await askingRig();
		readsReadme(r, fauxAssistantMessage("understood"));
		const run = prompt(r);
		const { interaction } = await r.log.next("interaction_requested");
		r.desk.answer({ interactionId: interaction.id, reply: allow("deny", { message: "Not that file." }) });
		await run;
		expect(r.toolResults()).toEqual([{ toolName: "read", isError: true, text: "Not that file." }]);
		expect(r.denied).toEqual([r.starts[0]?.toolCallId ?? ""]);
		expect(r.log.of("run_finished")[0]?.outcome).toEqual({ kind: "completed" });
		expect(r.aborts.count).toBe(0);
	});

	test("deny with no words gives the model a plain reason", async () => {
		const r = await askingRig();
		readsReadme(r, fauxAssistantMessage("ok"));
		const run = prompt(r);
		const { interaction } = await r.log.next("interaction_requested");
		r.desk.answer({ interactionId: interaction.id, reply: allow("deny", { message: "   " }) });
		await run;
		expect(r.toolResults()).toEqual([{ toolName: "read", isError: true, text: "The user denied this tool call." }]);
	});

	test("deny and stop blocks the call and aborts the run", async () => {
		const r = await askingRig();
		readsReadme(r, fauxAssistantMessage("never"));
		const run = prompt(r);
		const { interaction } = await r.log.next("interaction_requested");
		r.desk.answer({ interactionId: interaction.id, reply: allow("deny_stop") });
		await run;
		expect((await r.log.next("run_finished")).outcome).toEqual({ kind: "aborted" });
		expect(r.aborts.count).toBe(1);
		expect(r.log.of("interaction_resolved").map((event) => event.reason)).toEqual(["answered"]);
		expect(r.toolResults().every((result) => result.isError)).toBe(true);
	});

	test("a cancel that continues blocks only the call; one that stops aborts the run (once, from the desk)", async () => {
		const r = await askingRig();
		readsReadme(r, fauxAssistantMessage("fine"));
		const run = prompt(r);
		const first = await r.log.next("interaction_requested");
		r.desk.answer({ interactionId: first.interaction.id, reply: { kind: "cancel", stopRun: false } });
		await run;
		expect(r.toolResults()).toEqual([
			{ toolName: "read", isError: true, text: "The user dismissed the permission request." },
		]);
		expect((await r.log.next("run_finished")).outcome).toEqual({ kind: "completed" });

		readsReadme(r, fauxAssistantMessage("never"));
		const second = prompt(r);
		const asked = await r.log.next("interaction_requested");
		r.desk.answer({ interactionId: asked.interaction.id, reply: { kind: "cancel", stopRun: true, message: "Stop." } });
		await second;
		expect((await r.log.next("run_finished")).outcome).toEqual({ kind: "aborted" });
		expect(r.aborts.count).toBe(1);
		expect(r.log.of("interaction_resolved").map((event) => event.reason)).toEqual(["answered", "answered"]);
	});

	test("an answer for another option or a second answer is refused; the first answer wins", async () => {
		const r = await askingRig();
		readsReadme(r, fauxAssistantMessage("done"));
		const run = prompt(r);
		const { interaction } = await r.log.next("interaction_requested");
		const unknownOption = r.desk.answer({ interactionId: interaction.id, reply: allow("allow_always") });
		const withMessage = r.desk.answer({ interactionId: interaction.id, reply: allow("allow_once", { message: "hi" }) });
		expect(unknownOption).toMatchObject({ rejection: { code: "invalid_input" } });
		expect(withMessage).toMatchObject({ rejection: { code: "invalid_input" } });
		expect(r.pending()).toHaveLength(1);
		expect(r.desk.answer({ interactionId: interaction.id, reply: allow() })).toEqual({ status: "accepted" });
		expect(r.desk.answer({ interactionId: interaction.id, reply: allow("deny") })).toMatchObject({
			rejection: { code: "stale" },
		});
		await run;
		expect(r.toolResults()[0]?.isError).toBe(false);
	});
});

describe("abort and shutdown while a call waits", () => {
	test("Pi's abort alone settles the run: the gate withdraws itself on the agent's signal", async () => {
		const r = await askingRig();
		readsReadme(r, fauxAssistantMessage("never"));
		const run = prompt(r);
		const { interaction } = await r.log.next("interaction_requested");
		await r.session.abort();
		await run;
		const resolved = await r.log.next("interaction_resolved");
		expect(resolved).toEqual({ type: "interaction_resolved", interactionId: interaction.id, reason: "withdrawn" });
		expect((await r.log.next("run_finished")).outcome).toEqual({ kind: "aborted" });
		expect(r.denied).toEqual([]);
		expect(r.pending()).toEqual([]);
	});

	test("the adapter's abort (withdraw the run's asks, then abort) settles it too", async () => {
		const r = await askingRig();
		readsReadme(r, fauxAssistantMessage("never"));
		const run = prompt(r);
		const { interaction } = await r.log.next("interaction_requested");
		await r.abort();
		await run;
		expect((await r.log.next("interaction_resolved")).interactionId).toBe(interaction.id);
		expect(r.log.of("interaction_resolved")).toHaveLength(1);
		expect((await r.log.next("run_finished")).outcome).toEqual({ kind: "aborted" });
	});

	test("an ask expired at shutdown blocks the call, and a call after it is blocked at once with no ask", async () => {
		const r = await askingRig();
		readsReadme(r, fauxAssistantMessage("done"));
		const run = prompt(r);
		await r.log.next("interaction_requested");
		r.desk.expireAll();
		await run;
		expect(r.log.of("interaction_resolved").map((event) => event.reason)).toEqual(["expired"]);
		expect(r.toolResults()).toEqual([
			{ toolName: "read", isError: true, text: "The permission request ended before it was answered." },
		]);

		readsReadme(r, fauxAssistantMessage("done"));
		await prompt(r);
		expect(r.log.of("interaction_requested")).toHaveLength(1);
		expect(r.toolResults().at(-1)).toMatchObject({
			isError: true,
			text: "The permission request ended before it was answered.",
		});
	});
});

describe("when the gate does not ask, and when it cannot", () => {
	test("under off the call runs and nothing is asked; the mode is read at every call", async () => {
		const r = await askingRig();
		r.mode.value = "off";
		r.faux.handle.setResponses([
			toolCall("read", { path: "README.md" }),
			toolCall("read", { path: "README.md" }),
			fauxAssistantMessage("done"),
		]);
		const run = prompt(r);
		await r.log.next("run_started");
		r.mode.value = "off";
		await run;
		expect(r.log.of("interaction_requested")).toEqual([]);
		expect(r.toolResults().map((result) => result.isError)).toEqual([false, false]);

		r.mode.value = "ask";
		readsReadme(r, fauxAssistantMessage("done"));
		const asked = prompt(r);
		const { interaction } = await r.log.next("interaction_requested");
		r.desk.answer({ interactionId: interaction.id, reply: allow() });
		await asked;
	});

	test("a fault inside the gate blocks the call with a plain reason and throws nothing", async () => {
		rig = await createRig({
			gateHost: {
				permissions: () => {
					throw new Error("secret internal detail");
				},
				allowed: () => false,
				allowForSession: () => {},
			},
		});
		await rig.bind();
		readsReadme(rig, fauxAssistantMessage("done"));
		await prompt(rig);
		expect(rig.toolResults()).toEqual([
			{ toolName: "read", isError: true, text: "The permission check failed, so the tool call was blocked." },
		]);
		expect(rig.log.of("interaction_requested")).toEqual([]);
		expect(rig.log.of("notice")).toEqual([
			{ type: "notice", level: "error", text: "The permission check failed: secret internal detail" },
		]);
	});
});
