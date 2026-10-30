/**
 * Extension dialogs end to end (D13): a real extension's `ctx.ui` calls on a real Pi session
 * with the faux provider, answered, cancelled, timed out by the extension, withdrawn by its signal or by
 * the run's end, and expired at shutdown. Nothing but those ends an ask.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { fauxAssistantMessage, Type } from "@earendil-works/pi-ai";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { InteractionReply, InteractionRequest } from "../../contract";
import { pause } from "./desk_rig";
import { useWatchdog } from "./helpers/use-watchdog";
import { createRig, type Rig, toolCall } from "./ui_rig";

useWatchdog();

let rig: Rig | undefined;

afterEach(async () => {
	expect(rig?.log.invalid ?? []).toEqual([]);
	await rig?.dispose();
	rig = undefined;
});

interface Probe {
	readonly extension: InlineExtension;
	readonly shutdownAnswers: unknown[];
	readonly startAnswers: unknown[];
	/** Aborts the signal the `signal` tool gave its dialog. */
	abortDialogSignal(): void;
}

function probe(askAtStart = false): Probe {
	const shutdownAnswers: unknown[] = [];
	const startAnswers: unknown[] = [];
	let abortDialogSignal = () => {};
	const extension: InlineExtension = {
		name: "dialog-probe",
		factory: (pi) => {
			pi.registerTool({
				name: "ask_human",
				label: "Ask",
				description: "Asks the human a question.",
				parameters: Type.Object({
					kind: Type.String(),
					timeout: Type.Optional(Type.Number()),
					viaSignal: Type.Optional(Type.Boolean()),
				}),
				execute: async (_id, params, _signal, _onUpdate, ctx) => {
					const controller = new AbortController();
					abortDialogSignal = () => controller.abort();
					const opts = {
						...(params.timeout !== undefined && { timeout: params.timeout }),
						...(params.viaSignal === true && { signal: controller.signal }),
					};
					const { ui } = ctx;
					let answer: unknown;
					if (params.kind === "select")
						answer = await ui.select(ui.theme.fg("accent", "Pick"), ["one", ui.theme.fg("accent", "two")], opts);
					if (params.kind === "confirm") answer = await ui.confirm("Sure?", "Really sure?", opts);
					if (params.kind === "input") answer = await ui.input("Name", "your name", opts);
					if (params.kind === "editor") answer = await ui.editor("Edit", "first\nsecond");
					if (params.kind === "custom") answer = await ui.custom(() => ({ render: () => [], invalidate: () => {} }));
					if (params.kind === "notify") ui.notify("from a tool", "warning");
					return { content: [{ type: "text", text: `answer=${JSON.stringify(answer ?? null)}` }], details: {} };
				},
			});
			pi.on("session_start", async (_event, ctx) => {
				if (askAtStart) startAnswers.push(await ctx.ui.confirm("Start?", "A question at session start."));
			});
			pi.on("session_shutdown", async (_event, ctx) => {
				shutdownAnswers.push(await ctx.ui.confirm("Leave?", "A question at shutdown."));
			});
		},
	};
	return { extension, shutdownAnswers, startAnswers, abortDialogSignal: () => abortDialogSignal() };
}

async function host(p: Probe): Promise<Rig> {
	rig = await createRig({ extensions: [p.extension] });
	return rig;
}

async function ask(r: Rig, args: { kind: string; timeout?: number; viaSignal?: boolean }) {
	r.faux.handle.setResponses([toolCall("ask_human", args), fauxAssistantMessage("done")]);
	const run = r.session.prompt("ask", { expandPromptTemplates: false });
	const { interaction } = await r.log.next("interaction_requested", (event) => event.interaction.blocksRun);
	return { run, interaction };
}

function reply(r: Rig, interactionId: string, answer: InteractionReply) {
	return r.desk.answer({ interactionId, reply: answer });
}

describe("every dialog kind, answered", () => {
	const cases: { kind: string; reply: InteractionReply; request: InteractionRequest; answer: string }[] = [
		{
			kind: "select",
			reply: { kind: "choice", value: "1" },
			request: {
				kind: "choice",
				options: [
					{ value: "0", label: "one" },
					{ value: "1", label: "two" },
				],
			},
			answer: `answer="\\u001b[39mtwo\\u001b[39m"`,
		},
		{
			kind: "confirm",
			reply: { kind: "confirm", confirmed: true },
			request: { kind: "confirm" },
			answer: "answer=true",
		},
		{
			kind: "input",
			reply: { kind: "text", text: "Ada" },
			request: { kind: "text", multiline: false, placeholder: "your name" },
			answer: 'answer="Ada"',
		},
		{
			kind: "editor",
			reply: { kind: "text", text: "first\nsecond edited" },
			request: { kind: "text", multiline: true, initialText: "first\nsecond" },
			answer: 'answer="first\\nsecond edited"',
		},
	];

	for (const c of cases) {
		test(`${c.kind}: the extension gets the human's answer and the run goes on`, async () => {
			const r = await host(probe());
			await r.bind();
			const { run, interaction } = await ask(r, { kind: c.kind });
			expect(interaction.request).toEqual(c.request);
			expect(interaction.runId).toBe(r.currentRun()?.runId);
			expect(interaction.blocksRun).toBe(true);
			expect(interaction.origin).toBeUndefined();
			expect(reply(r, interaction.id, c.reply)).toEqual({ status: "accepted" });
			await run;
			expect(r.toolResults()[0]?.text).toBe(c.answer);
			expect(r.log.of("interaction_resolved")).toEqual([
				{ type: "interaction_resolved", interactionId: interaction.id, reason: "answered" },
			]);
			expect((await r.log.next("run_finished")).outcome).toEqual({ kind: "completed" });
		});
	}

	test("styled titles and options reach the phone without escapes", async () => {
		const r = await host(probe());
		await r.bind();
		const { run, interaction } = await ask(r, { kind: "select" });
		expect(interaction.title).toBe("Pick");
		reply(r, interaction.id, { kind: "cancel", stopRun: false });
		await run;
	});
});

describe("every dialog kind, cancelled: Pi's own defaults", () => {
	for (const [kind, expected] of [
		["select", "answer=null"],
		["confirm", "answer=false"],
		["input", "answer=null"],
		["editor", "answer=null"],
	] as const) {
		test(kind, async () => {
			const r = await host(probe());
			await r.bind();
			const { run, interaction } = await ask(r, { kind });
			reply(r, interaction.id, { kind: "cancel", stopRun: false });
			await run;
			expect(r.toolResults()[0]?.text).toBe(expected);
			expect(r.log.of("interaction_resolved")[0]?.reason).toBe("answered");
			expect((await r.log.next("run_finished")).outcome).toEqual({ kind: "completed" });
		});
	}
});

describe("only the extension, the run or the shutdown end a dialog besides the human", () => {
	test("the extension's timeout expires it, resolves the default, and says withdrawn", async () => {
		const r = await host(probe());
		await r.bind();
		const { run, interaction } = await ask(r, { kind: "confirm", timeout: 40 });
		expect(interaction.expiresAt).toBeGreaterThan(interaction.createdAt);
		await run;
		expect(r.toolResults()[0]?.text).toBe("answer=false");
		expect(r.log.of("interaction_resolved")).toEqual([
			{ type: "interaction_resolved", interactionId: interaction.id, reason: "withdrawn" },
		]);
		expect(reply(r, interaction.id, { kind: "confirm", confirmed: true })).toMatchObject({
			rejection: { code: "stale" },
		});
	});

	test("with no timeout the dialog waits and a late answer still counts", async () => {
		const r = await host(probe());
		await r.bind();
		const { run, interaction } = await ask(r, { kind: "input" });
		expect(interaction).not.toHaveProperty("expiresAt");
		await pause(150);
		expect(r.pending()).toHaveLength(1);
		reply(r, interaction.id, { kind: "text", text: "late" });
		await run;
		expect(r.toolResults()[0]?.text).toBe('answer="late"');
	});

	test("the extension's signal withdraws it", async () => {
		const p = probe();
		const r = await host(p);
		await r.bind();
		const { run, interaction } = await ask(r, { kind: "select", viaSignal: true });
		p.abortDialogSignal();
		await run;
		expect(r.toolResults()[0]?.text).toBe("answer=null");
		expect(r.log.of("interaction_resolved")).toEqual([
			{ type: "interaction_resolved", interactionId: interaction.id, reason: "withdrawn" },
		]);
	});

	test("an abort of the run withdraws a dialog that has no signal, and the run settles aborted", async () => {
		const r = await host(probe());
		await r.bind();
		const { run, interaction } = await ask(r, { kind: "editor" });
		await r.abort();
		await run;
		expect(r.log.of("interaction_resolved")).toEqual([
			{ type: "interaction_resolved", interactionId: interaction.id, reason: "withdrawn" },
		]);
		expect((await r.log.next("run_finished")).outcome).toEqual({ kind: "aborted" });
		expect(r.pending()).toEqual([]);
	});

	test("shutdown expires a pending dialog, and a dialog asked while the extensions shut down ends at once instead of hanging", async () => {
		const p = probe();
		const r = await host(p);
		await r.bind();
		const { run, interaction } = await ask(r, { kind: "confirm" });
		r.desk.expireAll();
		await run;
		expect(r.log.of("interaction_resolved")).toEqual([
			{ type: "interaction_resolved", interactionId: interaction.id, reason: "expired" },
		]);
		await r.dispose();
		expect(p.shutdownAnswers).toEqual([false]);
		expect(r.log.of("interaction_requested")).toHaveLength(1);
	});
});

describe("dispose while a dialog is open", () => {
	test("completes at once, expires the dialog, and the extension's shutdown question is answered by Pi's default", async () => {
		const p = probe();
		const r = await host(p);
		await r.bind();
		const { run, interaction } = await ask(r, { kind: "editor" });
		const settled = run.catch(() => undefined);
		await r.dispose();
		await settled;
		expect(r.log.of("interaction_resolved")).toEqual([
			{ type: "interaction_resolved", interactionId: interaction.id, reason: "expired" },
		]);
		expect(p.shutdownAnswers).toEqual([false]);
		expect(r.log.of("interaction_requested")).toHaveLength(1);
	});
});

describe("what is not a dialog", () => {
	test("notify is a notice and custom() is undefined with a notice", async () => {
		const r = await host(probe());
		await r.bind();
		r.faux.handle.setResponses([
			toolCall("ask_human", { kind: "notify" }),
			toolCall("ask_human", { kind: "custom" }),
			fauxAssistantMessage("done"),
		]);
		await r.session.prompt("go", { expandPromptTemplates: false });
		expect(r.toolResults().map((result) => result.text)).toEqual(["answer=null", "answer=null"]);
		expect(r.log.of("notice").map((notice) => notice.level)).toEqual(["warning", "warning"]);
		expect(r.log.of("notice")[0]?.text).toBe("from a tool");
		expect(r.log.of("interaction_requested")).toEqual([]);
	});

	test("a dialog from a session_start handler holds the binding, names no run and blocks none, and is answered from the phone", async () => {
		const p = probe(true);
		const r = await host(p);
		const binding = r.bind();
		const { interaction } = await r.log.next("interaction_requested");
		expect(interaction).toMatchObject({ title: "Start?", blocksRun: false, request: { kind: "confirm" } });
		expect(interaction).not.toHaveProperty("runId");
		expect(r.live.snapshot().interactions).toHaveLength(1);
		reply(r, interaction.id, { kind: "confirm", confirmed: true });
		await binding;
		expect(p.startAnswers).toEqual([true]);
	});
});
