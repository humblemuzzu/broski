/**
 * A throwaway home for one Pi test: agent dir, sessions dir, project directories and the environment Pi
 * reads them from, so nothing the SDK does can reach the developer's own `~/.pi`, `~/.agents` or keys.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type FauxModelDefinition,
	type FauxProviderHandle,
	type FauxResponseStep,
	fauxProvider,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

/** `getAgentDir()` (pi-coding-agent `src/config.ts:605-611`) and the CLI's session dir (`src/main.ts:691-695`). */
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
const SESSION_DIR_ENV = "PI_CODING_AGENT_SESSION_DIR";
/** `~/.agents/skills` is read through `$HOME` (pi-coding-agent `src/core/package-manager.ts:233-235, 2464`). */
const HOME_ENV = "HOME";

/**
 * Everything else is removed while the env lives: pi-ai counts a provider as signed in from its own
 * environment variables (`OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `AWS_PROFILE`, … pi-ai
 * `src/env-api-keys.ts`), which would list real models beside the faux ones and let a test call one.
 */
const KEPT_ENV =
	/^(PATH|TMPDIR|TMP|TEMP|LANG|LC_[A-Z]+|TZ|TERM|SHELL|USER|LOGNAME|CI|NO_COLOR|FORCE_COLOR|BUN_.*|NODE_.*)$/;

export interface PiTestEnv {
	readonly root: string;
	readonly home: string;
	readonly agentDir: string;
	readonly sessionDir: string;
	/** Holds a `README.md`. */
	readonly cwd: string;
	readonly otherCwd: string;
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
	process.env[AGENT_DIR_ENV] = agentDir;
	process.env[SESSION_DIR_ENV] = sessionDir;
	process.env[HOME_ENV] = home;
	return {
		root,
		home,
		agentDir,
		sessionDir,
		cwd,
		otherCwd,
		dispose: () => {
			for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
			Object.assign(process.env, saved);
			rmSync(root, { recursive: true, force: true });
		},
	};
}

/** A model runtime over the env's agent dir only: its `auth.json` and `models.json`, never the user's. */
export function createTestModelRuntime(env: PiTestEnv): Promise<ModelRuntime> {
	return ModelRuntime.create({
		authPath: join(env.agentDir, "auth.json"),
		modelsPath: join(env.agentDir, "models.json"),
	});
}

export interface FauxModels {
	readonly handle: FauxProviderHandle;
	readonly providerId: string;
}

/**
 * pi-ai's faux provider registered on `runtime` as a native provider (`ModelRuntime.registerNativeProvider`,
 * pi-coding-agent `src/core/model-runtime.ts:899-911`), then refreshed so its models are available.
 * Throws when any other model is available: a test must never be able to reach a real one.
 */
export async function registerFaux(
	runtime: ModelRuntime,
	models: FauxModelDefinition[],
	providerId = "faux",
): Promise<FauxModels> {
	const handle = fauxProvider({ provider: providerId, models });
	runtime.registerNativeProvider(handle.provider);
	await runtime.refresh({ allowNetwork: false });
	const real = (await runtime.getAvailable()).filter((model) => model.provider !== providerId);
	if (real.length > 0) {
		const providers = [...new Set(real.map((model) => model.provider))].join(", ");
		throw new Error(`real models are available to the test (${providers}): createPiTestEnv() must come first`);
	}
	return { handle, providerId };
}

export type { FauxResponseStep };
