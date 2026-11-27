/**
 * The user's terminal `agy` and the phone on one conversation (`BROSKI_TEST_AGY_TERMINAL=1` as well): a session the
 * bridge made is opened by `agy -r <id>` in a tmux session of its own (`broski-agy-live`), in the folder of this
 * repository's main checkout, which the user's `agy` already trusts, so no trust prompt is met (none is ever answered:
 * nothing is typed into the terminal). The phone's view is watch-only while the terminal holds agy's presence lock,
 * promotes itself once the terminal quits (the tmux session is killed), goes back to watching when the terminal opens
 * the conversation again before the phone acts, and is hosted on the phone's prompt after the terminal quits again.
 * Two prompts.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { dirname } from "node:path";
import { PresenceLocks } from "../../../backends/antigravity/live/lock";
import { WATCHING_NOTICE } from "../../../backends/antigravity/live/watch";
import { sessionCapabilities } from "../../../contract";
import { fileLock } from "../../../platform/file-lock";
import { eventually } from "../../helpers/workspace-rig";
import { TEST_MS } from "./gate";
import { OK_PROMPT, run } from "./runs";
import { AgyWorld } from "./world";

const TMUX_SESSION = "broski-agy-live";
const TERMINAL_OPENS_MS = 30_000;
/** The view looks at the lock every 3 s (`live/lock.ts`). */
const VIEW_FOLLOWS_MS = 10_000;

function tmux(...args: string[]): { readonly ok: boolean; readonly out: string } {
	const result = Bun.spawnSync(["tmux", ...args], { stdout: "pipe", stderr: "pipe" });
	return { ok: result.exitCode === 0, out: `${result.stdout.toString()}${result.stderr.toString()}`.trim() };
}

/** The folder of the main checkout of the repository these tests are in, which the user's `agy` trusts. */
function trustedFolder(): string {
	const git = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], { stdout: "pipe" });
	if (git.exitCode !== 0) throw new Error("the terminal test runs in a checkout of this repository");
	return dirname(git.stdout.toString().trim());
}

export function terminalSuite(): void {
	describe("a terminal agy on the same conversation", () => {
		let world: AgyWorld;

		beforeAll(() => {
			if (Bun.which("tmux") === null) throw new Error("the terminal test needs tmux");
			if (tmux("has-session", "-t", TMUX_SESSION).ok) {
				throw new Error(`a tmux session ${TMUX_SESSION} is already running; end it before this test`);
			}
			world = AgyWorld.create({ label: "terminal", cwd: trustedFolder() });
		});
		afterAll(async () => {
			if (tmux("has-session", "-t", TMUX_SESSION).ok) tmux("kill-session", "-t", TMUX_SESSION);
			await world?.dispose();
			expect(world?.faults ?? []).toEqual([]);
		});

		test(
			"watched while the terminal has it, promoted when it quits, watched again when it reopens, hosted on a prompt",
			async () => {
				const backend = await world.start();
				const made = await backend.openNew();
				expect((await run(made, OK_PROMPT)).outcome).toEqual({ kind: "completed" });
				const { sessionId } = made.ref;
				const locks = new PresenceLocks(world.presenceDir, fileLock);
				await made.close();
				await eventually(() => !locks.heldElsewhere(sessionId), "the bridge to let the session go", VIEW_FOLLOWS_MS);

				await openInTerminal(world, sessionId, locks);
				const watched = await backend.open(made.ref);
				const controllable = () => sessionCapabilities(watched.session).controllable;
				expect(sessionCapabilities(watched.session)).toEqual({
					controllable: false,
					compact: false,
					cancelQueued: false,
					answer: false,
				});
				await watched.waitFor("notice", (event) => event.text === WATCHING_NOTICE);

				const promotedAt = watched.recorder.items.length;
				quitTerminal();
				await eventually(controllable, "the view to promote itself", VIEW_FOLLOWS_MS);
				await watched.waitFor("session_replaced", () => true, promotedAt);

				await openInTerminal(world, sessionId, locks);
				await eventually(() => !controllable(), "the view to go back to watching", VIEW_FOLLOWS_MS);

				quitTerminal();
				await eventually(controllable, "the view to promote itself again", VIEW_FOLLOWS_MS);
				const mark = watched.recorder.items.length;
				expect((await run(watched, OK_PROMPT)).outcome).toEqual({ kind: "completed" });
				await watched.waitFor("resynced", () => true, mark);
				expect(locks.heldElsewhere(sessionId)).toBe(true);
				watched.assertValid();
			},
			TEST_MS,
		);
	});
}

/** `agy -r <id>` in the tmux session, once it holds the conversation's lock; its screen in the failure when it never does. */
async function openInTerminal(world: AgyWorld, sessionId: string, locks: PresenceLocks): Promise<void> {
	const started = tmux("new-session", "-d", "-s", TMUX_SESSION, "-c", world.cwd, world.agy, "-r", sessionId);
	if (!started.ok) throw new Error(`tmux did not start the terminal agy: ${started.out}`);
	try {
		await eventually(
			() => locks.heldElsewhere(sessionId),
			"the terminal agy to open the conversation",
			TERMINAL_OPENS_MS,
		);
	} catch (error) {
		const screen = tmux("capture-pane", "-p", "-t", TMUX_SESSION).out;
		quitTerminal();
		throw new Error(`${String(error)}; its screen:\n${screen}`);
	}
}

/** The terminal `agy` ends with its tmux session, and the kernel lets its lock go. */
function quitTerminal(): void {
	tmux("kill-session", "-t", TMUX_SESSION);
}
