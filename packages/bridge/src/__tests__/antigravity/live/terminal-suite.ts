/**
 * A terminal `agy` and the phone on one conversation (`BROSKI_TEST_AGY_TERMINAL=1` as well): a session the bridge made
 * is opened by `agy -r <id>` in the world's agy profile (`profile.ts`: `HOME` its root, the folder trusted there, the
 * Gemini API key from the environment) and folder, in a tmux server of the test's own (`-L broski-agy-live`, none of
 * the user's tmux config), so neither the user's agy nor their tmux is touched. Nothing is typed into the terminal, so
 * before any prompt `agy` alone is started there and must come up asking nothing: one that exits or asks to trust the
 * folder or to sign in fails the suite with its screen, and nothing is sent. The phone's view is watch-only while the
 * terminal holds agy's presence lock, promotes itself once the terminal quits (its tmux session is killed), goes back
 * to watching when the terminal opens the conversation again before the phone acts, and is hosted on the phone's
 * prompt after the terminal quits again. Two prompts.
 */

import { afterAll, beforeAll, describe, expect } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PresenceLocks } from "../../../backends/antigravity/live/lock";
import { WATCHING_NOTICE } from "../../../backends/antigravity/live/watch";
import { sessionCapabilities } from "../../../contract";
import { fileLock } from "../../../platform/file-lock";
import { eventually } from "../../helpers/workspace-rig";
import { testMs } from "./gate";
import { liveTest } from "./live-test";
import { trustFolder, withoutApiKey } from "./profile";
import { OK_PROMPT, run } from "./runs";
import { AgyWorld } from "./world";

const TMUX_SERVER = "broski-agy-live";
const TERMINAL_OPENS_MS = 30_000;
/** How long `agy` alone has to bring its screen up and keep it still. */
const SETTLES_MS = 20_000;
/** The view looks at the lock every 3 s (`live/lock.ts`). */
const VIEW_FOLLOWS_MS = 10_000;
/** A question on the screen that only typing could answer. */
const ASKS = /trust|sign in|log in|authenticat/i;

/** The test's own tmux server: it starts with the test's environment (the key) and reads only `config`. */
function tmux(
	config: string,
	...args: string[]
): { readonly ok: boolean; readonly stdout: string; readonly out: string } {
	const result = Bun.spawnSync(["tmux", "-L", TMUX_SERVER, "-f", config, ...args], { stdout: "pipe", stderr: "pipe" });
	const stdout = result.stdout.toString();
	return { ok: result.exitCode === 0, stdout: stdout.trim(), out: `${stdout}${result.stderr.toString()}`.trim() };
}

export function terminalSuite(): void {
	describe("a terminal agy on the same conversation", () => {
		let world: AgyWorld;
		let terminal: Terminal | undefined;

		beforeAll(async () => {
			if (Bun.which("tmux") === null) throw new Error("the terminal test needs tmux");
			world = AgyWorld.create({ label: "terminal" });
			trustFolder(world.profile, world.cwd);
			const config = join(world.root, "tmux.conf");
			writeFileSync(config, "set-option -g remain-on-exit on\n");
			if (tmux(config, "list-sessions").ok) {
				throw new Error(
					`the tmux server ${TMUX_SERVER} is already running; end it (tmux -L ${TMUX_SERVER} kill-server)`,
				);
			}
			await new Terminal(world, config).comesUpAskingNothing();
		});
		afterAll(async () => {
			terminal?.quit();
			await world?.dispose();
			expect(world?.faults ?? []).toEqual([]);
		});

		liveTest(
			"watched while the terminal has it, promoted when it quits, watched again when it reopens, hosted on a prompt",
			async () => {
				const backend = await world.start();
				const made = await backend.openNew();
				expect((await run(made, OK_PROMPT)).outcome).toEqual({ kind: "completed" });
				const { sessionId } = made.ref;
				const locks = new PresenceLocks(world.presenceDir, fileLock);
				await made.close();
				await eventually(() => !locks.heldElsewhere(sessionId), "the bridge to let the session go", VIEW_FOLLOWS_MS);

				const agy = new Terminal(world, join(world.root, "tmux.conf"));
				terminal = agy;
				await agy.open(sessionId, locks);
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
				agy.quit();
				await eventually(controllable, "the view to promote itself", VIEW_FOLLOWS_MS);
				await watched.waitFor("session_replaced", () => true, promotedAt);

				await agy.open(sessionId, locks);
				await eventually(() => !controllable(), "the view to go back to watching", VIEW_FOLLOWS_MS);

				agy.quit();
				await eventually(controllable, "the view to promote itself again", VIEW_FOLLOWS_MS);
				const mark = watched.recorder.items.length;
				expect((await run(watched, OK_PROMPT)).outcome).toEqual({ kind: "completed" });
				await watched.waitFor("resynced", () => true, mark);
				expect(locks.heldElsewhere(sessionId)).toBe(true);
				watched.assertValid();
			},
			testMs(2),
		);
	});
}

/**
 * `agy` in a tmux session of the test's server, named by the id tmux gave it (`$n`, never reused by the server), so
 * only that session is ever killed, never another that came to carry the name.
 */
class Terminal {
	private tmuxId: string | undefined;

	constructor(
		private readonly world: AgyWorld,
		private readonly config: string,
	) {}

	/** `agy` alone, in the world's folder: it must still run, asking nothing, once its screen is still. */
	async comesUpAskingNothing(): Promise<void> {
		const id = this.start([]);
		let screen = "";
		try {
			screen = await this.settledScreen(id);
			const dead = tmux(this.config, "display-message", "-p", "-t", id, "#{pane_dead} #{pane_dead_status}").stdout;
			if (dead.startsWith("1")) {
				throw new Error(`the terminal agy exited (${dead}) with HOME=${this.world.profile.root}`);
			}
			if (ASKS.test(screen))
				throw new Error("the terminal agy asks what this test, which types nothing, cannot answer");
		} catch (error) {
			throw new Error(`${String(error)}; nothing was sent. Its screen:\n${screen}`);
		} finally {
			this.quit();
		}
	}

	/** `agy -r <id>`, once it holds the conversation's lock; its screen in the failure when it never does. */
	async open(sessionId: string, locks: PresenceLocks): Promise<void> {
		const id = this.start(["-r", sessionId]);
		try {
			await eventually(
				() => locks.heldElsewhere(sessionId),
				"the terminal agy to open the conversation",
				TERMINAL_OPENS_MS,
			);
		} catch (error) {
			const screen = this.screen(id);
			this.quit();
			throw new Error(`${String(error)}; its screen:\n${screen}`);
		}
	}

	/** The terminal `agy` ends with its tmux session, and the kernel lets its lock go. */
	quit(): void {
		if (this.tmuxId === undefined) return;
		tmux(this.config, "kill-session", "-t", this.tmuxId);
		this.tmuxId = undefined;
	}

	private start(args: readonly string[]): string {
		const { cwd, agy, profile } = this.world;
		const started = tmux(
			this.config,
			"new-session",
			"-d",
			"-P",
			"-F",
			"#{session_id}",
			"-s",
			TMUX_SERVER,
			"-c",
			cwd,
			"-e",
			`HOME=${profile.root}`,
			agy,
			...args,
		);
		if (!started.ok) throw new Error(`tmux did not start the terminal agy: ${started.out}`);
		this.tmuxId = started.stdout;
		return started.stdout;
	}

	private screen(id: string): string {
		return withoutApiKey(tmux(this.config, "capture-pane", "-p", "-t", id).out);
	}

	private async settledScreen(id: string): Promise<string> {
		const deadline = Date.now() + SETTLES_MS;
		let last = "";
		let still = 0;
		while (Date.now() < deadline && still < 4) {
			await Bun.sleep(500);
			const screen = this.screen(id);
			still = screen !== "" && screen === last ? still + 1 : 0;
			last = screen;
		}
		return last;
	}
}
