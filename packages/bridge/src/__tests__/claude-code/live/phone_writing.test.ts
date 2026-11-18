/** The bridge's note on writing for the phone, on the real CLI: it ends the system prompt Claude Code sends the model. */

import { describe, expect, test } from "bun:test";
import { PHONE_WRITING } from "../../../server/phone-writing";
import { expectNoOrphans } from "../spike/rig/orphans";
import { realRig } from "./helpers/rig";

expectNoOrphans();

const CLI_TEST_MS = 30_000;

async function systemPromptOf(appendSystemPrompt?: string): Promise<string> {
	const rig = realRig([{ text: ["Hi."] }], appendSystemPrompt === undefined ? {} : { appendSystemPrompt });
	try {
		const live = await rig.openNew(rig.home.projectDir);
		await live.run("Say hi.");
		const main = rig.server.requests().filter((request) => request.path.startsWith("/v1/messages"));
		return main.map((request) => JSON.stringify(Reflect.get(Object(request.body), "system"))).join("\n");
	} finally {
		await rig.dispose();
	}
}

describe("the note on writing for the phone", () => {
	test(
		"is in the system prompt of a session the adapter starts",
		async () => {
			expect(await systemPromptOf(PHONE_WRITING)).toContain("# Writing for the phone");
		},
		CLI_TEST_MS,
	);

	test(
		"is not there when the bridge has none",
		async () => {
			expect(await systemPromptOf()).not.toContain("Writing for the phone");
		},
		CLI_TEST_MS,
	);
});
