/** The environment of every CLI the adapter starts (D4); `Options.env` replaces the whole environment. */

export interface CliEnvInput {
	/** The bridge's login-shell environment. */
	readonly base: Readonly<Record<string, string>>;
	/** `broski/<version>`. */
	readonly clientApp: string;
}

/** The SDK stamps these only when absent; inherited from a terminal `claude`, they would mark sessions `cli`. */
const STAMPED_BY_THE_SDK = new Set(["CLAUDE_CODE_ENTRYPOINT", "CLAUDE_AGENT_SDK_VERSION"]);

export function cliEnv(input: CliEnvInput): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(input.base)) if (!STAMPED_BY_THE_SDK.has(key)) env[key] = value;
	env.CLAUDE_AGENT_SDK_CLIENT_APP = input.clientApp;
	env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS = "1";
	env.CLAUDE_CODE_STARTUP_FAILURE_RESULTS = "1";
	return env;
}
