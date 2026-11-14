/**
 * A real bridge with Claude Code wired serves the terminal hook's route behind its bearer token and, once it
 * listens, puts the hook in the user's Claude settings (`CLAUDE_CONFIG_DIR`, a temp dir here). The adapter itself is
 * not registered with the core (its production factory would read the real home); `contract_pi_registration` covers
 * its registration.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClaudeCodeWiring } from "../../../server/claude-code-wiring";
import { E2E_TEST_TIMEOUT_MS, setupTestEnv, startBridge, type TestEnv } from "../../e2e/harness";
import { type ClaudeHome, createClaudeHome } from "../../helpers/claude-home";

let env: TestEnv | undefined;
let claude: ClaudeHome | undefined;
const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;

afterEach(() => {
	env?.restore();
	claude?.cleanup();
	env = undefined;
	claude = undefined;
	if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
	else process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
});

const ASK = {
	hook_event_name: "PermissionRequest",
	session_id: crypto.randomUUID(),
	transcript_path: "/nowhere.jsonl",
	cwd: "/nowhere",
	tool_name: "Bash",
	tool_input: { command: "ls" },
};

async function settingsWritten(path: string): Promise<Record<string, unknown>> {
	const deadline = Date.now() + 5_000;
	while (!existsSync(path)) {
		if (Date.now() > deadline) throw new Error("the hook was never written");
		await Bun.sleep(20);
	}
	return JSON.parse(readFileSync(path, "utf8"));
}

describe("a bridge with Claude Code wired", () => {
	test(
		"answers the terminal hook behind its token and installs the hook pointing at itself",
		async () => {
			env = setupTestEnv();
			claude = createClaudeHome();
			process.env.CLAUDE_CONFIG_DIR = claude.configDir;
			const wiring = createClaudeCodeWiring({
				settings: { terminalAsks: true },
				cli: () => ({ ok: false, reason: "not needed", notes: [] }),
				version: "0.0.0-e2e",
				log: () => undefined,
			});
			const bridge = await startBridge({ claudeCode: wiring });
			try {
				const url = `http://127.0.0.1:${bridge.port}/cc-terminal-hook`;
				const post = (headers: Record<string, string>) =>
					fetch(url, { method: "POST", headers, body: JSON.stringify(ASK) });
				expect((await post({})).status).toBe(401);
				const answered = await post({ authorization: `Bearer ${bridge.token}` });
				expect(answered.status).toBe(200);
				expect(await answered.json()).toEqual({});
				const settings = await settingsWritten(join(claude.configDir, "settings.json"));
				expect(JSON.stringify(settings)).toContain(url);
			} finally {
				await bridge.stop();
			}
		},
		E2E_TEST_TIMEOUT_MS,
	);
});
