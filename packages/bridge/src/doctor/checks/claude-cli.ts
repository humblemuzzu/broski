import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClaudeCliPath, ClaudeCliSource } from "../../server/claude-cli-path";
import type { CheckResult } from "../types";

const SOURCE_LABEL: Record<ClaudeCliSource, string> = {
	config: "claudeCode.cliPath",
	embedded: "bundled with the bridge",
	package: "SDK package",
};
const VERSION_TIMEOUT_MS = 5_000;
const CONFIG_FIX = 'Set "claudeCode": {"cliPath": "/path/to/claude"} in ~/.broski/config.json, or reinstall the bridge';

function runVersion(path: string) {
	const scratch = join(tmpdir(), "broski-claude-version");
	return Bun.spawnSync([path, "--version"], {
		env: { PATH: process.env.PATH ?? "", HOME: scratch, CLAUDE_CONFIG_DIR: join(scratch, ".claude") },
		stdout: "pipe",
		stderr: "pipe",
		timeout: VERSION_TIMEOUT_MS,
	});
}

/** `claude --version` from that file, in a scratch home: it prints and exits without reading config or the network. */
export function claudeCliVersion(path: string): { version: string } | { error: string } {
	let result: ReturnType<typeof runVersion>;
	try {
		result = runVersion(path);
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
	const out = result.stdout.toString().trim();
	if (result.exitCode !== 0 || out.length === 0) {
		return { error: result.stderr.toString().trim() || `exit code ${result.exitCode ?? "none (timed out?)"}` };
	}
	return { version: (out.split("\n")[0] ?? out).replace(/\s*\(Claude Code\)$/, "") };
}

/** The doctor's view of the binary the bridge would run for Claude Code. */
export function claudeCliCheck(cli: ClaudeCliPath, version = claudeCliVersion): CheckResult {
	const base = { id: "claude_code", category: "dependencies" as const };
	if (!cli.ok) {
		return {
			...base,
			status: "warning",
			message: "Claude Code binary not found",
			details: [cli.reason, ...cli.notes],
			fix: CONFIG_FIX,
		};
	}
	const where = `${SOURCE_LABEL[cli.source]}: ${cli.path}`;
	const ran = version(cli.path);
	if ("error" in ran) {
		return {
			...base,
			status: "warning",
			message: `Claude Code binary does not run (${where})`,
			details: [ran.error, ...cli.notes],
			fix: CONFIG_FIX,
		};
	}
	return { ...base, status: "ok", message: `Claude Code ${ran.version} (${where})`, details: cli.notes };
}
