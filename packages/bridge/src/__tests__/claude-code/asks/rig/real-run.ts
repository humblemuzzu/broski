/** One real CLI with a `DeskRig`'s desk wired in as its callbacks, a throwaway home, and zero escapes asserted at the end. */

import { expect } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { type ClaudeHome, createClaudeHome } from "../../../helpers/claude-home";
import type { ScriptedRoute, ScriptedTurn } from "../../../helpers/scripted-anthropic-server";
import { type SpikeOptions, type SpikeSession, startSpike } from "../../spike/rig/session";
import { DeskRig } from "../desk-rig";
import { installRichElicitServer } from "./rich-elicit-server";

export interface RealRunSpec {
	readonly permissionMode: SpikeOptions["permissionMode"];
	readonly turns?: ScriptedTurn[];
	readonly routes?: ScriptedRoute[];
	readonly richServer?: boolean;
	/** A rig built to break (a host that fails); default a plain one. */
	readonly rig?: DeskRig;
}

export interface RealRun {
	readonly rig: DeskRig;
	readonly spike: SpikeSession;
	readonly home: ClaudeHome;
}

const RESULT_MS = 25_000;

export async function withRealCli<T>(spec: RealRunSpec, body: (run: RealRun) => Promise<T>): Promise<T> {
	const home = createClaudeHome();
	if (spec.richServer) installRichElicitServer(home.root, home.configDir);
	const rig = spec.rig ?? new DeskRig();
	const spike = startSpike({
		home,
		permissionMode: spec.permissionMode,
		turns: spec.turns ?? [],
		...(spec.routes && { server: { routes: spec.routes } }),
		options: { canUseTool: rig.desk.canUseTool, onElicitation: rig.desk.onElicitation },
	});
	try {
		const value = await body({ rig, spike, home });
		expect(spike.server.escapes()).toEqual([]);
		return value;
	} finally {
		await spike.close();
		home.cleanup();
	}
}

/** Sends `text` and waits for the turn's result. */
export async function finishTurn(run: RealRun, text: string): Promise<Extract<SDKMessage, { type: "result" }>> {
	const from = run.spike.messages.length;
	run.spike.send(text);
	const result = await run.spike.waitFor((message) => message.type === "result", { after: from, timeoutMs: RESULT_MS });
	if (result.type !== "result") throw new Error("not a result");
	return result;
}

/** The tool results the model was shown, as one string. */
export function toolResults(messages: readonly SDKMessage[]): string {
	return JSON.stringify(
		messages.flatMap((message) =>
			message.type === "user" && message.tool_use_result !== undefined ? [message.message.content] : [],
		),
	);
}

export function permissionModes(messages: readonly SDKMessage[]): string[] {
	return messages.flatMap((message) =>
		message.type === "system" && (message.subtype === "init" || message.subtype === "status") && message.permissionMode
			? [message.permissionMode]
			: [],
	);
}
