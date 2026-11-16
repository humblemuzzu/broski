/**
 * A terminal's permission ask from the hook request to the adapter's watch-only session and back: the receiver holds
 * the session open as the core does, and a person's answer goes to that open session's `answer`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TerminalAskHandler } from "../../../backends/claude-code/ports/terminal";
import { CLAUDE_CODE_TRAITS } from "../../../backends/claude-code/traits";
import { humanDenial } from "../../../backends/claude-code/ui/denial";
import type {
	ActionResult,
	Interaction,
	InteractionAnswer,
	OpenResult,
	SessionSnapshot,
	SinkRecord,
} from "../../../contract";
import { streamViolations, unsettledParts } from "../../../contract/testing/stream-rules";
import { createTerminalHookReceiver } from "../../../server/cc-terminal-hook";
import { type ClaudeHome, createClaudeHome } from "../../helpers/claude-home";
import { assistant, prompt, text, toolResult, toolUse, turnDuration } from "./lines";
import { type TerminalRig, terminalRig } from "./rig";

let home: ClaudeHome;
let rig: TerminalRig;
let sessionId: string;
let transcript: string;
let handler: TerminalAskHandler | undefined;
let viewed: OpenResult | undefined;
let holdCount: number;
let watchedByAPhone: boolean;
let opens: OpenResult[];
let holds: string[];
const ids = { allow: "allow-once", deny: "deny-once", stop: "deny-and-stop" };

function append(...lines: object[]): void {
	for (const line of lines) appendFileSync(transcript, `${JSON.stringify(line)}\n`);
}

beforeEach(async () => {
	home = createClaudeHome({ git: false });
	sessionId = crypto.randomUUID();
	const dir = join(home.configDir, "projects", "-test-project");
	mkdirSync(dir, { recursive: true });
	transcript = join(dir, `${sessionId}.jsonl`);
	writeFileSync(transcript, "");
	append(prompt("earlier prompt"), assistant("msg_0", text("earlier answer"), { index: 0 }), turnDuration());
	const stale = new Date(Date.now() - 120_000);
	utimesSync(transcript, stale, stale);
	handler = undefined;
	viewed = undefined;
	holdCount = 0;
	watchedByAPhone = false;
	opens = [];
	holds = [];
	rig = terminalRig(home, { terminal: { hookAsks: (next) => (handler = next) } });
	await rig.watch.start();
});

afterEach(async () => {
	await rig.watch.dispose();
	home.cleanup();
});

function receiver() {
	const made = createTerminalHookReceiver({
		hold: async (ref) => {
			holds.push(`hold ${ref.sessionId}`);
			const now = viewed ?? (await openLikeTheBackend(ref.sessionId));
			if (viewed === undefined) {
				opens.push(now);
				if (now.status === "accepted") viewed = now;
			}
			holdCount += 1;
			return now;
		},
		release: (ref) => {
			holds.push(`release ${ref.sessionId}`);
			holdCount -= 1;
			if (holdCount === 0 && viewed?.status === "accepted" && !watchedByAPhone) {
				void viewed.session.close();
				viewed = undefined;
			}
		},
		log: () => undefined,
	});
	if (handler === undefined) throw new Error("the adapter gave no handler at start");
	made.setHandler(handler);
	return made;
}

/** `backend.ts`'s `openSession`: a session a terminal is writing opens watch-only, never resumed. */
async function openLikeTheBackend(id: string): Promise<OpenResult> {
	if (!rig.hosted.has(id) && (await rig.watch.writing(id))) return rig.open(id);
	throw new Error("the session would have been resumed in a host");
}

function ask(overrides: Record<string, unknown> = {}, signal?: AbortSignal): Request {
	return new Request("http://127.0.0.1/cc-terminal-hook", {
		method: "POST",
		body: JSON.stringify({
			hook_event_name: "PermissionRequest",
			session_id: sessionId,
			transcript_path: transcript,
			cwd: home.projectDir,
			tool_name: "Bash",
			tool_input: { command: "rm -rf build" },
			...overrides,
		}),
		...(signal && { signal }),
	});
}

function initialOf(): SessionSnapshot {
	const first = opens[0];
	if (first?.status !== "accepted") throw new Error("nothing was opened");
	return first.snapshot;
}

const requested = (records: readonly SinkRecord[]): Interaction[] =>
	records.flatMap((r) => (r.event.type === "interaction_requested" ? [r.event.interaction] : []));

async function pendingInteraction(count = 1): Promise<Interaction> {
	await rig.waitFor((records) => requested(records).length >= count, 5_000);
	const found = requested(rig.records)[count - 1];
	if (found === undefined) throw new Error("no interaction");
	return found;
}

/** The open the receiver's hold made, or the one a phone keeps: where the core sends a person's answer. */
async function answer(given: InteractionAnswer): Promise<ActionResult> {
	const open = viewed ?? opens.at(-1);
	if (open?.status !== "accepted" || open.session.answer === undefined)
		throw new Error("no open session takes answers");
	return open.session.answer(given);
}

const reply = (interaction: Interaction, optionId: string, message?: string): InteractionAnswer => ({
	interactionId: interaction.id,
	reply: { kind: "tool_permission", optionId, grantIds: [], ...(message !== undefined && { message }) },
});

async function body(response: Promise<Response>): Promise<unknown> {
	return (await response).json();
}

const types = (records: readonly SinkRecord[]) => records.map((record) => record.event.type);

describe("a terminal ask on a session the bridge only watches", () => {
	test("a stale-looking file still opens watch-only while the ask is pending, and the phone's allow is the hook's answer", async () => {
		const hook = receiver();
		expect(await rig.watch.writing(sessionId)).toBe(false);
		const response = hook.handle(ask());
		const interaction = await pendingInteraction();
		expect(holds).toEqual([`hold ${sessionId}`]);
		expect(interaction.request).toMatchObject({
			kind: "tool_permission",
			input: { command: "rm -rf build" },
			previews: [{ kind: "command", command: "rm -rf build" }],
			deliberate: false,
		});
		expect(interaction.request.kind === "tool_permission" && interaction.request.options.map((o) => o.id)).toEqual([
			ids.allow,
			ids.deny,
			ids.stop,
		]);
		expect(interaction.blocksRun).toBe(true);
		expect(interaction.runId).toBeDefined();
		expect(await answer(reply(interaction, ids.allow))).toEqual({ status: "accepted" });
		expect(await body(response)).toEqual({
			hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
		});
		expect(holds).toEqual([`hold ${sessionId}`, `release ${sessionId}`]);
		expect(types(rig.records)).toEqual(["run_started", "interaction_requested", "interaction_resolved"]);
		expect(rig.records.at(-1)?.event).toMatchObject({ type: "interaction_resolved", reason: "answered" });
		expect(streamViolations(rig.records, CLAUDE_CODE_TRAITS, initialOf())).toEqual([]);
	});

	test("the ask belongs to the tool call the tail saw start, and a deny carries the person's words", async () => {
		const hook = receiver();
		append(
			prompt("clean up"),
			assistant("msg_1", toolUse("toolu_77", "Bash", { command: "rm -rf build" }), { index: 0, stop: "tool_use" }),
		);
		const response = hook.handle(ask());
		const interaction = await pendingInteraction();
		expect(interaction.origin).toMatchObject({ toolCallId: "toolu_77", toolName: "Bash" });
		expect(await answer(reply(interaction, ids.deny, "not that directory"))).toEqual({
			status: "accepted",
		});
		expect(await body(response)).toEqual({
			hookSpecificOutput: {
				hookEventName: "PermissionRequest",
				decision: { behavior: "deny", message: humanDenial("not that directory") },
			},
		});
	});

	test("deny and stop interrupts; a cancel that does not stop the run leaves the decision to the terminal", async () => {
		const hook = receiver();
		const stop = hook.handle(ask());
		const first = await pendingInteraction(1);
		await answer(reply(first, ids.stop));
		expect(await body(stop)).toMatchObject({ hookSpecificOutput: { decision: { behavior: "deny", interrupt: true } } });

		const dismissed = hook.handle(ask());
		const second = await pendingInteraction(2);
		await answer({ interactionId: second.id, reply: { kind: "cancel", stopRun: false } });
		expect(await body(dismissed)).toEqual({});

		const stopped = hook.handle(ask());
		const third = await pendingInteraction(3);
		await answer({ interactionId: third.id, reply: { kind: "cancel", stopRun: true } });
		expect(await body(stopped)).toMatchObject({
			hookSpecificOutput: { decision: { behavior: "deny", interrupt: true } },
		});
	});

	test("an answer that is not a permission option is refused and the ask stays; once answered, a second answer is stale", async () => {
		const hook = receiver();
		const viewer = await rig.open(sessionId);
		viewed = viewer;
		watchedByAPhone = true;
		const response = hook.handle(ask());
		const interaction = await pendingInteraction();
		expect(await answer(reply(interaction, "make-it-so"))).toMatchObject({
			status: "rejected",
			rejection: { code: "invalid_input" },
		});
		expect(await answer({ interactionId: interaction.id, reply: { kind: "confirm", confirmed: true } })).toMatchObject({
			status: "rejected",
			rejection: { code: "invalid_input" },
		});
		expect(types(rig.records)).not.toContain("interaction_resolved");
		await answer(reply(interaction, ids.allow));
		await response;
		expect(viewer.status).toBe("accepted");
		expect(await answer(reply(interaction, ids.deny))).toMatchObject({
			status: "rejected",
			rejection: { code: "stale" },
		});
		expect(await answer({ ...reply(interaction, ids.deny), interactionId: "nope" })).toMatchObject({
			status: "rejected",
			rejection: { code: "stale" },
		});
	});

	test("the terminal's person answering first (the tool's result reaches the transcript) withdraws the ask", async () => {
		const hook = receiver();
		append(
			prompt("go"),
			assistant("msg_1", toolUse("toolu_5", "Bash", { command: "rm -rf build" }), { index: 0, stop: "tool_use" }),
		);
		const response = hook.handle(ask());
		const interaction = await pendingInteraction();
		append(toolResult("toolu_5", "removed"));
		expect(await body(response)).toEqual({});
		const kinds = types(rig.records);
		expect(kinds.indexOf("interaction_resolved")).toBeLessThan(kinds.indexOf("tool_finished"));
		expect(rig.records.find((r) => r.event.type === "interaction_resolved")?.event).toMatchObject({
			interactionId: interaction.id,
			reason: "withdrawn",
		});
		expect(await answer(reply(interaction, ids.allow))).toMatchObject({ status: "rejected" });
	});

	test("the terminal writes its tool call a moment after it asks: the ask is found to belong to it and goes with it", async () => {
		const hook = receiver();
		const response = hook.handle(
			ask({ tool_name: "Write", tool_input: { file_path: `${home.projectDir}/n.txt`, content: "x" } }),
		);
		const interaction = await pendingInteraction();
		expect(interaction.origin?.toolCallId).toBeUndefined();
		append(
			prompt("write it"),
			assistant("msg_1", toolUse("toolu_9", "Write", { file_path: "n.txt", content: "x" }), {
				index: 0,
				stop: "tool_use",
			}),
		);
		await rig.waitFor((records) => records.some((r) => r.event.type === "tool_started"));
		append(toolResult("toolu_9", "written"));
		expect(await body(response)).toEqual({});
		const kinds = types(rig.records);
		expect(kinds.indexOf("interaction_resolved")).toBeGreaterThan(kinds.indexOf("tool_started"));
		expect(kinds.indexOf("interaction_resolved")).toBeLessThan(kinds.indexOf("tool_finished"));
	});

	test("an ask after a turn the file never closed gets a run of its own, and the quiet rule never finishes a run that has an ask", async () => {
		const hook = receiver();
		viewed = await rig.open(sessionId);
		const start = viewed.status === "accepted" ? viewed.snapshot : undefined;
		if (start === undefined) throw new Error("open refused");
		watchedByAPhone = true;
		append(prompt("first"), assistant("msg_1", text("all done"), { index: 0 }));
		await rig.waitFor((records) => records.some((r) => r.event.type === "block_finished"));
		const response = hook.handle(ask());
		const interaction = await pendingInteraction();
		await Bun.sleep(700);
		expect(types(rig.records)).not.toContain("interaction_resolved");
		const runs = rig.records.flatMap((r) => (r.event.type === "run_started" ? [r.event.runId] : []));
		expect(runs).toHaveLength(2);
		expect(interaction.runId).toBe(runs[1]);
		expect(types(rig.records).filter((kind) => kind === "run_finished")).toHaveLength(1);
		await answer(reply(interaction, ids.allow));
		await response;
		expect(streamViolations(rig.records, CLAUDE_CODE_TRAITS, start)).toEqual([]);
	});

	test("a run that looks finished is not finished while an ask is on it", async () => {
		const hook = receiver();
		viewed = await rig.open(sessionId);
		watchedByAPhone = true;
		const response = hook.handle(ask());
		const interaction = await pendingInteraction();
		append(assistant("msg_7", text("that is all"), { index: 0 }));
		await rig.waitFor((records) => records.some((r) => r.event.type === "block_finished"));
		await Bun.sleep(700);
		expect(types(rig.records)).not.toContain("run_finished");
		await answer(reply(interaction, ids.deny));
		await response;
	});

	test("an Esc at the terminal ends the run, and the ask goes before the run does", async () => {
		const hook = receiver();
		append(
			prompt("go"),
			assistant("msg_1", toolUse("toolu_5", "Bash", { command: "rm -rf build" }), { index: 0, stop: "tool_use" }),
		);
		const response = hook.handle(ask());
		await pendingInteraction();
		append(prompt("[Request interrupted by user for tool use]"));
		expect(await body(response)).toEqual({});
		const kinds = types(rig.records);
		expect(kinds.indexOf("interaction_resolved")).toBeLessThan(kinds.indexOf("run_finished"));
		expect(streamViolations(rig.records, CLAUDE_CODE_TRAITS, initialOf())).toEqual([]);
		expect(unsettledParts(rig.records, initialOf())).toEqual([]);
	});

	test("the CLI dropping the request (its hook timeout) withdraws the ask and lets the session go", async () => {
		const hook = receiver();
		const gone = new AbortController();
		const response = hook.handle(ask({}, gone.signal));
		await pendingInteraction();
		gone.abort();
		expect(await body(response)).toEqual({});
		expect(rig.records.at(-1)?.event).toMatchObject({ type: "interaction_resolved", reason: "withdrawn" });
		expect(holds.at(-1)).toBe(`release ${sessionId}`);
	});

	test("a session the bridge hosts, and questions the phone cannot show, are not raised", async () => {
		const hook = receiver();
		rig.hosted.add(sessionId);
		expect(await body(hook.handle(ask()))).toEqual({});
		rig.hosted.delete(sessionId);
		const unshowable = ask({ tool_name: "AskUserQuestion", tool_input: { questions: "which?" } });
		expect(await body(hook.handle(unshowable))).toEqual({});
		expect(holds).toEqual([]);
		expect(rig.records).toEqual([]);
	});

	test("AskUserQuestion is a questions card, and the phone's answer is an allow carrying the answers", async () => {
		const hook = receiver();
		const questions = [{ question: "Which store?", options: [{ label: "SQLite" }, { label: "Redis" }] }];
		const response = hook.handle(ask({ tool_name: "AskUserQuestion", tool_input: { questions } }));
		const interaction = await pendingInteraction();
		expect(interaction.request).toMatchObject({
			kind: "questions",
			questions: [{ text: "Which store?", options: [{ label: "SQLite" }, { label: "Redis" }] }],
		});
		const answered = await answer({
			interactionId: interaction.id,
			reply: { kind: "questions", answers: [{ questionId: "0", selected: ["SQLite"] }] },
		});
		expect(answered.status).toBe("accepted");
		expect(await body(response)).toEqual({
			hookSpecificOutput: {
				hookEventName: "PermissionRequest",
				decision: { behavior: "allow", updatedInput: { questions, answers: { "Which store?": "SQLite" } } },
			},
		});
	});

	test("while an ask is pending the session reads as written, and when it ends it reads by its file again", async () => {
		const hook = receiver();
		const gone = new AbortController();
		const response = hook.handle(ask({}, gone.signal));
		await pendingInteraction();
		expect(await rig.watch.writing(sessionId)).toBe(true);
		gone.abort();
		await response;
		await rig.watch.dispose();
		expect(await rig.watch.writing(sessionId)).toBe(false);
	});

	test("two asks at once on one session, and two sessions, are raised and answered apart", async () => {
		const hook = receiver();
		const first = hook.handle(ask({ tool_input: { command: "one" } }));
		const second = hook.handle(ask({ tool_input: { command: "two" } }));
		const [a, b] = [await pendingInteraction(1), await pendingInteraction(2)];
		expect(a.id).not.toBe(b.id);
		await answer(reply(b, ids.deny));
		await answer(reply(a, ids.allow));
		expect(await body(first)).toMatchObject({ hookSpecificOutput: { decision: { behavior: "allow" } } });
		expect(await body(second)).toMatchObject({ hookSpecificOutput: { decision: { behavior: "deny" } } });
	});

	test("a phone already watching the session gets the ask on that open, and the open goes on after the ask", async () => {
		const hook = receiver();
		const watching = await rig.open(sessionId);
		viewed = watching;
		watchedByAPhone = true;
		expect(watching.status).toBe("accepted");
		const response = hook.handle(ask());
		const interaction = await pendingInteraction();
		await answer(reply(interaction, ids.allow));
		await response;
		if (watching.status !== "accepted") return;
		append(prompt("more"));
		await rig.waitFor((records) => records.some((r) => r.event.type === "user_message"));
		expect(watching.session.snapshot().interactions).toEqual([]);
	});

	test("a session the store does not know cannot be held, and nothing is raised", async () => {
		const hook = receiver();
		const missing = crypto.randomUUID();
		expect(await body(hook.handle(ask({ session_id: missing })))).toEqual({});
		expect(rig.records).toEqual([]);
	});
});
