/**
 * The extension every test `pi` loads, named in the world's `settings.json` the way a user's own would be. It runs in
 * that `pi`, another process, so it waits on gates of the scripted endpoint the test opens and tells the test what
 * happened in JSON notes to it (`$BROSKI_TEST_ENDPOINT`, `PiRouter.note`). The scripted model calls its tools on cue:
 *   `driver_hold`      parks inside the run until the test opens its gate or the run is aborted;
 *   `ask_human`        opens one of Pi's dialogs and returns the answer;
 *   `driver_subagent`  runs a subagent whose conversation it returns in its details, as a user's Task tool does.
 * `/drv-ping` notes that it ran, `/drv-ask` asks a confirmation outside any run. With `ask-on-shutdown` in the agent
 * dir, `session_shutdown` asks a confirmation too.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionUIContext, ExtensionUIDialogOptions } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

async function gate(name: string, signal: AbortSignal | undefined): Promise<string> {
	const response = await fetch(`${process.env.BROSKI_TEST_ENDPOINT}/gate/${encodeURIComponent(name)}`, { signal });
	return response.text();
}

type Note =
	| { readonly kind: "start" | "shutdown"; readonly sessionId: string }
	| { readonly kind: "ask"; readonly tag: string; readonly answer: string | boolean | null }
	| { readonly kind: "command"; readonly args: string };

async function note(body: Note): Promise<void> {
	await fetch(`${process.env.BROSKI_TEST_ENDPOINT}/note`, { method: "POST", body: JSON.stringify(body) });
}

export default function driverExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		await note({ kind: "start", sessionId: ctx.sessionManager.getSessionId() });
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (existsSync(join(process.env.PI_CODING_AGENT_DIR ?? "", "ask-on-shutdown"))) {
			const answer = await ctx.ui.confirm("Leaving?", "The session is shutting down.");
			await note({ kind: "ask", tag: "shutdown", answer });
		}
		await note({ kind: "shutdown", sessionId: ctx.sessionManager.getSessionId() });
	});

	pi.registerTool({
		name: "driver_hold",
		label: "Hold",
		description: "Waits until the test releases it.",
		parameters: Type.Object({ gate: Type.String() }),
		execute: async (_toolCallId, params, signal) => {
			const end = await gate(params.gate, signal).catch(() => "aborted");
			return { content: [{ type: "text", text: end }], details: {} };
		},
	});

	pi.registerTool({
		name: "driver_subagent",
		label: "Subagent",
		description:
			"Runs a subagent whose conversation it returns in its details, as the Task and oracle tools of a user's extensions do.",
		parameters: Type.Object({ task: Type.String(), gate: Type.Optional(Type.String()) }),
		execute: async (_toolCallId, params, signal, onUpdate) => {
			onUpdate?.({ content: [{ type: "text", text: "working" }], details: subRun(params.task, "reading", 1) });
			if (params.gate !== undefined) await gate(params.gate, signal);
			return { content: [{ type: "text", text: "found it" }], details: subRun(params.task, "found it", 3) };
		},
	});

	pi.registerTool({
		name: "ask_human",
		label: "Ask",
		description: "Asks the human a question through one of Pi's dialogs.",
		parameters: Type.Object({
			tag: Type.String(),
			dialog: Type.String({ description: "select, confirm, input or editor" }),
			title: Type.String(),
			options: Type.Optional(Type.Array(Type.String())),
			timeoutMs: Type.Optional(Type.Number()),
			withSignal: Type.Optional(Type.Boolean()),
			abortAfterMs: Type.Optional(Type.Number({ description: "ends the dialog with a signal of the tool's own" })),
		}),
		execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
			const dialogSignal =
				params.abortAfterMs !== undefined
					? AbortSignal.timeout(params.abortAfterMs)
					: params.withSignal === true
						? signal
						: undefined;
			const options: ExtensionUIDialogOptions = {
				...(params.timeoutMs !== undefined && { timeout: params.timeoutMs }),
				...(dialogSignal !== undefined && { signal: dialogSignal }),
			};
			const answer = await askOnce(ctx.ui, params.dialog, params.title, params.options ?? [], options);
			await note({ kind: "ask", tag: params.tag, answer: answer ?? null });
			return { content: [{ type: "text", text: `answer: ${JSON.stringify(answer ?? null)}` }], details: {} };
		},
	});

	pi.registerCommand("drv-ping", {
		description: "Records that it ran.",
		handler: async (args) => {
			await note({ kind: "command", args });
		},
	});

	pi.registerCommand("drv-ask", {
		description: "Asks a confirmation outside any run.",
		handler: async (_args, ctx) => {
			const answer = await ctx.ui.confirm("Proceed?", "A command asks.");
			await note({ kind: "ask", tag: "drv-ask", answer: answer ?? null });
		},
	});
}

const ASSISTANT = { api: "openai-completions", provider: "scripted", model: "scripted-1", timestamp: 1 };

/** The details of a subagent tool: its conversation so far (`messages` messages of three) in one sub-run. */
function subRun(task: string, answer: string, messages: number) {
	const all = [
		{ role: "user", content: [{ type: "text", text: task }], timestamp: 1 },
		{
			role: "assistant",
			content: [
				{ type: "text", text: "I will look." },
				{ type: "toolCall", id: "sub-call-1", name: "read", arguments: { path: "README.md" } },
			],
			stopReason: "toolUse",
			...ASSISTANT,
		},
		{
			role: "toolResult",
			toolCallId: "sub-call-1",
			toolName: "read",
			content: [{ type: "text", text: "# readme" }],
			isError: false,
			timestamp: 1,
		},
		{ role: "assistant", content: [{ type: "text", text: answer }], stopReason: "stop", ...ASSISTANT },
	];
	return {
		mode: "single",
		results: [
			{
				agent: "scout",
				task,
				exitCode: messages === 3 ? 0 : -1,
				messages: all.slice(0, messages === 3 ? 4 : messages),
			},
		],
	};
}

function askOnce(
	ui: ExtensionUIContext,
	dialog: string,
	title: string,
	options: string[],
	dialogOptions: ExtensionUIDialogOptions,
): Promise<string | boolean | undefined> {
	switch (dialog) {
		case "select":
			return ui.select(title, options, dialogOptions);
		case "confirm":
			return ui.confirm(title, "Please confirm.", dialogOptions);
		case "input":
			return ui.input(title, "your answer", dialogOptions);
		case "editor":
			return ui.editor(title, "prefilled");
		default:
			throw new Error(`ask_human has no dialog ${dialog}`);
	}
}
