import { compareVersions, MIN_PI_VERSION } from "../../backends/pi/cli-version";
import type { PiCli } from "../../backends/pi/pi-install";
import type { CheckResult } from "../types";

const VERSION_TIMEOUT_MS = 10_000;
const FIX =
	'Install Pi (npm i -g @earendil-works/pi-coding-agent), or set "pi": {"cliPath": "/path/to/pi"} in ~/.broski/config.json';

/** `pi --version` from that file: it prints and exits before it reads any configuration. */
export function piCliVersion(path: string): { version: string } | { error: string } {
	try {
		const result = Bun.spawnSync([path, "--version"], { stdout: "pipe", stderr: "pipe", timeout: VERSION_TIMEOUT_MS });
		const version = /\d+\.\d+\.\d+/.exec(result.stdout.toString())?.[0];
		if (version !== undefined) return { version };
		return { error: result.stderr.toString().trim() || `exit code ${result.exitCode ?? "none (timed out?)"}` };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

/** The doctor's view of the `pi` the bridge would run (`server/pi-cli-path.ts`). */
export function piCliCheck(cli: PiCli, version = piCliVersion): CheckResult {
	const base = { id: "pi", category: "dependencies" as const };
	if (!cli.found) return { ...base, status: "warning", message: "Pi not found", details: [cli.reason], fix: FIX };
	const ran = version(cli.path);
	if ("error" in ran) {
		return { ...base, status: "warning", message: `Pi does not run (${cli.path})`, details: [ran.error], fix: FIX };
	}
	if (compareVersions(ran.version, MIN_PI_VERSION) < 0) {
		return {
			...base,
			status: "warning",
			message: `Pi ${ran.version} is older than ${MIN_PI_VERSION} (${cli.path})`,
			fix: "Update Pi: npm i -g @earendil-works/pi-coding-agent",
		};
	}
	return { ...base, status: "ok", message: `Pi ${ran.version} (${cli.path})` };
}
