/** The real `claude` CLI against the scripted endpoint in a throwaway home, with the desk's callbacks wired in. */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AskDesk } from "../../../../backends/claude-code/ports/asks";
import { interruptQuery } from "../../../../backends/claude-code/sdk/interrupt";
import type { InteractionKind } from "../../../../contract";
import { type ClaudeHome, createClaudeHome } from "../../../helpers/claude-home";
import type { ScriptedTurn } from "../../../helpers/scripted-anthropic-server";
import { type ElicitTool, elicitToolName, installElicitServer } from "../../conformance/elicit-server";
import { planRoute } from "../../spike/rig/plan-script";
import { type SpikeSession, startSpike } from "../../spike/rig/session";
import type { AskCli, TurnEnd } from "./cli";

const RESULT_MS = 25_000;
const PLAN = "# Plan\n\n1. Do it.\n";
const ELICIT_TOOL: Partial<Record<InteractionKind, ElicitTool>> = {
	form: "ask_form",
	confirm: "ask_confirm",
};
const QUESTION = {
	question: "Which color?",
	header: "Color",
	multiSelect: false,
	options: [
		{ label: "Red", description: "warm" },
		{ label: "Blue", description: "cool" },
	],
};

function turnsFor(kind: InteractionKind): ScriptedTurn[] {
	const elicit = ELICIT_TOOL[kind];
	if (elicit) return [{ toolCalls: [{ name: elicitToolName(elicit), args: {} }] }, { text: ["Thanks."] }];
	if (kind === "questions")
		return [{ toolCalls: [{ name: "AskUserQuestion", args: { questions: [QUESTION] } }] }, { text: ["Noted."] }];
	return [{ toolCalls: [{ name: "Write", args: { file_path: "notes.txt", content: "hi\n" } }] }, { text: ["Done."] }];
}

export class RealAskCli implements AskCli {
	readonly escapes: string[] = [];
	private running: { spike: SpikeSession; home: ClaudeHome } | undefined;

	async start(kind: InteractionKind, desk: AskDesk): Promise<{ done: Promise<TurnEnd> }> {
		const home = createClaudeHome();
		if (ELICIT_TOOL[kind]) installElicitServer(home.root, home.configDir);
		const spike = startSpike({
			home,
			permissionMode: kind === "plan_approval" ? "plan" : "default",
			turns: kind === "plan_approval" ? [] : turnsFor(kind),
			...(kind === "plan_approval" && { server: { routes: [planRoute(PLAN, [{ text: ["After the plan."] }])] } }),
			options: { canUseTool: desk.canUseTool, onElicitation: desk.onElicitation },
		});
		this.running = { spike, home };
		spike.send("Ask me.");
		return { done: spike.waitFor((message) => message.type === "result", { timeoutMs: RESULT_MS }).then(endOf) };
	}

	async interrupt(): Promise<void> {
		if (this.running) await interruptQuery(this.running.spike.q, { cancelQueued: true });
	}

	async close(): Promise<void> {
		const running = this.running;
		this.running = undefined;
		if (!running) return;
		this.escapes.push(...running.spike.server.escapes());
		await running.spike.close();
		running.home.cleanup();
	}
}

function endOf(message: SDKMessage): TurnEnd {
	return message.type === "result" && message.terminal_reason?.startsWith("aborted") ? "aborted" : "completed";
}
