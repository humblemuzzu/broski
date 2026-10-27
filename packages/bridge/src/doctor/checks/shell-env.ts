/**
 * Whether the bridge, running as a service, can see what the user's terminal can see.
 *
 * A launchd/systemd start inherits a near-empty environment, so a provider key exported only in `~/.zshrc` is
 * missing and Pi reports its provider as unavailable. This check resolves the login shell the way the bridge
 * does at startup and lists which well-known agent variables are present — by name, never by value.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { resolvesRealHome } from "../../platform/shell-env";
import { resolveUserShellEnv } from "../../platform/shell-env-resolve";
import { isIsolationActive } from "../../safety/real-home-guard";
import type { CheckResult } from "../types";

const WELL_KNOWN_AGENT_VARIABLES = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"];

const ENV_REFERENCE = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g;

export type ShellEnvCheckOptions = {
	shell?: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
};

function collectReferences(value: unknown, into: Set<string>): void {
	if (typeof value === "string") {
		for (const match of value.matchAll(ENV_REFERENCE)) into.add(match[1] ?? "");
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectReferences(item, into);
		return;
	}
	if (value !== null && typeof value === "object") {
		for (const item of Object.values(value)) collectReferences(item, into);
	}
}

/** Every `$NAME` the user's `models.json` references, so a provider the app cannot offer can be explained. */
async function modelsJsonReferences(env: NodeJS.ProcessEnv): Promise<string[]> {
	const agentDir = env.PI_CODING_AGENT_DIR?.trim();
	if (!agentDir && isIsolationActive()) return [];

	try {
		const raw = await readFile(resolve(agentDir ?? resolve(homedir(), ".pi", "agent"), "models.json"), "utf8");
		const names = new Set<string>();
		collectReferences(JSON.parse(raw), names);
		names.delete("");
		return [...names].sort();
	} catch {
		return [];
	}
}

export async function runShellEnvChecks(options: ShellEnvCheckOptions = {}): Promise<CheckResult[]> {
	const env = options.env ?? process.env;
	if (resolvesRealHome(env)) {
		return [
			{
				id: "login_shell_env",
				category: "agents",
				status: "info",
				message: "Login-shell environment not resolved: this run is isolated to a temporary home",
			},
		];
	}

	const resolved = await resolveUserShellEnv({ shell: options.shell, env, timeoutMs: options.timeoutMs });
	const results: CheckResult[] = [];

	if (resolved.ok) {
		const count = Object.keys(resolved.env).length;
		results.push({
			id: "login_shell_env",
			category: "agents",
			status: "ok",
			message: `Login-shell environment resolved from ${resolved.shell} (${count} variables, ${resolved.durationMs}ms)`,
		});
	} else {
		results.push({
			id: "login_shell_env",
			category: "agents",
			status: "warning",
			message: `Login-shell environment not resolved: ${resolved.reason}`,
			fix: "The bridge falls back to the service environment. Check that your login shell starts cleanly, then run `broski restart`.",
		});
	}

	const subject = resolved.ok ? resolved.env : env;
	const referenced = await modelsJsonReferences(env);
	const names = [...new Set([...WELL_KNOWN_AGENT_VARIABLES, ...referenced])].sort();
	const present = names.filter((name) => (subject[name] ?? "").length > 0);
	const referencedMissing = referenced.filter((name) => !present.includes(name));

	results.push({
		id: "agent_credentials",
		category: "agents",
		status: referencedMissing.length === 0 ? "ok" : "warning",
		message:
			`${present.length} of ${names.length} known agent variables present` +
			(referencedMissing.length > 0 ? ` — your Pi models.json needs ${referencedMissing.join(", ")}` : ""),
		details: names.map((name) => `${name}: ${present.includes(name) ? "present" : "missing"}`),
		fix:
			referencedMissing.length === 0
				? undefined
				: `Export ${referencedMissing.join(", ")} in your shell profile, then restart the bridge from the app or with \`broski restart\`. (Missing is only a problem for a variable Pi actually reads.)`,
	});

	return results;
}
