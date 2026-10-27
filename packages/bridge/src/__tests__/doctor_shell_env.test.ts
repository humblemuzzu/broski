/**
 * The doctor's view of the login-shell environment: whether it resolves at all, and which well-known agent
 * variables are present — by name. Values never appear, and no case reads the developer's real `~/.zshrc`.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runShellEnvChecks } from "../doctor/checks/shell-env";
import type { CheckResult } from "../doctor/types";
import { realHomeDir } from "../safety/real-home-guard";

const ZSH = "/bin/zsh";

function tempHome(rc: string): string {
	const home = mkdtempSync(join(tmpdir(), "broski-doctor-shell-"));
	writeFileSync(join(home, ".zshrc"), rc);
	return home;
}

function tempAgentDir(models: unknown): string {
	const dir = mkdtempSync(join(tmpdir(), "broski-doctor-agent-"));
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "models.json"), JSON.stringify(models));
	return dir;
}

function byId(results: CheckResult[], id: string): CheckResult {
	const found = results.find((result) => result.id === id);
	if (!found) throw new Error(`no ${id} check in ${results.map((result) => result.id).join(", ")}`);
	return found;
}

describe.skipIf(!existsSync(ZSH))("runShellEnvChecks", () => {
	test("reports the resolution and the variables it can see, by name only", async () => {
		const home = tempHome("export ANTHROPIC_API_KEY=test-anthropic-value\nexport CROF_API_KEY=test-crof-value\n");
		const agentDir = tempAgentDir({
			providers: { crof: { baseUrl: "https://crof.invalid", api: "openai-completions", apiKey: "$CROF_API_KEY" } },
		});

		const results = await runShellEnvChecks({
			shell: ZSH,
			env: { HOME: home, PATH: "/usr/bin:/bin", PI_CODING_AGENT_DIR: agentDir },
		});

		const resolution = byId(results, "login_shell_env");
		expect(resolution.status).toBe("ok");
		expect(resolution.message).toContain(ZSH);
		expect(resolution.message).toContain("variables");

		const credentials = byId(results, "agent_credentials");
		expect(credentials.category).toBe("agents");
		expect(credentials.details).toContain("ANTHROPIC_API_KEY: present");
		expect(credentials.details).toContain("CROF_API_KEY: present");
		expect(credentials.details).toContain("OPENAI_API_KEY: missing");
		expect(credentials.status).toBe("ok");

		const rendered = JSON.stringify(results);
		expect(rendered).not.toContain("test-anthropic-value");
		expect(rendered).not.toContain("test-crof-value");
	});

	test("a variable the user's models.json references but nothing sets is a warning", async () => {
		const home = tempHome("export ANTHROPIC_API_KEY=test-anthropic-value\n");
		const agentDir = tempAgentDir({
			providers: { river: { baseUrl: "https://river.invalid", api: "openai-completions", apiKey: "$RIVER_API_KEY" } },
		});

		const results = await runShellEnvChecks({
			shell: ZSH,
			env: { HOME: home, PATH: "/usr/bin:/bin", PI_CODING_AGENT_DIR: agentDir },
		});

		const credentials = byId(results, "agent_credentials");
		expect(credentials.status).toBe("warning");
		expect(credentials.message).toContain("RIVER_API_KEY");
		expect(credentials.fix).toContain("RIVER_API_KEY");
	});

	test("a shell that never finishes is a warning with the reason, not a hang", async () => {
		const home = tempHome("sleep 30\n");

		const results = await runShellEnvChecks({
			shell: ZSH,
			timeoutMs: 400,
			env: { HOME: home, PATH: "/usr/bin:/bin", PI_CODING_AGENT_DIR: tempAgentDir({ providers: {} }) },
		});

		const resolution = byId(results, "login_shell_env");
		expect(resolution.status).toBe("warning");
		expect(resolution.message).toContain("not resolved");
		expect(resolution.fix).toContain("broski restart");
		expect(byId(results, "agent_credentials").status).toBe("ok");
	}, 30_000);

	test("an isolated run pointed at the real home reports that it skipped", async () => {
		const results = await runShellEnvChecks({ env: { HOME: realHomeDir(), PATH: "/usr/bin:/bin" } });

		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("login_shell_env");
		expect(results[0]?.status).toBe("info");
		expect(results[0]?.message).toContain("isolated");
	});
});
