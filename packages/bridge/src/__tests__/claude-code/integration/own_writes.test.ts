/**
 * D122: a transcript this bridge itself just wrote (a rename appends a title, a fork writes a new file) is not a
 * terminal writing it, so opening it right after gives a session with control, not a watch-only one.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { OWN_FLUSH_MS } from "../../../backends/claude-code/terminal/watch-only";
import { expectNoOrphans } from "../spike/rig/orphans";
import { CLI_TEST_MS, type IntegrationRig, startRig } from "./rig";

expectNoOrphans();

let world: IntegrationRig | undefined;

afterEach(async () => {
	await world?.dispose();
	world = undefined;
});

describe("a session the bridge just changed on disk", () => {
	test(
		"opens with control after a rename and after a fork, with nobody hosting it",
		async () => {
			world = await startRig();
			const { rig, world: claude } = world;
			const live = await rig.openNew();
			await rig.arrange(live.ref, { kind: "reply" });
			await live.run("Leave some history.");
			await live.close();
			rig.backend = await claude.restart({ catalog: rig.catalog });
			await Bun.sleep(OWN_FLUSH_MS + 200);
			expect((await rig.backend.rename?.(live.ref, "A new name"))?.status).toBe("accepted");
			const renamed = await rig.open(live.ref);
			expect(renamed.session.control).toBeDefined();
			await renamed.close();
			const forked = await rig.backend.fork?.(live.ref, undefined);
			if (forked?.status !== "accepted") throw new Error("the fork was refused");
			const opened = await rig.open(forked.session);
			expect(opened.session.control).toBeDefined();
			await opened.close();
		},
		CLI_TEST_MS,
	);
});
