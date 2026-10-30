/**
 * A tool from an MCP server goes through the gate like any other (D14): a real stdio MCP server,
 * connected by the built-in `mcp` extension, called by the faux model by its `mcp__<server>__<tool>` name.
 */

import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { allow, permissionOf, prompt } from "./gate_kit";
import { useWatchdog } from "./helpers/use-watchdog";
import { createRig, type Rig, toolCall } from "./ui_rig";

useWatchdog();

let rig: Rig | undefined;

afterEach(async () => {
	expect(rig?.log.invalid ?? []).toEqual([]);
	await rig?.dispose();
	rig = undefined;
});

async function mcpRig(): Promise<Rig> {
	rig = await createRig({
		mode: "ask",
		beforeHost: (env) => {
			const config = {
				mcpServers: {
					probe: {
						command: process.execPath,
						args: [join(import.meta.dir, "helpers", "mcp-echo-server.ts")],
						exposure: "direct",
					},
				},
			};
			writeFileSync(join(env.agentDir, "mcp.json"), JSON.stringify(config));
		},
	});
	await rig.bind();
	return rig;
}

test("an MCP tool is asked about by its own name, and runs with the human's edit", async () => {
	const r = await mcpRig();
	r.faux.handle.setResponses([toolCall("mcp__probe__echo", { text: "hello" }), fauxAssistantMessage("done")]);
	const run = prompt(r);
	const { interaction } = await r.log.next("interaction_requested");
	expect(interaction).toMatchObject({ title: "Allow mcp__probe__echo?", origin: { toolName: "mcp__probe__echo" } });
	expect(permissionOf(interaction.request).input).toEqual({ text: "hello" });
	const edited = r.desk.answer({
		interactionId: interaction.id,
		reply: allow("allow_once", { editedInput: { text: "edited" } }),
	});
	expect(edited).toEqual({ status: "accepted" });
	await run;
	expect(r.toolResults()).toEqual([{ toolName: "mcp__probe__echo", isError: false, text: "echo: edited" }]);
});

test("denied, an MCP tool never reaches its server", async () => {
	const r = await mcpRig();
	r.faux.handle.setResponses([toolCall("mcp__probe__echo", { text: "hello" }), fauxAssistantMessage("done")]);
	const run = prompt(r);
	const { interaction } = await r.log.next("interaction_requested");
	r.desk.answer({ interactionId: interaction.id, reply: allow("deny", { message: "Not that server." }) });
	await run;
	expect(r.toolResults()).toEqual([{ toolName: "mcp__probe__echo", isError: true, text: "Not that server." }]);
});
