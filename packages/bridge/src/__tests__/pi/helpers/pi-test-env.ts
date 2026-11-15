/**
 * A throwaway home for one Pi test: agent dir, sessions dir, project directories, and the environment the bridge and
 * every `pi` it starts read them from, so nothing a test runs can reach the developer's own `~/.pi`, `~/.agents` or keys.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR` (pi-coding-agent 1.5.2 `docs/environment-variables.md:81-82`). */
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
const SESSION_DIR_ENV = "PI_CODING_AGENT_SESSION_DIR";

/**
 * Everything else is removed while the env lives: Pi counts a provider as signed in from its own environment variables
 * (`OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, …), which would list real models beside the scripted ones.
 */
const KEPT_ENV =
	/^(PATH|TMPDIR|TMP|TEMP|LANG|LC_[A-Z]+|TZ|TERM|SHELL|USER|LOGNAME|CI|NO_COLOR|FORCE_COLOR|BUN_.*|NODE_.*)$/;

/**
 * No version check or telemetry of Pi's own (`docs/environment-variables.md:85-87`). `PI_OFFLINE` is left to the
 * adapter, which sets it for every `pi` it starts (`childEnv`).
 */
const QUIET_PI = { PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0" };

export interface PiTestEnv {
	readonly root: string;
	readonly home: string;
	readonly agentDir: string;
	readonly sessionDir: string;
	/** Holds a `README.md`. */
	readonly cwd: string;
	readonly otherCwd: string;
	/** What every `pi` of the test runs with: the test process's environment, as the bridge passes its own. */
	env(): Record<string, string>;
	/** Puts the environment back as it was and removes the directories. */
	dispose(): void;
}

/** Every path is real (no `/tmp` → `/private/tmp` link left), because Pi compares paths as strings. */
export function createPiTestEnv(): PiTestEnv {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "broski-pi-")));
	const home = join(root, "home");
	const agentDir = join(root, "agent");
	const sessionDir = join(root, "sessions");
	const cwd = join(root, "project");
	const otherCwd = join(root, "elsewhere");
	for (const dir of [home, agentDir, sessionDir, cwd, otherCwd]) mkdirSync(dir, { recursive: true });
	writeFileSync(join(cwd, "README.md"), "# Project\n\nA file the tests point at.\n");
	const saved = { ...process.env };
	for (const name of Object.keys(process.env)) if (!KEPT_ENV.test(name)) delete process.env[name];
	Object.assign(process.env, { [AGENT_DIR_ENV]: agentDir, [SESSION_DIR_ENV]: sessionDir, HOME: home, ...QUIET_PI });
	return {
		root,
		home,
		agentDir,
		sessionDir,
		cwd,
		otherCwd,
		env: () => {
			const env: Record<string, string> = {};
			for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value;
			return env;
		},
		dispose: () => {
			for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
			Object.assign(process.env, saved);
			rmSync(root, { recursive: true, force: true });
		},
	};
}
