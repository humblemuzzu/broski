import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { assertTempClaudePath, claudeTestEnv, createClaudeHome, DEAD_PROXY, README_TEXT } from "../helpers/claude-home";

describe("throwaway Claude home", () => {
	test("creates a config dir, a home and a git project with a README, and removes them all", () => {
		const home = createClaudeHome();
		try {
			expect(existsSync(home.configDir)).toBe(true);
			expect(readFileSync(join(home.projectDir, "README.md"), "utf8")).toBe(README_TEXT);
			expect(existsSync(join(home.projectDir, ".git"))).toBe(true);
			expect(home.configDir.startsWith(home.homeDir)).toBe(true);
		} finally {
			home.cleanup();
		}
		expect(existsSync(home.root)).toBe(false);
	});

	test("the guard refuses the real home and anything inside it", () => {
		expect(() => assertTempClaudePath(homedir(), "HOME")).toThrow(/real home/);
		expect(() => assertTempClaudePath(join(homedir(), ".claude"), "CLAUDE_CONFIG_DIR")).toThrow(/real home/);
		expect(() => assertTempClaudePath("/tmp/elsewhere", "HOME")).not.toThrow();
	});

	test("claudeTestEnv refuses a home that points at the real one", () => {
		const fake = {
			root: homedir(),
			homeDir: homedir(),
			configDir: join(homedir(), ".claude"),
			projectDir: "/tmp",
			cleanup() {},
		};
		expect(() => claudeTestEnv({ url: "http://127.0.0.1:1", home: fake })).toThrow(/real home/);
	});

	test("the env points at the scripted endpoint and the temp home, with no inherited credentials or proxies", () => {
		const saved = { ...process.env };
		process.env.ANTHROPIC_AUTH_TOKEN = "leak";
		process.env.CLAUDE_CODE_OAUTH_TOKEN = "leak";
		process.env.https_proxy = "http://corp-proxy:8080";
		process.env.XDG_CONFIG_HOME = "/somewhere/real";
		const home = createClaudeHome({ git: false });
		try {
			const env = claudeTestEnv({ url: "http://127.0.0.1:4321", home });
			expect(env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:4321");
			expect(env.ANTHROPIC_API_KEY).toBe("test");
			expect(env.CLAUDE_CONFIG_DIR).toBe(home.configDir);
			expect(env.HOME).toBe(home.homeDir);
			expect(env.XDG_CONFIG_HOME?.startsWith(home.homeDir)).toBe(true);
			expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
			expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
			expect(env.https_proxy).toBeUndefined();
			expect(env.HTTPS_PROXY).toBe(DEAD_PROXY);
			expect(env.NO_PROXY).toContain("127.0.0.1");
			expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe("1");
			expect(env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS).toBe("1");
			expect(env.PATH).toBe(process.env.PATH ?? "");
		} finally {
			home.cleanup();
			for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
			Object.assign(process.env, saved);
		}
	});
});
