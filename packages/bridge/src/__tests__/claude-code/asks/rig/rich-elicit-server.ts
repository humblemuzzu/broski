/**
 * A stdio MCP server whose tools elicit with richer schemas than the conformance one: every flat property type, a
 * nested object the contract cannot show, and a `__proto__` property. Each tool returns the client's answer as text.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const RICH_SERVER = "rich";
export const RICH_TOOLS = ["ask_flat", "ask_nested", "ask_proto", "ask_url_early"] as const;
export const EARLY_URL = "https://example.invalid/early";
export type RichTool = (typeof RICH_TOOLS)[number];

export const FLAT_SCHEMA = {
	type: "object",
	properties: {
		name: { type: "string", title: "Name", minLength: 2 },
		age: { type: "integer", minimum: 0, maximum: 120 },
		color: { type: "string", enum: ["red", "blue"], enumNames: ["Red", "Blue"] },
		tags: { type: "array", items: { type: "string", enum: ["a", "b", "c"] }, minItems: 1 },
		subscribe: { type: "boolean", default: false },
	},
	required: ["name", "age"],
};
export const NESTED_SCHEMA = {
	type: "object",
	properties: { address: { type: "object", properties: { city: { type: "string" } } } },
};
const PROTO_SCHEMA_JSON =
	'{"type":"object","properties":{"__proto__":{"type":"string","title":"Proto"}},"required":["__proto__"]}';

const SOURCE = `
const SCHEMAS = { ask_flat: ${JSON.stringify(FLAT_SCHEMA)}, ask_nested: ${JSON.stringify(NESTED_SCHEMA)}, ask_proto: JSON.parse(${JSON.stringify(PROTO_SCHEMA_JSON)}) };
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
const pending = new Map();
let nextId = 1;
const ask = (params) => new Promise((resolve) => { const id = "e" + nextId++; pending.set(id, resolve); write({ id, method: "elicitation/create", params }); });
const tools = [...Object.keys(SCHEMAS), "ask_url_early"].map((name) => ({ name, description: "Ask: " + name, inputSchema: { type: "object", properties: {} } }));
async function early() {
	const answer = ask({ mode: "url", message: "Consent in the browser", url: ${JSON.stringify(EARLY_URL)}, elicitationId: "el-early" });
	write({ method: "notifications/elicitation/complete", params: { elicitationId: "el-early" } });
	return answer;
}
async function handle(message) {
	if (message.id !== undefined && pending.has(message.id)) { pending.get(message.id)(message.result ?? { error: message.error }); pending.delete(message.id); return; }
	if (message.method === "initialize") return write({ id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "rich", version: "1.0.0" } } });
	if (message.method === "tools/list") return write({ id: message.id, result: { tools } });
	if (message.method === "tools/call") {
		const answer = await (message.params.name === "ask_url_early" ? early() : ask({ mode: "form", message: "Fill this in", requestedSchema: SCHEMAS[message.params.name] }));
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

/** The server at user scope in the temp config dir, its tools allowed, so calling one raises only the elicitation. */
export function installRichElicitServer(root: string, configDir: string): void {
	const path = join(root, "rich-elicit-server.mjs");
	writeFileSync(path, SOURCE);
	mkdirSync(configDir, { recursive: true });
	const server = { type: "stdio", command: process.execPath, args: [path] };
	writeFileSync(join(configDir, ".claude.json"), JSON.stringify({ mcpServers: { [RICH_SERVER]: server } }, null, 2));
	const allow = RICH_TOOLS.map((tool) => richToolName(tool));
	writeFileSync(join(configDir, "settings.json"), JSON.stringify({ permissions: { allow } }, null, 2));
}

export function richToolName(tool: RichTool): string {
	return `mcp__${RICH_SERVER}__${tool}`;
}
