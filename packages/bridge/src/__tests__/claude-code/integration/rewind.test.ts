/**
 * Lanes A and F meet (D23): `rewind_files` finds the user message by its item id (`store.entryOf`), previews the
 * files a run changed, then restores them, through the whole adapter and the real CLI; on the host that ran the
 * turn, and on a transient one once nobody hosts the session.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BackendCallResult, SessionRef } from "../../../contract";
import type { Rig } from "../../../contract/testing/conformance-harness";
import { expectNoOrphans } from "../spike/rig/orphans";
import { CLI_TEST_MS, type IntegrationRig, startRig } from "./rig";

expectNoOrphans();

let world: IntegrationRig | undefined;

afterEach(async () => {
	await world?.dispose();
	world = undefined;
});

async function rewind(rig: Rig, ref: SessionRef, userItemId: string, dryRun: boolean): Promise<BackendCallResult> {
	const call = rig.backend.call;
	if (!call) throw new Error("no call()");
	return call({ backend: "claude-code", op: { kind: "rewind_files", sessionId: ref.sessionId, userItemId, dryRun } });
}

describe("rewinding a run's files", () => {
	test(
		"previews then restores the file a Write created, by the prompt's item id, and refuses an id that is no prompt",
		async () => {
			world = await startRig();
			const { rig, world: claude } = world;
			const live = await rig.openNew({ modes: [{ axis: "permissions", value: "acceptEdits" }] });
			const file = join(claude.home.projectDir, "made.txt");
			claude.router.replace(live.ref.sessionId, [
				{ toolCalls: [{ name: "Write", args: { file_path: file, content: "new\n" } }] },
				{ text: ["Written."] },
			]);
			const { clientRequestId } = await live.run("Make a file.");
			expect(existsSync(file)).toBe(true);
			const read = await rig.backend.readTranscript(live.ref, { limit: 200 });
			if (read.status !== "accepted") throw new Error(read.rejection.message);
			const prompt = read.page.items.find((item) => item.kind === "user_message");
			expect(prompt?.id).toBe(clientRequestId);
			const preview = await rewind(rig, live.ref, prompt?.id ?? "", true);
			expect(preview).toMatchObject({ status: "accepted", result: { kind: "rewind_files", canRewind: true } });
			expect(JSON.stringify(preview)).toContain("made.txt");
			expect(existsSync(file)).toBe(true);
			const reply = read.page.items.find((item) => item.kind === "block");
			const notPrompt = await rewind(rig, live.ref, reply?.id ?? "", true);
			expect(notPrompt).toMatchObject({ status: "rejected", rejection: { code: "invalid_input" } });
			await live.close();
			rig.backend = await claude.restart({ catalog: rig.catalog });
			const restored = await rewind(rig, live.ref, prompt?.id ?? "", false);
			expect(restored).toMatchObject({ status: "accepted", result: { kind: "rewind_files", canRewind: true } });
			expect(existsSync(file)).toBe(false);
		},
		CLI_TEST_MS,
	);
});
