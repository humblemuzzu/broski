/**
 * The chain this fix exists for: a provider key that lives only in `~/.zshrc` reaches Pi's availability check.
 *
 * Both cases run against a temp HOME (the fake rc file) and a temp `PI_CODING_AGENT_DIR`, so nothing here reads
 * `~/.zshrc` or `~/.pi`. The process environment is replaced with the simulated service environment for the
 * duration of each case, which is what the bridge does at startup.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PiHandlerContext } from "../handlers/pi_message_helpers";
import { handle } from "../handlers/pi_models";
import { applyServiceShellEnv, type ShellEnvLog } from "../platform/shell-env";
import type { PiMessage } from "../routing/messages";
import { TEST_ISOLATION_ENV } from "../safety/real-home-guard";
import type { ServerMessage } from "../types";
import type { PiModelPayload, PiSelectedModelPayload } from "../types/pi";

const ZSH = "/bin/zsh";
const PROVIDER = "acme-shell";
const KEY_VARIABLE = "BROSKI_TEST_PROVIDER_KEY";
const SHELL_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

let home = "";
let agentDir = "";
let projectDir = "";
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

function writeModels(): void {
	writeFileSync(
		join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				[PROVIDER]: {
					baseUrl: "https://acme.invalid/v1",
					api: "openai-completions",
					apiKey: `$${KEY_VARIABLE}`,
					models: [{ id: "acme-1", name: "Acme One", contextWindow: 200_000, maxTokens: 8_000 }],
				},
			},
		}),
	);
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ enabledModels: [`${PROVIDER}/acme-1`] }));
}

function silentLog(): ShellEnvLog & { lines: string[] } {
	const lines: string[] = [];
	return { lines, info: (message) => lines.push(message), warn: (message) => lines.push(message) };
}

/** The launchd environment: a PATH, a HOME and the agent dir, no provider keys. */
function serviceEnv(): NodeJS.ProcessEnv {
	return { HOME: home, PATH: SHELL_PATH, SHELL: ZSH, PI_CODING_AGENT_DIR: agentDir };
}

async function withProcessEnv<T>(env: NodeJS.ProcessEnv, run: () => Promise<T>): Promise<T> {
	const saved = { ...process.env };
	for (const name of Object.keys(process.env)) delete process.env[name];
	Object.assign(process.env, env);
	try {
		return await run();
	} finally {
		for (const name of Object.keys(process.env)) delete process.env[name];
		Object.assign(process.env, saved);
	}
}

async function listModels(): Promise<{
	data: PiModelPayload[];
	selected: PiSelectedModelPayload[];
	hiddenCount: number;
	hiddenProviders: string[];
}> {
	const replies: ServerMessage[] = [];
	const ctx: PiHandlerContext = {
		cwd: projectDir,
		optionalCwd: projectDir,
		reply: (message) => replies.push(message),
		broadcast: () => {},
	};
	await handle({ type: "pi_list_models", requestId: "req-shell-env" } satisfies PiMessage, ctx);
	const reply = replies.find((message) => message.type === "pi_models");
	if (reply?.type !== "pi_models") throw new Error("no pi_models reply");
	return {
		data: reply.data,
		selected: reply.selected,
		hiddenCount: reply.hidden.count,
		hiddenProviders: reply.hidden.providers,
	};
}

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "broski-shell-home-"));
	agentDir = mkdtempSync(join(tmpdir(), "broski-shell-agent-"));
	projectDir = mkdtempSync(join(tmpdir(), "broski-shell-project-"));
	mkdirSync(agentDir, { recursive: true });
	writeModels();
});

afterEach(() => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

describe.skipIf(!existsSync(ZSH))("a provider key that lives only in the user's rc file", () => {
	test("is imported by the service-mode startup import and makes the model available", async () => {
		writeFileSync(join(home, ".zshrc"), `export ${KEY_VARIABLE}=shell-only-value\n`);
		const target = serviceEnv();
		const log = silentLog();

		const applied = await applyServiceShellEnv(log, { target, daemon: true, shell: ZSH });
		expect(applied?.ok).toBe(true);

		const catalogue = await withProcessEnv({ ...target, [TEST_ISOLATION_ENV]: "1" }, listModels);

		expect(catalogue.data.map((model) => `${model.provider}/${model.id}`)).toContain(`${PROVIDER}/acme-1`);
		expect(catalogue.selected).toEqual([
			{
				pattern: `${PROVIDER}/acme-1`,
				label: "Acme One",
				name: "Acme One",
				provider: PROVIDER,
				modelId: "acme-1",
				thinkingLevel: null,
				available: true,
				unavailableReason: null,
			},
		]);
		expect(catalogue.hiddenCount).toBe(0);
		expect(log.lines.join("\n")).not.toContain("shell-only-value");
	});

	test("without the import the model is missing, and the app is told which variable to set", async () => {
		writeFileSync(join(home, ".zshrc"), `export ${KEY_VARIABLE}=shell-only-value\n`);

		const catalogue = await withProcessEnv({ ...serviceEnv(), [TEST_ISOLATION_ENV]: "1" }, listModels);

		expect(catalogue.data.map((model) => `${model.provider}/${model.id}`)).not.toContain(`${PROVIDER}/acme-1`);
		expect(catalogue.selected).toHaveLength(1);
		const [row] = catalogue.selected;
		expect(row?.available).toBe(false);
		expect(row?.name).toBe("Acme One");
		expect(row?.provider).toBe(PROVIDER);
		expect(row?.unavailableReason).toBe(`No API key — set ${KEY_VARIABLE}, or sign in with \`pi\``);
		expect(catalogue.hiddenProviders).toEqual([PROVIDER]);
		expect(catalogue.hiddenCount).toBe(1);
	});
});
