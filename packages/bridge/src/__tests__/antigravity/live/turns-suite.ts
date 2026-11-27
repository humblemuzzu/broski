/**
 * Turns on the real `agy`, in one session in agy's asking mode: a turn of tool calls (two commands, a write, an edit,
 * a read and a read that fails), with the permissions agy asks for allowed or denied and a second prompt refused while
 * it runs; a turn stopped mid-stream and the one after it; the token counts of two like turns as agy reports them; a
 * thinking turn, at the cheap model's highest level; an image the model is shown; and the session's settings changed.
 * What agy asks before a tool is its permission policy's to say (`policy.ts`; the live profile has agy's default): a
 * tool it runs unasked is checked on the wire to have had no `session/request_permission`, and the log says which way
 * each went. Seven prompts.
 */

import { afterAll, beforeAll, describe, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentEvent, Interaction, PermissionPreview, ToolResult } from "../../../contract";
import { allTranscript } from "../../../contract/testing/conformance-reads";
import { eventually } from "../../helpers/workspace-rig";
import { testMs } from "./gate";
import { liveTest } from "./live-test";
import { pngAttachment } from "./png";
import { changedFile, describeTool, permissionsAsked, ranUnasked, type WireTool } from "./policy";
import {
	answerText,
	blockTexts,
	commandOf,
	input,
	OK_PROMPT,
	permissionReply,
	run,
	runAnswering,
	THINK_ANSWER,
	THINK_PROMPT,
} from "./runs";
import { usageReport } from "./usage-report";
import { type Frame, paramsOf, updateOf } from "./wire-log";
import { AgyWorld } from "./world";

const TOOLS_PROMPT = [
	"Use your tools for each of these steps, in order, one tool call per step:",
	"1. Run the shell command `echo broski`.",
	"2. Create the file notes.txt containing exactly: one",
	"3. Edit notes.txt, replacing one with two.",
	"4. Read notes.txt.",
	"5. Read the file missing.txt, which does not exist.",
	"6. Run the shell command `touch denied.txt`.",
	"Then reply with exactly: done",
].join("\n");
const COUNT_PROMPT = "Write every whole number from 1 to 400, one per line, and nothing else.";
const IMAGE_PROMPT = "What colour is this image? Reply with one word.";
const ABORT_WITHIN_MS = 3_000;

export function turnsSuite(): void {
	describe("turns of one session", () => {
		let world: AgyWorld;

		beforeAll(() => {
			world = AgyWorld.create({ label: "turns" });
		});
		afterAll(async () => {
			await world?.dispose();
			expect(world?.faults ?? []).toEqual([]);
		});

		liveTest(
			"a turn of tools shows each call and asks for what agy's own policy asks about; a second prompt is refused meanwhile",
			async () => {
				const { live } = await world.shared();
				const { sessionId } = live.ref;
				const prompts = () => world.tap.exchanges("session/prompt", sessionId).length;
				const before = prompts();
				const decide = (interaction: Interaction) =>
					permissionReply(interaction, commandOf(interaction)?.includes("denied.txt") ? "deny" : "allow");
				const mark = live.recorder.items.length;
				const turn = runAnswering(live, input(TOOLS_PROMPT), decide);
				await live.waitFor("run_started", () => true, mark);
				const second = await live.control.prompt(input(OK_PROMPT));
				expect(second).toMatchObject({ status: "rejected", rejection: { code: "busy" } });
				const { outcome, events, asks } = await turn;
				expect(outcome).toEqual({ kind: "completed" });
				expect(prompts() - before).toBe(1);
				expectPermissions(world, sessionId, asks);
				expect(readFileSync(join(world.cwd, "notes.txt"), "utf8").trim()).toBe("two");

				const tools = toolsOf(events);
				console.log(
					`tools: ${[...tools.values()].map((tool) => `${tool.name}(${tool.title ?? ""}) ${tool.outcome}`).join("; ")}`,
				);
				const command = [...tools.values()].find(
					(tool) => tool.name === "run_command" && tool.title?.includes("echo broski"),
				);
				expect(command).toMatchObject({ outcome: "completed", result: { exitCode: 0 } });
				expect(command?.result?.content.some((part) => part.kind === "text" && part.text.includes("broski"))).toBe(
					true,
				);
				const changes = [...tools.values()].flatMap((tool) => tool.result?.fileChanges ?? []);
				expect(changes.some((change) => change.path.endsWith("notes.txt") && change.change === "added")).toBe(true);
				expect(changes.some((change) => change.path.endsWith("notes.txt") && change.diff?.includes("+two"))).toBe(true);
				expect([...tools.values()].some((tool) => tool.name === "read_file" && tool.title === "notes.txt")).toBe(true);
				expect([...tools.values()].some((tool) => tool.outcome === "failed")).toBe(true);
				live.assertSettled();
			},
			testMs(1),
		);

		liveTest(
			"a stopped turn ends aborted at once with what agy streamed after the cancel, and the next turn runs",
			async () => {
				const { live } = await world.shared();
				const mark = live.recorder.items.length;
				expect(await live.control.prompt(input(COUNT_PROMPT))).toMatchObject({ status: "accepted" });
				const { runId } = await live.waitFor("run_started", () => true, mark);
				await live.waitFor("block_delta", () => true, mark);
				const stopped = live.recorder.items.length;
				const asked = performance.now();
				expect(await live.control.abort()).toEqual({ status: "accepted" });
				const finished = await live.waitFor("run_finished", (event) => event.runId === runId, mark);
				const took = performance.now() - asked;
				expect(finished.outcome).toEqual({ kind: "aborted" });
				const deltas = live
					.events()
					.slice(stopped)
					.filter((event) => event.type === "block_delta").length;
				const buffered = chunksAfterCancel(world, live.ref.sessionId);
				console.log(
					`aborted in ${Math.round(took)} ms; agy sent ${buffered} chunks after the cancel, the run took ${deltas}`,
				);
				expect(took).toBeLessThan(ABORT_WITHIN_MS);
				expect(deltas).toBeGreaterThanOrEqual(buffered);
				live.assertSettled();

				const next = await run(live, OK_PROMPT);
				expect(next.outcome).toEqual({ kind: "completed" });
				expect(answerText(next.events).toLowerCase()).toContain("ok");
			},
			testMs(2),
		);

		liveTest(
			"two like turns report agy's token counts, read into the context fill and the cache window",
			async () => {
				const { live } = await world.shared();
				for (let turn = 0; turn < 2; turn += 1)
					expect((await run(live, OK_PROMPT)).outcome).toEqual({ kind: "completed" });
				const { sessionId } = live.ref;
				const read = () =>
					usageReport(
						world.tap.exchanges("session/prompt", sessionId).slice(-2),
						world.tap.notifications("session/update", sessionId),
						live,
					);
				await eventually(() => read().contextMatches, "the snapshot to show agy's last usage_update", 5_000).catch(
					() => undefined,
				);
				const report = read();
				console.log(report.text);
				expect(report.turnsWithUsage).toBe(2);
				expect(report.contextMatches).toBe(true);
				expect(report.cacheMatchesARule).toBe(true);
			},
			testMs(2),
		);

		liveTest(
			"a thinking turn at the cheap model's highest level streams its thinking before the answer",
			async () => {
				const { backend, live } = await world.shared();
				backend.guarded.thinkDeeply(live.ref.sessionId);
				const turn = await run(live, THINK_PROMPT);
				expect(turn.outcome).toEqual({ kind: "completed" });
				expect(live.session.snapshot().thinking).toBe(backend.choice.deepThinking);
				expect(blockTexts(turn.events, "thinking").join("").length).toBeGreaterThan(0);
				expect(answerText(turn.events).replaceAll(/[\s,]/g, "")).toContain(THINK_ANSWER);
				const kinds = turn.events.flatMap((event) => (event.type === "block_started" ? [event.kind] : []));
				expect(kinds.indexOf("thinking")).toBeLessThan(kinds.lastIndexOf("text"));
			},
			testMs(1),
		);

		liveTest(
			"an image reaches the model, reads back byte for byte and is named in the transcript",
			async () => {
				const { backend, live } = await world.shared();
				const image = pngAttachment([220, 30, 30], "red.png");
				const turn = await runAnswering(live, input(IMAGE_PROMPT, { attachments: [image] }));
				expect(turn.outcome).toEqual({ kind: "completed" });
				expect(answerText(turn.events).toLowerCase()).toContain("red");
				const sent = world.tap.exchanges("session/prompt", live.ref.sessionId).at(-1);
				expect(paramsOf(sent?.request ?? expect.unreachable("no prompt")).prompt).toContainEqual({
					type: "image",
					mimeType: "image/png",
					data: image.data,
				});
				const message = turn.events.find((event) => event.type === "user_message");
				const ref = message?.type === "user_message" ? message.attachments[0] : undefined;
				if (ref?.kind !== "image_ref") throw new Error("the user message names no image");
				const read = await backend.backend.readAttachment(live.ref, ref.id);
				expect(read).toMatchObject({ status: "accepted", image: { mimeType: "image/png", data: image.data } });
				const items = await allTranscript(backend.backend, live.ref, 200);
				const shown = items.find((item) => item.kind === "user_message" && item.text === IMAGE_PROMPT);
				expect(
					shown?.kind === "user_message" &&
						shown.attachments.some((attachment) => attachment.kind === "image_ref" && attachment.id === ref.id),
				).toBe(true);
			},
			testMs(1),
		);

		liveTest(
			"the session's model, thinking level and mode change and show as events, then go back",
			async () => {
				const { backend, live } = await world.shared();
				const { choice } = backend;
				const models = await backend.backend.listModels(world.cwd);
				if (models.status === "rejected") throw new Error(models.rejection.message);
				const other = models.models.find((model) => model.id !== choice.modelId) ?? expect.unreachable("one model");
				const modes = await backend.backend.listModes(world.cwd);
				if (modes.status === "rejected") throw new Error(modes.rejection.message);
				const otherMode = modes.modes
					.find((axis) => axis.id === choice.mode.axis)
					?.options.find((option) => option.value !== choice.mode.value);
				const mark = live.recorder.items.length;
				expect(await live.control.setModel(other.id)).toEqual({ status: "accepted" });
				await live.waitFor("model_changed", (event) => event.modelId === other.id, mark);
				expect(await live.control.setModel(choice.modelId)).toEqual({ status: "accepted" });
				if (choice.thinking !== undefined) {
					expect(await live.control.setThinking(choice.thinking)).toEqual({ status: "accepted" });
				}
				await live.waitFor("model_changed", (event) => event.modelId === choice.modelId, mark);
				if (otherMode !== undefined) {
					expect(await live.control.setMode(choice.mode.axis, otherMode.value)).toEqual({ status: "accepted" });
					await live.waitFor("mode_changed", (event) => event.value === otherMode.value, mark);
				}
				expect(await live.control.setMode(choice.mode.axis, choice.mode.value)).toEqual({ status: "accepted" });
				expect(live.session.snapshot()).toMatchObject({ modelId: choice.modelId, modes: [choice.mode] });
				live.assertValid();
			},
			testMs(0),
		);
	});
}

interface ToolSeen {
	name: string;
	title?: string;
	outcome?: string;
	result?: ToolResult;
}

function toolsOf(events: readonly AgentEvent[]): Map<string, ToolSeen> {
	const tools = new Map<string, ToolSeen>();
	for (const event of events) {
		if (event.type === "tool_started") {
			tools.set(event.toolCallId, { name: event.name, ...(event.title !== undefined && { title: event.title }) });
		}
		if (event.type === "tool_finished") {
			const tool = tools.get(event.toolCallId);
			if (tool !== undefined) Object.assign(tool, { outcome: event.outcome, result: event.result });
		}
	}
	return tools;
}

/**
 * Each permission the turn's tools needed, where agy asked for it, shows what it would run or write and has agy's two
 * options; where agy's permission policy approved it, the tool ran with no `session/request_permission` on the wire.
 * Every request agy sent is an ask on the phone, and the log says which way each went.
 */
function expectPermissions(world: AgyWorld, sessionId: string, asks: readonly Interaction[]): void {
	console.log(`asks: ${asks.map((ask) => `${ask.title} [${optionsOf(ask).join(", ")}]`).join("; ")}`);
	const permissions = asks.filter((ask) => ask.request.kind === "tool_permission");
	expect(permissionsAsked(world.tap, sessionId)).toHaveLength(permissions.length);
	const unasked = ranUnasked(world.tap, sessionId);
	console.log(`agy ran unasked: ${unasked.map(describeTool).join("; ") || "nothing"}`);
	const ranUnaskedAs = (what: string, did: (tool: WireTool) => boolean) => {
		if (!unasked.some(did)) throw new Error(`agy neither asked for ${what} nor ran it unasked`);
	};
	const ran = (command: string) => (tool: WireTool) => tool.command?.includes(command) === true;

	const echo = permissions.find((ask) => commandOf(ask)?.includes("echo broski"));
	if (echo === undefined) ranUnaskedAs("echo broski", ran("echo broski"));
	else {
		expect(echo.request).toMatchObject({ kind: "tool_permission", inputEditable: false, deliberate: false });
		expect(
			optionsOf(echo)
				.map((option) => option.split(" ")[1])
				.sort(),
		).toEqual(["allow", "deny"]);
	}
	const denied = permissions.find((ask) => commandOf(ask)?.includes("denied.txt"));
	if (denied === undefined) ranUnaskedAs("touch denied.txt", ran("touch denied.txt"));
	expect(existsSync(join(world.cwd, "denied.txt"))).toBe(denied === undefined);
	const write = permissions.find(
		(ask) => ask.request.kind === "tool_permission" && ask.request.previews.some(isNotesChange),
	);
	if (write === undefined) ranUnaskedAs("a change to notes.txt", (tool) => changedFile(tool, "notes.txt"));
	const ways = [branch("echo broski", echo), branch("touch denied.txt", denied), branch("writing notes.txt", write)];
	console.log(`permissions: ${ways.join("; ")}`);
}

/** Which way a permission went: agy asked for it, or agy's own policy ran it unasked. */
function branch(subject: string, ask: Interaction | undefined): string {
	return ask === undefined
		? `${subject}: agy's own permission policy approved it, no session/request_permission on the wire`
		: `${subject}: agy asked`;
}

/** Each option as `<agy's id> <effect>`. */
function optionsOf(ask: Interaction | undefined): string[] {
	if (ask?.request.kind !== "tool_permission") return [];
	return ask.request.options.map((option) => `${option.id} ${option.effect}`);
}

/** A permission to change notes.txt that shows the change itself, as agy's edit requests carry their diff. */
function isNotesChange(preview: PermissionPreview): boolean {
	return (
		preview.kind === "file_changes" &&
		preview.changes.some((change) => change.path.endsWith("notes.txt") && change.diff !== undefined)
	);
}

/** The text chunks agy sent the session after the bridge's last `session/cancel` and before it answered the prompt. */
function chunksAfterCancel(world: AgyWorld, sessionId: string): number {
	const cancel = world.tap.notifications("session/cancel", sessionId).at(-1);
	const promptId = world.tap.exchanges("session/prompt", sessionId).at(-1)?.request.message.id;
	if (cancel === undefined || promptId === undefined) throw new Error("the tap saw no cancel or no prompt");
	const { frames } = cancel.agy;
	const from = frames.indexOf(cancel.frame);
	const to = frames.findIndex(
		(frame, index) =>
			index > from && frame.from === "agent" && frame.message.method === undefined && frame.message.id === promptId,
	);
	if (to < 0) throw new Error("the tap saw no answer to the cancelled prompt");
	return frames.slice(from + 1, to).filter((frame) => isTextChunk(frame, sessionId)).length;
}

function isTextChunk(frame: Frame, sessionId: string): boolean {
	const update = updateOf(frame);
	const content = update?.content;
	const text = typeof content === "object" && content !== null && "text" in content ? content.text : undefined;
	return (
		paramsOf(frame).sessionId === sessionId &&
		(update?.sessionUpdate === "agent_message_chunk" || update?.sessionUpdate === "agent_thought_chunk") &&
		typeof text === "string" &&
		text !== ""
	);
}
