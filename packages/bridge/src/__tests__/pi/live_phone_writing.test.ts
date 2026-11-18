/**
 * The bridge's note on writing for the phone, on the real `pi`: it reaches the model's system prompt through the
 * bridge's extension, after the user's own `APPEND_SYSTEM.md`, which it leaves in place.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PHONE_WRITING } from "../../server/phone-writing";
import { LiveRig } from "./helpers/live-rig";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

async function systemPromptOf(rig: LiveRig): Promise<string> {
	const live = await rig.rig.openNew();
	await rig.rig.arrange(live.ref, { kind: "reply" });
	await live.run("Hello.");
	const request = rig.router.requests(live.ref.sessionId)[0];
	const system = request?.messages.filter((message) => message.role === "system" || message.role === "developer");
	return (system ?? []).map((message) => JSON.stringify(message.content)).join("\n");
}

describe("the note on writing for the phone", () => {
	test("is the last part of a hosted pi's system prompt, after the user's own APPEND_SYSTEM.md", async () => {
		t = await LiveRig.create({ appendSystemPrompt: PHONE_WRITING });
		writeFileSync(join(t.world.env.agentDir, "APPEND_SYSTEM.md"), "The user's own closing words.");
		const system = await systemPromptOf(t);
		const own = system.indexOf("The user's own closing words.");
		const note = system.indexOf("# Writing for the phone");
		expect(own).toBeGreaterThan(-1);
		expect(note).toBeGreaterThan(own);
		expect(system).toContain("<broski_phone>");
	});

	test("is left out when the bridge has none", async () => {
		t = await LiveRig.create();
		expect(await systemPromptOf(t)).not.toContain("Writing for the phone");
	});
});
