/**
 * Q10 (research/08-spike.md): `@path` file mentions and `@agent-<name>` agent mentions in a streamed user
 * message, with the agent defined through the `agents` option.
 */

import { describe, expect, test } from "bun:test";
import { README_TEXT } from "../../helpers/claude-home";
import { expectNoOrphans } from "./rig/orphans";
import { startSpike } from "./rig/session";

expectNoOrphans();

const CLI_TEST_MS = 30_000;
const AGENT = "word-finder";

async function firstRequest(prompt: string, extra: { client_composed?: true } = {}): Promise<string> {
	const spike = startSpike({
		permissionMode: "default",
		turns: [{ text: ["ok"] }],
		options: { agents: { [AGENT]: { description: "Finds the magic word", prompt: "Find the magic word." } } },
	});
	try {
		spike.send(prompt, extra);
		await spike.waitFor((m) => m.type === "result");
		return JSON.stringify(spike.server.mainRequests()[0]?.body);
	} finally {
		await spike.close();
	}
}

describe("Q10: mentions in a streamed prompt", () => {
	test(
		"@README.md attaches the file's contents; client_composed turns that off",
		async () => {
			const magic = README_TEXT.split("\n")[2] ?? "";
			expect(await firstRequest("what does @README.md say?")).toContain(magic);
			expect(await firstRequest("what does @README.md say?", { client_composed: true })).not.toContain(magic);
		},
		CLI_TEST_MS,
	);

	test(
		"@agent-<name> adds an invoke-this-agent instruction for the model; a bare @<name> does not",
		async () => {
			const body = await firstRequest(`@agent-${AGENT} find the word`);
			expect(body).toContain(`The user has expressed a desire to invoke the agent \\"${AGENT}\\"`);
			const plain = await firstRequest(`@${AGENT} find the word`);
			expect(plain).not.toContain("desire to invoke the agent");
		},
		CLI_TEST_MS,
	);
});
