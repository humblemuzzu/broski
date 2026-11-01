/**
 * The spike's stdio MCP elicitation server (`spike/rig/elicit-server.ts`) with a third tool, `ask_confirm`, whose form
 * has an empty schema (D13's `confirm`). Configured at user scope in the temp home, its tools allowed in user settings,
 * so calling one raises the elicitation and no tool permission first (Q13: an unallowed MCP tool asks twice).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ELICIT_SERVER = "elicit";
export const ELICIT_TOOLS = ["ask_form", "ask_url", "ask_confirm", "ask_url_completed"] as const;
export type ElicitTool = (typeof ELICIT_TOOLS)[number];

const SOURCE = `
const FORM = { type: "object", properties: { name: { type: "string", title: "Name" } }, required: ["name"] };
const EMPTY = { type: "object", properties: {} };
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
const pending = new Map();
let nextId = 1;
const ask = (params) => new Promise((resolve) => { const id = "e" + nextId++; pending.set(id, resolve); write({ id, method: "elicitation/create", params }); });
const tools = ${JSON.stringify(ELICIT_TOOLS)}.map((name) => ({ name, description: "Ask the user: " + name, inputSchema: { type: "object", properties: {} } }));
async function call(name) {
	if (name === "ask_form") return ask({ mode: "form", message: "What is your name?", requestedSchema: FORM });
	if (name === "ask_confirm") return ask({ mode: "form", message: "Go ahead?", requestedSchema: EMPTY });
	if (name === "ask_url_completed") {
		const early = ask({ mode: "url", message: "Consent in the browser", url: "https://example.invalid/done", elicitationId: "el-2" });
		setTimeout(() => write({ method: "notifications/elicitation/complete", params: { elicitationId: "el-2" } }), 300);
		return early;
	}
	const answer = await ask({ mode: "url", message: "Consent in the browser", url: "https://example.invalid/consent", elicitationId: "el-1" });
	if (answer.action === "accept") write({ method: "notifications/elicitation/complete", params: { elicitationId: "el-1" } });
	return answer;
}
async function handle(message) {
	if (message.id !== undefined && pending.has(message.id)) { pending.get(message.id)(message.result ?? { error: message.error }); pending.delete(message.id); return; }
	if (message.method === "initialize") return write({ id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "elicit", version: "1.0.0" } } });
	if (message.method === "tools/list") return write({ id: message.id, result: { tools } });
	if (message.method === "tools/call") {
		const answer = await call(message.params.name);
		return write({ id: message.id, result: { content: [{ type: "text", text: "elicitation answer: " + JSON.stringify(answer) }] } });
	}
	if (message.id !== undefined) write({ id: message.id, error: { code: -32601, message: "no method " + message.method } });
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	let end;
	while ((end = buffer.indexOf("\\n")) >= 0) { const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1); if (line) handle(JSON.parse(line)); }
});
`;

/** Writes the server, its user-scope entry in `<configDir>/.claude.json`, and the allow rules in user settings. */
export function installElicitServer(root: string, configDir: string): void {
	const path = join(root, "elicit-server.mjs");
	writeFileSync(path, SOURCE);
	mkdirSync(configDir, { recursive: true });
	const server = { type: "stdio", command: process.execPath, args: [path] };
	writeFileSync(join(configDir, ".claude.json"), JSON.stringify({ mcpServers: { [ELICIT_SERVER]: server } }, null, 2));
	const allow = ELICIT_TOOLS.map((tool) => elicitToolName(tool));
	writeFileSync(join(configDir, "settings.json"), JSON.stringify({ permissions: { allow } }, null, 2));
}

export function elicitToolName(tool: ElicitTool): string {
	return `mcp__${ELICIT_SERVER}__${tool}`;
}
