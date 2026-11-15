/**
 * One prompt run by the real `pi` in a test's own env, as a terminal user's would be, for a test that needs a session
 * file Pi itself wrote: the scripted endpoint as the agent dir's provider, `pi --mode rpc`, the prompt, Pi's settle.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { type ScriptedTurn, serveScriptedOpenAI, writeScriptedModels } from "../../helpers/scripted-openai-server";
import type { PiTestEnv } from "./pi-test-env";
import { PI_BIN } from "./pi-world";

const RUN_DEADLINE_MS = 30_000;

export interface PiRun {
	readonly sessionId: string;
	readonly file: string;
}

export async function runPi(env: PiTestEnv, turns: readonly ScriptedTurn[], prompt: string): Promise<PiRun> {
	const script = [...turns];
	const server = serveScriptedOpenAI({ route: () => script.shift() ?? { text: ["Done."] } });
	writeScriptedModels(env.agentDir, server.url, "scripted", [
		{ id: "scripted-1", name: "Scripted", reasoning: true, input: ["text", "image"] },
	]);
	const child = spawn(PI_BIN, ["--mode", "rpc", "--provider", "scripted", "--model", "scripted-1"], {
		cwd: env.cwd,
		env: env.env(),
	});
	try {
		const frames = lines(child);
		child.stdin.write(`${JSON.stringify({ id: "p", type: "prompt", message: prompt })}\n`);
		await frames.until((frame) => frame.type === "agent_settled");
		child.stdin.write(`${JSON.stringify({ id: "s", type: "get_state" })}\n`);
		const state = await frames.until((frame) => frame.type === "response" && frame.id === "s");
		const { sessionId, sessionFile } = state.data ?? {};
		if (typeof sessionId !== "string" || typeof sessionFile !== "string") throw new Error("pi named no session file");
		return { sessionId, file: sessionFile };
	} finally {
		child.stdin.end();
		await new Promise((resolve) => child.once("exit", resolve));
		server.stop();
	}
}

interface Frame {
	readonly type?: string;
	readonly id?: string;
	readonly data?: { readonly sessionId?: unknown; readonly sessionFile?: unknown };
}

function lines(child: ChildProcessWithoutNullStreams) {
	const seen: Frame[] = [];
	const waiting = new Set<() => void>();
	let buffered = "";
	let stderr = "";
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	child.stdout.on("data", (chunk) => {
		buffered += chunk;
		for (let end = buffered.indexOf("\n"); end >= 0; end = buffered.indexOf("\n")) {
			seen.push(JSON.parse(buffered.slice(0, end)));
			buffered = buffered.slice(end + 1);
		}
		for (const check of [...waiting]) check();
	});
	return {
		until: (match: (frame: Frame) => boolean) =>
			new Promise<Frame>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error(`pi did not answer in time: ${stderr}`)), RUN_DEADLINE_MS);
				const check = () => {
					const found = seen.find(match);
					if (!found) return;
					waiting.delete(check);
					clearTimeout(timer);
					resolve(found);
				};
				waiting.add(check);
				check();
			}),
	};
}
