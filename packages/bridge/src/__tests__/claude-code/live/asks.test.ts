/** D1, D7 and rule 25 with a pending ask: the host keeps it alive past a close and withdraws it with the run (E's desk is not needed). */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expectNoOrphans } from "../spike/rig/orphans";
import { humanDesk } from "./helpers/human-desk";
import { realRig } from "./helpers/rig";

expectNoOrphans();

const CLI_TEST_MS = 30_000;
const WRITE = { toolCalls: [{ name: "Write", args: { file_path: "asked.txt", content: "hi\n" } }] };

describe("an ask the CLI raises", () => {
	test(
		"blocks the run until a person answers: the run is active, the answer lets the tool run, nothing answers for them",
		async () => {
			const desk = humanDesk();
			const rig = realRig([WRITE, { text: ["written"] }], { createDesk: desk.factory });
			try {
				const live = await rig.openNew(rig.home.projectDir);
				await live.prompt("write a file");
				const asked = await live.waitFor("interaction_requested");
				expect(asked.interaction.runId).toBe(live.reduced().run?.runId);
				expect(asked.interaction.blocksRun).toBe(true);
				await Bun.sleep(600);
				expect(live.events().some((event) => event.type === "run_finished")).toBe(false);
				expect(existsSync(join(rig.home.projectDir, "asked.txt"))).toBe(false);
				const answered = live.control.answer({
					interactionId: asked.interaction.id,
					reply: { kind: "tool_permission", optionId: "allow", grantIds: [] },
				});
				expect((await answered).status).toBe("accepted");
				const finished = await live.waitFor("run_finished");
				expect(finished.outcome).toEqual({ kind: "completed" });
				expect(existsSync(join(rig.home.projectDir, "asked.txt"))).toBe(true);
				live.assertSettled();
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"survives a close: the reopened session carries it, and answering it there finishes the run",
		async () => {
			const desk = humanDesk();
			const rig = realRig([WRITE, { text: ["written"] }], { createDesk: desk.factory });
			try {
				const live = await rig.openNew(rig.home.projectDir);
				await live.prompt("write a file");
				const asked = await live.waitFor("interaction_requested");
				await live.close();
				const reopened = await rig.openExisting(live.ref);
				expect(reopened.initial.interactions.map((interaction) => interaction.id)).toEqual([asked.interaction.id]);
				await reopened.control.answer({
					interactionId: asked.interaction.id,
					reply: { kind: "tool_permission", optionId: "allow", grantIds: [] },
				});
				const resolved = await reopened.waitFor("interaction_resolved");
				expect(resolved.reason).toBe("answered");
				await reopened.waitFor("run_finished");
				reopened.assertSettled();
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"a Stop with an ask pending withdraws it and ends the run aborted",
		async () => {
			const desk = humanDesk();
			const rig = realRig([WRITE, { text: ["never"] }], { createDesk: desk.factory });
			try {
				const live = await rig.openNew(rig.home.projectDir);
				await live.prompt("write a file");
				const asked = await live.waitFor("interaction_requested");
				expect((await live.control.abort()).status).toBe("accepted");
				const finished = await live.waitFor("run_finished");
				expect(finished.outcome).toEqual({ kind: "aborted" });
				const resolved = await live.waitFor("interaction_resolved");
				expect(resolved).toMatchObject({ interactionId: asked.interaction.id, reason: "withdrawn" });
				expect(existsSync(join(rig.home.projectDir, "asked.txt"))).toBe(false);
				live.assertSettled();
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"keeps the host open while it waits: past the idle grace nothing ends, and the ask is still there",
		async () => {
			const desk = humanDesk();
			const rig = realRig([WRITE, { text: ["written"] }], { createDesk: desk.factory });
			try {
				const live = await rig.openNew(rig.home.projectDir);
				await live.prompt("write a file");
				const asked = await live.waitFor("interaction_requested");
				await live.close();
				rig.clock.advance(10 * 60_000);
				await Bun.sleep(200);
				expect(rig.live.isHosted(live.ref.sessionId)).toBe(true);
				expect(desk.pending()).toEqual([asked.interaction.id]);
				expect(rig.live.row(live.ref.sessionId)?.status).toBe("waiting_for_user");
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"dispose expires it",
		async () => {
			const desk = humanDesk();
			const rig = realRig([WRITE], { createDesk: desk.factory });
			const live = await rig.openNew(rig.home.projectDir);
			await live.prompt("write a file");
			await live.waitFor("interaction_requested");
			await rig.live.dispose();
			expect(desk.pending()).toEqual([]);
			await rig.dispose();
		},
		CLI_TEST_MS,
	);
});
