/**
 * A throwaway Claude Code home for tests that start the real `claude` CLI: a temp `CLAUDE_CONFIG_DIR`,
 * a temp `HOME` and XDG dirs, and a temp project (a git repo holding a README.md). Nothing here may ever
 * reach the developer's real `~/.claude`, `~/.claude.json` or the network: every path goes through
 * `assertTempClaudePath`, and `claudeTestEnv` strips the inherited credentials, config dirs and proxies.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { realHomeDir } from "../../safety/real-home-guard";

export type ClaudeHome = {
	root: string;
	configDir: string;
	homeDir: string;
	projectDir: string;
	/** `CLAUDE_CODE_TMPDIR`: where the CLI puts task output files, instead of `/tmp/claude-<uid>`. */
	tmpDir: string;
	cleanup: () => void;
};

export const README_TEXT = "# Scripted project\n\nThe magic word is PLUMBUS.\n";
/** Nothing listens here, so a request that ignores `NO_PROXY` fails fast instead of reaching the network. */
export const DEAD_PROXY = "http://127.0.0.1:9";

const STRIPPED_PREFIXES = [
	"ANTHROPIC_",
	"CLAUDE",
	"AWS_",
	"GOOGLE_",
	"GCLOUD",
	"CLOUDSDK_",
	"VERTEX",
	"AZURE_",
	"OTEL_",
	"MCP_",
	"XDG_",
	"DEBUG",
];
const STRIPPED_KEYS = new Set(["HOME", "USERPROFILE", "NODE_OPTIONS", "BUN_OPTIONS"]);

function realHomes(): string[] {
	return [...new Set([resolve(homedir()), realHomeDir()])];
}

function canonical(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

/** Throws unless `path` is outside the real home directory (and is not the home itself). */
export function assertTempClaudePath(path: string, what: string): void {
	const target = canonical(path);
	for (const home of realHomes()) {
		const real = canonical(home);
		if (target === real || target.startsWith(`${real}${sep}`))
			throw new Error(`refusing ${what}=${target}: it is inside the real home ${real}; use a temp directory`);
	}
}

function gitInit(projectDir: string, homeDir: string): void {
	const env = { PATH: process.env.PATH ?? "", HOME: homeDir, GIT_CONFIG_NOSYSTEM: "1" };
	const run = (args: string[]) => {
		const result = Bun.spawnSync(["git", ...args], { cwd: projectDir, env, stdout: "ignore", stderr: "pipe" });
		if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
	};
	run(["init", "-q", "-b", "main"]);
	run(["-c", "user.name=Test", "-c", "user.email=test@example.com", "add", "README.md"]);
	run(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "init"]);
}

export function createClaudeHome(options: { git?: boolean } = {}): ClaudeHome {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "broski-claude-home-")));
	assertTempClaudePath(root, "root");
	const homeDir = join(root, "home");
	const configDir = join(homeDir, ".claude");
	const projectDir = join(root, "project");
	const tmpDir = join(root, "tmp");
	for (const dir of [homeDir, configDir, projectDir, tmpDir]) mkdirSync(dir, { recursive: true });
	writeFileSync(join(projectDir, "README.md"), README_TEXT);
	if (options.git !== false) gitInit(projectDir, homeDir);
	return {
		root,
		configDir,
		homeDir,
		projectDir,
		tmpDir,
		cleanup: () => {
			assertTempClaudePath(root, "cleanup");
			rmSync(root, { recursive: true, force: true });
		},
	};
}

function inheritedEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value === undefined || STRIPPED_KEYS.has(key)) continue;
		if (/_proxy$/i.test(key)) continue;
		if (STRIPPED_PREFIXES.some((prefix) => key.toUpperCase().startsWith(prefix))) continue;
		env[key] = value;
	}
	return env;
}

/**
 * The complete `env` for `query()` options: the scripted endpoint, the temp home and every off-switch.
 * `proxy` is where requests to any other host go: the scripted server's `proxyUrl` (a recording trap), else
 * a dead port.
 */
export function claudeTestEnv({
	url,
	home,
	proxy = DEAD_PROXY,
}: {
	url: string;
	home: ClaudeHome;
	proxy?: string;
}): Record<string, string> {
	assertTempClaudePath(home.configDir, "CLAUDE_CONFIG_DIR");
	assertTempClaudePath(home.homeDir, "HOME");
	return {
		...inheritedEnv(),
		ANTHROPIC_BASE_URL: url,
		ANTHROPIC_API_KEY: "test",
		CLAUDE_CONFIG_DIR: home.configDir,
		HOME: home.homeDir,
		XDG_CONFIG_HOME: join(home.homeDir, ".config"),
		XDG_DATA_HOME: join(home.homeDir, ".local", "share"),
		XDG_CACHE_HOME: join(home.homeDir, ".cache"),
		XDG_STATE_HOME: join(home.homeDir, ".local", "state"),
		CLAUDE_CODE_TMPDIR: home.tmpDir,
		CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
		DISABLE_TELEMETRY: "1",
		DISABLE_ERROR_REPORTING: "1",
		DISABLE_AUTOUPDATER: "1",
		DISABLE_GROWTHBOOK: "1",
		DO_NOT_TRACK: "1",
		CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
		HTTPS_PROXY: proxy,
		HTTP_PROXY: proxy,
		ALL_PROXY: proxy,
		NO_PROXY: "127.0.0.1,localhost",
	};
}
