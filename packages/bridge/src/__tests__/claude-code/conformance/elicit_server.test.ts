/**
 * The driver's elicitation setup against the real CLI: a user-scope MCP server whose tools user settings allow raises
 * its elicitation with no tool permission first, and `ask_confirm`'s form has the empty schema the desk raises as a `confirm`.
 */

import { expect, test } from "bun:test";
import type { ElicitationRequest } from "@anthropic-ai/claude-agent-sdk";
import { createClaudeHome } from "../../helpers/claude-home";
import { expectNoOrphans } from "../spike/rig/orphans";
import { isIdle, startSpike } from "../spike/rig/session";
import { ELICIT_SERVER, elicitToolName, installElicitServer } from "./elicit-server";

expectNoOrphans();

test("an allowed user-scope MCP tool elicits at once, and ask_confirm's schema is empty", async () => {
	const home = createClaudeHome();
	installElicitServer(home.root, home.configDir);
	const asked: string[] = [];
	const elicited: ElicitationRequest[] = [];
	const spike = startSpike({
		home,
		permissionMode: "default",
		turns: [{ toolCalls: [{ name: elicitToolName("ask_confirm"), args: {} }] }, { text: ["ok"] }],
		options: {
			canUseTool: async (tool, input) => {
				asked.push(tool);
				return { behavior: "allow", updatedInput: input };
			},
			onElicitation: async (request) => {
				elicited.push(request);
				return { action: "accept", content: {} };
			},
		},
	});
	try {
		spike.send("confirm please");
		await spike.waitFor((m) => m.type === "result", { timeoutMs: 25_000 });
		await spike.waitFor(isIdle, { after: spike.messages.findIndex((m) => m.type === "result") });
		expect(asked).toEqual([]);
		expect(elicited).toEqual([
			{
				serverName: ELICIT_SERVER,
				message: "Go ahead?",
				mode: "form",
				requestedSchema: { type: "object", properties: {} },
			},
		]);
		expect(spike.server.escapes()).toEqual([]);
	} finally {
		await spike.close();
		home.cleanup();
	}
}, 30_000);
