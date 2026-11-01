/**
 * A tiny stdio MCP server (raw JSON-RPC, no SDK) whose two tools ask the user through MCP elicitation:
 * `ask_form` sends `elicitation/create` in form mode, `ask_url` in URL mode and, once accepted, sends
 * `notifications/elicitation/complete`. Each tool returns the client's elicitation answer as its text.
 * The source is written into the test's temp dir and started by the CLI through `mcpServers`.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

export const ELICIT_SERVER = "elicit";
export const FORM_SCHEMA = {
	type: "object",
	properties: { name: { type: "string", title: "Name" } },
	required: ["name"],
};
export const ELICIT_URL = "https://example.invalid/consent";

const SOURCE = `
const FORM_SCHEMA = ${JSON.stringify(FORM_SCHEMA)};
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
const pending = new Map();
let nextId = 1;
const ask = (params) => new Promise((resolve) => { const id = "e" + nextId++; pending.set(id, resolve); write({ id, method: "elicitation/create", params }); });
const tools = [
	{ name: "ask_form", description: "Ask the user for a name", inputSchema: { type: "object", properties: {} } },
	{ name: "ask_url", description: "Ask the user to consent in a browser", inputSchema: { type: "object", properties: {} } },
];
async function call(name) {
	if (name === "ask_form") return ask({ mode: "form", message: "What is your name?", requestedSchema: FORM_SCHEMA });
	const answer = await ask({ mode: "url", message: "Consent in the browser", url: ${JSON.stringify(ELICIT_URL)}, elicitationId: "el-1" });
	if (answer.action === "accept") write({ method: "notifications/elicitation/complete", params: { elicitationId: "el-1" } });
	return answer;
}
async function handle(message) {
	if (message.id !== undefined && pending.has(message.id)) { pending.get(message.id)(message.result ?? { error: message.error }); pending.delete(message.id); return; }
	if (message.method === "initialize") {
		process.stderr.write("client capabilities: " + JSON.stringify(message.params.capabilities) + "\\n");
		return write({ id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "elicit", version: "1.0.0" } } });
	}
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

/** Writes the server into `dir` and returns its `mcpServers` entry, run by the bridge's own Bun. */
export function writeElicitServer(dir: string): Record<string, McpServerConfig> {
	const path = join(dir, "elicit-server.mjs");
	writeFileSync(path, SOURCE);
	return { [ELICIT_SERVER]: { type: "stdio", command: process.execPath, args: [path] } };
}
