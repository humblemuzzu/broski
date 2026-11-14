/**
 * The desk's own code failing mid-callback with the real CLI waiting on it (a throw would be an automatic denial the
 * person never gave: `spike/permissions.test.ts`). The ask must stay raised, or stay blocked, and nothing may answer it.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { interruptQuery } from "../../../backends/claude-code/sdk/interrupt";
import type { ScriptedTurn } from "../../helpers/scripted-anthropic-server";
import { expectNoOrphans } from "../spike/rig/orphans";
import { captureProblems, DeskRig, throwingLive } from "./desk-rig";
import { finishTurn, type RealRun, toolResults, withRealCli } from "./rig/real-run";

expectNoOrphans();

const CLI_MS = 40_000;
const WRITE: ScriptedTurn[] = [
	{ toolCalls: [{ name: "Write", args: { file_path: "notes.txt", content: "hi\n" } }] },
	{ text: ["Done."] },
];

/** The CLI reports `requires_action`: it is stopped on the ask, so what follows is not a race with its start-up. */
function blockedOnAnAsk(run: RealRun) {
	return run.spike.waitFor(
		(message) =>
			message.type === "system" && message.subtype === "session_state_changed" && message.state === "requires_action",
		{ timeoutMs: 25_000 },
	);
}

describe("a desk that fails while the real CLI waits for it", () => {
	test(
		"an emit that throws leaves the ask raised: a person can still answer it, and until then nothing runs",
		async () => {
			const quiet = captureProblems();
			const base = new DeskRig();
			const rig = new DeskRig({ live: throwingLive(base, ["interaction_requested"]) });
			await withRealCli({ permissionMode: "default", turns: WRITE, rig }, async (run) => {
				const turn = finishTurn(run, "write it");
				await base.requestedAt(0);
				await blockedOnAnAsk(run);
				const [interaction] = base.pending();
				if (!interaction) throw new Error("the ask never reached the snapshot");
				expect(run.spike.messages.some((message) => message.type === "result")).toBe(false);
				expect(existsSync(join(run.home.projectDir, "notes.txt"))).toBe(false);
				expect(
					run.rig.desk.answer({
						interactionId: interaction.id,
						reply: { kind: "tool_permission", optionId: "allow_once", grantIds: [] },
					}),
				).toEqual({ status: "accepted" });
				expect((await turn).subtype).toBe("success");
				expect(existsSync(join(run.home.projectDir, "notes.txt"))).toBe(true);
			});
			quiet.restore();
			expect(quiet.lines.join("")).toContain("interaction_requested");
		},
		CLI_MS,
	);

	test(
		"a desk that cannot raise the ask at all blocks the tool until the CLI withdraws it, and never denies it",
		async () => {
			const quiet = captureProblems();
			const rig = new DeskRig({
				now: () => {
					throw new Error("no clock");
				},
			});
			await withRealCli({ permissionMode: "default", turns: WRITE, rig }, async (run) => {
				const turn = finishTurn(run, "write it");
				await blockedOnAnAsk(run);
				await Bun.sleep(500);
				expect(run.spike.messages.some((message) => message.type === "result")).toBe(false);
				expect(toolResults(run.spike.messages)).not.toContain("Tool permission request failed");
				expect(existsSync(join(run.home.projectDir, "notes.txt"))).toBe(false);
				await interruptQuery(run.spike.q, { cancelQueued: true });
				expect((await turn).terminal_reason).toMatch(/^aborted/);
				expect(existsSync(join(run.home.projectDir, "notes.txt"))).toBe(false);
			});
			quiet.restore();
			expect(quiet.lines.join("")).toContain("canUseTool: Error: no clock");
		},
		CLI_MS,
	);
});
