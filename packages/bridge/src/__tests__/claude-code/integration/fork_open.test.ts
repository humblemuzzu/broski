/**
 * Step 7 · open as fork: the phone's "Open as fork" is `fork` with no point, then an open of the new session. The
 * session it came from must stay exactly as it was on disk, also after the fork has run a turn of its own.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectKey } from "../helpers/fixture-transcripts";
import { expectNoOrphans } from "../spike/rig/orphans";
import { CLI_TEST_MS, type IntegrationRig, startRig } from "./rig";

expectNoOrphans();

let world: IntegrationRig | undefined;

afterEach(async () => {
	await world?.dispose();
	world = undefined;
});

function transcript(rig: IntegrationRig, sessionId: string): Buffer {
	const { configDir, projectDir } = rig.world.home;
	return readFileSync(join(configDir, "projects", projectKey(projectDir), `${sessionId}.jsonl`));
}

describe("open as fork", () => {
	test(
		"leaves the source transcript byte for byte as it was, while the fork goes on",
		async () => {
			world = await startRig();
			const { rig } = world;
			const source = await rig.openNew();
			await rig.arrange(source.ref, { kind: "reply" });
			await source.run("Leave some history.");
			await source.close();
			const before = transcript(world, source.ref.sessionId);

			const forked = await rig.backend.fork?.(source.ref, undefined);
			if (forked?.status !== "accepted") throw new Error("the fork was refused");
			expect(forked.session.sessionId).not.toBe(source.ref.sessionId);
			const opened = await rig.open(forked.session);
			expect(opened.session.control).toBeDefined();
			await rig.arrange(forked.session, { kind: "reply" });
			await opened.run("Go on in the fork.");
			await opened.close();

			expect(transcript(world, source.ref.sessionId).equals(before)).toBe(true);
			expect(transcript(world, forked.session.sessionId).toString("utf8")).toContain("Go on in the fork.");
		},
		CLI_TEST_MS,
	);
});
