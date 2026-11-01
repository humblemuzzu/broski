/**
 * Lanes D and F meet (D79, D121): `session_settings` turns prompt suggestions on by writing `true` in the user's
 * settings, a host started afterwards asks the CLI for them, and the CLI's suggestion reaches the phone as the
 * `prompt_suggestion` extension. Real CLI, scripted endpoint, temp home.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expectNoOrphans } from "../spike/rig/orphans";
import { CLI_TEST_MS, type IntegrationRig, startRig } from "./rig";

expectNoOrphans();

let world: IntegrationRig | undefined;

afterEach(async () => {
	await world?.dispose();
	world = undefined;
});

const ANSWER = "Run the tests next.";

describe("prompt suggestions", () => {
	test(
		"are off until the setting says true, and then come after a later turn as the extension",
		async () => {
			world = await startRig();
			const { rig, world: claude } = world;
			const first = await rig.openNew();
			const settings = (enabled?: boolean) =>
				rig.backend.call?.({
					backend: "claude-code",
					op: {
						kind: "session_settings",
						sessionId: first.ref.sessionId,
						...(enabled !== undefined && { change: { kind: "toggle", key: "promptSuggestionEnabled", enabled } }),
					},
				});
			const shownOff = { key: "promptSuggestionEnabled", enabled: false };
			expect(await settings()).toMatchObject({
				result: { settings: expect.arrayContaining([expect.objectContaining(shownOff)]) },
			});
			claude.router.replace(
				first.ref.sessionId,
				Array.from({ length: 6 }, () => ({ text: [ANSWER] })),
			);
			await first.run("First.");
			await first.run("Second.");
			await world.driver.quiesce();
			expect(first.events().some((event) => event.type === "extension")).toBe(false);
			expect((await settings(true))?.status).toBe("accepted");
			const written = JSON.parse(readFileSync(join(claude.home.configDir, "settings.json"), "utf8"));
			expect(written.promptSuggestionEnabled).toBe(true);
			const live = await rig.openNew();
			claude.router.replace(
				live.ref.sessionId,
				Array.from({ length: 6 }, () => ({ text: [ANSWER] })),
			);
			await live.run("First.");
			await live.run("Second.");
			const suggested = await live.waitFor(
				"extension",
				(event) => event.extension.kind === "prompt_suggestion" && event.extension.text === ANSWER,
			);
			expect(suggested.extension.kind).toBe("prompt_suggestion");
			live.assertValid();
		},
		CLI_TEST_MS,
	);
});
