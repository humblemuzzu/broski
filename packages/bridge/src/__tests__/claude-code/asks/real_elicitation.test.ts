/** MCP elicitation through the desk against the real CLI and a stdio MCP server (08-spike Q13). */

import { describe, expect, test } from "bun:test";
import { expectNoOrphans } from "../spike/rig/orphans";
import { finishTurn, type RealRun, toolResults, withRealCli } from "./rig/real-run";
import { EARLY_URL, type RichTool, richToolName } from "./rig/rich-elicit-server";

expectNoOrphans();

const CLI_MS = 40_000;

function callTool(tool: RichTool): Parameters<typeof withRealCli>[0] {
	return {
		permissionMode: "default",
		richServer: true,
		turns: [{ toolCalls: [{ name: richToolName(tool), args: {} }] }, { text: ["Thanks."] }],
	};
}

async function answerText(run: RealRun): Promise<string> {
	const text = toolResults(run.spike.messages);
	const at = text.indexOf("elicitation answer: ");
	return at < 0 ? text : text.slice(at);
}

describe("a flat form through the real CLI", () => {
	test(
		"every property type is a field and the answer reaches the server as the content it validates",
		async () => {
			await withRealCli(callTool("ask_flat"), async (run) => {
				const turn = finishTurn(run, "ask");
				const interaction = await run.rig.requestedAt(0);
				if (interaction.request.kind !== "form") throw new Error(`a ${interaction.request.kind} ask`);
				expect(interaction.request.server).toBe("rich");
				expect(
					interaction.request.fields.map(
						(field) => `${field.kind}:${field.key}:${field.kind !== "external" && field.required}`,
					),
				).toEqual([
					"string:name:true",
					"integer:age:true",
					"string:color:false",
					"multiselect:tags:false",
					"boolean:subscribe:false",
				]);
				const refused = run.rig.answer(interaction, {
					kind: "form",
					values: { name: { kind: "text", value: "A" }, age: { kind: "number", value: 1 } },
				});
				expect(refused).toMatchObject({ rejection: { code: "invalid_input" } });
				const answered = run.rig.answer(interaction, {
					kind: "form",
					values: {
						name: { kind: "text", value: "Ada" },
						age: { kind: "number", value: 36 },
						color: { kind: "text", value: "blue" },
						tags: { kind: "choices", values: ["a", "c"] },
						subscribe: { kind: "boolean", value: true },
					},
				});
				expect(answered).toEqual({ status: "accepted" });
				await turn;
				expect(await answerText(run)).toContain(
					'{\\"action\\":\\"accept\\",\\"content\\":{\\"name\\":\\"Ada\\",\\"age\\":36,\\"color\\":\\"blue\\",\\"tags\\":[\\"a\\",\\"c\\"],\\"subscribe\\":true}}',
				);
			});
		},
		CLI_MS,
	);

	test(
		"a nested schema never reaches the desk: the CLI's MCP client refuses it first, so no interaction is raised",
		async () => {
			await withRealCli(callTool("ask_nested"), async (run) => {
				await finishTurn(run, "ask");
				expect(run.rig.requested()).toEqual([]);
				expect(await answerText(run)).toContain("Invalid elicitation request");
			});
		},
		CLI_MS,
	);

	test(
		"a __proto__ property arrives stripped by the CLI but still required: the form cannot be shown, and a person declines it",
		async () => {
			await withRealCli(callTool("ask_proto"), async (run) => {
				const turn = finishTurn(run, "ask");
				const interaction = await run.rig.requestedAt(0);
				expect(interaction.request).toEqual({ kind: "confirm" });
				expect(interaction.body).toContain("a form with fields the app cannot show");
				run.rig.answer(interaction, { kind: "confirm", confirmed: true });
				await turn;
				expect(await answerText(run)).toContain('{\\"action\\":\\"decline\\"}');
			});
		},
		CLI_MS,
	);
});

describe("a url elicitation the server completes before anyone answers", () => {
	test(
		"the completion withdraws the ask once, however the CLI also ends it",
		async () => {
			await withRealCli(callTool("ask_url_early"), async (run) => {
				const turn = finishTurn(run, "ask");
				const interaction = await run.rig.requestedAt(0);
				expect(interaction.request).toEqual({ kind: "external_url", url: EARLY_URL, server: "rich" });
				const complete = await run.spike.waitFor(
					(message) => message.type === "system" && message.subtype === "elicitation_complete",
				);
				if (complete.type !== "system" || complete.subtype !== "elicitation_complete")
					throw new Error("not a completion");
				run.rig.desk.elicitationComplete(complete.elicitation_id);
				await turn;
				expect(run.rig.resolved()).toEqual([{ interactionId: interaction.id, reason: "withdrawn" }]);
				expect(run.rig.answer(interaction, { kind: "external_url" })).toMatchObject({ rejection: { code: "stale" } });
			});
		},
		CLI_MS,
	);
});
