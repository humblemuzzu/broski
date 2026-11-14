/**
 * Adapter README D25: a file this bridge's own host wrote last is not a terminal writing it, even within the 10 s
 * window.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { utimesSync } from "node:fs";
import { OWN_FLUSH_MS } from "../../../backends/claude-code/terminal/watch-only";
import { type ClaudeHome, createClaudeHome } from "../../helpers/claude-home";
import { writeFixtureSession } from "../helpers/fixture-transcripts";
import { terminalRig } from "./rig";

let home: ClaudeHome | undefined;

afterEach(() => {
	home?.cleanup();
	home = undefined;
});

describe("writing() after this bridge's host of the session ended", () => {
	test("a write before the release, or within the CLI's flush after it, is the bridge's own; a later one a terminal's", async () => {
		home = createClaudeHome();
		const sessionId = crypto.randomUUID();
		const path = writeFixtureSession(home.configDir, { sessionId, cwd: home.projectDir, prompts: ["hello"] });
		const released = new Map<string, number>();
		const rig = terminalRig(home, { released });
		const now = Date.now();
		const at = (ms: number) => utimesSync(path, new Date(ms), new Date(ms));

		at(now - 2_000);
		expect(await rig.watch.writing(sessionId)).toBe(true);
		released.set(sessionId, now - 1_000);
		expect(await rig.watch.writing(sessionId)).toBe(false);
		at(now - 1_000 + OWN_FLUSH_MS);
		expect(await rig.watch.writing(sessionId)).toBe(false);
		at(now - 1_000 + OWN_FLUSH_MS + 50);
		expect(await rig.watch.writing(sessionId)).toBe(true);
		await rig.watch.dispose();
	});
});
