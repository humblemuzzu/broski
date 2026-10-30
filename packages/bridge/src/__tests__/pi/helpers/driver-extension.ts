/**
 * The extension the conformance driver gives every test session, loaded the way a user's own would be
 * (named in the agent dir's `settings.json`). The faux model calls its tools on cue:
 *   `driver_hold`  parks inside the run until the test releases it or the run is aborted;
 *   `ask_human`    opens one of Pi's dialogs and returns what the extension got back.
 * It also records session lifecycles and command runs on the shared bus (`driver-bus.ts`).
 */

import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionUIContext, ExtensionUIDialogOptions } from "@earendil-works/pi-coding-agent";
import { driverBus } from "./driver-bus";

export default function driverExtension(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		driverBus().recordLifecycle({ event: "start", sessionId: ctx.sessionManager.getSessionId() });
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const bus = driverBus();
		if (bus.askOnShutdown) {
			const answer = await ctx.ui.confirm("Leaving?", "The session is shutting down.");
			bus.recordAsk("shutdown", answer);
		}
		bus.recordLifecycle({ event: "shutdown", sessionId: ctx.sessionManager.getSessionId() });
	});

	pi.registerTool({
		name: "driver_hold",
		label: "Hold",
		description: "Waits until the test releases it.",
		parameters: Type.Object({ gate: Type.String() }),
		execute: async (_toolCallId, params, signal) => {
			const end = await driverBus().hold(params.gate, signal);
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
			const started = subRun(params.task, "reading", 1);
			onUpdate?.({ content: [{ type: "text", text: "working" }], details: started });
			if (params.gate !== undefined) await driverBus().hold(params.gate, signal);
			const done = subRun(params.task, "found it", 3);
			return { content: [{ type: "text", text: "found it" }], details: done };
		},
	});

	pi.on("user_bash", (event) =>
		event.command === "drv-result"
			? { result: { output: "from the extension", exitCode: 0, cancelled: false, truncated: false } }
			: undefined,
	);

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
			ownSignal: Type.Optional(Type.Boolean()),
		}),
		execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
			const dialogSignal =
				params.ownSignal === true ? driverBus().ownSignal(params.tag) : params.withSignal === true ? signal : undefined;
			const options: ExtensionUIDialogOptions = {
				...(params.timeoutMs !== undefined && { timeout: params.timeoutMs }),
				...(dialogSignal !== undefined && { signal: dialogSignal }),
			};
			const answer = await askOnce(ctx.ui, params.dialog, params.title, params.options ?? [], options);
			driverBus().recordAsk(params.tag, answer);
			return { content: [{ type: "text", text: `answer: ${JSON.stringify(answer ?? null)}` }], details: {} };
		},
	});

	pi.registerCommand("drv-ping", {
		description: "Records that it ran.",
		handler: async (args) => {
			driverBus().recordCommand(args);
		},
	});

	pi.registerCommand("drv-ask", {
		description: "Asks a confirmation outside any run.",
		handler: async (_args, ctx) => {
			const answer = await ctx.ui.confirm("Proceed?", "A command asks.");
			driverBus().recordAsk("drv-ask", answer);
		},
	});
}

const ASSISTANT_STATS = {
	api: "faux",
	provider: "faux",
	model: "faux-reasoner",
	usage: {
		input: 1,
		output: 1,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 2,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	timestamp: 1,
};

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
			...ASSISTANT_STATS,
		},
		{
			role: "toolResult",
			toolCallId: "sub-call-1",
			toolName: "read",
			content: [{ type: "text", text: "# readme" }],
			isError: false,
			timestamp: 1,
		},
		{ role: "assistant", content: [{ type: "text", text: answer }], stopReason: "stop", ...ASSISTANT_STATS },
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
