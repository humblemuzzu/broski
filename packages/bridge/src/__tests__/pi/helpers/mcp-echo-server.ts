/** A stdio MCP server with one tool, `echo`, written by hand so a test needs no MCP package: newline-delimited JSON-RPC. */

import { createInterface } from "node:readline";

interface Request {
	readonly id?: number;
	readonly method: string;
	readonly params?: { readonly protocolVersion?: string; readonly arguments?: { readonly text?: string } };
}

const ECHO = {
	name: "echo",
	description: "Returns its text.",
	inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
};

function send(message: object): void {
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function answer(request: Request): object {
	switch (request.method) {
		case "initialize":
			return {
				result: {
					protocolVersion: request.params?.protocolVersion,
					capabilities: { tools: {} },
					serverInfo: { name: "probe", version: "1.0.0" },
				},
			};
		case "tools/list":
			return { result: { tools: [ECHO] } };
		case "tools/call":
			return { result: { content: [{ type: "text", text: `echo: ${request.params?.arguments?.text}` }] } };
		case "ping":
			return { result: {} };
		default:
			return { error: { code: -32601, message: `no method ${request.method}` } };
	}
}

for await (const line of createInterface({ input: process.stdin })) {
	const request: Request = JSON.parse(line);
	if (request.id !== undefined) send({ id: request.id, ...answer(request) });
}
