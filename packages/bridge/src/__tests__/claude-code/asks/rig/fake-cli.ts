/** A scripted CLI: raises each kind of ask exactly as the real one hands it to the callbacks (recorded shapes), no process. */

import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { AskDesk } from "../../../../backends/claude-code/ports/asks";
import type { InteractionKind } from "../../../../contract";
import type { AskCli, TurnEnd } from "./cli";

const FORM_SCHEMA = {
	type: "object",
	properties: { name: { type: "string", title: "Name" } },
	required: ["name"],
};
const QUESTIONS = {
	questions: [
		{
			question: "Which color?",
			header: "Color",
			multiSelect: false,
			options: [
				{ label: "Red", description: "warm" },
				{ label: "Blue", description: "cool" },
			],
		},
	],
};

export class FakeAskCli implements AskCli {
	private controller = new AbortController();
	private requests = 0;

	async start(kind: InteractionKind, desk: AskDesk): Promise<{ done: Promise<TurnEnd> }> {
		this.controller = new AbortController();
		const { signal } = this.controller;
		return {
			done: this.raise(kind, desk, signal).then((interrupts) =>
				signal.aborted || interrupts ? "aborted" : "completed",
			),
		};
	}

	async interrupt(): Promise<void> {
		this.controller.abort();
	}

	async close(): Promise<void> {
		this.controller.abort();
	}

	/** True when the CLI's answer to the ask interrupts its turn. */
	private async raise(kind: InteractionKind, desk: AskDesk, signal: AbortSignal): Promise<boolean> {
		const requestId = `fake-${++this.requests}`;
		switch (kind) {
			case "tool_permission":
				return interrupts(
					await desk.canUseTool(
						"Write",
						{ file_path: "notes.txt", content: "hi\n" },
						{
							signal,
							requestId,
							toolUseID: `toolu_${requestId}`,
							title: "Claude wants to create notes.txt",
							description: "notes.txt",
							suggestions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }],
						},
					),
				);
			case "questions":
				return interrupts(
					await desk.canUseTool("AskUserQuestion", QUESTIONS, { signal, requestId, toolUseID: `toolu_${requestId}` }),
				);
			case "plan_approval":
				return interrupts(
					await desk.canUseTool(
						"ExitPlanMode",
						{ plan: "# Plan\n\n1. Do it.\n", planFilePath: "/tmp/plan.md" },
						{
							signal,
							requestId,
							toolUseID: `toolu_${requestId}`,
						},
					),
				);
			default:
				await this.elicit(kind, desk, signal, requestId);
				return false;
		}
	}

	private async elicit(kind: InteractionKind, desk: AskDesk, signal: AbortSignal, requestId: string): Promise<void> {
		const base = { serverName: "elicit", signal };
		if (kind === "external_url") {
			const request = {
				serverName: "elicit",
				message: "Consent in the browser",
				mode: "url",
				url: "https://example.invalid/consent",
				elicitationId: "el-1",
			} as const;
			await desk.onElicitation(request, { signal, requestId });
			return;
		}
		const requestedSchema = kind === "form" ? FORM_SCHEMA : { type: "object", properties: {} };
		await desk.onElicitation(
			{ serverName: base.serverName, message: "Go ahead?", mode: "form", requestedSchema },
			{ signal, requestId },
		);
	}
}

function interrupts(result: PermissionResult | null): boolean {
	return result?.behavior === "deny" && result.interrupt === true;
}
