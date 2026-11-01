/**
 * One-off probe: drives a subagent (Agent tool), then `/compact`, with every request going to the main
 * script, and prints how each request looks (system prompt head, tool count, last user text), so the
 * scripted endpoint's side-request classifier can be written from real traffic.
 * Run: `bun scripts/cc-spike/probe-side-requests.ts [--nonessential-on]`.
 */
import { startSpike } from "../../src/__tests__/claude-code/spike/rig/session";
import type { ScriptedRequest } from "../../src/__tests__/helpers/scripted-anthropic-server";

function summary(request: ScriptedRequest): string {
	const body = request.body as Record<string, unknown> | null;
	const system = JSON.stringify(body?.system ?? "").slice(0, 400);
	const messages = (body?.messages as Array<{ content: unknown }> | undefined) ?? [];
	const last = JSON.stringify(messages.at(-1)?.content ?? "").slice(-400);
	const tools = Array.isArray(body?.tools) ? (body.tools as Array<{ name: string }>).map((t) => t.name).join(",") : "-";
	return `${request.path} model=${body?.model} stream=${body?.stream} n=${messages.length} max_tokens=${body?.max_tokens}\n  tools=${tools}\n  system=${system}\n  last=${last}\n  keys=${Object.keys(body ?? {})}`;
}

const spike = startSpike({
	permissionMode: "bypassPermissions",
	options: { allowDangerouslySkipPermissions: true },
	env: process.argv.includes("--nonessential-on") ? { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: undefined } : {},
	server: { sideRequests: false },
	turns: [
		{ toolCalls: [{ name: "Agent", args: { description: "Find word", prompt: "Read README.md", subagent_type: "general-purpose" } }] },
		{ text: ["subagent says PLUMBUS"] },
		{ text: ["Main: the word is PLUMBUS."] },
		{ text: ["<summary>compacted</summary>"] },
		{ text: ["after compact"] },
		{ text: ["spare 1"] },
		{ text: ["spare 2"] },
	],
});
try {
	spike.send("use a subagent to find the word");
	await spike.waitFor((m) => m.type === "result", { timeoutMs: 30_000 });
	const after = spike.messages.length;
	spike.send("/compact");
	await spike.waitFor((m) => m.type === "result", { timeoutMs: 30_000, after });
	await Bun.sleep(3000);
	console.log(spike.messages.map((m) => `${m.type}${"subtype" in m ? `/${m.subtype}` : ""}`).join(" "));
} catch (error) {
	console.log("ERROR", error);
} finally {
	for (const request of spike.server.requests()) console.log(summary(request));
	console.log("served", ["main", "subagent", "compact", "title"].map((k) => `${k}=${spike.server.served(k)}`).join(" "));
	console.log("escapes", spike.server.escapes(), "stderr", spike.stderr.join("").slice(0, 2000));
	await spike.close();
}
