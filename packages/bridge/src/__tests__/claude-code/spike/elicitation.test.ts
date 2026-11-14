/**
 * MCP elicitation (adapter README D15) in form mode and URL mode, from a stdio MCP server the CLI
 * starts through `mcpServers`, answered through `onElicitation`.
 */

import { describe, expect, test } from "bun:test";
import type { ElicitationRequest, ElicitationResult, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createClaudeHome } from "../../helpers/claude-home";
import { ELICIT_SERVER, ELICIT_URL, FORM_SCHEMA, writeElicitServer } from "./rig/elicit-server";
import { indexOf } from "./rig/order";
import { expectNoOrphans } from "./rig/orphans";
import { isIdle, startSpike } from "./rig/session";

expectNoOrphans();

const CLI_TEST_MS = 30_000;

async function runElicitation(tool: string, answer: ElicitationResult, scenario: string) {
	const home = createClaudeHome();
	const requests: ElicitationRequest[] = [];
	const spike = startSpike({
		home,
		permissionMode: "default",
		turns: [{ toolCalls: [{ name: `mcp__${ELICIT_SERVER}__${tool}`, args: {} }] }, { text: ["thanks"] }],
		options: {
			mcpServers: writeElicitServer(home.root),
			onElicitation: async (request) => {
				requests.push(request);
				return answer;
			},
		},
	});
	try {
		spike.send(`call ${tool}`);
		await spike.waitFor((m) => m.type === "result", { timeoutMs: 25_000 });
		await spike.waitFor(isIdle, { after: indexOf(spike.messages, (m) => m.type === "result") });
		spike.record(scenario);
		return { requests, messages: [...spike.messages] };
	} finally {
		await spike.close();
		home.cleanup();
	}
}

const toolResult = (messages: readonly SDKMessage[]) =>
	JSON.stringify(messages.find((m) => m.type === "user" && m.tool_use_result !== undefined));

const states = (messages: readonly SDKMessage[]) =>
	messages.flatMap((m) => (m.type === "system" && m.subtype === "session_state_changed" ? [m.state] : []));

describe("MCP elicitation", () => {
	test(
		"form: onElicitation gets the schema, the accepted content reaches the server; requires_action while it waits",
		async () => {
			const run = await runElicitation("ask_form", { action: "accept", content: { name: "Ada" } }, "elicitation-form");
			expect(run.requests).toEqual([
				{ serverName: ELICIT_SERVER, message: "What is your name?", mode: "form", requestedSchema: FORM_SCHEMA },
			]);
			expect(toolResult(run.messages)).toContain(
				'elicitation answer: {\\"action\\":\\"accept\\",\\"content\\":{\\"name\\":\\"Ada\\"}}',
			);
			expect(states(run.messages)).toEqual([
				"running",
				"requires_action",
				"running",
				"requires_action",
				"running",
				"idle",
			]);
		},
		CLI_TEST_MS,
	);

	test(
		"url: onElicitation gets the url and id; the server's completion arrives as system/elicitation_complete",
		async () => {
			const run = await runElicitation("ask_url", { action: "accept" }, "elicitation-url");
			expect(run.requests).toEqual([
				{
					serverName: ELICIT_SERVER,
					message: "Consent in the browser",
					mode: "url",
					url: ELICIT_URL,
					elicitationId: "el-1",
				},
			]);
			const complete = run.messages.find((m) => m.type === "system" && m.subtype === "elicitation_complete");
			expect(complete).toMatchObject({ mcp_server_name: ELICIT_SERVER, elicitation_id: "el-1" });
		},
		CLI_TEST_MS,
	);
});
